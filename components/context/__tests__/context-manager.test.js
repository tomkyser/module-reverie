'use strict';

const { describe, it, expect, beforeEach, mock } = require('bun:test');

// ---------------------------------------------------------------------------
// Test helpers: mock factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Self Model with getAspect/save returning sparse data.
 */
function createMockSelfModel(aspects) {
  const _aspects = aspects || {};
  return {
    getAspect(name) {
      return _aspects[name] || null;
    },
    async save(name, data) {
      _aspects[name] = data;
      return { ok: true, value: { aspect: name, version: 'sm-test-v1' } };
    },
  };
}

/**
 * Creates a mock Lathe with readFile/writeFile tracking calls.
 */
function createMockLathe(existingFiles) {
  const _files = existingFiles || {};
  const _writes = [];

  return {
    async readFile(path) {
      if (_files[path] !== undefined) {
        return { ok: true, value: _files[path] };
      }
      return { ok: false, error: { code: 'FILE_NOT_FOUND', message: `Not found: ${path}` } };
    },
    async writeFile(path, content) {
      _files[path] = content;
      _writes.push({ path, content });
      return { ok: true, value: { path } };
    },
    getWrites() { return _writes; },
    getFile(path) { return _files[path]; },
  };
}

/**
 * Creates a mock Switchboard tracking emitted events.
 */
function createMockSwitchboard() {
  const _events = [];
  return {
    emit(name, payload) { _events.push({ name, payload }); },
    on(name, handler) {},
    getEvents() { return _events; },
  };
}

/**
 * Creates a mock entropy engine.
 */
function createMockEntropy() {
  return {
    applyVariance(traits) { return traits; },
    getState() { return { sigma: 0.05, history: [], sessionCount: 0 }; },
    evolve() {},
  };
}

/**
 * Creates a mock Journal.
 */
function createMockJournal() {
  return {
    async write(name, data) { return { ok: true, value: { path: `/mock/${name}` } }; },
    async read(name) { return { ok: true, value: { data: {}, body: '' } }; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Context Manager', () => {
  let createContextManager;
  let CONTEXT_MANAGER_SHAPE;

  beforeEach(() => {
    // Re-require to reset module state between tests
    const mod = require('../context-manager.cjs');
    createContextManager = mod.createContextManager;
    CONTEXT_MANAGER_SHAPE = mod.CONTEXT_MANAGER_SHAPE;
  });

  describe('exports', () => {
    it('exports createContextManager function', () => {
      expect(typeof createContextManager).toBe('function');
    });

    it('exports CONTEXT_MANAGER_SHAPE with 10 required methods', () => {
      expect(CONTEXT_MANAGER_SHAPE).toBeDefined();
      expect(CONTEXT_MANAGER_SHAPE.required).toHaveLength(10);
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('init');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('compose');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('getInjection');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('trackBytes');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('getBudgetPhase');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('getMicroNudge');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('checkpoint');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('resetAfterCompaction');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('getSessionSnapshot');
      expect(CONTEXT_MANAGER_SHAPE.required).toContain('persistWarmStart');
    });
  });

  describe('createContextManager', () => {
    it('returns err when options is null', () => {
      const result = createContextManager(null);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INIT_FAILED');
    });

    it('returns err when options is undefined', () => {
      const result = createContextManager();
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INIT_FAILED');
    });

    it('returns ok with frozen contract when valid options provided', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      expect(result.ok).toBe(true);
      expect(Object.isFrozen(result.value)).toBe(true);
    });
  });

  describe('init() - warm-start path', () => {
    it('reads existing face prompt file and caches it', async () => {
      const facePromptContent = '## Identity Frame\nTest personality';
      const lathe = createMockLathe({
        '/tmp/test-reverie/face-prompt.md': facePromptContent,
      });
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const initResult = await cm.init();
      expect(initResult.ok).toBe(true);
      expect(initResult.value.source).toBe('warm-start');
    });

    it('getInjection returns cached face prompt after warm-start', async () => {
      const facePromptContent = '## Identity Frame\nTest personality';
      const lathe = createMockLathe({
        '/tmp/test-reverie/face-prompt.md': facePromptContent,
      });
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.init();

      const injection = cm.getInjection();
      expect(injection).toBe(facePromptContent);
    });
  });

  describe('init() - cold-start path', () => {
    it('runs cold-start when no face prompt file exists', async () => {
      const lathe = createMockLathe(); // no files
      const selfModel = createMockSelfModel();
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel,
        lathe,
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const initResult = await cm.init();
      expect(initResult.ok).toBe(true);
      expect(initResult.value.source).toBe('cold-start');
    });

    it('saves seed aspects to selfModel during cold-start', async () => {
      const lathe = createMockLathe();
      const selfModel = createMockSelfModel();
      const result = createContextManager({
        selfModel,
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.init();

      // After cold-start, all 3 aspects should have been saved
      expect(selfModel.getAspect('identity-core')).not.toBeNull();
      expect(selfModel.getAspect('relational-model')).not.toBeNull();
      expect(selfModel.getAspect('conditioning')).not.toBeNull();
    });

    it('writes face prompt file during cold-start compose', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.init();

      const writes = lathe.getWrites();
      const facePromptWrite = writes.find(w => w.path.includes('face-prompt.md'));
      expect(facePromptWrite).toBeDefined();
      expect(facePromptWrite.content).toBeTruthy();
    });
  });

  describe('compose()', () => {
    it('generates face prompt text from template composer', async () => {
      const lathe = createMockLathe();
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const composeResult = await cm.compose();
      expect(composeResult.ok).toBe(true);
      expect(composeResult.value.phase).toBe(1);
      expect(composeResult.value.path).toContain('face-prompt.md');
    });

    it('emits face-prompt-composed event', async () => {
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose();

      const events = switchboard.getEvents();
      const composed = events.find(e => e.name === 'reverie:face-prompt-composed');
      expect(composed).toBeDefined();
      expect(composed.payload.phase).toBe(1);
      expect(typeof composed.payload.tokens).toBe('number');
    });

    it('caches face prompt for synchronous getInjection', async () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose();

      const injection = cm.getInjection();
      expect(typeof injection).toBe('string');
      expect(injection.length).toBeGreaterThan(0);
    });
  });

  describe('getInjection()', () => {
    it('is synchronous (no async/Promise)', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      // Before compose, returns null
      const injection = cm.getInjection();
      expect(injection === null || injection === undefined || typeof injection === 'string').toBe(true);
      // Verify it is NOT a promise
      expect(injection instanceof Promise).toBe(false);
    });
  });

  describe('trackBytes()', () => {
    it('delegates to budget tracker and returns transition info', async () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const transition = cm.trackBytes(1000, 'user_prompt');
      expect(transition).toBeDefined();
      expect(typeof transition.changed).toBe('boolean');
      expect(typeof transition.from).toBe('number');
      expect(typeof transition.to).toBe('number');
    });

    it('triggers recompose on phase change', async () => {
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose(); // initial compose at phase 1

      // Push bytes to cross 30% threshold (200000 tokens * 4 bytes = 800000 bytes, 30% = 240000)
      const transition = cm.trackBytes(240001, 'user_prompt');
      expect(transition.changed).toBe(true);
      expect(transition.from).toBe(1);
      expect(transition.to).toBe(2);

      // Should have emitted budget-phase-changed
      const events = switchboard.getEvents();
      const phaseChange = events.find(e => e.name === 'reverie:budget-phase-changed');
      expect(phaseChange).toBeDefined();
      expect(phaseChange.payload.from).toBe(1);
      expect(phaseChange.payload.to).toBe(2);
    });

    it('does not recompose when phase stays the same', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose();
      const writesBefore = lathe.getWrites().length;

      const transition = cm.trackBytes(100, 'user_prompt');
      expect(transition.changed).toBe(false);

      // No additional file write (compose not triggered)
      // Allow for a small delay for any async compose
      expect(lathe.getWrites().length).toBe(writesBefore);
    });
  });

  describe('getBudgetPhase()', () => {
    it('returns current phase number (1 initially)', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      expect(cm.getBudgetPhase()).toBe(1);
    });
  });

  describe('getMicroNudge()', () => {
    it('returns null when phase is not 3', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      // Phase 1 initially
      expect(cm.getMicroNudge()).toBeNull();
    });

    it('returns micro-nudge string when phase is 3', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      // Push to Phase 3 (60% = 480000 bytes)
      cm.trackBytes(480001, 'user_prompt');
      expect(cm.getBudgetPhase()).toBe(3);

      const nudge = cm.getMicroNudge();
      expect(typeof nudge).toBe('string');
      expect(nudge.length).toBeGreaterThan(0);
      expect(nudge).toContain('Remember');
    });
  });

  describe('checkpoint()', () => {
    it('writes checkpoint JSON with required fields', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose();

      const cpResult = await cm.checkpoint();
      expect(cpResult.ok).toBe(true);

      const cp = cpResult.value;
      expect(cp.facePromptText).toBeDefined();
      expect(typeof cp.budgetPhase).toBe('number');
      expect(typeof cp.cumulativeBytes).toBe('number');
      expect(cp.attentionDirectives).toBeDefined();
      expect(cp.timestamp).toBeDefined();
    });

    it('writes checkpoint to file via lathe', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose();
      await cm.checkpoint();

      const writes = lathe.getWrites();
      const cpWrite = writes.find(w => w.path.includes('compact-'));
      expect(cpWrite).toBeDefined();
      expect(cpWrite.path).toContain('checkpoints');

      // Content should be valid JSON
      const parsed = JSON.parse(cpWrite.content);
      expect(parsed.facePromptText).toBeDefined();
      expect(parsed.budgetPhase).toBeDefined();
    });
  });

  describe('resetAfterCompaction()', () => {
    it('resets budget phase and recomposes', async () => {
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      // Push to Phase 3
      cm.trackBytes(480001, 'user_prompt');
      expect(cm.getBudgetPhase()).toBe(3);

      const resetResult = await cm.resetAfterCompaction();
      expect(resetResult.ok).toBe(true);

      // After reset, budget tracker uses DEFAULT_POST_COMPACTION_TOKENS * 4 bytes
      // 33000 * 4 = 132000 bytes out of 800000 = 16.5%, so Phase 1
      const phase = resetResult.value.phase;
      expect(phase).toBeLessThanOrEqual(2); // Reset goes back to early phases
    });

    it('emits post-compaction-reset event', async () => {
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      cm.trackBytes(480001, 'user_prompt');
      await cm.resetAfterCompaction();

      const events = switchboard.getEvents();
      const resetEvt = events.find(e => e.name === 'reverie:post-compaction-reset');
      expect(resetEvt).toBeDefined();
      expect(typeof resetEvt.payload.phase).toBe('number');
    });
  });

  describe('getSessionSnapshot()', () => {
    it('returns snapshot with required fields', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const snapshot = cm.getSessionSnapshot();
      expect(typeof snapshot.budgetPhase).toBe('number');
      expect(typeof snapshot.cumulativeBytes).toBe('number');
      expect(typeof snapshot.turnCount).toBe('number');
      expect(snapshot.entropyState).toBeDefined();
      expect(snapshot.facePromptPath).toContain('face-prompt.md');
    });
  });

  describe('persistWarmStart()', () => {
    it('writes current face prompt to file', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;
      await cm.compose(); // sets _currentFacePrompt

      const wsResult = await cm.persistWarmStart();
      expect(wsResult.ok).toBe(true);
      expect(wsResult.value.path).toContain('face-prompt.md');

      // Should have written the same content as getInjection
      const injection = cm.getInjection();
      const writes = lathe.getWrites();
      const lastFpWrite = writes.filter(w => w.path.includes('face-prompt.md')).pop();
      expect(lastFpWrite.content).toBe(injection);
    });
  });

  describe('incrementTurn()', () => {
    it('turn count increases via budget tracker', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const snapshot1 = cm.getSessionSnapshot();
      expect(snapshot1.turnCount).toBe(0);

      cm.incrementTurn();
      const snapshot2 = cm.getSessionSnapshot();
      expect(snapshot2.turnCount).toBe(1);
    });
  });

  describe('getNudge()', () => {
    it('returns null when no nudgeManager provided', async () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const nudge = await cm.getNudge();
      expect(nudge).toBeNull();
    });

    it('returns nudge text when nudgeManager.readLatestNudge returns ok with value', async () => {
      const mockNudgeManager = {
        async readLatestNudge() {
          return { ok: true, value: { text: 'I sense curiosity about architecture.', age: 5000 } };
        },
      };
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
        nudgeManager: mockNudgeManager,
      });
      const cm = result.value;

      const nudge = await cm.getNudge();
      expect(nudge).toBe('I sense curiosity about architecture.');
    });

    it('returns null when nudgeManager.readLatestNudge returns ok(null) (stale/missing)', async () => {
      const mockNudgeManager = {
        async readLatestNudge() {
          return { ok: true, value: null };
        },
      };
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
        nudgeManager: mockNudgeManager,
      });
      const cm = result.value;

      const nudge = await cm.getNudge();
      expect(nudge).toBeNull();
    });
  });

  // =========================================================================
  // Phase 10: Secondary-driven face prompt updates
  // =========================================================================

  describe('receiveSecondaryUpdate()', () => {
    it('sets _currentFacePrompt from Secondary', async () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      const updateResult = cm.receiveSecondaryUpdate('Secondary face prompt content');
      expect(updateResult.ok).toBe(true);
      expect(updateResult.value.source).toBe('secondary');
      expect(updateResult.value.length).toBe('Secondary face prompt content'.length);

      // getInjection should now return the Secondary-provided content
      expect(cm.getInjection()).toBe('Secondary face prompt content');
    });

    it('returns err for empty or invalid facePrompt', () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      expect(cm.receiveSecondaryUpdate('').ok).toBe(false);
      expect(cm.receiveSecondaryUpdate(null).ok).toBe(false);
      expect(cm.receiveSecondaryUpdate(42).ok).toBe(false);
    });

    it('emits context:face-prompt-updated event', () => {
      const switchboard = createMockSwitchboard();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard,
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      cm.receiveSecondaryUpdate('Updated prompt from Secondary');
      const events = switchboard.getEvents();
      const evt = events.find(e => e.name === 'context:face-prompt-updated');
      expect(evt).toBeDefined();
      expect(evt.payload.source).toBe('secondary');
      expect(evt.payload.length).toBe('Updated prompt from Secondary'.length);
    });
  });

  describe('compose() with Secondary authority', () => {
    it('returns Secondary-provided prompt when _secondaryActive is true', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      // Set Secondary-provided face prompt
      cm.receiveSecondaryUpdate('Secondary authority prompt');
      cm.setSecondaryActive(true);

      const writesBefore = lathe.getWrites().length;
      const composeResult = await cm.compose();
      expect(composeResult.ok).toBe(true);
      expect(composeResult.value.source).toBe('secondary');

      // Should NOT write to file (Secondary is authority, no local composition)
      expect(lathe.getWrites().length).toBe(writesBefore);

      // getInjection still returns Secondary prompt
      expect(cm.getInjection()).toBe('Secondary authority prompt');
    });

    it('falls back to local composition when _secondaryActive is false', async () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      // _secondaryActive defaults to false
      const composeResult = await cm.compose();
      expect(composeResult.ok).toBe(true);
      expect(composeResult.value.source).toBeUndefined(); // local compose has no source field
      expect(typeof cm.getInjection()).toBe('string');
      expect(cm.getInjection().length).toBeGreaterThan(0);
    });
  });

  describe('setSecondaryActive()', () => {
    it('enables Secondary authority when set to true', async () => {
      const lathe = createMockLathe();
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe,
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      // Pre-set a face prompt via receiveSecondaryUpdate
      cm.receiveSecondaryUpdate('Secondary controlled prompt');

      // Enable Secondary authority
      cm.setSecondaryActive(true);

      const composeResult = await cm.compose();
      expect(composeResult.value.source).toBe('secondary');
    });

    it('disables Secondary authority when set to false', async () => {
      const result = createContextManager({
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        switchboard: createMockSwitchboard(),
        entropy: createMockEntropy(),
        journal: createMockJournal(),
        dataDir: '/tmp/test-reverie',
      });
      const cm = result.value;

      cm.receiveSecondaryUpdate('Secondary prompt');
      cm.setSecondaryActive(true);
      cm.setSecondaryActive(false);

      const composeResult = await cm.compose();
      expect(composeResult.value.source).toBeUndefined();
    });
  });
});
