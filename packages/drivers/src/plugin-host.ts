import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EvidenceSchema,
  FrameworkSchema,
  ManifestSchema,
  ProjectProfileSchema,
  SurfaceSchema,
  SurfaceTypeSchema,
  normalizeManifest,
  type Evidence,
  type Manifest,
  type ProjectProfile,
  type Surface,
} from '@demoweave/core';
import {
  pluginApiVersion,
  type DemoWeavePlugin,
  type JsonValue,
  type PluginDetectorContribution,
  type PluginDriverContribution,
  type PluginOptions,
  type PluginRegistry,
} from '@demoweave/sdk';
import type { DriverContext, SurfaceDriver } from './index.js';

export class PluginHostError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PluginHostError';
  }
}

export interface PluginHostInfo {
  module: string;
  id: string;
  apiVersion: number;
  version?: string;
  fingerprint: string;
  detectors: string[];
  drivers: string[];
}

interface ConfiguredPlugin {
  module: string;
  options: PluginOptions;
}

interface LoadedPlugin {
  configured: ConfiguredPlugin;
  plugin: DemoWeavePlugin;
  fingerprint: string;
  detectors: PluginDetectorContribution[];
  drivers: PluginDriverContribution[];
}

function sha256(input: Buffer | string): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

function canonicalJson(value: JsonValue | PluginOptions): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isPortableId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

async function readConfiguration(root: string): Promise<ConfiguredPlugin[]> {
  const target = path.join(root, '.demoweave', 'config.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new PluginHostError('PLUGIN_CONFIG_INVALID', `Could not read plugin configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PluginHostError('PLUGIN_CONFIG_INVALID', 'DemoWeave config must be a JSON object.');
  }
  const plugins = Reflect.get(parsed, 'plugins');
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins)) throw new PluginHostError('PLUGIN_CONFIG_INVALID', 'Config plugins must be an array.');
  return plugins.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new PluginHostError('PLUGIN_CONFIG_INVALID', `Plugin config at index ${index} must be an object.`);
    }
    const module = Reflect.get(entry, 'module');
    const options = Reflect.get(entry, 'options') ?? {};
    if (typeof module !== 'string' || !module.trim()) {
      throw new PluginHostError('PLUGIN_CONFIG_INVALID', `Plugin config at index ${index} requires a non-empty module.`);
    }
    if (!options || typeof options !== 'object' || Array.isArray(options) || !isJsonValue(options)) {
      throw new PluginHostError('PLUGIN_OPTIONS_INVALID', `Plugin options at index ${index} must be a JSON-compatible object.`);
    }
    return { module, options: deepFreeze(options as PluginOptions) };
  });
}

function inside(root: string, target: string): boolean {
  const relation = path.relative(root, target);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation));
}

async function resolveEntry(projectRoot: string, specifier: string): Promise<string> {
  if (specifier.startsWith('file:') || path.isAbsolute(specifier) || path.win32.isAbsolute(specifier)) {
    throw new PluginHostError('PLUGIN_ABSOLUTE_PATH', `Absolute plugin module paths are not allowed: ${specifier}`);
  }
  const local = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('.\\') || specifier.startsWith('..\\');
  if (local) {
    const canonicalRoot = await fs.realpath(projectRoot);
    const requested = path.resolve(canonicalRoot, specifier);
    if (!inside(canonicalRoot, requested)) {
      throw new PluginHostError('PLUGIN_PATH_ESCAPE', `Plugin module path escapes the project root: ${specifier}`);
    }
    let resolved: string;
    try {
      resolved = await fs.realpath(requested);
    } catch {
      throw new PluginHostError('PLUGIN_MODULE_MISSING', `Configured plugin module was not found: ${specifier}`);
    }
    if (!inside(canonicalRoot, resolved)) {
      throw new PluginHostError('PLUGIN_SYMLINK_ESCAPE', `Plugin module resolves outside the project root: ${specifier}`);
    }
    return resolved;
  }
  try {
    const require = createRequire(path.join(projectRoot, 'package.json'));
    return await fs.realpath(require.resolve(specifier));
  } catch {
    throw new PluginHostError('PLUGIN_MODULE_MISSING', `Configured plugin package could not be resolved from the target project: ${specifier}`);
  }
}

function validateContributionId<T extends { id?: unknown }>(kind: string, contribution: T): asserts contribution is T & { id: string } {
  if (!isPortableId(contribution.id)) {
    throw new PluginHostError('PLUGIN_CONTRIBUTION_INVALID', `Plugin ${kind} contribution requires a portable id.`);
  }
}

async function loadOne(projectRoot: string, configured: ConfiguredPlugin): Promise<LoadedPlugin> {
  const entry = await resolveEntry(projectRoot, configured.module);
  const bytes = await fs.readFile(entry);
  let imported: Record<string, unknown>;
  try {
    imported = await import(`${pathToFileURL(entry).href}?demoweave=${sha256(bytes).slice(7)}`) as Record<string, unknown>;
  } catch (error) {
    throw new PluginHostError('PLUGIN_IMPORT_FAILED', `Could not import plugin ${configured.module}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const plugin = imported.default as Partial<DemoWeavePlugin> | undefined;
  if (!plugin || typeof plugin !== 'object' || !isPortableId(plugin.id) || typeof plugin.register !== 'function') {
    throw new PluginHostError('PLUGIN_EXPORT_INVALID', `Plugin ${configured.module} must default-export a valid DemoWeave plugin.`);
  }
  if (plugin.apiVersion !== pluginApiVersion) {
    throw new PluginHostError('PLUGIN_API_UNSUPPORTED', `Plugin ${plugin.id} uses unsupported API version ${String(plugin.apiVersion)}; expected ${pluginApiVersion}.`);
  }
  if (plugin.version !== undefined && (typeof plugin.version !== 'string' || !plugin.version.trim())) {
    throw new PluginHostError('PLUGIN_EXPORT_INVALID', `Plugin ${plugin.id} has an invalid version.`);
  }
  const stablePlugin: DemoWeavePlugin = Object.freeze({
    id: plugin.id,
    apiVersion: plugin.apiVersion,
    ...(plugin.version ? { version: plugin.version } : {}),
    register: plugin.register,
  });
  const fingerprint = sha256(Buffer.concat([
    bytes,
    Buffer.from(`\n${canonicalJson({ id: stablePlugin.id, version: stablePlugin.version ?? null, options: configured.options })}`),
  ]));
  const detectors: PluginDetectorContribution[] = [];
  const drivers: PluginDriverContribution[] = [];
  let open = true;
  const registry: PluginRegistry = Object.freeze({
    registerDetector(contribution: PluginDetectorContribution) {
      if (!open) throw new PluginHostError('PLUGIN_REGISTRATION_CLOSED', `Registration is closed for plugin ${stablePlugin.id}.`);
      validateContributionId('detector', contribution);
      if (typeof contribution.detect !== 'function') throw new PluginHostError('PLUGIN_CONTRIBUTION_INVALID', `Detector ${contribution.id} requires detect().`);
      detectors.push(Object.freeze({ ...contribution }));
    },
    registerDriver(contribution: PluginDriverContribution) {
      if (!open) throw new PluginHostError('PLUGIN_REGISTRATION_CLOSED', `Registration is closed for plugin ${stablePlugin.id}.`);
      validateContributionId('driver', contribution);
      const knownStepTypes = new Set(['run', 'navigate', 'activate', 'input', 'press', 'scroll', 'wait', 'assert', 'capture']);
      if (!Array.isArray(contribution.surfaceTypes)
        || contribution.surfaceTypes.length === 0
        || contribution.surfaceTypes.some((type) => !SurfaceTypeSchema.safeParse(type).success)
        || new Set(contribution.surfaceTypes).size !== contribution.surfaceTypes.length
        || !Array.isArray(contribution.stepTypes)
        || contribution.stepTypes.length === 0
        || contribution.stepTypes.some((type) => !knownStepTypes.has(type))
        || new Set(contribution.stepTypes).size !== contribution.stepTypes.length
        || typeof contribution.create !== 'function') {
        throw new PluginHostError('PLUGIN_CONTRIBUTION_INVALID', `Driver ${contribution.id} has an invalid factory descriptor.`);
      }
      drivers.push(Object.freeze({ ...contribution, surfaceTypes: [...contribution.surfaceTypes], stepTypes: [...contribution.stepTypes] }));
    },
  });
  try {
    const registration = stablePlugin.register(registry) as unknown;
    if (registration && typeof registration === 'object' && typeof Reflect.get(registration, 'then') === 'function') {
      void (registration as Promise<unknown>).catch(() => undefined);
      throw new PluginHostError('PLUGIN_REGISTRATION_ASYNC_UNSUPPORTED', `Plugin ${stablePlugin.id} register() must complete synchronously.`);
    }
  } catch (error) {
    if (error instanceof PluginHostError) throw error;
    throw new PluginHostError('PLUGIN_REGISTRATION_FAILED', `Plugin ${stablePlugin.id} registration failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    open = false;
  }
  return { configured, plugin: stablePlugin, fingerprint, detectors, drivers };
}

async function atomicWrite(target: string, bytes: Buffer | string, suffix: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${suffix}.tmp`);
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function readManifest(projectRoot: string): Promise<{ path: string; value: Manifest }> {
  const manifestPath = path.join(projectRoot, '.demoweave', 'evidence', 'manifest.json');
  try {
    return { path: manifestPath, value: ManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8'))) };
  } catch (error) {
    throw new PluginHostError('PLUGIN_MANIFEST_INVALID', `Plugin Evidence requires a valid Manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function normalizeContributionRoot(projectRoot: string, value: string, label: string): Promise<string> {
  if (!value || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new PluginHostError('PLUGIN_DETECTION_ROOT_INVALID', `${label} root must be project-relative.`);
  }
  const canonicalRoot = await fs.realpath(projectRoot);
  const requested = path.resolve(canonicalRoot, value);
  if (!inside(canonicalRoot, requested)) throw new PluginHostError('PLUGIN_DETECTION_ROOT_ESCAPE', `${label} root escapes the project.`);
  let resolved: string;
  try {
    resolved = await fs.realpath(requested);
  } catch {
    throw new PluginHostError('PLUGIN_DETECTION_ROOT_INVALID', `${label} root does not exist: ${value}`);
  }
  if (!inside(canonicalRoot, resolved)) throw new PluginHostError('PLUGIN_DETECTION_ROOT_ESCAPE', `${label} root resolves outside the project.`);
  return (path.relative(canonicalRoot, resolved) || '.').replaceAll(path.sep, '/');
}

export class PluginHost {
  constructor(readonly projectRoot: string, private readonly plugins: LoadedPlugin[]) {}

  list(): PluginHostInfo[] {
    return this.plugins.map(({ configured, plugin, fingerprint, detectors, drivers }) => ({
      module: configured.module,
      id: plugin.id,
      apiVersion: plugin.apiVersion,
      ...(plugin.version ? { version: plugin.version } : {}),
      fingerprint,
      detectors: detectors.map((item) => item.id),
      drivers: drivers.map((item) => item.id),
    }));
  }

  fingerprints(): ReadonlyMap<string, string> {
    return new Map(this.plugins.flatMap(({ plugin, fingerprint, drivers }) =>
      drivers.map((driver) => [`plugin/${plugin.id}/${driver.id}`, fingerprint] as const)));
  }

  async applyDetectors(profile: ProjectProfile): Promise<ProjectProfile> {
    const surfaces = [...profile.surfaces];
    const frameworks = [...profile.frameworks];
    const surfaceIds = new Set(surfaces.map((surface) => surface.id));
    for (const loaded of this.plugins) {
      for (const detector of loaded.detectors) {
        let result;
        try {
          result = await detector.detect({ projectRoot: this.projectRoot, project: profile, options: loaded.configured.options });
        } catch (error) {
          throw new PluginHostError('PLUGIN_DETECTOR_FAILED', `Detector ${loaded.plugin.id}/${detector.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new PluginHostError('PLUGIN_DETECTION_INVALID', `Detector ${loaded.plugin.id}/${detector.id} returned an invalid result.`);
        }
        if (result.surfaces !== undefined && !Array.isArray(result.surfaces)) {
          throw new PluginHostError('PLUGIN_DETECTION_INVALID', `Detector ${loaded.plugin.id}/${detector.id} surfaces must be an array.`);
        }
        if (result.frameworks !== undefined && !Array.isArray(result.frameworks)) {
          throw new PluginHostError('PLUGIN_DETECTION_INVALID', `Detector ${loaded.plugin.id}/${detector.id} frameworks must be an array.`);
        }
        for (const candidate of result.surfaces ?? []) {
          const parsed = SurfaceSchema.safeParse(candidate);
          if (!parsed.success) throw new PluginHostError('PLUGIN_SURFACE_INVALID', `Detector ${loaded.plugin.id}/${detector.id} returned an invalid surface: ${parsed.error.issues[0]?.message ?? 'invalid surface'}`);
          if (surfaceIds.has(parsed.data.id)) throw new PluginHostError('PLUGIN_SURFACE_DUPLICATE', `Duplicate detected surface id: ${parsed.data.id}`);
          const root = await normalizeContributionRoot(this.projectRoot, parsed.data.root, `Surface ${parsed.data.id}`);
          surfaces.push({ ...parsed.data, root });
          surfaceIds.add(parsed.data.id);
        }
        for (const candidate of result.frameworks ?? []) {
          const parsed = FrameworkSchema.safeParse(candidate);
          if (!parsed.success) throw new PluginHostError('PLUGIN_FRAMEWORK_INVALID', `Detector ${loaded.plugin.id}/${detector.id} returned an invalid framework.`);
          const root = await normalizeContributionRoot(this.projectRoot, parsed.data.root, `Framework ${parsed.data.name}`);
          const normalized = { ...parsed.data, root };
          const conflict = frameworks.find((item) => item.name === normalized.name && item.root === normalized.root);
          if (conflict && conflict.version !== normalized.version) throw new PluginHostError('PLUGIN_FRAMEWORK_CONFLICT', `Conflicting framework fact for ${normalized.name} at ${normalized.root}.`);
          if (!conflict) frameworks.push(normalized);
        }
      }
    }
    return ProjectProfileSchema.parse({ ...profile, surfaces, frameworks });
  }

  async createDrivers(context: DriverContext): Promise<SurfaceDriver[]> {
    const output: SurfaceDriver[] = [];
    for (const loaded of this.plugins) {
      for (const contribution of loaded.drivers) {
        const producerId = `plugin/${loaded.plugin.id}/${contribution.id}`;
        const evidence = {
          writeArtifact: async (input: Parameters<import('@demoweave/sdk').PluginEvidenceService['writeArtifact']>[0]): Promise<Evidence> => {
            if (!isPortableId(input.evidenceId)) throw new PluginHostError('PLUGIN_EVIDENCE_ID_INVALID', `Plugin Evidence id is not portable: ${input.evidenceId}`);
            if (!context.flow.steps.some((step) => step.id === input.stepId)) throw new PluginHostError('PLUGIN_EVIDENCE_STEP_INVALID', `Plugin Evidence references unknown step ${input.stepId}.`);
            const artifactRelative = `.demoweave/evidence/artifacts/${input.evidenceId}.${input.format}`;
            const artifactPath = path.join(this.projectRoot, ...artifactRelative.split('/'));
            const { path: manifestPath, value: manifest } = await readManifest(this.projectRoot);
            const previous = manifest.evidence.find((item) => item.id === input.evidenceId);
            if (previous?.producer?.id && previous.producer.id !== producerId) {
              throw new PluginHostError('PLUGIN_EVIDENCE_ID_CONFLICT', `Evidence id ${input.evidenceId} belongs to another producer.`);
            }
            const expectedMime = new Map([
              ['json', 'application/json'], ['txt', 'text/plain'], ['csv', 'text/csv'], ['md', 'text/markdown'],
              ['html', 'text/html'], ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['svg', 'image/svg+xml'],
            ]).get(input.format);
            if (expectedMime && input.mimeType !== expectedMime) {
              throw new PluginHostError('PLUGIN_EVIDENCE_MIME_INVALID', `Evidence format ${input.format} requires MIME type ${expectedMime}.`);
            }
            const next = EvidenceSchema.parse({
              schemaVersion: 1,
              id: input.evidenceId,
              kind: input.kind,
              status: 'available',
              ...(input.label ? { label: input.label } : {}),
              format: input.format,
              path: artifactRelative,
              mimeType: input.mimeType,
              producer: {
                kind: 'driver',
                id: producerId,
                ...(loaded.plugin.version ? { version: loaded.plugin.version } : {}),
                pluginFingerprint: loaded.fingerprint,
              },
              provenance: {
                flowId: context.flow.id,
                stepId: input.stepId,
                surfaceId: context.surface.id,
                sources: previous?.provenance.sources ?? [],
              },
            });
            await atomicWrite(artifactPath, typeof input.data === 'string' ? input.data : Buffer.from(input.data), 'artifact');
            const updated = normalizeManifest({
              ...manifest,
              evidence: [...manifest.evidence.filter((item) => item.id !== next.id), next],
            });
            await atomicWrite(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'manifest');
            return next;
          },
        };
        let driver;
        try {
          driver = contribution.create({ options: loaded.configured.options, evidence });
        } catch (error) {
          throw new PluginHostError('PLUGIN_DRIVER_FACTORY_FAILED', `Driver factory ${loaded.plugin.id}/${contribution.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!driver || typeof driver.supports !== 'function' || typeof driver.prepare !== 'function'
          || typeof driver.execute !== 'function' || typeof driver.close !== 'function') {
          throw new PluginHostError('PLUGIN_DRIVER_INVALID', `Driver factory ${loaded.plugin.id}/${contribution.id} returned an invalid driver.`);
        }
        output.push({
          descriptor: {
            id: producerId,
            apiVersion: 1,
            surfaceTypes: [...contribution.surfaceTypes],
            stepTypes: [...contribution.stepTypes],
          },
          supports(surface: Surface) {
            return contribution.surfaceTypes.includes(surface.type) && driver.supports(surface);
          },
          prepare: (driverContext) => driver.prepare(driverContext),
          async execute(step, driverContext) {
            try {
              return await driver.execute(step, driverContext);
            } catch (error) {
              return {
                stepId: step.id,
                status: 'failed',
                error: {
                  code: error instanceof PluginHostError ? error.code : 'PLUGIN_DRIVER_EXECUTION_FAILED',
                  message: error instanceof Error ? error.message : String(error),
                },
              };
            }
          },
          close: (driverContext) => driver.close(driverContext),
        });
      }
    }
    return output;
  }
}

export async function loadPluginHost(projectRoot: string): Promise<PluginHost> {
  const root = path.resolve(projectRoot);
  const configured = await readConfiguration(root);
  const plugins: LoadedPlugin[] = [];
  const pluginIds = new Set<string>();
  const contributionIds = new Set<string>();
  for (const entry of configured) {
    const loaded = await loadOne(root, entry);
    if (pluginIds.has(loaded.plugin.id)) throw new PluginHostError('PLUGIN_ID_DUPLICATE', `Duplicate plugin id: ${loaded.plugin.id}`);
    pluginIds.add(loaded.plugin.id);
    for (const contribution of [...loaded.detectors, ...loaded.drivers]) {
      if (contributionIds.has(contribution.id)) throw new PluginHostError('PLUGIN_CONTRIBUTION_DUPLICATE', `Duplicate plugin contribution id: ${contribution.id}`);
      contributionIds.add(contribution.id);
    }
    plugins.push(loaded);
  }
  return new PluginHost(root, plugins);
}
