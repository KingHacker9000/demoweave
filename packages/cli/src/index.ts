#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  analyzeProject,
  DocumentPlanSchema,
  FlowSchema,
  ManifestSchema,
  ProjectProfileSchema,
  snapshotEvidenceArtifact,
  validateMetadataBindings,
  type FlowFile,
} from '@demoweave/core';
import { FlowExecutionError, getWebDriverCapabilities, runFlow } from '@demoweave/drivers';
import {
  getRendererCapabilities,
  renderEvidence,
  RendererError,
} from '@demoweave/renderer';
import { registerDocsCommands } from './docs.js';
import { registerUpdateCommand, showFreshness } from './freshness.js';

const program = new Command();
program.name('demoweave').description('Agent-native documentation tooling for software repositories').version('0.0.1');

function commandAvailable(command: string): { ok: boolean; version?: string } {
  if (command === 'node') return { ok: true, version: `v${process.versions.node}` };
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true });
  return {
    ok: result.status === 0,
    version: (result.stdout || result.stderr || '').trim().split('\n')[0] || undefined,
  };
}

function renderFormat(value: string): 'png' | 'gif' {
  if (value === 'png' || value === 'gif') return value;
  throw new Error(`Unsupported render format: ${value}. Expected png or gif.`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(2)} MiB`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(root: string) {
  await fs.mkdir(path.join(root, '.demoweave'), { recursive: true });
}

function repoRelative(root: string, target: string): string {
  return path.relative(root, target).replaceAll(path.sep, '/') || '.';
}

async function listJsonFiles(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const files: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}

program.command('doctor').description('Check local DemoWeave prerequisites').action(async () => {
  const checks = [
    ['node', true],
    ['git', true],
    ['pnpm', false],
  ] as const;
  let failedRequired = false;
  console.log('DemoWeave doctor\n');
  for (const [command, required] of checks) {
    const result = commandAvailable(command);
    const status = result.ok ? 'OK' : required ? 'MISSING' : 'OPTIONAL';
    console.log(`${status.padEnd(8)} ${command}${result.version ? `  ${result.version}` : ''}`);
    if (required && !result.ok) failedRequired = true;
  }
  const renderer = await getRendererCapabilities();
  console.log(`${'OK'.padEnd(8)} renderer PNG  headless SVG rasterization`);
  const ffmpegStatus = renderer.gif ? 'OK' : 'OPTIONAL';
  console.log(`${ffmpegStatus.padEnd(8)} ffmpeg GIF${renderer.ffmpegVersion ? `  ${renderer.ffmpegVersion}` : '  not found; install FFmpeg to enable GIF rendering'}`);
  const web = await getWebDriverCapabilities();
  const webStatus = web.chromium ? 'OK' : 'OPTIONAL';
  console.log(`${webStatus.padEnd(8)} playwright web${web.chromium ? '  Chromium ready' : '  Chromium not installed; run: pnpm --filter @demoweave/drivers exec playwright install chromium'}`);
  if (failedRequired) process.exitCode = 1;
});

program.command('init').description('Initialize DemoWeave metadata in a repository').argument('[path]', 'project path', '.').action(async (input) => {
  const root = path.resolve(input);
  const metadataRoot = path.join(root, '.demoweave');
  const flowDir = path.join(metadataRoot, 'flows');
  const evidenceDir = path.join(metadataRoot, 'evidence');
  const planDir = path.join(metadataRoot, 'plans');
  await fs.mkdir(flowDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.mkdir(planDir, { recursive: true });

  const configPath = path.join(metadataRoot, 'config.json');
  if (!(await exists(configPath))) {
    await fs.writeFile(configPath, `${JSON.stringify({ schemaVersion: 1, mediaDir: 'docs-media' }, null, 2)}\n`);
  }

  const manifestPath = path.join(evidenceDir, 'manifest.json');
  if (!(await exists(manifestPath))) {
    const manifest = {
      schemaVersion: 1,
      projectProfileVersion: 1,
      flows: [],
      evidence: [],
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`Initialized ${repoRelative(process.cwd(), metadataRoot)}`);
  console.log(`Flows: ${repoRelative(process.cwd(), flowDir)}`);
  console.log(`Document plans: ${repoRelative(process.cwd(), planDir)}`);
  console.log(`Evidence manifest: ${repoRelative(process.cwd(), manifestPath)}`);
});

program.command('inspect').description('Analyze a repository and write .demoweave/project.json').argument('[path]', 'project path', '.').option('--stdout', 'print JSON instead of writing it').action(async (input, options) => {
  const root = path.resolve(input);
  const profile = await analyzeProject(root);
  if (options.stdout) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }
  await ensureDir(root);
  const output = path.join(root, '.demoweave', 'project.json');
  await fs.writeFile(output, `${JSON.stringify(profile, null, 2)}\n`);
  console.log(`DemoWeave inspected ${profile.name}`);
  console.log(`Languages: ${profile.languages.map((x) => `${x.name} (${x.files})`).join(', ') || 'none detected'}`);
  console.log('Detected surfaces:');
  if (!profile.surfaces.length) console.log('  - none detected');
  for (const surface of profile.surfaces) {
    const detail = surface.command ?? surface.framework ?? surface.label ?? surface.root;
    console.log(`  - ${surface.type.padEnd(10)} ${detail}`);
  }
  console.log(`Wrote ${repoRelative(process.cwd(), output)}`);
});

program.command('status')
  .description('Show metadata status and explain evidence freshness')
  .argument('[path]', 'project path', '.')
  .option('--json', 'print freshness as JSON')
  .action(async (input, options) => {
    const root = path.resolve(input);
    const projectPath = path.join(root, '.demoweave', 'project.json');
    try {
      const parsed = ProjectProfileSchema.parse(JSON.parse(await fs.readFile(projectPath, 'utf8')));
      if (!options.json) {
        console.log(`Project profile: current file present (schema v${parsed.schemaVersion})`);
        console.log(`Surfaces: ${parsed.surfaces.length}`);
      }
    } catch {
      console.error('Project profile unavailable or invalid. Run: demoweave inspect .');
      process.exitCode = 1;
      return;
    }

    const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
    if (!(await exists(manifestPath))) {
      console.log('Evidence manifest: not initialized');
      return;
    }
    const result = ManifestSchema.safeParse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
    if (!result.success) {
      console.log('Evidence manifest: invalid (run demoweave validate .)');
      process.exitCode = 1;
      return;
    }
    if (!options.json) {
      console.log(`Flows indexed: ${result.data.flows.length}`);
      console.log(`Evidence indexed: ${result.data.evidence.length}`);
    }
    try {
      await showFreshness(root, Boolean(options.json));
    } catch (error) {
      console.error(`FRESHNESS_FAILED: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

program.command('run')
  .description('Execute a DemoWeave Flow with a compatible surface driver')
  .argument('<flow-id-or-path>', 'Flow id from the manifest or path to a Flow v1 JSON file')
  .option('--project <path>', 'project root', '.')
  .option('--timeout <ms>', 'default driver action timeout in milliseconds', positiveInteger, 30_000)
  .option('--base-url <url>', 'base URL for relative web navigation')
  .option('--headed', 'show the browser window while running web Flows')
  .action(async (reference, options) => {
    try {
      const result = await runFlow(reference, {
        projectRoot: options.project,
        commandTimeoutMs: options.timeout,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        headless: !options.headed,
      });
      console.log(`Flow: ${result.flowId}`);
      console.log(`Surface: ${result.surfaceId} (${result.surfaceType})`);
      console.log(`Driver: ${result.driverId ?? 'none'}`);
      for (const step of result.steps) {
        const marker = step.status === 'passed' ? 'PASS' : step.status === 'failed' ? 'FAIL' : 'SKIP';
        console.log(`[${marker}] ${step.stepId}${step.exitCode === undefined ? '' : ` (exit ${step.exitCode})`}`);
        if (step.error) console.error(`       ${step.error.code ?? 'ERROR'}: ${step.error.message}`);
        for (const evidence of step.evidence ?? []) console.log(`       Evidence: ${evidence.path ?? evidence.id}`);
      }
      if (result.error && !result.steps.some((step) => step.error)) {
        console.error(`${result.error.code ?? 'ERROR'}: ${result.error.message}`);
      }
      console.log(`Final: ${result.status.toUpperCase()}`);
      if (result.status === 'failed') process.exitCode = 1;
    } catch (error) {
      const code = error instanceof FlowExecutionError ? error.code : 'RUN_FAILED';
      console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

program.command('render')
  .description('Render terminal Evidence to a polished media asset')
  .argument('<evidence-id-or-path>', 'terminal Evidence id from Manifest v1 or a TerminalTrack v1 JSON path')
  .requiredOption('--format <format>', 'output format: png or gif', renderFormat)
  .option('--project <path>', 'project root', '.')
  .option('--out <path>', 'project-relative output path')
  .action(async (reference, options) => {
    try {
      const result = await renderEvidence(reference, {
        projectRoot: options.project,
        format: options.format,
        ...(options.out ? { outputPath: options.out } : {}),
      });
      if (result.evidenceId) await snapshotEvidenceArtifact(options.project, result.evidenceId);
      console.log(`Rendered: ${result.evidenceId ?? reference}`);
      if (result.sourceEvidenceId) console.log(`Derived from: ${result.sourceEvidenceId}`);
      console.log(`Format: ${result.format.toUpperCase()}`);
      console.log(`Dimensions: ${result.width}x${result.height}`);
      if (result.durationMs !== undefined) console.log(`Duration: ${(result.durationMs / 1_000).toFixed(2)}s`);
      if (result.frameCount !== undefined) console.log(`Frames: ${result.frameCount}`);
      console.log(`Size: ${formatBytes(result.sizeBytes)}`);
      console.log(`Output: ${repoRelative(process.cwd(), result.outputPath)}`);
    } catch (error) {
      const code = error instanceof RendererError ? error.code : 'RENDER_FAILED';
      console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

registerDocsCommands(program);
registerUpdateCommand(program);

program.command('validate').description('Validate DemoWeave project metadata, document plans, and evidence bindings').argument('[path]', 'project path', '.').action(async (input) => {
  const root = path.resolve(input);
  const projectPath = path.join(root, '.demoweave', 'project.json');
  let failed = false;

  let project;
  try {
    const parsed = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    const result = ProjectProfileSchema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        console.error(`project.json:${issue.path.join('.')}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }
    project = result.data;
  } catch (error) {
    console.error(`Could not validate ${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const flowDirectory = path.join(root, '.demoweave', 'flows');
  const flowFiles: FlowFile[] = [];
  for (const file of await listJsonFiles(flowDirectory)) {
    try {
      const parsed = FlowSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
      if (!parsed.success) {
        failed = true;
        for (const issue of parsed.error.issues) {
          console.error(`${repoRelative(root, file)}:${issue.path.join('.')}: ${issue.message}`);
        }
      } else {
        flowFiles.push({ path: repoRelative(root, file), flow: parsed.data });
      }
    } catch (error) {
      failed = true;
      console.error(`${repoRelative(root, file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const planDirectory = path.join(root, '.demoweave', 'plans');
  let planCount = 0;
  for (const file of await listJsonFiles(planDirectory)) {
    try {
      const parsed = DocumentPlanSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
      if (!parsed.success) {
        failed = true;
        for (const issue of parsed.error.issues) {
          console.error(`${repoRelative(root, file)}:${issue.path.join('.')}: ${issue.message}`);
        }
      } else {
        planCount += 1;
      }
    } catch (error) {
      failed = true;
      console.error(`${repoRelative(root, file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  let manifest;
  if (await exists(manifestPath)) {
    try {
      const result = ManifestSchema.safeParse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
      if (!result.success) {
        failed = true;
        for (const issue of result.error.issues) {
          console.error(`${repoRelative(root, manifestPath)}:${issue.path.join('.')}: ${issue.message}`);
        }
      } else {
        manifest = result.data;
      }
    } catch (error) {
      failed = true;
      console.error(`${repoRelative(root, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (flowFiles.length > 0) {
    failed = true;
    console.error('Flow files exist but .demoweave/evidence/manifest.json is missing');
  }

  if (!failed) {
    const bindingIssues = validateMetadataBindings(project, flowFiles, manifest);
    if (bindingIssues.length) {
      failed = true;
      for (const issue of bindingIssues) console.error(`${issue.path}: ${issue.message}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log('ProjectProfile v1 is valid.');
  console.log(`Flow v1 files valid: ${flowFiles.length}.`);
  console.log(`DocumentPlan v1 files valid: ${planCount}.`);
  console.log(`Manifest v1: ${manifest ? 'valid' : 'not present'}.`);
  console.log('Metadata bindings are valid.');
});

await program.parseAsync(process.argv);
