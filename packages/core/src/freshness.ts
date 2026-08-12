import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ManifestSchema, type Manifest } from './manifest.js';
import type { Evidence } from './evidence.js';

const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const FreshnessStateSchema = z.enum(['fresh', 'stale', 'missing', 'unknown']);
export const FreshnessReasonCodeSchema = z.enum([
  'declared-planned',
  'declared-stale',
  'declared-missing',
  'declared-failed',
  'artifact-missing',
  'artifact-changed',
  'artifact-baseline-unavailable',
  'source-missing',
  'source-changed',
  'source-baseline-unavailable',
  'flow-reference-missing',
  'flow-missing',
  'flow-changed',
  'flow-baseline-unavailable',
  'plugin-changed',
  'plugin-unavailable',
  'upstream-missing',
  'upstream-stale',
  'upstream-unknown',
]);

export const FreshnessReasonSchema = z.object({
  code: FreshnessReasonCodeSchema,
  message: z.string().min(1),
  path: z.string().min(1).optional(),
  upstreamEvidenceId: z.string().min(1).optional(),
  expectedHash: HashSchema.optional(),
  actualHash: HashSchema.optional(),
}).strict();

export const EvidenceFreshnessSchema = z.object({
  evidenceId: z.string().min(1),
  state: FreshnessStateSchema,
  reasons: z.array(FreshnessReasonSchema),
}).strict();

export const DocumentImpactSchema = z.object({
  path: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
}).strict();

const RunFlowActionSchema = z.object({
  kind: z.literal('run-flow'),
  flowId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();

const RenderEvidenceActionSchema = z.object({
  kind: z.literal('render-evidence'),
  sourceEvidenceId: z.string().min(1),
  evidenceId: z.string().min(1),
  format: z.enum(['png', 'gif']),
  outputPath: z.string().min(1),
}).strict();

export const RegenerationActionSchema = z.discriminatedUnion('kind', [RunFlowActionSchema, RenderEvidenceActionSchema]);

export const FreshnessReportSchema = z.object({
  schemaVersion: z.literal(1),
  evidence: z.array(EvidenceFreshnessSchema),
  documents: z.array(DocumentImpactSchema),
  regeneration: z.array(RegenerationActionSchema),
  summary: z.object({
    fresh: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    impactedDocuments: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type FreshnessState = z.infer<typeof FreshnessStateSchema>;
export type FreshnessReason = z.infer<typeof FreshnessReasonSchema>;
export type EvidenceFreshness = z.infer<typeof EvidenceFreshnessSchema>;
export type DocumentImpact = z.infer<typeof DocumentImpactSchema>;
export type RegenerationAction = z.infer<typeof RegenerationActionSchema>;
export type FreshnessReport = z.infer<typeof FreshnessReportSchema>;

function sha256(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function portable(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, '/');
}

function safeProjectPath(root: string, relative: string): string | undefined {
  if (!relative || path.isAbsolute(relative)) return undefined;
  const resolved = path.resolve(root, relative);
  const relation = path.relative(root, resolved);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) return undefined;
  return resolved;
}

async function hashFile(target: string): Promise<string | undefined> {
  try {
    return sha256(await fs.readFile(target));
  } catch {
    return undefined;
  }
}

function baselineHashFromGit(root: string, commit: string | undefined, relative: string): string | undefined {
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) return undefined;
  const result = spawnSync('git', ['show', `${commit}:${relative.replaceAll('\\', '/')}`], {
    cwd: root,
    encoding: null,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 && Buffer.isBuffer(result.stdout) ? sha256(result.stdout) : undefined;
}

async function readManifest(root: string): Promise<Manifest> {
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  return ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
}

const UNKNOWN_REASON_CODES = new Set<FreshnessReason['code']>([
  'declared-planned',
  'artifact-baseline-unavailable',
  'source-baseline-unavailable',
  'flow-baseline-unavailable',
  'plugin-unavailable',
  'upstream-unknown',
]);

function stateFromReasons(reasons: FreshnessReason[]): FreshnessState {
  if (reasons.some((reason) => reason.code === 'artifact-missing' || reason.code === 'declared-missing')) return 'missing';
  if (reasons.some((reason) => !UNKNOWN_REASON_CODES.has(reason.code))) return 'stale';
  if (reasons.length) return 'unknown';
  return 'fresh';
}

async function inspectDirectEvidence(
  root: string,
  manifest: Manifest,
  evidence: Evidence,
  pluginFingerprints?: ReadonlyMap<string, string>,
): Promise<EvidenceFreshness> {
  const reasons: FreshnessReason[] = [];
  if (evidence.status === 'planned') reasons.push({ code: 'declared-planned', message: 'Evidence is planned but has not been produced yet.' });
  if (evidence.status === 'stale') reasons.push({ code: 'declared-stale', message: 'Manifest explicitly marks this Evidence stale.' });
  if (evidence.status === 'missing') reasons.push({ code: 'declared-missing', message: 'Manifest explicitly marks this Evidence missing.' });
  if (evidence.status === 'failed') reasons.push({ code: 'declared-failed', message: 'The producing operation previously failed.' });

  if (evidence.path) {
    const artifact = safeProjectPath(root, evidence.path);
    const actualHash = artifact ? await hashFile(artifact) : undefined;
    if (!actualHash) {
      reasons.push({ code: 'artifact-missing', path: evidence.path, message: `Artifact is missing: ${evidence.path}` });
    } else {
      const expectedHash = evidence.artifactHash ?? baselineHashFromGit(root, evidence.provenance.gitCommit, evidence.path);
      if (!expectedHash) {
        reasons.push({
          code: 'artifact-baseline-unavailable',
          path: evidence.path,
          actualHash,
          message: `No artifact fingerprint or reachable git baseline is available for ${evidence.path}.`,
        });
      } else if (expectedHash !== actualHash) {
        reasons.push({
          code: 'artifact-changed',
          path: evidence.path,
          expectedHash,
          actualHash,
          message: `Artifact bytes changed after capture: ${evidence.path}`,
        });
      }
    }
  }

  for (const dependency of evidence.provenance.sources) {
    const target = safeProjectPath(root, dependency.path);
    const actualHash = target ? await hashFile(target) : undefined;
    if (!actualHash) {
      reasons.push({ code: 'source-missing', path: dependency.path, message: `Source dependency is missing: ${dependency.path}` });
      continue;
    }
    const expectedHash = dependency.hash ?? baselineHashFromGit(root, evidence.provenance.gitCommit, dependency.path);
    if (!expectedHash) {
      reasons.push({
        code: 'source-baseline-unavailable',
        path: dependency.path,
        actualHash,
        message: `No source fingerprint or reachable git baseline is available for ${dependency.path}.`,
      });
    } else if (expectedHash !== actualHash) {
      reasons.push({
        code: 'source-changed',
        path: dependency.path,
        expectedHash,
        actualHash,
        message: `Source dependency changed: ${dependency.path}`,
      });
    }
  }

  if (evidence.provenance.flowId) {
    const reference = manifest.flows.find((flow) => flow.id === evidence.provenance.flowId);
    if (!reference) {
      reasons.push({ code: 'flow-reference-missing', message: `Manifest has no Flow reference for ${evidence.provenance.flowId}.` });
    } else {
      const target = safeProjectPath(root, reference.path);
      const actualHash = target ? await hashFile(target) : undefined;
      if (!actualHash) {
        reasons.push({ code: 'flow-missing', path: reference.path, message: `Flow file is missing: ${reference.path}` });
      } else {
        const expectedHash = evidence.provenance.flowHash ?? baselineHashFromGit(root, evidence.provenance.gitCommit, reference.path);
        if (!expectedHash) {
          reasons.push({
            code: 'flow-baseline-unavailable',
            path: reference.path,
            actualHash,
            message: `No Flow fingerprint or reachable git baseline is available for ${reference.path}.`,
          });
        } else if (expectedHash !== actualHash) {
          reasons.push({
            code: 'flow-changed',
            path: reference.path,
            expectedHash,
            actualHash,
            message: `Flow definition changed: ${reference.path}`,
          });
        }
      }
    }
  }

  if (evidence.producer?.pluginFingerprint) {
    const actualHash = pluginFingerprints?.get(evidence.producer.id);
    if (!actualHash) {
      reasons.push({
        code: 'plugin-unavailable',
        expectedHash: evidence.producer.pluginFingerprint,
        message: `Producing plugin contribution is unavailable: ${evidence.producer.id}`,
      });
    } else if (actualHash !== evidence.producer.pluginFingerprint) {
      reasons.push({
        code: 'plugin-changed',
        expectedHash: evidence.producer.pluginFingerprint,
        actualHash,
        message: `Producing plugin implementation or options changed: ${evidence.producer.id}`,
      });
    }
  }

  return { evidenceId: evidence.id, state: stateFromReasons(reasons), reasons };
}

function propagateDerived(manifest: Manifest, direct: Map<string, EvidenceFreshness>): EvidenceFreshness[] {
  const byId = new Map(manifest.evidence.map((item) => [item.id, item]));
  const resolved = new Map<string, EvidenceFreshness>();
  const resolving = new Set<string>();

  const resolve = (id: string): EvidenceFreshness => {
    const existing = resolved.get(id);
    if (existing) return existing;
    const own = direct.get(id) ?? { evidenceId: id, state: 'unknown' as const, reasons: [] };
    const evidence = byId.get(id);
    if (!evidence?.derivedFrom?.length) {
      resolved.set(id, own);
      return own;
    }
    if (resolving.has(id)) {
      return {
        evidenceId: id,
        state: 'unknown',
        reasons: [{ code: 'upstream-unknown', upstreamEvidenceId: id, message: `Derived Evidence cycle prevents freshness resolution at ${id}.` }],
      };
    }
    resolving.add(id);
    const reasons = [...own.reasons];
    for (const upstreamId of evidence.derivedFrom) {
      const upstreamEvidence = byId.get(upstreamId);
      if (!upstreamEvidence) {
        reasons.push({
          code: 'upstream-missing',
          upstreamEvidenceId: upstreamId,
          message: `Derived Evidence references missing upstream Evidence ${upstreamId}.`,
        });
        continue;
      }
      const upstream = resolve(upstreamId);
      if (upstream.state === 'missing') {
        reasons.push({ code: 'upstream-missing', upstreamEvidenceId: upstreamId, message: `Upstream Evidence is missing: ${upstreamId}` });
      } else if (upstream.state === 'stale') {
        reasons.push({ code: 'upstream-stale', upstreamEvidenceId: upstreamId, message: `Upstream Evidence is stale: ${upstreamId}` });
      } else if (upstream.state === 'unknown') {
        reasons.push({ code: 'upstream-unknown', upstreamEvidenceId: upstreamId, message: `Upstream Evidence freshness is unknown: ${upstreamId}` });
      }
    }
    resolving.delete(id);
    const result = { evidenceId: id, state: stateFromReasons(reasons), reasons } satisfies EvidenceFreshness;
    resolved.set(id, result);
    return result;
  };

  return manifest.evidence.map((item) => resolve(item.id)).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.pnpm', 'dist', 'build', 'coverage']);

async function markdownFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    const relative = portable(root, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || relative === '.demoweave/evidence' || relative === '.demoweave/plans') continue;
      output.push(...await markdownFiles(root, full));
    } else if (entry.isFile() && /\.(?:md|markdown)$/i.test(entry.name)) {
      output.push(relative);
    }
  }
  return output;
}

function markdownDestinations(source: string): string[] {
  const found = new Set<string>();
  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
  for (const match of source.matchAll(inline)) found.add((match[1] ?? match[2] ?? '').trim());
  const html = /<(?:a|img)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of source.matchAll(html)) found.add((match[1] ?? '').trim());
  return [...found].filter(Boolean);
}

function normalizeDocumentDestination(documentPath: string, destination: string): string | undefined {
  if (!destination || destination.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(destination)) return undefined;
  const withoutQuery = destination.split(/[?#]/, 1)[0];
  if (!withoutQuery) return undefined;
  return path.posix.normalize(path.posix.join(path.posix.dirname(documentPath), withoutQuery));
}

async function documentImpacts(root: string, manifest: Manifest, freshness: EvidenceFreshness[]): Promise<DocumentImpact[]> {
  const affected = new Set(freshness.filter((item) => item.state !== 'fresh').map((item) => item.evidenceId));
  const evidenceByPath = new Map(
    manifest.evidence
      .filter((item) => item.path && affected.has(item.id))
      .map((item) => [path.posix.normalize(item.path!), item.id]),
  );
  const impacts: DocumentImpact[] = [];
  for (const documentPath of await markdownFiles(root)) {
    const source = await fs.readFile(path.join(root, documentPath), 'utf8');
    const ids = new Set<string>();
    for (const destination of markdownDestinations(source)) {
      const normalized = normalizeDocumentDestination(documentPath, destination);
      const id = normalized ? evidenceByPath.get(normalized) : undefined;
      if (id) ids.add(id);
    }
    if (ids.size) impacts.push({ path: documentPath, evidenceIds: [...ids].sort() });
  }
  return impacts.sort((a, b) => a.path.localeCompare(b.path));
}

function regenerationPlan(manifest: Manifest, freshness: EvidenceFreshness[]): RegenerationAction[] {
  const byState = new Map(freshness.map((item) => [item.evidenceId, item.state]));
  const staleIds = new Set(freshness.filter((item) => item.state === 'stale' || item.state === 'missing').map((item) => item.evidenceId));
  const flows = new Map<string, Set<string>>();
  for (const evidence of manifest.evidence) {
    if (!staleIds.has(evidence.id) || evidence.derivedFrom?.length || !evidence.provenance.flowId) continue;
    const ids = flows.get(evidence.provenance.flowId) ?? new Set<string>();
    ids.add(evidence.id);
    flows.set(evidence.provenance.flowId, ids);
  }

  const actions: RegenerationAction[] = [...flows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([flowId, evidenceIds]) => ({ kind: 'run-flow' as const, flowId, evidenceIds: [...evidenceIds].sort() }));

  for (const evidence of [...manifest.evidence].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!staleIds.has(evidence.id) || !evidence.derivedFrom?.length || !evidence.path) continue;
    if (evidence.format !== 'png' && evidence.format !== 'gif') continue;
    if (evidence.producer && (evidence.producer.kind !== 'renderer' || evidence.producer.id !== 'terminal')) continue;
    const sourceEvidenceId = evidence.derivedFrom[0];
    if (!sourceEvidenceId || byState.get(sourceEvidenceId) === 'unknown') continue;
    actions.push({
      kind: 'render-evidence',
      sourceEvidenceId,
      evidenceId: evidence.id,
      format: evidence.format,
      outputPath: evidence.path,
    });
  }
  return actions;
}

export async function analyzeFreshness(
  projectRoot: string,
  options: { pluginFingerprints?: ReadonlyMap<string, string> } = {},
): Promise<FreshnessReport> {
  const root = path.resolve(projectRoot);
  const manifest = await readManifest(root);
  const direct = new Map<string, EvidenceFreshness>();
  for (const evidenceItem of manifest.evidence) {
    direct.set(evidenceItem.id, await inspectDirectEvidence(root, manifest, evidenceItem, options.pluginFingerprints));
  }
  const evidence = propagateDerived(manifest, direct);
  const documents = await documentImpacts(root, manifest, evidence);
  const regeneration = regenerationPlan(manifest, evidence);
  const summary = {
    fresh: evidence.filter((item) => item.state === 'fresh').length,
    stale: evidence.filter((item) => item.state === 'stale').length,
    missing: evidence.filter((item) => item.state === 'missing').length,
    unknown: evidence.filter((item) => item.state === 'unknown').length,
    impactedDocuments: documents.length,
    actions: regeneration.length,
  };
  return FreshnessReportSchema.parse({ schemaVersion: 1, evidence, documents, regeneration, summary });
}
