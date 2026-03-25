'use strict';

/**
 * Conditioned stochastic variance engine for Self Model trait weights.
 *
 * Provides gaussian noise to Self Model baseline trait weights, emulating
 * natural mood variance. The entropy is conditioned over time through
 * REM consolidation -- learning which mood states produce good interactions.
 *
 * Implements:
 * - D-07: Stochastic variance for mood emulation
 * - D-08: Conditioned entropy that evolves through REM
 *
 * Uses Box-Muller transform for gaussian random numbers (zero dependency).
 * Supports deterministic seeded mode via LCG for testing.
 *
 * @module reverie/components/self-model/entropy-engine
 */

// ---------------------------------------------------------------------------
// Seeded RNG (Linear Congruential Generator)
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic pseudo-random number generator using LCG.
 * Uses the classic Numerical Recipes parameters.
 *
 * @param {string} seedStr - Seed string to hash into an integer
 * @returns {function(): number} Function returning [0, 1) values
 */
function _createSeededRng(seedStr) {
  // Simple string hash -> 32-bit integer seed
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash + seedStr.charCodeAt(i)) | 0;
  }

  // LCG state
  let state = Math.abs(hash) || 1;

  // LCG parameters (Numerical Recipes)
  const a = 1664525;
  const c = 1013904223;
  const m = 0x100000000; // 2^32

  return function nextRandom() {
    state = (a * state + c) % m;
    return state / m;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an entropy engine instance.
 *
 * @param {Object} config - Configuration options
 * @param {number} [config.sigma=0.05] - Standard deviation for gaussian noise (5% default)
 * @param {string} [config.seed] - Optional seed for deterministic testing
 * @param {Array<Object>} [config.history=[]] - Past session outcomes for conditioned entropy
 * @returns {{ applyVariance: function, getState: function, evolve: function }}
 */
function createEntropyEngine(config) {
  const _config = config || {};

  /** @type {number} */
  let _sigma = typeof _config.sigma === 'number' ? _config.sigma : 0.05;

  /** @type {Array<Object>} */
  const _history = Array.isArray(_config.history) ? [..._config.history] : [];

  /** @type {number} */
  let _sessionCount = _history.length;

  /** @type {function(): number} */
  const _random = _config.seed
    ? _createSeededRng(_config.seed)
    : Math.random.bind(Math);

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Box-Muller transform for gaussian random numbers.
   * Generates a normally distributed random number with given mean and sigma.
   *
   * @param {number} mean - Mean of the distribution
   * @param {number} sigma - Standard deviation
   * @returns {number} Gaussian random number
   */
  function _gaussianRandom(mean, sigma) {
    const u1 = _random();
    const u2 = _random();
    // Avoid log(0)
    const safe_u1 = u1 < 1e-10 ? 1e-10 : u1;
    const z = Math.sqrt(-2 * Math.log(safe_u1)) * Math.cos(2 * Math.PI * u2);
    return mean + sigma * z;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Applies gaussian noise to trait weight values.
   *
   * Each value receives independent gaussian noise (mean=0, sigma=_sigma).
   * Results are clamped to [0, 1]. Does not mutate input.
   *
   * @param {Record<string, number>} traitWeights - Trait name -> weight mapping
   * @returns {Record<string, number>} New object with variance-adjusted weights
   */
  function applyVariance(traitWeights) {
    const result = {};

    for (const [trait, weight] of Object.entries(traitWeights)) {
      const noise = _gaussianRandom(0, _sigma);
      const adjusted = weight + noise;
      // Clamp to [0, 1]
      result[trait] = Math.max(0, Math.min(1, adjusted));
    }

    return result;
  }

  /**
   * Returns current engine state for persistence.
   *
   * @returns {{ sigma: number, history: Array<Object>, sessionCount: number }}
   */
  function getState() {
    return {
      sigma: _sigma,
      history: [..._history],
      sessionCount: _sessionCount,
    };
  }

  /**
   * Evolves the entropy engine based on session outcome quality.
   *
   * Placeholder for REM consolidation integration. Adjusts sigma:
   * - quality > 0.7: reduce sigma by 2% (converging toward good states)
   * - quality < 0.3: increase sigma by 2% (exploring away from bad states)
   * - otherwise: no change
   *
   * Sigma is clamped to [0.01, 0.15].
   *
   * @param {Object} sessionOutcome - Session outcome data
   * @param {number} sessionOutcome.quality - Outcome quality 0.0-1.0
   */
  function evolve(sessionOutcome) {
    _history.push(sessionOutcome);
    _sessionCount++;

    if (sessionOutcome.quality > 0.7) {
      _sigma *= 0.98; // Reduce by 2%
    } else if (sessionOutcome.quality < 0.3) {
      _sigma *= 1.02; // Increase by 2%
    }

    // Clamp sigma to valid range
    _sigma = Math.max(0.01, Math.min(0.15, _sigma));
  }

  return {
    applyVariance,
    getState,
    evolve,
  };
}

module.exports = { createEntropyEngine };
