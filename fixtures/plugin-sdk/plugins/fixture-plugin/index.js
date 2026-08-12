import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin, pluginApiVersion } from '@demoweave/sdk';

async function marker(projectRoot) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, 'marker.json'), 'utf8'));
}

export default definePlugin({
  id: 'fixture-service',
  apiVersion: pluginApiVersion,
  version: '0.0.1',
  register(registry) {
    registry.registerDetector({
      id: 'fixture-service-detector',
      async detect({ projectRoot }) {
        const value = await marker(projectRoot);
        return {
          frameworks: [{ name: 'Fixture Service', root: '.', version: '1' }],
          surfaces: [{
            id: `service-${value.service}`,
            type: 'service',
            root: '.',
            framework: 'Fixture Service',
            label: value.service,
          }],
        };
      },
    });

    registry.registerDriver({
      id: 'fixture-service-driver',
      surfaceTypes: ['service'],
      stepTypes: ['assert', 'capture'],
      create({ options, evidence }) {
        return {
          supports(surface) {
            return surface.framework === 'Fixture Service';
          },
          async prepare() {},
          async execute(step, context) {
            const value = await marker(context.projectRoot);
            if (step.type === 'assert') {
              const expected = step.assertion.kind === 'textContains' ? step.assertion.value : '';
              const passed = JSON.stringify(value).includes(expected);
              return passed
                ? { stepId: step.id, status: 'passed' }
                : { stepId: step.id, status: 'failed', error: { code: 'FIXTURE_ASSERTION_FAILED', message: `Marker does not contain ${expected}` } };
            }
            if (step.type === 'capture') {
              const artifact = `${JSON.stringify({ prefix: options.prefix, ...value }, null, 2)}\n`;
              const written = await evidence.writeArtifact({
                evidenceId: step.evidenceId,
                stepId: step.id,
                kind: step.kind,
                format: 'json',
                mimeType: 'application/json',
                data: artifact,
                label: 'External plugin result',
              });
              return { stepId: step.id, status: 'passed', evidence: [written] };
            }
            return { stepId: step.id, status: 'failed', error: { code: 'FIXTURE_STEP_UNSUPPORTED', message: `Unsupported step ${step.type}` } };
          },
          async close() {},
        };
      },
    });
  },
});
