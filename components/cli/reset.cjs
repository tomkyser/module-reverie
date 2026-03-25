'use strict';

/**
 * Reset subcommand handlers for Reverie CLI (D-04).
 *
 * Provides three scoped reset operations with mandatory --confirm safety gate:
 * - reset fragments: Wipe all fragments, preserve Self Model
 * - reset self-model: Reinitialize Self Model from cold start
 * - reset all: Full factory reset (fragments + Self Model)
 *
 * Per Pitfall 6: ALL confirm checks happen BEFORE any destructive operation.
 * No partial resets on missing --confirm.
 *
 * All handlers return { human, json, raw } for Pulley's three output modes.
 *
 * @module reverie/components/cli/reset
 */

const { ok, err } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Confirm gate
// ---------------------------------------------------------------------------

/**
 * Checks for --confirm flag presence in process.argv.
 *
 * Per the plan note: Pulley only parses --json/--raw/--help. Custom flags
 * like --confirm are NOT automatically parsed. Check process.argv directly.
 *
 * @returns {import('../../../../lib/result.cjs').Err|null} Error result if not confirmed, null if confirmed
 */
function _requireConfirm() {
  const hasConfirm = process.argv.includes('--confirm');
  if (!hasConfirm) {
    return err('CONFIRM_REQUIRED', 'This operation is destructive. Add --confirm to proceed.', {
      hint: 'dynamo reverie reset <scope> --confirm',
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates reset subcommand handlers with injected dependencies.
 *
 * @param {Object} context - Dependency injection context
 * @param {Object} context.selfModel - Self Model manager with coldStart()
 * @param {Object} context.journal - Journal provider (listFragments)
 * @param {Object} context.fragmentWriter - FragmentWriter with deleteFragment()
 * @param {Object} context.wire - Wire service
 * @param {Object} context.switchboard - Switchboard for event emission
 * @param {Object} context.lathe - Lathe filesystem service
 * @param {string} context.dataDir - Reverie data directory path
 * @returns {{ handleResetFragments: Function, handleResetSelfModel: Function, handleResetAll: Function }}
 */
function createResetHandlers(context) {
  const _selfModel = context.selfModel;
  const _journal = context.journal;
  const _fragmentWriter = context.fragmentWriter;
  const _switchboard = context.switchboard;

  // -------------------------------------------------------------------------
  // Internal: delete all fragments
  // -------------------------------------------------------------------------

  /**
   * Deletes all fragments across all lifecycle directories.
   *
   * @returns {Promise<number>} Number of fragments deleted
   */
  async function _deleteAllFragments() {
    const fragmentsResult = _journal.listFragments();
    if (!fragmentsResult.ok) {
      return 0;
    }

    const fragments = fragmentsResult.value;
    let count = 0;

    for (const fragment of fragments) {
      await _fragmentWriter.deleteFragment(fragment.id);
      count++;
    }

    return count;
  }

  // -------------------------------------------------------------------------
  // Reset Fragments
  // -------------------------------------------------------------------------

  /**
   * Wipes all fragments while preserving the Self Model.
   *
   * Requires --confirm flag. Deletes each fragment via FragmentWriter.
   * Emits 'reverie:reset:fragments' event on completion.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused -- confirm checked via process.argv)
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>>}
   */
  async function handleResetFragments(args, flags) {
    const confirmErr = _requireConfirm();
    if (confirmErr) return confirmErr;

    const count = await _deleteAllFragments();

    if (_switchboard) {
      _switchboard.emit('reverie:reset:fragments', { count });
    }

    return ok({
      human: `Reset ${count} fragments. Self Model preserved.`,
      json: { reset: 'fragments', count },
      raw: String(count),
    });
  }

  // -------------------------------------------------------------------------
  // Reset Self Model
  // -------------------------------------------------------------------------

  /**
   * Reinitializes the Self Model from cold start.
   *
   * Requires --confirm flag. Calls selfModel.coldStart() to reinitialize.
   * Emits 'reverie:reset:self-model' event on completion.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handleResetSelfModel(args, flags) {
    const confirmErr = _requireConfirm();
    if (confirmErr) return confirmErr;

    _selfModel.coldStart();

    if (_switchboard) {
      _switchboard.emit('reverie:reset:self-model', {});
    }

    return ok({
      human: 'Self Model reinitialized from cold start.',
      json: { reset: 'self-model' },
      raw: 'self-model',
    });
  }

  // -------------------------------------------------------------------------
  // Reset All
  // -------------------------------------------------------------------------

  /**
   * Full factory reset: wipes all fragments and reinitializes Self Model.
   *
   * Requires --confirm flag. Per Pitfall 6, confirm check happens BEFORE
   * any destructive operation -- no partial resets.
   * Emits 'reverie:reset:all' event on completion.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>>}
   */
  async function handleResetAll(args, flags) {
    const confirmErr = _requireConfirm();
    if (confirmErr) return confirmErr;

    // Reset fragments
    const count = await _deleteAllFragments();

    // Reset Self Model
    _selfModel.coldStart();

    if (_switchboard) {
      _switchboard.emit('reverie:reset:all', { fragments_deleted: count });
    }

    return ok({
      human: `Factory reset complete. ${count} fragments deleted, Self Model reinitialized.`,
      json: { reset: 'all', fragments_deleted: count },
      raw: 'all',
    });
  }

  return {
    handleResetFragments,
    handleResetSelfModel,
    handleResetAll,
  };
}

module.exports = { createResetHandlers };
