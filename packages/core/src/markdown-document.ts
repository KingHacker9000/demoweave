import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const DocumentNewlineSchema = z.enum(['lf', 'crlf', 'cr', 'mixed', 'none']);

export const DocumentSectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['preamble', 'section']),
  level: z.number().int().min(1).max(6).optional(),
  heading: z.string().optional(),
  headingPath: z.array(z.string()),
  occurrence: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  headingStart: z.number().int().nonnegative().optional(),
  headingEnd: z.number().int().nonnegative().optional(),
  bodyStart: z.number().int().nonnegative(),
}).strict().superRefine((section, ctx) => {
  if (section.end < section.start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'Section end cannot precede start' });
  }
  if (section.bodyStart < section.start || section.bodyStart > section.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyStart'], message: 'Section bodyStart must be inside the section range' });
  }
  if (section.kind === 'section' && (section.level === undefined || section.heading === undefined || section.headingStart === undefined || section.headingEnd === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Heading sections require level, heading, headingStart, and headingEnd' });
  }
});

export const MarkdownDocumentInspectionSchema = z.object({
  schemaVersion: z.literal(1),
  targetPath: z.string().min(1),
  baseHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  newline: DocumentNewlineSchema,
  trailingNewline: z.boolean(),
  length: z.number().int().nonnegative(),
  sections: z.array(DocumentSectionSchema).min(1),
}).strict();

export type DocumentNewline = z.infer<typeof DocumentNewlineSchema>;
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
export type MarkdownDocumentInspection = z.infer<typeof MarkdownDocumentInspectionSchema>;

export class DocumentPatchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DocumentPatchError';
  }
}

type SourceLine = {
  start: number;
  end: number;
  contentEnd: number;
  text: string;
  eol: string;
};

type ParsedHeading = {
  level: number;
  heading: string;
  line: SourceLine;
  headingPath: string[];
  occurrence: number;
  id: string;
};

type FenceState = {
  marker: '`' | '~';
  length: number;
};

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function hashDocumentSource(source: string): string {
  return sha256(Buffer.from(source, 'utf8'));
}

function scanLines(source: string): SourceLine[] {
  if (!source.length) return [];
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char !== '\n' && char !== '\r') continue;
    const contentEnd = index;
    let eol = char;
    if (char === '\r' && source[index + 1] === '\n') {
      eol = '\r\n';
      index += 1;
    }
    const end = index + 1;
    lines.push({ start, end, contentEnd, text: source.slice(start, contentEnd), eol });
    start = end;
  }
  if (start < source.length) {
    lines.push({ start, end: source.length, contentEnd: source.length, text: source.slice(start), eol: '' });
  }
  return lines;
}

function leadingIndent(text: string): number {
  let count = 0;
  while (count < text.length && count < 4 && text[count] === ' ') count += 1;
  return count;
}

function markerRun(text: string, start: number, marker: '`' | '~'): number {
  let index = start;
  while (index < text.length && text[index] === marker) index += 1;
  return index - start;
}

function updateFence(line: SourceLine, current?: FenceState): FenceState | undefined {
  const indent = leadingIndent(line.text);
  if (indent > 3) return current;
  const content = line.text.slice(indent);
  if (!content.length) return current;

  if (current) {
    if (content[0] !== current.marker) return current;
    const run = markerRun(content, 0, current.marker);
    if (run < current.length) return current;
    if (content.slice(run).trim().length === 0) return undefined;
    return current;
  }

  const first = content[0];
  if (first !== '`' && first !== '~') return undefined;
  const run = markerRun(content, 0, first);
  if (run < 3) return undefined;
  if (first === '`' && content.slice(run).includes('`')) return undefined;
  return { marker: first, length: run };
}

function parseAtxHeading(line: SourceLine): { level: number; heading: string } | undefined {
  const indent = leadingIndent(line.text);
  if (indent > 3) return undefined;
  const content = line.text.slice(indent);
  if (!content.startsWith('#')) return undefined;

  let level = 0;
  while (level < content.length && level < 7 && content[level] === '#') level += 1;
  if (level < 1 || level > 6) return undefined;
  const next = content[level];
  if (next !== undefined && next !== ' ' && next !== '\t') return undefined;

  let heading = content.slice(level).trim();
  if (heading.endsWith('#')) {
    let hashStart = heading.length - 1;
    while (hashStart > 0 && heading[hashStart - 1] === '#') hashStart -= 1;
    const before = heading[hashStart - 1];
    if (before === ' ' || before === '\t') heading = heading.slice(0, hashStart).trimEnd();
  }
  return { level, heading };
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'heading';
}

function sectionId(pathParts: string[], occurrence: number): string {
  const readable = slugify(pathParts.join('-'));
  const digest = createHash('sha256').update(`${pathParts.join('\u0000')}\u0000${occurrence}`).digest('hex').slice(0, 8);
  return `section-${readable}-${occurrence}-${digest}`;
}

function newlineKind(lines: SourceLine[]): DocumentNewline {
  const seen = new Set(lines.map((line) => line.eol).filter(Boolean));
  if (seen.size === 0) return 'none';
  if (seen.size > 1) return 'mixed';
  const value = [...seen][0];
  if (value === '\r\n') return 'crlf';
  if (value === '\r') return 'cr';
  return 'lf';
}

function parseHeadings(source: string): ParsedHeading[] {
  const lines = scanLines(source);
  const headings: ParsedHeading[] = [];
  const stack: Array<{ level: number; heading: string }> = [];
  const occurrences = new Map<string, number>();
  let fence: FenceState | undefined;

  for (const line of lines) {
    const beforeFence = fence;
    const afterFence = updateFence(line, fence);
    const isFenceBoundary = beforeFence !== afterFence;
    fence = afterFence;
    if (beforeFence || isFenceBoundary) continue;

    const parsed = parseAtxHeading(line);
    if (!parsed) continue;
    while (stack.length && stack.at(-1)!.level >= parsed.level) stack.pop();
    const headingPath = [...stack.map((item) => item.heading), parsed.heading];
    const occurrenceKey = headingPath.join('\u0000');
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    headings.push({
      ...parsed,
      line,
      headingPath,
      occurrence,
      id: sectionId(headingPath, occurrence),
    });
    stack.push({ level: parsed.level, heading: parsed.heading });
  }
  return headings;
}

export function inspectMarkdownSource(targetPath: string, source: string): MarkdownDocumentInspection {
  const headings = parseHeadings(source);
  const sections: DocumentSection[] = [];
  const firstHeadingStart = headings[0]?.line.start ?? source.length;
  sections.push({
    id: 'preamble',
    kind: 'preamble',
    headingPath: [],
    occurrence: 1,
    start: 0,
    end: firstHeadingStart,
    bodyStart: 0,
  });

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    let end = source.length;
    for (let candidate = index + 1; candidate < headings.length; candidate += 1) {
      if (headings[candidate]!.level <= heading.level) {
        end = headings[candidate]!.line.start;
        break;
      }
    }
    sections.push({
      id: heading.id,
      kind: 'section',
      level: heading.level,
      heading: heading.heading,
      headingPath: heading.headingPath,
      occurrence: heading.occurrence,
      start: heading.line.start,
      end,
      headingStart: heading.line.start,
      headingEnd: heading.line.end,
      bodyStart: heading.line.end,
    });
  }

  return MarkdownDocumentInspectionSchema.parse({
    schemaVersion: 1,
    targetPath,
    baseHash: hashDocumentSource(source),
    newline: newlineKind(scanLines(source)),
    trailingNewline: /(?:\r\n|\n|\r)$/.test(source),
    length: source.length,
    sections,
  });
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resolveProjectFile(
  projectRoot: string,
  relativePath: string,
  options: { mustExist?: boolean; rejectSymlink?: boolean } = {},
): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new DocumentPatchError('PATH_OUTSIDE_PROJECT', `Path must be project-relative: ${relativePath}`);
  }
  const root = await fs.realpath(path.resolve(projectRoot));
  const candidate = path.resolve(root, relativePath);
  if (!inside(root, candidate)) throw new DocumentPatchError('PATH_OUTSIDE_PROJECT', `Path escapes project root: ${relativePath}`);

  const mustExist = options.mustExist ?? true;
  if (mustExist) {
    let stat;
    try {
      stat = await fs.lstat(candidate);
    } catch (error) {
      throw new DocumentPatchError('FILE_NOT_FOUND', `Could not access ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if ((options.rejectSymlink ?? true) && stat.isSymbolicLink()) {
      throw new DocumentPatchError('SYMLINK_REJECTED', `Refusing to operate on symlink: ${relativePath}`);
    }
    const real = await fs.realpath(candidate);
    if (!inside(root, real)) throw new DocumentPatchError('PATH_OUTSIDE_PROJECT', `Resolved path escapes project root: ${relativePath}`);
    return candidate;
  }

  const parent = await fs.realpath(path.dirname(candidate));
  if (!inside(root, parent)) throw new DocumentPatchError('PATH_OUTSIDE_PROJECT', `Parent path escapes project root: ${relativePath}`);
  return candidate;
}

export async function inspectMarkdownFile(projectRoot: string, targetPath: string): Promise<MarkdownDocumentInspection> {
  if (!/\.(?:md|markdown)$/i.test(targetPath)) {
    throw new DocumentPatchError('NOT_MARKDOWN', `Markdown target must end in .md or .markdown: ${targetPath}`);
  }
  const target = await resolveProjectFile(projectRoot, targetPath, { mustExist: true, rejectSymlink: true });
  const source = await fs.readFile(target, 'utf8');
  return inspectMarkdownSource(targetPath.replaceAll(path.sep, '/'), source);
}
