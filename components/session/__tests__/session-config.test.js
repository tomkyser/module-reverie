'use strict';

const { describe, it, expect } = require('bun:test');

const {
  SESSION_IDENTITIES,
  SESSION_STATES,
  TRANSITIONS,
  FRAMING_MODES,
  TOPOLOGY_RULES,
  DEFAULT_SESSION_CONFIG,
  createSessionConfig,
} = require('../session-config.cjs');

describe('session-config', () => {
  describe('SESSION_IDENTITIES', () => {
    it('has exactly 3 entries: primary, secondary, tertiary', () => {
      expect(Object.keys(SESSION_IDENTITIES)).toHaveLength(3);
      expect(SESSION_IDENTITIES.PRIMARY).toBe('primary');
      expect(SESSION_IDENTITIES.SECONDARY).toBe('secondary');
      expect(SESSION_IDENTITIES.TERTIARY).toBe('tertiary');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(SESSION_IDENTITIES)).toBe(true);
    });
  });

  describe('SESSION_STATES', () => {
    it('has 9 entries matching spec (including REM_PROCESSING)', () => {
      const expected = [
        'uninitialized', 'starting', 'passive', 'upgrading',
        'active', 'degrading', 'shutting_down', 'rem_processing', 'stopped',
      ];
      const values = Object.values(SESSION_STATES);
      expect(values).toHaveLength(9);
      for (const s of expected) {
        expect(values).toContain(s);
      }
    });

    it('REM_PROCESSING exists and equals rem_processing', () => {
      expect(SESSION_STATES.REM_PROCESSING).toBe('rem_processing');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(SESSION_STATES)).toBe(true);
    });
  });

  describe('TRANSITIONS', () => {
    it('maps each state to its valid target states', () => {
      expect(TRANSITIONS[SESSION_STATES.UNINITIALIZED]).toEqual([SESSION_STATES.STARTING]);
      expect(TRANSITIONS[SESSION_STATES.STARTING]).toEqual([SESSION_STATES.PASSIVE, SESSION_STATES.STOPPED]);
      expect(TRANSITIONS[SESSION_STATES.PASSIVE]).toEqual([SESSION_STATES.UPGRADING, SESSION_STATES.SHUTTING_DOWN]);
      expect(TRANSITIONS[SESSION_STATES.UPGRADING]).toEqual([SESSION_STATES.ACTIVE, SESSION_STATES.PASSIVE]);
      expect(TRANSITIONS[SESSION_STATES.ACTIVE]).toEqual([SESSION_STATES.DEGRADING, SESSION_STATES.SHUTTING_DOWN]);
      expect(TRANSITIONS[SESSION_STATES.DEGRADING]).toEqual([SESSION_STATES.PASSIVE]);
      expect(TRANSITIONS[SESSION_STATES.SHUTTING_DOWN]).toEqual([SESSION_STATES.STOPPED, SESSION_STATES.REM_PROCESSING]);
      expect(TRANSITIONS[SESSION_STATES.REM_PROCESSING]).toEqual([SESSION_STATES.STOPPED]);
      expect(TRANSITIONS[SESSION_STATES.STOPPED]).toEqual([]);
    });

    it('SHUTTING_DOWN allows transition to both STOPPED and REM_PROCESSING', () => {
      const shutdownTargets = TRANSITIONS[SESSION_STATES.SHUTTING_DOWN];
      expect(shutdownTargets).toContain(SESSION_STATES.STOPPED);
      expect(shutdownTargets).toContain(SESSION_STATES.REM_PROCESSING);
    });

    it('REM_PROCESSING allows transition only to STOPPED', () => {
      const remTargets = TRANSITIONS[SESSION_STATES.REM_PROCESSING];
      expect(remTargets).toEqual([SESSION_STATES.STOPPED]);
      expect(remTargets).toHaveLength(1);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(TRANSITIONS)).toBe(true);
    });
  });

  describe('FRAMING_MODES', () => {
    it('has 3 entries: full, dual, soft', () => {
      expect(Object.keys(FRAMING_MODES)).toHaveLength(3);
      expect(FRAMING_MODES.FULL).toBe('full');
      expect(FRAMING_MODES.DUAL).toBe('dual');
      expect(FRAMING_MODES.SOFT).toBe('soft');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(FRAMING_MODES)).toBe(true);
    });
  });

  describe('TOPOLOGY_RULES', () => {
    it('enforces Primary<->Secondary and Secondary<->Tertiary but NOT Primary<->Tertiary direct', () => {
      // Primary can only talk to Secondary
      expect(TOPOLOGY_RULES[SESSION_IDENTITIES.PRIMARY]).toEqual([SESSION_IDENTITIES.SECONDARY]);
      // Secondary can talk to both
      expect(TOPOLOGY_RULES[SESSION_IDENTITIES.SECONDARY]).toEqual([SESSION_IDENTITIES.PRIMARY, SESSION_IDENTITIES.TERTIARY]);
      // Tertiary can only talk to Secondary
      expect(TOPOLOGY_RULES[SESSION_IDENTITIES.TERTIARY]).toEqual([SESSION_IDENTITIES.SECONDARY]);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(TOPOLOGY_RULES)).toBe(true);
    });
  });

  describe('DEFAULT_SESSION_CONFIG', () => {
    it('includes sublimation_cycle_ms of 15000', () => {
      expect(DEFAULT_SESSION_CONFIG.sublimation_cycle_ms).toBe(15000);
    });

    it('includes startup_timeout_ms of 10000', () => {
      expect(DEFAULT_SESSION_CONFIG.startup_timeout_ms).toBe(10000);
    });

    it('includes framing_mode of dual', () => {
      expect(DEFAULT_SESSION_CONFIG.framing_mode).toBe('dual');
    });

    it('includes secondary_model of opus', () => {
      expect(DEFAULT_SESSION_CONFIG.secondary_model).toBe('opus');
    });

    it('includes tertiary_model of sonnet', () => {
      expect(DEFAULT_SESSION_CONFIG.tertiary_model).toBe('sonnet');
    });

    it('includes ack_timeout_ms, health_check_interval_ms, max_sublimation_intake, passive_secondary_capabilities', () => {
      expect(DEFAULT_SESSION_CONFIG.ack_timeout_ms).toBe(5000);
      expect(DEFAULT_SESSION_CONFIG.health_check_interval_ms).toBe(10000);
      expect(DEFAULT_SESSION_CONFIG.max_sublimation_intake).toBe(5);
      expect(Array.isArray(DEFAULT_SESSION_CONFIG.passive_secondary_capabilities)).toBe(true);
      expect(DEFAULT_SESSION_CONFIG.passive_secondary_capabilities).toEqual(['attention', 'face_prompt', 'hook_monitor']);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(DEFAULT_SESSION_CONFIG)).toBe(true);
    });
  });

  describe('createSessionConfig', () => {
    it('returns default config when called with no overrides', () => {
      const config = createSessionConfig();
      expect(config.sublimation_cycle_ms).toBe(15000);
      expect(config.framing_mode).toBe('dual');
    });

    it('merges user overrides with DEFAULT_SESSION_CONFIG', () => {
      const config = createSessionConfig({ sublimation_cycle_ms: 30000, startup_timeout_ms: 20000 });
      expect(config.sublimation_cycle_ms).toBe(30000);
      expect(config.startup_timeout_ms).toBe(20000);
      // Non-overridden values remain default
      expect(config.framing_mode).toBe('dual');
      expect(config.secondary_model).toBe('opus');
    });

    it('returns a frozen object', () => {
      const config = createSessionConfig();
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('validates framing_mode is one of FRAMING_MODES values', () => {
      expect(() => createSessionConfig({ framing_mode: 'invalid' })).toThrow();
    });

    it('accepts valid framing_mode values', () => {
      const fullConfig = createSessionConfig({ framing_mode: 'full' });
      expect(fullConfig.framing_mode).toBe('full');

      const softConfig = createSessionConfig({ framing_mode: 'soft' });
      expect(softConfig.framing_mode).toBe('soft');
    });
  });
});
