import type { QueryInterface, Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';

import {
  down as initialCanonicalSchemaDown,
  up as initialCanonicalSchemaUp,
} from '../migrations/0001-initial-canonical-schema.ts';

export function createMigrator(database: Sequelize): Umzug<QueryInterface> {
  return new Umzug<QueryInterface>({
    migrations: [
      {
        name: '0001-initial-canonical-schema',
        up: initialCanonicalSchemaUp,
        down: initialCanonicalSchemaDown,
      },
    ],
    context: database.getQueryInterface(),
    logger: undefined,
    storage: new SequelizeStorage({
      sequelize: database,
    }),
  });
}
