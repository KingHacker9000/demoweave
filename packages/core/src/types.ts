import { z } from 'zod';

export const EcosystemSchema = z.enum(['node', 'python', 'rust', 'go']);

export const ManifestKindSchema = z.enum([
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pnpm-workspace.yaml',
]);

export const ManifestSchema = z.object({
  kind: ManifestKindSchema,
  path: z.string().min(1),
}).strict();

export const EntrypointSchema = z.object({
  kind: z.enum(['library', 'terminal']),
  name: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
}).strict();

const ComponentBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  root: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  entrypoints: z.array(EntrypointSchema),
}).strict();

export const ComponentSchema = z.discriminatedUnion('ecosystem', [
  ComponentBaseSchema.extend({
    ecosystem: z.literal('node'),
    manifest: z.object({
      kind: z.literal('package.json'),
      path: z.string().min(1),
    }).strict(),
    private: z.boolean(),
    scripts: z.record(z.string()).optional(),
  }).strict(),
  ComponentBaseSchema.extend({
    ecosystem: z.literal('python'),
    manifest: z.object({
      kind: z.literal('pyproject.toml'),
      path: z.string().min(1),
    }).strict(),
  }).strict(),
  ComponentBaseSchema.extend({
    ecosystem: z.literal('rust'),
    manifest: z.object({
      kind: z.literal('Cargo.toml'),
      path: z.string().min(1),
    }).strict(),
  }).strict(),
  ComponentBaseSchema.extend({
    ecosystem: z.literal('go'),
    manifest: z.object({
      kind: z.literal('go.mod'),
      path: z.string().min(1),
    }).strict(),
  }).strict(),
]);

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  ecosystem: EcosystemSchema,
  manifest: ManifestSchema,
  root: z.string().min(1),
  patterns: z.array(z.string().min(1)),
}).strict();

export const SurfaceTypeSchema = z.enum([
  'terminal',
  'web',
  'library',
  'notebook',
  'research',
  'desktop',
  'mobile',
  'service',
  'unknown',
]);

export const SurfaceSchema = z.object({
  id: z.string().min(1),
  type: SurfaceTypeSchema,
  root: z.string().min(1),
  componentId: z.string().min(1).optional(),
  label: z.string().optional(),
  framework: z.string().optional(),
  command: z.string().optional(),
}).strict();

export const LanguageStatSchema = z.object({
  name: z.string(),
  files: z.number().int().nonnegative(),
}).strict();

export const FrameworkSchema = z.object({
  name: z.string(),
  root: z.string(),
  version: z.string().optional(),
}).strict();

export const ProjectProfileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  root: z.string(),
  analyzedAt: z.string().datetime(),
  packageManagers: z.array(z.string()),
  workspaces: z.array(WorkspaceSchema),
  components: z.array(ComponentSchema),
  languages: z.array(LanguageStatSchema),
  frameworks: z.array(FrameworkSchema),
  surfaces: z.array(SurfaceSchema),
  commands: z.object({
    install: z.array(z.string()),
    build: z.array(z.string()),
    test: z.array(z.string()),
    run: z.array(z.string()),
  }).strict(),
  existingDocs: z.array(z.string()),
}).strict();

export type Ecosystem = z.infer<typeof EcosystemSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Entrypoint = z.infer<typeof EntrypointSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type SurfaceType = z.infer<typeof SurfaceTypeSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type Framework = z.infer<typeof FrameworkSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
