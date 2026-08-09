import path from 'node:path';
import type { Command } from 'commander';
import {
  analyzeFreshness,
  snapshotEvidenceArtifact,
  type FreshnessReport,
  type RegenerationAction,
} from '@demoweave/core';
import { runFlow } from '@demoweave/drivers';
import { renderEvidence } from '@demoweave/renderer';

function stateMarker(state: string): string {
  if (state === 'fresh') return 'FRESH';
  if (state === 'stale') return 'STALE';
  if (state === 'missing') return 'MISSING';
  return 'UNKNOWN';
}

export function printFreshnessReport(report: FreshnessReport): void {
  console.log(`Freshness: ${report.summary.fresh} fresh, ${report.summary.stale} stale, ${report.summary.missing} missing, ${report.summary.unknown} unknown`);
  for (const item of report.evidence) {
    console.log(`[${stateMarker(item.state)}] ${item.evidenceId}`);
    for (const reason of item.reasons) console.log(`  - ${reason.message}`);
  }
  if (report.documents.length) {
    console.log('Impacted documents:');
    for (const document of report.documents) console.log(`  - ${document.path} <- ${document.evidenceIds.join(', ')}`);
  }
  if (report.regeneration.length) {
    console.log('Minimal regeneration plan:');
    report.regeneration.forEach((action, index) => {
      if (action.kind === 'run-flow') {
        console.log(`  ${index + 1}. run Flow ${action.flowId} -> ${action.evidenceIds.join(', ')}`);
      } else {
        console.log(`  ${index + 1}. render ${action.sourceEvidenceId} as ${action.format.toUpperCase()} -> ${action.outputPath}`);
      }
    });
  } else {
    console.log('Minimal regeneration plan: no actions required.');
  }
}

export async function showFreshness(projectRoot: string, json = false): Promise<FreshnessReport> {
  const report = await analyzeFreshness(path.resolve(projectRoot));
  if (json) console.log(JSON.stringify(report, null, 2));
  else printFreshnessReport(report);
  return report;
}

async function applyAction(root: string, action: RegenerationAction): Promise<void> {
  if (action.kind === 'run-flow') {
    const result = await runFlow(action.flowId, { projectRoot: root });
    if (result.status !== 'passed') {
      throw new Error(`Flow ${action.flowId} failed: ${result.error?.message ?? 'unknown execution error'}`);
    }
    return;
  }
  const rendered = await renderEvidence(action.sourceEvidenceId, {
    projectRoot: root,
    format: action.format,
    outputPath: action.outputPath,
  });
  if (rendered.evidenceId) await snapshotEvidenceArtifact(root, rendered.evidenceId);
}

export function registerUpdateCommand(program: Command): void {
  program.command('update')
    .description('Explain and selectively regenerate stale DemoWeave evidence')
    .argument('[path]', 'project path', '.')
    .option('--apply', 'execute the computed minimal regeneration plan')
    .option('--json', 'print the before/after report as JSON')
    .action(async (input, options) => {
      const root = path.resolve(input);
      try {
        const before = await analyzeFreshness(root);
        if (!options.apply) {
          if (options.json) console.log(JSON.stringify({ applied: false, before }, null, 2));
          else {
            printFreshnessReport(before);
            if (before.regeneration.length) console.log('Dry run only. Re-run with --apply to execute this plan.');
          }
          return;
        }

        const applied: RegenerationAction[] = [];
        for (const action of before.regeneration) {
          await applyAction(root, action);
          applied.push(action);
        }
        const after = await analyzeFreshness(root);
        if (options.json) {
          console.log(JSON.stringify({ applied: true, actions: applied, before, after }, null, 2));
        } else {
          console.log(`Applied ${applied.length} regeneration action${applied.length === 1 ? '' : 's'}.`);
          printFreshnessReport(after);
        }
        if (after.summary.stale || after.summary.missing) process.exitCode = 1;
      } catch (error) {
        console.error(`UPDATE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
