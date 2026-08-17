import { DataTypes, literal, type QueryInterface } from 'sequelize';
import type { MigrationParams } from 'umzug';

type MigrationContext = QueryInterface;

export async function up({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(
      'authorization_audit_events',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        actor_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        resource: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        action: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        permission_id: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        required_scope: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        risk_class: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        decision: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        reason: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        matched_rule_id: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        occurred_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
      },
      { transaction },
    );
  });
}

export async function down({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.dropTable('authorization_audit_events', {
      transaction,
    });
  });
}
