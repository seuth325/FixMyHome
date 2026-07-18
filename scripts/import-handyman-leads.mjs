import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const url = new URL(databaseUrl);
const adapter = new PrismaMariaDb({
  host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
});
const db = new PrismaClient({ adapter });
const rows = JSON.parse(await readFile(new URL('../data/pinellas-electricians.json', import.meta.url), 'utf8'));
let created = 0;
let updated = 0;
for (const row of rows) {
  const existing = await db.handymanLead.findUnique({ where: { sourceKey: row.sourceKey }, select: { id: true } });
  await db.handymanLead.upsert({
    where: { sourceKey: row.sourceKey },
    create: row,
    update: row,
  });
  existing ? updated++ : created++;
}
console.log(JSON.stringify({ total: rows.length, created, updated }));
await db.$disconnect();