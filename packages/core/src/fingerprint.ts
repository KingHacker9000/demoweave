import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FlowSchema } from './flow.js';
import { ManifestSchema, normalizeManifest, type Manifest } from './manifest.js';
import type { Evidence } from './evidence.js';

function sha256(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveInside(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error(`Dependency path must be project-relative: ${relative}`);
  const target = path.resolve(root, relative);
  if (!insideRoot(root, target)) throw new Error(`Dependency path escapes project root: ${relative}`);
  return target;
}

async function hashFile(target: string): Promise<string | undefined> {
  try {
    return sha256(await fs.readFile(target));
  } catch {
    return undefined;
  }
}

async function readManifest(root: string): Promise<{ path: string; manifest: Manifest }> {
  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  return {
    path: manifestPath,
    manifest: ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8'))),
  };
}

async function writeManifest(target: string, manifest: Manifest): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.fingerprint.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`, 'utf8');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function snapshotFlowEvidence(projectRoot: string, flowId: string): Promise<Evidence[]> {
  const root = path.resolve(projectRoot);
  const { path: manifestPath, manifest } = await readManifest(root);
  const reference = manifest.flows.find((flow) => flow.id === flowId);
  if (!reference) return [];
  const flowPath = resolveInside(root, reference.path);
  const flowBytes = await fs.readFile(flowPath);
  const flow = FlowSchema.parse(JSON.parse(flowBytes.toString('utf8')));
  const sources = await Promise.all((flow.sources ?? []).map(async (dependency) => {
    const dependencyHash = await hashFile(resolveInside(root, dependency.path));
    return { ...dependency, ...(dependencyHash ? { hash: dependencyHash } : {}) };
  }));

  const updated: Evidence[] = [];
  const evidence = await Promise.all(manifest.evidence.map(async (item) => {
    if (item.provenance.flowId !== flowId || item.derivedFrom?.length) return item;
    const artifactHash = item.path ? await hashFile(resolveInside(root, item.path)) : undefined;
    const next: Evidence = {
      ...item,
      ...(artifactHash ? { artifactHash } : {}),
      provenance: {
        ...item.provenance,
        flowHash: sha256(flowBytes),
        sources,
      },
    };
    updated.push(next);
    return next;
  }));
  await writeManifest(manifestPath, { ...manifest, evidence });
  return updated.sort((a, b) => a.id.localeCompare(b.id));
}

export async function snapshotEvidenceArtifact(projectRoot: string, evidenceId: string): Promise<Evidence> {
  const root = path.resolve(projectRoot);
  const { path: manifestPath, manifest } = await readManifest(root);
  const current = manifest.evidence.find((item) => item.id === evidenceId);
  if (!current) throw new Error(`Evidence not found: ${evidenceId}`);
  if (!current.path) throw new Error(`Evidence has no artifact path: ${evidenceId}`);
  const artifactHash = await hashFile(resolveInside(root, current.path));
  if (!artifactHash) throw new Error(`Evidence artifact is missing: ${current.path}`);
  const next: Evidence = { ...current, artifactHash };
  await writeManifest(manifestPath, {
    ...manifest,
    evidence: manifest.evidence.map((item) => item.id === evidenceId ? next : item),
  });
  return next;
}
