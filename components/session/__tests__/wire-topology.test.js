'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');
const { createWireTopology } = require('../wire-topology.cjs');

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockWire() {
  const sends = [];
  const subscribers = new Map();

  return {
    async send(envelope) {
      sends.push(envelope);
      return { ok: true, value: undefined };
    },
    subscribe(sessionId, callback) {
      if (!subscribers.has(sessionId)) {
        subscribers.set(sessionId, []);
      }
      subscribers.get(sessionId).push(callback);
      return function unsubscribe() {
        const cbs = subscribers.get(sessionId);
        if (cbs) {
          const idx = cbs.indexOf(callback);
          if (idx !== -1) cbs.splice(idx, 1);
        }
      };
    },
    // Test helper: simulate incoming message to a session
    _deliver(sessionId, envelope) {
      const cbs = subscribers.get(sessionId) || [];
      for (const cb of cbs) cb(envelope);
    },
    _sends: sends,
    _subscribers: subscribers,
  };
}

function createMockSwitchboard() {
  const events = [];
  return {
    emit(event, data) { events.push({ event, data }); },
    _events: events,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wire-topology', () => {
  let wire;
  let switchboard;
  let config;

  beforeEach(() => {
    wire = createMockWire();
    switchboard = createMockSwitchboard();
    config = { ack_timeout_ms: 200 }; // short timeout for tests
  });

  function createDefault(overrides = {}) {
    return createWireTopology({
      wire,
      switchboard,
      config,
      ...overrides,
    });
  }

  describe('factory', () => {
    it('returns instance with send, subscribe, validateRoute, waitForAck, getMetrics', () => {
      const topology = createDefault();
      expect(typeof topology.send).toBe('function');
      expect(typeof topology.subscribe).toBe('function');
      expect(typeof topology.validateRoute).toBe('function');
      expect(typeof topology.waitForAck).toBe('function');
      expect(typeof topology.getMetrics).toBe('function');
    });
  });

  describe('validateRoute', () => {
    it('primary -> secondary returns ok (allowed by TOPOLOGY_RULES)', () => {
      const topology = createDefault();
      const result = topology.validateRoute('primary', 'secondary');
      expect(result.ok).toBe(true);
    });

    it('primary -> tertiary returns err TOPOLOGY_VIOLATION', () => {
      const topology = createDefault();
      const result = topology.validateRoute('primary', 'tertiary');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOPOLOGY_VIOLATION');
    });

    it('secondary -> primary returns ok', () => {
      const topology = createDefault();
      const result = topology.validateRoute('secondary', 'primary');
      expect(result.ok).toBe(true);
    });

    it('secondary -> tertiary returns ok', () => {
      const topology = createDefault();
      const result = topology.validateRoute('secondary', 'tertiary');
      expect(result.ok).toBe(true);
    });

    it('tertiary -> secondary returns ok', () => {
      const topology = createDefault();
      const result = topology.validateRoute('tertiary', 'secondary');
      expect(result.ok).toBe(true);
    });

    it('tertiary -> primary returns err TOPOLOGY_VIOLATION', () => {
      const topology = createDefault();
      const result = topology.validateRoute('tertiary', 'primary');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOPOLOGY_VIOLATION');
    });
  });

  describe('send', () => {
    it('with valid topology calls wire.send', async () => {
      const topology = createDefault();
      const envelope = {
        id: 'env-1',
        from: 'secondary',
        to: 'primary',
        type: 'snapshot',
        urgency: 'active',
        payload: { data: 'test' },
        timestamp: new Date().toISOString(),
        correlationId: null,
      };
      const result = await topology.send(envelope);
      expect(result.ok).toBe(true);
      expect(wire._sends.length).toBe(1);
    });

    it('with invalid topology returns err WITHOUT calling wire.send', async () => {
      const topology = createDefault();
      const envelope = {
        id: 'env-2',
        from: 'primary',
        to: 'tertiary',
        type: 'snapshot',
        urgency: 'active',
        payload: { data: 'test' },
        timestamp: new Date().toISOString(),
        correlationId: null,
      };
      const result = await topology.send(envelope);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TOPOLOGY_VIOLATION');
      expect(wire._sends.length).toBe(0);
    });

    it('with urgency directive and type context-injection uses ACK protocol', async () => {
      const topology = createDefault();
      const envelope = {
        id: 'env-ack-1',
        from: 'secondary',
        to: 'primary',
        type: 'context-injection',
        urgency: 'directive',
        payload: { data: 'critical' },
        timestamp: new Date().toISOString(),
        correlationId: null,
      };

      // Simulate ACK arriving quickly
      setTimeout(() => {
        topology._handleIncomingAck({
          type: 'ack',
          correlationId: 'env-ack-1',
        });
      }, 10);

      const result = await topology.send(envelope);
      expect(result.ok).toBe(true);
      // Should have sent (at least) one message
      expect(wire._sends.length).toBeGreaterThanOrEqual(1);
    });

    it('with urgency urgent and type directive uses ACK protocol', async () => {
      const topology = createDefault();
      const envelope = {
        id: 'env-ack-2',
        from: 'secondary',
        to: 'primary',
        type: 'directive',
        urgency: 'urgent',
        payload: { data: 'urgent directive' },
        timestamp: new Date().toISOString(),
        correlationId: null,
      };

      // Simulate ACK arriving quickly
      setTimeout(() => {
        topology._handleIncomingAck({
          type: 'ack',
          correlationId: 'env-ack-2',
        });
      }, 10);

      const result = await topology.send(envelope);
      expect(result.ok).toBe(true);
    });
  });

  describe('waitForAck', () => {
    it('resolves when ACK received via wire subscription', async () => {
      const topology = createDefault();
      const ackPromise = topology.waitForAck('test-envelope-id', 1000);

      // Simulate ACK arriving
      setTimeout(() => {
        topology._handleIncomingAck({
          type: 'ack',
          correlationId: 'test-envelope-id',
        });
      }, 10);

      const result = await ackPromise;
      expect(result.ok).toBe(true);
    });

    it('times out after config.ack_timeout_ms and returns err ACK_TIMEOUT', async () => {
      const topology = createDefault({ config: { ack_timeout_ms: 50 } });
      const result = await topology.waitForAck('nonexistent-envelope', 50);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('ACK_TIMEOUT');
    });
  });

  describe('sendWithAck', () => {
    it('sends via primary transport, waits for ACK, resends on timeout', async () => {
      const topology = createDefault({ config: { ack_timeout_ms: 50 } });
      const envelope = {
        id: 'env-resend-1',
        from: 'secondary',
        to: 'primary',
        type: 'context-injection',
        urgency: 'urgent',
        payload: { data: 'test' },
        timestamp: new Date().toISOString(),
        correlationId: null,
      };

      // No ACK will arrive, so it should timeout and resend
      const result = await topology.send(envelope);
      // After timeout, resend should have occurred
      expect(wire._sends.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('subscribe', () => {
    it('wraps wire.subscribe with topology filtering on incoming messages', () => {
      const topology = createDefault();
      const received = [];
      topology.subscribe('secondary-session', 'secondary', (envelope) => {
        received.push(envelope);
      });

      // Message from primary (allowed for secondary subscriber)
      wire._deliver('secondary-session', {
        id: 'msg-1',
        from: 'primary',
        to: 'secondary-session',
        type: 'snapshot',
        urgency: 'active',
        timestamp: new Date().toISOString(),
        correlationId: null,
      });

      expect(received.length).toBe(1);
    });

    it('filters out messages from sessions not in subscriber TOPOLOGY_RULES', () => {
      const topology = createDefault();
      const received = [];
      topology.subscribe('secondary-session', 'secondary', (envelope) => {
        received.push(envelope);
      });

      // Message from unknown sender (not in topology rules)
      wire._deliver('secondary-session', {
        id: 'msg-blocked',
        from: 'unknown',
        to: 'secondary-session',
        type: 'snapshot',
        urgency: 'active',
        timestamp: new Date().toISOString(),
        correlationId: null,
      });

      expect(received.length).toBe(0);
    });

    it('routes ACK messages to _handleIncomingAck', async () => {
      const topology = createDefault();

      // Subscribe to a session
      topology.subscribe('secondary-session', 'secondary', () => {});

      // Set up ACK wait
      const ackPromise = topology.waitForAck('ack-route-test', 1000);

      // Deliver an ACK through the wire subscription path
      wire._deliver('secondary-session', {
        id: 'ack-msg-1',
        from: 'primary',
        to: 'secondary-session',
        type: 'ack',
        urgency: 'active',
        correlationId: 'ack-route-test',
        timestamp: new Date().toISOString(),
      });

      const result = await ackPromise;
      expect(result.ok).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('returns messages_sent, messages_blocked, ack_timeouts, topology_violations', () => {
      const topology = createDefault();
      const metrics = topology.getMetrics();
      expect(metrics).toEqual({
        messages_sent: 0,
        messages_blocked: 0,
        ack_timeouts: 0,
        topology_violations: 0,
      });
    });

    it('increments metrics after send operations', async () => {
      const topology = createDefault();

      // Valid send
      await topology.send({
        id: 'metric-1',
        from: 'secondary',
        to: 'primary',
        type: 'snapshot',
        urgency: 'active',
        payload: {},
        timestamp: new Date().toISOString(),
        correlationId: null,
      });

      // Invalid send (topology violation)
      await topology.send({
        id: 'metric-2',
        from: 'primary',
        to: 'tertiary',
        type: 'snapshot',
        urgency: 'active',
        payload: {},
        timestamp: new Date().toISOString(),
        correlationId: null,
      });

      const metrics = topology.getMetrics();
      expect(metrics.messages_sent).toBe(1);
      expect(metrics.messages_blocked).toBe(1);
      expect(metrics.topology_violations).toBe(1);
    });
  });
});
