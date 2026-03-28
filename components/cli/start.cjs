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

const path = require('node:path');
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
  const { modeManager, sessionManager, magnet, conductor } = context || {};

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

    // Clean start per D-03: kill stale processes, clear state, spawn fresh
    if (magnet) {
      // Kill stale Secondary/Tertiary terminal window PIDs (per D-03: signal shutdown)
      const staleSecondaryPid = magnet.get('global', 'secondary_pid');
      const staleTertiaryPid = magnet.get('global', 'tertiary_pid');
      if (staleSecondaryPid) {
        try { process.kill(staleSecondaryPid, 'SIGTERM'); } catch (_e) { /* already dead */ }
      }
      if (staleTertiaryPid) {
        try { process.kill(staleTertiaryPid, 'SIGTERM'); } catch (_e) { /* already dead */ }
      }
      // Kill stale relay process
      const staleRelayPid = magnet.get('global', 'relay_pid');
      if (staleRelayPid) {
        try { process.kill(staleRelayPid, 'SIGTERM'); } catch (_e) { /* already dead */ }
      }
      // Clear stale session state -- fresh spawn every time
      await magnet.set('module', 'reverie', 'session_state', null);
      await magnet.set('module', 'reverie', 'secondary_session_id', null);
      await magnet.set('module', 'reverie', 'tertiary_session_id', null);
      await magnet.set('module', 'reverie', 'triplet_id', null);
      await magnet.set('global', 'relay_pid', null);
      await magnet.set('global', 'relay_port', null);
      await magnet.set('global', 'secondary_pid', null);
      await magnet.set('global', 'tertiary_pid', null);
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

    // ---- Per D-04: Spawn Wire relay server as background Bun process ----
    var relayServerPath = path.resolve(__dirname, '../../../../core/services/wire/relay-server.cjs');
    var relayPort = 9876;
    var relayProc;

    try {
      relayProc = Bun.spawn(['bun', 'run', relayServerPath], {
        env: {
          ...process.env,
          WIRE_RELAY_PORT: String(relayPort),
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (spawnErr) {
      return err(
        'RELAY_SPAWN_FAILED',
        'Could not start Wire relay server -- ' + spawnErr.message + '. Try `bun bin/dynamo.cjs reverie status` to check current state'
      );
    }

    // Wait for relay to become healthy (Pitfall 3: race condition)
    // Poll /health up to 5 times with 500ms delay
    var relayReady = false;
    for (var attempt = 0; attempt < 5; attempt++) {
      await new Promise(function (resolve) { setTimeout(resolve, 500); });
      try {
        var healthCheck = Bun.spawnSync(['curl', '-s', '-m', '1', 'http://127.0.0.1:' + relayPort + '/health']);
        if (healthCheck.success) {
          relayReady = true;
          break;
        }
      } catch (_e) { /* retry */ }
    }

    if (!relayReady) {
      // Kill the process if health check never passed
      try { relayProc.kill(); } catch (_e) { /* already dead */ }
      return err(
        'RELAY_HEALTH_FAILED',
        'Wire relay server started but health check failed after 2.5s. Try `bun bin/dynamo.cjs reverie status` to check current state'
      );
    }

    // Persist relay info in Magnet for cross-invocation reads
    if (magnet) {
      await magnet.set('global', 'relay_port', relayPort);
      await magnet.set('global', 'relay_pid', relayProc.pid);
    }

    // Set relay URL on Session Manager so spawned sessions receive it
    sessionManager.setRelayUrl('http://127.0.0.1:' + relayPort);

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

    // Capture terminal process PIDs for clean-start kill (D-03)
    // These are the bash processes running our temp scripts
    if (magnet) {
      try {
        var pgrepSecondary = Bun.spawnSync(['pgrep', '-f', 'dynamo-secondary']);
        if (pgrepSecondary.success) {
          var secPid = parseInt(pgrepSecondary.stdout.toString().trim().split('\n')[0], 10);
          if (!isNaN(secPid)) await magnet.set('global', 'secondary_pid', secPid);
        }
      } catch (_e) { /* pgrep may not find it immediately */ }
      try {
        var pgrepTertiary = Bun.spawnSync(['pgrep', '-f', 'dynamo-tertiary']);
        if (pgrepTertiary.success) {
          var terPid = parseInt(pgrepTertiary.stdout.toString().trim().split('\n')[0], 10);
          if (!isNaN(terPid)) await magnet.set('global', 'tertiary_pid', terPid);
        }
      } catch (_e) { /* pgrep may not find it immediately */ }
    }

    // Fetch updated state after upgrade
    var updatedState = sessionManager.getState();
    var updatedTripletId = updatedState ? updatedState.triplet_id : tripletId;
    var activeData = {
      mode: 'active', changed: true, triplet_id: updatedTripletId,
      relay_port: relayPort, relay_pid: relayProc.pid,
    };
    return ok({
      human: 'Reverie upgraded to Active mode\nTriplet: ' + (updatedTripletId || 'unknown') + '\nRelay: http://127.0.0.1:' + relayPort + '\nSessions: Primary + Secondary + Tertiary',
      json: activeData,
      raw: JSON.stringify(activeData),
    });
  }

  return Object.freeze({ handle: handle });
}

module.exports = { createStartHandler };
