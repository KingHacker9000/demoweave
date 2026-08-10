import fs from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { VisualQAReportSchema, analyzeFreshness } from '@demoweave/core';
import { finalizeVisualQa, prepareVisualQa, RendererError } from '@demoweave/renderer';

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}

function repoRelative(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, '/') || '.';
}

function unsafePortablePath(value: string): boolean {
  const portable = value.replaceAll('\\', '/');
  return !portable || path.isAbsolute(value) || /^[a-zA-Z]:\//.test(portable) || portable.startsWith('//')
    || portable.split('/').some((part) => part === '..');
}

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function loadQaReportSourceId(reference: string, projectRoot: string): Promise<string> {
  if (unsafePortablePath(reference)) throw new RendererError('UNSAFE_QA_REPORT_PATH', `Visual QA report path must be project-relative: ${reference}`);
  const root = await fs.realpath(projectRoot);
  const explicit = reference.includes('/') || reference.includes('\\') || reference.endsWith('.json');
  const relative = explicit ? reference : `.demoweave/qa/reports/${reference}.json`;
  const candidate = path.resolve(root, relative.replaceAll('\\', path.sep));
  if (!insideRoot(root, candidate)) throw new RendererError('UNSAFE_QA_REPORT_PATH', `Visual QA report path must remain inside the project root: ${relative}`);
  let realReport: string;
  try {
    realReport = await fs.realpath(candidate);
  } catch (error) {
    throw new RendererError('QA_REPORT_NOT_FOUND', `Visual QA report does not exist: ${relative}`, { cause: error });
  }
  if (!insideRoot(root, realReport)) throw new RendererError('UNSAFE_QA_REPORT_PATH', `Visual QA report resolves outside the project root: ${relative}`);
  let input: unknown;
  try {
    input = JSON.parse(await fs.readFile(realReport, 'utf8'));
  } catch (error) {
    throw new RendererError('INVALID_QA_REPORT', `Visual QA report is unreadable JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsed = VisualQAReportSchema.safeParse(input);
  if (!parsed.success) throw new RendererError('INVALID_QA_REPORT', `VisualQAReport v1 is invalid: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`);
  return parsed.data.sourceEvidenceId;
}

async function requireFreshEvidence(root: string, evidenceId: string): Promise<void> {
  const freshness = await analyzeFreshness(root);
  const sourceFreshness = freshness.evidence.find((item) => item.evidenceId === evidenceId);
  if (!sourceFreshness) throw new RendererError('EVIDENCE_NOT_FOUND', `Visual QA references missing Evidence: ${evidenceId}`);
  if (sourceFreshness.state !== 'fresh') {
    const reason = sourceFreshness.reasons[0]?.message ?? 'No deterministic fresh baseline is available.';
    throw new RendererError('QA_SOURCE_NOT_FRESH', `Visual QA requires fresh Evidence; ${evidenceId} is ${sourceFreshness.state}. ${reason}`);
  }
}

export function registerQaCommand(program: Command): void {
  const qa = program.command('qa').description('Prepare and finalize agent-reviewed visual QA for media Evidence');

  qa.command('prepare')
    .description('Sample fresh PNG/GIF/MP4 Evidence into a deterministic visual-review packet')
    .argument('<evidence-id>', 'fresh PNG, GIF, or MP4 Evidence id from Manifest v1')
    .option('--project <path>', 'project root', '.')
    .option('--id <id>', 'review id; defaults to <evidence-id>-review')
    .option('--samples <count>', 'uniform sample count for animated media', positiveInteger, 7)
    .action(async (evidenceId, options) => {
      try {
        const root = path.resolve(options.project);
        await requireFreshEvidence(root, evidenceId);
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
        const root = path.resolve(options.project);
        const sourceEvidenceId = await loadQaReportSourceId(reference, root);
        await requireFreshEvidence(root, sourceEvidenceId);
        const result = await finalizeVisualQa(reference, { projectRoot: root });
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
