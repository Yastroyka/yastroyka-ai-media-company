import {
  ActivityFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

import type {
  CampaignActivities,
  CampaignDecision,
  CampaignWorkflowInput,
  CampaignWorkflowResult,
  CampaignWorkflowState,
} from '../contracts.ts';

const { generateCampaignDraft } = proxyActivities<
  Pick<CampaignActivities, 'generateCampaignDraft'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

const { prepareAssistedDraft } = proxyActivities<Pick<CampaignActivities, 'prepareAssistedDraft'>>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 1,
  },
});

export const campaignDecisionSignal = defineSignal<[CampaignDecision]>('campaignDecision');

export const campaignStateQuery = defineQuery<CampaignWorkflowState>('campaignState');

export async function campaignWorkflow(
  input: CampaignWorkflowInput,
): Promise<CampaignWorkflowResult> {
  let state: CampaignWorkflowState = {
    campaignId: input.campaignId,
    stateRef: input.stateRef,
    status: 'generating',
    draft: null,
    decision: null,
  };

  setHandler(campaignStateQuery, () => state);
  setHandler(campaignDecisionSignal, (decision) => {
    const validDecision = decision.value === 'approved' || decision.value === 'rejected';
    if (
      state.status !== 'awaiting_approval' ||
      state.decision !== null ||
      !validDecision ||
      decision.reviewerId.trim().length === 0
    ) {
      return;
    }

    state = { ...state, decision };
  });

  try {
    const draft = await generateCampaignDraft({
      campaignId: input.campaignId,
      objective: input.objective,
    });

    state = { ...state, draft, status: 'awaiting_approval' };
  } catch (error) {
    if (!(error instanceof ActivityFailure)) {
      throw error;
    }

    state = { ...state, status: 'assisted_fallback' };

    const draft = await prepareAssistedDraft({
      campaignId: input.campaignId,
      objective: input.objective,
      reason: 'generation_retries_exhausted',
    });

    state = { ...state, draft, status: 'awaiting_approval' };
  }

  await condition(() => state.decision !== null);

  const { decision, draft } = state;

  if (decision === null || draft === null) {
    throw new Error('Campaign workflow reached an invalid completion state.');
  }

  const status = decision.value;
  state = { ...state, status };

  return {
    campaignId: input.campaignId,
    status,
    draft,
    decision,
  };
}
