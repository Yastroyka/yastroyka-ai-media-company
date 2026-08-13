import type { Sequelize } from 'sequelize';

export type ProjectInput = Readonly<{
  id: string;
  code: string;
  name: string;
}>;

export type OutboxEventInput = Readonly<{
  id: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type CreateProjectWithOutboxInput = Readonly<{
  project: ProjectInput;
  event: OutboxEventInput;
}>;

function serializePayload(payload: Readonly<Record<string, unknown>>): string {
  const serialized = JSON.stringify(payload);

  if (serialized === undefined) {
    throw new Error('Outbox payload could not be serialized');
  }

  return serialized;
}

export async function createProjectWithOutbox(
  database: Sequelize,
  input: CreateProjectWithOutboxInput,
): Promise<void> {
  const payload = serializePayload(input.event.payload);

  await database.transaction(async (transaction) => {
    await database.query(
      `
        INSERT INTO projects (
          id,
          code,
          name
        )
        VALUES (
          $projectId,
          $projectCode,
          $projectName
        );
      `,
      {
        bind: {
          projectId: input.project.id,
          projectCode: input.project.code,
          projectName: input.project.name,
        },
        transaction,
      },
    );

    await database.query(
      `
        INSERT INTO outbox_events (
          id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload
        )
        VALUES (
          $eventId,
          'project',
          $projectId,
          $eventType,
          CAST($payload AS jsonb)
        );
      `,
      {
        bind: {
          eventId: input.event.id,
          projectId: input.project.id,
          eventType: input.event.eventType,
          payload,
        },
        transaction,
      },
    );
  });
}
