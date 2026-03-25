'use strict';

/**
 * Provisional REM (Tier 2) -- tentative promotion with abort-and-revert.
 *
 * Per REM-02: Tier 2 provisional REM triggers via heartbeat-based idle
 * detection (D-02). Runs the same pipeline as full REM but marks all
 * promotions as tentative until the batch completes.
 *
 * Per D-03: If user returns mid-Tier-2 (heartbeats resume), abort and revert.
 * Cancel provisional REM immediately, discard all tentative promotions,
 * fragments stay in working/. Clean state over partial consolidation.
 *
 * Per D-04: Tier 2 auto-promotes on completion. Once provisional REM finishes,
 * results ARE the consolidation -- no separate promotion step. Tentative
 * flags are removed, making promotions permanent.
 *
 * @module reverie/components/rem/provisional-rem
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Provisional REM instance wrapping full REM with tentative
 * promotion marking and abort-and-revert capability.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.fullRem - Full REM pipeline instance
 * @param {Object} [options.journal] - Journal provider
 * @param {Object} [options.wire] - Wire service
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Readonly<{ run: Function, abort: Function, isRunning: Function }>}
 */
function createProvisionalRem(options) {
  const opts = options || {};
  const _fullRem = opts.fullRem;
  const _journal = opts.journal || null;
  const _wire = opts.wire || null;
  const _switchboard = opts.switchboard || null;
  const _config = opts.config || {};

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  let _running = false;
  let _aborted = false;
  const _tentativeFragmentIds = [];

  // -------------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------------

  /**
   * Runs the provisional REM pipeline (same as full REM but with tentative
   * promotion marking).
   *
   * @param {string} sessionSummary - Summary of the completed session arc
   * @param {Array<Object>} fragments - Session fragments to evaluate
   * @param {Array<Object>} recallEvents - Recall events from the session
   * @param {Object} sessionMetrics - Session engagement metrics
   * @param {Object} domainData - Domain data for editorial pass
   * @param {Object} [llmResponses] - Pre-computed LLM responses
   * @returns {Promise<Object>} Pipeline results with auto_promoted/aborted flags
   */
  async function run(sessionSummary, fragments, recallEvents, sessionMetrics, domainData, llmResponses) {
    _running = true;
    _aborted = false;
    _tentativeFragmentIds.length = 0;

    // Track fragment IDs that would be promoted (tentative marking)
    for (const frag of (fragments || [])) {
      _tentativeFragmentIds.push(frag.id);
    }

    // Mark all fragments as tentative before processing
    // In a real scenario, this would update frontmatter via Journal
    // For now, we set a _tentative flag conceptually

    // Check if already aborted before starting
    if (_aborted) {
      _running = false;
      return _makeAbortedResult();
    }

    // Delegate to full REM pipeline
    let pipelineResult;
    try {
      pipelineResult = await _fullRem.run(
        sessionSummary,
        fragments,
        recallEvents,
        sessionMetrics,
        domainData,
        llmResponses
      );
    } catch (error) {
      _running = false;
      return _makeAbortedResult();
    }

    // Check if aborted during pipeline execution
    if (_aborted) {
      _running = false;
      return Object.assign({}, pipelineResult, {
        aborted: true,
        auto_promoted: false,
      });
    }

    // Auto-promote on completion (D-04): remove tentative flags
    // In a real scenario, this would clear _tentative flags in Journal frontmatter
    _tentativeFragmentIds.length = 0;
    _running = false;

    return Object.assign({}, pipelineResult, {
      aborted: false,
      auto_promoted: true,
    });
  }

  // -------------------------------------------------------------------------
  // Abort
  // -------------------------------------------------------------------------

  /**
   * Aborts the provisional REM pipeline and reverts all tentative promotions.
   *
   * Per D-03: Cancel immediately, discard all tentative promotions,
   * fragments stay in working/. Clean state over partial consolidation.
   *
   * @returns {{ ok: boolean, reverted: number }}
   */
  function abort() {
    _aborted = true;
    const revertedCount = _tentativeFragmentIds.length;

    // Revert tentative promotions
    // In a real scenario, this would:
    // - Move fragments back from active/ to working/ in Journal
    // - Update Ledger lifecycle back to 'working' via Wire
    // - Remove _tentative flags from frontmatter
    for (const fragmentId of _tentativeFragmentIds) {
      // Queue revert operations via Journal and Wire
      if (_journal && typeof _journal.move === 'function') {
        _journal.move(fragmentId, 'active', 'working');
      }
      if (_wire && typeof _wire.queueWrite === 'function') {
        _wire.queueWrite({
          type: 'write-intent',
          from: 'provisional-rem',
          to: 'ledger',
          payload: {
            table: 'fragment_decay',
            data: [{ fragment_id: fragmentId, lifecycle: 'working' }],
            operation: 'update',
          },
        });
      }
    }

    // Clear tentative tracking
    _tentativeFragmentIds.length = 0;

    // Emit abort event
    if (_switchboard) {
      _switchboard.emit('reverie:rem:tier2-aborted', {
        reverted: revertedCount,
      });
    }

    _running = false;

    return { ok: true, reverted: revertedCount };
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /**
   * Returns whether the provisional REM pipeline is currently running.
   *
   * @returns {boolean}
   */
  function isRunning() {
    return _running;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Creates a result object for an aborted pipeline.
   *
   * @returns {Object}
   */
  function _makeAbortedResult() {
    return {
      promoted: 0,
      discarded: 0,
      sublimation_promoted: 0,
      meta_recalls_created: 0,
      entities_deduped: 0,
      weights_updated: 0,
      domains_merged: 0,
      conditioning_updated: false,
      quality_score: 0,
      timed_out: false,
      skipped_steps: [],
      aborted: true,
      auto_promoted: false,
    };
  }

  return Object.freeze({ run, abort, isRunning });
}

module.exports = { createProvisionalRem };
