/**
 * SQL Statement Parser
 * Extracts operation type, table, columns, indexes, and constraints
 */

const STATEMENT_PATTERNS = [
  // CREATE TABLE
  {
    pattern: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i,
    type: 'CREATE TABLE',
    extract: (match) => ({ table: match[1] }),
  },

  // DROP TABLE
  {
    pattern: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i,
    type: 'DROP TABLE',
    extract: (match) => ({ table: match[1] }),
  },

  // CREATE INDEX CONCURRENTLY
  {
    pattern: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s+ON\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i,
    type: 'CREATE INDEX CONCURRENTLY',
    extract: (match) => ({ index: match[1], table: match[2], columns: splitColumns(match[3]) }),
  },

  // CREATE INDEX (normal)
  {
    pattern: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s+ON\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i,
    type: 'CREATE INDEX',
    extract: (match) => ({ index: match[1], table: match[2], columns: splitColumns(match[3]) }),
  },

  // DROP INDEX
  {
    pattern: /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?[`"']?(\w+)[`"']?(?:\s+ON\s+[`"']?(\w+)[`"']?)?/i,
    type: 'DROP INDEX',
    extract: (match) => ({ index: match[1], table: match[2] || null }),
  },

  // ALTER TABLE RENAME COLUMN — must come before ADD COLUMN (specificity)
  {
    pattern: /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+RENAME\s+(?:COLUMN\s+)?[`"']?(\w+)[`"']?\s+TO\s+[`"']?(\w+)[`"']?/i,
    type: 'RENAME COLUMN',
    extract: (match) => ({ table: match[1], from: match[2], to: match[3] }),
  },

  // ALTER TABLE ADD FOREIGN KEY — must come before ADD COLUMN (specificity)
  {
    pattern: /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(?:CONSTRAINT\s+[`"']?\w+[`"']?\s+)?FOREIGN\s+KEY/i,
    type: 'ADD FOREIGN KEY',
    extract: (match) => ({ table: match[1] }),
  },

  // ALTER TABLE ADD CONSTRAINT (non-FK) — must come before ADD COLUMN (specificity)
  {
    pattern: /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(?:CONSTRAINT\s+[`"']?\w+[`"']?\s+)?(?:UNIQUE|CHECK|PRIMARY\s+KEY)/i,
    type: 'ADD CONSTRAINT',
    extract: (match) => ({ table: match[1] }),
  },

  // ALTER TABLE DROP COLUMN — must come before MODIFY (specificity)
  {
    pattern: /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?[`"']?(\w+)[`"']?/i,
    type: 'DROP COLUMN',
    extract: (match) => ({ table: match[1], column: match[2] }),
  },

  // ALTER TABLE MODIFY/ALTER COLUMN (type change)
  {
    pattern: /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+(?:MODIFY\s+(?:COLUMN\s+)?|ALTER\s+COLUMN\s+|CHANGE\s+(?:COLUMN\s+)?[`"']?\w+[`"']?\s+)[`"']?(\w+)[`"']?\s+([\w\s()]+)/i,
    type: 'MODIFY COLUMN',
    extract: (match) => ({ table: match[1], column: match[2], newType: match[3]?.trim() }),
  },

  // ALTER TABLE ADD COLUMN — broad pattern, must come after all specific ADD ... patterns
  {
    pattern: /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(?:COLUMN\s+)?[`"']?(\w+)[`"']?\s+([\w\s()]+?)(?:\s+(NOT\s+NULL|NULL))?(?:\s+DEFAULT\s+([^\s,;]+))?(?:\s*,|\s*;|\s*$)/i,
    type: 'ADD COLUMN',
    extract: (match, raw) => {
      const table = match[1];
      const column = match[2];
      const dataType = match[3]?.trim();
      const notNull = /NOT\s+NULL/i.test(raw);
      const hasDefault = /DEFAULT\s+/i.test(raw);
      const subtype = notNull && !hasDefault
        ? 'ADD COLUMN (NOT NULL, no default)'
        : notNull && hasDefault
          ? 'ADD COLUMN (NOT NULL, default)'
          : 'ADD COLUMN (nullable)';
      return { table, column, dataType, notNull, hasDefault, subtype };
    },
  },

  // UPDATE without WHERE
  {
    pattern: /UPDATE\s+[`"']?(\w+)[`"']?\s+SET\s+/i,
    type: 'UPDATE',
    extract: (match, raw) => {
      const hasWhere = /\bWHERE\b/i.test(raw);
      return { table: match[1], hasWhere, subtype: hasWhere ? 'UPDATE (with WHERE)' : 'UPDATE (no WHERE)' };
    },
  },

  // DELETE without WHERE
  {
    pattern: /DELETE\s+FROM\s+[`"']?(\w+)[`"']?/i,
    type: 'DELETE',
    extract: (match, raw) => {
      const hasWhere = /\bWHERE\b/i.test(raw);
      return { table: match[1], hasWhere, subtype: hasWhere ? 'DELETE (with WHERE)' : 'DELETE (no WHERE)' };
    },
  },

  // INSERT INTO (bulk data migrations)
  {
    pattern: /INSERT\s+INTO\s+[`"']?(\w+)[`"']?/i,
    type: 'INSERT',
    extract: (match) => ({ table: match[1] }),
  },

  // RENAME TABLE
  {
    pattern: /(?:ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+RENAME\s+TO|RENAME\s+TABLE\s+[`"']?(\w+)[`"']?\s+TO)\s+[`"']?(\w+)[`"']?/i,
    type: 'RENAME TABLE',
    extract: (match) => ({ from: match[1] || match[2], to: match[3] }),
  },
];

function splitColumns(str) {
  return str.split(',').map((c) => c.trim().replace(/[`"']/g, ''));
}

/**
 * Split SQL text into individual statements
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (!inString && (char === "'" || char === '"' || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && next !== stringChar) {
      inString = false;
    } else if (!inString && char === '(') {
      depth++;
    } else if (!inString && char === ')') {
      depth--;
    }

    if (!inString && depth === 0 && char === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
    } else {
      current += char;
    }
  }

  const last = current.trim();
  if (last) statements.push(last);

  return statements.filter((s) => {
    const clean = s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    return clean.length > 0;
  });
}

/**
 * Parse a single SQL statement into a structured operation object
 */
export function parseStatement(sql) {
  const clean = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!clean) return null;

  for (const def of STATEMENT_PATTERNS) {
    const match = clean.match(def.pattern);
    if (match) {
      const extracted = def.extract(match, clean);
      const effectiveType = extracted.subtype || def.type;
      return {
        type: def.type,
        effectiveType,
        raw: sql.trim(),
        ...extracted,
      };
    }
  }

  return {
    type: 'UNKNOWN',
    effectiveType: 'UNKNOWN',
    raw: sql.trim(),
    table: null,
  };
}

/**
 * Parse full SQL file/string into array of operations
 */
export function parseSQL(sql) {
  const statements = splitStatements(sql);
  return statements
    .map(parseStatement)
    .filter((op) => op !== null && op.type !== 'UNKNOWN');
}
