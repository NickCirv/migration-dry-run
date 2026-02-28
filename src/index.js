/**
 * migration-dry-run
 * Barrel exports for programmatic usage
 */

export { parseSQL, parseStatement, splitStatements } from './parser.js';
export { enrichOperations, enrichOperation, getBaseEstimate, estimateDuration, ESTIMATES } from './estimator.js';
export { scoreMigration } from './risk.js';
export { analyzeRollbacks, analyzeRollback } from './rollback.js';
export { parsePrismaMigrations, collectPrismaMigrations, isPrismaDir } from './prisma.js';
export { parseKnexMigrations, collectKnexMigrations } from './knex.js';
export { renderReport, renderJSON } from './reporter.js';
export { fmt, riskColor, lockColor, formatDuration, rollbackIcon } from './formatter.js';

/**
 * Full pipeline: SQL string → enriched ops → risk → rollback → report data
 *
 * @param {string} sql - Raw SQL string
 * @param {Object} rowCounts - Map of table name to row count e.g. { users: 500000 }
 * @returns {{ operations, risk }}
 */
export async function analyze(sql, rowCounts = {}) {
  const { parseSQL } = await import('./parser.js');
  const { enrichOperations } = await import('./estimator.js');
  const { scoreMigration } = await import('./risk.js');
  const { analyzeRollbacks } = await import('./rollback.js');

  const ops = parseSQL(sql);
  const enriched = enrichOperations(ops, rowCounts);
  const withRollback = analyzeRollbacks(enriched);
  const risk = scoreMigration(withRollback);

  return { operations: withRollback, risk };
}
