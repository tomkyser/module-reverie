'use strict';

/**
 * Budget phase state machine for context utilization tracking.
 *
 * Maps cumulative byte counts to 4 budget phases at research-backed thresholds.
 * Per D-05/D-06: follows the PITFALLS research model where injection REINFORCES
 * at high utilization (60-80%) rather than shrinking -- a deliberate departure
 * from the spec's Section 8.5 budget phases.
 *
 * Phase 3 (Reinforced, 60-80%) gets a LARGER injection than Phase 1 (Full, 0-30%).
 * This is grounded in Anthropic's attention budget research: at high context
 * utilization, the Self Model needs proportionally stronger injection to compete
 * for attention against accumulated raw material.
 *
 * @module reverie/components/context/budget-tracker
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Budget phase identifiers.
 *
 * Phase 1 (FULL): 0-30% utilization. Full 5-slot injection ~1200 tokens.
 * Phase 2 (COMPRESSED): 30-60%. Tightened slots ~800 tokens.
 * Phase 3 (REINFORCED): 60-80%. STRENGTHENED identity + referential ~1900 tokens.
 * Phase 4 (COMPACTION): >80%. Full injection + compaction advocacy directive ~1800 tokens.
 *
 * @type {Readonly<{ FULL: 1, COMPRESSED: 2, REINFORCED: 3, COMPACTION: 4 }>}
 */
const BUDGET_PHASES = Object.freeze({
  FULL: 1,
  COMPRESSED: 2,
  REINFORCED: 3,
  COMPACTION: 4,
});

/**
 * Utilization ratio thresholds for phase transitions.
 * Derived from PITFALLS research (NOT spec thresholds).
 *
 * @type {Readonly<{ COMPRESSED_AT: number, REINFORCED_AT: number, COMPACTION_AT: number }>}
 */
const PHASE_THRESHOLDS = Object.freeze({
  COMPRESSED_AT: 0.30,
  REINFORCED_AT: 0.60,
  COMPACTION_AT: 0.80,
});

/**
 * Default context window size in tokens.
 * Configurable -- different Claude models may have different windows.
 * @type {number}
 */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200000;

/**
 * Bytes-per-token heuristic for English text.
 * Per D-07: ~4 bytes/token for English. Official Anthropic tokenizer
 * is documented as inaccurate for Claude 3+; heuristic is sufficient
 * for wide budget phase boundaries.
 * @type {number}
 */
const BYTES_PER_TOKEN = 4;

/**
 * Default post-compaction buffer in tokens.
 * After compaction, the context is estimated to contain approximately
 * this many tokens of summarized content.
 * @type {number}
 */
const DEFAULT_POST_COMPACTION_TOKENS = 33000;

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

/**
 * Calculates the budget phase for a given byte count and context window size.
 *
 * Deterministic: same inputs always produce the same phase.
 * Thresholds are evaluated highest-first:
 *   >= 80% -> COMPACTION (4)
 *   >= 60% -> REINFORCED (3)
 *   >= 30% -> COMPRESSED (2)
 *   else   -> FULL (1)
 *
 * @param {number} cumulativeBytes - Total bytes consumed so far
 * @param {number} contextWindowBytes - Total context window size in bytes
 * @returns {number} Phase number (1-4)
 */
function calculateBudgetPhase(cumulativeBytes, contextWindowBytes) {
  const utilization = cumulativeBytes / contextWindowBytes;

  if (utilization >= PHASE_THRESHOLDS.COMPACTION_AT) return BUDGET_PHASES.COMPACTION;
  if (utilization >= PHASE_THRESHOLDS.REINFORCED_AT) return BUDGET_PHASES.REINFORCED;
  if (utilization >= PHASE_THRESHOLDS.COMPRESSED_AT) return BUDGET_PHASES.COMPRESSED;
  return BUDGET_PHASES.FULL;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a stateful budget tracker instance.
 *
 * Tracks cumulative byte consumption and calculates budget phase transitions.
 * Used by the Context Manager to determine when to recompose the face prompt.
 *
 * @param {Object} [options] - Configuration options
 * @param {number} [options.contextWindowTokens=200000] - Context window size in tokens
 * @returns {Object} Budget tracker instance with trackBytes, getPhase, getUtilization, getStats, reset, incrementTurn
 */
function createBudgetTracker(options) {
  const opts = options || {};
  const contextWindowTokens = opts.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS;
  const contextWindowBytes = contextWindowTokens * BYTES_PER_TOKEN;

  let _cumulativeBytes = 0;
  let _phase = BUDGET_PHASES.FULL;
  let _turnCount = 0;

  /**
   * Tracks additional bytes consumed and recalculates the budget phase.
   *
   * @param {number} byteCount - Number of bytes to add
   * @param {string} [source] - Source identifier (e.g., 'user_prompt', 'tool_output')
   * @returns {{ changed: boolean, from: number, to: number }} Transition info
   */
  function trackBytes(byteCount, source) {
    _cumulativeBytes += byteCount;
    const prevPhase = _phase;
    _phase = calculateBudgetPhase(_cumulativeBytes, contextWindowBytes);

    return {
      changed: _phase !== prevPhase,
      from: prevPhase,
      to: _phase,
    };
  }

  /**
   * Returns the current budget phase number (1-4).
   * @returns {number}
   */
  function getPhase() {
    return _phase;
  }

  /**
   * Returns the current utilization ratio (0.0 to 1.0+).
   * @returns {number}
   */
  function getUtilization() {
    return _cumulativeBytes / contextWindowBytes;
  }

  /**
   * Returns a full state snapshot.
   * @returns {{ cumulativeBytes: number, contextWindowBytes: number, phase: number, utilization: number, turnCount: number }}
   */
  function getStats() {
    return {
      cumulativeBytes: _cumulativeBytes,
      contextWindowBytes,
      phase: _phase,
      utilization: _cumulativeBytes / contextWindowBytes,
      turnCount: _turnCount,
    };
  }

  /**
   * Resets the tracker after compaction.
   *
   * Sets cumulative bytes to the provided value (or a default post-compaction
   * estimate) and recalculates the budget phase. Resets turn count to 0.
   *
   * @param {number} [postCompactionBytes] - Estimated bytes after compaction.
   *   Defaults to DEFAULT_POST_COMPACTION_TOKENS * BYTES_PER_TOKEN.
   */
  function reset(postCompactionBytes) {
    if (postCompactionBytes !== undefined && postCompactionBytes !== null) {
      _cumulativeBytes = postCompactionBytes;
    } else {
      _cumulativeBytes = DEFAULT_POST_COMPACTION_TOKENS * BYTES_PER_TOKEN;
    }
    _phase = calculateBudgetPhase(_cumulativeBytes, contextWindowBytes);
    _turnCount = 0;
  }

  /**
   * Increments the turn count by 1.
   */
  function incrementTurn() {
    _turnCount++;
  }

  return {
    trackBytes,
    getPhase,
    getUtilization,
    getStats,
    reset,
    incrementTurn,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  BUDGET_PHASES,
  PHASE_THRESHOLDS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  BYTES_PER_TOKEN,
  DEFAULT_POST_COMPACTION_TOKENS,
  calculateBudgetPhase,
  createBudgetTracker,
};
