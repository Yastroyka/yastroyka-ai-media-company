import type { PublicationDiscoveryRecord } from '@yastroyka/db';

export interface VkCommunityActivationReadinessSource {
  readonly listRecentByPlatform: (
    platform: 'VK_COMMUNITY',
    limit?: number,
  ) => Promise<readonly PublicationDiscoveryRecord[]>;
}

export interface VkCommunityActivationCandidate {
  readonly publicationId: string;
  readonly masterContentId: string;
  readonly workspaceId: string;
  readonly platform: 'VK_COMMUNITY';
  readonly status: PublicationDiscoveryRecord['status'];
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export type VkCommunityActivationReadinessResult =
  | {
      readonly status: 'CANDIDATE_FOUND';
      readonly stage: 'PUBLICATION_DISCOVERY';
      readonly platform: 'VK_COMMUNITY';
      readonly inspectedCount: number;
      readonly autoCandidates: readonly VkCommunityActivationCandidate[];
      readonly recent: readonly VkCommunityActivationCandidate[];
      readonly nextGate: 'VK_RELEASE_REHEARSAL_REQUIRED';
      readonly guarantees: VkCommunityActivationReadinessGuarantees;
    }
  | {
      readonly status: 'BLOCKED';
      readonly stage: 'PUBLICATION_DISCOVERY';
      readonly platform: 'VK_COMMUNITY';
      readonly reason: 'NO_AUTO_REHEARSAL_CANDIDATE';
      readonly inspectedCount: number;
      readonly autoCandidates: readonly [];
      readonly recent: readonly VkCommunityActivationCandidate[];
      readonly nextGate: 'CANONICAL_PUBLICATION_PREPARATION_REQUIRED';
      readonly guarantees: VkCommunityActivationReadinessGuarantees;
    };

interface VkCommunityActivationReadinessGuarantees {
  readonly readOnly: true;
  readonly publicationPayloadRead: false;
  readonly secretMaterialAccess: false;
  readonly networkAccess: false;
  readonly productionWrite: false;
  readonly productionReadyClaim: false;
}

const DEFAULT_DISCOVERY_LIMIT = 20;

function toSafeCandidate(record: PublicationDiscoveryRecord): VkCommunityActivationCandidate {
  if (record.platform !== 'VK_COMMUNITY') {
    throw new Error('Publication discovery returned an unexpected platform.');
  }

  return Object.freeze({
    publicationId: record.publicationId,
    masterContentId: record.masterContentId,
    workspaceId: record.workspaceId,
    platform: 'VK_COMMUNITY' as const,
    status: record.status,
    createdAt: record.createdAt,
    publishedAt: record.publishedAt,
  });
}

function guarantees(): VkCommunityActivationReadinessGuarantees {
  return Object.freeze({
    readOnly: true,
    publicationPayloadRead: false,
    secretMaterialAccess: false,
    networkAccess: false,
    productionWrite: false,
    productionReadyClaim: false,
  });
}

export async function inspectVkCommunityActivationReadiness(
  source: VkCommunityActivationReadinessSource,
  limit = DEFAULT_DISCOVERY_LIMIT,
): Promise<VkCommunityActivationReadinessResult> {
  const records = await source.listRecentByPlatform('VK_COMMUNITY', limit);
  const recent = Object.freeze(records.map(toSafeCandidate));
  const autoCandidates = Object.freeze(recent.filter((record) => record.status === 'AUTO'));

  if (autoCandidates.length === 0) {
    return Object.freeze({
      status: 'BLOCKED' as const,
      stage: 'PUBLICATION_DISCOVERY' as const,
      platform: 'VK_COMMUNITY' as const,
      reason: 'NO_AUTO_REHEARSAL_CANDIDATE' as const,
      inspectedCount: recent.length,
      autoCandidates: Object.freeze([]) as readonly [],
      recent,
      nextGate: 'CANONICAL_PUBLICATION_PREPARATION_REQUIRED' as const,
      guarantees: guarantees(),
    });
  }

  return Object.freeze({
    status: 'CANDIDATE_FOUND' as const,
    stage: 'PUBLICATION_DISCOVERY' as const,
    platform: 'VK_COMMUNITY' as const,
    inspectedCount: recent.length,
    autoCandidates,
    recent,
    nextGate: 'VK_RELEASE_REHEARSAL_REQUIRED' as const,
    guarantees: guarantees(),
  });
}
