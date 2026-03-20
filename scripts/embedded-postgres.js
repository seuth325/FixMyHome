const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;

const port = Number.parseInt(process.env.EMBEDDED_PG_PORT || '5432', 10);
const user = process.env.EMBEDDED_PG_USER || 'postgres';
const password = process.env.EMBEDDED_PG_PASSWORD || 'postgres';
const databaseDir = process.env.EMBEDDED_PG_DIR || path.join(process.cwd(), '.embedded-postgres', 'data');

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  onLog: (message) => {
    if (message) process.stdout.write(`[embedded-pg] ${String(message)}\n`);
  },
  onError: (error) => {
    if (error) process.stderr.write(`[embedded-pg:error] ${String(error)}\n`);
  },
});

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await pg.stop();
  } catch (error) {
    process.stderr.write(`[embedded-pg:error] stop failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  } finally {
    process.exit(code);
  }
}

async function main() {
  await pg.initialise();
  await pg.start();

  const adminClient = pg.getPgClient('postgres');
  await adminClient.connect();
  try {
    const dbName = process.env.EMBEDDED_PG_DB || 'dailyvideoops';
    const existing = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      await pg.createDatabase(dbName);
      process.stdout.write(`[embedded-pg] created database ${dbName}\n`);
    }
  } finally {
    await adminClient.end();
  }

  process.stdout.write(`[embedded-pg] ready on port ${port}\n`);
}

process.on('SIGINT', () => {
  shutdown(0);
});

process.on('SIGTERM', () => {
  shutdown(0);
});

main().catch(async (error) => {
  process.stderr.write(`[embedded-pg:error] startup failed: ${error?.stack || error}\n`);
  await shutdown(1);
});

