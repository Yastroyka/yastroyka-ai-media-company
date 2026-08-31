<script setup lang="ts">
import type { ControlRoomOperationalState } from '../../shared/control-room-contract';

const props = defineProps<{
  state: ControlRoomOperationalState | 'UNAVAILABLE';
}>();

const labels: Record<ControlRoomOperationalState | 'UNAVAILABLE', string> = {
  HEALTHY: 'Работает',
  DEGRADED: 'Требует внимания',
  BLOCKED: 'Заблокировано',
  UNKNOWN: 'Не подтверждено',
  UNAVAILABLE: 'Нет данных',
};
</script>

<template>
  <span class="state-pill" :data-state="state">
    <span class="state-pill__dot" aria-hidden="true"></span>
    {{ labels[state] }}
  </span>
</template>
