import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { ProjectProfileSchema, type ProjectProfile, type Surface } from './types.js';

const IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**',
  '**/.next/**', '**/.turbo/**', '**/.venv/**', '**/venv/**'
];

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
  '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#',
  '.rb': 'Ruby', '.php': 'PHP', '.r': 'R', '.lua': 'Lua', '.sh': 'Shell', '.ipynb': 'Jupyter Notebook'
};

const FRAMEWORKS: Array<{ dep: string; name: string; surface?: Surface['type'] }> = [
  { dep: 'next', name: 'Next.js', surface: 'web' },
  { dep: 'vite', name: 'Vite', surface: 'web' },
  { dep: 'react', name: 'React', surface: 'web' },
  { dep: 'vue', name: 'Vue', surface: 'web' },
  { dep: 'svelte', name: 'Svelte', surface: 'web' },
  { dep: '@angular/core', name: 'Angular', surface: 'web' },
  { dep: 'electron', name: 'Electron', surface: 'desktop' },
  { dep: 'express', name: 'Express', surface: 'service' },
  { dep: 'fastify', name: 'Fastify', surface: 'service' }
];

type PackageManifest = {
  file: string;
  root: string;
  json: Record<string, any>;
};

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

function rel(base: string, target: string): string {
  const value = path.relative(base, target).replaceAll(path.sep, '/');
  return value || '.';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'surface';
}

async function readPackages(root: string): Promise<PackageManifest[]> {
  const files = await fg(['package.json', '**/package.json'], { cwd: root, ignore: IGNORE, onlyFiles: true, unique: true });
  const out: PackageManifest[] = [];
  for (const file of files) {
    try {
      const json = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
      out.push({ file, root: rel(root, path.dirname(path.join(root, file))), json });
    } catch { /* malformed package.json is a fact we skip rather than guessing */ }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export async function analyzeProject(input = '.'): Promise<ProjectProfile> {
  const root = path.resolve(input);
  const packages = await readPackages(root);
  const rootPackage = packages.find((p) => p.root === '.');

  const packageManagers: string[] = [];
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) packageManagers.push('pnpm');
  if (await exists(path.join(root, 'yarn.lock'))) packageManagers.push('yarn');
  if (await exists(path.join(root, 'package-lock.json'))) packageManagers.push('npm');
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) packageManagers.push('bun');
  if (await exists(path.join(root, 'uv.lock'))) packageManagers.push('uv');
  if (await exists(path.join(root, 'poetry.lock'))) packageManagers.push('poetry');
  if (!packageManagers.length && packages.length) packageManagers.push('npm');

  const sourceFiles = await fg(['**/*.{ts,tsx,js,jsx,py,rs,go,java,kt,swift,c,h,cpp,hpp,cs,rb,php,r,lua,sh,ipynb}'], {
    cwd: root, ignore: IGNORE, onlyFiles: true
  });
  const languageCounts = new Map<string, number>();
  for (const file of sourceFiles) {
    const name = LANGUAGE_BY_EXT[path.extname(file).toLowerCase()];
    if (name) languageCounts.set(name, (languageCounts.get(name) ?? 0) + 1);
  }
  const languages = [...languageCounts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const frameworks: ProjectProfile['frameworks'] = [];
  const surfaces: Surface[] = [];
  const seenSurfaceIds = new Set<string>();
  const addSurface = (surface: Omit<Surface, 'id'> & { id?: string }) => {
    let id = surface.id ?? slug(`${surface.type}-${surface.packageName ?? surface.root}`);
    let n = 2;
    while (seenSurfaceIds.has(id)) id = `${surface.id ?? slug(`${surface.type}-${surface.packageName ?? surface.root}`)}-${n++}`;
    seenSurfaceIds.add(id);
    surfaces.push({ ...surface, id });
  };

  for (const pkg of packages) {
    const deps = { ...(pkg.json.dependencies ?? {}), ...(pkg.json.devDependencies ?? {}) } as Record<string, string>;
    for (const fw of FRAMEWORKS) {
      if (!deps[fw.dep]) continue;
      if (!frameworks.some((x) => x.name === fw.name && x.root === pkg.root)) {
        frameworks.push({ name: fw.name, root: pkg.root, version: String(deps[fw.dep]) });
      }
      if (fw.surface && !surfaces.some((s) => s.type === fw.surface && s.root === pkg.root)) {
        addSurface({ type: fw.surface, root: pkg.root, confidence: 0.9, framework: fw.name, packageName: pkg.json.name });
      }
    }

    if (pkg.json.bin) {
      const bins = typeof pkg.json.bin === 'string' ? { [pkg.json.name ?? 'cli']: pkg.json.bin } : pkg.json.bin;
      for (const command of Object.keys(bins)) {
        addSurface({ type: 'terminal', root: pkg.root, confidence: 1, command, packageName: pkg.json.name, label: command });
      }
    }

    if (!pkg.json.private && (pkg.json.exports || pkg.json.main || pkg.json.module || pkg.json.types)) {
      addSurface({ type: 'library', root: pkg.root, confidence: 0.85, packageName: pkg.json.name, label: pkg.json.name });
    }
  }

  const notebooks = sourceFiles.filter((f) => f.endsWith('.ipynb'));
  if (notebooks.length) addSurface({ type: 'notebook', root: rel(root, path.dirname(path.join(root, notebooks[0]!))), confidence: 1, label: 'Notebooks' });

  const researchDirs = await fg(['experiments', 'evaluation', 'eval', 'benchmarks', 'training'], { cwd: root, ignore: IGNORE, onlyDirectories: true, deep: 3 });
  if (researchDirs.length) addSurface({ type: 'research', root: researchDirs[0]!, confidence: 0.7, label: 'Research workflow' });

  const docs = await fg(['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'CHANGELOG.md', 'docs/**/*.md'], { cwd: root, ignore: IGNORE, onlyFiles: true, unique: true });

  const scripts = (rootPackage?.json.scripts ?? {}) as Record<string, string>;
  const pm = packageManagers[0] ?? 'npm';
  const runScript = (name: string) => pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`;
  const commands = {
    install: packages.length ? [pm === 'npm' ? 'npm install' : `${pm} install`] : [],
    build: Object.keys(scripts).filter((x) => x === 'build' || x.startsWith('build:')).map(runScript),
    test: Object.keys(scripts).filter((x) => x === 'test' || x.startsWith('test:')).map(runScript),
    run: [
      ...Object.keys(scripts).filter((x) => ['dev', 'start', 'serve'].includes(x)).map(runScript),
      ...surfaces.filter((x) => x.type === 'terminal' && x.command).map((x) => x.command!)
    ]
  };

  const profile: ProjectProfile = {
    schemaVersion: 1,
    name: String(rootPackage?.json.name ?? path.basename(root)),
    root: '.',
    analyzedAt: new Date().toISOString(),
    packageManagers: [...new Set(packageManagers)],
    languages,
    frameworks: frameworks.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root)),
    surfaces: surfaces.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
    commands,
    existingDocs: docs.sort()
  };

  return ProjectProfileSchema.parse(profile);
}
