import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createEnvironmentSecretProvider,
  loadPolicyContract,
  type EnvironmentSecretBinding,
} from '@yastroyka/auth';
import {
  createDatabaseConnection,
  createPostgresAuthorizationAuditSink,
} from '@yastroyka/db';
import {
  VkCommunityHttpTransport,
  VkCommunityPublishingError,
  VkCommunityRuntimeGateError,
  parseVkCommunityOperatorManifest,
  preflightVkCommunityProductionActivation,
  type VkCommunityProductionPreflightInput,
  type VkCommunityProductionPreflightReady,
  type VkCommunityPublishTransport,
  type VkCommunityPublishingResult,
  type VkCommunitySecretProviderPort,
} from '@yastroyka/orchestrator';

import {
  VkCommunityProductionRuntimeError,
  createVkCommunityProductionRuntime,
  type VkCommunityProductionDatabase,
  type VkCommunityProductionRuntimeOptions,
} from './vk-community-production-runtime.ts';

export type VkCommunityLiveExecutionExitCode = 0 | 2 | 64 | 65 | 70;

export const VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE =
  'YASTROYKA_VK_COMMUNITY_ACCESS_TOKEN' as const;
export const VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE =
  'YASTROYKA_VK_COMMUNITY_PUBLISHING_IDENTITY_SECRET' as const;
export const VK_LIVE_CONFIRMATION_PREFIX = '--confirm-live-wall-post=' as const;

export interface VkCommunityLiveRuntimePort {
  execute(publicationId: string, ownerGrantContext: unknown): Promise<VkCommunityPublishingResult>;
}

export interface VkCommunityLiveRuntimeLease {
  readonly runtime: VkCommunityLiveRuntimePort;
  close(): Promise<void>;
}

export interface VkCommunityLiveExecutionDependencies {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly openRuntime: (
    manifest: VkCommunityProductionPreflightInput,
  ) => Promise<VkCommunityLiveRuntimeLease>;
}

export interface VkCommunityLiveExecutionIo {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
}

export interface VkCommunityProductionLiveRuntimeFactoryDependencies {
  readonly loadAuthorizationPolicy: () => VkCommunityProductionRuntimeOptions['authorizationPolicy'];
  readonly openDatabase: () => VkCommunityProductionDatabase;
  readonly createAuthorizationAuditSink: (
    database: VkCommunityProductionDatabase,
  ) => VkCommunityProductionRuntimeOptions['authorizationAuditSink'];
  readonly createSecretProvider: (
    bindings: readonly EnvironmentSecretBinding[],
  ) => VkCommunitySecretProviderPort;
  readonly createTransport: () => VkCommunityPublishTransport;
  readonly createRuntime: (options: VkCommunityProductionRuntimeOptions) => VkCommunityLiveRuntimePort;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LIVE_CONFIRMATION_PATTERN = /^--confirm-live-wall-post=-[1-9][0-9]{0,9}$/u;
const MAX_PATH_LENGTH = 4_096;
const MAX_GRANT_LENGTH = 65_536;
const AUTHORIZATION_POLICY_PATH = fileURLToPath(
  new URL('../../../specs/authz/policy-contract.yaml', import.meta.url),
);

class VkCommunityLiveExecutionInputError extends Error {
  constructor() {
    super('VK live execution input invalid');
    this.name = 'VkCommunityLiveExecutionInputError';
  }
}

export class VkCommunityLiveExecutionConfigurationError extends Error {
  constructor() {
    super('VK live execution configuration invalid');
    this.name = 'VkCommunityLiveExecutionConfigurationError';
  }
}

function failInput(): never {
  throw new VkCommunityLiveExecutionInputError();
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

function requirePublicationId(value: string | undefined): string {
  if (value === undefined || !UUID_PATTERN.test(value)) {
    failInput();
  }
  return value;
}

function requirePath(value: string | undefined): string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes('\u0000')
  ) {
    failInput();
  }
  return value;
}

function requireLiveConfirmation(value: string | undefined): string {
  if (value === undefined || !LIVE_CONFIRMATION_PATTERN.test(value)) {
    failInput();
  }
  return value;
}

function parseGrantJson(text: string): unknown {
  if (text.length === 0 || text.length > MAX_GRANT_LENGTH || text.includes('\u0000')) {
    failInput();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failInput();
  }
}

function requireEnvironmentBackedPreflight(
  preflight: VkCommunityProductionPreflightReady,
): VkCommunityProductionPreflightReady {
  if (
    preflight.vkCredentialSecretReference.provider !== 'env' ||
    preflight.publishingIdentitySecretReference.provider !== 'env'
  ) {
    throw new VkCommunityLiveExecutionConfigurationError();
  }
  return preflight;
}

function secretBindings(
  preflight: VkCommunityProductionPreflightReady,
): readonly EnvironmentSecretBinding[] {
  return Object.freeze([
    Object.freeze({
      key: preflight.vkCredentialSecretReference.key,
      environmentVariable: VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
    }),
    Object.freeze({
      key: preflight.publishingIdentitySecretReference.key,
      environmentVariable: VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
    }),
  ]);
}

const DEFAULT_PRODUCTION_RUNTIME_FACTORY_DEPENDENCIES: VkCommunityProductionLiveRuntimeFactoryDependencies =
  Object.freeze({
    loadAuthorizationPolicy() {
      return loadPolicyContract(AUTHORIZATION_POLICY_PATH);
    },
    openDatabase() {
      return createDatabaseConnection();
    },
    createAuthorizationAuditSink(database) {
      return createPostgresAuthorizationAuditSink(database);
    },
    createSecretProvider(bindings) {
      return createEnvironmentSecretProvider({ bindings });
    },
    createTransport() {
      return new VkCommunityHttpTransport();
    },
    createRuntime(options) {
      return createVkCommunityProductionRuntime(options);
    },
  });

export async function openVkCommunityProductionLiveRuntime(
  manifest: VkCommunityProductionPreflightInput,
  dependencies: VkCommunityProductionLiveRuntimeFactoryDependencies =
    DEFAULT_PRODUCTION_RUNTIME_FACTORY_DEPENDENCIES,
): Promise<VkCommunityLiveRuntimeLease> {
  const preflight = preflightVkCommunityProductionActivation(manifest);
  if (preflight.status !== 'READY') {
    throw new VkCommunityProductionRuntimeError('VK_PRODUCTION_PREFLIGHT_BLOCKED');
  }
  requireEnvironmentBackedPreflight(preflight);

  const authorizationPolicy = dependencies.loadAuthorizationPolicy();
  const secretProvider = dependencies.createSecretProvider(secretBindings(preflight));
  const transport = dependencies.createTransport();
  const database = dependencies.openDatabase();
  let closed = false;

  try {
    const runtime = dependencies.createRuntime({
      manifest,
      database,
      authorizationPolicy,
      authorizationAuditSink: dependencies.createAuthorizationAuditSink(database),
      secretProvider,
      transport,
    });

    return Object.freeze({
      runtime,
      async close() {
        if (closed) {
          return;
        }
        closed = true;
        await database.close();
      },
    });
  } catch (error) {
    try {
      await database.close();
    } catch {
      // Preserve the original construction error.
    }
    throw error;
  }
}

interface VkCommunityBlockedExecutionResult {
  readonly status: 'BLOCKED';
  readonly stage: 'OWNER_GRANT' | 'PUBLICATION' | 'IDENTITY' | 'SECRET';
  readonly reason: string;
}

interface VkCommunityUnknownExecutionResult {
  readonly status: 'UNKNOWN';
  readonly stage: 'EXECUTION';
  readonly reason: 'VK_EXECUTION_OUTCOME_UNCERTAIN';
}

type VkCommunityFailedExecutionResult =
  | VkCommunityBlockedExecutionResult
  | VkCommunityUnknownExecutionResult;

const PRE_NETWORK_PUBLICATION_ERRORS = new Set([
  'VK_PUBLICATION_READ_FAILED',
  'VK_PUBLICATION_NOT_FOUND',
  'VK_PUBLICATION_NOT_AUTO',
  'VK_PUBLICATION_INVALID',
] as const);

const PRE_NETWORK_IDENTITY_ERRORS = new Set([
  'VK_IDENTITY_BINDING_FAILED',
  'VK_IDENTITY_DENIED',
] as const);

const PRE_NETWORK_SECRET_ERRORS = new Set([
  'VK_SECRET_REFERENCE_INVALID',
  'VK_SECRET_ACCESS_FAILED',
] as const);

function unknownExecution(): VkCommunityUnknownExecutionResult {
  return {
    status: 'UNKNOWN',
    stage: 'EXECUTION',
    reason: 'VK_EXECUTION_OUTCOME_UNCERTAIN',
  };
}

function classifyExecutionFailure(error: unknown): VkCommunityFailedExecutionResult {
  if (error instanceof VkCommunityRuntimeGateError) {
    if (error.code === 'VK_OWNER_GRANT_FAILED') {
      return {
        status: 'BLOCKED',
        stage: 'OWNER_GRANT',
        reason: 'VK_OWNER_GRANT_INVALID',
      };
    }
    if (error.code === 'VK_RUNTIME_PREVIEW_INVALID') {
      return {
        status: 'BLOCKED',
        stage: 'PUBLICATION',
        reason: error.code,
      };
    }
    if (error.code === 'VK_IDENTITY_ISSUE_FAILED') {
      return {
        status: 'BLOCKED',
        stage: 'IDENTITY',
        reason: error.code,
      };
    }
    return unknownExecution();
  }

  if (error instanceof VkCommunityPublishingError) {
    if (PRE_NETWORK_PUBLICATION_ERRORS.has(error.code as never)) {
      return {
        status: 'BLOCKED',
        stage: 'PUBLICATION',
        reason: error.code,
      };
    }
    if (PRE_NETWORK_IDENTITY_ERRORS.has(error.code as never)) {
      return {
        status: 'BLOCKED',
        stage: 'IDENTITY',
        reason: error.code,
      };
    }
    if (PRE_NETWORK_SECRET_ERRORS.has(error.code as never)) {
      return {
        status: 'BLOCKED',
        stage: 'SECRET',
        reason: error.code,
      };
    }
    return unknownExecution();
  }

  return unknownExecution();
}

async function closeLease(lease: VkCommunityLiveRuntimeLease, io: VkCommunityLiveExecutionIo) {
  try {
    await lease.close();
  } catch {
    io.writeStderr('VK live execution cleanup failed\n');
  }
}

export async function runVkCommunityLiveExecutionOperator(
  args: readonly string[],
  dependencies: VkCommunityLiveExecutionDependencies,
  io: VkCommunityLiveExecutionIo,
): Promise<VkCommunityLiveExecutionExitCode> {
  if (args.length !== 5 || args[0] !== 'execute-live') {
    io.writeStderr(
      'Usage: vk:execute-live <publication-id> <owner-grant.json> <non-secret-manifest.json> --confirm-live-wall-post=<owner-id>\n',
    );
    return 64;
  }

  let publicationId: string;
  let grantPath: string;
  let manifestPath: string;
  let liveConfirmation: string;

  try {
    publicationId = requirePublicationId(args[1]);
    grantPath = requirePath(args[2]);
    manifestPath = requirePath(args[3]);
    liveConfirmation = requireLiveConfirmation(args[4]);
  } catch {
    io.writeStderr('VK live execution input invalid\n');
    return 65;
  }

  let manifest: VkCommunityProductionPreflightInput;
  let preflight: ReturnType<typeof preflightVkCommunityProductionActivation>;
  try {
    manifest = parseVkCommunityOperatorManifest(await dependencies.readTextFile(manifestPath));
    preflight = preflightVkCommunityProductionActivation(manifest);
  } catch {
    io.writeStderr('VK live execution input invalid\n');
    return 65;
  }

  if (preflight.status === 'BLOCKED') {
    io.writeStdout(
      jsonLine({
        status: 'BLOCKED',
        stage: 'PRODUCTION_PREFLIGHT',
        reasons: preflight.reasons,
      }),
    );
    return 2;
  }

  if (liveConfirmation !== `${VK_LIVE_CONFIRMATION_PREFIX}${preflight.ownerId}`) {
    io.writeStdout(
      jsonLine({
        status: 'BLOCKED',
        stage: 'LIVE_CONFIRMATION',
        reason: 'DESTINATION_CONFIRMATION_MISMATCH',
        ownerId: preflight.ownerId,
      }),
    );
    return 2;
  }

  if (
    preflight.vkCredentialSecretReference.provider !== 'env' ||
    preflight.publishingIdentitySecretReference.provider !== 'env'
  ) {
    io.writeStdout(
      jsonLine({
        status: 'BLOCKED',
        stage: 'SECRET_PROVIDER',
        reason: 'ENVIRONMENT_SECRET_PROVIDER_REQUIRED',
      }),
    );
    return 2;
  }

  let ownerGrant: unknown;
  try {
    ownerGrant = parseGrantJson(await dependencies.readTextFile(grantPath));
  } catch {
    io.writeStderr('VK live execution input invalid\n');
    return 65;
  }

  let lease: VkCommunityLiveRuntimeLease;
  try {
    lease = await dependencies.openRuntime(manifest);
  } catch {
    io.writeStderr('VK live execution failed before execution\n');
    return 70;
  }

  let published: VkCommunityPublishingResult | null = null;
  let failed: VkCommunityFailedExecutionResult | null = null;
  try {
    published = await lease.runtime.execute(publicationId, ownerGrant);
  } catch (error) {
    failed = classifyExecutionFailure(error);
  }

  await closeLease(lease, io);

  if (published !== null) {
    io.writeStdout(
      jsonLine({
        status: 'PUBLISHED',
        publicationId: published.publicationId,
        platform: published.platform,
        ownerId: published.ownerId,
        postId: published.postId,
        idempotencyKey: published.idempotencyKey,
        publishedAt: published.publishedAt,
      }),
    );
    return 0;
  }

  const result = failed ?? unknownExecution();
  io.writeStdout(jsonLine(result));
  return result.status === 'BLOCKED' ? 2 : 70;
}

async function main(): Promise<void> {
  const exitCode = await runVkCommunityLiveExecutionOperator(
    process.argv.slice(2),
    {
      async readTextFile(path) {
        return await readFile(path, 'utf8');
      },
      async openRuntime(manifest) {
        return await openVkCommunityProductionLiveRuntime(manifest);
      },
    },
    {
      writeStdout(text) {
        process.stdout.write(text);
      },
      writeStderr(text) {
        process.stderr.write(text);
      },
    },
  );
  process.exitCode = exitCode;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  await main();
}
