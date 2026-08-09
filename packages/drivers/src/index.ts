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

export {
  ProcessTerminalSession,
} from './terminal-session.js';
export type {
  TerminalOutputStream,
  TerminalSession,
  TerminalSessionResult,
  TerminalSessionRunOptions,
} from './terminal-session.js';

export {
  TerminalDriver,
  terminalDriverVersion,
} from './terminal-driver.js';
export type { TerminalDriverOptions } from './terminal-driver.js';

export {
  WebDriver,
  webDriverVersion,
} from './web-driver.js';
export type { WebDriverOptions } from './web-driver.js';

export {
  executeFlow,
  FlowExecutionError,
  runFlow,
} from './executor.js';
export type {
  FlowExecutionOptions,
  FlowExecutionResult,
} from './executor.js';
