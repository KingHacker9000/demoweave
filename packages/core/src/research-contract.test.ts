import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { EvidenceFormatSchema, FlowSchema } from './index.js';

const repository = path.resolve(process.cwd(), '../..');

async function readJson(relativePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(repository, relativePath), 'utf8'));
}

function researchFlow(capture: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    id: 'research-contract',
    surfaceId: 'research-workflow',
    steps: [{
      id: 'capture-result',
      type: 'capture',
      evidenceId: 'result',
      kind: 'result',
      ...capture,
    }],
  };
}

test('Flow v1 accepts native artifact capture while keeping UI target and artifact mutually exclusive', () => {
  assert.equal(FlowSchema.safeParse(researchFlow({ artifact: { path: 'outputs/metrics.json' } })).success, true);
  assert.equal(FlowSchema.safeParse(researchFlow({
    target: { strategy: 'text', value: 'Result' },
    artifact: { path: 'outputs/metrics.json' },
  })).success, false);
  assert.equal(FlowSchema.safeParse(researchFlow({ artifact: { path: '' } })).success, false);
});

test('published Flow/Evidence schemas expose M11 artifact capture and IPYNB format', async () => {
  const flowSchema = await readJson('schemas/flow.schema.json');
  const evidenceSchema = await readJson('schemas/evidence.schema.json');
  const captureBranch = flowSchema.$defs.step.oneOf.find((branch: any) => branch.properties.type?.const === 'capture');

  assert.deepEqual(flowSchema.$defs.artifactCapture.required, ['path']);
  assert.equal(captureBranch.properties.artifact.$ref, '#/$defs/artifactCapture');
  assert.deepEqual(captureBranch.not.required, ['target', 'artifact']);
  assert.deepEqual(evidenceSchema.properties.format.enum, EvidenceFormatSchema.options);
  assert.ok(evidenceSchema.properties.format.enum.includes('ipynb'));
});
