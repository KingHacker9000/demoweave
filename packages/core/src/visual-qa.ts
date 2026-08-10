import { z } from 'zod';
import { ContentHashSchema, EvidenceFormatSchema } from './evidence.js';

const StableIdSchema = z.string().min(1).regex(/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase kebab-case id');
const TimestampSchema = z.number().int().nonnegative().max(86_400_000);
const ProjectPathSchema = z.string().min(1).refine((value) => {
  const portable = value.replaceAll('\\', '/');
  return !portable.startsWith('/')
    && !/^[a-zA-Z]:\//.test(portable)
    && !portable.startsWith('//')
    && !portable.split('/').some((part) => part === '..');
}, 'Expected a safe project-relative path');

export const VisualQAVerdictSchema = z.enum(['pending', 'pass', 'needs-changes']);
export const VisualQASeveritySchema = z.enum(['info', 'warning', 'error']);
export const VisualQACategorySchema = z.enum([
  'readability',
  'clipping',
  'loading-state',
  'secret',
  'dead-time',
  'caption-mismatch',
  'composition',
  'text-overlap',
  'flicker',
  'other',
]);
export const VisualQASignalKindSchema = z.enum(['black-range', 'freeze-range']);

export const VisualQASourceSchema = z.object({
  evidenceId: StableIdSchema,
  path: ProjectPathSchema,
  format: EvidenceFormatSchema.refine((format) => ['png', 'gif', 'mp4'].includes(format), 'Visual QA supports PNG, GIF, or MP4 Evidence'),
  artifactHash: ContentHashSchema,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  durationMs: TimestampSchema.optional(),
}).strict().superRefine((source, ctx) => {
  if ((source.format === 'gif' || source.format === 'mp4') && (!source.durationMs || source.durationMs <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['durationMs'], message: `${source.format.toUpperCase()} visual QA requires a positive durationMs` });
  }
  if (source.format === 'png' && source.durationMs !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['durationMs'], message: 'PNG visual QA does not use durationMs' });
  }
});

export const VisualQASampleContextSchema = z.object({
  sceneIds: z.array(StableIdSchema).optional(),
  captionIds: z.array(StableIdSchema).optional(),
}).strict();

export const VisualQASampleSchema = z.object({
  id: StableIdSchema,
  atMs: TimestampSchema,
  path: ProjectPathSchema,
  artifactHash: ContentHashSchema,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  context: VisualQASampleContextSchema.optional(),
}).strict();

export const VisualQAContactSheetSchema = z.object({
  path: ProjectPathSchema,
  artifactHash: ContentHashSchema,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
}).strict();

export const VisualQASignalSchema = z.object({
  id: StableIdSchema,
  kind: VisualQASignalKindSchema,
  startMs: TimestampSchema,
  endMs: TimestampSchema,
}).strict().refine((signal) => signal.endMs > signal.startMs, {
  message: 'Visual QA signal endMs must be greater than startMs',
  path: ['endMs'],
});

export const VisualQASamplingSchema = z.object({
  strategy: z.literal('uniform'),
  requestedCount: z.number().int().min(1).max(20),
  samples: z.array(VisualQASampleSchema).min(1).max(40),
}).strict();

export const VisualQAPacketSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  source: VisualQASourceSchema,
  sampling: VisualQASamplingSchema,
  contactSheet: VisualQAContactSheetSchema,
  signals: z.array(VisualQASignalSchema),
}).strict().superRefine((packet, ctx) => {
  const sampleIds = new Set<string>();
  let previousSampleAt = -1;
  packet.sampling.samples.forEach((sample, index) => {
    if (sampleIds.has(sample.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sampling', 'samples', index, 'id'], message: `Duplicate sample id: ${sample.id}` });
    }
    sampleIds.add(sample.id);
    if (sample.atMs < previousSampleAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sampling', 'samples', index, 'atMs'], message: 'Samples must be ordered by atMs' });
    }
    previousSampleAt = sample.atMs;
    if (packet.source.durationMs !== undefined && sample.atMs >= packet.source.durationMs) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sampling', 'samples', index, 'atMs'], message: 'Sample timestamp must be inside source duration' });
    }
    if (packet.source.format === 'png' && sample.atMs !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sampling', 'samples', index, 'atMs'], message: 'PNG samples must use atMs 0' });
    }
  });

  const signalIds = new Set<string>();
  packet.signals.forEach((signal, index) => {
    if (signalIds.has(signal.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signals', index, 'id'], message: `Duplicate signal id: ${signal.id}` });
    }
    signalIds.add(signal.id);
    if (packet.source.durationMs !== undefined && signal.endMs > packet.source.durationMs + 50) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['signals', index, 'endMs'], message: 'Signal range extends beyond source duration' });
    }
  });
});

export const VisualQAFindingSchema = z.object({
  id: StableIdSchema,
  severity: VisualQASeveritySchema,
  category: VisualQACategorySchema,
  message: z.string().min(1).max(1_000),
  sampleId: StableIdSchema.optional(),
  startMs: TimestampSchema.optional(),
  endMs: TimestampSchema.optional(),
  recommendation: z.string().min(1).max(1_000).optional(),
}).strict().superRefine((finding, ctx) => {
  if ((finding.startMs === undefined) !== (finding.endMs === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startMs'], message: 'Finding time ranges require both startMs and endMs' });
  }
  if (finding.startMs !== undefined && finding.endMs !== undefined && finding.endMs <= finding.startMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endMs'], message: 'Finding endMs must be greater than startMs' });
  }
});

export const VisualQAReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  packetId: StableIdSchema,
  packetHash: ContentHashSchema,
  sourceEvidenceId: StableIdSchema,
  sourceArtifactHash: ContentHashSchema,
  verdict: VisualQAVerdictSchema,
  findings: z.array(VisualQAFindingSchema),
}).strict().superRefine((report, ctx) => {
  const findingIds = new Set<string>();
  report.findings.forEach((finding, index) => {
    if (findingIds.has(finding.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['findings', index, 'id'], message: `Duplicate finding id: ${finding.id}` });
    }
    findingIds.add(finding.id);
  });
  if (report.verdict === 'pass' && report.findings.some((finding) => finding.severity === 'error')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verdict'], message: 'A passing visual QA report cannot contain error findings' });
  }
  if (report.verdict === 'needs-changes' && !report.findings.some((finding) => finding.severity === 'warning' || finding.severity === 'error')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verdict'], message: 'needs-changes requires at least one warning or error finding' });
  }
});

export type VisualQAVerdict = z.infer<typeof VisualQAVerdictSchema>;
export type VisualQASeverity = z.infer<typeof VisualQASeveritySchema>;
export type VisualQACategory = z.infer<typeof VisualQACategorySchema>;
export type VisualQASignalKind = z.infer<typeof VisualQASignalKindSchema>;
export type VisualQASource = z.infer<typeof VisualQASourceSchema>;
export type VisualQASampleContext = z.infer<typeof VisualQASampleContextSchema>;
export type VisualQASample = z.infer<typeof VisualQASampleSchema>;
export type VisualQAContactSheet = z.infer<typeof VisualQAContactSheetSchema>;
export type VisualQASignal = z.infer<typeof VisualQASignalSchema>;
export type VisualQASampling = z.infer<typeof VisualQASamplingSchema>;
export type VisualQAPacket = z.infer<typeof VisualQAPacketSchema>;
export type VisualQAFinding = z.infer<typeof VisualQAFindingSchema>;
export type VisualQAReport = z.infer<typeof VisualQAReportSchema>;
