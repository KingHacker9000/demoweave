import type { ProjectProfile } from './types.js';
import type { Flow } from './flow.js';
import type { Manifest } from './manifest.js';

export type FlowFile = {
  path: string;
  flow: Flow;
};

export type MetadataIssue = {
  path: string;
  message: string;
};

export function validateMetadataBindings(
  project: ProjectProfile,
  flowFiles: FlowFile[],
  manifest?: Manifest,
): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  const surfaces = new Set(project.surfaces.map((surface) => surface.id));
  const flows = new Map<string, FlowFile>();

  for (const file of flowFiles) {
    if (flows.has(file.flow.id)) {
      issues.push({
        path: file.path,
        message: `Duplicate Flow id: ${file.flow.id}`,
      });
      continue;
    }
    flows.set(file.flow.id, file);

    if (!surfaces.has(file.flow.surfaceId)) {
      issues.push({
        path: file.path,
        message: `Flow ${file.flow.id} references unknown surface ${file.flow.surfaceId}`,
      });
    }
  }

  if (!manifest) return issues;

  const manifestFlows = new Map(manifest.flows.map((reference) => [reference.id, reference]));
  const evidence = new Map(manifest.evidence.map((item) => [item.id, item]));

  for (const [flowId, file] of flows) {
    const reference = manifestFlows.get(flowId);
    if (!reference) {
      issues.push({
        path: file.path,
        message: `Flow ${flowId} is not indexed by the manifest`,
      });
      continue;
    }
    if (reference.path !== file.path) {
      issues.push({
        path: `manifest.flows.${flowId}.path`,
        message: `Manifest path ${reference.path} does not match Flow file ${file.path}`,
      });
    }
    if (reference.surfaceId !== file.flow.surfaceId) {
      issues.push({
        path: `manifest.flows.${flowId}.surfaceId`,
        message: `Manifest surface ${reference.surfaceId} does not match Flow surface ${file.flow.surfaceId}`,
      });
    }
  }

  for (const reference of manifest.flows) {
    if (!flows.has(reference.id)) {
      issues.push({
        path: `manifest.flows.${reference.id}`,
        message: `Manifest references missing Flow ${reference.id}`,
      });
    }
    if (!surfaces.has(reference.surfaceId)) {
      issues.push({
        path: `manifest.flows.${reference.id}.surfaceId`,
        message: `Manifest references unknown surface ${reference.surfaceId}`,
      });
    }
  }

  for (const item of manifest.evidence) {
    const provenance = item.provenance;
    if (provenance.surfaceId && !surfaces.has(provenance.surfaceId)) {
      issues.push({
        path: `manifest.evidence.${item.id}.provenance.surfaceId`,
        message: `Evidence ${item.id} references unknown surface ${provenance.surfaceId}`,
      });
    }

    if (provenance.flowId) {
      const flowFile = flows.get(provenance.flowId);
      if (!flowFile) {
        issues.push({
          path: `manifest.evidence.${item.id}.provenance.flowId`,
          message: `Evidence ${item.id} references missing Flow ${provenance.flowId}`,
        });
      } else {
        if (provenance.stepId && !flowFile.flow.steps.some((step) => step.id === provenance.stepId)) {
          issues.push({
            path: `manifest.evidence.${item.id}.provenance.stepId`,
            message: `Evidence ${item.id} references missing step ${provenance.stepId}`,
          });
        }
        if (provenance.surfaceId && provenance.surfaceId !== flowFile.flow.surfaceId) {
          issues.push({
            path: `manifest.evidence.${item.id}.provenance.surfaceId`,
            message: `Evidence ${item.id} surface does not match its Flow surface`,
          });
        }
      }
    }

    for (const parentId of item.derivedFrom ?? []) {
      if (!evidence.has(parentId)) {
        issues.push({
          path: `manifest.evidence.${item.id}.derivedFrom`,
          message: `Evidence ${item.id} derives from missing Evidence ${parentId}`,
        });
      }
    }
  }

  for (const file of flowFiles) {
    for (const step of file.flow.steps) {
      if (step.type !== 'capture') continue;
      const item = evidence.get(step.evidenceId);
      if (!item) {
        issues.push({
          path: `${file.path}#${step.id}`,
          message: `Capture step references Evidence ${step.evidenceId}, which is absent from the manifest`,
        });
        continue;
      }
      if (item.kind !== step.kind) {
        issues.push({
          path: `${file.path}#${step.id}`,
          message: `Capture step kind ${step.kind} does not match Evidence kind ${item.kind}`,
        });
      }
    }
  }

  return issues;
}
