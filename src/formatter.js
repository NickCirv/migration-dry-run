import chalk from 'chalk';

export const fmt = {
  safe: (text) => chalk.green(text),
  caution: (text) => chalk.yellow(text),
  dangerous: (text) => chalk.red(text),
  muted: (text) => chalk.dim(text),
  bold: (text) => chalk.bold(text),
  header: (text) => chalk.bold.white(text),
  label: (text) => chalk.cyan(text),
  divider: (char = '─', width = 48) => chalk.dim(char.repeat(width)),
  bullet: (text) => `  ${text}`,
};

export function riskColor(level) {
  switch (level?.toUpperCase()) {
    case 'SAFE': return fmt.safe(level.toUpperCase());
    case 'CAUTION': return fmt.caution(level.toUpperCase());
    case 'DANGEROUS': return fmt.dangerous(level.toUpperCase());
    default: return chalk.white(level);
  }
}

export function lockColor(lock) {
  if (!lock) return chalk.dim('unknown');
  if (lock === 'none') return chalk.green(lock);
  if (lock.includes('full')) return chalk.red(lock);
  return chalk.yellow(lock);
}

export function formatDuration(ms) {
  if (ms < 1000) return `~${Math.round(ms)}ms`;
  if (ms < 60000) return `~${(ms / 1000).toFixed(1)}s`;
  return `~${(ms / 60000).toFixed(1)}min`;
}

export function rollbackIcon(feasibility) {
  switch (feasibility?.toLowerCase()) {
    case 'easy': return chalk.green('✓');
    case 'medium': return chalk.yellow('~');
    case 'hard': return chalk.red('!');
    case 'impossible': return chalk.red('✗');
    default: return chalk.dim('?');
  }
}
