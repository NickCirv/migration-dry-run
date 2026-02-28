/**
 * Knex Migration Parser
 * Knex migrations are JavaScript files. This module extracts schema operations
 * by pattern-matching common knex schema builder API calls.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

/**
 * Knex schema operation patterns to detect
 */
const KNEX_PATTERNS = [
  {
    pattern: /knex\.schema\.createTable\s*\(\s*['"`](\w+)['"`]/g,
    type: 'CREATE TABLE',
    extract: (match) => ({ table: match[1] }),
  },
  {
    pattern: /knex\.schema\.dropTable\s*\(\s*['"`](\w+)['"`]/g,
    type: 'DROP TABLE',
    extract: (match) => ({ table: match[1] }),
  },
  {
    pattern: /knex\.schema\.dropTableIfExists\s*\(\s*['"`](\w+)['"`]/g,
    type: 'DROP TABLE',
    extract: (match) => ({ table: match[1] }),
  },
  {
    pattern: /knex\.schema\.renameTable\s*\(\s*['"`](\w+)['"`]\s*,\s*['"`](\w+)['"`]/g,
    type: 'RENAME TABLE',
    extract: (match) => ({ from: match[1], to: match[2] }),
  },
  {
    pattern: /knex\.schema\.alterTable\s*\(\s*['"`](\w+)['"`]/g,
    type: 'ALTER TABLE',
    extract: (match) => ({ table: match[1] }),
  },
  {
    pattern: /table\.dropColumn\s*\(\s*['"`](\w+)['"`]/g,
    type: 'DROP COLUMN',
    extract: (match) => ({ column: match[1] }),
  },
  {
    pattern: /table\.renameColumn\s*\(\s*['"`](\w+)['"`]\s*,\s*['"`](\w+)['"`]/g,
    type: 'RENAME COLUMN',
    extract: (match) => ({ from: match[1], to: match[2] }),
  },
  {
    pattern: /table\.index\s*\(\s*\[?['"`](\w+)['"`]/g,
    type: 'CREATE INDEX',
    extract: (match) => ({ column: match[1] }),
  },
  {
    pattern: /table\.dropIndex\s*\(\s*\[?['"`](\w+)['"`]/g,
    type: 'DROP INDEX',
    extract: (match) => ({ column: match[1] }),
  },
  {
    pattern: /table\.foreign\s*\(\s*['"`](\w+)['"`]/g,
    type: 'ADD FOREIGN KEY',
    extract: (match) => ({ column: match[1] }),
  },
  {
    pattern: /knex\s*\(\s*['"`](\w+)['"`]\s*\)\.delete\s*\(\s*\)/g,
    type: 'DELETE',
    extract: (match) => ({ table: match[1], hasWhere: false, subtype: 'DELETE (no WHERE)' }),
  },
  {
    pattern: /knex\s*\(\s*['"`](\w+)['"`]\s*\)\.truncate\s*\(\s*\)/g,
    type: 'DELETE',
    extract: (match) => ({ table: match[1], hasWhere: false, subtype: 'DELETE (no WHERE)' }),
  },
  {
    pattern: /knex\s*\(\s*['"`](\w+)['"`]\s*\)\.update\s*\(/g,
    type: 'UPDATE',
    extract: (match) => ({ table: match[1], hasWhere: false, subtype: 'UPDATE (no WHERE)' }),
  },
];

/**
 * Parse a single Knex migration JS file
 */
function parseKnexFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read file: ${filePath} — ${err.message}`);
  }

  const ops = [];
  let currentTable = null;

  // First pass: find all createTable / alterTable references to set table context
  const tableMatches = [...content.matchAll(/(?:createTable|alterTable)\s*\(\s*['"`](\w+)['"`]/g)];
  if (tableMatches.length > 0) {
    currentTable = tableMatches[0][1];
  }

  for (const def of KNEX_PATTERNS) {
    const regex = new RegExp(def.pattern.source, def.pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const extracted = def.extract(match);

      if (!extracted.table && currentTable) {
        extracted.table = currentTable;
      }

      const effectiveType = extracted.subtype || def.type;

      ops.push({
        type: def.type,
        effectiveType,
        raw: match[0],
        source: 'knex',
        ...extracted,
      });
    }
  }

  return ops;
}

/**
 * Collect all Knex migration JS files from a directory
 */
export function collectKnexMigrations(dirPath) {
  const files = [];

  try {
    const entries = readdirSync(dirPath).sort();
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && (extname(entry) === '.js' || extname(entry) === '.ts' || extname(entry) === '.mjs')) {
        if (/^\d/.test(entry) || /migration/i.test(entry)) {
          files.push({ name: entry, path: fullPath });
        }
      }
    }
  } catch (err) {
    throw new Error(`Cannot read Knex migrations directory: ${dirPath} — ${err.message}`);
  }

  return files;
}

/**
 * Parse all Knex migrations in a directory
 */
export function parseKnexMigrations(dirPath) {
  const files = collectKnexMigrations(dirPath);
  const allOps = [];

  for (const file of files) {
    const ops = parseKnexFile(file.path);
    for (const op of ops) {
      allOps.push({
        ...op,
        migrationName: file.name,
        migrationPath: file.path,
      });
    }
  }

  return allOps;
}
