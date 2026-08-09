import { z } from 'zod';

export const TargetStrategySchema = z.enum([
  'text',
  'label',
  'role',
  'name',
  'testId',
  'accessibilityId',
  'automationId',
]);

export const InteractionTargetSchema = z.object({
  strategy: TargetStrategySchema,
  value: z.string().min(1),
  exact: z.boolean().optional(),
}).strict();

export const EvidenceKindSchema = z.enum([
  'screenshot',
  'recording',
  'terminal',
  'image',
  'diagram',
  'plot',
  'table',
  'result',
  'text',
  'code',
  'comparison',
]);

const StepBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
});

export const RunStepSchema = StepBaseSchema.extend({
  type: z.literal('run'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string()).optional(),
}).strict();

export const NavigateStepSchema = StepBaseSchema.extend({
  type: z.literal('navigate'),
  destination: z.string().min(1),
}).strict();

export const ActivateStepSchema = StepBaseSchema.extend({
  type: z.literal('activate'),
  target: InteractionTargetSchema,
}).strict();

export const InputStepSchema = StepBaseSchema.extend({
  type: z.literal('input'),
  target: InteractionTargetSchema,
  value: z.string(),
  clear: z.boolean().optional(),
}).strict();

export const PressStepSchema = StepBaseSchema.extend({
  type: z.literal('press'),
  key: z.string().min(1),
  target: InteractionTargetSchema.optional(),
}).strict();

export const ScrollStepSchema = StepBaseSchema.extend({
  type: z.literal('scroll'),
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().positive().optional(),
  target: InteractionTargetSchema.optional(),
}).strict();

export const WaitConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('duration'), ms: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('visible'), target: InteractionTargetSchema }).strict(),
  z.object({ kind: z.literal('hidden'), target: InteractionTargetSchema }).strict(),
  z.object({ kind: z.literal('text'), value: z.string().min(1), target: InteractionTargetSchema.optional() }).strict(),
  z.object({ kind: z.literal('processExit') }).strict(),
  z.object({ kind: z.literal('fileExists'), path: z.string().min(1) }).strict(),
]);

export const WaitStepSchema = StepBaseSchema.extend({
  type: z.literal('wait'),
  condition: WaitConditionSchema,
  timeoutMs: z.number().int().positive().optional(),
}).strict();

export const AssertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('visible'), target: InteractionTargetSchema }).strict(),
  z.object({ kind: z.literal('hidden'), target: InteractionTargetSchema }).strict(),
  z.object({ kind: z.literal('textContains'), value: z.string().min(1), target: InteractionTargetSchema.optional() }).strict(),
  z.object({
    kind: z.literal('outputContains'),
    stream: z.enum(['stdout', 'stderr', 'combined']),
    value: z.string().min(1),
  }).strict(),
  z.object({ kind: z.literal('exitCode'), value: z.number().int() }).strict(),
  z.object({ kind: z.literal('fileExists'), path: z.string().min(1) }).strict(),
]);

export const AssertStepSchema = StepBaseSchema.extend({
  type: z.literal('assert'),
  assertion: AssertionSchema,
}).strict();

export const CaptureStepSchema = StepBaseSchema.extend({
  type: z.literal('capture'),
  evidenceId: z.string().min(1),
  kind: EvidenceKindSchema,
  target: InteractionTargetSchema.optional(),
}).strict();

export const FlowStepSchema = z.discriminatedUnion('type', [
  RunStepSchema,
  NavigateStepSchema,
  ActivateStepSchema,
  InputStepSchema,
  PressStepSchema,
  ScrollStepSchema,
  WaitStepSchema,
  AssertStepSchema,
  CaptureStepSchema,
]);

export const FlowSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  surfaceId: z.string().min(1),
  steps: z.array(FlowStepSchema).min(1),
}).strict().superRefine((flow, ctx) => {
  const seen = new Set<string>();
  for (let index = 0; index < flow.steps.length; index += 1) {
    const id = flow.steps[index]!.id;
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps', index, 'id'],
        message: `Duplicate Flow step id: ${id}`,
      });
    }
    seen.add(id);
  }
});

export type TargetStrategy = z.infer<typeof TargetStrategySchema>;
export type InteractionTarget = z.infer<typeof InteractionTargetSchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type WaitCondition = z.infer<typeof WaitConditionSchema>;
export type Assertion = z.infer<typeof AssertionSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type Flow = z.infer<typeof FlowSchema>;
