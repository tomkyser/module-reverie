'use strict';

/**
 * Tertiary session sublimation loop configuration and system prompt generation.
 *
 * Defines the self-prompting cycle parameters for Tertiary — the background
 * session that continuously scans fragment memory for resonant content and
 * surfaces it to Mind (Secondary) via Wire messages.
 *
 * Per D-07/D-08/D-09:
 *   - Tertiary runs continuous sublimation cycles at configurable intervals
 *   - Each cycle: scan fragment headers, score resonance, emit results via Wire
 *   - Mind adjusts sensitivity threshold via Wire directives
 *   - Cycles are deterministic: no LLM inference, just index matching and scoring
 *
 * @module reverie/components/session/sublimation-loop
 */

const fs = require('node:fs');
const path = require('node:path');
const { ok, err } = require('../../../../lib/index.cjs');
const linotype = require('../../../../lib/linotype/linotype.cjs');

// ---------------------------------------------------------------------------
// Template Loading
// ---------------------------------------------------------------------------

const PROMPTS_DIR = path.join(__dirname, '../../prompts');

function _loadTemplate(filename) {
  const content = fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8');
  return linotype.parseString(content, filename);
}

const _sublimationMatrix = _loadTemplate('sublimation-system.md');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default sublimation cycle configuration.
 *
 * @type {Readonly<{
 *   cycle_ms: number,
 *   max_candidates_per_cycle: number,
 *   sensitivity_threshold: number,
 *   batch_messages: boolean,
 *   pause_after_failures: number
 * }>}
 */
const SUBLIMATION_DEFAULTS = Object.freeze({
  cycle_ms: 15000,
  max_candidates_per_cycle: 5,
  sensitivity_threshold: 0.3,
  batch_messages: true,
  pause_after_failures: 3,
});

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Builds the Tertiary session system prompt from current configuration.
 *
 * This prompt is injected as the Tertiary session's system-level instructions.
 * It must be practical and specific — Tertiary executes these steps each cycle.
 *
 * @param {Object} config - Current effective configuration
 * @param {number} config.cycle_ms - Cycle interval in milliseconds
 * @param {number} config.max_candidates_per_cycle - Maximum candidates per cycle
 * @param {number} config.sensitivity_threshold - Current resonance threshold
 * @param {boolean} config.batch_messages - Whether to batch Wire messages
 * @returns {string} System prompt for Tertiary session
 */
function _buildSystemPrompt(config) {
  const batchMode = config.batch_messages
    ? 'Batch all qualifying fragments into a single'
    : 'Send each qualifying fragment as a separate';

  return linotype.cast(_sublimationMatrix, {
    sensitivity_threshold: String(config.sensitivity_threshold),
    batch_mode: batchMode,
    max_candidates: String(config.max_candidates_per_cycle),
    cycle_ms: String(config.cycle_ms),
    pause_after_failures: String(config.pause_after_failures || 3),
  }).content;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a sublimation loop configuration instance.
 *
 * @param {Object} [options] - Configuration options
 * @param {Object} [options.config] - Custom config overrides (merged with SUBLIMATION_DEFAULTS)
 * @returns {Readonly<{
 *   getSystemPrompt: Function,
 *   getCycleConfig: Function,
 *   updateSensitivity: Function,
 *   getState: Function,
 *   recordCycle: Function,
 *   pause: Function,
 *   resume: Function
 * }>}
 */
function createSublimationLoop(options) {
  const opts = options || {};
  const userConfig = opts.config || {};

  // Shallow merge with defaults
  const mergedConfig = Object.assign({}, SUBLIMATION_DEFAULTS, userConfig);

  // Internal mutable state
  let _cyclesCompleted = 0;
  let _lastCycleAt = null;
  let _paused = false;
  let _sensitivityThreshold = mergedConfig.sensitivity_threshold;

  /**
   * Returns the system prompt for the Tertiary session, using current effective config.
   * @returns {string}
   */
  function getSystemPrompt() {
    return _buildSystemPrompt({
      cycle_ms: mergedConfig.cycle_ms,
      max_candidates_per_cycle: mergedConfig.max_candidates_per_cycle,
      sensitivity_threshold: _sensitivityThreshold,
      batch_messages: mergedConfig.batch_messages,
      pause_after_failures: mergedConfig.pause_after_failures,
    });
  }

  /**
   * Returns a frozen copy of the current cycle configuration.
   * @returns {Readonly<{ cycle_ms: number, max_candidates_per_cycle: number, sensitivity_threshold: number, batch_messages: boolean }>}
   */
  function getCycleConfig() {
    return Object.freeze({
      cycle_ms: mergedConfig.cycle_ms,
      max_candidates_per_cycle: mergedConfig.max_candidates_per_cycle,
      sensitivity_threshold: _sensitivityThreshold,
      batch_messages: mergedConfig.batch_messages,
    });
  }

  /**
   * Updates the sensitivity threshold. Must be in range [0, 1].
   *
   * @param {number} value - New sensitivity threshold
   * @returns {import('../../../../lib/result.cjs').Result<number>}
   */
  function updateSensitivity(value) {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      return err('INVALID_SENSITIVITY', `Sensitivity must be a number between 0 and 1, got: ${value}`);
    }
    _sensitivityThreshold = value;
    return ok(value);
  }

  /**
   * Returns the current sublimation loop state.
   * @returns {{ cycles_completed: number, last_cycle_at: number|null, sensitivity_threshold: number, paused: boolean }}
   */
  function getState() {
    return {
      cycles_completed: _cyclesCompleted,
      last_cycle_at: _lastCycleAt,
      sensitivity_threshold: _sensitivityThreshold,
      paused: _paused,
    };
  }

  /**
   * Records a completed sublimation cycle.
   * @returns {import('../../../../lib/result.cjs').Result<{ cycles_completed: number }>}
   */
  function recordCycle() {
    _cyclesCompleted++;
    _lastCycleAt = Date.now();
    return ok({ cycles_completed: _cyclesCompleted });
  }

  /**
   * Pauses the sublimation loop.
   * @returns {import('../../../../lib/result.cjs').Result<void>}
   */
  function pause() {
    _paused = true;
    return ok();
  }

  /**
   * Resumes the sublimation loop.
   * @returns {import('../../../../lib/result.cjs').Result<void>}
   */
  function resume() {
    _paused = false;
    return ok();
  }

  return Object.freeze({
    getSystemPrompt,
    getCycleConfig,
    updateSensitivity,
    getState,
    recordCycle,
    pause,
    resume,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SUBLIMATION_DEFAULTS,
  createSublimationLoop,
};
