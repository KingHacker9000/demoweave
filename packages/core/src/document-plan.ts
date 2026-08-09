import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import { z } from 'zod';

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/, 'Expected a sha256:<hex> content hash');
const IdentifierSchema = z.string().trim().min(1);

export const SectionSelectorSchema = z.object({ sectionId: z.string().min(1) }).strict();

export const DocumentAnchorSchema = z.union([
  SectionSelectorSchema,
  z.object({ kind: z.enum(['document-start', 'document-end']) }).strict(),
]);

export const PreserveDocumentOperationSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('preserve'),
  selector: SectionSelectorSchema,
}).strict();

export const EditDocumentOperationSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('edit'),
  selector: SectionSelectorSchema,
  markdown: z.string(),
}).strict();

export const ReplaceDocumentOperationSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('replace'),
  selector: SectionSelectorSchema,
  markdown: z.string().min(1),
}).strict();

const SectionCreateOperationSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('create'),
  anchor: SectionSelectorSchema,
  position: z.enum(['before', 'after']),
  markdown: z.string().min(1),
}).strict();

const BoundaryCreateOperationSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('create'),
  anchor: z.object({ kind: z.enum(['document-start', 'document-end']) }).strict(),
  markdown: z.string().min(1),
}).strict();

export const CreateDocumentOperationSchema = z.union([SectionCreateOperationSchema, BoundaryCreateOperationSchema]);

export const RemoveDocumentOperationSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('remove'),
  selector: SectionSelectorSchema,
  reason: z.string().trim().min(1),
}).strict();

export const DocumentOperationSchema = z.union([
  PreserveDocumentOperationSchema,
  EditDocumentOperationSchema,
  ReplaceDocumentOperationSchema,
  CreateDocumentOperationSchema,
  RemoveDocumentOperationSchema,
]);

export const DocumentPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: IdentifierSchema,
  targetPath: z.string().min(1),
  baseHash: HashSchema,
  operations: z.array(DocumentOperationSchema).min(1),
}).strict().superRefine((plan, context) => {
  const ids = new Set<string>();
  for (const [index, operation] of plan.operations.entries()) {
    if (ids.has(operation.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['operations', index, 'id'],
        message: `Duplicate operation id: ${operation.id}`,
      });
    }
    ids.add(operation.id);
  }
  const unsafe = projectRelativePathIssue(plan.targetPath);
  if (unsafe) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetPath'],
      message: unsafe,
    });
  }
});

export type DocumentAnchor = z.infer<typeof DocumentAnchorSchema>;
export type SectionSelector = z.infer<typeof SectionSelectorSchema>;
export type DocumentOperation = z.infer<typeof DocumentOperationSchema>;
export type DocumentPlan = z.infer<typeof DocumentPlanSchema>;

export type SourcePoint = {
  offset: number;
  line: number;
  column: number;
};

export type SourceRange = {
  start: SourcePoint;
  end: SourcePoint;
};

export const DocumentNewlineSchema = z.enum(['lf', 'crlf', 'cr', 'mixed', 'none']);

const SourcePointSchema = z.object({
  offset: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).strict();

const SourceRangeSchema = z.object({ start: SourcePointSchema, end: SourcePointSchema }).strict();

export const DocumentSectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['preamble', 'section']),
  level: z.number().int().min(0).max(6),
  heading: z.string().nullable(),
  headingPath: z.array(z.string()),
  parentId: z.string().nullable(),
  headingRange: SourceRangeSchema.nullable(),
  directBodyRange: SourceRangeSchema,
  subtreeRange: SourceRangeSchema,
  occurrence: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  headingStart: z.number().int().nonnegative().nullable(),
  headingEnd: z.number().int().nonnegative().nullable(),
  bodyStart: z.number().int().nonnegative(),
  directBodyEnd: z.number().int().nonnegative(),
}).strict();

export const MarkdownDocumentInspectionSchema = z.object({
  schemaVersion: z.literal(1),
  targetPath: z.string().min(1),
  baseHash: HashSchema,
  newline: DocumentNewlineSchema,
  trailingNewline: z.boolean(),
  length: z.number().int().nonnegative(),
  sections: z.array(DocumentSectionSchema).min(1),
}).strict();

export type MarkdownSection = {
  id: string;
  kind: 'preamble' | 'section';
  level: number;
  heading: string | null;
  headingPath: string[];
  parentId: string | null;
  headingRange: SourceRange | null;
  directBodyRange: SourceRange;
  subtreeRange: SourceRange;
  occurrence: number;
  start: number;
  end: number;
  headingStart: number | null;
  headingEnd: number | null;
  bodyStart: number;
  directBodyEnd: number;
};

export type MarkdownInspection = {
  schemaVersion: 1;
  targetPath: string;
  baseHash: string;
  newline: 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';
  trailingNewline: boolean;
  length: number;
  sections: MarkdownSection[];
};
export type MarkdownDocumentInspection = MarkdownInspection;
export type DocumentSection = MarkdownSection;
export type DocumentNewline = z.infer<typeof DocumentNewlineSchema>;

export type DocumentOperationSummary = {
  id: string;
  type: DocumentOperation['type'];
  description: string;
  changed: boolean;
};

export type DocumentPreview = {
  plan: DocumentPlan;
  inspection: MarkdownInspection;
  operations: DocumentOperationSummary[];
  candidate: string;
  candidateHash: string;
  unifiedDiff: string;
  reviewToken: string;
};

export type DocumentApplyResult = Omit<DocumentPreview, 'candidate'> & {
  changed: boolean;
};

export type DocumentPlanIssue = {
  path?: string;
  operationId?: string;
  message: string;
};

export class DocumentPlanError extends Error {
  readonly code: string;
  readonly issues: DocumentPlanIssue[];

  constructor(code: string, message: string, issues: DocumentPlanIssue[] = []) {
    super(message);
    this.name = 'DocumentPlanError';
    this.code = code;
    this.issues = issues;
  }
}

export const DocumentPatchError = DocumentPlanError;

type HeadingNode = {
  type: 'heading';
  depth: number;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
};

type HeadingRecord = {
  node: HeadingNode;
  text: string;
  start: number;
  headingEnd: number;
  bodyStart: number;
  subtreeEnd: number;
  directBodyEnd: number;
  id: string;
  parentId: string | null;
  headingPath: string[];
  occurrence: number;
};

type Patch = {
  start: number;
  end: number;
  text: string;
  operation: DocumentOperation;
};

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function hashDocumentSource(source: string): string {
  return sha256(source);
}

function projectRelativePathIssue(input: string): string | undefined {
  if (!input.trim()) return 'Path must not be empty';
  if (input.includes('\0')) return 'Path must not contain a null byte';
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) return 'Absolute paths are not allowed';
  const portable = input.replaceAll('\\', '/');
  if (/^[a-zA-Z]:/.test(portable) || portable.startsWith('//')) return 'Absolute paths are not allowed';
  const normalized = path.posix.normalize(portable);
  if (normalized === '..' || normalized.startsWith('../')) return 'Path traversal outside the project is not allowed';
  if (normalized === '.') return 'Path must identify a file';
  return undefined;
}

export function normalizeProjectRelativePath(input: string): string {
  const issue = projectRelativePathIssue(input);
  if (issue) throw new DocumentPlanError('UNSAFE_PROJECT_PATH', issue, [{ path: input, message: issue }]);
  return path.posix.normalize(input.replaceAll('\\', '/')).replace(/^\.\//, '');
}

function normalizeParsedPlan(plan: DocumentPlan): DocumentPlan {
  return {
    ...plan,
    targetPath: normalizeProjectRelativePath(plan.targetPath),
    operations: plan.operations.map((operation) => ({ ...operation })) as DocumentOperation[],
  };
}

export function parseDocumentPlan(input: unknown): DocumentPlan {
  if (input && typeof input === 'object' && 'schemaVersion' in input && (input as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new DocumentPlanError('UNSUPPORTED_DOCUMENT_PLAN_VERSION', 'Only DocumentPlan schemaVersion 1 is supported');
  }
  const result = DocumentPlanSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new DocumentPlanError('INVALID_DOCUMENT_PLAN', 'DocumentPlan v1 validation failed', issues);
  }
  return normalizeParsedPlan(result.data);
}

function newlineStyle(source: string): MarkdownInspection['newline'] {
  let lf = 0;
  let crlf = 0;
  let loneCr = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\r') {
      if (source[index + 1] === '\n') {
        crlf += 1;
        index += 1;
      } else {
        loneCr += 1;
      }
    } else if (source[index] === '\n') {
      lf += 1;
    }
  }
  if (!lf && !crlf && !loneCr) return 'none';
  if (crlf && !lf && !loneCr) return 'crlf';
  if (lf && !crlf && !loneCr) return 'lf';
  if (loneCr && !crlf && !lf) return 'cr';
  return 'mixed';
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function pointAt(starts: number[], offset: number): SourcePoint {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = starts[middle] ?? 0;
    if (value <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return { offset, line: lineIndex + 1, column: offset - (starts[lineIndex] ?? 0) + 1 };
}

function rangeAt(starts: number[], start: number, end: number): SourceRange {
  return { start: pointAt(starts, start), end: pointAt(starts, end) };
}

function afterLineEnding(source: string, offset: number): number {
  if (source.startsWith('\r\n', offset)) return offset + 2;
  if (source[offset] === '\n' || source[offset] === '\r') return offset + 1;
  return offset;
}

function normalizedHeadingSlug(text: string): string {
  const identity = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, '-');
  const slug = identity
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `heading-${createHash('sha256').update(identity || text).digest('hex').slice(0, 8)}`;
}

export function inspectMarkdown(source: string, target: string): MarkdownInspection {
  const normalizedTarget = normalizeProjectRelativePath(target);
  const tree = fromMarkdown(source);
  const nodes = tree.children.filter((node): node is typeof node & HeadingNode => node.type === 'heading');
  const records: HeadingRecord[] = nodes.map((node) => {
    const start = node.position?.start.offset;
    const headingEnd = node.position?.end.offset;
    if (start === undefined || headingEnd === undefined) {
      throw new DocumentPlanError('MARKDOWN_POSITION_UNAVAILABLE', 'Markdown parser did not provide source offsets');
    }
    return {
      node,
      text: toString(node),
      start,
      headingEnd,
      bodyStart: afterLineEnding(source, headingEnd),
      subtreeEnd: source.length,
      directBodyEnd: source.length,
      id: '',
      parentId: null,
      headingPath: [],
      occurrence: 1,
    };
  });

  const stack: HeadingRecord[] = [];
  const occurrences = new Map<string, number>();
  for (const record of records) {
    while (stack.length && (stack.at(-1)?.node.depth ?? 0) >= record.node.depth) stack.pop();
    const parent = stack.at(-1);
    const slug = normalizedHeadingSlug(record.text);
    const occurrenceKey = `${parent?.id ?? 'document'}\0${record.node.depth}\0${slug}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const segment = occurrence === 1 ? slug : `${slug}~${occurrence}`;
    record.id = `section:${[...(parent?.id.slice('section:'.length).split('/') ?? []), segment].filter(Boolean).join('/')}`;
    record.parentId = parent?.id ?? null;
    record.headingPath = [...(parent?.headingPath ?? []), record.text];
    record.occurrence = occurrence;
    stack.push(record);
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    for (let nextIndex = index + 1; nextIndex < records.length; nextIndex += 1) {
      const next = records[nextIndex]!;
      if (record.directBodyEnd === source.length && next.node.depth > record.node.depth) {
        record.directBodyEnd = next.start;
      }
      if (next.node.depth <= record.node.depth) {
        record.subtreeEnd = next.start;
        break;
      }
    }
    if (record.directBodyEnd === source.length) record.directBodyEnd = record.subtreeEnd;
  }

  const starts = lineStarts(source);
  const firstHeadingStart = records[0]?.start ?? source.length;
  const sections: MarkdownSection[] = [{
    id: 'preamble',
    kind: 'preamble',
    level: 0,
    heading: null,
    headingPath: [],
    parentId: null,
    headingRange: null,
    directBodyRange: rangeAt(starts, 0, firstHeadingStart),
    subtreeRange: rangeAt(starts, 0, firstHeadingStart),
    occurrence: 1,
    start: 0,
    end: firstHeadingStart,
    headingStart: null,
    headingEnd: null,
    bodyStart: 0,
    directBodyEnd: firstHeadingStart,
  }];
  for (const record of records) {
    sections.push({
      id: record.id,
      kind: 'section',
      level: record.node.depth,
      heading: record.text,
      headingPath: record.headingPath,
      parentId: record.parentId,
      headingRange: rangeAt(starts, record.start, record.headingEnd),
      directBodyRange: rangeAt(starts, record.bodyStart, record.directBodyEnd),
      subtreeRange: rangeAt(starts, record.start, record.subtreeEnd),
      occurrence: record.occurrence,
      start: record.start,
      end: record.subtreeEnd,
      headingStart: record.start,
      headingEnd: record.headingEnd,
      bodyStart: record.bodyStart,
      directBodyEnd: record.directBodyEnd,
    });
  }

  return {
    schemaVersion: 1,
    targetPath: normalizedTarget,
    baseHash: sha256(source),
    newline: newlineStyle(source),
    trailingNewline: source.endsWith('\n') || source.endsWith('\r'),
    length: source.length,
    sections,
  };
}

export function inspectMarkdownSource(targetPath: string, source: string): MarkdownInspection {
  return inspectMarkdown(source, targetPath);
}

function preferredNewline(inspection: MarkdownInspection): '\n' | '\r\n' {
  return inspection.newline === 'crlf' ? '\r\n' : '\n';
}

function normalizeInsertedMarkdown(markdown: string, inspection: MarkdownInspection): string {
  return markdown.replace(/\r\n|\r|\n/g, preferredNewline(inspection));
}

function overlaps(left: Patch, right: Patch): boolean {
  if (left.start === left.end && right.start === right.end) return left.start === right.start;
  if (left.start === left.end) return left.start > right.start && left.start < right.end;
  if (right.start === right.end) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

function patchTouchesRange(patch: Patch, range: SourceRange): boolean {
  const start = range.start.offset;
  const end = range.end.offset;
  if (patch.start === patch.end) return patch.start > start && patch.start < end;
  return patch.start < end && start < patch.end;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function canonicalDocumentPlan(plan: DocumentPlan): string {
  return JSON.stringify(canonicalValue(normalizeParsedPlan(plan)));
}

function operationDescription(operation: DocumentOperation, section?: MarkdownSection): string {
  if (operation.type === 'create') {
    if ('kind' in operation.anchor) return `create at ${operation.anchor.kind.replace('-', ' ')}`;
    return `create ${'position' in operation ? operation.position : ''} ${operation.anchor.sectionId}`;
  }
  const sectionId = operation.selector.sectionId;
  const label = section?.heading ?? section?.id ?? sectionId;
  return `${operation.type} ${label} (${sectionId})`;
}

function planCandidate(plan: DocumentPlan, source: string, inspection: MarkdownInspection): {
  candidate: string;
  operations: DocumentOperationSummary[];
} {
  if (plan.baseHash !== inspection.baseHash) {
    throw new DocumentPlanError('STALE_BASE', `Target hash ${inspection.baseHash} does not match plan baseHash ${plan.baseHash}`);
  }
  if (plan.targetPath !== inspection.targetPath) {
    throw new DocumentPlanError('DOCUMENT_PLAN_TARGET_MISMATCH', `Plan target ${plan.targetPath} does not match inspected target ${inspection.targetPath}`);
  }

  const sections = new Map(inspection.sections.map((section) => [section.id, section]));
  const patches: Patch[] = [];
  const preserves: Array<{ operation: DocumentOperation; section: MarkdownSection }> = [];
  const descriptions = new Map<string, string>();

  for (const operation of plan.operations) {
    if (operation.type === 'create') {
      let offset: number;
      if ('kind' in operation.anchor && operation.anchor.kind === 'document-start') offset = 0;
      else if ('kind' in operation.anchor && operation.anchor.kind === 'document-end') offset = source.length;
      else {
        const sectionId = 'sectionId' in operation.anchor ? operation.anchor.sectionId : '';
        const anchor = sections.get(sectionId);
        if (!anchor) {
          throw new DocumentPlanError('UNKNOWN_DOCUMENT_SECTION', `Unknown create anchor section: ${sectionId}`, [{
            operationId: operation.id,
            message: `Unknown section ${sectionId}`,
          }]);
        }
        offset = 'position' in operation && operation.position === 'before' ? anchor.subtreeRange.start.offset : anchor.subtreeRange.end.offset;
      }
      patches.push({ start: offset, end: offset, text: normalizeInsertedMarkdown(operation.markdown, inspection), operation });
      descriptions.set(operation.id, operationDescription(operation));
      continue;
    }

    const sectionId = operation.selector.sectionId;
    const section = sections.get(sectionId);
    if (!section) {
      throw new DocumentPlanError('UNKNOWN_DOCUMENT_SECTION', `Unknown document section: ${sectionId}`, [{
        operationId: operation.id,
        message: `Unknown section ${sectionId}`,
      }]);
    }
    descriptions.set(operation.id, operationDescription(operation, section));
    if (operation.type === 'preserve') {
      preserves.push({ operation, section });
      continue;
    }
    const range = operation.type === 'edit' ? section.directBodyRange : section.subtreeRange;
    const text = operation.type === 'remove' ? '' : normalizeInsertedMarkdown(operation.markdown, inspection);
    patches.push({ start: range.start.offset, end: range.end.offset, text, operation });
  }

  for (let leftIndex = 0; leftIndex < patches.length; leftIndex += 1) {
    const left = patches[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < patches.length; rightIndex += 1) {
      const right = patches[rightIndex]!;
      if (left.start === right.start || overlaps(left, right)) {
        throw new DocumentPlanError('DOCUMENT_PLAN_CONFLICT', `Operations ${left.operation.id} and ${right.operation.id} overlap or share an insertion boundary`, [
          { operationId: left.operation.id, message: `Conflicts with ${right.operation.id}` },
          { operationId: right.operation.id, message: `Conflicts with ${left.operation.id}` },
        ]);
      }
    }
  }

  for (const preserved of preserves) {
    for (const patch of patches) {
      if (patchTouchesRange(patch, preserved.section.subtreeRange)) {
        throw new DocumentPlanError('PRESERVED_SECTION_CONFLICT', `Operation ${patch.operation.id} overlaps preserved section ${preserved.section.id}`, [
          { operationId: preserved.operation.id, message: `Preserved section conflicts with ${patch.operation.id}` },
          { operationId: patch.operation.id, message: `Overlaps preserved section ${preserved.section.id}` },
        ]);
      }
    }
  }

  const changedIds = new Set(patches
    .filter((patch) => source.slice(patch.start, patch.end) !== patch.text)
    .map((patch) => patch.operation.id));
  let candidate = source;
  for (const patch of [...patches].sort((left, right) => right.start - left.start)) {
    candidate = `${candidate.slice(0, patch.start)}${patch.text}${candidate.slice(patch.end)}`;
  }
  return {
    candidate,
    operations: plan.operations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      description: descriptions.get(operation.id) ?? operation.type,
      changed: changedIds.has(operation.id),
    })),
  };
}

function reviewToken(plan: DocumentPlan, candidateHash: string): string {
  const binding = [
    'demoweave-document-review-v1',
    plan.baseHash,
    canonicalDocumentPlan(plan),
    candidateHash,
  ].join('\n');
  return `review-v1:${createHash('sha256').update(binding).digest('hex')}`;
}

export function previewDocument(planInput: DocumentPlan | unknown, source: string, target?: string): DocumentPreview {
  const plan = parseDocumentPlan(planInput);
  const inspection = inspectMarkdown(source, target ?? plan.targetPath);
  const result = planCandidate(plan, source, inspection);
  const candidateHash = sha256(result.candidate);
  const unifiedDiff = result.candidate === source
    ? '(no changes)\n'
    : createTwoFilesPatch(`a/${plan.targetPath}`, `b/${plan.targetPath}`, source, result.candidate, '', '', { context: 3 });
  return {
    plan,
    inspection,
    operations: result.operations,
    candidate: result.candidate,
    candidateHash,
    unifiedDiff,
    reviewToken: reviewToken(plan, candidateHash),
  };
}

export function createUnifiedDiff(targetPath: string, beforeSource: string, afterSource: string): string {
  return beforeSource === afterSource
    ? '(no changes)\n'
    : createTwoFilesPatch(`a/${targetPath}`, `b/${targetPath}`, beforeSource, afterSource, '', '', { context: 3 });
}

type ResolvedProjectFile = {
  projectRoot: string;
  relativePath: string;
  lexicalPath: string;
  realPath: string;
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveProjectRoot(projectRoot: string): Promise<string> {
  try {
    const resolved = await fs.realpath(path.resolve(projectRoot));
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('not a directory');
    return resolved;
  } catch (error) {
    throw new DocumentPlanError('PROJECT_ROOT_UNAVAILABLE', `Project root is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveExistingProjectFile(projectRoot: string, input: string, kind: 'target' | 'plan'): Promise<ResolvedProjectFile> {
  let relativePath: string;
  try {
    relativePath = normalizeProjectRelativePath(input);
  } catch (error) {
    if (error instanceof DocumentPlanError) {
      throw new DocumentPlanError(kind === 'target' ? 'UNSAFE_DOCUMENT_TARGET' : 'UNSAFE_PLAN_PATH', error.message, error.issues);
    }
    throw error;
  }
  const root = await resolveProjectRoot(projectRoot);
  const lexicalPath = path.resolve(root, ...relativePath.split('/'));
  if (!isInside(root, lexicalPath)) {
    throw new DocumentPlanError(kind === 'target' ? 'UNSAFE_DOCUMENT_TARGET' : 'UNSAFE_PLAN_PATH', `${kind} path escapes the project root`);
  }
  let realPath: string;
  try {
    realPath = await fs.realpath(lexicalPath);
  } catch (error) {
    throw new DocumentPlanError(kind === 'target' ? 'DOCUMENT_TARGET_NOT_FOUND' : 'DOCUMENT_PLAN_NOT_FOUND', `${kind} file is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isInside(root, realPath)) {
    throw new DocumentPlanError(kind === 'target' ? 'UNSAFE_DOCUMENT_TARGET' : 'UNSAFE_PLAN_PATH', `${kind} symlink escapes the project root`);
  }
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new DocumentPlanError(kind === 'target' ? 'DOCUMENT_TARGET_NOT_FOUND' : 'DOCUMENT_PLAN_NOT_FOUND', `${kind} path is not a file`);
  }
  return { projectRoot: root, relativePath, lexicalPath, realPath };
}

async function readUtf8(file: string, code: string): Promise<string> {
  const buffer = await fs.readFile(file);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new DocumentPlanError(code, 'File is not valid UTF-8');
  }
}

async function readPlanFile(projectRoot: string, planPath: string): Promise<{ file: ResolvedProjectFile; plan: DocumentPlan }> {
  const file = await resolveExistingProjectFile(projectRoot, planPath, 'plan');
  const text = await readUtf8(file.realPath, 'INVALID_DOCUMENT_PLAN');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new DocumentPlanError('INVALID_DOCUMENT_PLAN', `Plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { file, plan: parseDocumentPlan(input) };
}

function requireMarkdownPath(targetPath: string): void {
  if (!/\.(?:md|markdown)$/i.test(targetPath)) {
    throw new DocumentPlanError('NOT_MARKDOWN', `Markdown target must end in .md or .markdown: ${targetPath}`);
  }
}

export async function inspectMarkdownFile(projectRoot: string, targetPath: string): Promise<MarkdownInspection> {
  requireMarkdownPath(targetPath);
  const file = await resolveExistingProjectFile(projectRoot, targetPath, 'target');
  const source = await readUtf8(file.realPath, 'INVALID_MARKDOWN_ENCODING');
  return inspectMarkdown(source, file.relativePath);
}

export async function previewDocumentPlanFile(projectRoot: string, planPath: string): Promise<DocumentPreview> {
  const { file: planFile, plan } = await readPlanFile(projectRoot, planPath);
  requireMarkdownPath(plan.targetPath);
  const targetFile = await resolveExistingProjectFile(planFile.projectRoot, plan.targetPath, 'target');
  if (targetFile.realPath === planFile.realPath) {
    throw new DocumentPlanError('DOCUMENT_PLAN_TARGET_MISMATCH', 'A DocumentPlan cannot target its own plan file');
  }
  const source = await readUtf8(targetFile.realPath, 'INVALID_MARKDOWN_ENCODING');
  return previewDocument(plan, source, targetFile.relativePath);
}

function matchesReviewToken(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function atomicWrite(file: string, content: string, mode: number): Promise<void> {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: fs.FileHandle | undefined;
  try {
    const permissionBits = mode & 0o777;
    handle = await fs.open(temporary, 'wx', permissionBits);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.chmod(temporary, permissionBits);
    await fs.rename(temporary, file);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw new DocumentPlanError('ATOMIC_DOCUMENT_WRITE_FAILED', `Could not atomically update target: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function applyDocumentPlanFile(projectRoot: string, planPath: string, suppliedReviewToken: string): Promise<DocumentApplyResult> {
  if (!suppliedReviewToken) throw new DocumentPlanError('REVIEW_REQUIRED', 'Apply requires the review token emitted by preview');
  const { file: planFile, plan } = await readPlanFile(projectRoot, planPath);
  requireMarkdownPath(plan.targetPath);
  const targetFile = await resolveExistingProjectFile(planFile.projectRoot, plan.targetPath, 'target');
  const source = await readUtf8(targetFile.realPath, 'INVALID_MARKDOWN_ENCODING');
  const preview = previewDocument(plan, source, targetFile.relativePath);
  if (!matchesReviewToken(preview.reviewToken, suppliedReviewToken)) {
    throw new DocumentPlanError('REVIEW_MISMATCH', 'Supplied review token does not match the current plan and candidate');
  }

  const planAgain = await readPlanFile(planFile.projectRoot, planFile.relativePath);
  if (canonicalDocumentPlan(planAgain.plan) !== canonicalDocumentPlan(plan)) {
    throw new DocumentPlanError('REVIEW_MISMATCH', 'DocumentPlan changed while apply was in progress');
  }
  const sourceAgain = await readUtf8(targetFile.realPath, 'INVALID_MARKDOWN_ENCODING');
  if (sha256(sourceAgain) !== plan.baseHash) {
    throw new DocumentPlanError('STALE_BASE', 'Target changed while apply was in progress');
  }

  const changed = preview.candidate !== source;
  if (changed) {
    const stat = await fs.stat(targetFile.realPath);
    await atomicWrite(targetFile.realPath, preview.candidate, stat.mode);
  }
  const { candidate: _candidate, ...result } = preview;
  return { ...result, changed };
}

export async function discardDocumentPlanFile(projectRoot: string, planPath: string): Promise<string> {
  const file = await resolveExistingProjectFile(projectRoot, planPath, 'plan');
  await fs.unlink(file.lexicalPath);
  return file.relativePath;
}

export async function previewDocumentPlan(projectRoot: string, planPath: string): Promise<DocumentPreview> {
  return previewDocumentPlanFile(projectRoot, planPath);
}

export async function applyDocumentPlan(projectRoot: string, planPath: string, reviewTokenValue: string): Promise<DocumentApplyResult> {
  return applyDocumentPlanFile(projectRoot, planPath, reviewTokenValue);
}

export async function discardDocumentPlan(projectRoot: string, planPath: string): Promise<void> {
  await discardDocumentPlanFile(projectRoot, planPath);
}

export async function validateDocumentPlanFile(projectRoot: string, planPath: string): Promise<DocumentPlan> {
  return (await readPlanFile(projectRoot, planPath)).plan;
}

export async function resolveProjectFile(projectRoot: string, relativePath: string): Promise<string> {
  return (await resolveExistingProjectFile(projectRoot, relativePath, 'target')).realPath;
}
