import { Worker, type NativeConnection } from '@temporalio/worker';

import type { CampaignActivities } from './contracts.ts';

export interface CampaignWorkerOptions {
  readonly connection: NativeConnection;
  readonly taskQueue: string;
  readonly activities: CampaignActivities;
  readonly namespace?: string;
  readonly maxCachedWorkflows?: number;
}

export async function createCampaignWorker(options: CampaignWorkerOptions): Promise<Worker> {
  return Worker.create({
    connection: options.connection,
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.maxCachedWorkflows === undefined
      ? {}
      : { maxCachedWorkflows: options.maxCachedWorkflows }),
    taskQueue: options.taskQueue,
    workflowsPath: new URL('./workflows/campaign-workflow.ts', import.meta.url).pathname,
    activities: options.activities,
  });
}
