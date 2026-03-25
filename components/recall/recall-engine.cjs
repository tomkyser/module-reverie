'use strict';

/**
 * Recall engine orchestrator -- end-to-end fragment recall for both paths.
 *
 * Coordinates the full recall cycle:
 * 1. Build Assay-compatible query via query builder
 * 2. Search Assay for fragment candidates
 * 3. Rank candidates via composite scorer (same instance for both paths per D-12)
 * 4. Build recall output (nudge for passive, reconstruction for explicit)
 *
 * Two recall paths:
 * - Passive (recallPassive): Automatic, triggered during formation. Returns top 5
 *   fragments + nudge text (~100-200 tokens). Shades response without narrating.
 * - Explicit (recallExplicit): User-triggered. Returns top 15 fragments +
 *   reconstruction prompt (~500-1000 tokens). Full re-experiencing through
 *   current Self Model frame.
 *
 * Per D-12: Both paths use the SAME composite scorer instance.
 * Per D-11: Passive produces nudge text, explicit produces reconstruction.
 *
 * @module reverie/components/recall/recall-engine
 */

const { ok, err } = require('../../../../lib/result.cjs');
const { createCompositeScorer } = require('./composite-scorer.cjs');
const { createQueryBuilder } = require('./query-builder.cjs');
const { createReconstructionPrompt } = require('./reconstruction-prompt.cjs');

/**
 * Creates a recall engine instance with options-based DI.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.assay - Assay federated search service (required)
 * @param {Object} options.selfModel - Self Model manager (required)
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @returns {{ recallPassive: Function, recallExplicit: Function, getRecallStats: Function }}
 */
function createRecallEngine(options) {
  const opts = options || {};
  const assay = opts.assay;
  const selfModel = opts.selfModel;
  const switchboard = opts.switchboard;

  // Single shared instances per D-12
  const _scorer = createCompositeScorer({});
  const _queryBuilder = createQueryBuilder({});
  const _reconstructor = createReconstructionPrompt({});

  // Internal state
  let _totalRecalls = 0;
  let _passiveRecalls = 0;
  let _explicitRecalls = 0;

  // ---------------------------------------------------------------------------
  // recallPassive
  // ---------------------------------------------------------------------------

  /**
   * Performs passive recall -- automatic, low-cost, shading-only.
   *
   * Queries Assay with a tight passive query, ranks top 5 fragments,
   * and produces a nudge prompt for injection into subsequent turns.
   *
   * @param {Object} stimulus - Current turn stimulus
   * @param {string[]} stimulus.domains - Active domain labels
   * @param {string[]} stimulus.entities - Active entity references
   * @param {string[]} stimulus.attention_tags - Active attention tags
   * @param {string} stimulus.user_prompt - User's current prompt
   * @param {number} stimulus.turn_number - Current turn number
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{
   *   fragments: Array<{ fragment: Object, score: number }>,
   *   nudgePrompt: string|null,
   *   nudgeText: string|null
   * }>>}
   */
  async function recallPassive(stimulus) {
    const stim = stimulus || {};

    // 1. Build query
    const query = _queryBuilder.buildPassiveQuery(stim);

    // 2. Search Assay
    const searchResult = await assay.search(query);
    if (!searchResult.ok || !searchResult.value.results || searchResult.value.results.length === 0) {
      return ok({ fragments: [], nudgePrompt: null, nudgeText: null });
    }

    // 3. Extract query context for scorer
    const queryContext = _queryBuilder.extractQueryContext(stim, selfModel);

    // 4. Rank with composite scorer (top 5)
    const ranked = _scorer.rankFragments(searchResult.value.results, queryContext, 5);

    // 5. Build nudge prompt
    const nudgePrompt = _reconstructor.buildPassiveNudge(
      ranked.map(r => r.fragment),
      { user_prompt: stim.user_prompt, turn_number: stim.turn_number }
    );

    // 6. Track stats
    _totalRecalls++;
    _passiveRecalls++;

    // 7. Emit event
    if (switchboard) {
      switchboard.emit('reverie:recall:passive', { count: ranked.length });
    }

    return ok({ fragments: ranked, nudgePrompt, nudgeText: nudgePrompt });
  }

  // ---------------------------------------------------------------------------
  // recallExplicit
  // ---------------------------------------------------------------------------

  /**
   * Performs explicit recall -- user-triggered, full reconstruction.
   *
   * Queries Assay with a broad explicit query, ranks top 15 fragments,
   * and produces a reconstruction prompt framed through the current
   * Self Model perspective.
   *
   * @param {Object} conversationContext - Broader conversation context
   * @param {string[]} conversationContext.domains - Active domain labels
   * @param {string[]} conversationContext.entities - Active entity references
   * @param {string[]} conversationContext.attention_tags - Active attention tags
   * @param {string} conversationContext.user_prompt - User's current prompt
   * @param {number} conversationContext.turn_number - Current turn number
   * @param {string} [conversationContext.conversation_summary] - Summary of recent conversation
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{
   *   fragments: Array<{ fragment: Object, score: number }>,
   *   reconstructionPrompt: string|null
   * }>>}
   */
  async function recallExplicit(conversationContext) {
    const ctx = conversationContext || {};

    // 1. Build query
    const query = _queryBuilder.buildExplicitQuery(ctx);

    // 2. Search Assay
    const searchResult = await assay.search(query);
    if (!searchResult.ok || !searchResult.value.results || searchResult.value.results.length === 0) {
      return ok({ fragments: [], reconstructionPrompt: null });
    }

    // 3. Extract query context for scorer
    const queryContext = _queryBuilder.extractQueryContext(ctx, selfModel);

    // 4. Rank with composite scorer (top 15)
    const ranked = _scorer.rankFragments(searchResult.value.results, queryContext, 15);

    // 5. Get Self Model state for reconstruction framing
    const identity = selfModel.getAspect('identity-core');
    const relational = selfModel.getAspect('relational-model');
    const smContext = {
      identity_summary: identity ? identity.body : '',
      relational_summary: relational ? relational.body : '',
    };

    // 6. Build reconstruction prompt
    const reconstructionPrompt = _reconstructor.buildExplicitReconstruction(
      ranked.map(r => r.fragment),
      ctx,
      smContext
    );

    // 7. Track stats
    _totalRecalls++;
    _explicitRecalls++;

    // 8. Emit event
    if (switchboard) {
      switchboard.emit('reverie:recall:explicit', { count: ranked.length });
    }

    return ok({ fragments: ranked, reconstructionPrompt });
  }

  // ---------------------------------------------------------------------------
  // getRecallStats
  // ---------------------------------------------------------------------------

  /**
   * Returns recall statistics for the current engine instance.
   *
   * @returns {{ totalRecalls: number, passiveRecalls: number, explicitRecalls: number }}
   */
  function getRecallStats() {
    return {
      totalRecalls: _totalRecalls,
      passiveRecalls: _passiveRecalls,
      explicitRecalls: _explicitRecalls,
    };
  }

  return Object.freeze({
    recallPassive,
    recallExplicit,
    getRecallStats,
  });
}

module.exports = { createRecallEngine };
