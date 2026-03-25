'use strict';

/**
 * Session topology configuration for the three-session architecture.
 *
 * Defines session identities (Primary/Secondary/Tertiary), lifecycle states,
 * valid state transitions, framing modes, Wire topology rules, and default
 * configuration for session timing and capabilities.
 *
 * Per Reverie spec S4.1: Primary<->Secondary, Secondary<->Tertiary.
 * No direct Primary<->Tertiary communication.
 *
 * @module reverie/components/session/session-config
 */

/**
 * Session identity constants.
 * Each Claude Code session in the three-session architecture has one identity.
 *
 * @type {Readonly<{ PRIMARY: string, SECONDARY: string, TERTIARY: string }>}
 */
const SESSION_IDENTITIES = Object.freeze({
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  TERTIARY: 'tertiary',
});

/**
 * Session lifecycle states.
 * Sessions progress through these states during their lifetime.
 * REM_PROCESSING is an intermediate state between SHUTTING_DOWN and STOPPED
 * where Secondary stays alive for REM consolidation.
 *
 * @type {Readonly<{
 *   UNINITIALIZED: string, STARTING: string, PASSIVE: string,
 *   UPGRADING: string, ACTIVE: string, DEGRADING: string,
 *   SHUTTING_DOWN: string, REM_PROCESSING: string, STOPPED: string
 * }>}
 */
const SESSION_STATES = Object.freeze({
  UNINITIALIZED: 'uninitialized',
  STARTING: 'starting',
  PASSIVE: 'passive',
  UPGRADING: 'upgrading',
  ACTIVE: 'active',
  DEGRADING: 'degrading',
  SHUTTING_DOWN: 'shutting_down',
  REM_PROCESSING: 'rem_processing',
  STOPPED: 'stopped',
});

/**
 * Valid state transitions.
 * Maps each state to the array of states it can transition to.
 *
 * @type {Readonly<Object<string, ReadonlyArray<string>>>}
 */
const TRANSITIONS = Object.freeze({
  [SESSION_STATES.UNINITIALIZED]: Object.freeze([SESSION_STATES.STARTING]),
  [SESSION_STATES.STARTING]: Object.freeze([SESSION_STATES.PASSIVE, SESSION_STATES.STOPPED]),
  [SESSION_STATES.PASSIVE]: Object.freeze([SESSION_STATES.UPGRADING, SESSION_STATES.SHUTTING_DOWN]),
  [SESSION_STATES.UPGRADING]: Object.freeze([SESSION_STATES.ACTIVE, SESSION_STATES.PASSIVE]),
  [SESSION_STATES.ACTIVE]: Object.freeze([SESSION_STATES.DEGRADING, SESSION_STATES.SHUTTING_DOWN]),
  [SESSION_STATES.DEGRADING]: Object.freeze([SESSION_STATES.PASSIVE]),
  [SESSION_STATES.SHUTTING_DOWN]: Object.freeze([SESSION_STATES.STOPPED, SESSION_STATES.REM_PROCESSING]),
  [SESSION_STATES.REM_PROCESSING]: Object.freeze([SESSION_STATES.STOPPED]),
  [SESSION_STATES.STOPPED]: Object.freeze([]),
});

/**
 * Framing modes for context injection strategy.
 * Per D-10, D-11: Full (all aspects), Dual (face + mind), Soft (minimal).
 *
 * @type {Readonly<{ FULL: string, DUAL: string, SOFT: string }>}
 */
const FRAMING_MODES = Object.freeze({
  FULL: 'full',
  DUAL: 'dual',
  SOFT: 'soft',
});

/**
 * Wire topology rules defining which sessions can communicate directly.
 * Per spec S4.1: Primary<->Secondary and Secondary<->Tertiary.
 * No direct Primary<->Tertiary link.
 *
 * @type {Readonly<Object<string, ReadonlyArray<string>>>}
 */
const TOPOLOGY_RULES = Object.freeze({
  [SESSION_IDENTITIES.PRIMARY]: Object.freeze([SESSION_IDENTITIES.SECONDARY]),
  [SESSION_IDENTITIES.SECONDARY]: Object.freeze([SESSION_IDENTITIES.PRIMARY, SESSION_IDENTITIES.TERTIARY]),
  [SESSION_IDENTITIES.TERTIARY]: Object.freeze([SESSION_IDENTITIES.SECONDARY]),
});

/** @type {Set<string>} */
const _VALID_FRAMING_MODES = new Set(Object.values(FRAMING_MODES));

/**
 * Default session configuration with timing budgets, model assignments,
 * and passive capabilities.
 *
 * @type {Readonly<Object>}
 */
const DEFAULT_SESSION_CONFIG = Object.freeze({
  sublimation_cycle_ms: 15000,
  startup_timeout_ms: 10000,
  ack_timeout_ms: 5000,
  health_check_interval_ms: 10000,
  framing_mode: FRAMING_MODES.DUAL,
  secondary_model: 'opus',
  tertiary_model: 'sonnet',
  max_sublimation_intake: 5,
  passive_secondary_capabilities: Object.freeze(['attention', 'face_prompt', 'hook_monitor']),
});

/**
 * Creates a session configuration by merging user overrides with defaults.
 * Validates that framing_mode (if provided) is one of the FRAMING_MODES values.
 *
 * @param {Object} [overrides={}] - Configuration overrides
 * @returns {Readonly<Object>} Frozen configuration object
 * @throws {Error} If framing_mode override is not a valid FRAMING_MODES value
 */
function createSessionConfig(overrides = {}) {
  const merged = { ...DEFAULT_SESSION_CONFIG, ...overrides };

  if (!_VALID_FRAMING_MODES.has(merged.framing_mode)) {
    throw new Error(
      `Invalid framing_mode: "${merged.framing_mode}". Must be one of: ${[..._VALID_FRAMING_MODES].join(', ')}`
    );
  }

  return Object.freeze(merged);
}

module.exports = {
  SESSION_IDENTITIES,
  SESSION_STATES,
  TRANSITIONS,
  FRAMING_MODES,
  TOPOLOGY_RULES,
  DEFAULT_SESSION_CONFIG,
  createSessionConfig,
};
