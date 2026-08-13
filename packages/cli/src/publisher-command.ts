import type { Command } from 'commander';
import {
  PublisherError,
  applyPublication,
  previewPublication,
  publicationStatus,
  type PublicationPreview,
  type PublicationStatus,
} from '@demoweave/core';

function reportPublisherError(error: unknown): void {
  const code = error instanceof PublisherError ? error.code : 'PUBLISH_COMMAND_FAILED';
  console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof PublisherError) {
    for (const issue of error.issues) {
      const location = [issue.path, issue.sourcePath, issue.reference].filter(Boolean).join(' / ');
      console.error(`  ${location ? `${location}: ` : ''}${issue.message}`);
    }
  }
  process.exitCode = 1;
}

function printPreview(preview: PublicationPreview): void {
  console.log(`Publisher plan: ${preview.planId}`);
  console.log(`Publisher: ${preview.publisher}`);
  console.log(`Plan hash: ${preview.planHash}`);
  console.log(`Target root: ${preview.targetRoot}`);
  console.log(`Files: ${preview.create.length} create, ${preview.update.length} update, ${preview.unchanged.length} unchanged`);
  for (const file of preview.files) console.log(`  ${file.action.toUpperCase().padEnd(9)} ${file.path} <- ${file.sourcePath}`);
  if (preview.copiedDependencies.length) {
    console.log('Copied dependencies:');
    for (const dependency of preview.copiedDependencies) {
      console.log(`  ${dependency.destinationPath} <- ${dependency.sourcePath} (${dependency.hash})`);
    }
  }
  if (preview.conflicts.length) {
    console.log('Conflicts:');
    for (const conflict of preview.conflicts) console.log(`  ${conflict.code}: ${conflict.path}: ${conflict.message}`);
  }
  for (const diff of preview.diffs) console.log(`\n${diff.unifiedDiff.trimEnd()}`);
  console.log('\nReview token:');
  console.log(preview.reviewToken);
}

function printStatus(status: PublicationStatus): void {
  console.log(`Publication: ${status.planId}`);
  console.log(`Status: ${status.state.toUpperCase()}`);
  for (const reason of status.reasons) console.log(`  - ${reason.code}: ${reason.message}`);
}

export function registerPublisherCommands(program: Command): void {
  const publish = program.command('publish').description('Preview, apply, and inspect deterministic documentation publications');

  publish.command('preview')
    .description('Preview an exact PublisherPlan candidate tree without writing')
    .argument('<plan-id-or-path>', 'PublisherPlan id or project-relative PublisherPlan v1 JSON path')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print structured JSON')
    .action(async (reference, options) => {
      try {
        const preview = await previewPublication(options.project, reference);
        if (options.json) console.log(JSON.stringify(preview, null, 2));
        else printPreview(preview);
      } catch (error) {
        reportPublisherError(error);
      }
    });

  publish.command('apply')
    .description('Apply only the exact publication candidate bound by a review token')
    .argument('<plan-id-or-path>', 'PublisherPlan id or project-relative PublisherPlan v1 JSON path')
    .requiredOption('--review-token <token>', 'review token emitted by publish preview')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print structured JSON')
    .action(async (reference, options) => {
      try {
        const result = await applyPublication(options.project, reference, options.reviewToken);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`Applied publication: ${result.planId}`);
        console.log(`Target root: ${result.targetRoot}`);
        console.log(`Files: ${result.created.length} created, ${result.updated.length} updated, ${result.unchanged.length} unchanged`);
        console.log(`Writes: ${result.writes}`);
        console.log(`Publication manifest: ${result.manifestPath}${result.manifestChanged ? '' : ' (unchanged)'}`);
      } catch (error) {
        reportPublisherError(error);
      }
    });

  publish.command('status')
    .description('Compare a publication plan, sources, dependencies, and target bytes with its baseline')
    .argument('<plan-id-or-path>', 'PublisherPlan id or project-relative PublisherPlan v1 JSON path')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print structured JSON')
    .action(async (reference, options) => {
      try {
        const status = await publicationStatus(options.project, reference);
        if (options.json) console.log(JSON.stringify(status, null, 2));
        else printStatus(status);
      } catch (error) {
        reportPublisherError(error);
      }
    });
}
