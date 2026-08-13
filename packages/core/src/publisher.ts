import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { z } from 'zod';
import { ManifestSchema } from './manifest.js';

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const PortableIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a portable kebab-case id');
const EvidenceIdSchema = z.string().min(1);
const PortablePathSchema = z.string().min(1).superRefine((value, context) => {
  const issue = portablePathIssue(value);
  if (issue) context.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

export const PublisherPlanEntrySchema = z.object({
  source: PortablePathSchema,
  destination: PortablePathSchema,
}).strict();

export const PublisherPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: PortableIdSchema,
  publisher: z.string().min(1),
  targetRoot: PortablePathSchema,
  entries: z.array(PublisherPlanEntrySchema).min(1),
}).strict().superRefine((plan, context) => {
  const destinations = new Set<string>();
  for (const [index, entry] of plan.entries.entries()) {
    if (!/\.(?:md|markdown)$/i.test(entry.source)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries', index, 'source'],
        message: 'PublisherPlan sources must be Markdown files',
      });
    }
    const destination = normalizePortablePath(entry.destination);
    const key = destination.toLocaleLowerCase('en-US');
    if (destinations.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries', index, 'destination'],
        message: `Duplicate target destination: ${destination}`,
      });
    }
    destinations.add(key);
  }
});

export const PublicationSourceSchema = z.object({
  path: PortablePathSchema,
  hash: HashSchema,
  kind: z.enum(['document', 'dependency']),
  evidenceIds: z.array(EvidenceIdSchema).min(1).optional(),
}).strict();

export const PublishedFileSchema = z.object({
  path: PortablePathSchema,
  hash: HashSchema,
  sourcePath: PortablePathSchema,
  kind: z.enum(['document', 'dependency']),
}).strict();

export const PublicationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PortableIdSchema,
  publisher: z.string().min(1),
  planHash: HashSchema,
  targetRoot: PortablePathSchema,
  publishedFiles: z.array(PublishedFileSchema),
  sources: z.array(PublicationSourceSchema),
}).strict();

export const PublicationStatusStateSchema = z.enum([
  'fresh',
  'stale',
  'drifted',
  'missing',
  'unpublished',
  'unknown',
]);

export const PublicationStatusReasonCodeSchema = z.enum([
  'manifest-missing',
  'manifest-invalid',
  'plan-changed',
  'source-missing',
  'source-changed',
  'source-unsafe',
  'dependency-missing',
  'dependency-changed',
  'dependency-unsafe',
  'target-missing',
  'target-changed',
  'target-unsafe',
]);

export const PublicationStatusReasonSchema = z.object({
  code: PublicationStatusReasonCodeSchema,
  message: z.string().min(1),
  path: PortablePathSchema.optional(),
  expectedHash: HashSchema.optional(),
  actualHash: HashSchema.optional(),
}).strict();

export const PublicationStatusSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PortableIdSchema,
  state: PublicationStatusStateSchema,
  reasons: z.array(PublicationStatusReasonSchema),
}).strict();

export type PublisherPlan = z.infer<typeof PublisherPlanSchema>;
export type PublisherPlanEntry = z.infer<typeof PublisherPlanEntrySchema>;
export type PublicationManifest = z.infer<typeof PublicationManifestSchema>;
export type PublishedFile = z.infer<typeof PublishedFileSchema>;
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;
export type PublicationStatusReason = z.infer<typeof PublicationStatusReasonSchema>;

export type PublicationFileAction = 'create' | 'update' | 'unchanged';

export type PublicationPreviewFile = {
  path: string;
  sourcePath: string;
  kind: 'document' | 'dependency';
  action: PublicationFileAction;
  hash: string;
};

export type PublicationConflict = {
  code: 'unmanaged-target' | 'target-drift' | 'destination-collision' | 'invalid-baseline';
  path: string;
  message: string;
};

export type PublicationDependency = {
  sourcePath: string;
  destinationPath: string;
  hash: string;
  evidenceIds?: string[];
};

export type PublicationDiff = { path: string; unifiedDiff: string };

export type PublicationPreview = {
  schemaVersion: 1;
  planId: string;
  publisher: string;
  planHash: string;
  targetRoot: string;
  files: PublicationPreviewFile[];
  create: string[];
  update: string[];
  unchanged: string[];
  copiedDependencies: PublicationDependency[];
  conflicts: PublicationConflict[];
  unresolvedDependencies: PublicationIssue[];
  candidateHashes: Array<{ path: string; hash: string }>;
  diffs: PublicationDiff[];
  reviewToken: string;
};

export type PublicationApplyResult = {
  planId: string;
  publisher: string;
  targetRoot: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  writes: number;
  manifestPath: string;
  manifestChanged: boolean;
};

export type PublicationIssue = {
  code: string;
  message: string;
  sourcePath?: string;
  reference?: string;
  path?: string;
};

export class PublisherError extends Error {
  constructor(readonly code: string, message: string, readonly issues: PublicationIssue[] = []) {
    super(message);
    this.name = 'PublisherError';
  }
}

type Candidate = {
  relativePath: string;
  sourcePath: string;
  kind: 'document' | 'dependency';
  bytes: Buffer;
  hash: string;
  evidenceIds?: string[];
};

type TargetBaseline = { path: string; exists: boolean; hash?: string };

type PreviewBuild = {
  preview: PublicationPreview;
  plan: PublisherPlan;
  projectRoot: string;
  targetRootPath: string;
  candidates: Candidate[];
  manifest: PublicationManifest;
  manifestPath: string;
  targetBaselines: TargetBaseline[];
};

type MarkdownNode = {
  type: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

type LinkReference = { url: string; start: number; end: number; kind: 'link' | 'image' | 'html' };
type Rewrite = { start: number; end: number; text: string };

export interface PublisherAdapter {
  readonly id: string;
  build(context: PublisherAdapterContext): Promise<Candidate[]>;
}

export type PublisherAdapterContext = {
  projectRoot: string;
  plan: PublisherPlan;
  evidenceByPath: ReadonlyMap<string, string[]>;
};

function sha256(value: Buffer | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => comparePortable(left, right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function comparePortable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function portablePathIssue(value: string): string | undefined {
  if (!value.trim()) return 'Path must not be empty';
  if (value.includes('\0')) return 'Path must not contain a null byte';
  if (value.includes('\\')) return 'Paths must use portable POSIX separators';
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) {
    return 'Absolute paths are not allowed';
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) return 'Path traversal outside the project is not allowed';
  if (normalized === '.') return 'Path must identify a file or directory';
  return undefined;
}

function normalizePortablePath(value: string): string {
  return path.posix.normalize(value).replace(/^\.\//, '');
}

function inside(root: string, target: string): boolean {
  const relation = path.relative(root, target);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function canonicalProjectRoot(projectRoot: string): Promise<string> {
  try {
    const root = await fs.realpath(path.resolve(projectRoot));
    if (!(await fs.stat(root)).isDirectory()) throw new Error('not a directory');
    return root;
  } catch (error) {
    throw new PublisherError('PROJECT_ROOT_UNAVAILABLE', `Project root is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveExistingProjectFile(root: string, relativePath: string, code: string): Promise<string> {
  const issue = portablePathIssue(relativePath);
  if (issue) throw new PublisherError(code, `${relativePath}: ${issue}`, [{ code, path: relativePath, message: issue }]);
  const lexical = path.resolve(root, ...normalizePortablePath(relativePath).split('/'));
  if (!inside(root, lexical)) throw new PublisherError(code, `Path escapes the project root: ${relativePath}`);
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    throw new PublisherError(code, `File does not exist: ${relativePath}`, [{ code, path: relativePath, message: 'File does not exist' }]);
  }
  if (!inside(root, real)) throw new PublisherError(code, `Symlink escapes the project root: ${relativePath}`);
  if (!(await fs.stat(real)).isFile()) throw new PublisherError(code, `Path is not a file: ${relativePath}`);
  return real;
}

async function resolveSafeOutput(root: string, relativePath: string, code: string): Promise<string> {
  const issue = portablePathIssue(relativePath);
  if (issue) throw new PublisherError(code, `${relativePath}: ${issue}`);
  const target = path.resolve(root, ...normalizePortablePath(relativePath).split('/'));
  if (!inside(root, target)) throw new PublisherError(code, `Path escapes the project root: ${relativePath}`);
  let ancestor = target;
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const realAncestor = await fs.realpath(ancestor);
  if (!inside(root, realAncestor)) throw new PublisherError(code, `Path resolves through a symlink outside the project: ${relativePath}`);
  if (await exists(target)) {
    const realTarget = await fs.realpath(target);
    if (!inside(root, realTarget)) throw new PublisherError(code, `Path resolves outside the project: ${relativePath}`);
  }
  return target;
}

function normalizePlan(plan: PublisherPlan): PublisherPlan {
  return {
    ...plan,
    targetRoot: normalizePortablePath(plan.targetRoot),
    entries: plan.entries.map((entry) => ({
      source: normalizePortablePath(entry.source),
      destination: normalizePortablePath(entry.destination),
    })),
  };
}

export function parsePublisherPlan(input: unknown): PublisherPlan {
  if (input && typeof input === 'object' && 'schemaVersion' in input && (input as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new PublisherError('UNSUPPORTED_PUBLISHER_PLAN_VERSION', 'Only PublisherPlan schemaVersion 1 is supported');
  }
  const result = PublisherPlanSchema.safeParse(input);
  if (!result.success) {
    throw new PublisherError('INVALID_PUBLISHER_PLAN', 'PublisherPlan v1 validation failed', result.error.issues.map((issue) => ({
      code: 'INVALID_PUBLISHER_PLAN',
      path: issue.path.join('.'),
      message: issue.message,
    })));
  }
  return normalizePlan(result.data);
}

export function canonicalPublisherPlan(planInput: PublisherPlan | unknown): string {
  return canonicalJson(parsePublisherPlan(planInput));
}

async function readJsonFile(file: string, code: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new PublisherError(code, `Could not read valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolvePlan(root: string, reference: string): Promise<{ plan: PublisherPlan; path: string }> {
  let relativePath: string;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reference)) {
    relativePath = `.demoweave/publishers/${reference}.json`;
  } else {
    relativePath = reference;
  }
  const planPath = await resolveExistingProjectFile(root, relativePath, 'UNSAFE_PUBLISHER_PLAN_PATH');
  const plan = parsePublisherPlan(await readJsonFile(planPath, 'INVALID_PUBLISHER_PLAN'));
  const expected = `.demoweave/publishers/${plan.id}.json`;
  if (normalizePortablePath(relativePath) === expected || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reference)) return { plan, path: planPath };
  return { plan, path: planPath };
}

function splitLinkTarget(url: string): { pathname: string; suffix: string } {
  const marker = url.search(/[?#]/);
  return marker === -1 ? { pathname: url, suffix: '' } : { pathname: url.slice(0, marker), suffix: url.slice(marker) };
}

function remoteOrFragment(url: string): boolean {
  return url.startsWith('#') || url.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
}

function locateNodeUrl(source: string, node: MarkdownNode): { start: number; end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || node.url === undefined) return undefined;
  const slice = source.slice(start, end);
  const candidates: number[] = [];
  let cursor = 0;
  while (cursor <= slice.length) {
    const found = slice.indexOf(node.url, cursor);
    if (found === -1) break;
    candidates.push(found);
    cursor = found + Math.max(1, node.url.length);
  }
  const selected = candidates.find((offset) => {
    const before = slice[offset - 1] ?? '';
    const after = slice[offset + node.url!.length] ?? '';
    return ['(', '<', ':', ' ', '\t', '\n', '\r'].includes(before)
      && [')', '>', ' ', '\t', '\n', '\r', '"', "'", ''].includes(after);
  }) ?? candidates[0];
  return selected === undefined ? undefined : { start: start + selected, end: start + selected + node.url.length };
}

function collectMarkdownLinks(source: string): LinkReference[] {
  const tree = fromMarkdown(source) as MarkdownNode;
  const links: LinkReference[] = [];
  const visit = (node: MarkdownNode): void => {
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && node.url !== undefined) {
      const range = locateNodeUrl(source, node);
      if (range) links.push({ url: node.url, ...range, kind: node.type === 'image' ? 'image' : 'link' });
    }
    if (node.type === 'html') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const html = source.slice(start, end);
        const pattern = /<(img|a)\b[^>]*?\b(src|href)\s*=\s*(?:(["'])(.*?)\3|([^\s>]+))/gi;
        for (const match of html.matchAll(pattern)) {
          const value = match[4] ?? match[5];
          if (value === undefined || match.index === undefined) continue;
          const valueOffset = match[0].indexOf(value);
          links.push({
            url: value,
            start: start + match.index + valueOffset,
            end: start + match.index + valueOffset + value.length,
            kind: match[1]?.toLowerCase() === 'img' ? 'image' : 'html',
          });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return links.sort((left, right) => left.start - right.start || left.end - right.end);
}

async function evidenceIndex(root: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  if (!(await exists(manifestPath))) return result;
  try {
    const manifest = ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
    for (const item of manifest.evidence) {
      if (!item.path) continue;
      const portable = normalizePortablePath(item.path.replaceAll('\\', '/'));
      result.set(portable, [...(result.get(portable) ?? []), item.id].sort());
    }
  } catch {
    // Evidence IDs are optional. An invalid Evidence manifest is handled by normal validation.
  }
  return result;
}

async function resolveDependency(root: string, sourcePath: string, rawPath: string): Promise<{ path: string; file: string }> {
  if (rawPath.includes('\\') || path.win32.isAbsolute(rawPath) || path.posix.isAbsolute(rawPath)) {
    throw new PublisherError('UNSAFE_PUBLICATION_DEPENDENCY', `Unsafe local dependency from ${sourcePath}: ${rawPath}`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new PublisherError('INVALID_PUBLICATION_LINK', `Invalid URL encoding in ${sourcePath}: ${rawPath}`);
  }
  const dependencyPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), decoded));
  const issue = portablePathIssue(dependencyPath);
  if (issue) throw new PublisherError('UNSAFE_PUBLICATION_DEPENDENCY', `${sourcePath} -> ${rawPath}: ${issue}`);
  const file = await resolveExistingProjectFile(root, dependencyPath, 'UNRESOLVED_PUBLICATION_DEPENDENCY');
  return { path: dependencyPath, file };
}

function targetLink(fromDestination: string, toDestination: string, suffix: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromDestination), toDestination) || path.posix.basename(toDestination);
  return `${relative}${suffix}`;
}

function applyRewrites(source: string, rewrites: Rewrite[]): string {
  let candidate = source;
  for (const rewrite of [...rewrites].sort((left, right) => right.start - left.start)) {
    candidate = `${candidate.slice(0, rewrite.start)}${rewrite.text}${candidate.slice(rewrite.end)}`;
  }
  return candidate;
}

class MarkdownPublisherAdapter implements PublisherAdapter {
  readonly id = 'markdown';

  async build(context: PublisherAdapterContext): Promise<Candidate[]> {
    const entriesBySource = new Map(context.plan.entries.map((entry) => [entry.source, entry]));
    const candidates = new Map<string, Candidate>();
    const dependencies = new Map<string, { file: string; destination: string }>();
    const issues: PublicationIssue[] = [];

    for (const entry of context.plan.entries) {
      let file: string;
      try {
        file = await resolveExistingProjectFile(context.projectRoot, entry.source, 'UNRESOLVED_PUBLICATION_SOURCE');
      } catch (error) {
        if (error instanceof PublisherError) {
          issues.push({ code: error.code, sourcePath: entry.source, message: error.message });
          continue;
        }
        throw error;
      }
      const bytes = await fs.readFile(file);
      let source: string;
      try {
        source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        issues.push({ code: 'INVALID_MARKDOWN_ENCODING', sourcePath: entry.source, message: `${entry.source} is not valid UTF-8` });
        continue;
      }
      const rewrites: Rewrite[] = [];
      for (const link of collectMarkdownLinks(source)) {
        if (remoteOrFragment(link.url)) continue;
        const { pathname, suffix } = splitLinkTarget(link.url);
        if (!pathname) continue;
        let dependency: { path: string; file: string };
        try {
          dependency = await resolveDependency(context.projectRoot, entry.source, pathname);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          issues.push({
            code: error instanceof PublisherError ? error.code : 'UNRESOLVED_PUBLICATION_DEPENDENCY',
            sourcePath: entry.source,
            reference: link.url,
            message,
          });
          continue;
        }
        const markdown = /\.(?:md|markdown)$/i.test(dependency.path);
        if (markdown) {
          const linkedEntry = entriesBySource.get(dependency.path);
          if (!linkedEntry) {
            issues.push({
              code: 'UNRESOLVED_PUBLICATION_DOCUMENT',
              sourcePath: entry.source,
              reference: link.url,
              message: `Local Markdown link ${link.url} resolves to ${dependency.path}, which is not explicitly included in PublisherPlan ${context.plan.id}`,
            });
            continue;
          }
          const rewritten = targetLink(entry.destination, linkedEntry.destination, suffix);
          if (rewritten !== link.url) rewrites.push({ start: link.start, end: link.end, text: rewritten });
        } else {
          const destination = dependency.path;
          dependencies.set(dependency.path, { file: dependency.file, destination });
          const rewritten = targetLink(entry.destination, destination, suffix);
          if (rewritten !== link.url) rewrites.push({ start: link.start, end: link.end, text: rewritten });
        }
      }
      const output = Buffer.from(applyRewrites(source, rewrites), 'utf8');
      const key = entry.destination.toLocaleLowerCase('en-US');
      candidates.set(key, {
        relativePath: entry.destination,
        sourcePath: entry.source,
        kind: 'document',
        bytes: output,
        hash: sha256(output),
        ...(context.evidenceByPath.get(entry.source)?.length ? { evidenceIds: context.evidenceByPath.get(entry.source) } : {}),
      });
    }

    if (issues.length) {
      throw new PublisherError('UNRESOLVED_PUBLICATION_DEPENDENCIES', `PublisherPlan ${context.plan.id} has unresolved local dependencies`, issues);
    }

    for (const [sourcePath, dependency] of [...dependencies.entries()].sort(([left], [right]) => comparePortable(left, right))) {
      const key = dependency.destination.toLocaleLowerCase('en-US');
      if (candidates.has(key)) {
        throw new PublisherError('PUBLICATION_DESTINATION_COLLISION', `Dependency ${sourcePath} collides with publication destination ${dependency.destination}`);
      }
      const bytes = await fs.readFile(dependency.file);
      candidates.set(key, {
        relativePath: dependency.destination,
        sourcePath,
        kind: 'dependency',
        bytes,
        hash: sha256(bytes),
        ...(context.evidenceByPath.get(sourcePath)?.length ? { evidenceIds: context.evidenceByPath.get(sourcePath) } : {}),
      });
    }

    return [...candidates.values()].sort((left, right) => comparePortable(left.relativePath, right.relativePath));
  }
}

const adapters = new Map<string, PublisherAdapter>([['markdown', new MarkdownPublisherAdapter()]]);

function manifestBytes(manifest: PublicationManifest): Buffer {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function readPublicationManifest(file: string): Promise<{ manifest?: PublicationManifest; invalid: boolean }> {
  if (!(await exists(file))) return { invalid: false };
  try {
    const parsed = PublicationManifestSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
    return parsed.success ? { manifest: parsed.data, invalid: false } : { invalid: true };
  } catch {
    return { invalid: true };
  }
}

function isTextPath(file: string): boolean {
  return /\.(?:md|markdown|txt|svg|html|htm|css|js|mjs|cjs|ts|tsx|jsx|json|yaml|yml|xml|csv)$/i.test(file);
}

function decodeUtf8(bytes: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function createPublicationDiff(file: string, before: Buffer | undefined, after: Buffer): string | undefined {
  if (!isTextPath(file)) return undefined;
  const beforeText = before ? decodeUtf8(before) : '';
  const afterText = decodeUtf8(after);
  if (beforeText === undefined || afterText === undefined || beforeText === afterText) return undefined;
  return createTwoFilesPatch(`a/${file}`, `b/${file}`, beforeText, afterText, '', '', { context: 3 });
}

function reviewToken(plan: PublisherPlan, planHash: string, sources: PublicationManifest['sources'], baselines: TargetBaseline[], candidates: Candidate[]): string {
  return `publish-review-v1:${createHash('sha256').update([
    'demoweave-publication-review-v1',
    canonicalJson(plan),
    planHash,
    canonicalJson(sources),
    canonicalJson(baselines),
    canonicalJson(candidates.map(({ relativePath, hash }) => ({ path: relativePath, hash }))),
  ].join('\n')).digest('hex')}`;
}

function matchesToken(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function portableJoin(...parts: string[]): string {
  return path.posix.join(...parts);
}

async function buildPreview(projectRoot: string, reference: string): Promise<PreviewBuild> {
  const root = await canonicalProjectRoot(projectRoot);
  const { plan } = await resolvePlan(root, reference);
  const adapter = adapters.get(plan.publisher);
  if (!adapter) throw new PublisherError('UNKNOWN_PUBLISHER', `Unknown publisher adapter: ${plan.publisher}`);
  const targetRootPath = await resolveSafeOutput(root, plan.targetRoot, 'UNSAFE_PUBLICATION_TARGET_ROOT');
  if (await exists(targetRootPath)) {
    const stat = await fs.stat(targetRootPath);
    if (!stat.isDirectory()) throw new PublisherError('INVALID_PUBLICATION_TARGET_ROOT', `targetRoot is not a directory: ${plan.targetRoot}`);
  }
  const evidenceByPath = await evidenceIndex(root);
  const candidates = await adapter.build({ projectRoot: root, plan, evidenceByPath });
  const planHash = sha256(canonicalPublisherPlan(plan));
  const manifestPath = await resolveSafeOutput(root, `.demoweave/publications/${plan.id}.json`, 'UNSAFE_PUBLICATION_MANIFEST_PATH');
  const baseline = await readPublicationManifest(manifestPath);
  const owned = new Map((baseline.manifest?.planId === plan.id ? baseline.manifest.publishedFiles : []).map((file) => [file.path, file.hash]));
  const files: PublicationPreviewFile[] = [];
  const conflicts: PublicationConflict[] = [];
  const diffs: PublicationDiff[] = [];
  const targetBaselines: TargetBaseline[] = [];

  for (const candidate of candidates) {
    const publicationPath = portableJoin(plan.targetRoot, candidate.relativePath);
    const target = await resolveSafeOutput(root, publicationPath, 'UNSAFE_PUBLICATION_TARGET');
    let before: Buffer | undefined;
    if (await exists(target)) {
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new PublisherError('INVALID_PUBLICATION_TARGET', `Publication target is not a file: ${publicationPath}`);
      before = await fs.readFile(target);
    }
    const currentHash = before ? sha256(before) : undefined;
    targetBaselines.push({ path: candidate.relativePath, exists: before !== undefined, ...(currentHash ? { hash: currentHash } : {}) });
    let action: PublicationFileAction;
    if (currentHash === candidate.hash) {
      action = 'unchanged';
    } else if (before === undefined) {
      action = 'create';
    } else {
      action = 'update';
      const ownedHash = owned.get(candidate.relativePath);
      if (!ownedHash) {
        conflicts.push({
          code: baseline.invalid ? 'invalid-baseline' : 'unmanaged-target',
          path: candidate.relativePath,
          message: baseline.invalid
            ? `Cannot establish ownership because PublicationManifest ${plan.id} is invalid`
            : `Existing differing target is not owned by publication ${plan.id}`,
        });
      } else if (ownedHash !== currentHash) {
        conflicts.push({ code: 'target-drift', path: candidate.relativePath, message: 'Published target changed after the last successful apply' });
      }
    }
    files.push({ path: candidate.relativePath, sourcePath: candidate.sourcePath, kind: candidate.kind, action, hash: candidate.hash });
    const unifiedDiff = createPublicationDiff(candidate.relativePath, before, candidate.bytes);
    if (unifiedDiff) diffs.push({ path: candidate.relativePath, unifiedDiff });
  }

  const sources: PublicationManifest['sources'] = (await Promise.all(candidates
    .map(async (candidate) => ({
      path: candidate.sourcePath,
      hash: sha256(await fs.readFile(await resolveExistingProjectFile(root, candidate.sourcePath, 'UNRESOLVED_PUBLICATION_SOURCE'))),
      kind: candidate.kind,
      ...(candidate.evidenceIds?.length ? { evidenceIds: [...candidate.evidenceIds].sort() } : {}),
    }))))
    .sort((left, right) => comparePortable(left.path, right.path));

  const deduplicatedSources = [...new Map(sources.map((source) => [source.path, source])).values()];
  const manifest: PublicationManifest = {
    schemaVersion: 1,
    planId: plan.id,
    publisher: plan.publisher,
    planHash,
    targetRoot: plan.targetRoot,
    publishedFiles: candidates.map((candidate) => ({
      path: candidate.relativePath,
      hash: candidate.hash,
      sourcePath: candidate.sourcePath,
      kind: candidate.kind,
    })),
    sources: deduplicatedSources,
  };
  PublicationManifestSchema.parse(manifest);
  const sortedBaselines = targetBaselines.sort((left, right) => comparePortable(left.path, right.path));
  const token = reviewToken(plan, planHash, deduplicatedSources, sortedBaselines, candidates);
  const preview: PublicationPreview = {
    schemaVersion: 1,
    planId: plan.id,
    publisher: plan.publisher,
    planHash,
    targetRoot: plan.targetRoot,
    files,
    create: files.filter((file) => file.action === 'create').map((file) => file.path),
    update: files.filter((file) => file.action === 'update').map((file) => file.path),
    unchanged: files.filter((file) => file.action === 'unchanged').map((file) => file.path),
    copiedDependencies: candidates.filter((candidate) => candidate.kind === 'dependency').map((candidate) => ({
      sourcePath: candidate.sourcePath,
      destinationPath: candidate.relativePath,
      hash: candidate.hash,
      ...(candidate.evidenceIds?.length ? { evidenceIds: candidate.evidenceIds } : {}),
    })),
    conflicts,
    unresolvedDependencies: [],
    candidateHashes: candidates.map(({ relativePath: candidatePath, hash }) => ({ path: candidatePath, hash })),
    diffs,
    reviewToken: token,
  };
  return { preview, plan, projectRoot: root, targetRootPath, candidates, manifest, manifestPath, targetBaselines: sortedBaselines };
}

export async function previewPublication(projectRoot: string, reference: string): Promise<PublicationPreview> {
  return (await buildPreview(projectRoot, reference)).preview;
}

async function writeStaged(file: string, bytes: Buffer, mode = 0o666): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx', mode & 0o777);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.chmod(file, mode & 0o777);
}

async function restoreBackup(backup: string, target: string): Promise<void> {
  await fs.rm(target, { force: true });
  if (await exists(backup)) await fs.rename(backup, target);
}

export async function applyPublication(projectRoot: string, reference: string, suppliedToken: string): Promise<PublicationApplyResult> {
  if (!suppliedToken) throw new PublisherError('PUBLICATION_REVIEW_REQUIRED', 'Apply requires the review token emitted by publish preview');
  const build = await buildPreview(projectRoot, reference);
  if (!matchesToken(build.preview.reviewToken, suppliedToken)) {
    throw new PublisherError('PUBLICATION_REVIEW_MISMATCH', 'Review token does not match the current plan, sources, dependencies, target baseline, and candidates');
  }
  if (build.preview.conflicts.length) {
    throw new PublisherError('PUBLICATION_CONFLICT', 'Publication has target conflicts', build.preview.conflicts.map((conflict) => ({
      code: conflict.code,
      path: conflict.path,
      message: conflict.message,
    })));
  }

  const stageParent = path.join(build.projectRoot, '.demoweave', 'cache', 'publish');
  await fs.mkdir(stageParent, { recursive: true });
  const stage = await fs.mkdtemp(path.join(stageParent, `.${build.plan.id}-`));
  const changed = build.candidates.filter((candidate) => build.preview.files.find((file) => file.path === candidate.relativePath)?.action !== 'unchanged');
  const manifestCandidate = manifestBytes(build.manifest);
  const currentManifest = await (async () => {
    try { return await fs.readFile(build.manifestPath); } catch { return undefined; }
  })();
  const manifestChanged = !currentManifest?.equals(manifestCandidate);
  const applied: Array<{ target: string; backup: string; created: boolean }> = [];
  let manifestApplied: { target: string; backup: string; created: boolean } | undefined;
  try {
    for (const candidate of changed) {
      const staged = path.join(stage, 'files', ...candidate.relativePath.split('/'));
      let mode = 0o666;
      const target = path.join(build.targetRootPath, ...candidate.relativePath.split('/'));
      if (await exists(target)) mode = (await fs.stat(target)).mode;
      await writeStaged(staged, candidate.bytes, mode);
    }
    if (manifestChanged) await writeStaged(path.join(stage, 'manifest.json'), manifestCandidate);

    const verified = await buildPreview(build.projectRoot, reference);
    if (!matchesToken(verified.preview.reviewToken, suppliedToken) || verified.preview.conflicts.length) {
      throw new PublisherError('PUBLICATION_REVIEW_MISMATCH', 'Publication inputs changed while candidates were being staged');
    }

    for (const candidate of changed) {
      const target = await resolveSafeOutput(build.projectRoot, portableJoin(build.plan.targetRoot, candidate.relativePath), 'UNSAFE_PUBLICATION_TARGET');
      const baseline = build.targetBaselines.find((item) => item.path === candidate.relativePath)!;
      const currentBytes = await (async () => { try { return await fs.readFile(target); } catch { return undefined; } })();
      const currentHash = currentBytes ? sha256(currentBytes) : undefined;
      if ((currentBytes !== undefined) !== baseline.exists || currentHash !== baseline.hash) {
        throw new PublisherError('PUBLICATION_REVIEW_MISMATCH', `Target changed during apply: ${candidate.relativePath}`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      const backup = path.join(stage, 'backups', ...candidate.relativePath.split('/'));
      await fs.mkdir(path.dirname(backup), { recursive: true });
      const created = !(await exists(target));
      if (!created) await fs.rename(target, backup);
      try {
        await fs.rename(path.join(stage, 'files', ...candidate.relativePath.split('/')), target);
      } catch (error) {
        if (!created) await restoreBackup(backup, target);
        throw error;
      }
      applied.push({ target, backup, created });
    }

    if (manifestChanged) {
      await fs.mkdir(path.dirname(build.manifestPath), { recursive: true });
      const backup = path.join(stage, 'manifest-backup.json');
      const created = !(await exists(build.manifestPath));
      if (!created) await fs.rename(build.manifestPath, backup);
      try {
        await fs.rename(path.join(stage, 'manifest.json'), build.manifestPath);
      } catch (error) {
        if (!created) await restoreBackup(backup, build.manifestPath);
        throw error;
      }
      manifestApplied = { target: build.manifestPath, backup, created };
    }
  } catch (error) {
    if (manifestApplied) {
      if (manifestApplied.created) await fs.rm(manifestApplied.target, { force: true });
      else await restoreBackup(manifestApplied.backup, manifestApplied.target);
    }
    for (const item of [...applied].reverse()) {
      if (item.created) await fs.rm(item.target, { force: true });
      else await restoreBackup(item.backup, item.target);
    }
    if (error instanceof PublisherError) throw error;
    throw new PublisherError('PUBLICATION_APPLY_FAILED', `Publication apply failed and completed writes were rolled back: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }

  return {
    planId: build.plan.id,
    publisher: build.plan.publisher,
    targetRoot: build.plan.targetRoot,
    created: build.preview.create,
    updated: build.preview.update,
    unchanged: build.preview.unchanged,
    writes: changed.length + (manifestChanged ? 1 : 0),
    manifestPath: `.demoweave/publications/${build.plan.id}.json`,
    manifestChanged,
  };
}

async function currentHashSafe(root: string, relativePath: string): Promise<{ hash?: string; unsafe: boolean; missing: boolean }> {
  try {
    const file = await resolveExistingProjectFile(root, relativePath, 'UNSAFE_PUBLICATION_STATUS_PATH');
    return { hash: sha256(await fs.readFile(file)), unsafe: false, missing: false };
  } catch (error) {
    if (error instanceof PublisherError && /does not exist/.test(error.message)) return { unsafe: false, missing: true };
    return { unsafe: true, missing: false };
  }
}

export async function publicationStatus(projectRoot: string, reference: string): Promise<PublicationStatus> {
  const root = await canonicalProjectRoot(projectRoot);
  const { plan } = await resolvePlan(root, reference);
  const manifestPath = await resolveSafeOutput(root, `.demoweave/publications/${plan.id}.json`, 'UNSAFE_PUBLICATION_MANIFEST_PATH');
  if (!(await exists(manifestPath))) {
    return { schemaVersion: 1, planId: plan.id, state: 'unpublished', reasons: [{ code: 'manifest-missing', message: `No PublicationManifest exists for ${plan.id}` }] };
  }
  let manifest: PublicationManifest;
  try {
    manifest = PublicationManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  } catch {
    return { schemaVersion: 1, planId: plan.id, state: 'unknown', reasons: [{ code: 'manifest-invalid', message: `PublicationManifest ${plan.id} is invalid` }] };
  }
  const reasons: PublicationStatusReason[] = [];
  const currentPlanHash = sha256(canonicalPublisherPlan(plan));
  if (manifest.planId !== plan.id || manifest.publisher !== plan.publisher || manifest.targetRoot !== plan.targetRoot || manifest.planHash !== currentPlanHash) {
    reasons.push({ code: 'plan-changed', message: 'PublisherPlan changed after the last successful apply', expectedHash: manifest.planHash, actualHash: currentPlanHash });
  }
  for (const source of manifest.sources) {
    const current = await currentHashSafe(root, source.path);
    const prefix = source.kind === 'document' ? 'source' : 'dependency';
    if (current.unsafe) {
      reasons.push({ code: `${prefix}-unsafe`, path: source.path, message: `Publication ${prefix} cannot be resolved safely: ${source.path}` } as PublicationStatusReason);
    } else if (current.missing) {
      reasons.push({ code: `${prefix}-missing`, path: source.path, expectedHash: source.hash, message: `Publication ${prefix} is missing: ${source.path}` } as PublicationStatusReason);
    } else if (current.hash !== source.hash) {
      reasons.push({ code: `${prefix}-changed`, path: source.path, expectedHash: source.hash, actualHash: current.hash, message: `Publication ${prefix} changed: ${source.path}` } as PublicationStatusReason);
    }
  }
  for (const published of manifest.publishedFiles) {
    const targetPath = portableJoin(manifest.targetRoot, published.path);
    const current = await currentHashSafe(root, targetPath);
    if (current.unsafe) {
      reasons.push({ code: 'target-unsafe', path: published.path, message: `Published target cannot be resolved safely: ${published.path}` });
    } else if (current.missing) {
      reasons.push({ code: 'target-missing', path: published.path, expectedHash: published.hash, message: `Published target is missing: ${published.path}` });
    } else if (current.hash !== published.hash) {
      reasons.push({ code: 'target-changed', path: published.path, expectedHash: published.hash, actualHash: current.hash, message: `Published target changed independently: ${published.path}` });
    }
  }
  reasons.sort((left, right) => comparePortable(left.path ?? '', right.path ?? '') || comparePortable(left.code, right.code));
  let state: PublicationStatus['state'] = 'fresh';
  if (reasons.some((reason) => reason.code === 'target-missing')) state = 'missing';
  else if (reasons.some((reason) => reason.code === 'target-changed')) state = 'drifted';
  else if (reasons.some((reason) => reason.code === 'target-unsafe' || reason.code.endsWith('-unsafe'))) state = 'unknown';
  else if (reasons.length) state = 'stale';
  return PublicationStatusSchema.parse({ schemaVersion: 1, planId: plan.id, state, reasons });
}

export async function validatePublisherPlanFile(projectRoot: string, reference: string): Promise<PublisherPlan> {
  const root = await canonicalProjectRoot(projectRoot);
  return (await resolvePlan(root, reference)).plan;
}

export async function validatePublicationManifestFile(projectRoot: string, relativePath: string): Promise<PublicationManifest> {
  const root = await canonicalProjectRoot(projectRoot);
  const file = await resolveExistingProjectFile(root, relativePath, 'UNSAFE_PUBLICATION_MANIFEST_PATH');
  const result = PublicationManifestSchema.safeParse(await readJsonFile(file, 'INVALID_PUBLICATION_MANIFEST'));
  if (!result.success) throw new PublisherError('INVALID_PUBLICATION_MANIFEST', 'PublicationManifest v1 validation failed', result.error.issues.map((issue) => ({
    code: 'INVALID_PUBLICATION_MANIFEST', path: issue.path.join('.'), message: issue.message,
  })));
  return result.data;
}
