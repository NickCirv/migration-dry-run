#!/usr/bin/env node

/**
 * migration-dry-run CLI
 * Predicts migration impact before you run it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import { program } from 'commander';

program
  .name('migration-dry-run')
  .description('Predict migration impact before you run it. Lock duration, data loss risk, rollback feasibility.')
  .version('1.0.0')
  .argument('[path]', 'SQL file or migrations directory to analyze')
  .option('--prisma', 'Parse Prisma migration directories (migration.sql files)')
  .option('--knex', 'Parse Knex migration JS files')
  .option('--rows <tables>', 'Row count hints: users:500000,orders:1000000', parseRows)
  .option('--json', 'Output as JSON (for CI/scripting)')
  .option('--strict', 'Exit with code 1 if any DANGEROUS operation detected (CI mode)')
  .addHelpText('after', `
Examples:
  $ migration-dry-run migration.sql
  $ migration-dry-run ./migrations/
  $ migration-dry-run --prisma ./prisma/migrations/
  $ migration-dry-run --knex ./migrations/
  $ migration-dry-run . --rows users:500000,orders:1200000
  $ migration-dry-run . --json
  $ migration-dry-run . --strict
  `)
  .parse();

const options = program.opts();
const [targetPath] = program.args;

function parseRows(val) {
  const result = {};
  if (!val) return result;
  for (const part of val.split(',')) {
    const [table, count] = part.split(':');
    if (table && count) {
      result[table.trim()] = parseInt(count.trim(), 10);
    }
  }
  return result;
}

function collectSQLFiles(dirPath) {
  const files = [];
  const entries = readdirSync(dirPath).sort();
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);
    if (stat.isFile() && extname(entry) === '.sql') {
      files.push(fullPath);
    } else if (stat.isDirectory()) {
      files.push(...collectSQLFiles(fullPath));
    }
  }
  return files;
}

async function run() {
  const {
    parseSQL,
    enrichOperations,
    scoreMigration,
    analyzeRollbacks,
    parsePrismaMigrations,
    parseKnexMigrations,
    renderReport,
    renderJSON,
  } = await import('../src/index.js');

  const rowCounts = options.rows || {};
  let ops = [];
  const target = targetPath ? resolve(targetPath) : resolve('.');

  try {
    if (options.prisma) {
      // Prisma mode: scan for migration.sql files
      if (!existsSync(target)) {
        console.error(`Error: Path not found: ${target}`);
        process.exit(1);
      }
      ops = parsePrismaMigrations(target);
      if (ops.length === 0) {
        console.error('No Prisma migration SQL found. Make sure the directory contains timestamped subdirs with migration.sql files.');
        process.exit(1);
      }
    } else if (options.knex) {
      // Knex mode: scan for JS migration files
      if (!existsSync(target)) {
        console.error(`Error: Path not found: ${target}`);
        process.exit(1);
      }
      ops = parseKnexMigrations(target);
      if (ops.length === 0) {
        console.error('No Knex migration files found. Make sure the directory contains JS files with numeric prefixes or "migration" in the name.');
        process.exit(1);
      }
    } else if (!targetPath) {
      // No path — scan current directory for .sql files
      const sqlFiles = collectSQLFiles(target);
      if (sqlFiles.length === 0) {
        console.error('No .sql files found in current directory. Provide a file or directory path.');
        program.help();
        process.exit(1);
      }
      for (const file of sqlFiles) {
        const sql = readFileSync(file, 'utf-8');
        const fileOps = parseSQL(sql).map((op) => ({ ...op, migrationName: file }));
        ops.push(...fileOps);
      }
    } else {
      const stat = existsSync(target) ? statSync(target) : null;
      if (!stat) {
        console.error(`Error: Path not found: ${target}`);
        process.exit(1);
      }

      if (stat.isDirectory()) {
        const sqlFiles = collectSQLFiles(target);
        if (sqlFiles.length === 0) {
          console.error(`No .sql files found in: ${target}`);
          process.exit(1);
        }
        for (const file of sqlFiles) {
          const sql = readFileSync(file, 'utf-8');
          const fileOps = parseSQL(sql).map((op) => ({ ...op, migrationName: file }));
          ops.push(...fileOps);
        }
      } else {
        // Single file
        const sql = readFileSync(target, 'utf-8');
        ops = parseSQL(sql);
      }
    }
  } catch (err) {
    console.error(`Error reading migration: ${err.message}`);
    process.exit(1);
  }

  // Enrich with estimates
  const enriched = enrichOperations(ops, rowCounts);

  // Analyze rollbacks
  const withRollback = analyzeRollbacks(enriched);

  // Score overall risk
  const risk = scoreMigration(withRollback);

  // Output
  if (options.json) {
    console.log(renderJSON(withRollback, risk));
  } else {
    console.log(renderReport(withRollback, risk));
  }

  // Strict mode: exit 1 on DANGEROUS
  if (options.strict && risk.overall === 'dangerous') {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
