'use strict';

const { describe, it, expect } = require('bun:test');

const {
  FRAGMENT_TYPES,
  LIFECYCLE_DIRS,
  SM_ASPECTS,
  DECAY_DEFAULTS,
  SCORING_DEFAULTS,
  FORMATION_DEFAULTS,
  NUDGE_DEFAULTS,
  DATA_DIR_DEFAULT,
  FRAGMENT_ID_PATTERN,
  REM_DEFAULTS,
  CONDITIONING_DEFAULTS,
} = require('../constants.cjs');

describe('constants', () => {
  describe('REM_DEFAULTS', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(REM_DEFAULTS)).toBe(true);
    });

    it('has heartbeat_timeout_ms of 90000', () => {
      expect(REM_DEFAULTS.heartbeat_timeout_ms).toBe(90000);
    });

    it('has tier2_check_interval_ms of 5000', () => {
      expect(REM_DEFAULTS.tier2_check_interval_ms).toBe(5000);
    });

    it('has rem_time_budget_ms of 120000', () => {
      expect(REM_DEFAULTS.rem_time_budget_ms).toBe(120000);
    });

    it('has max_consolidated_per_session of 20', () => {
      expect(REM_DEFAULTS.max_consolidated_per_session).toBe(20);
    });

    it('has meta_recall_min_significance of 0.6', () => {
      expect(REM_DEFAULTS.meta_recall_min_significance).toBe(0.6);
    });

    it('has sublimation_triage_cap of 5', () => {
      expect(REM_DEFAULTS.sublimation_triage_cap).toBe(5);
    });

    it('has exactly 6 fields', () => {
      expect(Object.keys(REM_DEFAULTS)).toHaveLength(6);
    });
  });

  describe('CONDITIONING_DEFAULTS', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(CONDITIONING_DEFAULTS)).toBe(true);
    });

    it('has ema_alpha of 0.15', () => {
      expect(CONDITIONING_DEFAULTS.ema_alpha).toBe(0.15);
    });

    it('has identity_floor of 0.1', () => {
      expect(CONDITIONING_DEFAULTS.identity_floor).toBe(0.1);
    });

    it('has identity_min_sessions of 5', () => {
      expect(CONDITIONING_DEFAULTS.identity_min_sessions).toBe(5);
    });

    it('has diversity_threshold of 0.05', () => {
      expect(CONDITIONING_DEFAULTS.diversity_threshold).toBe(0.05);
    });

    it('has max_error_history of 50', () => {
      expect(CONDITIONING_DEFAULTS.max_error_history).toBe(50);
    });

    it('has exactly 5 fields', () => {
      expect(Object.keys(CONDITIONING_DEFAULTS)).toHaveLength(5);
    });
  });

  describe('existing constants still work', () => {
    it('DECAY_DEFAULTS is frozen and has expected fields', () => {
      expect(Object.isFrozen(DECAY_DEFAULTS)).toBe(true);
      expect(DECAY_DEFAULTS.base_decay_rate).toBe(0.05);
    });

    it('FRAGMENT_TYPES has 5 types', () => {
      expect(FRAGMENT_TYPES).toHaveLength(5);
    });

    it('LIFECYCLE_DIRS has working, active, archive', () => {
      expect(LIFECYCLE_DIRS.working).toBe('working');
      expect(LIFECYCLE_DIRS.active).toBe('active');
      expect(LIFECYCLE_DIRS.archive).toBe('archive');
    });
  });
});
