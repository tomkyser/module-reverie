'use strict';

/**
 * Heartbeat monitor -- Wire heartbeat timeout detection for Tier 2 REM.
 *
 * Per D-02: Primary sends periodic heartbeats to Secondary via Wire. When
 * heartbeats stop, Secondary initiates Tier 2 provisional REM. This monitor
 * tracks heartbeat timing and emits events when timeouts are detected.
 *
 * Distinguishes three session states:
 * 1. Active: heartbeats + hook events flowing
 * 2. Idle: heartbeats flowing, no hook events
 * 3. Dead/disconnected: heartbeats stop -> triggers Tier 2
 *
 * Per D-03: When heartbeats resume after timeout, emits received event
 * to signal abort-and-revert for any in-progress Tier 2 consolidation.
 *
 * @module reverie/components/rem/heartbeat-monitor
 */

// ---------------------------------------------------------------------------
// Defaults (from REM_DEFAULTS per Plan 01)
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90000;
const DEFAULT_CHECK_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a heartbeat monitor instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.config] - Configuration overrides
 * @param {number} [options.config.heartbeat_timeout_ms] - Timeout threshold (default: 90000)
 * @param {number} [options.config.tier2_check_interval_ms] - Check interval (default: 5000)
 * @returns {Readonly<{ onHeartbeat: Function, start: Function, stop: Function, isActive: Function }>}
 */
function createHeartbeatMonitor(options) {
  const opts = options || {};
  const switchboard = opts.switchboard || null;
  const config = opts.config || {};

  const _timeout = (config.heartbeat_timeout_ms != null)
    ? config.heartbeat_timeout_ms
    : DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const _checkInterval = (config.tier2_check_interval_ms != null)
    ? config.tier2_check_interval_ms
    : DEFAULT_CHECK_INTERVAL_MS;

  let _lastHeartbeat = Date.now();
  let _timer = null;
  let _active = false;
  let _timeoutEmitted = false;

  /**
   * Records a heartbeat reception. Resets timeout tracking.
   *
   * Per D-03: If a timeout was previously emitted, heartbeat resumption
   * signals abort for in-progress Tier 2 consolidation.
   */
  function onHeartbeat() {
    _lastHeartbeat = Date.now();
    _timeoutEmitted = false;
    if (switchboard) {
      switchboard.emit('reverie:heartbeat:received', { timestamp: _lastHeartbeat });
    }
  }

  /**
   * Internal check function called on each interval tick.
   * Emits timeout event once when elapsed time exceeds threshold.
   */
  function _check() {
    if (!_active) return;
    const elapsed = Date.now() - _lastHeartbeat;
    if (elapsed > _timeout && !_timeoutEmitted) {
      _timeoutEmitted = true;
      if (switchboard) {
        switchboard.emit('reverie:heartbeat:timeout', { elapsed });
      }
    }
  }

  /**
   * Starts the heartbeat monitor. Begins interval-based checking.
   * Resets heartbeat timestamp and timeout flag on start.
   */
  function start() {
    _active = true;
    _lastHeartbeat = Date.now();
    _timeoutEmitted = false;
    _timer = setInterval(_check, _checkInterval);
  }

  /**
   * Stops the heartbeat monitor. Clears the interval timer.
   * Safe to call multiple times or without prior start.
   */
  function stop() {
    _active = false;
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  /**
   * Returns whether the monitor is currently active.
   * @returns {boolean}
   */
  function isActive() {
    return _active;
  }

  return Object.freeze({ onHeartbeat, start, stop, isActive });
}

module.exports = { createHeartbeatMonitor };
