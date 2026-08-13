import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin, pluginApiVersion } from '@demoweave/sdk';

async function marker(projectRoot) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, 'marker.json'), 'utf8'));
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
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

    registry.registerRenderer({
      id: 'fixture-service-card',
      accepts: [{ kinds: ['result'], formats: ['json'] }],
      outputFormats: ['svg'],
      create({ options }) {
        return {
          render({ source, sourceBytes, format }) {
            const value = JSON.parse(new TextDecoder().decode(sourceBytes));
            const prefix = escapeXml(value.prefix ?? options.prefix ?? 'DemoWeave');
            const service = escapeXml(value.service);
            const message = escapeXml(value.message);
            const label = `${value.service} documentation card`;
            if (source.id !== 'plugin-service-result' || format !== 'svg') throw new Error('Unexpected fixture renderer input.');
            return {
              kind: 'image',
              format: 'svg',
              mimeType: 'image/svg+xml',
              label,
              data: [
                '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280" role="img" aria-labelledby="title description">',
                `  <title id="title">${service} documentation card</title>`,
                `  <desc id="description">${message}</desc>`,
                '  <rect width="720" height="280" rx="28" fill="#0b1220"/>',
                '  <rect x="24" y="24" width="672" height="232" rx="20" fill="#111c31" stroke="#334155" stroke-width="2"/>',
                '  <circle cx="72" cy="72" r="20" fill="#38bdf8"/>',
                '  <path d="M62 72h20M72 62v20" stroke="#082f49" stroke-width="4" stroke-linecap="round"/>',
                `  <text x="108" y="66" fill="#7dd3fc" font-family="monospace" font-size="18" font-weight="700">${prefix}</text>`,
                '  <text x="108" y="91" fill="#94a3b8" font-family="monospace" font-size="14">PLUGIN RENDERER PROOF</text>',
                `  <text x="56" y="157" fill="#f8fafc" font-family="monospace" font-size="30" font-weight="700">${service}</text>`,
                `  <text x="56" y="202" fill="#cbd5e1" font-family="monospace" font-size="18">${message}</text>`,
                '  <rect x="56" y="224" width="126" height="4" rx="2" fill="#38bdf8"/>',
                '</svg>',
                '',
              ].join('\n'),
            };
          },
          close() {},
        };
      },
    });
  },
});
