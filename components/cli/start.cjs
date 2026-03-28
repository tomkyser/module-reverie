'use strict';

/**
 * Reverie CLI start command handler.
 *
 * Upgrades Reverie from Passive (or Dormant) to Active mode.
 * Handles all 5 mode states with appropriate responses and
 * recovery suggestions per D-11.
 *
 * Per D-01, D-02: Start returns human/json/raw output triple.
 * Per INT-02: CLI surface via Pulley for operational control.
 *
 * @module reverie/components/cli/start
 */

const { ok, err } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the Reverie start handler.
 *
 * @param {Object} context - Handler context
 * @param {Object|null} context.modeManager - Mode Manager for mode queries and transitions
 * @param {Object|null} context.sessionManager - Session Manager for session lifecycle
 * @returns {{ handle: Function }} Handler object
 */
function createStartHandler(context) {
  const { modeManager, sessionManager } = context || {};

  /**
   * Handles the `dynamo reverie start` command.
   *
   * State handling matrix:
   * - active:  No-op, report already active
   * - passive: Upgrade to Active mode via modeManager.requestActive()
   * - dormant: Start session then upgrade to Active
   * - rem:     No-op, report REM in progress
   * - null:    Error NOT_INITIALIZED with recovery suggestion
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>>}
   */
  async function handle(args, flags) {
    // Null guard: modeManager or sessionManager not available
    if (!modeManager || !sessionManager) {
      return err(
        'NOT_INITIALIZED',
        'Reverie is not initialized -- run a session first or check platform health with `bun bin/dynamo.cjs health`'
      );
    }

    const mode = modeManager.getMode();
    const stateInfo = sessionManager.getState();
    const tripletId = stateInfo ? stateInfo.triplet_id : null;

    // ---- active: no-op ----
    if (mode === 'active') {
      var data = { mode: 'active', changed: false, triplet_id: tripletId };
      return ok({
        human: 'Reverie is already in Active mode\nTriplet: ' + (tripletId || 'unknown'),
        json: data,
        raw: JSON.stringify(data),
      });
    }

    // ---- rem: no-op, wait for completion ----
    if (mode === 'rem') {
      var remData = { mode: 'rem', changed: false };
      return ok({
        human: 'Reverie is consolidating memories (REM mode) -- please wait for completion, then try again.\nCheck progress: `bun bin/dynamo.cjs reverie status`',
        json: remData,
        raw: JSON.stringify(remData),
      });
    }

    // ---- session not yet started: start session first, then upgrade ----
    // Mode Manager may report 'passive' while Session Manager is still 'uninitialized'
    // (two independent state machines). Always check session state before upgrade.
    var sessionState = stateInfo ? stateInfo.state : null;
    if (mode === 'dormant' || sessionState === 'uninitialized' || sessionState === 'stopped' ||
        (mode !== 'passive' && mode !== 'active' && mode !== 'rem')) {
      var startResult = await sessionManager.start();
      if (!startResult.ok) {
        return err(
          'UPGRADE_FAILED',
          'Could not start session -- ' + (startResult.error ? startResult.error.message : 'unknown error') + '. Try `bun bin/dynamo.cjs reverie status` to check current state'
        );
      }
    }

    // ---- passive (or just started): upgrade to active ----
    var upgradeResult = await modeManager.requestActive();
    if (!upgradeResult.ok) {
      return err(
        'UPGRADE_FAILED',
        'Could not upgrade to Active mode -- ' + (upgradeResult.error ? upgradeResult.error.message : 'unknown error') + '. Try `bun bin/dynamo.cjs reverie status` to check current state'
      );
    }

    // Fetch updated state after upgrade
    var updatedState = sessionManager.getState();
    var updatedTripletId = updatedState ? updatedState.triplet_id : tripletId;
    var activeData = { mode: 'active', changed: true, triplet_id: updatedTripletId };
    return ok({
      human: 'Reverie upgraded to Active mode\nTriplet: ' + (updatedTripletId || 'unknown') + '\nSessions: Primary + Secondary + Tertiary',
      json: activeData,
      raw: JSON.stringify(activeData),
    });
  }

  return Object.freeze({ handle: handle });
}

module.exports = { createStartHandler };
