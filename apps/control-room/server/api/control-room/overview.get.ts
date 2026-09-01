import {
  CONTROL_ROOM_OVERVIEW_PATH,
  createUnavailableControlRoomOverview,
  isControlRoomReadyEnvelope,
} from '#shared/control-room-contract';

const LOCAL_DEVELOPMENT_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const UPSTREAM_TIMEOUT_MS = 5_000;

function resolveUpstreamUrl(rawBaseUrl: unknown): URL | null {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
    return null;
  }

  try {
    const baseUrl = new URL(rawBaseUrl.trim());
    const localHttp = baseUrl.protocol === 'http:' && LOCAL_DEVELOPMENT_HOSTS.has(baseUrl.hostname);

    if (
      (baseUrl.protocol !== 'https:' && !localHttp) ||
      baseUrl.username !== '' ||
      baseUrl.password !== '' ||
      baseUrl.search !== '' ||
      baseUrl.hash !== ''
    ) {
      return null;
    }

    const normalizedBase = baseUrl.toString().endsWith('/')
      ? baseUrl.toString()
      : `${baseUrl.toString()}/`;

    return new URL(CONTROL_ROOM_OVERVIEW_PATH.replace(/^\//, ''), normalizedBase);
  } catch {
    return null;
  }
}

export default defineEventHandler(async (event) => {
  const observedAt = new Date().toISOString();
  const runtimeConfig = useRuntimeConfig(event);
  const rawBaseUrl = runtimeConfig.controlRoomApiBaseUrl;

  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
    setResponseStatus(event, 503);
    return createUnavailableControlRoomOverview('CONTROL_ROOM_BACKEND_NOT_CONFIGURED', observedAt);
  }

  const upstreamUrl = resolveUpstreamUrl(rawBaseUrl);
  if (upstreamUrl === null) {
    setResponseStatus(event, 503);
    return createUnavailableControlRoomOverview(
      'CONTROL_ROOM_BACKEND_CONFIGURATION_INVALID',
      observedAt,
    );
  }

  try {
    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      setResponseStatus(event, 502);
      return createUnavailableControlRoomOverview(
        'CONTROL_ROOM_BACKEND_REJECTED_REQUEST',
        observedAt,
      );
    }

    const candidate: unknown = await response.json();
    if (!isControlRoomReadyEnvelope(candidate)) {
      setResponseStatus(event, 502);
      return createUnavailableControlRoomOverview(
        'CONTROL_ROOM_BACKEND_RESPONSE_INVALID',
        observedAt,
      );
    }

    return candidate;
  } catch {
    setResponseStatus(event, 502);
    return createUnavailableControlRoomOverview('CONTROL_ROOM_BACKEND_UNREACHABLE', observedAt);
  }
});
