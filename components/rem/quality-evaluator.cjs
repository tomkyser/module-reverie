'use strict';

/**
 * Session quality evaluator for entropy engine adjustment.
 *
 * Implements D-12: dual-signal quality evaluation combining behavioral
 * signals (quantitative engagement metrics) and LLM reflection (qualitative
 * Mind assessment). Feeds composite quality score to the entropy engine for
 * distribution adjustment -- the entropy becomes personalized through
 * accumulated experience.
 *
 * Behavioral weight: 0.4
 * LLM reflection weight: 0.6
 * Fallback (no LLM): behavioral-only at weight 1.0
 *
 * @module reverie/components/rem/quality-evaluator
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Behavioral score component weights (must sum to 1.0) */
const BEHAVIORAL_WEIGHTS = Object.freeze({
  turn_engagement: 0.20,
  depth: 0.20,
  duration: 0.15,
  recall_usage: 0.15,
  compliance: 0.15,
  friction_inverse: 0.15,
});

/** Baseline thresholds for normalization */
const BASELINES = Object.freeze({
  turn_count_max: 30,
  avg_turn_length_max: 200,
  session_duration_max_ms: 1800000, // 30 minutes
  friction_max: 5,
});

/** Composite evaluation weights */
const COMPOSITE_WEIGHTS = Object.freeze({
  behavioral: 0.4,
  llm: 0.6,
});

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Computes a behavioral quality score from session engagement metrics.
 *
 * Weighted composite of six factors, each normalized to [0, 1]:
 * - turn_engagement: min(turn_count / 30, 1.0) * 0.2
 * - depth: min(avg_turn_length / 200, 1.0) * 0.2
 * - duration: min(session_duration_ms / 1800000, 1.0) * 0.15
 * - recall_usage: (recall_incorporated / max(recall_events, 1)) * 0.15
 * - compliance: directive_compliance_rate * 0.15
 * - friction_inverse: (1 - min(friction_signals / 5, 1.0)) * 0.15
 *
 * @param {Object} metrics - Session engagement metrics
 * @param {number} metrics.turn_count - Number of conversation turns
 * @param {number} metrics.avg_turn_length - Average turn length in characters
 * @param {number} metrics.session_duration_ms - Session duration in milliseconds
 * @param {number} metrics.recall_events - Number of recall events that occurred
 * @param {number} metrics.recall_incorporated - Number of recalls that were incorporated
 * @param {number} metrics.directive_compliance_rate - Rate of directive compliance (0-1)
 * @param {number} metrics.friction_signals - Count of friction signals detected
 * @returns {number} Quality score clamped to [0.0, 1.0]
 */
function computeBehavioralScore(metrics) {
  const m = metrics || {};

  const turnCount = typeof m.turn_count === 'number' ? m.turn_count : 0;
  const avgTurnLength = typeof m.avg_turn_length === 'number' ? m.avg_turn_length : 0;
  const sessionDuration = typeof m.session_duration_ms === 'number' ? m.session_duration_ms : 0;
  const recallEvents = typeof m.recall_events === 'number' ? m.recall_events : 0;
  const recallIncorporated = typeof m.recall_incorporated === 'number' ? m.recall_incorporated : 0;
  const complianceRate = typeof m.directive_compliance_rate === 'number' ? m.directive_compliance_rate : 0;
  const frictionSignals = typeof m.friction_signals === 'number' ? m.friction_signals : 0;

  const turnEngagement = Math.min(turnCount / BASELINES.turn_count_max, 1.0) * BEHAVIORAL_WEIGHTS.turn_engagement;
  const depth = Math.min(avgTurnLength / BASELINES.avg_turn_length_max, 1.0) * BEHAVIORAL_WEIGHTS.depth;
  const duration = Math.min(sessionDuration / BASELINES.session_duration_max_ms, 1.0) * BEHAVIORAL_WEIGHTS.duration;
  const recallUsage = (recallIncorporated / Math.max(recallEvents, 1)) * BEHAVIORAL_WEIGHTS.recall_usage;
  const compliance = complianceRate * BEHAVIORAL_WEIGHTS.compliance;
  const frictionInverse = (1 - Math.min(frictionSignals / BASELINES.friction_max, 1.0)) * BEHAVIORAL_WEIGHTS.friction_inverse;

  const raw = turnEngagement + depth + duration + recallUsage + compliance + frictionInverse;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, raw));
}

/**
 * Composes an LLM reflection prompt for session quality assessment.
 *
 * Creates a structured prompt asking the Mind (Secondary LLM) to rate session
 * quality on a 0.0-1.0 scale with justification.
 *
 * @param {string} sessionSummary - Narrative summary of the session
 * @param {Object} conditioningState - Current conditioning state for context
 * @returns {string} Formatted prompt string
 */
function composeLlmReflectionPrompt(sessionSummary, conditioningState) {
  const conditioningContext = conditioningState
    ? JSON.stringify(conditioningState, null, 2)
    : '(no conditioning data available)';

  return [
    'You are evaluating the quality of a completed interaction session.',
    'Rate the session quality on a scale from 0.0 (poor) to 1.0 (excellent).',
    '',
    '## Session Summary',
    sessionSummary || '(no summary available)',
    '',
    '## Current Conditioning State',
    conditioningContext,
    '',
    '## Evaluation Criteria',
    'Consider the following factors in your quality assessment:',
    '1. Personality-mood fit: Did the session mood align with the personality state?',
    '2. Conversation flow: Was the interaction natural and productive?',
    '3. Information retrieval effectiveness: Were recalls relevant and well-integrated?',
    '4. User satisfaction signals: Did engagement patterns suggest positive experience?',
    '',
    '## Response Format',
    'Provide your assessment followed by a numeric score.',
    'Format: score: X.X (where X.X is 0.0-1.0)',
    '',
    'Example: "The session showed strong engagement with effective recall integration. score: 0.75"',
  ].join('\n');
}

/**
 * Parses a numeric quality score from LLM response text.
 *
 * Recognizes patterns: "score: 0.7", "0.8/1.0", plain decimals 0.0-1.0.
 * Returns null if no parseable score is found.
 *
 * @param {string} llmResponse - Raw LLM response text
 * @returns {number|null} Parsed score clamped to [0.0, 1.0], or null
 */
function parseLlmScore(llmResponse) {
  if (!llmResponse || typeof llmResponse !== 'string') {
    return null;
  }

  // Pattern 1: "score: 0.7" or "score:0.7"
  const scorePattern = /score:\s*(-?\d+\.?\d*)/i;
  const scoreMatch = llmResponse.match(scorePattern);
  if (scoreMatch) {
    const val = parseFloat(scoreMatch[1]);
    if (!isNaN(val)) {
      return Math.max(0, Math.min(1, val));
    }
  }

  // Pattern 2: "0.8/1.0" or "0.8/1"
  const ratioPattern = /(\d+\.?\d*)\/1\.?0?/;
  const ratioMatch = llmResponse.match(ratioPattern);
  if (ratioMatch) {
    const val = parseFloat(ratioMatch[1]);
    if (!isNaN(val)) {
      return Math.max(0, Math.min(1, val));
    }
  }

  // Pattern 3: isolated decimal 0.0-1.0 (look for 0.XX pattern)
  const decimalPattern = /\b(0\.\d+|1\.0)\b/;
  const decimalMatch = llmResponse.match(decimalPattern);
  if (decimalMatch) {
    const val = parseFloat(decimalMatch[1]);
    if (!isNaN(val)) {
      return Math.max(0, Math.min(1, val));
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a quality evaluator instance.
 *
 * @param {Object} [options] - Configuration options
 * @param {Object} [options.entropyEngine] - Entropy engine instance (for evolve calls)
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Object} Frozen quality evaluator API
 */
function createQualityEvaluator(options) {
  const opts = options || {};
  const entropyEngine = opts.entropyEngine || null;

  /**
   * Evaluates session quality combining behavioral and LLM signals.
   *
   * If llmScore is present: composite = behavioral * 0.4 + llmScore * 0.6
   * If llmScore is null: composite = behavioral * 1.0 (fallback per D-12)
   *
   * Feeds the composite score to entropyEngine.evolve() if available.
   *
   * @param {Object} sessionMetrics - Session engagement metrics
   * @param {number|null} llmScore - LLM reflection score (0.0-1.0) or null
   * @returns {{ quality_score: number, behavioral_score: number, llm_score: number|null, entropy_evolved: boolean }}
   */
  function evaluateSession(sessionMetrics, llmScore) {
    const behavioralScore = computeBehavioralScore(sessionMetrics);

    let qualityScore;
    if (llmScore !== null && llmScore !== undefined && typeof llmScore === 'number') {
      qualityScore = behavioralScore * COMPOSITE_WEIGHTS.behavioral + llmScore * COMPOSITE_WEIGHTS.llm;
    } else {
      qualityScore = behavioralScore;
    }

    // Clamp to [0, 1]
    qualityScore = Math.max(0, Math.min(1, qualityScore));

    let entropyEvolved = false;
    if (entropyEngine && typeof entropyEngine.evolve === 'function') {
      entropyEngine.evolve({ quality: qualityScore });
      entropyEvolved = true;
    }

    return {
      quality_score: qualityScore,
      behavioral_score: behavioralScore,
      llm_score: (llmScore !== null && llmScore !== undefined && typeof llmScore === 'number') ? llmScore : null,
      entropy_evolved: entropyEvolved,
    };
  }

  return Object.freeze({
    evaluateSession,
    computeBehavioralScore,
    composeLlmReflectionPrompt,
    parseLlmScore,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { createQualityEvaluator };
