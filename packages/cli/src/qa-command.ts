import path from 'node:path';
import type { Command } from 'commander';
import { finalizeVisualQa, prepareVisualQa, RendererError } from '@demoweave/renderer';

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}

function repoRelative(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, '/') || '.';
}

export function registerQaCommand(program: Command): void {
  const qa = program.command('qa').description('Prepare and finalize agent-reviewed visual QA for media Evidence');

  qa.command('prepare')
    .description('Sample PNG/GIF/MP4 Evidence into a deterministic visual-review packet')
    .argument('<evidence-id>', 'available PNG, GIF, or MP4 Evidence id from Manifest v1')
    .option('--project <path>', 'project root', '.')
    .option('--id <id>', 'review id; defaults to <evidence-id>-review')
    .option('--samples <count>', 'uniform sample count for animated media', positiveInteger, 7)
    .action(async (evidenceId, options) => {
      try {
        const root = path.resolve(options.project);
        const result = await prepareVisualQa(evidenceId, {
          projectRoot: root,
          ...(options.id ? { id: options.id } : {}),
          sampleCount: options.samples,
        });
        console.log(`Visual QA packet: ${result.id}`);
        console.log(`Source Evidence: ${result.packet.source.evidenceId}`);
        console.log(`Source: ${result.packet.source.width}x${result.packet.source.height}${result.packet.source.durationMs ? `, ${(result.packet.source.durationMs / 1000).toFixed(2)}s` : ''}`);
        console.log(`Samples: ${result.packet.sampling.samples.length}`);
        console.log(`Signals: ${result.packet.signals.length}`);
        console.log(`Packet: ${repoRelative(root, result.packetPath)}`);
        console.log(`Contact sheet: ${repoRelative(root, result.contactSheetPath)}`);
        console.log(`Report: ${repoRelative(root, result.reportPath)}${result.reportCreated ? ' (created pending template)' : ' (existing report preserved)'}`);
        console.log(`Packet hash: ${result.packetHash}`);
        console.log('Next: inspect the contact sheet/sample frames, edit the report findings/verdict, then run `demoweave qa finalize <report-id-or-path>`.');
      } catch (error) {
        const code = error instanceof RendererError ? error.code : 'QA_PREPARE_FAILED';
        console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  qa.command('finalize')
    .description('Validate an agent-authored visual QA report against its exact prepared packet/source and record it as Evidence')
    .argument('<report-id-or-path>', 'report id from .demoweave/qa/reports or a project-relative VisualQAReport v1 JSON path')
    .option('--project <path>', 'project root', '.')
    .action(async (reference, options) => {
      try {
        const result = await finalizeVisualQa(reference, { projectRoot: options.project });
        console.log(`Visual QA: ${result.report.id}`);
        console.log(`Verdict: ${result.verdict.toUpperCase()}`);
        console.log(`Findings: ${result.report.findings.length}`);
        console.log(`Evidence: ${result.evidenceId}`);
        console.log(`Report: ${result.evidencePath}`);
        if (result.verdict === 'needs-changes') process.exitCode = 1;
      } catch (error) {
        const code = error instanceof RendererError ? error.code : 'QA_FINALIZE_FAILED';
        console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
