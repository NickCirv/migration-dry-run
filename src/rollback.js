/**
 * Rollback Analyzer
 * Determines if each operation can be reversed, what the SQL would be,
 * and estimated rollback cost.
 */

/**
 * Generate rollback info for a single enriched operation
 */
export function analyzeRollback(op) {
  const { type, effectiveType, table, column, index, from, to } = op;

  switch (type) {
    case 'CREATE TABLE':
      return {
        feasible: true,
        complexity: 'easy',
        sql: `DROP TABLE IF EXISTS ${table};`,
        note: 'Drop the newly created table.',
        dataLoss: false,
      };

    case 'DROP TABLE':
      return {
        feasible: false,
        complexity: 'impossible',
        sql: null,
        note: 'Table and all its data are gone. Restore from backup only.',
        dataLoss: true,
      };

    case 'ADD COLUMN': {
      const col = column || '<column>';
      const tbl = table || '<table>';
      return {
        feasible: true,
        complexity: 'easy',
        sql: `ALTER TABLE ${tbl} DROP COLUMN ${col};`,
        note: 'Drop the added column. Any data written to it will be lost.',
        dataLoss: true,
      };
    }

    case 'DROP COLUMN':
      return {
        feasible: false,
        complexity: 'impossible',
        sql: null,
        note: 'Column data is permanently destroyed. Cannot recover without a backup.',
        dataLoss: true,
      };

    case 'MODIFY COLUMN': {
      const tbl = table || '<table>';
      const col = column || '<column>';
      return {
        feasible: true,
        complexity: 'hard',
        sql: `-- ALTER TABLE ${tbl} MODIFY COLUMN ${col} <original_type>;`,
        note: 'Requires knowing the original type. Data may be truncated/corrupted — not always reversible.',
        dataLoss: false,
      };
    }

    case 'RENAME COLUMN': {
      const tbl = table || '<table>';
      return {
        feasible: true,
        complexity: 'easy',
        sql: `ALTER TABLE ${tbl} RENAME COLUMN ${to} TO ${from};`,
        note: 'Swap the rename back.',
        dataLoss: false,
      };
    }

    case 'RENAME TABLE':
      return {
        feasible: true,
        complexity: 'easy',
        sql: `ALTER TABLE ${to} RENAME TO ${from};`,
        note: 'Swap the rename back.',
        dataLoss: false,
      };

    case 'CREATE INDEX':
    case 'CREATE INDEX CONCURRENTLY': {
      const idx = index || '<index>';
      return {
        feasible: true,
        complexity: 'easy',
        sql: `DROP INDEX ${idx};`,
        note: 'Drop the created index.',
        dataLoss: false,
      };
    }

    case 'DROP INDEX': {
      const idx = index || '<index>';
      const tbl = table || '<table>';
      return {
        feasible: true,
        complexity: 'medium',
        sql: `-- CREATE INDEX ${idx} ON ${tbl} (<original_columns>);`,
        note: 'Must know original index columns to recreate. Check schema history.',
        dataLoss: false,
      };
    }

    case 'ADD FOREIGN KEY':
    case 'ADD CONSTRAINT': {
      const tbl = table || '<table>';
      return {
        feasible: true,
        complexity: 'easy',
        sql: `-- ALTER TABLE ${tbl} DROP CONSTRAINT <constraint_name>;`,
        note: 'Drop the constraint. Need the constraint name from your schema.',
        dataLoss: false,
      };
    }

    case 'UPDATE': {
      if (effectiveType === 'UPDATE (no WHERE)') {
        return {
          feasible: false,
          complexity: 'impossible',
          sql: null,
          note: 'Original values are gone. Restore from backup.',
          dataLoss: true,
        };
      }
      return {
        feasible: true,
        complexity: 'medium',
        sql: `-- UPDATE ${table} SET <original_values> WHERE <same_condition>;`,
        note: 'Requires knowing original values. Feasible only if you captured a snapshot.',
        dataLoss: false,
      };
    }

    case 'DELETE': {
      if (effectiveType === 'DELETE (no WHERE)') {
        return {
          feasible: false,
          complexity: 'impossible',
          sql: null,
          note: 'All rows are gone. Restore from backup.',
          dataLoss: true,
        };
      }
      return {
        feasible: false,
        complexity: 'impossible',
        sql: null,
        note: 'Deleted rows cannot be recovered without a backup or transaction.',
        dataLoss: true,
      };
    }

    case 'INSERT': {
      const tbl = table || '<table>';
      return {
        feasible: true,
        complexity: 'easy',
        sql: `-- DELETE FROM ${tbl} WHERE <inserted_id_condition>;`,
        note: 'Delete the inserted rows by their IDs.',
        dataLoss: false,
      };
    }

    default:
      return {
        feasible: false,
        complexity: 'unknown',
        sql: null,
        note: 'Unknown operation — manual rollback analysis required.',
        dataLoss: false,
      };
  }
}

/**
 * Analyze rollback for all operations
 */
export function analyzeRollbacks(enrichedOps) {
  return enrichedOps.map((op, i) => ({
    ...op,
    rollbackAnalysis: analyzeRollback(op),
    opNumber: i + 1,
  }));
}
