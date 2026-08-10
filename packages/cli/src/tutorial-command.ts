import path from 'node:path';
import type { Command } from 'commander';
import { buildTutorial, RendererError } from '@demoweave/renderer';

function repoRelative(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, '/') || '.';
}

export function registerTutorialCommand(program: Command): void {
  const tutorial = program.command('tutorial').description('Build deterministic tutorial packages from MP4 Evidence');

  tutorial.command('build')
    .description('Build a TutorialPlan into video, thumbnail, captions, chapters, and upload metadata')
    .argument('<tutorial-id-or-path>', 'TutorialPlan id from .demoweave/tutorials or a project-relative TutorialPlan v1 JSON path')
    .option('--project <path>', 'project root', '.')
    .option('--out-dir <path>', 'project-relative output directory')
    .action(async (reference, options) => {
      try {
        const root = path.resolve(options.project);
        const result = await buildTutorial(reference, {
          projectRoot: root,
          ...(options.outDir ? { outputDirectory: options.outDir } : {}),
        });
        console.log(`Tutorial: ${result.id}`);
        console.log(`Source Evidence: ${result.sourceEvidenceId}`);
        console.log(`Video: ${result.width}x${result.height}, ${(result.durationMs / 1_000).toFixed(2)}s`);
        console.log(`Package: ${repoRelative(root, result.outputDirectory)}`);
        console.log(`  video: ${repoRelative(root, result.videoPath)}`);
        console.log(`  thumbnail: ${repoRelative(root, result.thumbnailPath)}`);
        console.log(`  captions: ${repoRelative(root, result.srtPath)} / ${repoRelative(root, result.vttPath)}`);
        console.log(`  chapters: ${repoRelative(root, result.chaptersPath)}`);
        console.log(`  description: ${repoRelative(root, result.descriptionPath)}`);
        console.log(`  metadata: ${repoRelative(root, result.metadataPath)}`);
        console.log(`Evidence: ${result.evidenceIds.join(', ')}`);
      } catch (error) {
        const code = error instanceof RendererError ? error.code : 'TUTORIAL_BUILD_FAILED';
        console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
