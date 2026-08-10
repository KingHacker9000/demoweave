import { z } from 'zod';

const StableIdSchema = z.string().min(1).regex(/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase kebab-case id');
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a six-digit hex color');

export const TimelineEvidenceSourceSchema = z.object({
  kind: z.literal('evidence'),
  evidenceId: StableIdSchema,
}).strict();

export const TimelineFileSourceSchema = z.object({
  kind: z.literal('file'),
  path: z.string().min(1),
}).strict();

export const TimelineSourceSchema = z.discriminatedUnion('kind', [
  TimelineEvidenceSourceSchema,
  TimelineFileSourceSchema,
]);

export const TimelinePaneSchema = z.object({
  id: StableIdSchema,
  source: TimelineSourceSchema,
  fit: z.enum(['contain', 'cover']),
}).strict();

export const SingleLayoutSchema = z.object({
  type: z.literal('single'),
  padding: z.number().int().nonnegative().optional(),
}).strict();

export const SplitLayoutSchema = z.object({
  type: z.literal('split'),
  direction: z.literal('horizontal'),
  gap: z.number().int().nonnegative().optional(),
  padding: z.number().int().nonnegative().optional(),
  ratio: z.number().min(0.1).max(0.9).optional(),
}).strict();

export const TimelineLayoutSchema = z.discriminatedUnion('type', [SingleLayoutSchema, SplitLayoutSchema]);

export const TimelineSceneSchema = z.object({
  id: StableIdSchema,
  durationMs: z.number().int().positive().max(3_600_000),
  transition: z.literal('cut').optional(),
  layout: TimelineLayoutSchema,
  panes: z.array(TimelinePaneSchema).min(1).max(2),
}).strict().superRefine((scene, ctx) => {
  const expectedPanes = scene.layout.type === 'single' ? 1 : 2;
  if (scene.panes.length !== expectedPanes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['panes'],
      message: `${scene.layout.type} layout requires exactly ${expectedPanes} pane${expectedPanes === 1 ? '' : 's'}`,
    });
  }
  const paneIds = new Set<string>();
  scene.panes.forEach((pane, index) => {
    if (paneIds.has(pane.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['panes', index, 'id'], message: `Duplicate pane id: ${pane.id}` });
    }
    paneIds.add(pane.id);
  });
});

export const TimelinePlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  canvas: z.object({
    width: z.number().int().min(64).max(7_680).refine((value) => value % 2 === 0, 'Canvas width must be even'),
    height: z.number().int().min(64).max(4_320).refine((value) => value % 2 === 0, 'Canvas height must be even'),
    fps: z.number().int().min(1).max(60),
    background: ColorSchema,
  }).strict(),
  scenes: z.array(TimelineSceneSchema).min(1),
}).strict().superRefine((plan, ctx) => {
  const sceneIds = new Set<string>();
  plan.scenes.forEach((scene, index) => {
    if (sceneIds.has(scene.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scenes', index, 'id'], message: `Duplicate scene id: ${scene.id}` });
    }
    sceneIds.add(scene.id);

    const padding = scene.layout.padding ?? 36;
    const gap = scene.layout.type === 'split' ? scene.layout.gap ?? 28 : 0;
    if (padding * 2 + gap >= plan.canvas.width || padding * 2 >= plan.canvas.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenes', index, 'layout'],
        message: 'Layout padding and gap leave no usable canvas area',
      });
    }
  });
});

export type TimelineEvidenceSource = z.infer<typeof TimelineEvidenceSourceSchema>;
export type TimelineFileSource = z.infer<typeof TimelineFileSourceSchema>;
export type TimelineSource = z.infer<typeof TimelineSourceSchema>;
export type TimelinePane = z.infer<typeof TimelinePaneSchema>;
export type SingleLayout = z.infer<typeof SingleLayoutSchema>;
export type SplitLayout = z.infer<typeof SplitLayoutSchema>;
export type TimelineLayout = z.infer<typeof TimelineLayoutSchema>;
export type TimelineScene = z.infer<typeof TimelineSceneSchema>;
export type TimelinePlan = z.infer<typeof TimelinePlanSchema>;
