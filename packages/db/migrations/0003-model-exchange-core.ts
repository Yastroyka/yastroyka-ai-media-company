import { DataTypes, literal, type QueryInterface } from 'sequelize';
import type { MigrationParams } from 'umzug';

type MigrationContext = QueryInterface;

export async function up({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(
      'model_capabilities',
      {
        model_id: {
          type: DataTypes.TEXT,
          allowNull: false,
          primaryKey: true,
        },
        provider: {
          type: DataTypes.TEXT,
          allowNull: false,
          primaryKey: true,
        },
        revision: {
          type: DataTypes.TEXT,
          allowNull: false,
          primaryKey: true,
        },
        task_classes: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        scores: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        lifecycle: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        verified_at: {
          type: DataTypes.DATE,
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

    await context.addIndex('routing_decisions', ['request_id'], {
      name: 'idx_routing_decisions_request_id_unique',
      unique: true,
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.removeIndex('routing_decisions', 'idx_routing_decisions_request_id_unique', {
      transaction,
    });
    await context.dropTable('model_capabilities', { transaction });
  });
}
