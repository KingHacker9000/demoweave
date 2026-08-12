import path from 'node:path';
import type { Command } from 'commander';
import { loadPluginHost, PluginHostError } from '@demoweave/drivers';

function report(error: unknown, json: boolean): void {
  const code = error instanceof PluginHostError ? error.code : 'PLUGIN_HOST_FAILED';
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ ok: false, diagnostics: [{ code, message }] }, null, 2));
  else console.error(`${code}: ${message}`);
  process.exitCode = 1;
}

export function registerPluginCommands(program: Command): void {
  const plugins = program.command('plugins').description('Inspect explicitly configured trusted Node.js plugins');

  plugins.command('list')
    .description('List configured plugins and registered contributions without executing workflows')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print structured JSON')
    .action(async (options) => {
      try {
        const items = (await loadPluginHost(path.resolve(options.project))).list();
        if (options.json) {
          console.log(JSON.stringify({ plugins: items }, null, 2));
          return;
        }
        if (!items.length) {
          console.log('No plugins configured.');
          return;
        }
        for (const item of items) {
          console.log(`${item.id}${item.version ? ` ${item.version}` : ''} (API ${item.apiVersion})`);
          console.log(`  Module: ${item.module}`);
          console.log(`  Detectors: ${item.detectors.join(', ') || 'none'}`);
          console.log(`  Drivers: ${item.drivers.join(', ') || 'none'}`);
        }
      } catch (error) {
        report(error, Boolean(options.json));
      }
    });

  plugins.command('doctor')
    .description('Resolve, load, register, and validate explicitly configured plugins')
    .option('--project <path>', 'project root', '.')
    .option('--json', 'print structured JSON')
    .action(async (options) => {
      try {
        const items = (await loadPluginHost(path.resolve(options.project))).list();
        if (options.json) {
          console.log(JSON.stringify({ ok: true, plugins: items, diagnostics: [] }, null, 2));
          return;
        }
        console.log(`Plugin doctor: OK (${items.length} configured)`);
        console.log('Configured plugins are trusted Node.js code and are not sandboxed.');
      } catch (error) {
        report(error, Boolean(options.json));
      }
    });
}
