'use strict';

/**
 * Full REM pipeline (Tier 3) -- 8-step editorial orchestrator.
 *
 * Per REM-03: Tier 3 full REM runs the complete editorial pipeline on
 * session end. No time pressure (D-05), deep editorial pass with the
 * complete session arc available.
 *
 * Pipeline steps:
 * 1. Retroactive evaluation: evaluate fragments against completed session arc
 * 2. Sublimation triage: cap sublimation promotions per session
 * 3. Editorial pass: entity dedup, domain merge, weight updates
 * 4. Conditioning update: EMA updates for attention_biases, sublimation_sensitivity, etc.
 * 5. Quality evaluation: behavioral + LLM composite score -> entropy engine adjustment
 *
 * Per REM-07: Nothing enters long-term storage without passing through REM.
 * This module is one of only two promotion paths (the other being
 * provisional-rem.cjs which delegates to the same pipeline).
 *
 * Design: The orchestrator does NOT call the LLM directly. Each sub-component
 * uses the prompt/apply pattern. The caller (Secondary Mind) feeds prompts to
 * LLM and passes responses via the llmResponses parameter.
 *
 * @module reverie/components/rem/full-rem
 */

const { REM_DEFAULTS, CONDITIONING_DEFAULTS } = require('../../lib/constants.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Full REM pipeline instance.
 *
 * @param {Object} dependencies - Injected dependencies
 * @param {Object} dependencies.retroactiveEvaluator - Retroactive evaluator instance
 * @param {Object} dependencies.editorialPass - Editorial pass instance
 * @param {Object} dependencies.conditioningUpdater - Conditioning updater instance
 * @param {Object} dependencies.qualityEvaluator - Quality evaluator instance
 * @param {Object} dependencies.selfModel - Self Model manager instance
 * @param {Object} [dependencies.journal] - Journal provider (for fragment reads)
 * @param {Object} [dependencies.wire] - Wire service
 * @param {Object} [dependencies.switchboard] - Switchboard for event emission
 * @param {Object} [dependencies.config] - Configuration overrides
 * @returns {Readonly<{ run: Function }>}
 */
function createFullRem(dependencies) {
  const deps = dependencies || {};
  const _retroactiveEvaluator = deps.retroactiveEvaluator;
  const _editorialPass = deps.editorialPass;
  const _conditioningUpdater = deps.conditioningUpdater;
  const _qualityEvaluator = deps.qualityEvaluator;
  const _selfModel = deps.selfModel;
  const _journal = deps.journal || null;
  const _wire = deps.wire || null;
  const _switchboard = deps.switchboard || null;
  const _config = deps.config || {};
  const _taxonomyGovernor = deps.taxonomyGovernor || null;

  // Configuration with defaults
  const _maxConsolidated = typeof _config.max_consolidated_per_session === 'number'
    ? _config.max_consolidated_per_session
    : REM_DEFAULTS.max_consolidated_per_session;
  const _sublimationTriageCap = typeof _config.sublimation_triage_cap === 'number'
    ? _config.sublimation_triage_cap
    : REM_DEFAULTS.sublimation_triage_cap;
  const _timeBudget = typeof _config.rem_time_budget_ms === 'number'
    ? _config.rem_time_budget_ms
    : REM_DEFAULTS.rem_time_budget_ms;
  const _identityMinSessions = typeof _config.identity_min_sessions === 'number'
    ? _config.identity_min_sessions
    : CONDITIONING_DEFAULTS.identity_min_sessions;
  const _identityFloor = typeof _config.identity_floor === 'number'
    ? _config.identity_floor
    : CONDITIONING_DEFAULTS.identity_floor;
  const _diversityThreshold = typeof _config.diversity_threshold === 'number'
    ? _config.diversity_threshold
    : CONDITIONING_DEFAULTS.diversity_threshold;

  // -------------------------------------------------------------------------
  // Time budget helper
  // -------------------------------------------------------------------------

  /**
   * Checks if the time budget has been exceeded.
   *
   * @param {number} startTime - Pipeline start time (Date.now())
   * @returns {boolean} True if budget exceeded
   */
  function _isTimeBudgetExceeded(startTime) {
    return (Date.now() - startTime) >= _timeBudget;
  }

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  /**
   * Runs the complete Tier 3 REM pipeline.
   *
   * @param {string} sessionSummary - Summary of the completed session arc
   * @param {Array<Object>} fragments - Session fragments to evaluate
   * @param {Array<Object>} recallEvents - Recall events from the session
   * @param {Object} sessionMetrics - Session engagement metrics
   * @param {Object} domainData - Domain data for editorial pass
   * @param {Object} llmResponses - Pre-computed LLM responses
   * @param {string} llmResponses.llmEvalResponse - LLM evaluation response
   * @param {string} [llmResponses.llmMetaRecallResponse] - LLM meta-recall response
   * @param {string} llmResponses.llmEditorialResponse - LLM editorial response
   * @param {number|null} llmResponses.llmQualityScore - LLM quality score
   * @returns {Promise<Object>} Pipeline results
   */
  async function run(sessionSummary, fragments, recallEvents, sessionMetrics, domainData, llmResponses) {
    const startTime = Date.now();
    const responses = llmResponses || {};
    const skipped = [];

    const result = {
      promoted: 0,
      discarded: 0,
      sublimation_promoted: 0,
      meta_recalls_created: 0,
      entities_deduped: 0,
      weights_updated: 0,
      domains_merged: 0,
      domains_split: 0,      // Phase 12
      domains_retired: 0,    // Phase 12
      conditioning_updated: false,
      quality_score: 0,
      timed_out: false,
      skipped_steps: [],
    };

    // ---------------------------------------------------------------------
    // Step 1: Retroactive evaluation
    // ---------------------------------------------------------------------
    let evalResult = null;
    try {
      const evaluation = _retroactiveEvaluator.evaluate(
        sessionSummary,
        fragments,
        recallEvents
      );

      evalResult = await evaluation.apply(
        responses.llmEvalResponse,
        responses.llmMetaRecallResponse
      );

      result.promoted = evalResult.promoted;
      result.discarded = evalResult.discarded;
      result.meta_recalls_created = evalResult.meta_recalls_created;
    } catch (error) {
      skipped.push('retroactive_evaluation: ' + (error.message || 'unknown error'));
    }

    // Check time budget after step 1
    if (_isTimeBudgetExceeded(startTime)) {
      result.timed_out = true;
      result.skipped_steps = ['sublimation_triage', 'editorial_pass', 'conditioning_update', 'quality_evaluation'];
      _emitComplete(result);
      return result;
    }

    // ---------------------------------------------------------------------
    // Step 2: Sublimation triage
    // ---------------------------------------------------------------------
    try {
      // Count sublimation-type fragments among promoted
      const promotedFragments = (evalResult && evalResult._promotedFragments) || [];
      const sublimationPromoted = promotedFragments.filter(f => f.type === 'sublimation');

      if (sublimationPromoted.length > _sublimationTriageCap) {
        // Keep top sublimation_triage_cap, excess are discarded
        result.sublimation_promoted = _sublimationTriageCap;
        result.discarded += (sublimationPromoted.length - _sublimationTriageCap);
        // Adjust total promoted count
        result.promoted -= (sublimationPromoted.length - _sublimationTriageCap);
      } else {
        result.sublimation_promoted = sublimationPromoted.length;
      }
    } catch (error) {
      skipped.push('sublimation_triage: ' + (error.message || 'unknown error'));
    }

    // Enforce max_consolidated_per_session cap
    if (result.promoted > _maxConsolidated) {
      const excess = result.promoted - _maxConsolidated;
      result.discarded += excess;
      result.promoted = _maxConsolidated;
    }

    // Check time budget after step 2
    if (_isTimeBudgetExceeded(startTime)) {
      result.timed_out = true;
      result.skipped_steps = ['editorial_pass', 'conditioning_update', 'quality_evaluation'];
      _emitComplete(result);
      return result;
    }

    // ---------------------------------------------------------------------
    // Step 3: Editorial pass (with Phase 12 taxonomy governance)
    // ---------------------------------------------------------------------
    try {
      const domainPairs = (domainData && domainData.domainPairs) || [];
      const entityList = (domainData && domainData.entityList) || [];
      const associationStats = (domainData && domainData.associationStats) || [];

      // Phase 12: Compute cap pressure for taxonomy governance (FRG-07)
      var capPressure = null;
      if (_taxonomyGovernor) {
        // Query current counts from domainData (already loaded by rem-consolidator)
        var _domainCount = (domainData && typeof domainData.domainCount === 'number')
          ? domainData.domainCount
          : domainPairs.length;
        var _maxEntityCount = (domainData && typeof domainData.maxEntityCount === 'number')
          ? domainData.maxEntityCount
          : 0;
        var _edgeCount = (domainData && typeof domainData.edgeCount === 'number')
          ? domainData.edgeCount
          : associationStats.length;

        // Compute cap pressure
        capPressure = _taxonomyGovernor.computeCapPressure(_domainCount, _maxEntityCount, _edgeCount);

        // Add pressure gradient text
        capPressure.pressureText = _taxonomyGovernor.getPressureGradientText(capPressure);

        // Identify split candidates (domains with fragment_count >= threshold)
        var _domains = (domainData && domainData.domains) || [];
        capPressure.splitCandidates = _taxonomyGovernor.identifySplitCandidates(_domains);

        // Identify retire candidates (domains inactive for N+ consecutive REM cycles)
        var _inactiveCycleMap = (domainData && domainData.inactiveCycleMap) || new Map();
        capPressure.retireCandidates = _taxonomyGovernor.identifyRetireCandidates(_domains, _inactiveCycleMap);
      }

      // Pass capPressure to editorial pass (4th argument, optional for backward compat)
      const editorial = _editorialPass.run(domainPairs, entityList, associationStats, capPressure);
      const editorialResult = await editorial.apply(responses.llmEditorialResponse);

      result.entities_deduped = editorialResult.entities_deduped || 0;
      result.weights_updated = editorialResult.weights_updated || 0;
      result.domains_merged = editorialResult.domains_merged || 0;
      // Phase 12: Track split/retire counts
      result.domains_split = editorialResult.splits_applied || 0;
      result.domains_retired = editorialResult.retirements_applied || 0;
    } catch (error) {
      skipped.push('editorial_pass: ' + (error.message || 'unknown error'));
    }

    // Check time budget after step 3
    if (_isTimeBudgetExceeded(startTime)) {
      result.timed_out = true;
      result.skipped_steps = ['conditioning_update', 'quality_evaluation'];
      _emitComplete(result);
      return result;
    }

    // ---------------------------------------------------------------------
    // Step 4: Conditioning update
    // ---------------------------------------------------------------------
    try {
      // Get current conditioning from Self Model
      const currentConditioningResult = _selfModel.getAspect('conditioning');
      const currentConditioning = (currentConditioningResult && currentConditioningResult.ok)
        ? currentConditioningResult.value
        : { attention_biases: {}, sublimation_sensitivity: {}, recall_strategies: [], error_history: [] };

      // Build session evidence from pipeline results
      const sessionEvidence = {
        attention_biases: _buildAttentionEvidence(fragments, domainData),
        sublimation_sensitivity: _buildSublimationEvidence(result),
        recall_strategies: _buildRecallEvidence(recallEvents),
        error_history: [],
      };

      // Update conditioning via EMA
      const updatedConditioning = _conditioningUpdater.updateConditioning(
        currentConditioning,
        sessionEvidence,
        _config
      );

      // Persist updated conditioning
      _conditioningUpdater.persistConditioning(updatedConditioning);
      result.conditioning_updated = true;

      // Identity core review (only after sufficient sessions)
      const sessionCount = typeof _selfModel.getSessionCount === 'function'
        ? _selfModel.getSessionCount()
        : 0;

      if (sessionCount >= _identityMinSessions) {
        const identityCoreResult = _selfModel.getAspect('identity-core');
        const identityCore = (identityCoreResult && identityCoreResult.ok)
          ? identityCoreResult.value
          : {};

        // Enforce floors
        const floored = _conditioningUpdater.enforceIdentityFloors(identityCore, _identityFloor);

        // Check diversity
        const diversity = _conditioningUpdater.checkDiversityThreshold(floored, _diversityThreshold);
        if (diversity.belowThreshold) {
          const boosted = _conditioningUpdater.boostUnderrepresented(floored, 0.02);
          _selfModel.setAspect('identity-core', boosted);
        } else {
          _selfModel.setAspect('identity-core', floored);
        }
      }
    } catch (error) {
      skipped.push('conditioning_update: ' + (error.message || 'unknown error'));
    }

    // Check time budget after step 4
    if (_isTimeBudgetExceeded(startTime)) {
      result.timed_out = true;
      result.skipped_steps = ['quality_evaluation'];
      _emitComplete(result);
      return result;
    }

    // ---------------------------------------------------------------------
    // Step 5: Quality evaluation
    // ---------------------------------------------------------------------
    try {
      const qualityResult = _qualityEvaluator.evaluateSession(
        sessionMetrics,
        responses.llmQualityScore || null
      );
      result.quality_score = qualityResult.quality_score;
    } catch (error) {
      skipped.push('quality_evaluation: ' + (error.message || 'unknown error'));
    }

    // Record any skipped steps from errors
    result.skipped_steps = skipped;

    // Emit completion event
    _emitComplete(result);

    return result;
  }

  // -------------------------------------------------------------------------
  // Evidence builders
  // -------------------------------------------------------------------------

  /**
   * Builds attention bias evidence from session fragments and domain data.
   *
   * @param {Array<Object>} fragments - Session fragments
   * @param {Object} domainData - Domain data
   * @returns {Object} Attention bias evidence record
   */
  function _buildAttentionEvidence(fragments, domainData) {
    const evidence = {};
    for (const frag of (fragments || [])) {
      const domains = (frag.associations && frag.associations.domains) || [];
      for (const domain of domains) {
        evidence[domain] = (evidence[domain] || 0) + 0.1;
      }
    }
    // Normalize to [0, 1]
    const maxVal = Math.max(...Object.values(evidence), 0.01);
    for (const key of Object.keys(evidence)) {
      evidence[key] = Math.min(1, evidence[key] / maxVal);
    }
    return evidence;
  }

  /**
   * Builds sublimation sensitivity evidence from triage results.
   *
   * @param {Object} triageResult - Sublimation triage result
   * @returns {Object} Sublimation sensitivity evidence record
   */
  function _buildSublimationEvidence(triageResult) {
    // Signal-to-noise ratio feeds into sublimation sensitivity
    const promoted = triageResult.sublimation_promoted || 0;
    const total = promoted + (triageResult.discarded || 0);
    const ratio = total > 0 ? promoted / total : 0.5;
    return { signal_noise_ratio: ratio };
  }

  /**
   * Builds recall strategy evidence from session recall events.
   *
   * @param {Array<Object>} recallEvents - Session recall events
   * @returns {Array<Object>} Recall strategy evidence
   */
  function _buildRecallEvidence(recallEvents) {
    if (!recallEvents || recallEvents.length === 0) {
      return [];
    }
    // Group by trigger type and score by incorporation rate
    const byTrigger = {};
    for (const evt of recallEvents) {
      const trigger = evt.trigger || 'unknown';
      if (!byTrigger[trigger]) {
        byTrigger[trigger] = { total: 0, incorporated: 0 };
      }
      byTrigger[trigger].total++;
      if (evt.incorporated) {
        byTrigger[trigger].incorporated++;
      }
    }
    return Object.entries(byTrigger).map(([id, data]) => ({
      id,
      score: data.total > 0 ? data.incorporated / data.total : 0,
    }));
  }

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  /**
   * Emits the tier3-complete event with pipeline results.
   *
   * @param {Object} result - Pipeline results
   */
  function _emitComplete(result) {
    if (_switchboard) {
      _switchboard.emit('reverie:rem:tier3-complete', {
        promoted: result.promoted,
        discarded: result.discarded,
        meta_recalls_created: result.meta_recalls_created,
        entities_deduped: result.entities_deduped,
        conditioning_updated: result.conditioning_updated,
        quality_score: result.quality_score,
        timed_out: result.timed_out,
      });
    }
  }

  return Object.freeze({ run });
}

module.exports = { createFullRem };
