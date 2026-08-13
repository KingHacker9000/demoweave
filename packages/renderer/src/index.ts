export { AnsiTokenizer } from './ansi.js';
export type { TerminalToken } from './ansi.js';
export {
  encodeGif,
  ffmpegVersion,
  RendererError,
  runProcess,
} from './ffmpeg.js';
export type { ProcessResult, ProcessRunner } from './ffmpeg.js';
export type {
  PresentationAction,
  RenderedMedia,
  RenderedTerminalMedia,
  TerminalCell,
  TerminalFrameModel,
  TerminalLayout,
  TerminalLine,
  TerminalPresentation,
  TerminalRenderSource,
  TerminalTextRun,
  TerminalTextStyle,
} from './model.js';
export {
  createTerminalPresentation,
  presentationFrameTimes,
  replayPresentation,
} from './presentation.js';
export { ResvgRasterizer } from './rasterizer.js';
export type { RasterImage, Rasterizer } from './rasterizer.js';
export {
  getRendererCapabilities,
  loadTerminalTrack,
  renderEvidence,
  rendererVersion,
  renderTerminalTrack,
} from './render.js';
export type {
  RenderEvidenceOptions,
  PluginRendererDescriptor,
  PluginRendererHost,
  RendererCapabilities,
  RenderTerminalTrackOptions,
} from './render.js';
export { createTerminalLayout, renderTerminalSvg } from './svg-renderer.js';
export { TerminalReplay } from './terminal-replay.js';

export {
  compileCompositionArguments,
  compileLayout,
  composeTimeline,
  inspectMediaBytes,
  resolveTimeline,
} from './compositor.js';
export type {
  CompiledLayout,
  ComposedMedia,
  ComposeTimelineOptions,
  CompositionFormat,
  MediaInfo,
  PaneRectangle,
  ResolvedTimeline,
  ResolvedTimelinePane,
  ResolvedTimelineScene,
  ResolvedTimelineSource,
} from './compositor.js';

export {
  buildTutorial,
  probeTutorialVideo,
  renderChapters,
  renderDescription,
  renderSrt,
  renderVtt,
  resolveTutorial,
} from './tutorial.js';
export type {
  TutorialBuildOptions,
  TutorialBuildResult,
  VideoProbe,
} from './tutorial.js';

export {
  finalizeVisualQa,
  hashVisualQaPacket,
  prepareVisualQa,
} from './visual-qa.js';
export type {
  FinalizeVisualQaOptions,
  FinalizeVisualQaResult,
  PrepareVisualQaOptions,
  PrepareVisualQaResult,
} from './visual-qa.js';

export const rendererApiVersion = 1;
