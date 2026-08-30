import {
  PostgresPlatformWorkspaceStore,
  PostgresVkCommunityResultStore,
  createDatabaseConnection,
} from '@yastroyka/db';
import {
  HmacPublishingIdentityBinding,
  VkCommunityLivePublisher,
  VkCommunityPublishingAdapter,
  VkCommunityRuntimeController,
  preflightVkCommunityProductionActivation,
  type VkCommunityProductionPreflightInput,
  type VkCommunityPublishTransport,
  type VkCommunityPublishingPreview,
  type VkCommunityPublishingResult,
  type VkCommunityRuntimeApprovalPacket,
  type VkCommunitySecretProviderPort,
} from '@yastroyka/orchestrator';

export type VkCommunityProductionDatabase = ReturnType<typeof createDatabaseConnection>;
type VkCommunityResultStoreOptions = ConstructorParameters<
  typeof PostgresVkCommunityResultStore
>[1];

export type VkCommunityProductionRuntimeErrorCode = 'VK_PRODUCTION_PREFLIGHT_BLOCKED';

export class VkCommunityProductionRuntimeError extends Error {
  readonly code: VkCommunityProductionRuntimeErrorCode;

  constructor(code: VkCommunityProductionRuntimeErrorCode) {
    super(code);
    this.name = 'VkCommunityProductionRuntimeError';
    this.code = code;
  }
}

export interface VkCommunityProductionRuntimeOptions {
  readonly manifest: VkCommunityProductionPreflightInput;
  readonly database: VkCommunityProductionDatabase;
  readonly authorizationPolicy: VkCommunityResultStoreOptions['authorizationPolicy'];
  readonly authorizationAuditSink: VkCommunityResultStoreOptions['authorizationAuditSink'];
  readonly secretProvider: VkCommunitySecretProviderPort;
  readonly transport: VkCommunityPublishTransport;
  readonly clock?: () => Date;
}

export interface VkCommunityProductionDeploymentBinding {
  readonly communityId: number;
  readonly ownerId: number;
  readonly ownerPublicKeyFingerprint: string;
}

export class VkCommunityProductionRuntime {
  readonly #controller: VkCommunityRuntimeController;
  readonly deployment: VkCommunityProductionDeploymentBinding;

  constructor(options: VkCommunityProductionRuntimeOptions) {
    const preflight = preflightVkCommunityProductionActivation(options.manifest);
    if (preflight.status !== 'READY') {
      throw new VkCommunityProductionRuntimeError('VK_PRODUCTION_PREFLIGHT_BLOCKED');
    }

    const publicationState = new PostgresPlatformWorkspaceStore(options.database);
    const results = new PostgresVkCommunityResultStore(options.database, {
      authorizationPolicy: options.authorizationPolicy,
      authorizationAuditSink: options.authorizationAuditSink,
      communityId: preflight.communityId,
    });
    const optionalClock = options.clock === undefined ? {} : { clock: options.clock };

    const identityBinding = new HmacPublishingIdentityBinding({
      secretReference: preflight.publishingIdentitySecretReference,
      secretProvider: options.secretProvider,
    });

    const execution = new VkCommunityPublishingAdapter({
      communityId: preflight.communityId,
      publicationState,
      secretReference: preflight.vkCredentialSecretReference,
      identityBinding,
      secretProvider: options.secretProvider,
      transport: options.transport,
      ...optionalClock,
    });

    const publisher = new VkCommunityLivePublisher({
      communityId: preflight.communityId,
      execution,
      results,
    });

    this.#controller = new VkCommunityRuntimeController({
      communityId: preflight.communityId,
      ownerApprovalPublicKey: options.manifest.ownerApprovalPublicKey,
      publishingIdentitySecretReference: preflight.publishingIdentitySecretReference,
      secretProvider: options.secretProvider,
      previewer: execution,
      publisher,
      ...optionalClock,
    });

    this.deployment = Object.freeze({
      communityId: preflight.communityId,
      ownerId: preflight.ownerId,
      ownerPublicKeyFingerprint: preflight.ownerPublicKeyFingerprint,
    });
  }

  async preview(publicationId: string): Promise<VkCommunityPublishingPreview> {
    return await this.#controller.preview(publicationId);
  }

  async prepareApproval(publicationId: string): Promise<VkCommunityRuntimeApprovalPacket> {
    return await this.#controller.prepareApproval(publicationId);
  }

  async execute(
    publicationId: string,
    ownerGrantContext: unknown,
  ): Promise<VkCommunityPublishingResult> {
    return await this.#controller.execute(publicationId, ownerGrantContext);
  }
}

export function createVkCommunityProductionRuntime(
  options: VkCommunityProductionRuntimeOptions,
): VkCommunityProductionRuntime {
  return new VkCommunityProductionRuntime(options);
}
