'use strict';

/**
 * Wire topology enforcement and ACK protocol for three-session architecture.
 *
 * Wraps Wire's send/subscribe with topology validation per spec S4.1:
 * Primary <-> Secondary <-> Tertiary (no Primary <-> Tertiary bypass).
 *
 * ACK protocol ensures critical messages (context-injection, directive at
 * urgent/directive urgency) are reliably delivered. On ACK timeout, resends
 * via relay transport as fallback per Pitfall 2.
 *
 * Per D-03: Wire handles communication: message routing, topology enforcement,
 * urgency-level delivery, ACK protocol.
 *
 * @module reverie/components/session/wire-topology
 */

const { ok, err } = require('../../../../lib/result.cjs');
const { TOPOLOGY_RULES } = require('./session-config.cjs');
const { MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../core/services/wire/protocol.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Message types that require ACK protocol for reliable delivery.
 * Per Pitfall 2: context-injection and directive messages are critical.
 *
 * @type {Set<string>}
 */
const ACK_REQUIRED_TYPES = new Set([
  MESSAGE_TYPES.CONTEXT_INJECTION,
  MESSAGE_TYPES.DIRECTIVE,
]);

/**
 * Urgency levels that trigger ACK protocol.
 * Only urgent and directive urgency levels require ACK.
 *
 * @type {Set<string>}
 */
const ACK_REQUIRED_URGENCIES = new Set([
  URGENCY_LEVELS.URGENT,
  URGENCY_LEVELS.DIRECTIVE,
]);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Wire topology enforcement instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.wire - Wire service instance (send, subscribe, register)
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.config] - Configuration overrides
 * @param {number} [options.config.ack_timeout_ms=5000] - ACK timeout in milliseconds
 * @returns {Readonly<{
 *   send: Function,
 *   subscribe: Function,
 *   validateRoute: Function,
 *   waitForAck: Function,
 *   getMetrics: Function,
 *   _handleIncomingAck: Function
 * }>}
 */
function createWireTopology(options) {
  const opts = options || {};
  const wire = opts.wire;
  const switchboard = opts.switchboard || null;
  const config = opts.config || {};

  const ackTimeoutMs = config.ack_timeout_ms != null ? config.ack_timeout_ms : 5000;

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  let _messagesSent = 0;
  let _messagesBlocked = 0;
  let _ackTimeouts = 0;
  let _topologyViolations = 0;

  /** @type {Map<string, { resolve: Function, timer: ReturnType<typeof setTimeout> }>} */
  const _pendingAcks = new Map();

  // -------------------------------------------------------------------------
  // validateRoute
  // -------------------------------------------------------------------------

  /**
   * Validates a send route against TOPOLOGY_RULES.
   *
   * @param {string} fromIdentity - Sender session identity (primary/secondary/tertiary)
   * @param {string} toIdentity - Receiver session identity
   * @returns {import('../../../../lib/result.cjs').Result<{ from: string, to: string }>}
   */
  function validateRoute(fromIdentity, toIdentity) {
    const allowed = TOPOLOGY_RULES[fromIdentity];

    if (!allowed || !allowed.includes(toIdentity)) {
      _topologyViolations++;
      return err('TOPOLOGY_VIOLATION', `${fromIdentity} cannot send to ${toIdentity}`, {
        allowed: allowed ? [...allowed] : [],
      });
    }

    return ok({ from: fromIdentity, to: toIdentity });
  }

  // -------------------------------------------------------------------------
  // _handleIncomingAck
  // -------------------------------------------------------------------------

  /**
   * Handles an incoming ACK message, resolving any pending waitForAck promise.
   *
   * @param {Object} envelope - Incoming envelope with type 'ack'
   */
  function _handleIncomingAck(envelope) {
    if (envelope.type === MESSAGE_TYPES.ACK || envelope.type === 'ack') {
      const correlationId = envelope.correlationId;
      if (correlationId && _pendingAcks.has(correlationId)) {
        const pending = _pendingAcks.get(correlationId);
        clearTimeout(pending.timer);
        pending.resolve(ok({ acked: true, correlationId }));
        _pendingAcks.delete(correlationId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // waitForAck
  // -------------------------------------------------------------------------

  /**
   * Waits for an ACK message with the given correlation ID.
   *
   * @param {string} envelopeId - Envelope ID to wait for ACK
   * @param {number} [timeoutMs] - Timeout in milliseconds (defaults to config.ack_timeout_ms)
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  function waitForAck(envelopeId, timeoutMs) {
    const timeout = timeoutMs != null ? timeoutMs : ackTimeoutMs;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        _pendingAcks.delete(envelopeId);
        _ackTimeouts++;
        resolve(err('ACK_TIMEOUT', `ACK not received within ${timeout}ms for envelope: ${envelopeId}`));
      }, timeout);

      _pendingAcks.set(envelopeId, { resolve, timer });
    });
  }

  // -------------------------------------------------------------------------
  // sendWithAck
  // -------------------------------------------------------------------------

  /**
   * Sends an envelope with ACK protocol -- waits for ACK, resends on timeout.
   *
   * @param {Object} envelope - Wire message envelope
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function sendWithAck(envelope) {
    // First attempt
    const sendResult = await wire.send(envelope);
    _messagesSent++;

    if (!sendResult.ok) {
      return sendResult;
    }

    // Wait for ACK
    const ackResult = await waitForAck(envelope.id, ackTimeoutMs);

    if (ackResult.ok) {
      return ok({ sent: true, acked: true });
    }

    // ACK timed out -- resend via relay with _forceRelay flag
    const resendEnvelope = Object.assign({}, envelope, { _forceRelay: true });
    const resendResult = await wire.send(resendEnvelope);
    _messagesSent++;

    if (resendResult.ok) {
      return ok({ sent: true, acked: false, resent: true });
    }

    return err('SEND_FAILED', 'Both initial send and relay resend failed', {
      envelopeId: envelope.id,
    });
  }

  // -------------------------------------------------------------------------
  // send
  // -------------------------------------------------------------------------

  /**
   * Sends an envelope through Wire with topology validation.
   *
   * If the route violates topology rules, the message is blocked.
   * If the message type and urgency require ACK, delegates to sendWithAck.
   *
   * @param {Object} envelope - Wire message envelope
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function send(envelope) {
    // Extract identities from envelope
    const fromIdentity = envelope.from;
    const toIdentity = envelope.to;

    // Validate route
    const routeResult = validateRoute(fromIdentity, toIdentity);
    if (!routeResult.ok) {
      _messagesBlocked++;
      return routeResult;
    }

    // Determine if ACK is required
    const needsAck = ACK_REQUIRED_TYPES.has(envelope.type) &&
      ACK_REQUIRED_URGENCIES.has(envelope.urgency);

    if (needsAck) {
      return sendWithAck(envelope);
    }

    // Standard send
    const result = await wire.send(envelope);
    if (result.ok) {
      _messagesSent++;
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // subscribe
  // -------------------------------------------------------------------------

  /**
   * Subscribes to messages for a session, filtering by topology rules.
   *
   * Only delivers messages from senders allowed by TOPOLOGY_RULES for
   * the subscriber's identity. ACK messages are routed to _handleIncomingAck.
   *
   * @param {string} sessionId - Wire session ID to subscribe to
   * @param {string} subscriberIdentity - Subscriber's session identity (primary/secondary/tertiary)
   * @param {Function} callback - Called with each valid incoming envelope
   * @returns {Function} Unsubscribe function
   */
  function subscribe(sessionId, subscriberIdentity, callback) {
    const allowedSenders = TOPOLOGY_RULES[subscriberIdentity] || [];

    const unsubscribe = wire.subscribe(sessionId, function topologyFilter(envelope) {
      // Route ACK messages to internal handler
      if (envelope.type === MESSAGE_TYPES.ACK || envelope.type === 'ack') {
        _handleIncomingAck(envelope);
        return;
      }

      // Validate sender is in topology rules for this subscriber
      const senderIdentity = envelope.from;
      if (!allowedSenders.includes(senderIdentity)) {
        // Topology violation on incoming -- do not deliver
        if (switchboard) {
          switchboard.emit('reverie:topology:incoming-violation', {
            from: senderIdentity,
            to: subscriberIdentity,
            sessionId,
          });
        }
        return;
      }

      // Valid sender -- deliver
      callback(envelope);
    });

    return unsubscribe;
  }

  // -------------------------------------------------------------------------
  // getMetrics
  // -------------------------------------------------------------------------

  /**
   * Returns topology enforcement metrics.
   *
   * @returns {{
   *   messages_sent: number,
   *   messages_blocked: number,
   *   ack_timeouts: number,
   *   topology_violations: number
   * }}
   */
  function getMetrics() {
    return {
      messages_sent: _messagesSent,
      messages_blocked: _messagesBlocked,
      ack_timeouts: _ackTimeouts,
      topology_violations: _topologyViolations,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return Object.freeze({
    send,
    subscribe,
    validateRoute,
    waitForAck,
    getMetrics,
    _handleIncomingAck, // exposed for test ACK routing
  });
}

module.exports = { createWireTopology };
