import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseToml } from 'smol-toml';
import {
  ProjectProfileSchema,
  type Component,
  type Ecosystem,
  type Entrypoint,
  type ProjectProfile,
  type Surface,
  type Workspace,
} from './types.js';

const IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**',
  '**/.next/**', '**/.turbo/**', '**/.venv/**', '**/venv/**',
];

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
  '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#',
  '.rb': 'Ruby', '.php': 'PHP', '.r': 'R', '.lua': 'Lua', '.sh': 'Shell', '.ipynb': 'Jupyter Notebook',
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
  { dep: 'fastify', name: 'Fastify', surface: 'service' },
];

type Data = Record<string, any>;

type NodeManifest = {
  file: string;
  root: string;
  data: Data;
};

type TomlManifest = {
  file: string;
  root: string;
  data: Data;
};

type DetectedComponent = {
  profile: Component;
  active: boolean;
  data?: Data;
};

type DetectedWorkspace = {
  profile: Workspace;
  excludes: string[];
};

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function rel(base: string, target: string): string {
  const value = path.relative(base, target).replaceAll(path.sep, '/');
  return value || '.';
}

function portablePath(value: string): string {
  return value.replaceAll(path.sep, '/');
}

async function nestedDemoWeaveProjectRoots(root: string): Promise<string[]> {
  const configs = await fg(['.demoweave/config.json', '**/.demoweave/config.json'], {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
    unique: true,
  });
  return configs
    .map((config) => {
      const portable = portablePath(config);
      const marker = '/.demoweave/config.json';
      return portable === '.demoweave/config.json' ? '.' : portable.slice(0, -marker.length);
    })
    .filter((projectRoot) => projectRoot !== '.')
    .sort();
}

function belongsToNestedProject(candidate: string, nestedRoots: string[]): boolean {
  const portable = portablePath(candidate);
  return nestedRoots.some((projectRoot) => portable === projectRoot || portable.startsWith(`${projectRoot}/`));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'surface';
}

function componentId(ecosystem: Ecosystem, manifestPath: string): string {
  return `${ecosystem}:${manifestPath}`;
}

function workspaceId(ecosystem: Ecosystem, manifestPath: string): string {
  return `${ecosystem}:workspace:${manifestPath}`;
}

function asRecord(value: unknown): Data | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringEntries(value: unknown): Array<[string, string]> {
  return Object.entries(asRecord(value) ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([a], [b]) => a.localeCompare(b));
}

function uniqueEntrypoints(entrypoints: Entrypoint[]): Entrypoint[] {
  const seen = new Set<string>();
  return entrypoints
    .filter((entrypoint) => {
      const key = `${entrypoint.kind}\0${entrypoint.name ?? ''}\0${entrypoint.target ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      (a.target ?? '').localeCompare(b.target ?? ''));
}

async function readNodeManifests(root: string): Promise<NodeManifest[]> {
  const files = await fg(['package.json', '**/package.json'], {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
    unique: true,
  });
  const manifests: NodeManifest[] = [];
  for (const file of files.sort()) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(root, file), 'utf8')) as Data;
      manifests.push({ file, root: rel(root, path.dirname(path.join(root, file))), data });
    } catch {
      // A malformed manifest cannot establish package metadata or entrypoints.
    }
  }
  return manifests;
}

async function readTomlManifests(root: string, name: 'pyproject.toml' | 'Cargo.toml'): Promise<TomlManifest[]> {
  const files = await fg([name, `**/${name}`], {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
    unique: true,
  });
  const manifests: TomlManifest[] = [];
  for (const file of files.sort()) {
    try {
      const data = parseToml(await fs.readFile(path.join(root, file), 'utf8')) as Data;
      manifests.push({ file, root: rel(root, path.dirname(path.join(root, file))), data });
    } catch {
      // A malformed manifest cannot establish package metadata or entrypoints.
    }
  }
  return manifests;
}

function stripYamlValue(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, '').trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
      (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

async function readPnpmPatterns(root: string): Promise<string[]> {
  const lines = (await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).split(/\r?\n/);
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line.trim())) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item?.[1]) {
      const pattern = stripYamlValue(item[1]);
      if (pattern) patterns.push(pattern);
      continue;
    }
    if (line.trim() && !/^\s/.test(line)) break;
  }
  return patterns;
}

async function detectWorkspaces(
  root: string,
  nodeManifests: NodeManifest[],
  cargoManifests: TomlManifest[],
): Promise<DetectedWorkspace[]> {
  const workspaces: DetectedWorkspace[] = [];
  const rootPackage = nodeManifests.find((manifest) => manifest.root === '.');
  if (await exists(path.join(root, 'pnpm-workspace.yaml'))) {
    const manifestPath = 'pnpm-workspace.yaml';
    workspaces.push({
      profile: {
        id: workspaceId('node', manifestPath),
        ecosystem: 'node',
        manifest: { kind: 'pnpm-workspace.yaml', path: manifestPath },
        root: '.',
        patterns: await readPnpmPatterns(root),
      },
      excludes: [],
    });
  } else {
    const declared = rootPackage?.data.workspaces;
    const patterns = Array.isArray(declared)
      ? strings(declared)
      : strings(asRecord(declared)?.packages);
    if (patterns.length) {
      workspaces.push({
        profile: {
          id: workspaceId('node', 'package.json'),
          ecosystem: 'node',
          manifest: { kind: 'package.json', path: 'package.json' },
          root: '.',
          patterns,
        },
        excludes: [],
      });
    }
  }

  for (const manifest of cargoManifests) {
    const workspace = asRecord(manifest.data.workspace);
    if (!workspace) continue;
    workspaces.push({
      profile: {
        id: workspaceId('rust', manifest.file),
        ecosystem: 'rust',
        manifest: { kind: 'Cargo.toml', path: manifest.file },
        root: manifest.root,
        patterns: strings(workspace.members),
      },
      excludes: strings(workspace.exclude),
    });
  }

  return workspaces.sort((a, b) => a.profile.id.localeCompare(b.profile.id));
}

async function workspaceMembership(root: string, workspaces: DetectedWorkspace[]): Promise<Map<string, string>> {
  const membership = new Map<string, string>();
  for (const workspace of workspaces) {
    const filename = workspace.profile.ecosystem === 'rust' ? 'Cargo.toml' : 'package.json';
    const prefix = workspace.profile.root === '.' ? '' : `${workspace.profile.root}/`;
    const patterns = [
      ...workspace.profile.patterns.map((pattern) => `${prefix}${pattern.replace(/\/$/, '')}/${filename}`),
      ...workspace.excludes.map((pattern) => `!${prefix}${pattern.replace(/\/$/, '')}/${filename}`),
    ];
    if (!patterns.length) continue;
    const files = await fg(patterns, { cwd: root, ignore: IGNORE, onlyFiles: true, unique: true });
    for (const file of files.sort()) membership.set(file.replaceAll(path.sep, '/'), workspace.profile.id);
  }
  return membership;
}

function nodeEntrypoints(data: Data): Entrypoint[] {
  const entrypoints: Entrypoint[] = [];
  if (data.bin) {
    const bins = typeof data.bin === 'string' ? { [data.name ?? 'cli']: data.bin } : asRecord(data.bin) ?? {};
    for (const [name, target] of stringEntries(bins)) {
      entrypoints.push({ kind: 'terminal', name, target });
    }
  }
  if (data.exports || data.main || data.module || data.types) {
    const target = [data.exports, data.main, data.module, data.types]
      .find((value): value is string => typeof value === 'string');
    entrypoints.push({ kind: 'library', ...(target ? { target } : {}) });
  }
  return uniqueEntrypoints(entrypoints);
}

function pythonEntrypoints(data: Data, name?: string): Entrypoint[] {
  const project = asRecord(data.project);
  const poetry = asRecord(asRecord(data.tool)?.poetry);
  const entrypoints: Entrypoint[] = name ? [{ kind: 'library' }] : [];
  for (const [scriptName, target] of [
    ...stringEntries(project?.scripts),
    ...stringEntries(project?.['gui-scripts']),
    ...stringEntries(poetry?.scripts),
  ]) {
    entrypoints.push({ kind: 'terminal', name: scriptName, target });
  }
  return uniqueEntrypoints(entrypoints);
}

async function rustEntrypoints(root: string, manifest: TomlManifest): Promise<Entrypoint[]> {
  const packageData = asRecord(manifest.data.package);
  const packageRoot = path.join(root, manifest.root === '.' ? '' : manifest.root);
  const entrypoints: Entrypoint[] = [];
  const lib = asRecord(manifest.data.lib);
  const defaultLib = path.join(packageRoot, 'src', 'lib.rs');
  if (lib || (packageData?.autolib !== false && await exists(defaultLib))) {
    entrypoints.push({
      kind: 'library',
      ...(typeof lib?.name === 'string' ? { name: lib.name } : {}),
      target: typeof lib?.path === 'string' ? lib.path : 'src/lib.rs',
    });
  }

  const explicitBins = Array.isArray(manifest.data.bin) ? manifest.data.bin : [];
  for (const value of explicitBins) {
    const bin = asRecord(value);
    if (!bin) continue;
    const target = typeof bin.path === 'string' ? bin.path : undefined;
    const name = typeof bin.name === 'string'
      ? bin.name
      : target
        ? path.basename(target, path.extname(target))
        : undefined;
    if (name) entrypoints.push({ kind: 'terminal', name, ...(target ? { target } : {}) });
  }

  if (packageData?.autobins !== false && await exists(path.join(packageRoot, 'src', 'main.rs'))) {
    const name = typeof packageData?.name === 'string' ? packageData.name : undefined;
    if (name) entrypoints.push({ kind: 'terminal', name, target: 'src/main.rs' });
  }
  if (packageData?.autobins !== false) {
    const autoBins = await fg(['src/bin/*.rs', 'src/bin/*/main.rs'], {
      cwd: packageRoot,
      onlyFiles: true,
      unique: true,
    });
    for (const target of autoBins.sort()) {
      const name = target.endsWith('/main.rs')
        ? path.basename(path.dirname(target))
        : path.basename(target, '.rs');
      entrypoints.push({ kind: 'terminal', name, target: target.replaceAll(path.sep, '/') });
    }
  }
  return uniqueEntrypoints(entrypoints);
}

async function goEntrypoints(root: string, componentRoot: string): Promise<Entrypoint[]> {
  const absoluteRoot = path.join(root, componentRoot === '.' ? '' : componentRoot);
  const entrypoints: Entrypoint[] = [];
  const rootFiles = await fg(['*.go', '!**/*_test.go'], { cwd: absoluteRoot, onlyFiles: true, unique: true });
  for (const file of rootFiles.sort()) {
    const source = await fs.readFile(path.join(absoluteRoot, file), 'utf8');
    const packageName = source.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)/m)?.[1];
    if (packageName && packageName !== 'main') {
      entrypoints.push({ kind: 'library', target: '.' });
      break;
    }
  }

  const commandFiles = await fg(['cmd/*/*.go', '!cmd/*/*_test.go'], {
    cwd: absoluteRoot,
    onlyFiles: true,
    unique: true,
  });
  const commandRoots = [...new Set(commandFiles.map((file) => file.replaceAll(path.sep, '/').split('/').slice(0, 2).join('/')))];
  for (const commandRoot of commandRoots.sort()) {
    const files = commandFiles.filter((file) => file.replaceAll(path.sep, '/').startsWith(`${commandRoot}/`));
    let isMain = false;
    for (const file of files) {
      const source = await fs.readFile(path.join(absoluteRoot, file), 'utf8');
      if (/^\s*package\s+main\b/m.test(source)) {
        isMain = true;
        break;
      }
    }
    if (isMain) entrypoints.push({ kind: 'terminal', name: path.basename(commandRoot), target: commandRoot });
  }
  return uniqueEntrypoints(entrypoints);
}

function pythonName(data: Data): string | undefined {
  const projectName = asRecord(data.project)?.name;
  if (typeof projectName === 'string') return projectName;
  const poetryName = asRecord(asRecord(data.tool)?.poetry)?.name;
  return typeof poetryName === 'string' ? poetryName : undefined;
}

function goModuleName(contents: string): string | undefined {
  const value = contents.match(/^\s*module\s+([^\s]+)\s*$/m)?.[1];
  return value?.replace(/^['"]|['"]$/g, '');
}

async function detectComponents(
  root: string,
  nodeManifests: NodeManifest[],
  pythonManifests: TomlManifest[],
  cargoManifests: TomlManifest[],
  membership: Map<string, string>,
  activeWorkspaceIds: Set<string>,
): Promise<DetectedComponent[]> {
  const components: DetectedComponent[] = [];
  const isActive = (componentRoot: string, workspace?: string) =>
    componentRoot === '.' || (workspace !== undefined && activeWorkspaceIds.has(workspace));

  for (const manifest of nodeManifests) {
    const workspace = membership.get(manifest.file);
    const scripts = Object.fromEntries(stringEntries(manifest.data.scripts));
    components.push({
      profile: {
        id: componentId('node', manifest.file),
        ecosystem: 'node',
        manifest: { kind: 'package.json', path: manifest.file },
        ...(typeof manifest.data.name === 'string' && manifest.data.name ? { name: manifest.data.name } : {}),
        root: manifest.root,
        ...(workspace ? { workspaceId: workspace } : {}),
        private: manifest.data.private === true,
        ...(Object.keys(scripts).length ? { scripts } : {}),
        entrypoints: nodeEntrypoints(manifest.data),
      },
      active: isActive(manifest.root, workspace),
      data: manifest.data,
    });
  }

  for (const manifest of pythonManifests) {
    const name = pythonName(manifest.data);
    components.push({
      profile: {
        id: componentId('python', manifest.file),
        ecosystem: 'python',
        manifest: { kind: 'pyproject.toml', path: manifest.file },
        ...(name ? { name } : {}),
        root: manifest.root,
        entrypoints: pythonEntrypoints(manifest.data, name),
      },
      active: manifest.root === '.',
      data: manifest.data,
    });
  }

  for (const manifest of cargoManifests) {
    const workspace = membership.get(manifest.file);
    const packageName = asRecord(manifest.data.package)?.name;
    components.push({
      profile: {
        id: componentId('rust', manifest.file),
        ecosystem: 'rust',
        manifest: { kind: 'Cargo.toml', path: manifest.file },
        ...(typeof packageName === 'string' && packageName ? { name: packageName } : {}),
        root: manifest.root,
        ...(workspace ? { workspaceId: workspace } : {}),
        entrypoints: await rustEntrypoints(root, manifest),
      },
      active: isActive(manifest.root, workspace),
      data: manifest.data,
    });
  }

  const goFiles = await fg(['go.mod', '**/go.mod'], {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
    unique: true,
  });
  for (const file of goFiles.sort()) {
    const componentRoot = rel(root, path.dirname(path.join(root, file)));
    const name = goModuleName(await fs.readFile(path.join(root, file), 'utf8'));
    components.push({
      profile: {
        id: componentId('go', file),
        ecosystem: 'go',
        manifest: { kind: 'go.mod', path: file },
        ...(name ? { name } : {}),
        root: componentRoot,
        entrypoints: await goEntrypoints(root, componentRoot),
      },
      active: componentRoot === '.',
    });
  }

  return components.sort((a, b) => a.profile.id.localeCompare(b.profile.id));
}

function declaredNodeManager(rootPackage?: DetectedComponent): string | undefined {
  const value = rootPackage?.data?.packageManager;
  if (typeof value !== 'string') return undefined;
  return value.match(/^([^@\s]+)@/)?.[1];
}

async function detectPackageManagers(root: string, components: DetectedComponent[], workspaces: Workspace[]): Promise<string[]> {
  const managers: string[] = [];
  if (await exists(path.join(root, 'pnpm-lock.yaml')) || workspaces.some((workspace) => workspace.manifest.kind === 'pnpm-workspace.yaml')) managers.push('pnpm');
  if (await exists(path.join(root, 'yarn.lock'))) managers.push('yarn');
  if (await exists(path.join(root, 'package-lock.json'))) managers.push('npm');
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) managers.push('bun');
  if (await exists(path.join(root, 'uv.lock'))) managers.push('uv');
  if (await exists(path.join(root, 'poetry.lock'))) managers.push('poetry');

  const rootNode = components.find((component) => component.active && component.profile.ecosystem === 'node' && component.profile.root === '.');
  const declaredManager = declaredNodeManager(rootNode);
  if (declaredManager) managers.push(declaredManager);

  for (const component of components.filter((candidate) => candidate.active)) {
    const componentRoot = path.join(root, component.profile.root === '.' ? '' : component.profile.root);
    if (component.profile.ecosystem === 'python') {
      const tool = asRecord(component.data?.tool);
      if (await exists(path.join(componentRoot, 'uv.lock')) || asRecord(tool?.uv)) managers.push('uv');
      if (await exists(path.join(componentRoot, 'poetry.lock')) || asRecord(tool?.poetry)) managers.push('poetry');
    }
    if (component.profile.ecosystem === 'rust') managers.push('cargo');
    if (component.profile.ecosystem === 'go') managers.push('go');
  }
  return [...new Set(managers)];
}

export async function analyzeProject(input = '.'): Promise<ProjectProfile> {
  const root = path.resolve(input);
  const [nodeManifests, pythonManifests, cargoManifests] = await Promise.all([
    readNodeManifests(root),
    readTomlManifests(root, 'pyproject.toml'),
    readTomlManifests(root, 'Cargo.toml'),
  ]);
  const detectedWorkspaces = await detectWorkspaces(root, nodeManifests, cargoManifests);
  const membership = await workspaceMembership(root, detectedWorkspaces);
  const activeWorkspaceIds = new Set(
    detectedWorkspaces.filter((workspace) => workspace.profile.root === '.').map((workspace) => workspace.profile.id),
  );
  const detectedComponents = await detectComponents(
    root,
    nodeManifests,
    pythonManifests,
    cargoManifests,
    membership,
    activeWorkspaceIds,
  );
  const activeComponents = detectedComponents.filter((component) => component.active);
  const workspaces = detectedWorkspaces.map((workspace) => workspace.profile);
  const packageManagers = await detectPackageManagers(root, detectedComponents, workspaces);

  const sourceFiles = await fg(['**/*.{ts,tsx,js,jsx,py,rs,go,java,kt,swift,c,h,cpp,hpp,cs,rb,php,r,lua,sh,ipynb}'], {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
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
    const base = surface.id ?? slug(`${surface.type}-${surface.label ?? surface.command ?? surface.root}`);
    let id = base;
    let n = 2;
    while (seenSurfaceIds.has(id)) id = `${base}-${n++}`;
    seenSurfaceIds.add(id);
    surfaces.push({ ...surface, id });
  };

  for (const component of activeComponents) {
    for (const entrypoint of component.profile.entrypoints) {
      if (entrypoint.kind === 'library') {
        addSurface({
          type: 'library',
          root: component.profile.root,
          componentId: component.profile.id,
          label: entrypoint.name ?? component.profile.name,
        });
      } else if (entrypoint.name) {
        addSurface({
          id: slug(`terminal-${component.profile.ecosystem === 'node'
            ? component.profile.name ?? entrypoint.name
            : entrypoint.name}`),
          type: 'terminal',
          root: component.profile.root,
          componentId: component.profile.id,
          label: entrypoint.name,
          command: entrypoint.name,
        });
      }
    }

    if (component.profile.ecosystem !== 'node') continue;
    const deps = {
      ...(component.data?.dependencies ?? {}),
      ...(component.data?.devDependencies ?? {}),
    } as Record<string, string>;
    for (const framework of FRAMEWORKS) {
      if (!deps[framework.dep]) continue;
      if (!frameworks.some((item) => item.name === framework.name && item.root === component.profile.root)) {
        frameworks.push({ name: framework.name, root: component.profile.root, version: String(deps[framework.dep]) });
      }
      if (framework.surface && !surfaces.some((surface) => surface.type === framework.surface && surface.root === component.profile.root)) {
        addSurface({
          type: framework.surface,
          root: component.profile.root,
          componentId: component.profile.id,
          framework: framework.name,
          label: component.profile.name,
        });
      }
    }
  }

  const nestedProjects = await nestedDemoWeaveProjectRoots(root);
  const notebooks = sourceFiles
    .filter((file) => file.endsWith('.ipynb') && !belongsToNestedProject(file, nestedProjects))
    .sort();
  if (notebooks.length) {
    addSurface({
      type: 'notebook',
      root: rel(root, path.dirname(path.join(root, notebooks[0]!))),
      label: 'Notebooks',
    });
  }
  const researchDirs = await fg(['experiments', 'evaluation', 'eval', 'benchmarks', 'training'], {
    cwd: root,
    ignore: IGNORE,
    onlyDirectories: true,
    deep: 3,
  });
  const ownedResearchDirs = researchDirs.filter((directory) => !belongsToNestedProject(directory, nestedProjects)).sort();
  if (ownedResearchDirs.length) addSurface({ type: 'research', root: ownedResearchDirs[0]!, label: 'Research workflow' });

  const docs = await fg([
    'README.md',
    'ROADMAP.md',
    'CONTRIBUTING.md',
    'ARCHITECTURE.md',
    'CHANGELOG.md',
    'docs/**/*.md',
  ], { cwd: root, ignore: IGNORE, onlyFiles: true, unique: true });

  const rootNode = activeComponents.find((component) => component.profile.ecosystem === 'node' && component.profile.root === '.');
  const scripts = rootNode?.profile.ecosystem === 'node' ? rootNode.profile.scripts ?? {} : {};
  const scriptManager = packageManagers.find((manager) => ['pnpm', 'yarn', 'npm', 'bun'].includes(manager));
  const runScript = (name: string) => scriptManager === 'npm' ? `npm run ${name}` : `${scriptManager} ${name}`;
  const installCommand: Record<string, string> = {
    pnpm: 'pnpm install',
    yarn: 'yarn install',
    npm: 'npm install',
    bun: 'bun install',
  };
  const commands = {
    install: packageManagers.flatMap((manager) => installCommand[manager] ? [installCommand[manager]] : []),
    build: scriptManager ? Object.keys(scripts).filter((name) => name === 'build' || name.startsWith('build:')).map(runScript) : [],
    test: scriptManager ? Object.keys(scripts).filter((name) => name === 'test' || name.startsWith('test:')).map(runScript) : [],
    run: [
      ...(scriptManager ? Object.keys(scripts).filter((name) => ['dev', 'start', 'serve'].includes(name)).map(runScript) : []),
      ...surfaces.filter((surface) => surface.type === 'terminal' && surface.command).map((surface) => surface.command!),
    ],
  };

  const rootNames = [...new Set(activeComponents
    .filter((component) => component.profile.root === '.' && component.profile.name)
    .map((component) => component.profile.name!))];
  const profile: ProjectProfile = {
    schemaVersion: 1,
    name: rootNames.length === 1 ? rootNames[0]! : path.basename(root),
    root: '.',
    analyzedAt: new Date().toISOString(),
    packageManagers,
    workspaces,
    components: detectedComponents.map((component) => component.profile),
    languages,
    frameworks: frameworks.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root)),
    surfaces: surfaces.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
    commands,
    existingDocs: docs.sort(),
  };

  return ProjectProfileSchema.parse(profile);
}
