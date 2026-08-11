import type { MobilePlatform } from '@demoweave/drivers';

export function mobilePlatform(value: string): MobilePlatform {
  if (value === 'android' || value === 'ios') return value;
  throw new Error(`Unsupported mobile platform: ${value}. Expected android or ios.`);
}

export function mobileDeviceId(value: string): string {
  if (value.length === 0) throw new Error('Mobile device ID must be non-empty.');
  return value;
}
