import path from 'node:path';
import type { Command } from 'commander';
import {
  DocumentPatchError,
  applyDocumentPlan,
  discardDocumentPlan,
  inspectMarkdownFile,
  previewDocumentPlan,
} from '@demoweave/core';

function fail(error: unknown): void {
  const code = error instanceof DocumentPatchError ? error.code : 'DOCS_FAILED';
  console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function sectionLabel(section: Awaited<ReturnType<typeof inspectMarkdownFile>>['sections'][number]): string {
  if (section.kind === 'preamble') return 'preamble';
  return `H${section.level} ${JSON.stringify(section.heading)} path=${section.headingPath.map((part) => JSON.stringify(part)).join(' > ')}`;
}

export function registerDocsCommands(program: Command): void {
  const docs = program.command('docs').description('Inspect, preview, review, and safely patch Markdown documents');

  docs.command('inspect')
    .description('Inspect a Markdown file into deterministic sections and a SHA-256 base hash')
    .argument('<target>', 'project-relative Markdown path')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print the complete inspection as JSON')
    .action(async (target, options) => {
      try {
        const inspection = await inspectMarkdownFile(options.project, target);
        if (options.json) {
          console.log(JSON.stringify(inspection, null, 2));
          return;
        }
        console.log(`Document: ${inspection.targetPath}`);
        console.log(`Base hash: ${inspection.baseHash}`);
        console.log(`Newline: ${inspection.newline}`);
        console.log(`Trailing newline: ${inspection.trailingNewline ? 'yes' : 'no'}`);
        console.log('Sections:');
        for (const section of inspection.sections) {
          console.log(`  ${section.id}  ${sectionLabel(section)}  [${section.start}, ${section.end})`);
        }
      } catch (error) {
        fail(error);
      }
    });

  docs.command('preview')
    .description('Preview a DocumentPlan without mutating its target and emit a deterministic review token')
    .argument('<plan>', 'project-relative DocumentPlan v1 JSON path')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print the complete preview, including candidate content, as JSON')
    .option('--candidate', 'print the complete candidate document after the diff')
    .action(async (plan, options) => {
      try {
        const preview = await previewDocumentPlan(options.project, plan);
        if (options.json) {
          console.log(JSON.stringify(preview, null, 2));
          return;
        }
        console.log(`Plan: ${preview.plan.id}`);
        console.log(`Target: ${preview.plan.targetPath}`);
        console.log(`Base: ${preview.inspection.baseHash}`);
        console.log(`Candidate: ${preview.candidateHash}`);
        console.log(`Review: ${preview.reviewToken}`);
        console.log('Operations:');
        const byId = new Map(preview.operations.map((operation) => [operation.id, operation]));
        for (const operation of preview.plan.operations) {
          const summary = byId.get(operation.id);
          const selector = operation.type === 'create' ? `${operation.position} ${operation.anchor.sectionId}` : operation.selector.sectionId;
          const reason = operation.type === 'remove' ? ` — ${operation.reason}` : '';
          console.log(`  ${operation.id}: ${operation.type} ${selector}${reason}${summary?.range ? ` [${summary.range[0]}, ${summary.range[1]})` : summary?.insertionAt !== undefined ? ` @${summary.insertionAt}` : ''}`);
        }
        console.log('\nDiff:');
        process.stdout.write(preview.diff);
        if (options.candidate) {
          console.log('\nCandidate:');
          process.stdout.write(preview.candidate);
          if (preview.candidate && !/(?:\r\n|\n|\r)$/.test(preview.candidate)) process.stdout.write('\n');
        }
      } catch (error) {
        fail(error);
      }
    });

  docs.command('apply')
    .description('Atomically apply exactly the DocumentPlan candidate bound to a reviewed token')
    .argument('<plan>', 'project-relative DocumentPlan v1 JSON path')
    .requiredOption('--review <token>', 'review token emitted by demoweave docs preview')
    .option('--project <path>', 'project root', '.')
    .action(async (plan, options) => {
      try {
        const result = await applyDocumentPlan(options.project, plan, options.review);
        console.log(`Applied plan: ${result.planId}`);
        console.log(`Target: ${result.targetPath}`);
        console.log(`Before: ${result.beforeHash}`);
        console.log(`After: ${result.afterHash}`);
        console.log(`Operations applied: ${result.operations.length}`);
      } catch (error) {
        fail(error);
      }
    });

  docs.command('discard')
    .description('Delete a DocumentPlan without touching its target Markdown file')
    .argument('<plan>', 'project-relative DocumentPlan v1 JSON path')
    .option('--project <path>', 'project root', '.')
    .action(async (plan, options) => {
      try {
        await discardDocumentPlan(options.project, plan);
        console.log(`Discarded plan: ${path.normalize(plan).replaceAll(path.sep, '/')}`);
      } catch (error) {
        fail(error);
      }
    });
}
