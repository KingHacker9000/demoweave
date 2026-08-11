import assert from 'node:assert/strict';
import test from 'node:test';
import type { RegenerationAction } from '@demoweave/core';
import type { FlowExecutionOptions, FlowExecutionResult } from '@demoweave/drivers';
import type { RenderedMedia, RenderEvidenceOptions } from '@demoweave/renderer';
import { applyRegenerationAction } from './freshness.js';

const runAction: RegenerationAction = {
  kind: 'run-flow',
  flowId: 'create-project',
  evidenceIds: ['create-project-result'],
};

const passedResult: FlowExecutionResult = {
  status: 'passed',
  flowId: 'create-project',
  surfaceId: 'web-fixture-web',
  surfaceType: 'web',
  driverId: 'web',
  steps: [],
  evidence: [],
};

function dependencies(run: (reference: string, options?: FlowExecutionOptions) => Promise<FlowExecutionResult>) {
  return {
    runFlow: run,
    renderEvidence: async (_reference: string, _options: RenderEvidenceOptions): Promise<RenderedMedia> => ({
      format: 'png',
      evidenceId: 'unused',
      outputPath: 'unused',
      width: 1,
      height: 1,
      sizeBytes: 1,
    }),
    snapshotEvidenceArtifact: async () => {
      throw new Error('snapshot should not run for Flow actions');
    },
  };
}

test('forwards invocation-scoped browser context during selective Flow regeneration', async () => {
  let receivedReference: string | undefined;
  let receivedOptions: FlowExecutionOptions | undefined;

  await applyRegenerationAction('/fixture', runAction, {
    baseUrl: 'http://127.0.0.1:4321',
    headed: true,
    desktopPid: 4242,
  }, dependencies(async (reference, options) => {
    receivedReference = reference;
    receivedOptions = options;
    return passedResult;
  }));

  assert.equal(receivedReference, 'create-project');
  assert.deepEqual(receivedOptions, {
    projectRoot: '/fixture',
    baseUrl: 'http://127.0.0.1:4321',
    headless: false,
    desktopPid: 4242,
  });
});

test('does not invent browser runtime context for regeneration', async () => {
  let receivedOptions: FlowExecutionOptions | undefined;

  await applyRegenerationAction('/fixture', runAction, {}, dependencies(async (_reference, options) => {
    receivedOptions = options;
    return passedResult;
  }));

  assert.deepEqual(receivedOptions, { projectRoot: '/fixture' });
});

test('surfaces a failed regenerated Flow', async () => {
  await assert.rejects(
    applyRegenerationAction('/fixture', runAction, {}, dependencies(async () => ({
      ...passedResult,
      status: 'failed',
      error: { code: 'STEP_FAILED', message: 'relative navigation requires --base-url' },
    }))),
    /relative navigation requires --base-url/,
  );
});
