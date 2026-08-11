import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error('Usage: node notebooks/execute.mjs <input.ipynb> <output.ipynb>');
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '..');
const input = path.resolve(root, inputArg);
const output = path.resolve(root, outputArg);
const notebook = JSON.parse(await fs.readFile(input, 'utf8'));
const scope = vm.createContext({});
let executionCount = 0;

for (const cell of notebook.cells ?? []) {
  if (cell.cell_type !== 'code') continue;
  executionCount += 1;
  const lines = [];
  scope.console = {
    log: (...values) => lines.push(values.map(String).join(' ')),
  };
  const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
  new vm.Script(source, { filename: path.basename(input) }).runInContext(scope, { timeout: 2_000 });
  cell.execution_count = executionCount;
  cell.outputs = lines.length ? [{
    name: 'stdout',
    output_type: 'stream',
    text: lines.map((line) => `${line}\n`),
  }] : [];
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(notebook, null, 2)}\n`);
console.log(`Notebook executed: ${executionCount} code cell(s)`);
