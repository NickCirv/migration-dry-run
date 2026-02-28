/**
 * Estimator — calculates lock type, duration, risk, and rollback complexity
 * based on operation type and optional row count hints.
 */

export const ESTIMATES = {
  'CREATE TABLE': {
    lock: 'none',
    risk: 'safe',
    rollback: 'easy',
    note: 'New table creation — no existing data affected.',
    msPerKRows: 0,
  },
  'ADD COLUMN (nullable)': {
    lock: 'brief',
    risk: 'safe',
    rollback: 'easy',
    note: 'Nullable column — no table rewrite needed. Metadata change only.',
    msPerKRows: 0.1,
  },
  'ADD COLUMN (NOT NULL, default)': {
    lock: 'full-table-rewrite',
    risk: 'caution',
    rollback: 'medium',
    note: 'NOT NULL with default requires rewriting every row.',
    msPerKRows: 1,
  },
  'ADD COLUMN (NOT NULL, no default)': {
    lock: 'full-table-rewrite',
    risk: 'dangerous',
    rollback: 'hard',
    note: 'NOT NULL without default will FAIL on non-empty tables in most databases.',
    msPerKRows: 1,
  },
  'DROP COLUMN': {
    lock: 'full-table-rewrite',
    risk: 'dangerous',
    rollback: 'impossible',
    note: 'Data will be permanently lost. No undo.',
    msPerKRows: 1,
  },
  'MODIFY COLUMN': {
    lock: 'full-table-rewrite',
    risk: 'dangerous',
    rollback: 'hard',
    note: 'Type changes rewrite every row and may truncate or corrupt data.',
    msPerKRows: 1.2,
  },
  'RENAME COLUMN': {
    lock: 'brief',
    risk: 'caution',
    rollback: 'easy',
    note: 'Renames break existing queries and ORM mappings that reference the old name.',
    msPerKRows: 0,
  },
  'RENAME TABLE': {
    lock: 'brief',
    risk: 'caution',
    rollback: 'easy',
    note: 'Renames break existing queries and code referencing the old table name.',
    msPerKRows: 0,
  },
  'CREATE INDEX': {
    lock: 'concurrent-possible',
    risk: 'caution',
    rollback: 'easy',
    note: 'Consider CREATE INDEX CONCURRENTLY to avoid locking reads/writes.',
    msPerKRows: 2,
  },
  'CREATE INDEX CONCURRENTLY': {
    lock: 'none',
    risk: 'safe',
    rollback: 'easy',
    note: 'Concurrent build — no table lock. Takes longer but safe for production.',
    msPerKRows: 3,
  },
  'DROP INDEX': {
    lock: 'brief',
    risk: 'caution',
    rollback: 'medium',
    note: 'Dropping an index is fast but cannot be rebuilt without a re-index operation.',
    msPerKRows: 0.1,
  },
  'ADD FOREIGN KEY': {
    lock: 'full-table-scan',
    risk: 'caution',
    rollback: 'easy',
    note: 'Validates all existing rows — locks table during scan.',
    msPerKRows: 1,
  },
  'ADD CONSTRAINT': {
    lock: 'full-table-scan',
    risk: 'caution',
    rollback: 'easy',
    note: 'Constraint validation scans all rows and may lock the table.',
    msPerKRows: 0.8,
  },
  'UPDATE (no WHERE)': {
    lock: 'full-table',
    risk: 'dangerous',
    rollback: 'impossible',
    note: 'No WHERE clause — affects EVERY row. Previous values are gone.',
    msPerKRows: 2,
  },
  'UPDATE (with WHERE)': {
    lock: 'row-level',
    risk: 'caution',
    rollback: 'medium',
    note: 'Row-level locks for matched rows. Impact depends on selectivity.',
    msPerKRows: 0.5,
  },
  'DELETE (no WHERE)': {
    lock: 'full-table',
    risk: 'dangerous',
    rollback: 'impossible',
    note: 'No WHERE clause — deletes EVERY row. Data is gone without a backup.',
    msPerKRows: 1,
  },
  'DELETE (with WHERE)': {
    lock: 'row-level',
    risk: 'caution',
    rollback: 'medium',
    note: 'Row-level locks for matched rows. Data is still deleted permanently.',
    msPerKRows: 0.5,
  },
  'INSERT': {
    lock: 'none',
    risk: 'safe',
    rollback: 'easy',
    note: 'Inserts new rows — existing data unaffected.',
    msPerKRows: 0.5,
  },
  'DROP TABLE': {
    lock: 'brief',
    risk: 'dangerous',
    rollback: 'impossible',
    note: 'ALL data in this table will be permanently destroyed.',
    msPerKRows: 0,
  },
  'UNKNOWN': {
    lock: 'unknown',
    risk: 'caution',
    rollback: 'unknown',
    note: 'Could not parse this statement. Review manually.',
    msPerKRows: 0,
  },
};

/**
 * Get base estimate for an operation
 */
export function getBaseEstimate(effectiveType) {
  return ESTIMATES[effectiveType] || ESTIMATES['UNKNOWN'];
}

/**
 * Estimate lock duration given row count
 */
export function estimateDuration(effectiveType, rowCount) {
  if (!rowCount || rowCount === 0) return null;
  const est = getBaseEstimate(effectiveType);
  if (!est.msPerKRows) return null;
  const ms = (rowCount / 1000) * est.msPerKRows;
  return ms;
}

/**
 * Enrich an operation with estimate data and optional duration
 */
export function enrichOperation(op, rowCounts = {}) {
  const key = op.effectiveType;
  const base = getBaseEstimate(key);
  const rowCount = op.table ? (rowCounts[op.table] || rowCounts['*'] || null) : null;
  const durationMs = estimateDuration(key, rowCount);

  return {
    ...op,
    estimate: {
      lock: base.lock,
      risk: base.risk,
      rollback: base.rollback,
      note: base.note,
      rowCount,
      durationMs,
    },
  };
}

/**
 * Enrich an array of operations
 */
export function enrichOperations(ops, rowCounts = {}) {
  return ops.map((op) => enrichOperation(op, rowCounts));
}
