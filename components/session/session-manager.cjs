'use strict';

/**
 * Session Manager — lifecycle state machine orchestrating Conductor and Wire.
 *
 * Manages the three-session architecture lifecycle:
 *   - start(): Spawn Secondary session (enter Passive mode)
 *   - upgrade(): Spawn Tertiary session + deliver sublimation system prompt (enter Active mode)
 *   - degrade(): Stop Tertiary session (return to Passive mode)
 *   - stop(): Ordered shutdown (Tertiary first, then Secondary)
 *
 * Per D-02: State machine with 8 states and validated transitions.
 * Per D-03: Session Manager directs WHAT to spawn (Conductor executes),
 *           WHAT topology to enforce (Wire executes).
 *
 * @module reverie/components/session/session-manager
 */

const { ok, err } = require('../../../../lib/index.cjs');
const {
  SESSION_IDENTITIES,
  SESSION_STATES,
  TRANSITIONS,
  TOPOLOGY_RULES,
} = require('./session-config.cjs');
const { MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../core/services/wire/protocol.cjs');

/**
 * Creates a Session Manager instance.
 *
 * @param {Object} options
 * @param {Object} options.conductor - Conductor service for session spawning
 * @param {Object} options.wire - Wire service for session registration and messaging
 * @param {Object} options.selfModel - Self Model for personality data
 * @param {Object} options.switchboard - Switchboard service for event emission
 * @param {Object} options.sublimationLoop - Sublimation loop for Tertiary system prompt
 * @param {Object} options.config - Session configuration from createSessionConfig
 * @returns {Readonly<{ start: Function, stop: Function, upgrade: Function, degrade: Function, getState: Function }>}
 */
function createSessionManager({ conductor, wire, selfModel, switchboard, sublimationLoop, config } = {}) {
  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  let _state = SESSION_STATES.UNINITIALIZED;
  let _secondarySessionId = null;
  let _tertiarySessionId = null;
  const _config = config;

  // ---------------------------------------------------------------------------
  // Helper: validated state transition
  // ---------------------------------------------------------------------------

  /**
   * Transitions to a target state if the transition is valid.
   * Emits 'session:state-changed' via switchboard on success.
   *
   * @param {string} targetState - Target state to transition to
   * @returns {import('../../../../lib/result.cjs').Result<{ from: string, to: string }>}
   */
  function _transition(targetState) {
    const validTargets = TRANSITIONS[_state];
    if (!validTargets || !validTargets.includes(targetState)) {
      return err('INVALID_TRANSITION', `Cannot transition from ${_state} to ${targetState}`);
    }

    const from = _state;
    _state = targetState;

    if (switchboard) {
      switchboard.emit('session:state-changed', { from, to: targetState });
    }

    return ok({ from, to: targetState });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Starts the session manager by spawning Secondary session (Passive mode).
   *
   * Transition: uninitialized -> starting -> passive
   * On failure: starting -> stopped
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function start() {
    // Transition to STARTING
    const startResult = _transition(SESSION_STATES.STARTING);
    if (!startResult.ok) {
      return startResult;
    }

    // Generate session ID for Secondary
    const sessionId = 'reverie-secondary-' + Date.now();

    // Spawn Secondary via Conductor
    const spawnResult = conductor.spawnSession({
      sessionId,
      identity: SESSION_IDENTITIES.SECONDARY,
      env: {
        SESSION_IDENTITY: 'secondary',
        MODEL: _config.secondary_model,
      },
    });

    if (!spawnResult.ok) {
      // Spawn failed -- transition to stopped
      _transition(SESSION_STATES.STOPPED);
      return err('SPAWN_FAILED', 'Failed to spawn Secondary session', spawnResult.error);
    }

    _secondarySessionId = sessionId;

    // Register Secondary in Wire
    wire.register(sessionId, {
      identity: 'secondary',
      capabilities: ['send', 'receive', 'write'],
      writePermissions: ['ledger', 'journal', 'magnet'],
    });

    // Transition to PASSIVE
    _transition(SESSION_STATES.PASSIVE);

    return ok({ state: _state, secondary: _secondarySessionId });
  }

  /**
   * Upgrades to Active mode by spawning Tertiary session.
   * After Tertiary Wire registration, delivers sublimation system prompt
   * via context-injection envelope.
   *
   * Transition: passive -> upgrading -> active
   * On failure: upgrading -> passive (graceful fallback)
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function upgrade() {
    // Transition to UPGRADING (validates current state is passive)
    const upgradeResult = _transition(SESSION_STATES.UPGRADING);
    if (!upgradeResult.ok) {
      return upgradeResult;
    }

    // Generate session ID for Tertiary
    const sessionId = 'reverie-tertiary-' + Date.now();

    // Spawn Tertiary via Conductor
    const spawnResult = conductor.spawnSession({
      sessionId,
      identity: SESSION_IDENTITIES.TERTIARY,
      env: {
        SESSION_IDENTITY: 'tertiary',
        MODEL: _config.tertiary_model,
      },
    });

    if (!spawnResult.ok) {
      // Spawn failed -- fallback to passive (not crash)
      _transition(SESSION_STATES.PASSIVE);
      return err('SPAWN_FAILED', 'Failed to spawn Tertiary session', spawnResult.error);
    }

    _tertiarySessionId = sessionId;

    // Register Tertiary in Wire (read-only: no write permissions)
    wire.register(sessionId, {
      identity: 'tertiary',
      capabilities: ['send', 'receive'],
      writePermissions: [],
    });

    // Send sublimation system prompt to Tertiary via Wire context-injection
    const systemPrompt = sublimationLoop.getSystemPrompt();
    const envelopeResult = wire.createEnvelope({
      from: _secondarySessionId,
      to: _tertiarySessionId,
      type: MESSAGE_TYPES.CONTEXT_INJECTION,
      urgency: URGENCY_LEVELS.DIRECTIVE,
      payload: {
        role: 'system_prompt',
        content: systemPrompt,
        source: 'sublimation-loop',
      },
    });

    if (envelopeResult.ok) {
      try {
        await wire.send(envelopeResult.value);
      } catch (sendErr) {
        // Log failure but do NOT fail the upgrade
        // Tertiary can receive the prompt on reconnect via Wire buffered message queue
        if (switchboard) {
          switchboard.emit('session:context-injection-failed', {
            target: _tertiarySessionId,
            error: sendErr.message || 'Unknown send error',
          });
        }
      }
    }

    // Transition to ACTIVE
    _transition(SESSION_STATES.ACTIVE);

    return ok({
      state: _state,
      secondary: _secondarySessionId,
      tertiary: _tertiarySessionId,
    });
  }

  /**
   * Degrades from Active to Passive mode by stopping Tertiary session.
   *
   * Transition: active -> degrading -> passive
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function degrade() {
    // Transition to DEGRADING (validates current state is active)
    const degradeResult = _transition(SESSION_STATES.DEGRADING);
    if (!degradeResult.ok) {
      return degradeResult;
    }

    // Stop Tertiary
    if (_tertiarySessionId) {
      conductor.stopSession(_tertiarySessionId);
      wire.unregister(_tertiarySessionId);
      _tertiarySessionId = null;
    }

    // Transition to PASSIVE
    _transition(SESSION_STATES.PASSIVE);

    return ok({ state: _state });
  }

  /**
   * Initiates shutdown without completing to STOPPED.
   * Transitions to SHUTTING_DOWN state, allowing transitionToRem() to be called.
   * This is the entry point for the REM lifecycle path.
   *
   * Transition: (passive|active) -> shutting_down
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function initShutdown() {
    const shutdownResult = _transition(SESSION_STATES.SHUTTING_DOWN);
    if (!shutdownResult.ok) {
      return shutdownResult;
    }

    return ok({ state: _state });
  }

  /**
   * Transitions from SHUTTING_DOWN to REM_PROCESSING.
   * Stops Tertiary if present but keeps Secondary alive for REM consolidation.
   * Per D-13: Secondary stays alive and runs REM in-process.
   *
   * Transition: shutting_down -> rem_processing
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function transitionToRem() {
    const remResult = _transition(SESSION_STATES.REM_PROCESSING);
    if (!remResult.ok) {
      return remResult;
    }

    // Stop Tertiary if present — REM doesn't need it
    if (_tertiarySessionId) {
      conductor.stopSession(_tertiarySessionId);
      wire.unregister(_tertiarySessionId);
      _tertiarySessionId = null;
    }

    // Secondary stays alive — this is the key difference from stop()
    return ok({ state: _state, secondary: _secondarySessionId });
  }

  /**
   * Completes REM processing by stopping Secondary and transitioning to STOPPED.
   * Called after REM consolidation pipeline finishes.
   *
   * Transition: rem_processing -> stopped
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function completeRem() {
    const completeResult = _transition(SESSION_STATES.STOPPED);
    if (!completeResult.ok) {
      return completeResult;
    }

    // Stop Secondary — REM is complete
    if (_secondarySessionId) {
      conductor.stopSession(_secondarySessionId);
      wire.unregister(_secondarySessionId);
      _secondarySessionId = null;
    }

    return ok({ state: _state });
  }

  /**
   * Stops all sessions with ordered shutdown: Tertiary first, then Secondary.
   *
   * Transition: (passive|active) -> shutting_down -> stopped
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function stop() {
    // Transition to SHUTTING_DOWN
    const shutdownResult = _transition(SESSION_STATES.SHUTTING_DOWN);
    if (!shutdownResult.ok) {
      return shutdownResult;
    }

    // Ordered shutdown: Tertiary first
    if (_tertiarySessionId) {
      conductor.stopSession(_tertiarySessionId);
      wire.unregister(_tertiarySessionId);
      _tertiarySessionId = null;
    }

    // Then Secondary
    if (_secondarySessionId) {
      conductor.stopSession(_secondarySessionId);
      wire.unregister(_secondarySessionId);
      _secondarySessionId = null;
    }

    // Transition to STOPPED
    _transition(SESSION_STATES.STOPPED);

    return ok({ state: _state });
  }

  /**
   * Returns the current session manager state.
   *
   * @returns {{ state: string, secondary: string|null, tertiary: string|null, config: Object }}
   */
  function getState() {
    return {
      state: _state,
      secondary: _secondarySessionId,
      tertiary: _tertiarySessionId,
      config: _config,
    };
  }

  // ---------------------------------------------------------------------------
  // Return frozen public API
  // ---------------------------------------------------------------------------

  return Object.freeze({
    start,
    stop,
    upgrade,
    degrade,
    initShutdown,
    transitionToRem,
    completeRem,
    getState,
  });
}

module.exports = { createSessionManager };
