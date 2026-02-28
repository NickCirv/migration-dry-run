/**
 * Reporter — renders the terminal impact report
 */

import chalk from 'chalk';
import { fmt, riskColor, lockColor, formatDuration, rollbackIcon } from './formatter.js';

const VERSION = '1.0.0';

function header() {
  return [
    '',
    `  ${chalk.bold.white('MIGRATION-DRY-RUN')}  ${chalk.dim('v' + VERSION)}`,
    '',
  ].join('\n');
}

function divider(label = '') {
  const line = '─'.repeat(48);
  if (label) {
    const padding = '─'.repeat(Math.max(0, 48 - label.length - 3));
    return chalk.dim(`  ── ${label} ${padding}`);
  }
  return chalk.dim(`  ${line}`);
}

function renderOperation(op, index) {
  const lines = [];
  const est = op.estimate || {};
  // 'index' field in parser holds the SQL index name (string); opNumber is the numeric position
  const { effectiveType, table, column, index: sqlIndexName, from, to } = op;
  const opNum = op.opNumber || index;

  // Operation label
  let opLabel = effectiveType || op.type;
  if (table) opLabel += ` ${chalk.bold(table)}`;
  if (column) opLabel += `.${chalk.bold(column)}`;
  // Only show SQL index name if it's a non-numeric string (not the opNumber)
  if (sqlIndexName && typeof sqlIndexName === 'string') opLabel += ` (${chalk.bold(sqlIndexName)})`;
  if (from && to) opLabel += ` ${chalk.dim(from)} → ${chalk.bold(to)}`;

  lines.push(`  ${chalk.dim(String(opNum) + '.')} ${opLabel}`);

  // Lock | Risk | Rollback line
  const parts = [
    `Lock: ${lockColor(est.lock || 'unknown')}`,
    `Risk: ${riskColor(est.risk || 'caution')}`,
    `Rollback: ${fmt.muted(est.rollback || 'unknown')}`,
  ];
  lines.push(`     ${parts.join(chalk.dim(' │ '))}`);

  // Duration estimate if row count provided
  if (est.durationMs) {
    const duration = formatDuration(est.durationMs);
    const rowFmt = est.rowCount ? chalk.dim(`at ${est.rowCount.toLocaleString()} rows`) : '';
    lines.push(`     ${chalk.yellow('⚠')} ${rowFmt}: ${chalk.bold(duration)} lock estimated`);
  }

  // Note
  if (est.note) {
    const icon = est.risk === 'dangerous' ? chalk.red('⛔') : est.risk === 'caution' ? chalk.yellow('💡') : chalk.green('✓');
    lines.push(`     ${icon} ${chalk.dim(est.note)}`);
  }

  // Migration source
  if (op.migrationName) {
    lines.push(`     ${chalk.dim(`from: ${op.migrationName}`)}`);
  }

  lines.push('');
  return lines.join('\n');
}

function renderSummary(risk, enrichedOps) {
  const lines = [];
  lines.push(divider('Impact Summary'));
  lines.push('');
  lines.push(`  ${fmt.label('Total operations:')} ${enrichedOps.length}`);

  if (risk.counts.safe) lines.push(`  ${fmt.safe('Safe:')}       ${risk.counts.safe}`);
  if (risk.counts.caution) lines.push(`  ${fmt.caution('Caution:')}    ${risk.counts.caution}`);
  if (risk.counts.dangerous) lines.push(`  ${fmt.dangerous('Dangerous:')}  ${risk.counts.dangerous}`);

  if (risk.totalDurationMs) {
    lines.push(`  ${fmt.label('Est. total lock time:')} ${formatDuration(risk.totalDurationMs)}`);
  }

  lines.push('');
  lines.push(`  ${fmt.label('Risk:')} ${riskColor(risk.label)} — ${chalk.dim(risk.summary)}`);
  lines.push('');

  return lines.join('\n');
}

function renderRollbackPlan(ops) {
  const lines = [];
  lines.push(divider('Rollback Plan'));
  lines.push('');

  for (const op of ops) {
    const rb = op.rollbackAnalysis;
    if (!rb) continue;

    const icon = rollbackIcon(rb.complexity);
    const label = op.effectiveType || op.type;
    const table = op.table ? ` [${op.table}]` : '';

    lines.push(`  ${icon}  ${chalk.dim('Op ' + (op.opNumber || '?') + ':')} ${label}${table}`);

    if (rb.feasible && rb.sql) {
      lines.push(`       ${chalk.dim(rb.sql)}`);
    } else if (!rb.feasible) {
      lines.push(`       ${chalk.red('CANNOT ROLLBACK')} — ${chalk.dim(rb.note)}`);
    } else {
      lines.push(`       ${chalk.dim(rb.note)}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

function renderFooter(risk) {
  const lines = [];

  if (!risk.isFullyReversible) {
    lines.push(`  ${chalk.red.bold('⚠  This migration is NOT fully reversible.')}`);
    lines.push(chalk.dim('     Consider breaking into smaller, safer steps.'));
  } else if (risk.overall === 'caution') {
    lines.push(`  ${chalk.yellow('⚠  Review caution operations before running in production.')}`);
  } else {
    lines.push(`  ${chalk.green('✓  Migration looks safe. Review before running.')}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Render the full terminal report
 */
export function renderReport(enrichedOps, risk) {
  const sections = [];

  sections.push(header());
  sections.push('  Analyzing migration...\n');

  if (enrichedOps.length === 0) {
    sections.push('  ' + chalk.yellow('No recognizable operations found.'));
    sections.push('  ' + chalk.dim('Check that the file contains valid SQL, Prisma, or Knex migrations.\n'));
    return sections.join('');
  }

  sections.push(divider('Operations'));
  sections.push('');

  for (let i = 0; i < enrichedOps.length; i++) {
    sections.push(renderOperation(enrichedOps[i], i + 1));
  }

  sections.push(renderSummary(risk, enrichedOps));

  // Add rollback plan if ops have rollback analysis
  const withRollback = enrichedOps.filter((op) => op.rollbackAnalysis);
  if (withRollback.length > 0) {
    sections.push(renderRollbackPlan(withRollback));
  }

  sections.push(renderFooter(risk));

  return sections.join('');
}

/**
 * Render JSON output
 */
export function renderJSON(enrichedOps, risk) {
  return JSON.stringify(
    {
      version: VERSION,
      risk: {
        overall: risk.overall,
        label: risk.label,
        score: risk.score,
        counts: risk.counts,
        hasIrreversible: risk.hasIrreversible,
        isFullyReversible: risk.isFullyReversible,
        summary: risk.summary,
        totalDurationMs: risk.totalDurationMs,
      },
      operations: enrichedOps.map((op) => ({
        opNumber: op.opNumber,
        type: op.type,
        effectiveType: op.effectiveType,
        table: op.table || null,
        column: op.column || null,
        indexName: typeof op.index === 'string' ? op.index : null,
        migrationName: op.migrationName || null,
        estimate: op.estimate,
        rollback: op.rollbackAnalysis,
      })),
    },
    null,
    2
  );
}
