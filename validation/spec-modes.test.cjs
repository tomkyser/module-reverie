'use strict';

/**
 * Spec compliance test: Operational Modes (reverie-spec-v2.md sections 7.1-7.4).
 *
 * Verifies:
 * - Section 7.1: Active mode — three sessions (Primary + Secondary + Tertiary)
 * - Section 7.2: Passive mode — Primary + lightweight Secondary only, no Tertiary
 * - Section 7.3: REM mode — post-session consolidation, Secondary only
 * - Section 7.4: Dormant mode — no sessions, scheduled decay maintenance only
 * - Mode transitions: Active->Passive (resource limit), Active->REM (session end),
 *   REM->Dormant (consolidation complete)
 *
 * Known deviations (documented in STATE.md):
 * - [Phase 12] Mode Manager uses getMode() returning string — intentional deviation
 *
 * @module reverie/validation/spec-modes.test
 */

const { describe, it, expect } = require('bun:test');

// ---------------------------------------------------------------------------
// Operational Modes: Spec sections 7.1-7.4 compliance
// ---------------------------------------------------------------------------

describe('Operational Modes: Spec sections 7.1-7.4 compliance', () => {

  // -------------------------------------------------------------------------
  // Setup helper: create Mode Manager with mock dependencies
  // -------------------------------------------------------------------------

  function createTestModeManager(overrides) {
    const { createModeManager, OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');

    const mockSessionManager = {
      upgrade: async () => ({ ok: true, value: {} }),
      degrade: async () => ({ ok: true, value: {} }),
      getState: () => ({ state: 'running', secondary: 'sec-1', tertiary: 'ter-1' }),
      ...(overrides && overrides.sessionManager),
    };

    const mockConductor = {
      getSessionHealth: (id) => ({ ok: true, value: { alive: true } }),
      ...(overrides && overrides.conductor),
    };

    const events = [];
    const mockSwitchboard = {
      emit: (event, data) => events.push({ event, data }),
      on: () => {},
      ...(overrides && overrides.switchboard),
    };

    const mm = createModeManager({
      sessionManager: mockSessionManager,
      conductor: mockConductor,
      switchboard: mockSwitchboard,
      config: {},
    });

    return { mm, events, OPERATIONAL_MODES };
  }

  // -------------------------------------------------------------------------
  // Spec 7.1: Active Mode
  // -------------------------------------------------------------------------

  describe('Spec 7.1: Active Mode', () => {
    it('OPERATIONAL_MODES constant includes ACTIVE', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      expect(OPERATIONAL_MODES.ACTIVE).toBe('active');
    });

    it('requesting Active mode calls sessionManager.upgrade()', async () => {
      let upgradeCalled = false;
      const { mm } = createTestModeManager({
        sessionManager: {
          upgrade: async () => { upgradeCalled = true; return { ok: true, value: {} }; },
          degrade: async () => ({ ok: true, value: {} }),
          getState: () => ({ state: 'running', secondary: 'sec-1', tertiary: 'ter-1' }),
        },
      });

      await mm.requestActive();
      expect(upgradeCalled).toBe(true);
    });

    it('Active mode reports 2 active sessions (Secondary + Tertiary)', async () => {
      const { mm } = createTestModeManager();
      await mm.requestActive();
      const metrics = mm.getMetrics();
      expect(metrics.active_sessions_count).toBe(2);
    });

    it('Active mode getMode() returns "active" string (known deviation per Phase 12)', async () => {
      const { mm } = createTestModeManager();
      await mm.requestActive();
      expect(mm.getMode()).toBe('active');
    });
  });

  // -------------------------------------------------------------------------
  // Spec 7.2: Passive Mode
  // -------------------------------------------------------------------------

  describe('Spec 7.2: Passive Mode', () => {
    it('OPERATIONAL_MODES constant includes PASSIVE', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      expect(OPERATIONAL_MODES.PASSIVE).toBe('passive');
    });

    it('default mode is Passive on creation', () => {
      const { mm } = createTestModeManager();
      expect(mm.getMode()).toBe('passive');
    });

    it('Passive mode reports 1 active session (Secondary only)', () => {
      const { mm } = createTestModeManager();
      const metrics = mm.getMetrics();
      expect(metrics.active_sessions_count).toBe(1);
    });

    it('transitioning from Active to Passive calls sessionManager.degrade()', async () => {
      let degradeCalled = false;
      const { mm } = createTestModeManager({
        sessionManager: {
          upgrade: async () => ({ ok: true, value: {} }),
          degrade: async () => { degradeCalled = true; return { ok: true, value: {} }; },
          getState: () => ({ state: 'running', secondary: 'sec-1', tertiary: 'ter-1' }),
        },
      });

      await mm.requestActive();
      await mm.requestPassive();
      expect(degradeCalled).toBe(true);
    });

    it('Passive mode getMode() returns "passive"', () => {
      const { mm } = createTestModeManager();
      expect(mm.getMode()).toBe('passive');
    });
  });

  // -------------------------------------------------------------------------
  // Spec 7.3: REM Mode
  // -------------------------------------------------------------------------

  describe('Spec 7.3: REM Mode', () => {
    it('OPERATIONAL_MODES constant includes REM', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      expect(OPERATIONAL_MODES.REM).toBe('rem');
    });

    it('can transition from Passive to REM', async () => {
      const { mm } = createTestModeManager();
      const result = await mm.requestRem('session_end');
      expect(result.ok).toBe(true);
      expect(mm.getMode()).toBe('rem');
    });

    it('can transition from Active to REM (degrades first)', async () => {
      let degradeCalled = false;
      const { mm } = createTestModeManager({
        sessionManager: {
          upgrade: async () => ({ ok: true, value: {} }),
          degrade: async () => { degradeCalled = true; return { ok: true, value: {} }; },
          getState: () => ({ state: 'running', secondary: 'sec-1', tertiary: 'ter-1' }),
        },
      });

      await mm.requestActive();
      await mm.requestRem('session_end');
      expect(degradeCalled).toBe(true);
      expect(mm.getMode()).toBe('rem');
    });

    it('REM mode reports 1 active session (Secondary only per spec 7.3)', async () => {
      const { mm } = createTestModeManager();
      await mm.requestRem('session_end');
      const metrics = mm.getMetrics();
      expect(metrics.active_sessions_count).toBe(1);
    });

    it('cannot transition from Dormant to REM (invalid)', async () => {
      const { mm } = createTestModeManager();
      await mm.requestRem('session_end');
      await mm.requestDormant();
      const result = await mm.requestRem();
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Spec 7.4: Dormant Mode
  // -------------------------------------------------------------------------

  describe('Spec 7.4: Dormant Mode', () => {
    it('OPERATIONAL_MODES constant includes DORMANT', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      expect(OPERATIONAL_MODES.DORMANT).toBe('dormant');
    });

    it('can transition from REM to Dormant', async () => {
      const { mm } = createTestModeManager();
      await mm.requestRem('session_end');
      const result = await mm.requestDormant();
      expect(result.ok).toBe(true);
      expect(mm.getMode()).toBe('dormant');
    });

    it('Dormant mode reports 0 active sessions', async () => {
      const { mm } = createTestModeManager();
      await mm.requestRem('session_end');
      await mm.requestDormant();
      const metrics = mm.getMetrics();
      expect(metrics.active_sessions_count).toBe(0);
    });

    it('cannot transition directly from Active to Dormant (must go through REM)', async () => {
      const { mm } = createTestModeManager();
      await mm.requestActive();
      const result = await mm.requestDormant();
      expect(result.ok).toBe(false);
    });

    it('cannot transition directly from Passive to Dormant (must go through REM)', async () => {
      const { mm } = createTestModeManager();
      const result = await mm.requestDormant();
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Mode Transitions
  // -------------------------------------------------------------------------

  describe('Mode Transitions', () => {
    it('Active -> Passive transition on resource limit (requestPassive)', async () => {
      const { mm, events } = createTestModeManager();
      await mm.requestActive();
      expect(mm.getMode()).toBe('active');

      await mm.requestPassive();
      expect(mm.getMode()).toBe('passive');

      // Verify mode:changed event was emitted
      const modeChanges = events.filter(e => e.event === 'mode:changed');
      expect(modeChanges.length).toBeGreaterThanOrEqual(2); // active + passive
    });

    it('Active -> REM transition on session end', async () => {
      const { mm } = createTestModeManager();
      await mm.requestActive();
      await mm.requestRem('session_end');
      expect(mm.getMode()).toBe('rem');
    });

    it('REM -> Dormant transition on consolidation complete', async () => {
      const { mm } = createTestModeManager();
      await mm.requestRem('session_end');
      await mm.requestDormant();
      expect(mm.getMode()).toBe('dormant');
    });

    it('automatic fallback: Active -> Passive on Tertiary health failure', async () => {
      const { mm } = createTestModeManager({
        conductor: {
          getSessionHealth: (id) => {
            // Tertiary is dead
            if (id && id.includes && id.includes('ter')) {
              return { ok: true, value: { alive: false } };
            }
            return { ok: true, value: { alive: true } };
          },
        },
        sessionManager: {
          upgrade: async () => ({ ok: true, value: {} }),
          degrade: async () => ({ ok: true, value: {} }),
          getState: () => ({ state: 'running', secondary: 'sec-1', tertiary: 'ter-1' }),
        },
      });

      await mm.requestActive();
      expect(mm.getMode()).toBe('active');

      // Health check should detect Tertiary failure and auto-degrade
      await mm.checkHealth();
      expect(mm.getMode()).toBe('passive');
    });

    it('mode:changed event emitted on every transition', async () => {
      const { mm, events } = createTestModeManager();

      await mm.requestActive();
      await mm.requestPassive();
      await mm.requestRem('session_end');
      await mm.requestDormant();

      const modeChanges = events.filter(e => e.event === 'mode:changed');
      expect(modeChanges.length).toBe(4);

      // Verify transition sequence
      expect(modeChanges[0].data.from).toBe('passive');
      expect(modeChanges[0].data.to).toBe('active');
      expect(modeChanges[1].data.from).toBe('active');
      expect(modeChanges[1].data.to).toBe('passive');
      expect(modeChanges[2].data.from).toBe('passive');
      expect(modeChanges[2].data.to).toBe('rem');
      expect(modeChanges[3].data.from).toBe('rem');
      expect(modeChanges[3].data.to).toBe('dormant');
    });

    it('getMetrics tracks mode changes', async () => {
      const { mm } = createTestModeManager();

      await mm.requestActive();
      await mm.requestPassive();
      await mm.requestRem('session_end');

      const metrics = mm.getMetrics();
      expect(metrics.mode_changes).toBe(3);
    });

    it('requesting current mode is a no-op (idempotent)', async () => {
      const { mm } = createTestModeManager();
      const result1 = await mm.requestPassive();
      expect(result1.ok).toBe(true);
      expect(result1.value.changed).toBe(false);

      await mm.requestActive();
      const result2 = await mm.requestActive();
      expect(result2.ok).toBe(true);
      expect(result2.value.changed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // All Four Modes Enumerated
  // -------------------------------------------------------------------------

  describe('All Four Modes Enumerated', () => {
    it('OPERATIONAL_MODES has exactly 4 modes: ACTIVE, PASSIVE, REM, DORMANT', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      const keys = Object.keys(OPERATIONAL_MODES);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('ACTIVE');
      expect(keys).toContain('PASSIVE');
      expect(keys).toContain('REM');
      expect(keys).toContain('DORMANT');
    });

    it('OPERATIONAL_MODES values are lowercase strings', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      expect(OPERATIONAL_MODES.ACTIVE).toBe('active');
      expect(OPERATIONAL_MODES.PASSIVE).toBe('passive');
      expect(OPERATIONAL_MODES.REM).toBe('rem');
      expect(OPERATIONAL_MODES.DORMANT).toBe('dormant');
    });

    it('OPERATIONAL_MODES is frozen (immutable)', () => {
      const { OPERATIONAL_MODES } = require('../components/modes/mode-manager.cjs');
      expect(Object.isFrozen(OPERATIONAL_MODES)).toBe(true);
    });
  });
});
