import { DataTypes, literal, type QueryInterface } from 'sequelize';
import type { MigrationParams } from 'umzug';

type MigrationContext = QueryInterface;

export async function up({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(
      'engineering_run_evidence',
      {
        run_id: {
          type: DataTypes.TEXT,
          allowNull: false,
          primaryKey: true,
        },
        sequence: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        event_type: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        payload: {
          type: DataTypes.JSONB,
          allowNull: false,
        },
        recorded_at: {
          type: DataTypes.DATE,
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

    await context.addIndex('engineering_run_evidence', ['run_id', 'recorded_at'], {
      name: 'idx_engineering_run_evidence_run_recorded_at',
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.removeIndex(
      'engineering_run_evidence',
      'idx_engineering_run_evidence_run_recorded_at',
      { transaction },
    );
    await context.dropTable('engineering_run_evidence', { transaction });
  });
}
