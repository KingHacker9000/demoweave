import { z } from 'zod';
import { EvidenceSchema, type Evidence } from './evidence.js';

export const FlowReferenceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  surfaceId: z.string().min(1),
}).strict();

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectProfileVersion: z.literal(1),
  flows: z.array(FlowReferenceSchema),
  evidence: z.array(EvidenceSchema),
}).strict().superRefine((manifest, ctx) => {
  const flowIds = new Set<string>();
  for (let index = 0; index < manifest.flows.length; index += 1) {
    const id = manifest.flows[index]!.id;
    if (flowIds.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['flows', index, 'id'],
        message: `Duplicate manifest Flow id: ${id}`,
      });
    }
    flowIds.add(id);
  }

  const evidenceIds = new Set<string>();
  for (let index = 0; index < manifest.evidence.length; index += 1) {
    const id = manifest.evidence[index]!.id;
    if (evidenceIds.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence', index, 'id'],
        message: `Duplicate Evidence id: ${id}`,
      });
    }
    evidenceIds.add(id);
  }
});

function normalizeEvidence(evidence: Evidence): Evidence {
  return {
    ...evidence,
    provenance: {
      ...evidence.provenance,
      sources: [...evidence.provenance.sources]
        .sort((a, b) => a.path.localeCompare(b.path) || (a.role ?? '').localeCompare(b.role ?? '')),
    },
    ...(evidence.derivedFrom
      ? { derivedFrom: [...evidence.derivedFrom].sort() }
      : {}),
  };
}

export function normalizeManifest(input: Manifest): Manifest {
  const parsed = ManifestSchema.parse(input);
  return {
    ...parsed,
    flows: [...parsed.flows].sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path)),
    evidence: [...parsed.evidence]
      .map(normalizeEvidence)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export type FlowReference = z.infer<typeof FlowReferenceSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
