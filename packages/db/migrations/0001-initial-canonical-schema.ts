import { DataTypes, literal, type QueryInterface } from 'sequelize';
import type { MigrationParams } from 'umzug';

type MigrationContext = QueryInterface;

export async function up({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(
      'projects',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        code: {
          type: DataTypes.TEXT,
          allowNull: false,
          unique: true,
        },
        name: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
      },
      { transaction },
    );

    await context.createTable(
      'campaigns',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        project_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'projects',
            key: 'id',
          },
        },
        objective: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        status: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
      },
      { transaction },
    );

    await context.createTable(
      'approvals',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        aggregate_type: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        aggregate_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        status: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        requested_by: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        decided_by: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        reason: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
        decided_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await context.createTable(
      'routing_decisions',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        request_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        task_class: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        policy_mode: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        winner_model_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
      },
      { transaction },
    );

    await context.createTable(
      'commerce_offer_snapshots',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        product_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        offer_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        seller_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        captured_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
      },
      { transaction },
    );

    await context.createTable(
      'publications',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        master_content_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        workspace_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        platform: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        status: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
        published_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await context.createTable(
      'outbox_events',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        aggregate_type: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        aggregate_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        event_type: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        occurred_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
        published_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await context.addIndex('outbox_events', ['occurred_at'], {
      name: 'idx_outbox_unpublished',
      where: {
        published_at: null,
      },
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.removeIndex('outbox_events', 'idx_outbox_unpublished', { transaction });

    await context.dropTable('outbox_events', { transaction });
    await context.dropTable('publications', { transaction });
    await context.dropTable('commerce_offer_snapshots', { transaction });
    await context.dropTable('routing_decisions', { transaction });
    await context.dropTable('approvals', { transaction });
    await context.dropTable('campaigns', { transaction });
    await context.dropTable('projects', { transaction });
  });
}
