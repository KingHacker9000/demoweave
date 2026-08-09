import type {
  Evidence,
  Flow,
  FlowStep,
  Surface,
  SurfaceType,
} from '@demoweave/core';

export const driverApiVersion = 1 as const;

export type DriverStepType = FlowStep['type'];

export interface DriverDescriptor {
  id: string;
  apiVersion: typeof driverApiVersion;
  surfaceTypes: SurfaceType[];
  stepTypes: DriverStepType[];
}

export interface DriverContext {
  projectRoot: string;
  surface: Surface;
  flow: Flow;
}

export interface DriverError {
  message: string;
  code?: string;
}

export interface DriverStepResult {
  stepId: string;
  status: 'passed' | 'failed' | 'skipped';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  evidence?: Evidence[];
  error?: DriverError;
}

export interface SurfaceDriver {
  readonly descriptor: DriverDescriptor;
  supports(surface: Surface): boolean;
  prepare(context: DriverContext): Promise<void>;
  execute(step: FlowStep, context: DriverContext): Promise<DriverStepResult>;
  close(context: DriverContext): Promise<void>;
}
