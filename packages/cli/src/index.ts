#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  analyzeProject,
  FlowSchema,
  ManifestSchema,
  ProjectProfileSchema,
  validateMetadataBindings,
  type FlowFile,
} from '@demoweave/core';

const program = new Command();
program.name('demoweave').description('Agent-native documentation tooling for software repositories').version('0.0.1');

function commandAvailable(command: string): { ok: boolean; version?: string } {
  const executable = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : command;
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${command} --version`]
    : ['--version'];
  const result = spawnSync(executable, args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    version: (result.stdout || result.stderr || '').trim().split('\n')[0] || undefined,
  };
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

program.command('doctor').description('Check local DemoWeave prerequisites').action(() => {
  const checks = [
    ['node', true],
    ['git', true],
    ['pnpm', false],
    ['ffmpeg', false],
  ] as const;
  let failedRequired = false;
  console.log('DemoWeave doctor\n');
  for (const [command, required] of checks) {
    const result = commandAvailable(command);
    const status = result.ok ? 'OK' : required ? 'MISSING' : 'OPTIONAL';
    console.log(`${status.padEnd(8)} ${command}${result.version ? `  ${result.version}` : ''}`);
    if (required && !result.ok) failedRequired = true;
  }
  if (failedRequired) process.exitCode = 1;
});

program.command('init').description('Initialize DemoWeave metadata in a repository').argument('[path]', 'project path', '.').action(async (input) => {
  const root = path.resolve(input);
  const metadataRoot = path.join(root, '.demoweave');
  const flowDir = path.join(metadataRoot, 'flows');
  const evidenceDir = path.join(metadataRoot, 'evidence');
  await fs.mkdir(flowDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

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

program.command('status').description('Show current DemoWeave metadata status').argument('[path]', 'project path', '.').action(async (input) => {
  const root = path.resolve(input);
  const projectPath = path.join(root, '.demoweave', 'project.json');
  try {
    const parsed = ProjectProfileSchema.parse(JSON.parse(await fs.readFile(projectPath, 'utf8')));
    console.log(`Project profile: current file present (schema v${parsed.schemaVersion})`);
    console.log(`Surfaces: ${parsed.surfaces.length}`);
  } catch {
    console.error('Project profile unavailable or invalid. Run: demoweave inspect .');
    process.exitCode = 1;
    return;
  }

  const manifestPath = path.join(root, '.demoweave', 'evidence', 'manifest.json');
  if (await exists(manifestPath)) {
    const result = ManifestSchema.safeParse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
    if (result.success) {
      console.log(`Flows indexed: ${result.data.flows.length}`);
      console.log(`Evidence indexed: ${result.data.evidence.length}`);
      const stale = result.data.evidence.filter((item) => item.status === 'stale').length;
      console.log(`Evidence stale: ${stale}`);
    } else {
      console.log('Evidence manifest: invalid (run demoweave validate .)');
    }
  } else {
    console.log('Evidence manifest: not initialized');
  }
  console.log('Automatic staleness detection: not available until M6');
});

program.command('validate').description('Validate DemoWeave project and M2 metadata').argument('[path]', 'project path', '.').action(async (input) => {
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
  console.log(`Manifest v1: ${manifest ? 'valid' : 'not present'}.`);
  console.log('M2 metadata bindings are valid.');
});

await program.parseAsync(process.argv);
