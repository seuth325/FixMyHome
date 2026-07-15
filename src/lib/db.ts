import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

loadEnvConfig(process.cwd());

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function stripEnvQuotes(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function readDatabaseUrlFromEnvFile() {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = join(process.cwd(), fileName);
    if (!existsSync(filePath)) continue;

    const match = readFileSync(filePath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) return stripEnvQuotes(match[1]);
  }

  return undefined;
}

function getDatabaseUrl() {
  const configured = process.env.DATABASE_URL;
  const isHostingerPlaceholder = configured?.includes('username') || configured?.includes('/dbname');

  if (configured && !isHostingerPlaceholder) return configured;

  return readDatabaseUrlFromEnvFile() ?? configured;
}

function createPrismaClient() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const url = new URL(databaseUrl);
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  const adapter = new PrismaMariaDb({
    host,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
export const db = prisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;