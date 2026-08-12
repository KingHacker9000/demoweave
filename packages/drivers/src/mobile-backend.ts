import type { FlowStep } from '@demoweave/core';
import type { DriverContext, DriverError } from './index.js';

export const mobileBackendApiVersion = 1 as const;

export type MobilePlatform = 'android' | 'ios';

export type MobileBackendStep = Extract<FlowStep, {
  type: 'activate' | 'input' | 'press' | 'scroll' | 'wait' | 'assert' | 'capture';
}>;

export type MobileBackendCapability =
  | 'semantic-control'
  | 'text-input'
  | 'keyboard-input'
  | 'scroll'
  | 'screen-capture'
  | 'element-capture';

export interface MobileRuntimeTarget {
  platform: MobilePlatform;
  deviceId?: string;
}

export interface MobileBackendDescriptor {
  id: string;
  apiVersion: typeof mobileBackendApiVersion;
  version?: string;
  platforms: MobilePlatform[];
  stepTypes: MobileBackendStep['type'][];
  capabilities: MobileBackendCapability[];
}

export interface MobileBackendProbe {
  available: boolean;
  reason?: string;
  detail?: string;
}

export interface MobilePngCapture {
  format: 'png';
  bytes: Uint8Array;
  width?: number;
  height?: number;
}

export interface MobileBackendStepResult {
  status: 'passed' | 'failed';
  error?: DriverError;
  capture?: MobilePngCapture;
}

export interface MobileBackend {
  readonly descriptor: MobileBackendDescriptor;
  probe(context: DriverContext, target: MobileRuntimeTarget): Promise<MobileBackendProbe>;
  open(context: DriverContext, target: MobileRuntimeTarget): Promise<void>;
  execute(step: MobileBackendStep, context: DriverContext, target: MobileRuntimeTarget): Promise<MobileBackendStepResult>;
  close(context: DriverContext, target: MobileRuntimeTarget): Promise<void>;
}
