import type { TerminalEventStream, TerminalTrack } from '@demoweave/core';

export type TerminalTextStyle = {
  foreground?: string;
  bold?: boolean;
  dim?: boolean;
};

export type TerminalCell = {
  character: string;
  stream: TerminalEventStream;
  style: TerminalTextStyle;
};

export type TerminalTextRun = {
  text: string;
  stream: TerminalEventStream;
  style: TerminalTextStyle;
};

export type TerminalLine = {
  cells: number;
  runs: TerminalTextRun[];
};

export type PresentationAction = {
  atMs: number;
  stream: TerminalEventStream;
  data: string;
};

export type TerminalPresentation = {
  actions: PresentationAction[];
  durationMs: number;
  finalHoldMs: number;
  framesPerSecond: number;
};

export type TerminalFrameModel = {
  atMs: number;
  columns: number;
  rows: TerminalLine[];
};

export type TerminalLayout = {
  width: number;
  height: number;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  lineHeight: number;
  fontSize: number;
  cellWidth: number;
  visibleRows: number;
};

export type RenderedMedia = {
  format: 'png' | 'gif';
  outputPath: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationMs?: number;
  frameCount?: number;
  evidenceId?: string;
  sourceEvidenceId?: string;
};

export type TerminalRenderSource = {
  track: TerminalTrack;
  sourceEvidenceId?: string;
  sourcePath: string;
};
