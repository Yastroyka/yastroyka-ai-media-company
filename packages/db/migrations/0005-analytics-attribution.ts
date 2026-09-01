import { DataTypes, literal, type QueryInterface } from 'sequelize';
import type { MigrationParams } from 'umzug';

type MigrationContext = QueryInterface;

export async function up({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.createTable(
      'analytics_sessions',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        started_at: {
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

    await context.createTable(
      'analytics_clicks',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        session_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'analytics_sessions', key: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        campaign_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'campaigns', key: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        publication_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'publications', key: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        master_content_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        product_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        offer_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        clicked_at: {
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

    await context.createTable(
      'analytics_order_lines',
      {
        id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
        },
        session_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'analytics_sessions', key: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        external_order_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        external_order_line_id: {
          type: DataTypes.TEXT,
          allowNull: false,
          unique: true,
        },
        product_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        offer_id: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        gmv_minor: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        currency: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        ordered_at: {
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

    await context.addConstraint('analytics_order_lines', {
      fields: ['gmv_minor'],
      type: 'check',
      name: 'chk_analytics_order_lines_gmv_minor_nonnegative',
      where: {
        gmv_minor: { [Symbol.for('gte')]: 0 },
      },
      transaction,
    });

    await context.createTable(
      'analytics_attributions',
      {
        order_line_id: {
          type: DataTypes.UUID,
          allowNull: false,
          primaryKey: true,
          references: { model: 'analytics_order_lines', key: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        click_id: {
          type: DataTypes.UUID,
          allowNull: false,
          references: { model: 'analytics_clicks', key: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
        },
        attribution_model: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        causality_claim: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal('now()'),
        },
      },
      { transaction },
    );

    await context.addConstraint('analytics_attributions', {
      fields: ['attribution_model'],
      type: 'check',
      name: 'chk_analytics_attributions_model',
      where: {
        attribution_model: 'LAST_TRACKED_CLICK',
      },
      transaction,
    });

    await context.addConstraint('analytics_attributions', {
      fields: ['causality_claim'],
      type: 'check',
      name: 'chk_analytics_attributions_no_causality_claim',
      where: {
        causality_claim: false,
      },
      transaction,
    });

    await context.addIndex('analytics_clicks', ['publication_id', 'clicked_at'], {
      name: 'idx_analytics_clicks_publication_clicked_at',
      transaction,
    });
    await context.addIndex('analytics_clicks', ['session_id', 'clicked_at'], {
      name: 'idx_analytics_clicks_session_clicked_at',
      transaction,
    });
    await context.addIndex('analytics_order_lines', ['session_id', 'ordered_at'], {
      name: 'idx_analytics_order_lines_session_ordered_at',
      transaction,
    });
    await context.addIndex('analytics_attributions', ['click_id'], {
      name: 'idx_analytics_attributions_click_id',
      transaction,
    });
  });
}

export async function down({ context }: MigrationParams<MigrationContext>): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    await context.removeIndex('analytics_attributions', 'idx_analytics_attributions_click_id', {
      transaction,
    });
    await context.removeIndex(
      'analytics_order_lines',
      'idx_analytics_order_lines_session_ordered_at',
      { transaction },
    );
    await context.removeIndex('analytics_clicks', 'idx_analytics_clicks_session_clicked_at', {
      transaction,
    });
    await context.removeIndex('analytics_clicks', 'idx_analytics_clicks_publication_clicked_at', {
      transaction,
    });
    await context.dropTable('analytics_attributions', { transaction });
    await context.dropTable('analytics_order_lines', { transaction });
    await context.dropTable('analytics_clicks', { transaction });
    await context.dropTable('analytics_sessions', { transaction });
  });
}
