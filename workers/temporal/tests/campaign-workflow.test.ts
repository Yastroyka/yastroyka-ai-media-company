import assert from 'node:assert/strict';
import test from 'node:test';

import { TestWorkflowEnvironment } from '@temporalio/testing';

import {
  campaignDecisionSignal,
  campaignStateQuery,
  campaignWorkflow,
  createCampaignWorker,
  type CampaignActivities,
  type CampaignWorkflowState,
} from '../src/index.ts';

const input = {
  campaignId: 'campaign-task-005',
  stateRef: 'postgres://campaign/task-005',
  objective: 'Prepare the first owned YASTROYKA campaign draft.',
} as const;

async function waitForStatus(
  query: () => Promise<CampaignWorkflowState>,
  expectedStatus: CampaignWorkflowState['status'],
): Promise<CampaignWorkflowState> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      const state = await query();

      if (state.status === expectedStatus) {
        return state;
      }
    } catch {
      // The first workflow task may not have completed yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Workflow did not reach ${expectedStatus}.`);
}

test(
  'a worker restart preserves the approval wait and accepts a durable signal',
  { timeout: 120_000 },
  async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `campaign-restart-${Date.now()}`;
    const activities: CampaignActivities = {
      async generateCampaignDraft() {
        return { content: 'provider draft', source: 'provider' };
      },
      async prepareAssistedDraft() {
        return { content: 'assisted draft', source: 'assisted' };
      },
    };

    try {
      const firstWorker = await createCampaignWorker({
        connection: environment.nativeConnection,
        taskQueue,
        activities,
        maxCachedWorkflows: 0,
      });
      const handle = await environment.client.workflow.start(campaignWorkflow, {
        args: [input],
        taskQueue,
        workflowId: 'campaign-task-005-restart',
      });

      const beforeRestart = await firstWorker.runUntil(
        waitForStatus(() => handle.query(campaignStateQuery), 'awaiting_approval'),
      );
      assert.equal(beforeRestart.draft?.content, 'provider draft');

      await handle.signal(campaignDecisionSignal, {
        value: 'approved',
        reviewerId: 'human-reviewer',
      });

      const secondWorker = await createCampaignWorker({
        connection: environment.nativeConnection,
        taskQueue,
        activities,
        maxCachedWorkflows: 0,
      });
      const result = await secondWorker.runUntil(handle.result());

      assert.equal(result.status, 'approved');
      assert.equal(result.draft.content, 'provider draft');
      assert.equal(result.decision.reviewerId, 'human-reviewer');
    } finally {
      await environment.teardown();
    }
  },
);

test(
  'exhausted generation retries enter the assisted fallback before approval',
  { timeout: 120_000 },
  async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const taskQueue = `campaign-fallback-${Date.now()}`;
    let generationAttempts = 0;
    let fallbackAttempts = 0;
    const activities: CampaignActivities = {
      async generateCampaignDraft() {
        generationAttempts += 1;
        throw new Error('provider unavailable');
      },
      async prepareAssistedDraft() {
        fallbackAttempts += 1;
        return { content: 'human-assisted draft', source: 'assisted' };
      },
    };
    const worker = await createCampaignWorker({
      connection: environment.nativeConnection,
      taskQueue,
      activities,
    });

    try {
      const result = await worker.runUntil(async () => {
        const handle = await environment.client.workflow.start(campaignWorkflow, {
          args: [input],
          taskQueue,
          workflowId: 'campaign-task-005-fallback',
        });

        const waiting = await waitForStatus(
          () => handle.query(campaignStateQuery),
          'awaiting_approval',
        );
        assert.equal(waiting.draft?.source, 'assisted');

        await handle.signal(campaignDecisionSignal, {
          value: 'rejected',
          reviewerId: 'human-reviewer',
        });

        return handle.result();
      });

      assert.equal(generationAttempts, 3);
      assert.equal(fallbackAttempts, 1);
      assert.equal(result.status, 'rejected');
      assert.equal(result.draft.content, 'human-assisted draft');
    } finally {
      await environment.teardown();
    }
  },
);
