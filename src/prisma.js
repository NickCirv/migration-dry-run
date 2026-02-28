/**
 * Prisma Migration Parser
 * Prisma migrations generate standard SQL files inside migration directories.
 * This module handles finding and reading those SQL files.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { parseSQL } from './parser.js';

/**
 * Check if a directory looks like a Prisma migration directory
 */
export function isPrismaDir(dirPath) {
  try {
    const entries = readdirSync(dirPath);
    // Prisma migration directories contain timestamped subdirectories
    // each with a migration.sql file
    const hasMigrationDirs = entries.some((entry) => {
      const fullPath = join(dirPath, entry);
      if (!statSync(fullPath).isDirectory()) return false;
      // Typical Prisma migration dir: 20240101000000_create_users
      return /^\d{14}_.+$/.test(entry) || entry === 'dev.db';
    });

    // Also check for a schema.prisma file nearby
    const hasMigrationSql = entries.some((entry) => {
      const subPath = join(dirPath, entry);
      if (!statSync(subPath).isDirectory()) return false;
      try {
        const subEntries = readdirSync(subPath);
        return subEntries.includes('migration.sql');
      } catch {
        return false;
      }
    });

    return hasMigrationDirs || hasMigrationSql;
  } catch {
    return false;
  }
}

/**
 * Collect all migration.sql files from a Prisma migrations directory
 */
export function collectPrismaMigrations(dirPath) {
  const migrations = [];

  try {
    const entries = readdirSync(dirPath).sort();

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        const sqlPath = join(fullPath, 'migration.sql');
        try {
          const sql = readFileSync(sqlPath, 'utf-8');
          migrations.push({
            name: entry,
            path: sqlPath,
            sql,
          });
        } catch {
          // No migration.sql in this directory
        }
      } else if (extname(entry) === '.sql') {
        // Also handle flat SQL files
        try {
          const sql = readFileSync(fullPath, 'utf-8');
          migrations.push({
            name: basename(entry, '.sql'),
            path: fullPath,
            sql,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch (err) {
    throw new Error(`Cannot read Prisma migrations directory: ${dirPath} — ${err.message}`);
  }

  return migrations;
}

/**
 * Parse all Prisma migrations and return flat list of operations with migration context
 */
export function parsePrismaMigrations(dirPath) {
  const migrations = collectPrismaMigrations(dirPath);
  const allOps = [];

  for (const migration of migrations) {
    const ops = parseSQL(migration.sql);
    for (const op of ops) {
      allOps.push({
        ...op,
        migrationName: migration.name,
        migrationPath: migration.path,
        source: 'prisma',
      });
    }
  }

  return allOps;
}
