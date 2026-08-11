import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'outputs');
await fs.mkdir(out, { recursive: true });

const rows = [
  { epoch: 1, accuracy: 0.62, loss: 0.91 },
  { epoch: 2, accuracy: 0.74, loss: 0.68 },
  { epoch: 3, accuracy: 0.83, loss: 0.49 },
  { epoch: 4, accuracy: 0.89, loss: 0.36 },
  { epoch: 5, accuracy: 0.93, loss: 0.28 },
];

const metrics = {
  experiment: 'demoweave-research-fixture',
  bestEpoch: 5,
  accuracy: 0.93,
  loss: 0.28,
  samples: 512,
};

const csv = ['epoch,accuracy,loss', ...rows.map((row) => `${row.epoch},${row.accuracy.toFixed(2)},${row.loss.toFixed(2)}`)].join('\n') + '\n';
const points = rows.map((row, index) => {
  const x = 90 + index * 150;
  const y = 390 - ((row.accuracy - 0.55) / 0.45) * 300;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');
const circles = rows.map((row, index) => {
  const x = 90 + index * 150;
  const y = 390 - ((row.accuracy - 0.55) / 0.45) * 300;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="currentColor"/>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="460" viewBox="0 0 780 460" role="img" aria-labelledby="title desc"><title id="title">Validation accuracy by epoch</title><desc id="desc">Accuracy rises from 0.62 at epoch one to 0.93 at epoch five.</desc><rect width="780" height="460" rx="24" fill="#ffffff"/><g color="#111827" font-family="system-ui, sans-serif"><text x="54" y="52" font-size="24" font-weight="700">Validation accuracy</text><text x="54" y="78" font-size="14" fill="#6b7280">Deterministic DemoWeave research fixture</text><line x1="90" y1="100" x2="90" y2="390" stroke="#d1d5db"/><line x1="90" y1="390" x2="700" y2="390" stroke="#d1d5db"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>${circles}<text x="650" y="120" font-size="18" font-weight="700">0.93</text><text x="650" y="142" font-size="13" fill="#6b7280">best accuracy</text></g></svg>\n`;

await Promise.all([
  fs.writeFile(path.join(out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`),
  fs.writeFile(path.join(out, 'results.csv'), csv),
  fs.writeFile(path.join(out, 'learning-curve.svg'), svg),
]);

console.log('Research outputs generated: accuracy=0.93');
