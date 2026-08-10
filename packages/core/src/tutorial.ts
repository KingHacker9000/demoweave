import { z } from 'zod';

const StableIdSchema = z.string().min(1).regex(/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase kebab-case id');
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a six-digit hex color');
const TimestampSchema = z.number().int().nonnegative().max(86_400_000);

export const TutorialOutputKeySchema = z.enum([
  'video',
  'thumbnail',
  'captions-srt',
  'captions-vtt',
  'chapters',
  'description',
  'metadata',
]);
export type TutorialOutputKey = z.infer<typeof TutorialOutputKeySchema>;

export function tutorialOutputEvidenceIds(tutorialId: string): Record<TutorialOutputKey, string> {
  return {
    video: `${tutorialId}-video`,
    thumbnail: `${tutorialId}-thumbnail`,
    'captions-srt': `${tutorialId}-captions-srt`,
    'captions-vtt': `${tutorialId}-captions-vtt`,
    chapters: `${tutorialId}-chapters`,
    description: `${tutorialId}-description`,
    metadata: `${tutorialId}-metadata`,
  };
}

export const TutorialVideoSourceSchema = z.object({
  evidenceId: StableIdSchema,
}).strict();

export const TutorialCaptionCueSchema = z.object({
  id: StableIdSchema,
  startMs: TimestampSchema,
  endMs: TimestampSchema,
  text: z.string().min(1).max(500),
}).strict().refine((cue) => cue.endMs > cue.startMs, {
  message: 'Caption endMs must be greater than startMs',
  path: ['endMs'],
});

export const TutorialChapterSchema = z.object({
  startMs: TimestampSchema,
  title: z.string().min(1).max(120),
}).strict();

export const TutorialMetadataSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(5_000),
  language: z.string().min(2).max(35).regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, 'Expected a BCP-47-style language tag'),
  tags: z.array(z.string().min(1).max(60)).max(30).optional(),
}).strict().superRefine((metadata, ctx) => {
  if (metadata.tags && new Set(metadata.tags.map((tag) => tag.toLocaleLowerCase())).size !== metadata.tags.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tags'], message: 'Tutorial tags must be unique ignoring case' });
  }
});

export const TutorialThumbnailSchema = z.object({
  atMs: TimestampSchema,
  width: z.number().int().min(320).max(3_840).refine((value) => value % 2 === 0, 'Thumbnail width must be even'),
  height: z.number().int().min(180).max(2_160).refine((value) => value % 2 === 0, 'Thumbnail height must be even'),
  fit: z.enum(['contain', 'cover']),
  background: ColorSchema,
  title: z.string().min(1).max(100).optional(),
  subtitle: z.string().min(1).max(160).optional(),
}).strict();

export const TutorialPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableIdSchema,
  video: TutorialVideoSourceSchema,
  metadata: TutorialMetadataSchema,
  thumbnail: TutorialThumbnailSchema,
  captions: z.array(TutorialCaptionCueSchema).min(1),
  chapters: z.array(TutorialChapterSchema).min(1),
}).strict().superRefine((plan, ctx) => {
  const generatedIds = Object.values(tutorialOutputEvidenceIds(plan.id));
  if (generatedIds.includes(plan.video.evidenceId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['video', 'evidenceId'],
      message: `Source Evidence id ${plan.video.evidenceId} collides with a generated tutorial Evidence id`,
    });
  }

  const captionIds = new Set<string>();
  let previousCaptionEnd = -1;
  plan.captions.forEach((cue, index) => {
    if (captionIds.has(cue.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['captions', index, 'id'], message: `Duplicate caption id: ${cue.id}` });
    }
    captionIds.add(cue.id);
    if (cue.startMs < previousCaptionEnd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['captions', index, 'startMs'], message: 'Caption cues must be ordered and non-overlapping' });
    }
    previousCaptionEnd = Math.max(previousCaptionEnd, cue.endMs);
  });

  if (plan.chapters[0]?.startMs !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chapters', 0, 'startMs'], message: 'The first chapter must start at 0ms' });
  }
  plan.chapters.forEach((chapter, index) => {
    if (index > 0 && chapter.startMs <= plan.chapters[index - 1]!.startMs) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chapters', index, 'startMs'], message: 'Chapter start times must be strictly increasing' });
    }
  });
});

export type TutorialVideoSource = z.infer<typeof TutorialVideoSourceSchema>;
export type TutorialCaptionCue = z.infer<typeof TutorialCaptionCueSchema>;
export type TutorialChapter = z.infer<typeof TutorialChapterSchema>;
export type TutorialMetadata = z.infer<typeof TutorialMetadataSchema>;
export type TutorialThumbnail = z.infer<typeof TutorialThumbnailSchema>;
export type TutorialPlan = z.infer<typeof TutorialPlanSchema>;
