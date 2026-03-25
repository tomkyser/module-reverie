'use strict';

/**
 * Deterministic decay computation for fragment survival scoring.
 *
 * Per spec Section 3.9: Fragments decay over time based on age, access
 * frequency, consolidation count, and Self Model relevance. When a
 * fragment's computed weight drops below the archive threshold (and it
 * is not pinned), it is eligible for archival.
 *
 * Formula:
 *   current_weight = initial_weight * relevance_factor * time_decay * access_bonus
 *
 * Where:
 *   lambda = base_decay_rate / (1 + consolidation_count * consolidation_protection)
 *   time_decay = exp(-lambda * daysSinceCreation)
 *   access_bonus = 1 + (log(1 + access_count) * access_weight)
 *   relevance_factor = sum(relevance[aspect] * weight[aspect])
 *
 * @module reverie/components/fragments/decay
 */

const { DECAY_DEFAULTS } = require('../../lib/constants.cjs');

/**
 * Computes the current decay weight for a fragment.
 *
 * The result is deterministic: same inputs always produce the same output.
 * The computation uses the fragment's creation timestamp (not last_accessed)
 * as the time reference for exponential decay.
 *
 * @param {Object} fragment - Fragment object with `created`, `decay`, and `associations` fields
 * @param {string} fragment.created - ISO timestamp of fragment creation
 * @param {Object} fragment.decay - Decay state: initial_weight, access_count, consolidation_count
 * @param {Object} fragment.associations - Must contain self_model_relevance: { identity, relational, conditioning }
 * @param {Object} [config={}] - Optional overrides merged with DECAY_DEFAULTS
 * @returns {number} Computed weight (can exceed 1.0 due to access bonus)
 */
function computeDecay(fragment, config = {}) {
  const cfg = {
    ...DECAY_DEFAULTS,
    ...config,
    relevance_weights: {
      ...DECAY_DEFAULTS.relevance_weights,
      ...(config.relevance_weights || {}),
    },
  };

  const decay = fragment.decay;
  const relevance = fragment.associations.self_model_relevance;

  // Days since creation
  const daysSinceCreation = (Date.now() - new Date(fragment.created).getTime()) / (1000 * 60 * 60 * 24);

  // Lambda adjusted by consolidation protection
  // More consolidation cycles -> slower decay
  const lambda = cfg.base_decay_rate / (1 + decay.consolidation_count * cfg.consolidation_protection);

  // Time decay: exponential decay over days
  const timeDecay = Math.exp(-lambda * daysSinceCreation);

  // Access bonus: logarithmic reward for frequent access
  const accessBonus = 1 + (Math.log(1 + decay.access_count) * cfg.access_weight);

  // Relevance factor: weighted sum of Self Model aspect relevance
  const rw = cfg.relevance_weights;
  const relevanceFactor = (relevance.identity * rw.identity) +
                          (relevance.relational * rw.relational) +
                          (relevance.conditioning * rw.conditioning);

  return decay.initial_weight * relevanceFactor * timeDecay * accessBonus;
}

/**
 * Determines whether a fragment should be archived based on its computed
 * decay weight and pinned status.
 *
 * A fragment is archive-eligible when:
 * 1. Its computed weight is below the archive threshold, AND
 * 2. It is NOT pinned
 *
 * Pinned fragments are never archived regardless of their weight.
 *
 * @param {Object} fragment - Fragment object (same shape as computeDecay expects)
 * @param {Object} [config={}] - Optional overrides merged with DECAY_DEFAULTS
 * @returns {boolean} true if the fragment should be moved to archive
 */
function shouldArchive(fragment, config = {}) {
  const cfg = { ...DECAY_DEFAULTS, ...config };

  // Pinned fragments are never archived
  if (fragment.decay.pinned) {
    return false;
  }

  const weight = computeDecay(fragment, config);
  return weight < cfg.archive_threshold;
}

module.exports = { computeDecay, shouldArchive, DECAY_DEFAULTS };
