/**
 * Risk Scorer
 * Aggregates per-operation risk into an overall migration risk level.
 */

const RISK_WEIGHTS = {
  safe: 0,
  caution: 1,
  dangerous: 3,
};

const RISK_LABELS = {
  safe: 'SAFE',
  caution: 'CAUTION',
  dangerous: 'DANGEROUS',
};

/**
 * Score overall migration risk from enriched operations
 */
export function scoreMigration(enrichedOps) {
  const counts = { safe: 0, caution: 0, dangerous: 0 };
  const dangerousOps = [];
  const cautionOps = [];
  let totalScore = 0;
  let totalDurationMs = 0;
  let hasIrreversible = false;

  for (const op of enrichedOps) {
    const risk = op.estimate?.risk || 'caution';
    const normalized = risk.toLowerCase();
    counts[normalized] = (counts[normalized] || 0) + 1;
    totalScore += RISK_WEIGHTS[normalized] || 0;

    if (normalized === 'dangerous') {
      dangerousOps.push(op);
    } else if (normalized === 'caution') {
      cautionOps.push(op);
    }

    if (op.estimate?.rollback === 'impossible') {
      hasIrreversible = true;
    }

    if (op.estimate?.durationMs) {
      totalDurationMs += op.estimate.durationMs;
    }
  }

  let overall;
  if (counts.dangerous > 0) {
    overall = 'dangerous';
  } else if (counts.caution > 0) {
    overall = 'caution';
  } else {
    overall = 'safe';
  }

  return {
    overall,
    label: RISK_LABELS[overall],
    score: totalScore,
    counts,
    dangerousOps,
    cautionOps,
    hasIrreversible,
    totalDurationMs: totalDurationMs || null,
    isFullyReversible: !hasIrreversible,
    summary: buildSummary(overall, counts, hasIrreversible, enrichedOps.length),
  };
}

function buildSummary(overall, counts, hasIrreversible, total) {
  const parts = [];

  if (overall === 'dangerous') {
    parts.push(`${counts.dangerous} irreversible or high-risk operation${counts.dangerous > 1 ? 's' : ''} detected`);
  } else if (overall === 'caution') {
    parts.push(`${counts.caution} operation${counts.caution > 1 ? 's' : ''} with potential lock or data impact`);
  } else {
    parts.push('All operations are safe to run');
  }

  if (hasIrreversible) {
    parts.push('migration is NOT fully reversible');
  }

  return parts.join(' — ');
}
