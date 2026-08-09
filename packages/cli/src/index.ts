#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeProject, ProjectProfileSchema } from '@demoweave/core';

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

async function ensureDir(root: string) {
  await fs.mkdir(path.join(root, '.demoweave'), { recursive: true });
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
  await ensureDir(root);
  const configPath = path.join(root, '.demoweave', 'config.json');
  try {
    await fs.access(configPath);
    console.log(`Already initialized: ${path.relative(process.cwd(), configPath) || configPath}`);
  } catch {
    await fs.writeFile(configPath, `${JSON.stringify({ schemaVersion: 1, mediaDir: 'docs-media' }, null, 2)}\n`);
    console.log(`Initialized ${path.relative(process.cwd(), path.join(root, '.demoweave')) || '.demoweave'}`);
  }
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
    const detail = surface.command ?? surface.framework ?? surface.packageName ?? surface.root;
    console.log(`  - ${surface.type.padEnd(10)} ${detail}`);
  }
  console.log(`Wrote ${path.relative(process.cwd(), output) || output}`);
});

program.command('status').description('Show current DemoWeave metadata status').argument('[path]', 'project path', '.').action(async (input) => {
  const projectPath = path.join(path.resolve(input), '.demoweave', 'project.json');
  try {
    const parsed = ProjectProfileSchema.parse(JSON.parse(await fs.readFile(projectPath, 'utf8')));
    console.log(`Project profile: current file present (schema v${parsed.schemaVersion})`);
    console.log(`Surfaces: ${parsed.surfaces.length}`);
    console.log('Evidence staleness tracking: not available until M2/M6');
  } catch (error) {
    console.error(`Project profile unavailable or invalid. Run: demoweave inspect .`);
    process.exitCode = 1;
  }
});

program.command('validate').description('Validate DemoWeave project metadata').argument('[path]', 'project path', '.').action(async (input) => {
  const projectPath = path.join(path.resolve(input), '.demoweave', 'project.json');
  try {
    const parsed = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    const result = ProjectProfileSchema.safeParse(parsed);
    if (!result.success) {
      console.error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('ProjectProfile v1 is valid.');
  } catch (error) {
    console.error(`Could not validate ${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
});

await program.parseAsync(process.argv);
