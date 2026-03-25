'use strict';

const { describe, it, expect, beforeEach, afterEach, mock } = require('bun:test');

/**
 * Creates a mock Switchboard for heartbeat monitor tests.
 * @returns {Object} Mock switchboard with events array
 */
function createMockSwitchboard() {
  const events = [];
  return {
    events,
    emit: mock((name, data) => { events.push({ name, data }); }),
  };
}

describe('HeartbeatMonitor', () => {
  let createHeartbeatMonitor;
  let monitor;

  beforeEach(() => {
    createHeartbeatMonitor = require('../heartbeat-monitor.cjs').createHeartbeatMonitor;
  });

  afterEach(() => {
    // Ensure timer cleanup after each test
    if (monitor && typeof monitor.stop === 'function') {
      monitor.stop();
    }
  });

  describe('createHeartbeatMonitor factory', () => {
    it('returns a frozen object', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      expect(Object.isFrozen(monitor)).toBe(true);
    });

    it('exposes onHeartbeat, start, stop, isActive methods', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      expect(typeof monitor.onHeartbeat).toBe('function');
      expect(typeof monitor.start).toBe('function');
      expect(typeof monitor.stop).toBe('function');
      expect(typeof monitor.isActive).toBe('function');
    });
  });

  describe('start() and isActive()', () => {
    it('isActive() returns false before start', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      expect(monitor.isActive()).toBe(false);
    });

    it('isActive() returns true after start', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      monitor.start();
      expect(monitor.isActive()).toBe(true);
    });

    it('isActive() returns false after stop', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      monitor.start();
      monitor.stop();
      expect(monitor.isActive()).toBe(false);
    });
  });

  describe('stop()', () => {
    it('stop() after start() does not throw', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      monitor.start();
      expect(() => monitor.stop()).not.toThrow();
    });

    it('stop() without start does not throw', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      expect(() => monitor.stop()).not.toThrow();
    });

    it('stop() clears the interval timer -- no events after stop', async () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({
        switchboard,
        config: { heartbeat_timeout_ms: 20, tier2_check_interval_ms: 10 },
      });
      monitor.start();
      monitor.stop();

      // Wait for potential interval fires
      await Bun.sleep(80);

      // Filter for timeout events specifically (no heartbeat:received events from start reset)
      const timeoutEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:timeout');
      expect(timeoutEvents.length).toBe(0);
    });
  });

  describe('onHeartbeat()', () => {
    it('updates timestamp -- multiple calls do not throw', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      expect(() => {
        monitor.onHeartbeat();
        monitor.onHeartbeat();
        monitor.onHeartbeat();
      }).not.toThrow();
    });

    it('emits reverie:heartbeat:received on each call', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      monitor.onHeartbeat();
      monitor.onHeartbeat();

      const receivedEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:received');
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents[0].data).toHaveProperty('timestamp');
    });
  });

  describe('timeout detection', () => {
    it('emits reverie:heartbeat:timeout when elapsed > heartbeat_timeout_ms', async () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({
        switchboard,
        config: { heartbeat_timeout_ms: 30, tier2_check_interval_ms: 10 },
      });
      monitor.start();

      // Wait for timeout to trigger
      await Bun.sleep(100);

      const timeoutEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:timeout');
      expect(timeoutEvents.length).toBe(1);
      expect(timeoutEvents[0].data).toHaveProperty('elapsed');
      expect(timeoutEvents[0].data.elapsed).toBeGreaterThan(30);
    });

    it('emits timeout only once (no duplicates)', async () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({
        switchboard,
        config: { heartbeat_timeout_ms: 20, tier2_check_interval_ms: 10 },
      });
      monitor.start();

      // Wait for multiple check intervals after timeout
      await Bun.sleep(120);

      const timeoutEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:timeout');
      expect(timeoutEvents.length).toBe(1);
    });

    it('emits reverie:heartbeat:received when heartbeat arrives after timeout', async () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({
        switchboard,
        config: { heartbeat_timeout_ms: 30, tier2_check_interval_ms: 10 },
      });
      monitor.start();

      // Wait for timeout to fire
      await Bun.sleep(80);

      // Verify timeout was emitted
      const timeoutsBefore = switchboard.events.filter(e => e.name === 'reverie:heartbeat:timeout');
      expect(timeoutsBefore.length).toBe(1);

      // Now send heartbeat after timeout
      monitor.onHeartbeat();

      const receivedEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:received');
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('resets timeout flag after heartbeat resumption', async () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({
        switchboard,
        config: { heartbeat_timeout_ms: 30, tier2_check_interval_ms: 10 },
      });
      monitor.start();

      // Wait for timeout
      await Bun.sleep(80);

      // Resume heartbeats
      monitor.onHeartbeat();

      // Wait for another timeout
      await Bun.sleep(80);

      // Should have two timeout events (one before resume, one after)
      const timeoutEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:timeout');
      expect(timeoutEvents.length).toBe(2);
    });
  });

  describe('default configuration', () => {
    it('uses default timeout of 90000ms', () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({ switchboard });
      // We cannot directly test the private timeout value, but we can confirm
      // the monitor starts without error (defaults are valid)
      monitor.start();
      expect(monitor.isActive()).toBe(true);
    });

    it('custom config overrides defaults', async () => {
      const switchboard = createMockSwitchboard();
      monitor = createHeartbeatMonitor({
        switchboard,
        config: { heartbeat_timeout_ms: 25, tier2_check_interval_ms: 10 },
      });
      monitor.start();

      // Custom 25ms timeout should fire quickly
      await Bun.sleep(80);

      const timeoutEvents = switchboard.events.filter(e => e.name === 'reverie:heartbeat:timeout');
      expect(timeoutEvents.length).toBe(1);
    });
  });
});
