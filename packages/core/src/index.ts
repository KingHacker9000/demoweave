export { analyzeProject } from './analyzer.js';
export {
  ComponentSchema,
  EcosystemSchema,
  EntrypointSchema,
  ManifestKindSchema,
  ManifestSchema as ProjectManifestSchema,
  ProjectProfileSchema,
  SurfaceSchema,
  SurfaceTypeSchema,
  WorkspaceSchema,
} from './types.js';
export type {
  Component,
  Ecosystem,
  Entrypoint,
  Manifest as ProjectManifest,
  ProjectProfile,
  Surface,
  SurfaceType,
  Workspace,
} from './types.js';

export {
  ActivateStepSchema,
  AssertStepSchema,
  AssertionSchema,
  CaptureStepSchema,
  EvidenceKindSchema,
  FlowSchema,
  FlowStepSchema,
  InputStepSchema,
  InteractionTargetSchema,
  NavigateStepSchema,
  PressStepSchema,
  RunStepSchema,
  ScrollStepSchema,
  TargetStrategySchema,
  WaitConditionSchema,
  WaitStepSchema,
} from './flow.js';
export type {
  Assertion,
  EvidenceKind,
  Flow,
  FlowStep,
  InteractionTarget,
  TargetStrategy,
  WaitCondition,
} from './flow.js';

export {
  EvidenceFormatSchema,
  EvidenceSchema,
  EvidenceStatusSchema,
  ProducerSchema,
  ProvenanceSchema,
  SourceDependencyRoleSchema,
  SourceDependencySchema,
} from './evidence.js';
export type {
  Evidence,
  EvidenceFormat,
  EvidenceStatus,
  Producer,
  Provenance,
  SourceDependency,
  SourceDependencyRole,
} from './evidence.js';

export {
  FlowReferenceSchema,
  ManifestSchema,
  normalizeManifest,
} from './manifest.js';
export type {
  FlowReference,
  Manifest,
} from './manifest.js';

export { validateMetadataBindings } from './validation.js';
export type { FlowFile, MetadataIssue } from './validation.js';

export {
  TerminalCommandSchema,
  TerminalCommandStatusSchema,
  TerminalEventSchema,
  TerminalEventStreamSchema,
  TerminalTrackSchema,
  TerminalTrackStatusSchema,
} from './terminal-track.js';

export {
  DocumentAnchorSchema,
  DocumentOperationSchema,
  DocumentPlanError,
  DocumentPlanSchema,
  applyDocumentPlanFile,
  canonicalDocumentPlan,
  discardDocumentPlanFile,
  inspectMarkdown,
  inspectMarkdownFile,
  normalizeProjectRelativePath,
  parseDocumentPlan,
  previewDocument,
  previewDocumentPlanFile,
} from './document-plan.js';
export type {
  DocumentAnchor,
  DocumentApplyResult,
  DocumentOperation,
  DocumentOperationSummary,
  DocumentPlan,
  DocumentPlanIssue,
  DocumentPreview,
  MarkdownInspection,
  MarkdownSection,
  SourcePoint,
  SourceRange,
} from './document-plan.js';
export type {
  TerminalCommand,
  TerminalCommandStatus,
  TerminalEvent,
  TerminalEventStream,
  TerminalTrack,
  TerminalTrackStatus,
} from './terminal-track.js';
