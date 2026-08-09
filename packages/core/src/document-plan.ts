import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  DocumentPatchError,
  hashDocumentSource,
  inspectMarkdownSource,
  resolveProjectFile,
  type DocumentSection,
  type MarkdownDocumentInspection,
} from './markdown-document.js';

export const SectionSelectorSchema = z.object({
  sectionId: z.string().min(1),
}).strict();

const OperationBaseSchema = z.object({
  id: z.string().min(1),
});

export const PreserveDocumentOperationSchema = OperationBaseSchema.extend({
  type: z.literal('preserve'),
  selector: SectionSelectorSchema,
}).strict();

export const EditDocumentOperationSchema = OperationBaseSchema.extend({
  type: z.literal('edit'),
  selector: SectionSelectorSchema,
  markdown: z.string(),
}).strict();

export const ReplaceDocumentOperationSchema = OperationBaseSchema.extend({
  type: z.literal('replace'),
  selector: SectionSelectorSchema,
  markdown: z.string(),
}).strict();

export const CreateDocumentOperationSchema = OperationBaseSchema.extend({
  type: z.literal('create'),
  anchor: SectionSelectorSchema,
  position: z.enum(['before', 'after']),
  markdown: z.string().min(1),
}).strict();

export const RemoveDocumentOperationSchema = OperationBaseSchema.extend({
  type: z.literal('remove'),
  selector: SectionSelectorSchema,
  reason: z.string().trim().min(1),
}).strict();

export const DocumentOperationSchema = z.discriminatedUnion('type', [
  PreserveDocumentOperationSchema,
  EditDocumentOperationSchema,
  ReplaceDocumentOperationSchema,
  CreateDocumentOperationSchema,
  RemoveDocumentOperationSchema,
]);

export const DocumentPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  targetPath: z.string().min(1),
  baseHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  operations: z.array(DocumentOperationSchema).min(1),
}).strict().superRefine((plan, ctx) => {
  const ids = new Set<string>();
  for (let index = 0; index < plan.operations.length; index += 1) {
    const id = plan.operations[index]!.id;
    if (ids.has(id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operations', index, 'id'], message: `Duplicate operation id: ${id}` });
    }
    ids.add(id);
  }
});

export type SectionSelector = z.infer<typeof SectionSelectorSchema>;
export type DocumentOperation = z.infer<typeof DocumentOperationSchema>;
export type DocumentPlan = z.infer<typeof DocumentPlanSchema>;

export type DocumentOperationSummary = {
  id: string;
  type: DocumentOperation['type'];
  sectionId: string;
  range?: [number, number];
  insertionAt?: number;
  reason?: string;
};

export type DocumentPreview = {
  plan: DocumentPlan;
  inspection: MarkdownDocumentInspection;
  candidate: string;
  candidateHash: string;
  reviewToken: string;
  diff: string;
  operations: DocumentOperationSummary[];
};

export type DocumentApplyResult = {
  planId: string;
  targetPath: string;
  beforeHash: string;
  afterHash: string;
  reviewToken: string;
  operations: DocumentOperationSummary[];
};

type Replacement = {
  operationId: string;
  start: number;
  end: number;
  replacement: string;
  summary: DocumentOperationSummary;
  anchorSectionId?: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function canonicalPlan(plan: DocumentPlan): string {
  return JSON.stringify(canonicalize(plan));
}

function reviewToken(plan: DocumentPlan, source: string, candidate: string): string {
  const fingerprint = createHash('sha256')
    .update('demoweave-review-v1\0')
    .update(hashDocumentSource(source))
    .update('\0')
    .update(canonicalPlan(plan))
    .update('\0')
    .update(hashDocumentSource(candidate))
    .digest('hex');
  return `review-v1:${fingerprint}`;
}

function sectionMap(inspection: MarkdownDocumentInspection): Map<string, DocumentSection> {
  return new Map(inspection.sections.map((section) => [section.id, section]));
}

function requireSection(sections: Map<string, DocumentSection>, selector: SectionSelector, operationId: string): DocumentSection {
  const section = sections.get(selector.sectionId);
  if (!section) {
    throw new DocumentPatchError('SECTION_NOT_FOUND', `Operation ${operationId} references unknown section ${selector.sectionId}`);
  }
  return section;
}

function rangesOverlap(left: Replacement, right: Replacement): boolean {
  const leftPoint = left.start === left.end;
  const rightPoint = right.start === right.end;
  if (leftPoint && rightPoint) return left.start === right.start;
  if (leftPoint) return left.start > right.start && left.start < right.end;
  if (rightPoint) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

function sectionContainsPoint(section: DocumentSection, point: number): boolean {
  return point > section.start && point < section.end;
}

function validateOperationConflicts(
  inspection: MarkdownDocumentInspection,
  plan: DocumentPlan,
  replacements: Replacement[],
): void {
  for (let left = 0; left < replacements.length; left += 1) {
    for (let right = left + 1; right < replacements.length; right += 1) {
      const a = replacements[left]!;
      const b = replacements[right]!;
      if (rangesOverlap(a, b)) {
        throw new DocumentPatchError('OVERLAPPING_OPERATIONS', `Operations ${a.operationId} and ${b.operationId} overlap`);
      }
      if (a.anchorSectionId && b.summary.sectionId === a.anchorSectionId && b.start !== b.end) {
        throw new DocumentPatchError('CONFLICTING_ANCHOR', `Create operation ${a.operationId} anchors to section modified by ${b.operationId}`);
      }
      if (b.anchorSectionId && a.summary.sectionId === b.anchorSectionId && a.start !== a.end) {
        throw new DocumentPatchError('CONFLICTING_ANCHOR', `Create operation ${b.operationId} anchors to section modified by ${a.operationId}`);
      }
    }
  }

  const creates = plan.operations.filter((operation): operation is Extract<DocumentOperation, { type: 'create' }> => operation.type === 'create');
  const createKeys = new Map<string, string>();
  for (const create of creates) {
    const key = `${create.anchor.sectionId}\0${create.position}`;
    const previous = createKeys.get(key);
    if (previous) {
      throw new DocumentPatchError('CONFLICTING_ANCHOR', `Create operations ${previous} and ${create.id} use the same anchor and position`);
    }
    createKeys.set(key, create.id);
  }

  const preserved = plan.operations
    .filter((operation): operation is Extract<DocumentOperation, { type: 'preserve' }> => operation.type === 'preserve')
    .map((operation) => ({ operation, section: inspection.sections.find((section) => section.id === operation.selector.sectionId) }))
    .filter((entry): entry is { operation: Extract<DocumentOperation, { type: 'preserve' }>; section: DocumentSection } => Boolean(entry.section));

  for (const { operation, section } of preserved) {
    for (const replacement of replacements) {
      if (replacement.summary.sectionId === section.id && replacement.start !== replacement.end) {
        throw new DocumentPatchError('PRESERVE_CONFLICT', `Preserve operation ${operation.id} conflicts with ${replacement.operationId}`);
      }
      if (replacement.start === replacement.end) {
        if (sectionContainsPoint(section, replacement.start)) {
          throw new DocumentPatchError('PRESERVE_CONFLICT', `Create operation ${replacement.operationId} would alter preserved section ${section.id}`);
        }
      } else if (replacement.start < section.end && section.start < replacement.end) {
        throw new DocumentPatchError('PRESERVE_CONFLICT', `Operation ${replacement.operationId} overlaps preserved section ${section.id}`);
      }
    }
  }
}

function buildReplacements(inspection: MarkdownDocumentInspection, plan: DocumentPlan): Replacement[] {
  const sections = sectionMap(inspection);
  const replacements: Replacement[] = [];

  for (const operation of plan.operations) {
    if (operation.type === 'preserve') {
      requireSection(sections, operation.selector, operation.id);
      continue;
    }
    if (operation.type === 'edit') {
      const section = requireSection(sections, operation.selector, operation.id);
      replacements.push({
        operationId: operation.id,
        start: section.bodyStart,
        end: section.end,
        replacement: operation.markdown,
        summary: { id: operation.id, type: operation.type, sectionId: section.id, range: [section.bodyStart, section.end] },
      });
      continue;
    }
    if (operation.type === 'replace') {
      const section = requireSection(sections, operation.selector, operation.id);
      replacements.push({
        operationId: operation.id,
        start: section.start,
        end: section.end,
        replacement: operation.markdown,
        summary: { id: operation.id, type: operation.type, sectionId: section.id, range: [section.start, section.end] },
      });
      continue;
    }
    if (operation.type === 'remove') {
      const section = requireSection(sections, operation.selector, operation.id);
      replacements.push({
        operationId: operation.id,
        start: section.start,
        end: section.end,
        replacement: '',
        summary: { id: operation.id, type: operation.type, sectionId: section.id, range: [section.start, section.end], reason: operation.reason },
      });
      continue;
    }
    const anchor = requireSection(sections, operation.anchor, operation.id);
    const insertionAt = operation.position === 'before' ? anchor.start : anchor.end;
    replacements.push({
      operationId: operation.id,
      start: insertionAt,
      end: insertionAt,
      replacement: operation.markdown,
      anchorSectionId: anchor.id,
      summary: { id: operation.id, type: operation.type, sectionId: anchor.id, insertionAt },
    });
  }

  validateOperationConflicts(inspection, plan, replacements);
  return replacements;
}

function applyReplacements(source: string, replacements: Replacement[]): string {
  let candidate = source;
  const ordered = [...replacements].sort((left, right) => right.start - left.start || right.end - left.end || right.operationId.localeCompare(left.operationId));
  for (const replacement of ordered) {
    candidate = candidate.slice(0, replacement.start) + replacement.replacement + candidate.slice(replacement.end);
  }
  return candidate;
}

type DiffEntry = { kind: 'same' | 'add' | 'remove'; text: string };

function normalizedLines(source: string): string[] {
  if (!source.length) return [];
  const lines = source.split(/\r\n|\n|\r/);
  if (/(?:\r\n|\n|\r)$/.test(source)) lines.pop();
  return lines;
}

function diffEntries(before: string[], after: string[]): DiffEntry[] {
  const product = before.length * after.length;
  if (product > 4_000_000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    return [
      ...before.slice(0, prefix).map((text) => ({ kind: 'same' as const, text })),
      ...before.slice(prefix, before.length - suffix).map((text) => ({ kind: 'remove' as const, text })),
      ...after.slice(prefix, after.length - suffix).map((text) => ({ kind: 'add' as const, text })),
      ...before.slice(before.length - suffix).map((text) => ({ kind: 'same' as const, text })),
    ];
  }

  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = new Uint32Array(rows * cols);
  const at = (row: number, col: number) => row * cols + col;
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let col = after.length - 1; col >= 0; col -= 1) {
      table[at(row, col)] = before[row] === after[col]
        ? table[at(row + 1, col + 1)]! + 1
        : Math.max(table[at(row + 1, col)]!, table[at(row, col + 1)]!);
    }
  }

  const entries: DiffEntry[] = [];
  let row = 0;
  let col = 0;
  while (row < before.length || col < after.length) {
    if (row < before.length && col < after.length && before[row] === after[col]) {
      entries.push({ kind: 'same', text: before[row]! });
      row += 1;
      col += 1;
    } else if (col < after.length && (row >= before.length || table[at(row, col + 1)]! >= table[at(row + 1, col)]!)) {
      entries.push({ kind: 'add', text: after[col]! });
      col += 1;
    } else {
      entries.push({ kind: 'remove', text: before[row]! });
      row += 1;
    }
  }
  return entries;
}

export function createUnifiedDiff(targetPath: string, beforeSource: string, afterSource: string): string {
  if (beforeSource === afterSource) return `--- a/${targetPath}\n+++ b/${targetPath}\n`;
  const entries = diffEntries(normalizedLines(beforeSource), normalizedLines(afterSource));
  const changed = entries.map((entry, index) => entry.kind === 'same' ? -1 : index).filter((index) => index >= 0);
  const first = Math.max(0, (changed[0] ?? 0) - 3);
  const last = Math.min(entries.length, (changed.at(-1) ?? entries.length - 1) + 4);

  let oldLine = 1;
  let newLine = 1;
  for (let index = 0; index < first; index += 1) {
    const entry = entries[index]!;
    if (entry.kind !== 'add') oldLine += 1;
    if (entry.kind !== 'remove') newLine += 1;
  }
  const hunk = entries.slice(first, last);
  const oldCount = hunk.filter((entry) => entry.kind !== 'add').length;
  const newCount = hunk.filter((entry) => entry.kind !== 'remove').length;
  const body = hunk.map((entry) => `${entry.kind === 'same' ? ' ' : entry.kind === 'add' ? '+' : '-'}${entry.text}`).join('\n');
  return `--- a/${targetPath}\n+++ b/${targetPath}\n@@ -${oldLine},${oldCount} +${newLine},${newCount} @@\n${body}\n`;
}

async function readPlan(projectRoot: string, planPath: string): Promise<{ plan: DocumentPlan; absolutePath: string }> {
  const absolutePath = await resolveProjectFile(projectRoot, planPath, { mustExist: true, rejectSymlink: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new DocumentPatchError('PLAN_UNREADABLE', `Could not read plan ${planPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = DocumentPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new DocumentPatchError('INVALID_PLAN', `DocumentPlan is invalid: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return { plan: result.data, absolutePath };
}

async function previewLoadedPlan(projectRoot: string, plan: DocumentPlan): Promise<DocumentPreview> {
  if (!/\.(?:md|markdown)$/i.test(plan.targetPath)) {
    throw new DocumentPatchError('NOT_MARKDOWN', `DocumentPlan target must end in .md or .markdown: ${plan.targetPath}`);
  }
  const target = await resolveProjectFile(projectRoot, plan.targetPath, { mustExist: true, rejectSymlink: true });
  const source = await fs.readFile(target, 'utf8');
  const inspection = inspectMarkdownSource(plan.targetPath.replaceAll(path.sep, '/'), source);
  if (inspection.baseHash !== plan.baseHash) {
    throw new DocumentPatchError('STALE_BASE', `Target hash changed: plan expects ${plan.baseHash}, current target is ${inspection.baseHash}`);
  }
  const replacements = buildReplacements(inspection, plan);
  const candidate = applyReplacements(source, replacements);
  return {
    plan,
    inspection,
    candidate,
    candidateHash: hashDocumentSource(candidate),
    reviewToken: reviewToken(plan, source, candidate),
    diff: createUnifiedDiff(inspection.targetPath, source, candidate),
    operations: replacements.map((replacement) => replacement.summary),
  };
}

export async function previewDocumentPlan(projectRoot: string, planPath: string): Promise<DocumentPreview> {
  const { plan } = await readPlan(projectRoot, planPath);
  return previewLoadedPlan(projectRoot, plan);
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function applyDocumentPlan(projectRoot: string, planPath: string, suppliedReviewToken: string): Promise<DocumentApplyResult> {
  if (!suppliedReviewToken) throw new DocumentPatchError('REVIEW_REQUIRED', 'Apply requires the review token emitted by preview');
  const { plan } = await readPlan(projectRoot, planPath);
  const preview = await previewLoadedPlan(projectRoot, plan);
  if (preview.reviewToken !== suppliedReviewToken) {
    throw new DocumentPatchError('REVIEW_MISMATCH', 'Review token does not match the current target, normalized plan, and candidate output');
  }
  const target = await resolveProjectFile(projectRoot, plan.targetPath, { mustExist: true, rejectSymlink: true });
  const sourceImmediatelyBeforeWrite = await fs.readFile(target, 'utf8');
  if (hashDocumentSource(sourceImmediatelyBeforeWrite) !== plan.baseHash) {
    throw new DocumentPatchError('STALE_BASE', 'Target changed after preview validation; refusing atomic apply');
  }
  await writeAtomic(target, preview.candidate);
  return {
    planId: plan.id,
    targetPath: plan.targetPath,
    beforeHash: plan.baseHash,
    afterHash: preview.candidateHash,
    reviewToken: preview.reviewToken,
    operations: preview.operations,
  };
}

export async function discardDocumentPlan(projectRoot: string, planPath: string): Promise<void> {
  const { absolutePath } = await readPlan(projectRoot, planPath);
  await fs.rm(absolutePath);
}

export async function validateDocumentPlanFile(projectRoot: string, planPath: string): Promise<DocumentPlan> {
  return (await readPlan(projectRoot, planPath)).plan;
}
