import { Sequelize } from 'sequelize';

import { loadDatabaseConfig } from './config.ts';

export function createDatabaseConnection(): Sequelize {
  const config = loadDatabaseConfig();

  return new Sequelize(config.database, config.username, config.password, {
    dialect: 'postgres',
    host: config.host,
    port: config.port,
    logging: false,
  });
}
