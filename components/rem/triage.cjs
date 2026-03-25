'use strict';

/**
 * Tier 1 triage -- fast state snapshot on PreCompact.
 *
 * Per D-01: Snapshots Mind state to Journal via Lathe on PreCompact events.
 * Only filesystem writes, no LLM calls. Keeps Tier 1 fast and synchronous-like.
 *
 * Snapshot fields per spec Section 5.2:
 * - attention_pointer: current attention focus (from Mind cycle state)
 * - working_fragments: list of fragment IDs in working/ directory
 * - sublimation_candidates: IDs of active sublimation items
 * - self_model_prompt_state: current face prompt hash/summary
 * - timestamp: ISO string
 * - session_id: current session identifier
 *
 * @module reverie/components/rem/triage
 */

const { ok, err } = require('../../../../lib/result.cjs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Tier 1 triage instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.lathe - Lathe service for filesystem operations
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {string} [options.dataDir] - Data directory path (supports ~ prefix)
 * @param {string} [options.sessionId] - Current session identifier
 * @returns {Readonly<{ snapshot: Function }>}
 */
function createTriage(options) {
  const opts = options || {};
  const lathe = opts.lathe;
  const switchboard = opts.switchboard || null;
  const sessionId = opts.sessionId || 'unknown';

  // Resolve ~ to HOME for dataDir
  const dataDir = opts.dataDir || '/tmp';
  const resolvedDataDir = dataDir.startsWith('~')
    ? path.join(process.env.HOME || '/tmp', dataDir.slice(1))
    : dataDir;

  /**
   * Takes a fast snapshot of Mind state for triage purposes.
   *
   * Per D-01: Filesystem writes only, no LLM calls. Returns immediately
   * after writing state to JSON file via Lathe.
   *
   * @param {Object} [mindState] - Current Mind cycle state
   * @param {string} [mindState.attention_pointer] - Current attention focus
   * @param {string[]} [mindState.working_fragments] - Fragment IDs in working/
   * @param {string[]} [mindState.sublimation_candidates] - Active sublimation IDs
   * @param {string} [mindState.self_model_prompt_state] - Face prompt hash/summary
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ path: string, fields_saved: number }>>}
   */
  async function snapshot(mindState) {
    const state = {
      attention_pointer: (mindState && mindState.attention_pointer) || null,
      working_fragments: (mindState && mindState.working_fragments) || [],
      sublimation_candidates: (mindState && mindState.sublimation_candidates) || [],
      self_model_prompt_state: (mindState && mindState.self_model_prompt_state) || null,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
    };

    const triagePath = path.join(resolvedDataDir, 'data', 'rem', 'triage-' + Date.now() + '.json');

    try {
      const writeResult = await lathe.writeFile(triagePath, JSON.stringify(state, null, 2));
      if (writeResult && !writeResult.ok) {
        return err('TRIAGE_WRITE_FAILED', 'Failed to write triage state', writeResult.error);
      }
    } catch (e) {
      return err('TRIAGE_WRITE_FAILED', e.message || 'Triage write error');
    }

    const result = { path: triagePath, fields_saved: Object.keys(state).length };

    if (switchboard) {
      switchboard.emit('reverie:rem:tier1-complete', result);
    }

    return ok(result);
  }

  return Object.freeze({ snapshot });
}

module.exports = { createTriage };
