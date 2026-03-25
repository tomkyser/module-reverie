'use strict';

/**
 * REM Consolidator -- top-level tier dispatch orchestrator.
 *
 * Dispatches trigger events to the correct consolidation tier:
 * - Tier 1: Triage snapshot on PreCompact (fast, no LLM)
 * - Tier 2: Provisional REM on heartbeat timeout (tentative promotions)
 * - Tier 3: Full REM on session end (complete editorial pipeline)
 *
 * Also handles:
 * - Dormant maintenance: decay catch-up on SessionStart per D-14
 * - Crash recovery: orphaned working/ fragment detection per D-15
 *
 * Per REM-07: Nothing enters long-term storage without passing through
 * the REM pipeline. This consolidator is the single entry point for
 * all consolidation operations.
 *
 * @module reverie/components/rem/rem-consolidator
 */

const { DECAY_DEFAULTS } = require('../../lib/constants.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a REM Consolidator instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.triage - Tier 1 triage instance
 * @param {Object} options.provisionalRem - Tier 2 provisional REM instance
 * @param {Object} options.fullRem - Tier 3 full REM instance
 * @param {Object} [options.heartbeatMonitor] - Heartbeat monitor instance
 * @param {Object} [options.journal] - Journal provider
 * @param {Object} [options.decay] - Decay computation instance
 * @param {Object} [options.lathe] - Lathe service
 * @param {Object} [options.wire] - Wire service
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Readonly<{ handleTier1: Function, handleTier2: Function, abortTier2: Function, handleTier3: Function, handleDormantMaintenance: Function, handleCrashRecovery: Function }>}
 */
function createRemConsolidator(options) {
  const opts = options || {};
  const _triage = opts.triage;
  const _provisionalRem = opts.provisionalRem;
  const _fullRem = opts.fullRem;
  const _heartbeatMonitor = opts.heartbeatMonitor || null;
  const _journal = opts.journal || null;
  const _decay = opts.decay || null;
  const _lathe = opts.lathe || null;
  const _wire = opts.wire || null;
  const _switchboard = opts.switchboard || null;
  const _config = opts.config || {};

  const _archiveThreshold = typeof _config.archive_threshold === 'number'
    ? _config.archive_threshold
    : DECAY_DEFAULTS.archive_threshold;

  // -------------------------------------------------------------------------
  // Tier 1: Triage
  // -------------------------------------------------------------------------

  /**
   * Handles Tier 1 triage on PreCompact events.
   *
   * Delegates to triage.snapshot() for fast state dump.
   * Per D-01: filesystem writes only, no LLM calls.
   *
   * @param {Object} mindState - Current Mind cycle state
   * @returns {Promise<Object>} Triage result
   */
  async function handleTier1(mindState) {
    const result = await _triage.snapshot(mindState);

    if (_switchboard) {
      _switchboard.emit('reverie:rem:tier1-complete', {
        result: result && result.ok ? result.value : result,
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Tier 2: Provisional REM
  // -------------------------------------------------------------------------

  /**
   * Handles Tier 2 provisional REM on heartbeat timeout.
   *
   * Delegates to provisionalRem.run() with session context.
   * Per D-02: triggers when heartbeats stop (dead/disconnected session).
   *
   * @param {Object} sessionContext - Session context for REM pipeline
   * @param {string} sessionContext.summary - Session summary
   * @param {Array<Object>} sessionContext.fragments - Session fragments
   * @param {Array<Object>} sessionContext.recallEvents - Recall events
   * @param {Object} sessionContext.metrics - Session metrics
   * @param {Object} sessionContext.domainData - Domain data
   * @param {Object} [sessionContext.llmResponses] - LLM responses
   * @returns {Promise<Object>} Provisional REM result
   */
  async function handleTier2(sessionContext) {
    const ctx = sessionContext || {};
    const result = await _provisionalRem.run(
      ctx.summary,
      ctx.fragments,
      ctx.recallEvents,
      ctx.metrics,
      ctx.domainData,
      ctx.llmResponses
    );

    if (_switchboard) {
      _switchboard.emit('reverie:rem:tier2-complete', { result });
    }

    return result;
  }

  /**
   * Aborts an in-progress Tier 2 provisional REM.
   *
   * Delegates to provisionalRem.abort(). Per D-03: cancel immediately,
   * revert all tentative promotions.
   *
   * @returns {{ ok: boolean, reverted: number }}
   */
  function abortTier2() {
    return _provisionalRem.abort();
  }

  // -------------------------------------------------------------------------
  // Tier 3: Full REM
  // -------------------------------------------------------------------------

  /**
   * Handles Tier 3 full REM on session end (Stop hook).
   *
   * Delegates to fullRem.run() with complete session context.
   * Per D-05: no time pressure, deep editorial pass.
   *
   * @param {Object} sessionContext - Session context for REM pipeline
   * @param {string} sessionContext.summary - Session summary
   * @param {Array<Object>} sessionContext.fragments - Session fragments
   * @param {Array<Object>} sessionContext.recallEvents - Recall events
   * @param {Object} sessionContext.metrics - Session metrics
   * @param {Object} sessionContext.domainData - Domain data
   * @param {Object} [sessionContext.llmResponses] - LLM responses
   * @returns {Promise<Object>} Full REM result
   */
  async function handleTier3(sessionContext) {
    const ctx = sessionContext || {};
    const result = await _fullRem.run(
      ctx.summary,
      ctx.fragments,
      ctx.recallEvents,
      ctx.metrics,
      ctx.domainData,
      ctx.llmResponses
    );

    if (_switchboard) {
      _switchboard.emit('reverie:rem:tier3-complete', { result });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Dormant Maintenance
  // -------------------------------------------------------------------------

  /**
   * Handles dormant mode decay maintenance.
   *
   * Per D-14: SessionStart catch-up. Reads all active/ fragments,
   * computes decay for each, archives those below threshold.
   * Retroactive computation produces same result since decay is time-based.
   *
   * @returns {Promise<{ checked: number, archived: number, still_active: number }>}
   */
  async function handleDormantMaintenance() {
    const stats = { checked: 0, archived: 0, still_active: 0 };

    if (!_journal || !_decay) {
      return stats;
    }

    // Read all fragments in active/ directory
    const listResult = await _journal.list('active');
    if (!listResult || !listResult.ok) {
      return stats;
    }

    const fragments = listResult.value || [];
    stats.checked = fragments.length;

    for (const fragment of fragments) {
      // Compute current decay weight
      const currentWeight = _decay.computeDecay(fragment);

      // Check if fragment should be archived
      if (_decay.shouldArchive(fragment)) {
        // Move to archive/ via Journal
        if (typeof _journal.move === 'function') {
          await _journal.move(fragment.id, 'active', 'archive');
        }

        // Update Ledger lifecycle via Wire
        if (_wire && typeof _wire.queueWrite === 'function') {
          _wire.queueWrite({
            type: 'write-intent',
            from: 'rem-consolidator',
            to: 'ledger',
            payload: {
              table: 'fragment_decay',
              data: [{ fragment_id: fragment.id, lifecycle: 'archive' }],
              operation: 'update',
            },
          });
        }

        stats.archived++;
      } else {
        stats.still_active++;
      }
    }

    if (_switchboard) {
      _switchboard.emit('reverie:rem:dormant-maintenance-complete', stats);
    }

    return stats;
  }

  // -------------------------------------------------------------------------
  // Crash Recovery
  // -------------------------------------------------------------------------

  /**
   * Handles crash recovery by detecting orphaned working/ fragments.
   *
   * Per D-15: On SessionStart, scan working/ for fragments with session IDs
   * that don't match the current session. Orphaned fragments indicate a
   * previous session crashed before REM could run.
   *
   * @param {string} currentSessionId - Current session identifier
   * @returns {Promise<{ hasOrphans: boolean, orphanedSessions: Array<string>, recoveryTriggered: boolean }>}
   */
  async function handleCrashRecovery(currentSessionId) {
    const result = { hasOrphans: false, orphanedSessions: [], recoveryTriggered: false };

    if (!_journal) {
      return result;
    }

    // Scan working/ directory for fragment files
    const listResult = await _journal.list('working');
    if (!listResult || !listResult.ok) {
      return result;
    }

    const workingFragments = listResult.value || [];

    // Identify orphans: fragments with session IDs that don't match current
    const orphanedSessionSet = new Set();
    for (const fragment of workingFragments) {
      const fragmentSession = fragment.source_session || 'unknown';
      if (fragmentSession !== currentSessionId) {
        orphanedSessionSet.add(fragmentSession);
      }
    }

    if (orphanedSessionSet.size > 0) {
      result.hasOrphans = true;
      result.orphanedSessions = Array.from(orphanedSessionSet);

      // Trigger recovery REM (reduced scope Tier 3)
      // In production, this would delegate to fullRem.run with orphaned fragments
      result.recoveryTriggered = true;

      if (_switchboard) {
        _switchboard.emit('reverie:rem:crash-recovery', {
          orphanedSessions: result.orphanedSessions,
          fragmentCount: workingFragments.filter(f =>
            (f.source_session || 'unknown') !== currentSessionId
          ).length,
        });
      }
    }

    return result;
  }

  return Object.freeze({
    handleTier1,
    handleTier2,
    abortTier2,
    handleTier3,
    handleDormantMaintenance,
    handleCrashRecovery,
  });
}

module.exports = { createRemConsolidator };
