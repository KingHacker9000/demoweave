import type {
  Evidence,
  EvidenceFormat,
  EvidenceKind,
  Flow,
  FlowStep,
  ProjectProfile,
  Surface,
  SurfaceType,
} from '@demoweave/core';

export const pluginApiVersion = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type PluginOptions = Record<string, JsonValue>;
export type PluginDriverStepType = FlowStep['type'];

export interface PluginDetectorResult {
  surfaces?: Surface[];
  frameworks?: Array<{ name: string; root: string; version?: string }>;
}

export interface PluginDetectorContext {
  projectRoot: string;
  project: Readonly<ProjectProfile>;
  options: Readonly<PluginOptions>;
}

export interface PluginDetectorContribution {
  id: string;
  detect(context: PluginDetectorContext): Promise<PluginDetectorResult> | PluginDetectorResult;
}

export interface PluginEvidenceInput {
  evidenceId: string;
  stepId: string;
  kind: EvidenceKind;
  format: EvidenceFormat;
  mimeType: string;
  data: string | Uint8Array;
  label?: string;
}

export interface PluginEvidenceService {
  writeArtifact(input: PluginEvidenceInput): Promise<Evidence>;
}

export interface PluginDriverContext {
  projectRoot: string;
  surface: Surface;
  flow: Flow;
}

export interface PluginDriverStepResult {
  stepId: string;
  status: 'passed' | 'failed' | 'skipped';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  evidence?: Evidence[];
  error?: { message: string; code?: string };
}

export interface PluginSurfaceDriver {
  supports(surface: Surface): boolean;
  prepare(context: PluginDriverContext): Promise<void>;
  execute(step: FlowStep, context: PluginDriverContext): Promise<PluginDriverStepResult>;
  close(context: PluginDriverContext): Promise<void>;
}

export interface PluginDriverFactoryContext {
  options: Readonly<PluginOptions>;
  evidence: PluginEvidenceService;
}

export interface PluginDriverContribution {
  id: string;
  surfaceTypes: SurfaceType[];
  stepTypes: PluginDriverStepType[];
  create(context: PluginDriverFactoryContext): PluginSurfaceDriver;
}

export interface PluginRegistry {
  registerDetector(contribution: PluginDetectorContribution): void;
  registerDriver(contribution: PluginDriverContribution): void;
}

export interface DemoWeavePlugin {
  id: string;
  apiVersion: typeof pluginApiVersion;
  version?: string;
  register(registry: PluginRegistry): void;
}

export function definePlugin<T extends DemoWeavePlugin>(plugin: T): T {
  return plugin;
}

export type {
  Evidence,
  EvidenceFormat,
  EvidenceKind,
  Flow,
  FlowStep,
  ProjectProfile,
  Surface,
  SurfaceType,
};
