'use strict';

/**
 * Conditioning updater for Self Model EMA-based conditioning updates.
 *
 * Implements SM-04 and REM-06: conditioning fields (attention_biases,
 * sublimation_sensitivity, recall_strategies, error_history) update via
 * exponential moving average (EMA) accumulation so single sessions never
 * dominate. Identity Core hard floors (D-11) prevent personality collapse.
 * Diversity monitoring (Pitfall 13) boosts underrepresented traits.
 *
 * @module reverie/components/rem/conditioning-updater
 */

const { CONDITIONING_DEFAULTS } = require('../../lib/constants.cjs');

// ---------------------------------------------------------------------------
// Pure math functions
// ---------------------------------------------------------------------------

/**
 * Scalar exponential moving average.
 *
 * Formula: currentValue * (1 - alpha) + sessionEvidence * alpha
 *
 * @param {number} currentValue - Current accumulated value
 * @param {number} sessionEvidence - New session evidence value
 * @param {number} alpha - EMA alpha (0.0-1.0), higher = more weight on session
 * @returns {number} Updated EMA value
 */
function emaUpdate(currentValue, sessionEvidence, alpha) {
  return currentValue * (1 - alpha) + sessionEvidence * alpha;
}

/**
 * Record-level EMA: applies emaUpdate per key across two records.
 *
 * - Keys present in both: EMA applied
 * - Keys only in sessionEvidence: defaults current to 0.5 (midpoint)
 * - Keys only in current: preserved unchanged
 *
 * @param {Record<string, number>} current - Current record values
 * @param {Record<string, number>} sessionEvidence - Session evidence record
 * @param {number} alpha - EMA alpha
 * @returns {Record<string, number>} Updated record (new object)
 */
function emaUpdateRecord(current, sessionEvidence, alpha) {
  const result = {};

  // Preserve all current keys
  for (const key of Object.keys(current)) {
    if (key in sessionEvidence) {
      result[key] = emaUpdate(current[key], sessionEvidence[key], alpha);
    } else {
      result[key] = current[key];
    }
  }

  // Add new keys from session evidence with default current of 0.5
  for (const key of Object.keys(sessionEvidence)) {
    if (!(key in current)) {
      result[key] = emaUpdate(0.5, sessionEvidence[key], alpha);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Conditioning field updaters
// ---------------------------------------------------------------------------

/**
 * Merges recall strategy arrays with EMA on matching strategy scores.
 *
 * For matching strategy IDs: EMA the score.
 * For new strategies: add with session score.
 * Caps array length at maxStrategies.
 *
 * @param {Array<Object>} current - Current recall strategies
 * @param {Array<Object>} sessionStrategies - Session recall strategies
 * @param {number} alpha - EMA alpha
 * @param {number} maxStrategies - Maximum strategies to retain
 * @returns {Array<Object>} Updated strategies array
 */
function updateRecallStrategies(current, sessionStrategies, alpha, maxStrategies) {
  const currentMap = new Map();
  for (const strat of current) {
    currentMap.set(strat.id, { ...strat });
  }

  for (const sessionStrat of sessionStrategies) {
    if (currentMap.has(sessionStrat.id)) {
      const existing = currentMap.get(sessionStrat.id);
      existing.score = emaUpdate(existing.score, sessionStrat.score, alpha);
      // Merge any new properties from session
      for (const key of Object.keys(sessionStrat)) {
        if (key !== 'id' && key !== 'score' && sessionStrat[key] !== undefined) {
          existing[key] = sessionStrat[key];
        }
      }
    } else {
      currentMap.set(sessionStrat.id, { ...sessionStrat });
    }
  }

  const result = Array.from(currentMap.values());

  // Cap at max, keeping highest-scored strategies
  if (result.length > maxStrategies) {
    result.sort((a, b) => (b.score || 0) - (a.score || 0));
    return result.slice(0, maxStrategies);
  }

  return result;
}

/**
 * Appends session errors to error history, trimming from front if over limit.
 *
 * @param {Array<Object>} current - Current error history
 * @param {Array<Object>} sessionErrors - New session errors
 * @param {number} maxHistory - Maximum error history entries
 * @returns {Array<Object>} Updated error history
 */
function appendErrors(current, sessionErrors, maxHistory) {
  const combined = [...current, ...sessionErrors];
  if (combined.length > maxHistory) {
    return combined.slice(combined.length - maxHistory);
  }
  return combined;
}

// ---------------------------------------------------------------------------
// Identity Core protection
// ---------------------------------------------------------------------------

/**
 * Extracts all numeric trait values from identity core for analysis.
 *
 * @param {Object} identityCore - Identity core data
 * @returns {Array<{ source: string, key: string, value: number }>} Flat list of trait values
 */
function _extractTraitValues(identityCore) {
  const values = [];

  if (identityCore.personality_traits) {
    for (const [key, val] of Object.entries(identityCore.personality_traits)) {
      if (typeof val === 'number') {
        values.push({ source: 'personality_traits', key, value: val });
      }
    }
  }

  if (identityCore.communication_style) {
    for (const [key, val] of Object.entries(identityCore.communication_style)) {
      if (typeof val === 'number') {
        values.push({ source: 'communication_style', key, value: val });
      }
    }
  }

  if (Array.isArray(identityCore.value_orientations)) {
    for (let i = 0; i < identityCore.value_orientations.length; i++) {
      const vo = identityCore.value_orientations[i];
      if (vo && typeof vo.weight === 'number') {
        values.push({ source: 'value_orientations', key: String(i), value: vo.weight });
      }
    }
  }

  return values;
}

/**
 * Enforces hard floors on identity core trait values per D-11.
 *
 * Clamps numeric values below `floor` to `floor` for identity core fields:
 * personality_traits, communication_style, value_orientations (weight).
 * Does NOT touch conditioning fields (attention_biases, etc.).
 *
 * @param {Object} identityCore - Identity core data (personality_traits, communication_style, value_orientations)
 * @param {number} floor - Minimum trait value (default 0.1)
 * @returns {Object} New identity core with floors enforced
 */
function enforceIdentityFloors(identityCore, floor) {
  const result = {};

  if (identityCore.personality_traits) {
    result.personality_traits = {};
    for (const [key, val] of Object.entries(identityCore.personality_traits)) {
      result.personality_traits[key] = typeof val === 'number' && val < floor ? floor : val;
    }
  }

  if (identityCore.communication_style) {
    result.communication_style = {};
    for (const [key, val] of Object.entries(identityCore.communication_style)) {
      result.communication_style[key] = typeof val === 'number' && val < floor ? floor : val;
    }
  }

  if (Array.isArray(identityCore.value_orientations)) {
    result.value_orientations = identityCore.value_orientations.map(vo => {
      if (vo && typeof vo.weight === 'number' && vo.weight < floor) {
        return { ...vo, weight: floor };
      }
      return { ...vo };
    });
  } else {
    result.value_orientations = identityCore.value_orientations;
  }

  return result;
}

/**
 * Checks whether trait diversity has dropped below threshold.
 *
 * Computes variance of all numeric trait values from identity core.
 *
 * @param {Object} identityCore - Identity core data
 * @param {number} threshold - Diversity threshold
 * @returns {{ belowThreshold: boolean, variance: number }}
 */
function checkDiversityThreshold(identityCore, threshold) {
  const traitValues = _extractTraitValues(identityCore);

  if (traitValues.length === 0) {
    return { belowThreshold: true, variance: 0 };
  }

  const values = traitValues.map(t => t.value);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;

  return {
    belowThreshold: variance < threshold,
    variance,
  };
}

/**
 * Boosts the lowest trait values to prevent personality collapse per Pitfall 13.
 *
 * Finds the bottom quartile of trait values and boosts each by `amount`.
 * Does not mutate input.
 *
 * @param {Object} identityCore - Identity core data
 * @param {number} amount - Boost amount (e.g. 0.02)
 * @returns {Object} New identity core with lowest traits boosted
 */
function boostUnderrepresented(identityCore, amount) {
  const traitValues = _extractTraitValues(identityCore);

  if (traitValues.length === 0) {
    return { ...identityCore };
  }

  // Sort ascending to find lowest
  const sorted = [...traitValues].sort((a, b) => a.value - b.value);
  const boostCount = Math.max(1, Math.floor(sorted.length / 4));
  const boostSet = new Set(sorted.slice(0, boostCount).map(t => `${t.source}:${t.key}`));

  const result = {};

  if (identityCore.personality_traits) {
    result.personality_traits = {};
    for (const [key, val] of Object.entries(identityCore.personality_traits)) {
      if (typeof val === 'number' && boostSet.has(`personality_traits:${key}`)) {
        result.personality_traits[key] = Math.min(1, val + amount);
      } else {
        result.personality_traits[key] = val;
      }
    }
  }

  if (identityCore.communication_style) {
    result.communication_style = {};
    for (const [key, val] of Object.entries(identityCore.communication_style)) {
      if (typeof val === 'number' && boostSet.has(`communication_style:${key}`)) {
        result.communication_style[key] = Math.min(1, val + amount);
      } else {
        result.communication_style[key] = val;
      }
    }
  }

  if (Array.isArray(identityCore.value_orientations)) {
    result.value_orientations = identityCore.value_orientations.map((vo, i) => {
      if (vo && typeof vo.weight === 'number' && boostSet.has(`value_orientations:${i}`)) {
        return { ...vo, weight: Math.min(1, vo.weight + amount) };
      }
      return { ...vo };
    });
  } else {
    result.value_orientations = identityCore.value_orientations;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a conditioning updater instance.
 *
 * @param {Object} [options] - Configuration options
 * @param {Object} [options.selfModel] - Self Model manager instance (for persistence)
 * @param {Object} [options.config] - Configuration overrides
 * @param {number} [options.config.ema_alpha] - EMA alpha (default from CONDITIONING_DEFAULTS)
 * @param {number} [options.config.max_error_history] - Max error history entries
 * @param {number} [options.config.max_recall_strategies] - Max recall strategies retained
 * @returns {Object} Frozen conditioning updater API
 */
function createConditioningUpdater(options) {
  const opts = options || {};
  const selfModel = opts.selfModel || null;
  const config = opts.config || {};

  const emaAlpha = typeof config.ema_alpha === 'number' ? config.ema_alpha : CONDITIONING_DEFAULTS.ema_alpha;
  const maxErrorHistory = typeof config.max_error_history === 'number' ? config.max_error_history : CONDITIONING_DEFAULTS.max_error_history;
  const maxRecallStrategies = typeof config.max_recall_strategies === 'number' ? config.max_recall_strategies : 20;

  /**
   * Orchestrates EMA updates for all conditioning fields.
   *
   * @param {Object} currentConditioning - Current conditioning state
   * @param {Object} sessionEvidence - Session evidence for updates
   * @param {Object} [overrideConfig] - Optional per-call config overrides
   * @returns {Object} Updated conditioning object
   */
  function updateConditioning(currentConditioning, sessionEvidence, overrideConfig) {
    const alpha = (overrideConfig && typeof overrideConfig.ema_alpha === 'number')
      ? overrideConfig.ema_alpha
      : emaAlpha;

    const maxErrors = (overrideConfig && typeof overrideConfig.max_error_history === 'number')
      ? overrideConfig.max_error_history
      : maxErrorHistory;

    const result = {};

    // attention_biases: record EMA
    result.attention_biases = emaUpdateRecord(
      currentConditioning.attention_biases || {},
      sessionEvidence.attention_biases || {},
      alpha
    );

    // sublimation_sensitivity: record EMA
    result.sublimation_sensitivity = emaUpdateRecord(
      currentConditioning.sublimation_sensitivity || {},
      sessionEvidence.sublimation_sensitivity || {},
      alpha
    );

    // association_priors: record EMA (if present)
    result.association_priors = emaUpdateRecord(
      currentConditioning.association_priors || {},
      sessionEvidence.association_priors || {},
      alpha
    );

    // recall_strategies: merge with EMA on scores
    result.recall_strategies = updateRecallStrategies(
      currentConditioning.recall_strategies || [],
      sessionEvidence.recall_strategies || [],
      alpha,
      maxRecallStrategies
    );

    // error_history: append and cap
    result.error_history = appendErrors(
      currentConditioning.error_history || [],
      sessionEvidence.error_history || [],
      maxErrors
    );

    return result;
  }

  /**
   * Persists updated conditioning via Self Model setAspect.
   *
   * @param {Object} updatedConditioning - Updated conditioning data
   * @returns {{ ok: boolean, value?: Object, error?: Object }}
   */
  function persistConditioning(updatedConditioning) {
    if (!selfModel) {
      return { ok: false, error: { code: 'NO_SELF_MODEL', message: 'Self Model not provided' } };
    }
    return selfModel.setAspect('conditioning', updatedConditioning);
  }

  return Object.freeze({
    updateConditioning,
    enforceIdentityFloors,
    checkDiversityThreshold,
    boostUnderrepresented,
    persistConditioning,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createConditioningUpdater,
  emaUpdate,
  emaUpdateRecord,
};
