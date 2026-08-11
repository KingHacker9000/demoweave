import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const driverRoot = fileURLToPath(new URL('../packages/drivers/', import.meta.url));
fs.copyFileSync(
  path.join(driverRoot, 'src', 'windows-uia-helper.ps1'),
  path.join(driverRoot, 'dist', 'windows-uia-helper.ps1'),
);
