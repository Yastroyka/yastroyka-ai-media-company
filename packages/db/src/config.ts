export type DatabaseConfig = Readonly<{
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}>;

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('YASTROYKA_DB_PORT must be an integer between 1 and 65535');
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('YASTROYKA_DB_PORT must be an integer between 1 and 65535');
  }

  return port;
}

export function loadDatabaseConfig(): DatabaseConfig {
  return Object.freeze({
    host: requireEnvironmentVariable('YASTROYKA_DB_HOST'),
    port: parsePort(requireEnvironmentVariable('YASTROYKA_DB_PORT')),
    database: requireEnvironmentVariable('YASTROYKA_DB_NAME'),
    username: requireEnvironmentVariable('YASTROYKA_DB_USER'),
    password: requireEnvironmentVariable('YASTROYKA_DB_PASSWORD'),
  });
}
