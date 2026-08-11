import type { FlowStep } from '@demoweave/core';
import type { DriverContext, DriverError } from './index.js';
import type { DesktopPlatform } from './desktop-capabilities.js';

export const desktopBackendApiVersion = 1 as const;

export type DesktopBackendStep = Extract<FlowStep, {
  type: 'activate' | 'input' | 'press' | 'scroll' | 'wait' | 'assert' | 'capture';
}>;

export type DesktopBackendCapability =
  | 'semantic-control'
  | 'text-input'
  | 'keyboard-input'
  | 'scroll'
  | 'window-capture'
  | 'element-capture';

export interface DesktopBackendDescriptor {
  id: string;
  apiVersion: typeof desktopBackendApiVersion;
  version?: string;
  platforms: DesktopPlatform[];
  stepTypes: DesktopBackendStep['type'][];
  capabilities: DesktopBackendCapability[];
}

export interface DesktopBackendProbe {
  available: boolean;
  reason?: string;
  detail?: string;
}

export interface DesktopPngCapture {
  format: 'png';
  bytes: Uint8Array;
  width?: number;
  height?: number;
}

export interface DesktopBackendStepResult {
  status: 'passed' | 'failed';
  error?: DriverError;
  capture?: DesktopPngCapture;
}

export interface DesktopBackend {
  readonly descriptor: DesktopBackendDescriptor;
  probe(context: DriverContext): Promise<DesktopBackendProbe>;
  open(context: DriverContext): Promise<void>;
  execute(step: DesktopBackendStep, context: DriverContext): Promise<DesktopBackendStepResult>;
  close(context: DriverContext): Promise<void>;
}
