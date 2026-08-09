import type { TerminalTrack } from '@demoweave/core';
import type { PresentationAction, TerminalFrameModel, TerminalPresentation } from './model.js';
import { TerminalReplay } from './terminal-replay.js';

const FRAMES_PER_SECOND = 12;
const FINAL_HOLD_MS = 2_200;
const COMMAND_CHARACTER_MS = 30;
const COMMAND_PAUSE_MS = 320;

function outputPieces(data: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== '\n') continue;
    pieces.push(data.slice(start, index + 1));
    start = index + 1;
  }
  if (start < data.length) pieces.push(data.slice(start));
  return pieces;
}

export function createTerminalPresentation(track: TerminalTrack): TerminalPresentation {
  const actions: PresentationAction[] = [];
  let cursor = 0;

  for (const event of track.events) {
    if (event.stream === 'input') {
      for (const character of event.data) {
        actions.push({ atMs: cursor, stream: event.stream, data: character });
        cursor += character === '\n' ? 80 : COMMAND_CHARACTER_MS;
      }
      cursor += COMMAND_PAUSE_MS;
      continue;
    }

    for (const piece of outputPieces(event.data)) {
      actions.push({ atMs: cursor, stream: event.stream, data: piece });
      const visibleLength = piece.replace(/[\r\n]/g, '').length;
      cursor += Math.max(95, Math.min(190, 70 + visibleLength * 2));
    }
  }

  return {
    actions,
    durationMs: cursor + FINAL_HOLD_MS,
    finalHoldMs: FINAL_HOLD_MS,
    framesPerSecond: FRAMES_PER_SECOND,
  };
}

export function replayPresentation(
  track: TerminalTrack,
  presentation: TerminalPresentation,
  atMs: number,
): TerminalFrameModel {
  const replay = new TerminalReplay(track.columns, track.rows);
  for (const action of presentation.actions) {
    if (action.atMs > atMs) break;
    replay.apply(action.stream, action.data);
  }
  return { atMs, columns: track.columns, rows: replay.snapshot() };
}

export function presentationFrameTimes(presentation: TerminalPresentation): number[] {
  const frameCount = Math.max(1, Math.ceil(presentation.durationMs * presentation.framesPerSecond / 1_000));
  return Array.from({ length: frameCount }, (_, index) => index * 1_000 / presentation.framesPerSecond);
}
