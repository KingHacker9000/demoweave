import assert from 'node:assert/strict';
import test from 'node:test';
import { getDesktopHostCapabilities } from './desktop-capabilities.js';

test('detects an interactive Windows session without claiming a backend exists', () => {
  const capability = getDesktopHostCapabilities('win32', { SESSIONNAME: 'Console' });
  assert.deepEqual(capability, {
    platform: 'windows',
    sessionKind: 'windows-session',
    interactiveSession: 'present',
    detail: 'Windows session Console is present.',
  });
});

test('distinguishes Windows service sessions from interactive sessions', () => {
  const capability = getDesktopHostCapabilities('win32', { SESSIONNAME: 'Services' });
  assert.equal(capability.platform, 'windows');
  assert.equal(capability.sessionKind, 'headless');
  assert.equal(capability.interactiveSession, 'absent');
});

test('detects Wayland before X11 and reports a headless Linux host honestly', () => {
  const wayland = getDesktopHostCapabilities('linux', {
    WAYLAND_DISPLAY: 'wayland-0',
    DISPLAY: ':0',
  });
  assert.equal(wayland.sessionKind, 'wayland');
  assert.equal(wayland.interactiveSession, 'present');

  const x11 = getDesktopHostCapabilities('linux', { DISPLAY: ':99' });
  assert.equal(x11.sessionKind, 'x11');
  assert.equal(x11.interactiveSession, 'present');

  const headless = getDesktopHostCapabilities('linux', {});
  assert.equal(headless.sessionKind, 'headless');
  assert.equal(headless.interactiveSession, 'absent');
});

test('does not guess macOS interactive-session availability from platform alone', () => {
  const capability = getDesktopHostCapabilities('darwin', {});
  assert.equal(capability.platform, 'macos');
  assert.equal(capability.sessionKind, 'unknown');
  assert.equal(capability.interactiveSession, 'unknown');
});
