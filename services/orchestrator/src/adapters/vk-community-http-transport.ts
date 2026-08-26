import type {
  VkCommunityPublishTransport,
  VkCommunityPublishTransportResult,
  VkCommunityWallPostRequest,
} from './vk-community-publishing-adapter.ts';

export const VK_API_VERSION = '5.199' as const;
export const VK_WALL_POST_ENDPOINT = 'https://api.vk.com/method/wall.post' as const;

export class VkCommunityHttpTransportError extends Error {
  constructor() {
    super('VK HTTP transport failed');
    this.name = 'VkCommunityHttpTransportError';
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface VkCommunityHttpTransportOptions {
  readonly fetchImplementation?: FetchLike;
  readonly timeoutMilliseconds?: number;
}

const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_MESSAGE_LENGTH = 8_192;
const MAX_SECRET_LENGTH = 8_192;
const MAX_RESPONSE_LENGTH = 65_536;
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(): never {
  throw new VkCommunityHttpTransportError();
}

function requireTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30_000) {
    throw new Error('timeoutMilliseconds must be an integer between 1000 and 30000.');
  }
  return value;
}

function requireRequest(request: VkCommunityWallPostRequest): void {
  if (
    !Number.isSafeInteger(request.ownerId) ||
    request.ownerId >= 0 ||
    request.ownerId < -2_147_483_647 ||
    request.fromGroup !== true ||
    typeof request.message !== 'string' ||
    request.message.length === 0 ||
    request.message.length > MAX_MESSAGE_LENGTH ||
    request.message.includes('\u0000') ||
    !IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)
  ) {
    fail();
  }
}

function requireAccessToken(accessToken: string): void {
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    accessToken.length > MAX_SECRET_LENGTH ||
    accessToken.includes('\u0000')
  ) {
    fail();
  }
}

function expectPlainObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail();
  }
  return value as Record<string, unknown>;
}

function parseResponse(text: string, ownerId: number): VkCommunityPublishTransportResult {
  if (text.length === 0 || text.length > MAX_RESPONSE_LENGTH) {
    fail();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail();
  }

  const root = expectPlainObject(parsed);
  if ('error' in root) {
    fail();
  }
  const response = expectPlainObject(root.response);
  const postId = response.post_id;
  if (typeof postId !== 'number' || !Number.isSafeInteger(postId) || postId < 1) {
    fail();
  }

  return Object.freeze({ ownerId, postId });
}

export class VkCommunityHttpTransport implements VkCommunityPublishTransport {
  readonly #fetch: FetchLike;
  readonly #timeoutMilliseconds: number;

  constructor(options: VkCommunityHttpTransportOptions = {}) {
    this.#fetch = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = requireTimeout(options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MS);
  }

  async publishWallPost(
    request: VkCommunityWallPostRequest,
    accessToken: string,
  ): Promise<VkCommunityPublishTransportResult> {
    requireRequest(request);
    requireAccessToken(accessToken);

    const body = new URLSearchParams({
      owner_id: String(request.ownerId),
      from_group: '1',
      message: request.message,
      guid: request.idempotencyKey,
      access_token: accessToken,
      v: VK_API_VERSION,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);

    try {
      const response = await this.#fetch(VK_WALL_POST_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        fail();
      }
      return parseResponse(await response.text(), request.ownerId);
    } catch (error) {
      if (error instanceof VkCommunityHttpTransportError) {
        throw error;
      }
      fail();
    } finally {
      clearTimeout(timeout);
    }
  }
}
