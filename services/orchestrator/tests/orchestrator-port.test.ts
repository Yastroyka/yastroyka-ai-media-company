import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ClaudeAdapter,
  FakeAdapter,
  OrchestratorPort,
  ProviderUnavailableError,
  type ClaudeMessageRequest,
  type ClaudeMessageResponse,
  type ClaudeTransport,
  type OrchestrationState,
  type OrchestrationStateStore,
} from '../src/index.ts';

class RecordingStateStore implements OrchestrationStateStore {
  readonly states: OrchestrationState[] = [];

  async save(state: OrchestrationState): Promise<void> {
    this.states.push(structuredClone(state));
  }
}

class RecordingClaudeTransport implements ClaudeTransport {
  request: ClaudeMessageRequest | undefined;

  async createMessage(request: ClaudeMessageRequest): Promise<ClaudeMessageResponse> {
    this.request = structuredClone(request);

    return {
      id: 'msg_test_004',
      model: request.model,
      text: 'claude result',
    };
  }
}

const command = {
  operationId: 'operation-004',
  stateRef: 'postgres://workflow/task-004',
  input: 'Create the next owned content step.',
} as const;

test('the orchestrator can replace the fake adapter with the Claude adapter', async () => {
  const fakeStore = new RecordingStateStore();
  const fakeResult = await new OrchestratorPort(
    new FakeAdapter({ response: 'fake result' }),
    fakeStore,
  ).execute(command);

  const claudeStore = new RecordingStateStore();
  const transport = new RecordingClaudeTransport();
  const claudeResult = await new OrchestratorPort(
    new ClaudeAdapter({ model: 'claude-primary', transport }),
    claudeStore,
  ).execute(command);

  assert.deepEqual(Object.keys(fakeResult).sort(), Object.keys(claudeResult).sort());
  assert.equal(fakeResult.provider, 'fake');
  assert.equal(fakeResult.output, 'fake result');
  assert.equal(claudeResult.provider, 'claude');
  assert.equal(claudeResult.output, 'claude result');
  assert.deepEqual(
    fakeStore.states.map(({ status }) => status),
    ['running', 'completed'],
  );
  assert.deepEqual(
    claudeStore.states.map(({ status }) => status),
    ['running', 'completed'],
  );
});

test('a provider outage preserves owned orchestration state', async () => {
  const store = new RecordingStateStore();
  const ownedBusinessState = {
    stateRef: command.stateRef,
    approved: false,
    contentVersion: 7,
  };

  const orchestrator = new OrchestratorPort(new FakeAdapter({ available: false }), store);

  await assert.rejects(orchestrator.execute(command), (error: unknown) => {
    assert.ok(error instanceof ProviderUnavailableError);
    assert.equal(error.operationId, command.operationId);
    assert.equal(error.provider, 'fake');
    return true;
  });

  assert.deepEqual(ownedBusinessState, {
    stateRef: 'postgres://workflow/task-004',
    approved: false,
    contentVersion: 7,
  });
  assert.deepEqual(store.states, [
    {
      operationId: command.operationId,
      stateRef: command.stateRef,
      provider: 'fake',
      status: 'running',
    },
    {
      operationId: command.operationId,
      stateRef: command.stateRef,
      provider: 'fake',
      status: 'provider_unavailable',
    },
  ]);
});

test('the Claude adapter sends no owned business state to the provider transport', async () => {
  const transport = new RecordingClaudeTransport();
  const adapter = new ClaudeAdapter({ model: 'claude-primary', transport });

  await adapter.generate({
    operationId: command.operationId,
    input: command.input,
  });

  assert.deepEqual(transport.request, {
    model: 'claude-primary',
    messages: [{ role: 'user', content: command.input }],
  });
  assert.equal(JSON.stringify(transport.request).includes(command.stateRef), false);
});
