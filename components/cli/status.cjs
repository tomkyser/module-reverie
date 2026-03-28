'use strict';

/**
 * Reverie CLI status command handler.
 *
 * Provides an operational dashboard showing current mode, fragment counts,
 * Self Model version, last REM timestamp, domain count, and association
 * index size.
 *
 * Per INT-02: CLI surface via Pulley for read-only inspection.
 * Per D-01: Status returns complete operational dashboard in three output modes.
 *
 * @module reverie/components/cli/status
 */

const { ok } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the Reverie status handler.
 *
 * @param {Object} context - Handler context
 * @param {Object|null} context.modeManager - Mode Manager for current mode
 * @param {Object|null} context.selfModel - Self Model for version info
 * @param {Object|null} context.journal - Journal provider for fragment counts
 * @param {Object|null} context.switchboard - Switchboard for last event queries
 * @param {Object|null} context.wire - Wire service for domain and association queries
 * @param {Object|null} context.formationPipeline - Formation pipeline (reserved)
 * @returns {{ handle: Function }} Handler object
 */
function createStatusHandler(context) {
  const { modeManager, selfModel, journal, switchboard, wire, magnet } = context || {};

  /**
   * Handles the `dynamo reverie status` command.
   *
   * Returns mode, topology health, fragment lifecycle counts, Self Model
   * version, last REM timestamp, domain count, and association index size.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handle(args, flags) {
    // Mode: prefer persisted state from Magnet (cross-invocation per D-07)
    let mode = 'unknown';
    if (magnet) {
      const persistedMode = magnet.get('module', 'reverie', 'mode');
      if (persistedMode) mode = persistedMode;
    } else if (modeManager) {
      mode = modeManager.getMode();
    }

    // Session data: from Magnet for cross-invocation reads
    let tripletId = null;
    let sessionState = null;
    let relayPort = null;
    if (magnet) {
      tripletId = magnet.get('module', 'reverie', 'triplet_id');
      sessionState = magnet.get('module', 'reverie', 'session_state');
      relayPort = magnet.get('global', 'relay_port');
    }

    // Topology health: prefer relay port from Magnet for cross-invocation checks
    let topologyHealth = 'unknown';
    if (relayPort) {
      try {
        const resp = Bun.spawnSync(['curl', '-s', '-m', '2', 'http://127.0.0.1:' + relayPort + '/health']);
        if (resp.success) {
          const health = JSON.parse(resp.stdout.toString());
          topologyHealth = (health.sessions && health.sessions > 0) ? 'connected' : 'disconnected';
        } else {
          topologyHealth = 'disconnected';
        }
      } catch (_e) { topologyHealth = 'disconnected'; }
    } else if (modeManager && typeof modeManager.getMetrics === 'function') {
      const metrics = modeManager.getMetrics();
      topologyHealth = metrics.active_sessions_count > 0 ? 'connected' : 'disconnected';
    }

    // Self Model version: from identity-core aspect or 'uninitialized'
    let smVersion = 'uninitialized';
    if (selfModel && typeof selfModel.getAspect === 'function') {
      const identity = selfModel.getAspect('identity-core');
      if (identity && identity.version !== undefined) {
        smVersion = identity.version;
      }
    }

    // Fragment counts: from journal list or fallback to 0
    const fragments = { working: 0, active: 0, archive: 0 };
    if (journal && typeof journal.list === 'function') {
      const dirs = ['working', 'active', 'archive'];
      for (let i = 0; i < dirs.length; i++) {
        const dir = dirs[i];
        const listResult = journal.list(dir);
        if (listResult && listResult.ok && Array.isArray(listResult.value)) {
          fragments[dir] = listResult.value.length;
        }
      }
    }

    // Last REM timestamp: from switchboard last event or null
    let lastRemTimestamp = null;
    if (switchboard && typeof switchboard.lastEvent === 'function') {
      const lastRem = switchboard.lastEvent('reverie:rem:complete');
      if (lastRem) {
        lastRemTimestamp = lastRem;
      }
    }

    // Domain count: query active (non-archived) domains via Wire
    let domainCount = 0;
    if (wire && typeof wire.query === 'function') {
      const domainsResult = wire.query('domains');
      if (domainsResult && domainsResult.ok && Array.isArray(domainsResult.value)) {
        domainCount = domainsResult.value.filter(function (d) { return !d.archived; }).length;
      }
    }

    // Association index size: count total association edges via Wire
    let indexSize = 0;
    if (wire && typeof wire.query === 'function') {
      const assocResult = wire.query('associations');
      if (assocResult && assocResult.ok && Array.isArray(assocResult.value)) {
        indexSize = assocResult.value.length;
      }
    }

    // Build data object per D-01
    const data = {
      mode: mode,
      topology_health: topologyHealth,
      triplet_id: tripletId,
      session_state: sessionState,
      relay_port: relayPort,
      fragments: fragments,
      self_model_version: smVersion,
      last_rem: lastRemTimestamp,
      domain_count: domainCount,
      association_index_size: indexSize,
    };

    // Build human-readable output
    const human = [
      'Reverie Status',
      '==============',
      'Mode:                    ' + data.mode,
      'Topology Health:         ' + data.topology_health,
      'Triplet ID:              ' + (data.triplet_id || 'none'),
      'Session State:           ' + (data.session_state || 'unknown'),
      'Relay Port:              ' + (data.relay_port || 'none'),
      'Fragments (working):     ' + data.fragments.working,
      'Fragments (active):      ' + data.fragments.active,
      'Fragments (archive):     ' + data.fragments.archive,
      'Self Model Version:      ' + data.self_model_version,
      'Last REM:                ' + (data.last_rem || 'never'),
      'Domain Count:            ' + data.domain_count,
      'Association Index Size:  ' + data.association_index_size,
    ].join('\n');

    return ok({
      human: human,
      json: data,
      raw: JSON.stringify(data),
    });
  }

  return Object.freeze({ handle: handle });
}

module.exports = { createStatusHandler };
