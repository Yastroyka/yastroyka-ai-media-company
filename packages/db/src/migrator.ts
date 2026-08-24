import type { QueryInterface, Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';

import {
  down as initialCanonicalSchemaDown,
  up as initialCanonicalSchemaUp,
} from '../migrations/0001-initial-canonical-schema.ts';

import {
  down as authorizationAuditEventsDown,
  up as authorizationAuditEventsUp,
} from '../migrations/0002-authorization-audit-events.ts';

import {
  down as modelExchangeCoreDown,
  up as modelExchangeCoreUp,
} from '../migrations/0003-model-exchange-core.ts';

export function createMigrator(database: Sequelize): Umzug<QueryInterface> {
  return new Umzug<QueryInterface>({
    migrations: [
      {
        name: '0001-initial-canonical-schema',
        up: initialCanonicalSchemaUp,
        down: initialCanonicalSchemaDown,
      },
      {
        name: '0002-authorization-audit-events',
        up: authorizationAuditEventsUp,
        down: authorizationAuditEventsDown,
      },
      {
        name: '0003-model-exchange-core',
        up: modelExchangeCoreUp,
        down: modelExchangeCoreDown,
      },
    ],
    context: database.getQueryInterface(),
    logger: undefined,
    storage: new SequelizeStorage({
      sequelize: database,
    }),
  });
}
