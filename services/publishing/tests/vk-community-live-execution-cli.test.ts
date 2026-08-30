import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  VkCommunityPublishingError,
  VkCommunityRuntimeGateError,
  type VkCommunityPublishTransport,
  type VkCommunitySecretProviderPort,
} from '@yastroyka/orchestrator';

import {
  VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
  VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
  openVkCommunityProductionLiveRuntime,
  runVkCommunityLiveExecutionOperator,
  type VkCommunityLiveExecutionDependencies,
  type VkCommunityLiveExecutionIo,
  type VkCommunityProductionLiveRuntimeFactoryDependencies,
} from '../src/vk-community-live-execution-cli.ts';
import type {
  VkCommunityProductionDatabase,
  VkCommunityProductionRuntimeOptions,
} from '../src/vk-community-production-runtime.ts';

const PUBLICATION_ID = '21212121-2121-4121-8121-212121212121';
const COMMUNITY_ID = 123456;
const OWNER_ID = -COMMUNITY_ID;
const GRANT_PATH = '/operator/owner-grant.json';
const MANIFEST_PATH = '/operator/non-secret-manifest.json';
const VK_SECRET_KEY = 'publishing/vk-community/task-021';
const IDENTITY_SECRET_KEY = 'publishing/identity/vk-community/task-021';
const CONFIRMATION = `--confirm-live-wall-post=${OWNER_ID}`;
const IDEMPOTENCY_KEY = 'a'.repeat(64);
const PUBLISHED_AT = '2026-08-30T13:30:00.000Z';

const { publicKey } = generateKeyPairSync('ed25519');
const OWNER_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function manifestValue(
  options: { readonly communityId?: number; readonly provider?: string } = {},
) {
  return {
    communityId: options.communityId ?? COMMUNITY_ID,
    ownerApprovalPublicKey: OWNER_PUBLIC_KEY,
    vkCredentialSecretReference: {
      provider: options.provider ?? 'env',
      key: VK_SECRET_KEY,
    },
    publishingIdentitySecretReference: {
      provider: options.provider ?? 'env',
      key: IDENTITY_SECRET_KEY,
    },
  };
}

function manifestJson(options: { readonly communityId?: number; readonly provider?: string } = {}) {
  return JSON.stringify(manifestValue(options));
}

function publishedResult() {
  return {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY' as const,
    ownerId: OWNER_ID,
    postId: 21021,
    idempotencyKey: IDEMPOTENCY_KEY,
    publishedAt: PUBLISHED_AT,
  };
}

interface HarnessOptions {
  readonly manifest?: string;
  readonly grant?: string;
  readonly executeError?: unknown;
  readonly openError?: unknown;
}

function createHarness(options: HarnessOptions = {}) {
  const reads: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let openCalls = 0;
  let executeCalls = 0;
  let closeCalls = 0;

  const files = new Map<string, string>([
    [MANIFEST_PATH, options.manifest ?? manifestJson()],
    [GRANT_PATH, options.grant ?? JSON.stringify({ public: 'grant-envelope' })],
  ]);

  const dependencies: VkCommunityLiveExecutionDependencies = {
    async readTextFile(path) {
      reads.push(path);
      const value = files.get(path);
      if (value === undefined) {
        throw new Error('fixture missing');
      }
      return value;
    },
    async openRuntime() {
      openCalls += 1;
      if (options.openError !== undefined) {
        throw options.openError;
      }
      return {
        runtime: {
          async execute() {
            executeCalls += 1;
            if (options.executeError !== undefined) {
              throw options.executeError;
            }
            return publishedResult();
          },
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  };

  const io: VkCommunityLiveExecutionIo = {
    writeStdout(text) {
      stdout.push(text);
    },
    writeStderr(text) {
      stderr.push(text);
    },
  };

  return {
    dependencies,
    io,
    reads,
    stdout,
    stderr,
    counters() {
      return { openCalls, executeCalls, closeCalls };
    },
  };
}

function validArgs(confirmation = CONFIRMATION): readonly string[] {
  return ['execute-live', PUBLICATION_ID, GRANT_PATH, MANIFEST_PATH, confirmation];
}

test('usage and malformed live confirmation read no files and open no runtime', async () => {
  const usage = createHarness();
  assert.equal(await runVkCommunityLiveExecutionOperator([], usage.dependencies, usage.io), 64);
  assert.deepEqual(usage.reads, []);
  assert.deepEqual(usage.counters(), { openCalls: 0, executeCalls: 0, closeCalls: 0 });

  const malformed = createHarness();
  assert.equal(
    await runVkCommunityLiveExecutionOperator(
      validArgs('--confirm-live-wall-post=123456'),
      malformed.dependencies,
      malformed.io,
    ),
    65,
  );
  assert.deepEqual(malformed.reads, []);
  assert.deepEqual(malformed.counters(), { openCalls: 0, executeCalls: 0, closeCalls: 0 });
});

test('blocked production metadata stops before grant and runtime access', async () => {
  const blockedManifest = JSON.stringify({
    ownerApprovalPublicKey: OWNER_PUBLIC_KEY,
    vkCredentialSecretReference: { provider: 'env', key: VK_SECRET_KEY },
    publishingIdentitySecretReference: { provider: 'env', key: IDENTITY_SECRET_KEY },
  });
  const harness = createHarness({ manifest: blockedManifest });

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(harness.reads, [MANIFEST_PATH]);
  assert.deepEqual(harness.counters(), { openCalls: 0, executeCalls: 0, closeCalls: 0 });
  assert.match(harness.stdout.join(''), /PRODUCTION_PREFLIGHT/u);
  assert.doesNotMatch(harness.stdout.join(''), /grant-envelope/u);
});

test('destination confirmation mismatch stops before grant and runtime access', async () => {
  const harness = createHarness();

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs('--confirm-live-wall-post=-654321'),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(harness.reads, [MANIFEST_PATH]);
  assert.deepEqual(harness.counters(), { openCalls: 0, executeCalls: 0, closeCalls: 0 });
  assert.deepEqual(JSON.parse(harness.stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'LIVE_CONFIRMATION',
    reason: 'DESTINATION_CONFIRMATION_MISMATCH',
    ownerId: OWNER_ID,
  });
});

test('unsupported production secret provider stops before grant and runtime access', async () => {
  const harness = createHarness({ manifest: manifestJson({ provider: 'vault' }) });

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(harness.reads, [MANIFEST_PATH]);
  assert.deepEqual(harness.counters(), { openCalls: 0, executeCalls: 0, closeCalls: 0 });
  assert.deepEqual(JSON.parse(harness.stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'SECRET_PROVIDER',
    reason: 'ENVIRONMENT_SECRET_PROVIDER_REQUIRED',
  });
});

test('malformed owner-grant JSON fails before runtime access without reflection', async () => {
  const harness = createHarness({ grant: '{not-json secret-looking-value' });

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 65);
  assert.deepEqual(harness.reads, [MANIFEST_PATH, GRANT_PATH]);
  assert.deepEqual(harness.counters(), { openCalls: 0, executeCalls: 0, closeCalls: 0 });
  assert.doesNotMatch(harness.stderr.join(''), /secret-looking-value/u);
});

test('successful execution emits only sanitized PUBLISHED evidence and closes runtime', async () => {
  const harness = createHarness();

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(harness.reads, [MANIFEST_PATH, GRANT_PATH]);
  assert.deepEqual(harness.counters(), { openCalls: 1, executeCalls: 1, closeCalls: 1 });
  assert.deepEqual(JSON.parse(harness.stdout[0] ?? '{}'), {
    status: 'PUBLISHED',
    ...publishedResult(),
  });
  assert.deepEqual(harness.stderr, []);
});

test('owner grant rejection is safely BLOCKED and closes runtime', async () => {
  const harness = createHarness({
    executeError: new VkCommunityRuntimeGateError('VK_OWNER_GRANT_FAILED'),
  });

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(harness.counters(), { openCalls: 1, executeCalls: 1, closeCalls: 1 });
  assert.deepEqual(JSON.parse(harness.stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'OWNER_GRANT',
    reason: 'VK_OWNER_GRANT_INVALID',
  });
});

test('pre-network canonical publication failure is safely BLOCKED', async () => {
  const harness = createHarness({
    executeError: new VkCommunityPublishingError('VK_PUBLICATION_NOT_AUTO'),
  });

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(harness.counters(), { openCalls: 1, executeCalls: 1, closeCalls: 1 });
  assert.deepEqual(JSON.parse(harness.stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'PUBLICATION',
    reason: 'VK_PUBLICATION_NOT_AUTO',
  });
});

test('transport or persistence failure is UNKNOWN and never represented as retry-safe BLOCKED', async () => {
  for (const errorCode of ['VK_TRANSPORT_FAILED', 'VK_RESULT_PERSIST_FAILED'] as const) {
    const harness = createHarness({ executeError: new VkCommunityPublishingError(errorCode) });

    const exitCode = await runVkCommunityLiveExecutionOperator(
      validArgs(),
      harness.dependencies,
      harness.io,
    );

    assert.equal(exitCode, 70);
    assert.deepEqual(harness.counters(), { openCalls: 1, executeCalls: 1, closeCalls: 1 });
    assert.deepEqual(JSON.parse(harness.stdout[0] ?? '{}'), {
      status: 'UNKNOWN',
      stage: 'EXECUTION',
      reason: 'VK_EXECUTION_OUTCOME_UNCERTAIN',
    });
    assert.doesNotMatch(harness.stdout.join(''), new RegExp(errorCode, 'u'));
  }
});

test('runtime-open failure is generic and cannot reflect internal credentials', async () => {
  const harness = createHarness({
    openError: new Error('postgres://operator:do-not-reflect@internal/database'),
  });

  const exitCode = await runVkCommunityLiveExecutionOperator(
    validArgs(),
    harness.dependencies,
    harness.io,
  );

  assert.equal(exitCode, 70);
  assert.deepEqual(harness.counters(), { openCalls: 1, executeCalls: 0, closeCalls: 0 });
  assert.doesNotMatch(harness.stderr.join(''), /do-not-reflect|postgres:\/\//u);
});

test('production runtime factory wires fixed environment bindings without reading secret values', async () => {
  const fakeDatabase = {
    async close() {
      closeCalls += 1;
    },
  } as unknown as VkCommunityProductionDatabase;
  const fakePolicy = Object.freeze(
    {},
  ) as VkCommunityProductionRuntimeOptions['authorizationPolicy'];
  const fakeAuditSink: VkCommunityProductionRuntimeOptions['authorizationAuditSink'] = {
    async record() {},
  };
  const fakeSecretProvider: VkCommunitySecretProviderPort = {
    async withSecret<T>(): Promise<T> {
      throw new Error('secret access must not happen during factory construction');
    },
  };
  const fakeTransport: VkCommunityPublishTransport = {
    async publishWallPost() {
      throw new Error('transport must not happen during factory construction');
    },
  };
  let closeCalls = 0;
  let openDatabaseCalls = 0;
  let transportFactoryCalls = 0;
  let capturedBindings: readonly { readonly key: string; readonly environmentVariable: string }[] =
    [];
  let capturedRuntimeOptions: VkCommunityProductionRuntimeOptions | null = null;

  const dependencies: VkCommunityProductionLiveRuntimeFactoryDependencies = {
    loadAuthorizationPolicy() {
      return fakePolicy;
    },
    openDatabase() {
      openDatabaseCalls += 1;
      return fakeDatabase;
    },
    createAuthorizationAuditSink() {
      return fakeAuditSink;
    },
    createSecretProvider(bindings) {
      capturedBindings = bindings;
      return fakeSecretProvider;
    },
    createTransport() {
      transportFactoryCalls += 1;
      return fakeTransport;
    },
    createRuntime(options) {
      capturedRuntimeOptions = options;
      return {
        async execute() {
          return publishedResult();
        },
      };
    },
  };

  const manifest = manifestValue();
  const lease = await openVkCommunityProductionLiveRuntime(manifest, dependencies);

  assert.equal(openDatabaseCalls, 1);
  assert.equal(transportFactoryCalls, 1);
  assert.deepEqual(capturedBindings, [
    {
      key: VK_SECRET_KEY,
      environmentVariable: VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
    },
    {
      key: IDENTITY_SECRET_KEY,
      environmentVariable: VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
    },
  ]);
  assert.equal(capturedRuntimeOptions?.manifest, manifest);
  assert.equal(capturedRuntimeOptions?.database, fakeDatabase);
  assert.equal(capturedRuntimeOptions?.authorizationPolicy, fakePolicy);
  assert.equal(capturedRuntimeOptions?.authorizationAuditSink, fakeAuditSink);
  assert.equal(capturedRuntimeOptions?.secretProvider, fakeSecretProvider);
  assert.equal(capturedRuntimeOptions?.transport, fakeTransport);

  await lease.close();
  await lease.close();
  assert.equal(closeCalls, 1);
});

test('production runtime factory rejects non-env providers before policy or database access', async () => {
  let policyCalls = 0;
  let databaseCalls = 0;
  const dependencies = {
    loadAuthorizationPolicy() {
      policyCalls += 1;
      return Object.freeze({}) as VkCommunityProductionRuntimeOptions['authorizationPolicy'];
    },
    openDatabase() {
      databaseCalls += 1;
      throw new Error('database must not open');
    },
    createAuthorizationAuditSink() {
      throw new Error('audit must not construct');
    },
    createSecretProvider() {
      throw new Error('secret provider must not construct');
    },
    createTransport() {
      throw new Error('transport must not construct');
    },
    createRuntime() {
      throw new Error('runtime must not construct');
    },
  } satisfies VkCommunityProductionLiveRuntimeFactoryDependencies;

  await assert.rejects(
    openVkCommunityProductionLiveRuntime(manifestValue({ provider: 'vault' }), dependencies),
  );
  assert.equal(policyCalls, 0);
  assert.equal(databaseCalls, 0);
});
