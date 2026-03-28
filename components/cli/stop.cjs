'use strict';

/**
 * Reverie CLI stop command handler.
 *
 * Initiates graceful shutdown with REM consolidation. Uses fire-and-forget
 * pattern to return immediately while REM runs asynchronously on Secondary.
 *
 * Per D-01, D-03: Stop returns human/json/raw output triple.
 * Per INT-02: CLI surface via Pulley for operational control.
 * Per Pitfall 2: Fire-and-forget -- returns before consolidation completes.
 *
 * @module reverie/components/cli/stop
 */

const { ok, err } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the Reverie stop handler.
 *
 * @param {Object} context - Handler context
 * @param {Object|null} context.modeManager - Mode Manager for mode queries and transitions
 * @param {Object|null} context.sessionManager - Session Manager for session lifecycle
 * @param {Object|null} context.remConsolidator - REM Consolidator for Tier 3 consolidation
 * @param {Object|null} context.contextManager - Context Manager for warm-start persistence
 * @returns {{ handle: Function }} Handler object
 */
function createStopHandler(context) {
  const { modeManager, sessionManager, remConsolidator, contextManager, magnet } = context || {};

  /**
   * Handles the `dynamo reverie stop` command.
   *
   * State handling matrix:
   * - dormant: No-op, report already dormant
   * - rem:     No-op, report REM in progress
   * - active:  Initiate REM fire-and-forget shutdown
   * - passive: Initiate REM fire-and-forget shutdown
   * - null:    Error NOT_INITIALIZED with recovery suggestion
   *
   * Fire-and-forget pattern (mirrors hook-handlers.cjs handleStop):
   * 1. modeManager.requestRem('user_stop_command')
   * 2. sessionManager.transitionToRem()
   * 3. Fire-and-forget: remConsolidator.handleTier3() -> requestDormant + completeRem
   * 4. Fire-and-forget: contextManager.persistWarmStart()
   * 5. Return immediately
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>>}
   */
  async function handle(args, flags) {
    // Null guard: modeManager not available
    if (!modeManager) {
      return err(
        'NOT_INITIALIZED',
        'Reverie is not running -- nothing to stop. Check status with `bun bin/dynamo.cjs reverie status`'
      );
    }

    const mode = modeManager.getMode();

    // ---- dormant: no-op ----
    if (mode === 'dormant') {
      var dormantData = { mode: 'dormant', stopped: false };
      return ok({
        human: 'Reverie is already dormant (no active sessions)',
        json: dormantData,
        raw: JSON.stringify(dormantData),
      });
    }

    // ---- rem: no-op ----
    if (mode === 'rem') {
      var remData = { mode: 'rem', stopped: false };
      return ok({
        human: 'Reverie is already consolidating memories (REM mode)\nCheck progress: `bun bin/dynamo.cjs reverie status`',
        json: remData,
        raw: JSON.stringify(remData),
      });
    }

    // ---- active or passive: initiate stop with REM ----
    // Step 1: Request REM mode
    await modeManager.requestRem('user_stop_command');

    // Step 2: Transition Session Manager to REM processing
    if (sessionManager) {
      await sessionManager.transitionToRem();
    }

    // Step 3: Fire-and-forget Tier 3 REM consolidation
    if (remConsolidator) {
      var sessionContext = {
        summary: {},
        fragments: [],
        recallEvents: [],
        metrics: {},
        domainData: { domainPairs: [], entityList: [], associationStats: [] },
      };
      remConsolidator.handleTier3(sessionContext).then(function (_result) {
        if (modeManager) modeManager.requestDormant();
        if (sessionManager) sessionManager.completeRem();
      }).catch(function (_e) {
        if (sessionManager) sessionManager.completeRem().catch(function () {});
      });
    }

    // Step 4: Clean up relay server and session processes
    if (magnet) {
      const relayPid = magnet.get('global', 'relay_pid');
      if (relayPid) {
        try { process.kill(relayPid, 'SIGTERM'); } catch (_e) { /* already dead */ }
      }
      // Kill Secondary/Tertiary terminal window processes
      const secondaryPid = magnet.get('global', 'secondary_pid');
      const tertiaryPid = magnet.get('global', 'tertiary_pid');
      if (secondaryPid) {
        try { process.kill(secondaryPid, 'SIGTERM'); } catch (_e) { /* already dead */ }
      }
      if (tertiaryPid) {
        try { process.kill(tertiaryPid, 'SIGTERM'); } catch (_e) { /* already dead */ }
      }
      // Clear all PIDs and relay state
      magnet.set('global', 'relay_pid', null);
      magnet.set('global', 'relay_port', null);
      magnet.set('global', 'secondary_pid', null);
      magnet.set('global', 'tertiary_pid', null);
    }

    // Step 5: Fire-and-forget warm-start persistence
    if (contextManager && typeof contextManager.persistWarmStart === 'function') {
      contextManager.persistWarmStart().catch(function () {});
    }

    // Step 6: Return immediately
    var stopData = { mode: 'rem', stopping: true, rem_initiated: true };
    return ok({
      human: 'Reverie shutdown initiated\nREM consolidation running in background\nMemories will be preserved before sessions terminate',
      json: stopData,
      raw: JSON.stringify(stopData),
    });
  }

  return Object.freeze({ handle: handle });
}

module.exports = { createStopHandler };
