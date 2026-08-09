import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FlowSchema,
  ManifestSchema,
  ProjectProfileSchema,
  type Evidence,
  type Flow,
  type ProjectProfile,
} from '@demoweave/core';
import type { DriverContext, DriverError, DriverStepResult, SurfaceDriver } from './index.js';
import { TerminalDriver } from './terminal-driver.js';

export interface FlowExecutionOptions {
  projectRoot?: string;
  commandTimeoutMs?: number;
  drivers?: SurfaceDriver[];
}

export interface FlowExecutionResult {
  status: 'passed' | 'failed';
  flowId: string;
  surfaceId: string;
  surfaceType: string;
  driverId?: string;
  steps: DriverStepResult[];
  evidence: Evidence[];
  error?: DriverError;
}

export class FlowExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'FlowExecutionError';
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function repoRelative(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new FlowExecutionError('FLOW_OUTSIDE_PROJECT', 'Flow files must be inside the project root');
  }
  return (relative || '.').replaceAll(path.sep, '/');
}

async function readJson(target: string, code: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    throw new FlowExecutionError(code, `Could not read ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveFlowPath(projectRoot: string, reference: string): Promise<string> {
  const direct = path.isAbsolute(reference) ? path.normalize(reference) : path.resolve(projectRoot, reference);
  if (await exists(direct)) return direct;

  const manifestPath = path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json');
  if (!(await exists(manifestPath))) {
    throw new FlowExecutionError('FLOW_NOT_FOUND', `Flow ${reference} is not a file and no manifest is available for id lookup`);
  }
  const manifestResult = ManifestSchema.safeParse(await readJson(manifestPath, 'INVALID_MANIFEST'));
  if (!manifestResult.success) {
    throw new FlowExecutionError('INVALID_MANIFEST', `Manifest is invalid: ${manifestResult.error.issues[0]?.message ?? 'unknown error'}`);
  }
  const flowReference = manifestResult.data.flows.find((flow) => flow.id === reference);
  if (!flowReference) throw new FlowExecutionError('FLOW_NOT_FOUND', `Flow id not found in manifest: ${reference}`);
  return path.resolve(projectRoot, flowReference.path);
}

export async function executeFlow(
  projectRoot: string,
  project: ProjectProfile,
  flow: Flow,
  flowPath: string,
  options: Pick<FlowExecutionOptions, 'commandTimeoutMs' | 'drivers'> = {},
): Promise<FlowExecutionResult> {
  const surface = project.surfaces.find((candidate) => candidate.id === flow.surfaceId);
  if (!surface) {
    return {
      status: 'failed',
      flowId: flow.id,
      surfaceId: flow.surfaceId,
      surfaceType: 'unknown',
      steps: flow.steps.map((step) => ({ stepId: step.id, status: 'skipped' })),
      evidence: [],
      error: { code: 'SURFACE_NOT_FOUND', message: `Flow references unknown surface ${flow.surfaceId}` },
    };
  }

  const drivers = options.drivers ?? [new TerminalDriver({
    commandTimeoutMs: options.commandTimeoutMs,
    flowPath: repoRelative(projectRoot, flowPath),
  })];
  const driver = drivers.find((candidate) => candidate.supports(surface));
  if (!driver) {
    return {
      status: 'failed',
      flowId: flow.id,
      surfaceId: surface.id,
      surfaceType: surface.type,
      steps: flow.steps.map((step) => ({ stepId: step.id, status: 'skipped' })),
      evidence: [],
      error: { code: 'DRIVER_NOT_FOUND', message: `No driver supports surface type ${surface.type}` },
    };
  }

  const context: DriverContext = { projectRoot, surface, flow };
  const steps: DriverStepResult[] = [];
  const evidence: Evidence[] = [];
  let error: DriverError | undefined;
  let prepared = false;

  try {
    try {
      await driver.prepare(context);
      prepared = true;
    } catch (prepareError) {
      error = {
        code: 'PREPARE_FAILED',
        message: prepareError instanceof Error ? prepareError.message : String(prepareError),
      };
    }

    if (!error) {
      for (let index = 0; index < flow.steps.length; index += 1) {
        const step = flow.steps[index]!;
        const result = await driver.execute(step, context);
        steps.push(result);
        evidence.push(...(result.evidence ?? []));
        if (result.status === 'failed') {
          error = result.error ?? { code: 'STEP_FAILED', message: `Step ${step.id} failed` };
          for (const skipped of flow.steps.slice(index + 1)) {
            steps.push({ stepId: skipped.id, status: 'skipped' });
          }
          break;
        }
      }
    }
  } finally {
    if (prepared) {
      try {
        await driver.close(context);
      } catch (closeError) {
        error ??= {
          code: 'CLOSE_FAILED',
          message: closeError instanceof Error ? closeError.message : String(closeError),
        };
      }
    }
  }

  if (error && steps.length === 0) {
    steps.push(...flow.steps.map((step) => ({ stepId: step.id, status: 'skipped' as const })));
  }
  return {
    status: error ? 'failed' : 'passed',
    flowId: flow.id,
    surfaceId: surface.id,
    surfaceType: surface.type,
    driverId: driver.descriptor.id,
    steps,
    evidence,
    ...(error ? { error } : {}),
  };
}

export async function runFlow(reference: string, options: FlowExecutionOptions = {}): Promise<FlowExecutionResult> {
  const projectRoot = path.resolve(options.projectRoot ?? '.');
  const projectPath = path.join(projectRoot, '.demoweave', 'project.json');
  const projectResult = ProjectProfileSchema.safeParse(await readJson(projectPath, 'PROJECT_PROFILE_UNAVAILABLE'));
  if (!projectResult.success) {
    throw new FlowExecutionError(
      'INVALID_PROJECT_PROFILE',
      `Project profile is invalid: ${projectResult.error.issues[0]?.message ?? 'unknown error'}`,
    );
  }

  const flowPath = await resolveFlowPath(projectRoot, reference);
  repoRelative(projectRoot, flowPath);
  const flowResult = FlowSchema.safeParse(await readJson(flowPath, 'FLOW_UNAVAILABLE'));
  if (!flowResult.success) {
    throw new FlowExecutionError('INVALID_FLOW', `Flow is invalid: ${flowResult.error.issues[0]?.message ?? 'unknown error'}`);
  }
  return executeFlow(projectRoot, projectResult.data, flowResult.data, flowPath, options);
}
