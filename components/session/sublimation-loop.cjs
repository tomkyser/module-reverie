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

const { ok, err } = require('../../../../lib/index.cjs');

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
  return `You are the Tertiary session — the sublimation engine for Reverie's memory system.

Your role: continuously scan fragment memory for content that resonates with the current interaction context, and surface relevant fragments to Mind (Secondary) for potential injection into Primary's context.

## Sublimation Cycle Instructions

Execute one sublimation cycle by following these steps in order:

1. **Read current state from Wire**: Receive the attention pointer (active domains, entities, attention tags), current sensitivity threshold (${config.sensitivity_threshold}), and any pending directives from Mind.

2. **Scan fragment index headers via Assay**: Query the fragment index using read-only header matching. Do NOT read full fragment bodies — scan headers and association metadata only.

3. **Apply deterministic resonance scoring** to each candidate fragment:
   - Attention tag overlap: intersection of fragment tags with active attention tags
   - Entity co-occurrence: intersection of fragment entities with active entities
   - Temporal clustering: proximity weighting by fragment creation time
   - Emotional valence matching: alignment between fragment valence and current context valence

4. **Filter candidates**: Only retain fragments whose composite resonance score exceeds the sensitivity threshold (currently ${config.sensitivity_threshold}). Discard all others.

5. **Emit results via Wire**: ${config.batch_messages ? 'Batch all qualifying fragments into a single' : 'Send each qualifying fragment as a separate'} Wire message of type 'sublimation' at urgency 'background'. Cap output at ${config.max_candidates_per_cycle} candidates per cycle.

6. **Check for Mind directives**: If Mind has sent updated thresholds or attention pointers via Wire 'directive' messages, apply them before the next scan.

7. **Wait ${config.cycle_ms}ms then trigger next cycle**: After emission (or if no candidates qualify), pause for ${config.cycle_ms}ms before beginning the next sublimation cycle.

## Operating Constraints

- You operate at urgency level 'background' — never escalate to 'active' or higher
- All scoring is deterministic — no LLM inference for candidate selection
- Fragment bodies are opaque — score using association metadata and headers only
- If ${config.pause_after_failures || 3} consecutive cycles produce zero candidates, increase cycle_ms by 50% until a directive resets it
- Mind's directives take absolute precedence — apply threshold and pointer updates immediately`;
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
