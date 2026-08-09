import { z } from 'zod';

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
  confidence: z.number().min(0).max(1),
  label: z.string().optional(),
  framework: z.string().optional(),
  command: z.string().optional(),
  packageName: z.string().optional(),
});

export const LanguageStatSchema = z.object({
  name: z.string(),
  files: z.number().int().nonnegative(),
});

export const FrameworkSchema = z.object({
  name: z.string(),
  root: z.string(),
  version: z.string().optional(),
});

export const ProjectProfileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  root: z.string(),
  analyzedAt: z.string().datetime(),
  packageManagers: z.array(z.string()),
  languages: z.array(LanguageStatSchema),
  frameworks: z.array(FrameworkSchema),
  surfaces: z.array(SurfaceSchema),
  commands: z.object({
    install: z.array(z.string()),
    build: z.array(z.string()),
    test: z.array(z.string()),
    run: z.array(z.string()),
  }),
  existingDocs: z.array(z.string()),
});

export type SurfaceType = z.infer<typeof SurfaceTypeSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
