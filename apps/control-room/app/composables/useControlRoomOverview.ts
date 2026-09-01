import {
  createUnavailableControlRoomOverview,
  type ControlRoomOverviewEnvelope,
} from '#shared/control-room-contract';

export function useControlRoomOverview() {
  return useAsyncData<ControlRoomOverviewEnvelope>(
    'control-room-overview',
    async () => {
      try {
        return await $fetch<ControlRoomOverviewEnvelope>('/api/control-room/overview', {
          ignoreResponseError: true,
        });
      } catch {
        return createUnavailableControlRoomOverview('CONTROL_ROOM_BACKEND_UNREACHABLE');
      }
    },
    {
      default: () => createUnavailableControlRoomOverview('CONTROL_ROOM_BACKEND_NOT_CONFIGURED'),
    },
  );
}
