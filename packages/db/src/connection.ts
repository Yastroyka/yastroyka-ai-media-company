import { Sequelize } from 'sequelize';

import { loadDatabaseConfig } from './config.ts';

function createConfiguredConnection(readOnly: boolean): Sequelize {
  const config = loadDatabaseConfig();

  return new Sequelize(config.database, config.username, config.password, {
    dialect: 'postgres',
    host: config.host,
    port: config.port,
    logging: false,
    ...(readOnly
      ? {
          dialectOptions: {
            options: '-c default_transaction_read_only=on',
          },
        }
      : {}),
  });
}

export function createDatabaseConnection(): Sequelize {
  return createConfiguredConnection(false);
}

export function createReadOnlyDatabaseConnection(): Sequelize {
  return createConfiguredConnection(true);
}
