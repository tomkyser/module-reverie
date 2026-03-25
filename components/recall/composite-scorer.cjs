'use strict';

/**
 * Composite scorer for fragment recall ranking.
 *
 * Implements a deterministic 6-factor weighted scoring function per Phase 9 D-12.
 * Both passive and explicit recall paths use the same scoring engine -- the
 * difference is trigger mechanism and output format, not scoring logic.
 *
 * Factors:
 * 1. Domain overlap -- intersection of fragment and query domains
 * 2. Entity co-occurrence -- intersection of fragment and query entities
 * 3. Attention tag match -- intersection of fragment and query attention tags
 * 4. Decay weight -- pre-computed fragment survival weight (from decay.cjs lifecycle)
 * 5. Self Model relevance -- weighted average of identity/relational/conditioning
 * 6. Temporal proximity -- exponential decay by days since fragment creation
 *
 * The scorer reads fragment.decay.current_weight directly (pre-computed by
 * FragmentWriter at write time, updated by decay.cjs during lifecycle transitions).
 * It does NOT call computeDecay() at scoring time.
 *
 * @module reverie/components/recall/composite-scorer
 */

const { SCORING_DEFAULTS } = require('../../lib/constants.cjs');

/**
 * Computes set intersection count between two arrays.
 *
 * @param {string[]} a - First array
 * @param {string[]} b - Second array
 * @returns {number} Count of elements present in both arrays
 */
function intersectionCount(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) {
    return 0;
  }
  const setB = new Set(b);
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (setB.has(a[i])) {
      count++;
    }
  }
  return count;
}

/**
 * Creates a composite scorer instance with configurable weights.
 *
 * @param {Object} [options] - Configuration options
 * @param {Object} [options.weights] - Custom weight overrides (defaults to SCORING_DEFAULTS)
 * @param {Object} [options.decayConfig] - Custom decay config (reserved for future use)
 * @returns {Readonly<{ compositeScore: Function, rankFragments: Function }>}
 */
function createCompositeScorer(options) {
  const opts = options || {};
  const weights = opts.weights || SCORING_DEFAULTS;

  /**
   * Computes a composite score for a single fragment against a query context.
   *
   * @param {Object} fragment - Fragment with associations, decay, and created fields
   * @param {Object} fragment.associations - Association metadata
   * @param {string[]} fragment.associations.domains - Fragment domain labels
   * @param {string[]} fragment.associations.entities - Fragment entity references
   * @param {string[]} fragment.associations.attention_tags - Fragment attention tags
   * @param {Object} [fragment.associations.self_model_relevance] - SMR scores per aspect
   * @param {Object} fragment.decay - Decay state
   * @param {number} fragment.decay.current_weight - Pre-computed decay weight (0-1)
   * @param {string} fragment.created - ISO timestamp of fragment creation
   * @param {Object} queryContext - Active query context
   * @param {string[]} queryContext.activeDomains - Currently active domains
   * @param {string[]} queryContext.activeEntities - Currently active entities
   * @param {string[]} queryContext.attentionTags - Currently active attention tags
   * @param {number} queryContext.referenceTime - Reference time in ms since epoch
   * @returns {number} Composite score in the 0-1 range
   */
  function compositeScore(fragment, queryContext) {
    const assoc = fragment.associations || {};
    const fragDomains = assoc.domains || [];
    const fragEntities = assoc.entities || [];
    const fragTags = assoc.attention_tags || [];
    const smr = assoc.self_model_relevance;

    const qDomains = queryContext.activeDomains || [];
    const qEntities = queryContext.activeEntities || [];
    const qTags = queryContext.attentionTags || [];

    // Factor 1: Domain overlap
    const domainMax = Math.max(fragDomains.length, qDomains.length);
    const domainOverlap = domainMax === 0 ? 0 : intersectionCount(fragDomains, qDomains) / domainMax;

    // Factor 2: Entity co-occurrence
    const entityMax = Math.max(fragEntities.length, qEntities.length);
    const entityCooccurrence = entityMax === 0 ? 0 : intersectionCount(fragEntities, qEntities) / entityMax;

    // Factor 3: Attention tag match
    const tagMax = Math.max(fragTags.length, qTags.length);
    const attentionTagMatch = tagMax === 0 ? 0 : intersectionCount(fragTags, qTags) / tagMax;

    // Factor 4: Decay weight (pre-computed, capped at 1.0)
    const decay = fragment.decay || {};
    const decayWeight = Math.min(typeof decay.current_weight === 'number' ? decay.current_weight : 0, 1.0);

    // Factor 5: Self Model relevance (weighted average per DECAY_DEFAULTS.relevance_weights)
    let selfModelRelevance = 0;
    if (smr && typeof smr === 'object') {
      const id = typeof smr.identity === 'number' ? smr.identity : 0;
      const rel = typeof smr.relational === 'number' ? smr.relational : 0;
      const cond = typeof smr.conditioning === 'number' ? smr.conditioning : 0;
      selfModelRelevance = id * 0.3 + rel * 0.5 + cond * 0.2;
    }

    // Factor 6: Temporal proximity (exponential decay by days)
    let temporalProximity = 1.0;
    if (fragment.created && queryContext.referenceTime) {
      const createdMs = new Date(fragment.created).getTime();
      const daysDiff = Math.abs(queryContext.referenceTime - createdMs) / 86400000;
      temporalProximity = Math.exp(-0.1 * daysDiff);
    }

    // Weighted sum
    const score =
      weights.domain_overlap * domainOverlap +
      weights.entity_cooccurrence * entityCooccurrence +
      weights.attention_tag_match * attentionTagMatch +
      weights.decay_weight * decayWeight +
      weights.self_model_relevance * selfModelRelevance +
      weights.temporal_proximity * temporalProximity;

    return score;
  }

  /**
   * Ranks an array of fragments by composite score, returning the top N.
   *
   * @param {Object[]} fragments - Array of fragment objects
   * @param {Object} queryContext - Active query context
   * @param {number} limit - Maximum number of results to return
   * @returns {Array<{ fragment: Object, score: number }>} Sorted descending by score
   */
  function rankFragments(fragments, queryContext, limit) {
    if (!fragments || fragments.length === 0) {
      return [];
    }

    const scored = [];
    for (let i = 0; i < fragments.length; i++) {
      scored.push({
        fragment: fragments[i],
        score: compositeScore(fragments[i], queryContext),
      });
    }

    scored.sort(function (a, b) {
      return b.score - a.score;
    });

    return scored.slice(0, limit);
  }

  return Object.freeze({
    compositeScore,
    rankFragments,
  });
}

module.exports = { createCompositeScorer };
