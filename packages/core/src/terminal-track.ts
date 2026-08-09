import { z } from 'zod';

export const TerminalEventStreamSchema = z.enum(['input', 'stdout', 'stderr']);

export const TerminalEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  t: z.number().int().nonnegative(),
  stepId: z.string().min(1),
  stream: TerminalEventStreamSchema,
  data: z.string(),
}).strict();

export const TerminalCommandStatusSchema = z.enum([
  'completed',
  'failed',
  'timedOut',
  'spawnFailed',
]);

export const TerminalCommandSchema = z.object({
  stepId: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  status: TerminalCommandStatusSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().min(1).optional(),
}).strict().superRefine((command, ctx) => {
  if (command.status === 'completed' && command.exitCode !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['exitCode'],
      message: 'A completed terminal command must have exit code 0',
    });
  }
  if (command.status === 'failed' && command.exitCode === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['exitCode'],
      message: 'A failed terminal command cannot have exit code 0',
    });
  }
  if (command.status === 'failed' && command.exitCode === null && !command.signal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signal'],
      message: 'A failed terminal command without an exit code requires a signal',
    });
  }
});

export const TerminalTrackStatusSchema = z.enum(['completed', 'failed', 'timedOut', 'spawnFailed']);

export const TerminalTrackSchema = z.object({
  schemaVersion: z.literal(1),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  mode: z.literal('pipe'),
  commands: z.array(TerminalCommandSchema).min(1),
  events: z.array(TerminalEventSchema).min(1),
  status: TerminalTrackStatusSchema,
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
}).strict().superRefine((track, ctx) => {
  const stepIds = new Set(track.commands.map((command) => command.stepId));
  let previousTime = 0;
  for (let index = 0; index < track.events.length; index += 1) {
    const event = track.events[index]!;
    if (event.sequence !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 'sequence'],
        message: `Terminal event sequence must be contiguous; expected ${index}`,
      });
    }
    if (event.t < previousTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 't'],
        message: 'Terminal event timestamps must be nondecreasing',
      });
    }
    if (!stepIds.has(event.stepId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['events', index, 'stepId'],
        message: `Terminal event references unknown run step ${event.stepId}`,
      });
    }
    previousTime = event.t;
  }

  const last = track.commands.at(-1)!;
  if (track.status !== last.status || track.exitCode !== last.exitCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'Terminal track completion must match its final command',
    });
  }
});

export type TerminalEventStream = z.infer<typeof TerminalEventStreamSchema>;
export type TerminalEvent = z.infer<typeof TerminalEventSchema>;
export type TerminalCommandStatus = z.infer<typeof TerminalCommandStatusSchema>;
export type TerminalCommand = z.infer<typeof TerminalCommandSchema>;
export type TerminalTrackStatus = z.infer<typeof TerminalTrackStatusSchema>;
export type TerminalTrack = z.infer<typeof TerminalTrackSchema>;
