import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileDeviceId, mobilePlatform } from './runtime-options.js';

test('accepts only the portable mobile platform values', () => {
  assert.equal(mobilePlatform('android'), 'android');
  assert.equal(mobilePlatform('ios'), 'ios');
  assert.throws(() => mobilePlatform('Android'), /Expected android or ios/);
  assert.throws(() => mobilePlatform('web'), /Expected android or ios/);
});

test('requires a non-empty device id without normalizing it', () => {
  assert.equal(mobileDeviceId(' emulator-5554 '), ' emulator-5554 ');
  assert.equal(mobileDeviceId('R58M:transport'), 'R58M:transport');
  assert.throws(() => mobileDeviceId(''), /must be non-empty/);
});
