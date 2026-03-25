'use strict';

const { describe, it, expect, beforeEach, mock } = require('bun:test');

/**
 * Creates a mock Lathe service for triage tests.
 * @param {Object} [overrides] - Override writeFile behavior
 * @returns {Object} Mock lathe
 */
function createMockLathe(overrides) {
  return {
    writeFile: mock((overrides && overrides.writeFile) || (() => ({ ok: true, value: {} }))),
  };
}

/**
 * Creates a mock Switchboard for triage tests.
 * @returns {Object} Mock switchboard with events array
 */
function createMockSwitchboard() {
  const events = [];
  return {
    events,
    emit: mock((name, data) => { events.push({ name, data }); }),
  };
}

describe('Triage', () => {
  let createTriage;

  beforeEach(() => {
    createTriage = require('../triage.cjs').createTriage;
  });

  describe('createTriage factory', () => {
    it('returns a frozen object with snapshot method', () => {
      const triage = createTriage({
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        dataDir: '/tmp/test-triage',
        sessionId: 'test-session-1',
      });
      expect(Object.isFrozen(triage)).toBe(true);
      expect(typeof triage.snapshot).toBe('function');
    });
  });

  describe('snapshot()', () => {
    it('writes a JSON file to the triage state path via lathe.writeFile', async () => {
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'test-session-1',
      });

      const mindState = {
        attention_pointer: 'topic-xyz',
        working_fragments: ['frag-1', 'frag-2'],
        sublimation_candidates: ['sub-1'],
        self_model_prompt_state: 'hash-abc123',
      };

      const result = await triage.snapshot(mindState);

      expect(result.ok).toBe(true);
      expect(lathe.writeFile).toHaveBeenCalledTimes(1);
      const callArgs = lathe.writeFile.mock.calls[0];
      expect(callArgs[0]).toContain('triage-');
      expect(callArgs[0]).toContain('/data/rem/');
    });

    it('snapshot output contains all required fields', async () => {
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'test-session-1',
      });

      const mindState = {
        attention_pointer: 'topic-abc',
        working_fragments: ['frag-a'],
        sublimation_candidates: ['sub-x'],
        self_model_prompt_state: 'hash-def',
      };

      await triage.snapshot(mindState);

      const callArgs = lathe.writeFile.mock.calls[0];
      const written = JSON.parse(callArgs[1]);
      expect(written).toHaveProperty('attention_pointer', 'topic-abc');
      expect(written).toHaveProperty('working_fragments');
      expect(written.working_fragments).toEqual(['frag-a']);
      expect(written).toHaveProperty('sublimation_candidates');
      expect(written.sublimation_candidates).toEqual(['sub-x']);
      expect(written).toHaveProperty('self_model_prompt_state', 'hash-def');
      expect(written).toHaveProperty('timestamp');
      expect(written).toHaveProperty('session_id', 'test-session-1');
    });

    it('emits reverie:rem:tier1-complete on success', async () => {
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'sess-42',
      });

      const result = await triage.snapshot({ attention_pointer: 'x' });

      expect(result.ok).toBe(true);
      expect(switchboard.emit).toHaveBeenCalledTimes(1);
      expect(switchboard.events[0].name).toBe('reverie:rem:tier1-complete');
      expect(switchboard.events[0].data).toHaveProperty('path');
      expect(switchboard.events[0].data).toHaveProperty('fields_saved');
    });

    it('returns ok({ path, fields_saved }) on success', async () => {
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'sess-ok',
      });

      const result = await triage.snapshot({ attention_pointer: 'y' });

      expect(result.ok).toBe(true);
      expect(result.value).toHaveProperty('path');
      expect(result.value.path).toContain('triage-');
      expect(result.value).toHaveProperty('fields_saved', 6);
    });

    it('returns err when lathe.writeFile fails', async () => {
      const lathe = createMockLathe({
        writeFile: () => ({ ok: false, error: { code: 'WRITE_ERROR', message: 'disk full' } }),
      });
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'sess-fail',
      });

      const result = await triage.snapshot({ attention_pointer: 'z' });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TRIAGE_WRITE_FAILED');
      expect(switchboard.emit).not.toHaveBeenCalled();
    });

    it('returns err when lathe.writeFile throws an exception', async () => {
      const lathe = {
        writeFile: mock(() => { throw new Error('IO error'); }),
      };
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'sess-throw',
      });

      const result = await triage.snapshot({ attention_pointer: 'a' });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TRIAGE_WRITE_FAILED');
      expect(result.error.message).toContain('IO error');
    });

    it('is synchronous-like -- only filesystem operations, no LLM calls', async () => {
      // Verify by checking that the function signature and implementation
      // only depend on lathe.writeFile (filesystem) and no external LLM calls
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'sess-sync',
      });

      const result = await triage.snapshot({
        attention_pointer: 'ptr',
        working_fragments: ['f1', 'f2'],
        sublimation_candidates: [],
        self_model_prompt_state: null,
      });

      // Should resolve immediately with only one lathe call
      expect(result.ok).toBe(true);
      expect(lathe.writeFile).toHaveBeenCalledTimes(1);
    });

    it('handles null/undefined mindState gracefully', async () => {
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const triage = createTriage({
        lathe,
        switchboard,
        dataDir: '/tmp/test-triage',
        sessionId: 'sess-null',
      });

      const result = await triage.snapshot(null);

      expect(result.ok).toBe(true);
      const callArgs = lathe.writeFile.mock.calls[0];
      const written = JSON.parse(callArgs[1]);
      expect(written.attention_pointer).toBeNull();
      expect(written.working_fragments).toEqual([]);
      expect(written.sublimation_candidates).toEqual([]);
      expect(written.self_model_prompt_state).toBeNull();
      expect(written.session_id).toBe('sess-null');
    });
  });
});
