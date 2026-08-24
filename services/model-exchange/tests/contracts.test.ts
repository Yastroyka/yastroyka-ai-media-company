import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('canonical schemas preserve lifecycle and routing mode enums', async () => {
  const capabilitySchema = JSON.parse(
    await readFile(
      new URL('../../../specs/model-exchange/capability-record.schema.json', import.meta.url),
      'utf8',
    ),
  ) as {
    properties: { lifecycle: { enum: string[] } };
  };
  const requestSchema = JSON.parse(
    await readFile(
      new URL('../../../specs/model-exchange/routing-request.schema.json', import.meta.url),
      'utf8',
    ),
  ) as {
    properties: { mode: { enum: string[] } };
  };

  assert.deepEqual(capabilitySchema.properties.lifecycle.enum, [
    'DISCOVERED',
    'QUARANTINE',
    'BENCHMARK',
    'SHADOW',
    'CANARY',
    'PRODUCTION',
    'SUSPENDED',
    'REVOKED',
  ]);
  assert.deepEqual(requestSchema.properties.mode.enum, [
    'MAX_QUALITY',
    'BEST_VALUE',
    'FAST',
    'BULK',
    'EXPERIMENT',
    'REDUNDANT',
    'CRITICAL',
  ]);
});

test('canonical RoutingRequest schema rejects unknown request semantics', async () => {
  const requestSchema = JSON.parse(
    await readFile(
      new URL('../../../specs/model-exchange/routing-request.schema.json', import.meta.url),
      'utf8',
    ),
  ) as {
    additionalProperties: boolean;
    properties: {
      requirements: {
        additionalProperties: boolean;
        properties: Record<string, unknown>;
      };
    };
  };

  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(requestSchema.properties.requirements.additionalProperties, false);
  assert.deepEqual(Object.keys(requestSchema.properties.requirements.properties).sort(), [
    'provider',
    'revision',
  ]);
});

test('OpenAPI route references canonical request and decision schemas with fail-closed statuses', async () => {
  const openApi = await readFile(
    new URL('../../../specs/openapi/openapi.yaml', import.meta.url),
    'utf8',
  );
  const routePath = openApi.split('/v1/model-exchange/route:')[1] ?? '';

  assert.match(routePath, /\$ref: \.\.\/model-exchange\/routing-request\.schema\.json/u);
  assert.match(routePath, /\$ref: \.\.\/model-exchange\/routing-decision\.schema\.json/u);
  assert.match(routePath, /"400":/u);
  assert.match(routePath, /"422":/u);
});
