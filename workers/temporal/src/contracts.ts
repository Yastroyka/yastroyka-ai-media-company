export type CampaignDraftSource = 'provider' | 'assisted';

export interface CampaignWorkflowInput {
  readonly campaignId: string;
  readonly stateRef: string;
  readonly objective: string;
}

export interface CampaignDraft {
  readonly content: string;
  readonly source: CampaignDraftSource;
}

export interface GenerateCampaignDraftInput {
  readonly campaignId: string;
  readonly objective: string;
}

export interface PrepareAssistedDraftInput extends GenerateCampaignDraftInput {
  readonly reason: 'generation_retries_exhausted';
}

export interface CampaignActivities {
  generateCampaignDraft(input: GenerateCampaignDraftInput): Promise<CampaignDraft>;
  prepareAssistedDraft(input: PrepareAssistedDraftInput): Promise<CampaignDraft>;
}

export type CampaignDecisionValue = 'approved' | 'rejected';

export interface CampaignDecision {
  readonly value: CampaignDecisionValue;
  readonly reviewerId: string;
}

export type CampaignWorkflowStatus =
  'generating' | 'assisted_fallback' | 'awaiting_approval' | 'approved' | 'rejected';

export interface CampaignWorkflowState {
  readonly campaignId: string;
  readonly stateRef: string;
  readonly status: CampaignWorkflowStatus;
  readonly draft: CampaignDraft | null;
  readonly decision: CampaignDecision | null;
}

export interface CampaignWorkflowResult {
  readonly campaignId: string;
  readonly status: Extract<CampaignWorkflowStatus, 'approved' | 'rejected'>;
  readonly draft: CampaignDraft;
  readonly decision: CampaignDecision;
}
