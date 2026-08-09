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
  FlowSourceDependencyRoleSchema,
  FlowSourceDependencySchema,
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
  FlowSourceDependency,
  FlowSourceDependencyRole,
  FlowStep,
  InteractionTarget,
  TargetStrategy,
  WaitCondition,
} from './flow.js';

export {
  ContentHashSchema,
  EvidenceFormatSchema,
  EvidenceSchema,
  EvidenceStatusSchema,
  ProducerSchema,
  ProvenanceSchema,
  SourceDependencyRoleSchema,
  SourceDependencySchema,
} from './evidence.js';
export type {
  ContentHash,
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
  CreateDocumentOperationSchema,
  DocumentAnchorSchema,
  DocumentNewlineSchema,
  DocumentOperationSchema,
  DocumentPatchError,
  DocumentPlanError,
  DocumentPlanSchema,
  DocumentSectionSchema,
  EditDocumentOperationSchema,
  MarkdownDocumentInspectionSchema,
  PreserveDocumentOperationSchema,
  RemoveDocumentOperationSchema,
  ReplaceDocumentOperationSchema,
  SectionSelectorSchema,
  applyDocumentPlan,
  applyDocumentPlanFile,
  canonicalDocumentPlan,
  createUnifiedDiff,
  discardDocumentPlan,
  discardDocumentPlanFile,
  hashDocumentSource,
  inspectMarkdown,
  inspectMarkdownFile,
  inspectMarkdownSource,
  normalizeProjectRelativePath,
  parseDocumentPlan,
  previewDocument,
  previewDocumentPlan,
  previewDocumentPlanFile,
  resolveProjectFile,
  validateDocumentPlanFile,
} from './document-plan.js';
export type {
  DocumentAnchor,
  DocumentApplyResult,
  DocumentNewline,
  DocumentOperation,
  DocumentOperationSummary,
  DocumentPlan,
  DocumentPlanIssue,
  DocumentPreview,
  DocumentSection,
  MarkdownDocumentInspection,
  MarkdownInspection,
  MarkdownSection,
  SectionSelector,
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
export {
  DocumentImpactSchema,
  EvidenceFreshnessSchema,
  FreshnessReasonCodeSchema,
  FreshnessReasonSchema,
  FreshnessReportSchema,
  FreshnessStateSchema,
  RegenerationActionSchema,
  analyzeFreshness,
} from './freshness.js';
export type {
  DocumentImpact,
  EvidenceFreshness,
  FreshnessReason,
  FreshnessReport,
  FreshnessState,
  RegenerationAction,
} from './freshness.js';

export {
  snapshotEvidenceArtifact,
  snapshotFlowEvidence,
} from './fingerprint.js';
