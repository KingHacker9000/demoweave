export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'unsupported';
export type DesktopSessionKind = 'windows-session' | 'x11' | 'wayland' | 'headless' | 'unknown';
export type InteractiveSessionHint = 'present' | 'absent' | 'unknown';

export interface DesktopHostCapabilities {
  platform: DesktopPlatform;
  sessionKind: DesktopSessionKind;
  interactiveSession: InteractiveSessionHint;
  detail?: string;
}

function desktopPlatform(platform: NodeJS.Platform): DesktopPlatform {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

export function getDesktopHostCapabilities(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): DesktopHostCapabilities {
  const normalized = desktopPlatform(platform);

  if (normalized === 'windows') {
    const sessionName = environment.SESSIONNAME?.trim();
    if (!sessionName) {
      return {
        platform: normalized,
        sessionKind: 'unknown',
        interactiveSession: 'unknown',
        detail: 'SESSIONNAME is not available; interactive desktop availability is unresolved.',
      };
    }
    if (/^services?$/i.test(sessionName)) {
      return {
        platform: normalized,
        sessionKind: 'headless',
        interactiveSession: 'absent',
        detail: `Windows session ${sessionName} is a service session.`,
      };
    }
    return {
      platform: normalized,
      sessionKind: 'windows-session',
      interactiveSession: 'present',
      detail: `Windows session ${sessionName} is present.`,
    };
  }

  if (normalized === 'linux') {
    if (environment.WAYLAND_DISPLAY?.trim()) {
      return {
        platform: normalized,
        sessionKind: 'wayland',
        interactiveSession: 'present',
        detail: `WAYLAND_DISPLAY=${environment.WAYLAND_DISPLAY.trim()}`,
      };
    }
    if (environment.DISPLAY?.trim()) {
      return {
        platform: normalized,
        sessionKind: 'x11',
        interactiveSession: 'present',
        detail: `DISPLAY=${environment.DISPLAY.trim()}`,
      };
    }
    return {
      platform: normalized,
      sessionKind: 'headless',
      interactiveSession: 'absent',
      detail: 'Neither WAYLAND_DISPLAY nor DISPLAY is present.',
    };
  }

  if (normalized === 'macos') {
    return {
      platform: normalized,
      sessionKind: 'unknown',
      interactiveSession: 'unknown',
      detail: 'macOS interactive-session probing requires the native backend; host platform alone is not enough.',
    };
  }

  return {
    platform: normalized,
    sessionKind: 'unknown',
    interactiveSession: 'absent',
    detail: `Unsupported desktop host platform: ${platform}`,
  };
}
