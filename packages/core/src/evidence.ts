import { z } from 'zod';
import { EvidenceKindSchema } from './flow.js';

export const ContentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const EvidenceFormatSchema = z.enum([
  'png',
  'jpeg',
  'webp',
  'gif',
  'webm',
  'mp4',
  'svg',
  'json',
  'csv',
  'txt',
  'md',
  'ansi',
  'html',
  'srt',
  'vtt',
  'ipynb',
]);

export const EvidenceStatusSchema = z.enum([
  'planned',
  'available',
  'stale',
  'missing',
  'failed',
]);

export const SourceDependencyRoleSchema = z.enum([
  'implementation',
  'config',
  'fixture',
  'data',
  'asset',
  'other',
]);

export const SourceDependencySchema = z.object({
  path: z.string().min(1),
  role: SourceDependencyRoleSchema.optional(),
  hash: ContentHashSchema.optional(),
}).strict();

export const ProducerSchema = z.object({
  kind: z.enum(['driver', 'renderer', 'agent', 'external']),
  id: z.string().min(1),
  version: z.string().min(1).optional(),
}).strict();

export const ProvenanceSchema = z.object({
  flowId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  surfaceId: z.string().min(1).optional(),
  gitCommit: z.string().min(1).optional(),
  flowHash: ContentHashSchema.optional(),
  sources: z.array(SourceDependencySchema),
}).strict().superRefine((value, ctx) => {
  if (value.stepId && !value.flowId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stepId'],
      message: 'stepId requires flowId',
    });
  }
});

export const EvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: EvidenceKindSchema,
  status: EvidenceStatusSchema,
  label: z.string().min(1).optional(),
  format: EvidenceFormatSchema.optional(),
  path: z.string().min(1).optional(),
  artifactHash: ContentHashSchema.optional(),
  mimeType: z.string().min(1).optional(),
  producer: ProducerSchema.optional(),
  provenance: ProvenanceSchema,
  derivedFrom: z.array(z.string().min(1)).optional(),
}).strict().superRefine((evidence, ctx) => {
  if ((evidence.status === 'available' || evidence.status === 'stale') && !evidence.path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['path'],
      message: `${evidence.status} evidence requires a path`,
    });
  }
  if (evidence.artifactHash && !evidence.path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifactHash'],
      message: 'artifactHash requires an artifact path',
    });
  }
  if (evidence.derivedFrom?.includes(evidence.id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['derivedFrom'],
      message: 'Evidence cannot derive from itself',
    });
  }
});

export type ContentHash = z.infer<typeof ContentHashSchema>;
export type EvidenceFormat = z.infer<typeof EvidenceFormatSchema>;
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export type SourceDependencyRole = z.infer<typeof SourceDependencyRoleSchema>;
export type SourceDependency = z.infer<typeof SourceDependencySchema>;
export type Producer = z.infer<typeof ProducerSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
