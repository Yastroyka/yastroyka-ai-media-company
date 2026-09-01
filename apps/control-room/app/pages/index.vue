<script setup lang="ts">
import {
  CONTROL_ROOM_WORKSPACE_IDS,
  type ControlRoomOperationalState,
  type ControlRoomWorkspaceId,
} from '#shared/control-room-contract';

const runtimeConfig = useRuntimeConfig();
const { data: overview, status, refresh } = await useControlRoomOverview();

useSeoMeta({
  title: 'Command Center — Ястройка',
  description: 'Операционный интерфейс AI-завода Ястройки.',
  robots: 'noindex, nofollow',
});

const stateLabels: Record<ControlRoomOperationalState, string> = {
  HEALTHY: 'Работает штатно',
  DEGRADED: 'Требует внимания',
  BLOCKED: 'Заблокировано',
  UNKNOWN: 'Не подтверждено',
};

const workspaceLabels: Record<ControlRoomWorkspaceId, string> = {
  VK_COMMUNITY: 'VK Community',
  VK_VIDEO: 'VK Video',
  MAX: 'MAX',
};

const reasonLabels = {
  CONTROL_ROOM_BACKEND_NOT_CONFIGURED: 'Owned backend ещё не подключён к этому интерфейсу.',
  CONTROL_ROOM_BACKEND_CONFIGURATION_INVALID: 'Адрес owned backend настроен некорректно.',
  CONTROL_ROOM_BACKEND_UNREACHABLE: 'Owned backend сейчас недоступен.',
  CONTROL_ROOM_BACKEND_REJECTED_REQUEST: 'Owned backend отклонил read-only запрос.',
  CONTROL_ROOM_BACKEND_RESPONSE_INVALID:
    'Ответ owned backend не прошёл строгую проверку контракта.',
} as const;

const readyData = computed(() => (overview.value.status === 'READY' ? overview.value.data : null));

const connectionState = computed(() => (readyData.value === null ? 'UNAVAILABLE' : 'HEALTHY'));

const connectionMessage = computed(() => {
  if (overview.value.status === 'READY') {
    return 'Данные получены из YASTROYKA-owned backend.';
  }

  return reasonLabels[overview.value.reasonCode];
});

const observedAt = computed(() => {
  if (overview.value.status === 'READY') {
    return formatDateTime(overview.value.data.generatedAt);
  }

  return overview.value.observedAt === null
    ? 'нет подтверждённого наблюдения'
    : formatDateTime(overview.value.observedAt);
});

const workspaceRows = computed(() =>
  CONTROL_ROOM_WORKSPACE_IDS.map((workspaceId) => ({
    workspaceId,
    data: readyData.value?.workspaces.find((workspace) => workspace.workspaceId === workspaceId),
  })),
);

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

function formatCount(value: number | undefined): string {
  return value === undefined ? '—' : new Intl.NumberFormat('ru-RU').format(value);
}
</script>

<template>
  <div class="control-room-shell">
    <aside class="sidebar">
      <ControlRoomMark />

      <nav class="sidebar__nav" aria-label="Разделы Control Room">
        <a class="nav-item nav-item--active" href="#command-center">
          <span class="nav-item__icon" aria-hidden="true">01</span>
          <span>
            <strong>Command Center</strong>
            <small>Общее состояние</small>
          </span>
        </a>
        <a class="nav-item" href="#approvals">
          <span class="nav-item__icon" aria-hidden="true">02</span>
          <span>
            <strong>Approvals</strong>
            <small>Human gates</small>
          </span>
        </a>
        <a class="nav-item" href="#workspaces">
          <span class="nav-item__icon" aria-hidden="true">03</span>
          <span>
            <strong>Platform OS</strong>
            <small>VK и MAX</small>
          </span>
        </a>
        <a class="nav-item" href="#model-exchange">
          <span class="nav-item__icon" aria-hidden="true">04</span>
          <span>
            <strong>Model Exchange</strong>
            <small>Решения маршрутизации</small>
          </span>
        </a>
        <a class="nav-item" href="#incidents">
          <span class="nav-item__icon" aria-hidden="true">05</span>
          <span>
            <strong>Incidents</strong>
            <small>Ошибки и блокировки</small>
          </span>
        </a>
      </nav>

      <div class="sidebar__environment">
        <span>Среда разработки</span>
        <strong>{{ runtimeConfig.public.controlRoomOrigin }}</strong>
        <small>Публикация и production-write отключены</small>
      </div>
    </aside>

    <main id="command-center" class="command-center">
      <header class="topbar">
        <div>
          <p class="eyebrow">YASTROYKA AI MEDIA COMPANY</p>
          <h1>Command Center</h1>
        </div>
        <div class="topbar__actions">
          <OperationalStatePill :state="connectionState" />
          <button
            class="refresh-button"
            type="button"
            :disabled="status === 'pending'"
            @click="refresh()"
          >
            {{ status === 'pending' ? 'Обновляем…' : 'Обновить данные' }}
          </button>
        </div>
      </header>

      <section class="connection-banner" :data-ready="readyData !== null">
        <div class="connection-banner__signal" aria-hidden="true"></div>
        <div>
          <strong>{{ connectionMessage }}</strong>
          <span>Последнее наблюдение: {{ observedAt }}</span>
        </div>
        <p>
          Control Room показывает только подтверждённое состояние owned backend. Локальные
          демо-счётчики и выдуманные статусы запрещены.
        </p>
      </section>

      <section class="hero-panel">
        <div class="hero-panel__copy">
          <p class="eyebrow">Операционный контур R1</p>
          <h2>Один интерфейс для управления AI-заводом</h2>
          <p>
            Согласования, инциденты, площадки и выбор моделей собраны в едином read-only
            представлении. Управляющие действия появятся только вместе с каноническим AuthZ и audit
            trail.
          </p>
        </div>
        <div class="hero-panel__rail" aria-label="Производственная цепочка">
          <span>Research</span>
          <i></i>
          <span>Content</span>
          <i></i>
          <span>QA</span>
          <i></i>
          <span>Approval</span>
          <i></i>
          <span>Publish</span>
        </div>
      </section>

      <section class="metric-grid" aria-label="Сводка состояния">
        <article id="approvals" class="metric-card">
          <div class="metric-card__head">
            <span class="metric-card__index">A</span>
            <OperationalStatePill :state="readyData?.approvals.state ?? 'UNAVAILABLE'" />
          </div>
          <span class="metric-card__label">Ожидают решения</span>
          <strong class="metric-card__value">
            {{ formatCount(readyData?.approvals.waitingCount) }}
          </strong>
          <p>
            {{
              readyData?.approvals.oldestWaitingAt
                ? `Самое раннее: ${formatDateTime(readyData.approvals.oldestWaitingAt)}`
                : 'Нет подтверждённых данных об очереди.'
            }}
          </p>
        </article>

        <article id="incidents" class="metric-card">
          <div class="metric-card__head">
            <span class="metric-card__index">I</span>
            <OperationalStatePill :state="readyData?.incidents.state ?? 'UNAVAILABLE'" />
          </div>
          <span class="metric-card__label">Открытые инциденты</span>
          <strong class="metric-card__value">
            {{ formatCount(readyData?.incidents.openCount) }}
          </strong>
          <p>
            Критических:
            <b>{{ formatCount(readyData?.incidents.criticalCount) }}</b>
          </p>
        </article>

        <article class="metric-card">
          <div class="metric-card__head">
            <span class="metric-card__index">P</span>
            <OperationalStatePill
              :state="
                readyData?.workspaces.some((workspace) => workspace.state === 'BLOCKED')
                  ? 'BLOCKED'
                  : readyData
                    ? 'HEALTHY'
                    : 'UNAVAILABLE'
              "
            />
          </div>
          <span class="metric-card__label">Platform OS</span>
          <strong class="metric-card__value">
            {{ readyData ? readyData.workspaces.length : '—' }}
          </strong>
          <p>Раздельные рабочие пространства VK Community, VK Video и MAX.</p>
        </article>

        <article class="metric-card">
          <div class="metric-card__head">
            <span class="metric-card__index">M</span>
            <OperationalStatePill :state="readyData?.modelDecision.state ?? 'UNAVAILABLE'" />
          </div>
          <span class="metric-card__label">Последний route decision</span>
          <strong class="metric-card__value metric-card__value--model">
            {{ readyData?.modelDecision.winnerModelId ?? '—' }}
          </strong>
          <p>
            {{ readyData?.modelDecision.provider ?? 'Провайдер не подтверждён.' }}
          </p>
        </article>
      </section>

      <div class="content-grid">
        <section id="workspaces" class="panel panel--wide">
          <div class="panel__heading">
            <div>
              <p class="eyebrow">Platform OS</p>
              <h2>Рабочие пространства площадок</h2>
            </div>
            <span>read-only</span>
          </div>

          <div class="workspace-table" role="table" aria-label="Platform OS">
            <div class="workspace-table__row workspace-table__row--head" role="row">
              <span role="columnheader">Площадка</span>
              <span role="columnheader">Состояние</span>
              <span role="columnheader">Активная публикация</span>
              <span role="columnheader">Следующее действие</span>
            </div>
            <div
              v-for="workspace in workspaceRows"
              :key="workspace.workspaceId"
              class="workspace-table__row"
              role="row"
            >
              <strong role="cell">
                {{ workspaceLabels[workspace.workspaceId] }}
              </strong>
              <span role="cell">
                <OperationalStatePill :state="workspace.data?.state ?? 'UNAVAILABLE'" />
              </span>
              <code role="cell">
                {{ workspace.data?.activePublicationId ?? '—' }}
              </code>
              <span role="cell">
                {{ workspace.data?.nextAction ?? 'Нет подтверждённых данных' }}
              </span>
            </div>
          </div>
        </section>

        <section id="model-exchange" class="panel">
          <div class="panel__heading">
            <div>
              <p class="eyebrow">Routing transparency</p>
              <h2>AI Model Exchange</h2>
            </div>
          </div>

          <div class="decision-card">
            <div class="decision-card__route">
              <span>Winner</span>
              <strong>{{ readyData?.modelDecision.winnerModelId ?? '—' }}</strong>
              <small>
                {{ readyData?.modelDecision.provider ?? 'provider unknown' }}
              </small>
            </div>
            <dl>
              <div>
                <dt>Состояние</dt>
                <dd>
                  {{
                    readyData
                      ? stateLabels[readyData.modelDecision.state]
                      : 'Нет подтверждённых данных'
                  }}
                </dd>
              </div>
              <div>
                <dt>Request ID</dt>
                <dd>{{ readyData?.modelDecision.requestId ?? '—' }}</dd>
              </div>
              <div>
                <dt>Решение принято</dt>
                <dd>
                  {{
                    readyData?.modelDecision.decidedAt
                      ? formatDateTime(readyData.modelDecision.decidedAt)
                      : '—'
                  }}
                </dd>
              </div>
            </dl>
            <blockquote>
              {{
                readyData?.modelDecision.whyThisModel ??
                'WHY THIS MODEL появится только из канонического routing decision.'
              }}
            </blockquote>
          </div>
        </section>
      </div>

      <footer class="command-center__footer">
        <span>Control Room v0.1 · данные не являются локальным mock</span>
        <span>Production publishing: BLOCKED</span>
      </footer>
    </main>
  </div>
</template>
