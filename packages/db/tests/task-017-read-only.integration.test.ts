import assert from 'node:assert/strict';
import test from 'node:test';

const { createReadOnlyDatabaseConnection } = await import('../src/connection.ts');

test('TASK-017 read-only database connection allows reads and blocks writes', async () => {
  const database = createReadOnlyDatabaseConnection();

  try {
    const [rows] = await database.query('SHOW default_transaction_read_only;');
    assert.deepEqual(rows[0], { default_transaction_read_only: 'on' });

    await assert.rejects(
      database.query('CREATE TABLE task_017_read_only_probe (id integer);'),
      /read-only transaction|cannot execute CREATE TABLE/iu,
    );
  } finally {
    await database.close();
  }
});
