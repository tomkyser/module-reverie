'use strict';

/**
 * Nudge manager for filesystem-based formation-to-context coordination.
 *
 * Per Pattern 2 (Filesystem as Coordination Bus): The formation subagent
 * writes nudge text to the filesystem. The Context Manager reads nudges
 * for passive recall injection into subsequent turns.
 *
 * Nudges are short impressionistic text (~100-200 tokens per D-11) that
 * shade the response rather than narrate memories. The latest nudge file
 * acts as the coordination point between the asynchronous formation
 * subagent and the synchronous Context Manager hot path.
 *
 * Staleness detection: Nudges older than NUDGE_DEFAULTS.max_nudge_age_ms
 * (default 60s) are treated as stale and ignored. This prevents old
 * formation results from inappropriately coloring new responses.
 *
 * @module reverie/components/formation/nudge-manager
 */

const path = require('node:path');
const { ok, err } = require('../../../../lib/result.cjs');
const { DATA_DIR_DEFAULT, NUDGE_DEFAULTS } = require('../../lib/constants.cjs');

/**
 * Creates a nudge manager instance with options-based DI.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.lathe - Lathe service for file I/O (injected)
 * @param {string} [options.dataDir] - Data directory path. Defaults to DATA_DIR_DEFAULT.
 * @returns {{ writeNudge: function, readLatestNudge: function }} Nudge manager instance
 */
function createNudgeManager(options) {
  const opts = options || {};
  const lathe = opts.lathe;
  const dataDir = opts.dataDir || DATA_DIR_DEFAULT;

  // Resolve ~ to HOME
  const resolvedDataDir = dataDir.startsWith('~')
    ? path.join(process.env.HOME || '/tmp', dataDir.slice(1))
    : dataDir;

  const nudgeDir = path.join(resolvedDataDir, NUDGE_DEFAULTS.nudge_dir);
  const latestNudgePath = path.join(nudgeDir, NUDGE_DEFAULTS.latest_nudge_filename);

  /**
   * Writes a nudge text to the filesystem coordination bus.
   *
   * Writes two files:
   * 1. latest-nudge.md -- the well-known file the Context Manager reads
   * 2. nudge-{timestamp}.md -- historical copy for debugging/analysis
   *
   * @param {string} text - Nudge text (impressionistic, ~100-200 tokens)
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ path: string }>>}
   */
  async function writeNudge(text) {
    try {
      // Write the latest nudge (overwrites previous)
      await lathe.writeFile(latestNudgePath, text);

      // Write timestamped copy for history
      const timestampedPath = path.join(nudgeDir, `nudge-${Date.now()}.md`);
      await lathe.writeFile(timestampedPath, text);

      return ok({ path: latestNudgePath });
    } catch (e) {
      return err('NUDGE_WRITE_FAILED', `Failed to write nudge: ${e.message}`);
    }
  }

  /**
   * Reads the latest nudge from the filesystem coordination bus.
   *
   * Returns null in two cases:
   * 1. No nudge file exists (formation has not run yet)
   * 2. Nudge is stale (older than NUDGE_DEFAULTS.max_nudge_age_ms)
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ text: string, age: number }|null>>}
   */
  async function readLatestNudge() {
    try {
      // Check if the file exists by reading it
      const readResult = await lathe.readFile(latestNudgePath);
      if (!readResult.ok) {
        // File does not exist -- no nudge available
        return ok(null);
      }

      // Check staleness via stat
      const statResult = await lathe.stat(latestNudgePath);
      if (!statResult.ok) {
        // Cannot stat -- treat as unavailable
        return ok(null);
      }

      const age = Date.now() - statResult.value.mtimeMs;
      if (age > NUDGE_DEFAULTS.max_nudge_age_ms) {
        // Nudge is stale -- ignore it
        return ok(null);
      }

      return ok({ text: readResult.value, age });
    } catch (e) {
      return err('NUDGE_READ_FAILED', `Failed to read nudge: ${e.message}`);
    }
  }

  return Object.freeze({ writeNudge, readLatestNudge });
}

module.exports = { createNudgeManager };
