import type { QueryInterface } from 'sequelize';
import type { MigrationParams } from 'umzug';

type MigrationContext = QueryInterface;

export async function up({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.addIndex('engineering_run_evidence', {
      fields: [
        { name: 'recorded_at', order: 'DESC' as const },
        { name: 'sequence', order: 'DESC' as const },
        { name: 'run_id', order: 'DESC' as const },
      ],
      name: 'idx_engineering_run_evidence_latest',
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.removeIndex('engineering_run_evidence', 'idx_engineering_run_evidence_latest', {
      transaction,
    });
  });
}
