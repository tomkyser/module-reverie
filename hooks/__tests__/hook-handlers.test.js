'use strict';

const { describe, it, expect, beforeEach } = require('bun:test');

// ---------------------------------------------------------------------------
// Test helpers: mock factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Context Manager with controllable return values.
 */
function createMockContextManager(overrides) {
  const defaults = {
    _injection: '## Identity Frame\nMock personality',
    _phase: 1,
    _nudge: null,
    _initResult: { ok: true, value: { source: 'warm-start' } },
    _composeResult: { ok: true, value: { phase: 1, path: '/tmp/face-prompt.md' } },
    _checkpointResult: { ok: true, value: { facePromptText: 'test', budgetPhase: 1, cumulativeBytes: 0, attentionDirectives: {}, entropyState: null, timestamp: '2026-01-01T00:00:00Z' } },
    _resetResult: { ok: true, value: { phase: 1 } },
    _warmStartResult: { ok: true, value: { path: '/tmp/face-prompt.md' } },
    _snapshot: { budgetPhase: 1, cumulativeBytes: 0, turnCount: 0, utilization: 0, contextWindowBytes: 800000, entropyState: null, facePromptPath: '/tmp/face-prompt.md' },
  };
  const opts = { ...defaults, ...overrides };

  const _calls = [];

  return {
    async init() { _calls.push('init'); return opts._initResult; },
    async compose() { _calls.push('compose'); return opts._composeResult; },
    getInjection() { return opts._injection; },
    trackBytes(bytes, source) {
      _calls.push({ trackBytes: { bytes, source } });
      return { changed: false, from: opts._phase, to: opts._phase };
    },
    getBudgetPhase() { return opts._phase; },
    getMicroNudge() { return opts._nudge; },
    async checkpoint() { _calls.push('checkpoint'); return opts._checkpointResult; },
    async resetAfterCompaction() { _calls.push('resetAfterCompaction'); return opts._resetResult; },
    getSessionSnapshot() { return opts._snapshot; },
    async persistWarmStart() { _calls.push('persistWarmStart'); return opts._warmStartResult; },
    incrementTurn() { _calls.push('incrementTurn'); },
    async getNudge() { return opts._getNudgeResult || null; },
    getCalls() { return _calls; },
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
 * Creates a mock Lathe tracking writes.
 */
function createMockLathe() {
  const _writes = [];
  return {
    async readFile(path) { return { ok: false, error: { code: 'FILE_NOT_FOUND' } }; },
    async writeFile(path, content) {
      _writes.push({ path, content });
      return { ok: true, value: { path } };
    },
    getWrites() { return _writes; },
  };
}

/**
 * Creates a mock formation pipeline with controllable behavior.
 */
function createMockFormationPipeline(overrides) {
  const opts = overrides || {};
  const _calls = [];

  return {
    prepareStimulus(hookPayload, sessionContext) {
      _calls.push({ prepareStimulus: { hookPayload, sessionContext } });
      return opts._stimulusResult || {
        turn_context: { user_prompt: hookPayload.user_prompt || '' },
        self_model: {},
        recalled_fragments: [],
      };
    },
    async processFormationOutput(rawOutput, sessionContext) {
      _calls.push({ processFormationOutput: { rawOutput, sessionContext } });
      if (opts._processError) throw opts._processError;
      return opts._processResult || { ok: true, value: { formed: 1, formationGroup: 'fg-test1234' } };
    },
    getFormationStats() {
      return { totalFormed: 0, sessionFormed: 0, lastFormationTime: null };
    },
    getCalls() { return _calls; },
  };
}

/**
 * Creates a mock recall engine with controllable behavior.
 */
function createMockRecallEngine(overrides) {
  const opts = overrides || {};
  const _calls = [];

  return {
    async recallPassive(stimulus) {
      _calls.push({ recallPassive: { stimulus } });
      return opts._passiveResult || { ok: true, value: { fragments: [], nudgePrompt: null } };
    },
    async recallExplicit(conversationContext) {
      _calls.push({ recallExplicit: { conversationContext } });
      return opts._explicitResult || { ok: true, value: { fragments: [], reconstructionPrompt: null } };
    },
    getRecallStats() {
      return { totalRecalls: 0, passiveRecalls: 0, explicitRecalls: 0 };
    },
    getCalls() { return _calls; },
  };
}

/**
 * Creates a mock Lithograph provider tracking setTranscriptPath calls.
 */
function createMockLithograph() {
  const _calls = [];
  return {
    setTranscriptPath(p) { _calls.push({ setTranscriptPath: p }); return { ok: true, value: undefined }; },
    getCalls() { return _calls; },
  };
}

/**
 * Creates a mock Lathe with configurable readFile responses.
 */
function createMockLatheWithReads(readResponses) {
  const _reads = readResponses || {};
  const _writes = [];
  return {
    async readFile(path) {
      if (_reads[path] !== undefined) {
        return { ok: true, value: _reads[path] };
      }
      return { ok: false, error: { code: 'FILE_NOT_FOUND' } };
    },
    async writeFile(path, content) {
      _writes.push({ path, content });
      return { ok: true, value: { path } };
    },
    getWrites() { return _writes; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hook Handlers', () => {
  let createHookHandlers;

  beforeEach(() => {
    const mod = require('../hook-handlers.cjs');
    createHookHandlers = mod.createHookHandlers;
  });

  describe('createHookHandlers', () => {
    it('returns object with all 8 handler functions', () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      expect(typeof handlers.handleSessionStart).toBe('function');
      expect(typeof handlers.handleUserPromptSubmit).toBe('function');
      expect(typeof handlers.handlePreToolUse).toBe('function');
      expect(typeof handlers.handlePostToolUse).toBe('function');
      expect(typeof handlers.handleStop).toBe('function');
      expect(typeof handlers.handlePreCompact).toBe('function');
      expect(typeof handlers.handleSubagentStart).toBe('function');
      expect(typeof handlers.handleSubagentStop).toBe('function');
    });
  });

  describe('handleSessionStart', () => {
    it('calls contextManager.init() on normal start', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSessionStart({ session_id: 'test' });
      expect(cm.getCalls()).toContain('init');
    });

    it('calls contextManager.resetAfterCompaction() when source is compact', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSessionStart({ session_id: 'test', source: 'compact' });
      expect(cm.getCalls()).toContain('resetAfterCompaction');
      expect(cm.getCalls()).not.toContain('init');
    });

    it('returns hookSpecificOutput with SessionStart event and additionalContext', async () => {
      const cm = createMockContextManager({ _injection: 'Test face prompt' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleSessionStart({ session_id: 'test' });
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(result.hookSpecificOutput.additionalContext).toBe('Test face prompt');
    });

    it('emits session-start event', async () => {
      const switchboard = createMockSwitchboard();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard,
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSessionStart({ session_id: 'test' });
      const events = switchboard.getEvents();
      const startEvt = events.find(e => e.name === 'reverie:hook:session-start');
      expect(startEvt).toBeDefined();
    });

    it('calls lithograph.setTranscriptPath when payload has transcript_path', async () => {
      const mockLithograph = createMockLithograph();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-data',
        lithograph: mockLithograph,
      });
      await handlers.handleSessionStart({
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
      });
      expect(mockLithograph.getCalls()).toEqual([
        { setTranscriptPath: '/path/to/transcript.jsonl' },
      ]);
    });

    it('handles missing lithograph gracefully when transcript_path present', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-data',
        // no lithograph provided
      });
      // Should not throw
      const result = await handlers.handleSessionStart({
        session_id: 'test-session',
        transcript_path: '/path/to/transcript.jsonl',
      });
      expect(result.hookSpecificOutput.hookEventName).toBe('SessionStart');
    });
  });

  describe('handleUserPromptSubmit', () => {
    it('tracks prompt bytes via contextManager', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Hello world', session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      expect(trackCalls.length).toBeGreaterThanOrEqual(1);
      expect(trackCalls[0].trackBytes.source).toBe('user_prompt');
    });

    it('returns hookSpecificOutput with UserPromptSubmit event and additionalContext', async () => {
      const cm = createMockContextManager({ _injection: 'Personality frame' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleUserPromptSubmit({ user_prompt: 'Test', session_id: 'test' });
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
      expect(result.hookSpecificOutput.additionalContext).toBe('Personality frame');
    });

    it('increments turn count', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Test', session_id: 'test' });
      expect(cm.getCalls()).toContain('incrementTurn');
    });

    it('uses Buffer.byteLength for accurate byte counting', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      // Multi-byte characters should be tracked accurately
      const prompt = 'Hello \u00e9\u00e0\u00fc'; // accented chars = more bytes than chars
      await handlers.handleUserPromptSubmit({ user_prompt: prompt, session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      const promptBytes = Buffer.byteLength(prompt, 'utf8');
      expect(trackCalls[0].trackBytes.bytes).toBe(promptBytes);
    });
  });

  describe('handlePreToolUse', () => {
    it('tracks bytes from tool input', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handlePreToolUse({ tool_name: 'Write', tool_input: { path: '/test' }, session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      expect(trackCalls.length).toBe(1);
      expect(trackCalls[0].trackBytes.source).toBe('tool_input');
    });

    it('returns empty object (no injection)', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handlePreToolUse({ tool_name: 'Read', tool_input: {}, session_id: 'test' });
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('emits pre-tool-use event', async () => {
      const switchboard = createMockSwitchboard();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard,
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handlePreToolUse({ tool_name: 'Bash', tool_input: {}, session_id: 'test' });
      const events = switchboard.getEvents();
      const evt = events.find(e => e.name === 'reverie:hook:pre-tool-use');
      expect(evt).toBeDefined();
      expect(evt.payload.tool).toBe('Bash');
    });
  });

  describe('handlePostToolUse', () => {
    it('tracks bytes from tool output', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handlePostToolUse({ tool_name: 'Read', tool_output: 'file contents here', session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      expect(trackCalls.length).toBe(1);
      expect(trackCalls[0].trackBytes.source).toBe('tool_output');
    });

    it('returns micro-nudge as additionalContext when phase is 3', async () => {
      const cm = createMockContextManager({ _phase: 3, _nudge: 'Remember: you are adaptive. Maintain personality frame.' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handlePostToolUse({ tool_name: 'Read', tool_output: 'data', session_id: 'test' });
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.hookEventName).toBe('PostToolUse');
      expect(result.hookSpecificOutput.additionalContext).toContain('Remember');
    });

    it('returns empty object when phase is not 3 (no injection)', async () => {
      const cm = createMockContextManager({ _phase: 1, _nudge: null });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handlePostToolUse({ tool_name: 'Read', tool_output: 'data', session_id: 'test' });
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('handles non-string tool output by stringifying', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handlePostToolUse({ tool_name: 'Bash', tool_output: { exit_code: 0 }, session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      expect(trackCalls.length).toBe(1);
      // Should have tracked bytes from JSON.stringify of the object
      const expected = Buffer.byteLength(JSON.stringify({ exit_code: 0 }), 'utf8');
      expect(trackCalls[0].trackBytes.bytes).toBe(expected);
    });
  });

  describe('handlePreCompact', () => {
    it('calls contextManager.checkpoint()', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handlePreCompact({ session_id: 'test' });
      expect(cm.getCalls()).toContain('checkpoint');
    });

    it('returns hookSpecificOutput with compaction framing as additionalContext', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handlePreCompact({ session_id: 'test' });
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.hookEventName).toBe('PreCompact');
      expect(result.hookSpecificOutput.additionalContext).toContain('Self Model');
      expect(result.hookSpecificOutput.additionalContext).toContain('preserve');
    });
  });

  describe('handleStop', () => {
    it('calls contextManager.persistWarmStart()', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleStop({ session_id: 'test', stop_hook_active: true });
      expect(cm.getCalls()).toContain('persistWarmStart');
    });

    it('writes session-end snapshot via lathe', async () => {
      const lathe = createMockLathe();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe,
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleStop({ session_id: 'test', stop_hook_active: true });
      const writes = lathe.getWrites();
      const snapshotWrite = writes.find(w => w.path.includes('session-end-'));
      expect(snapshotWrite).toBeDefined();
      expect(snapshotWrite.path).toContain('.json');

      // Content should be valid JSON with snapshot fields
      const parsed = JSON.parse(snapshotWrite.content);
      expect(parsed.budgetPhase).toBeDefined();
    });

    it('emits stop event', async () => {
      const switchboard = createMockSwitchboard();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard,
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleStop({ session_id: 'test', stop_hook_active: true });
      const events = switchboard.getEvents();
      const stopEvt = events.find(e => e.name === 'reverie:hook:stop');
      expect(stopEvt).toBeDefined();
      expect(stopEvt.payload.snapshot).toBeDefined();
    });

    it('returns empty object (no injection)', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleStop({ session_id: 'test', stop_hook_active: true });
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('handleSubagentStart', () => {
    it('tracks estimated bytes', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSubagentStart({ subagent_id: 'sub-1', session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      expect(trackCalls.length).toBe(1);
      expect(trackCalls[0].trackBytes.bytes).toBe(500);
      expect(trackCalls[0].trackBytes.source).toBe('subagent_start');
    });

    it('emits subagent-start event', async () => {
      const switchboard = createMockSwitchboard();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard,
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSubagentStart({ subagent_id: 'sub-1', session_id: 'test' });
      const events = switchboard.getEvents();
      const evt = events.find(e => e.name === 'reverie:hook:subagent-start');
      expect(evt).toBeDefined();
      expect(evt.payload.subagent_id).toBe('sub-1');
    });

    it('returns empty object', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleSubagentStart({ subagent_id: 'sub-1', session_id: 'test' });
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('handleSubagentStop', () => {
    it('tracks estimated bytes', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSubagentStop({ subagent_id: 'sub-1', session_id: 'test' });
      const trackCalls = cm.getCalls().filter(c => typeof c === 'object' && c.trackBytes);
      expect(trackCalls.length).toBe(1);
      expect(trackCalls[0].trackBytes.bytes).toBe(500);
      expect(trackCalls[0].trackBytes.source).toBe('subagent_stop');
    });

    it('emits subagent-stop event', async () => {
      const switchboard = createMockSwitchboard();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard,
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      await handlers.handleSubagentStop({ subagent_id: 'sub-1', session_id: 'test' });
      const events = switchboard.getEvents();
      const evt = events.find(e => e.name === 'reverie:hook:subagent-stop');
      expect(evt).toBeDefined();
    });

    it('returns empty object', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleSubagentStop({ subagent_id: 'sub-1', session_id: 'test' });
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('no systemMessage usage', () => {
    it('none of the handlers use systemMessage field', async () => {
      const cm = createMockContextManager({ _phase: 3, _nudge: 'nudge text' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      // Test handlers that return hookSpecificOutput
      const sessionResult = await handlers.handleSessionStart({ session_id: 'test' });
      const promptResult = await handlers.handleUserPromptSubmit({ user_prompt: 'hi', session_id: 'test' });
      const postToolResult = await handlers.handlePostToolUse({ tool_name: 'Read', tool_output: 'data', session_id: 'test' });
      const compactResult = await handlers.handlePreCompact({ session_id: 'test' });

      // None should have systemMessage
      expect(sessionResult.systemMessage).toBeUndefined();
      expect(promptResult.systemMessage).toBeUndefined();
      expect(postToolResult.systemMessage).toBeUndefined();
      expect(compactResult.systemMessage).toBeUndefined();
    });
  });

  // =========================================================================
  // Phase 9: Formation, Recall, and Subagent Processing
  // =========================================================================

  describe('Phase 9: handleUserPromptSubmit with formationPipeline', () => {
    it('calls formationPipeline.prepareStimulus when formationPipeline is available', async () => {
      const fp = createMockFormationPipeline();
      const cm = createMockContextManager({ _injection: 'face prompt' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        formationPipeline: fp,
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Tell me about your architecture', session_id: 'test' });
      const fpCalls = fp.getCalls().filter(c => c.prepareStimulus);
      expect(fpCalls.length).toBe(1);
      expect(fpCalls[0].prepareStimulus.hookPayload.user_prompt).toBe('Tell me about your architecture');
    });

    it('still returns face prompt when formationPipeline is not provided (backward compat)', async () => {
      const cm = createMockContextManager({ _injection: 'Phase 8 face prompt' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleUserPromptSubmit({ user_prompt: 'Test', session_id: 'test' });
      expect(result.hookSpecificOutput.additionalContext).toBe('Phase 8 face prompt');
    });
  });

  describe('Phase 9: handleUserPromptSubmit with nudge injection', () => {
    it('appends nudge text to additionalContext when getNudge returns text', async () => {
      const cm = createMockContextManager({
        _injection: 'face prompt',
        _getNudgeResult: 'I sense curiosity about architecture.',
      });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleUserPromptSubmit({ user_prompt: 'Hello', session_id: 'test' });
      expect(result.hookSpecificOutput.additionalContext).toContain('face prompt');
      expect(result.hookSpecificOutput.additionalContext).toContain('I sense curiosity about architecture.');
      expect(result.hookSpecificOutput.additionalContext).toContain('Inner impression');
    });
  });

  describe('Phase 9: handleUserPromptSubmit with explicit recall', () => {
    it('detects recall keywords and calls recallEngine.recallExplicit', async () => {
      const re = createMockRecallEngine({
        _explicitResult: { ok: true, value: { fragments: [], reconstructionPrompt: 'You remember a deep trust moment.' } },
      });
      const cm = createMockContextManager({ _injection: 'face prompt' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        recallEngine: re,
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Do you remember when we discussed the architecture?', session_id: 'test' });
      const reCalls = re.getCalls().filter(c => c.recallExplicit);
      expect(reCalls.length).toBe(1);
    });

    it('appends recall reconstruction to additionalContext when keywords detected', async () => {
      const re = createMockRecallEngine({
        _explicitResult: { ok: true, value: { fragments: [], reconstructionPrompt: 'I remember a moment of deep collaboration on the design.' } },
      });
      const cm = createMockContextManager({ _injection: 'face prompt' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        recallEngine: re,
      });

      const result = await handlers.handleUserPromptSubmit({ user_prompt: 'What do you remember about our sessions?', session_id: 'test' });
      expect(result.hookSpecificOutput.additionalContext).toContain('Memory reconstruction');
      expect(result.hookSpecificOutput.additionalContext).toContain('I remember a moment of deep collaboration');
    });
  });

  describe('Phase 9: handlePostToolUse with formation trigger', () => {
    it('triggers formation for tool-heavy turns with long output', async () => {
      const fp = createMockFormationPipeline();
      const cm = createMockContextManager({ _phase: 1, _nudge: null });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        formationPipeline: fp,
      });

      // Provide a long tool output (> 100 chars)
      const longOutput = 'A'.repeat(200);
      await handlers.handlePostToolUse({ tool_name: 'Read', tool_output: longOutput, session_id: 'test' });
      const fpCalls = fp.getCalls().filter(c => c.prepareStimulus);
      expect(fpCalls.length).toBe(1);
    });
  });

  describe('Phase 9: handleSubagentStop with formation subagent', () => {
    it('reads output file and calls processFormationOutput for reverie-formation agent', async () => {
      const fp = createMockFormationPipeline();
      const outputJson = JSON.stringify({ should_form: true, fragments: [{ body: 'test' }], nudge: 'test nudge' });
      const lathe = createMockLatheWithReads({
        '/tmp/test-reverie/data/formation/output/latest-output.json': outputJson,
      });
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe,
        dataDir: '/tmp/test-reverie',
        formationPipeline: fp,
      });

      await handlers.handleSubagentStop({ agent_name: 'reverie-formation', session_id: 'test' });
      const fpCalls = fp.getCalls().filter(c => c.processFormationOutput);
      expect(fpCalls.length).toBe(1);
      expect(fpCalls[0].processFormationOutput.rawOutput).toBe(outputJson);
    });

    it('does NOT call processFormationOutput for non-reverie agent', async () => {
      const fp = createMockFormationPipeline();
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        formationPipeline: fp,
      });

      await handlers.handleSubagentStop({ agent_name: 'some-other-agent', session_id: 'test' });
      const fpCalls = fp.getCalls().filter(c => c.processFormationOutput);
      expect(fpCalls.length).toBe(0);
    });

    it('does not throw when processFormationOutput errors (graceful degradation)', async () => {
      const fp = createMockFormationPipeline({ _processError: new Error('Parse error') });
      const outputJson = JSON.stringify({ should_form: true, fragments: [] });
      const lathe = createMockLatheWithReads({
        '/tmp/test-reverie/data/formation/output/latest-output.json': outputJson,
      });
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe,
        dataDir: '/tmp/test-reverie',
        formationPipeline: fp,
      });

      // Should NOT throw
      const result = await handlers.handleSubagentStop({ agent_name: 'reverie-formation', session_id: 'test' });
      expect(result.hookSpecificOutput.hookEventName).toBe('SubagentStop');
    });
  });

  // =========================================================================
  // Phase 10: Session Manager, Wire Topology, Mode Manager integration
  // =========================================================================

  describe('Phase 10: handleSessionStart with sessionManager', () => {
    it('calls sessionManager.start when available', async () => {
      const _calls = [];
      const mockSessionManager = {
        async start() { _calls.push('start'); return { ok: true, value: { state: 'passive' } }; },
        async stop() { _calls.push('stop'); return { ok: true, value: { state: 'stopped' } }; },
        getState() { return { state: 'passive', secondary: 'sec-1', tertiary: null, config: {} }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        sessionManager: mockSessionManager,
      });

      await handlers.handleSessionStart({ session_id: 'test' });
      // start() is fire-and-forget, give it a tick to complete
      await new Promise(function (r) { setTimeout(r, 10); });
      expect(_calls).toContain('start');
    });

    it('works without sessionManager (backward compat)', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        // no sessionManager
      });

      const result = await handlers.handleSessionStart({ session_id: 'test' });
      expect(result.hookSpecificOutput.hookEventName).toBe('SessionStart');
    });
  });

  describe('Phase 10: handleUserPromptSubmit with wireTopology', () => {
    it('sends snapshot via wireTopology when available', async () => {
      const _sentEnvelopes = [];
      const mockWireTopology = {
        async send(envelope) {
          _sentEnvelopes.push(envelope);
          return { ok: true, value: { sent: true } };
        },
      };
      const mockSessionManager = {
        getState() { return { state: 'passive', secondary: 'sec-1', tertiary: null, config: {} }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        wireTopology: mockWireTopology,
        sessionManager: mockSessionManager,
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Hello world', session_id: 'test' });
      // Give fire-and-forget a tick to complete
      await new Promise(function (r) { setTimeout(r, 10); });
      // Phase 11 adds HEARTBEAT after SNAPSHOT, so expect >= 1 sends
      expect(_sentEnvelopes.length).toBeGreaterThanOrEqual(1);
      const snapshotEnvelope = _sentEnvelopes.find(function (e) { return e.type === 'snapshot'; });
      expect(snapshotEnvelope).toBeTruthy();
      expect(snapshotEnvelope.from).toBe('primary');
      expect(snapshotEnvelope.to).toBe('secondary');
      expect(snapshotEnvelope.payload.userPrompt).toBe('Hello world');
    });

    it('does not send when session state is stopped', async () => {
      const _sentEnvelopes = [];
      const mockWireTopology = {
        async send(envelope) {
          _sentEnvelopes.push(envelope);
          return { ok: true, value: { sent: true } };
        },
      };
      const mockSessionManager = {
        getState() { return { state: 'stopped', secondary: null, tertiary: null, config: {} }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        wireTopology: mockWireTopology,
        sessionManager: mockSessionManager,
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Test', session_id: 'test' });
      await new Promise(function (r) { setTimeout(r, 10); });
      expect(_sentEnvelopes.length).toBe(0);
    });

    it('works without wireTopology (backward compat)', async () => {
      const cm = createMockContextManager({ _injection: 'face prompt' });
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        // no wireTopology
      });

      const result = await handlers.handleUserPromptSubmit({ user_prompt: 'Test', session_id: 'test' });
      expect(result.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
      expect(result.hookSpecificOutput.additionalContext).toBe('face prompt');
    });
  });

  describe('Phase 10: handleStop with sessionManager', () => {
    it('calls sessionManager.stop when available', async () => {
      const _calls = [];
      const mockSessionManager = {
        async start() { _calls.push('start'); return { ok: true }; },
        async stop() { _calls.push('stop'); return { ok: true, value: { state: 'stopped' } }; },
        getState() { return { state: 'passive' }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        sessionManager: mockSessionManager,
      });

      await handlers.handleStop({ session_id: 'test' });
      expect(_calls).toContain('stop');
    });

    it('works without sessionManager (backward compat)', async () => {
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        // no sessionManager
      });

      await handlers.handleStop({ session_id: 'test' });
      expect(cm.getCalls()).toContain('persistWarmStart');
    });
  });

  describe('Phase 10: handlePreCompact with wireTopology', () => {
    it('sends compaction notification via wireTopology', async () => {
      const _sentEnvelopes = [];
      const mockWireTopology = {
        async send(envelope) {
          _sentEnvelopes.push(envelope);
          return { ok: true, value: { sent: true } };
        },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        wireTopology: mockWireTopology,
      });

      await handlers.handlePreCompact({ session_id: 'test' });
      await new Promise(function (r) { setTimeout(r, 10); });
      expect(_sentEnvelopes.length).toBe(1);
      expect(_sentEnvelopes[0].type).toBe('snapshot');
      expect(_sentEnvelopes[0].urgency).toBe('urgent');
      expect(_sentEnvelopes[0].payload.event).toBe('pre_compact');
    });
  });

  // =========================================================================
  // Phase 10 Gap Closure: Secondary face prompt authority wiring integration
  // =========================================================================

  describe('Phase 10: Secondary face prompt authority wiring', () => {

    /**
     * Enhanced mock switchboard that supports .on() listener registration and replay.
     */
    function createEnhancedSwitchboard() {
      const _events = [];
      const _listeners = {};
      return {
        emit(name, payload) {
          _events.push({ name, payload });
          if (_listeners[name]) {
            _listeners[name].forEach(function (fn) { fn(payload); });
          }
        },
        on(name, handler) {
          if (!_listeners[name]) _listeners[name] = [];
          _listeners[name].push(handler);
        },
        getEvents() { return _events; },
        getListeners() { return _listeners; },
      };
    }

    describe('session:state-changed -> setSecondaryActive', () => {
      it('setSecondaryActive(true) called when transitioning to passive', () => {
        const sb = createEnhancedSwitchboard();
        const _calls = [];
        const cm = createMockContextManager();
        // Wrap setSecondaryActive to track calls
        cm.setSecondaryActive = function (active) {
          _calls.push({ setSecondaryActive: active });
        };

        // Manually register the same listener that reverie.cjs adds
        sb.on('session:state-changed', function (data) {
          if (!data) return;
          if (data.to === 'passive' || data.to === 'active') {
            cm.setSecondaryActive(true);
          } else if (data.to === 'stopped') {
            cm.setSecondaryActive(false);
          }
        });

        sb.emit('session:state-changed', { from: 'starting', to: 'passive' });

        const activeCalls = _calls.filter(function (c) { return 'setSecondaryActive' in c; });
        expect(activeCalls.length).toBe(1);
        expect(activeCalls[0].setSecondaryActive).toBe(true);
      });

      it('setSecondaryActive(false) called when transitioning to stopped', () => {
        const sb = createEnhancedSwitchboard();
        const _calls = [];
        const cm = createMockContextManager();
        cm.setSecondaryActive = function (active) {
          _calls.push({ setSecondaryActive: active });
        };

        sb.on('session:state-changed', function (data) {
          if (!data) return;
          if (data.to === 'passive' || data.to === 'active') {
            cm.setSecondaryActive(true);
          } else if (data.to === 'stopped') {
            cm.setSecondaryActive(false);
          }
        });

        sb.emit('session:state-changed', { from: 'shutting_down', to: 'stopped' });

        const activeCalls = _calls.filter(function (c) { return 'setSecondaryActive' in c; });
        expect(activeCalls.length).toBe(1);
        expect(activeCalls[0].setSecondaryActive).toBe(false);
      });
    });

    describe('Wire DIRECTIVE face_prompt -> receiveSecondaryUpdate', () => {
      it('DIRECTIVE with face_prompt role calls receiveSecondaryUpdate with content', () => {
        const _calls = [];
        const cm = createMockContextManager();
        cm.receiveSecondaryUpdate = function (fp) {
          _calls.push({ receiveSecondaryUpdate: fp });
          return { ok: true, value: { source: 'secondary', length: fp.length } };
        };

        // Simulate the callback that reverie.cjs registers on wireTopology.subscribe
        const onPrimaryMessage = function (envelope) {
          if (envelope.type === 'directive' && envelope.payload && envelope.payload.role === 'face_prompt') {
            cm.receiveSecondaryUpdate(envelope.payload.content);
          }
        };

        onPrimaryMessage({
          id: 'env-1',
          from: 'secondary',
          to: 'primary',
          type: 'directive',
          urgency: 'directive',
          payload: { role: 'face_prompt', content: 'Secondary composed prompt with referential framing' },
          timestamp: new Date().toISOString(),
        });

        const updateCalls = _calls.filter(function (c) { return 'receiveSecondaryUpdate' in c; });
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].receiveSecondaryUpdate).toBe('Secondary composed prompt with referential framing');
      });

      it('non-face_prompt DIRECTIVE does NOT call receiveSecondaryUpdate', () => {
        const _calls = [];
        const cm = createMockContextManager();
        cm.receiveSecondaryUpdate = function (fp) {
          _calls.push({ receiveSecondaryUpdate: fp });
        };

        const onPrimaryMessage = function (envelope) {
          if (envelope.type === 'directive' && envelope.payload && envelope.payload.role === 'face_prompt') {
            cm.receiveSecondaryUpdate(envelope.payload.content);
          }
        };

        onPrimaryMessage({
          id: 'env-2',
          from: 'secondary',
          to: 'primary',
          type: 'directive',
          urgency: 'directive',
          payload: { role: 'behavioral', content: 'Some behavioral directive' },
          timestamp: new Date().toISOString(),
        });

        const updateCalls = _calls.filter(function (c) { return 'receiveSecondaryUpdate' in c; });
        expect(updateCalls.length).toBe(0);
      });
    });

    describe('Full pipeline: Secondary update -> getInjection returns Secondary prompt', () => {
      it('after receiveSecondaryUpdate, getInjection returns the Secondary-provided face prompt', () => {
        // Use a REAL contextManager to verify end-to-end data flow
        const { createContextManager } = require('../../components/context/context-manager.cjs');

        const mockSelfModel = {
          getAspect() { return null; },
          async save() { return { ok: true, value: { aspect: 'test', version: 'v1' } }; },
        };
        const mockLathe = {
          async readFile() { return { ok: false, error: { code: 'FILE_NOT_FOUND' } }; },
          async writeFile() { return { ok: true, value: { path: '/tmp/test' } }; },
        };
        const mockSwitchboard = createEnhancedSwitchboard();

        const result = createContextManager({
          selfModel: mockSelfModel,
          lathe: mockLathe,
          switchboard: mockSwitchboard,
          entropy: { applyVariance(t) { return t; }, getState() { return {}; }, evolve() {} },
          dataDir: '/tmp/test-reverie-pipeline',
        });

        expect(result.ok).toBe(true);
        const contextManager = result.value;

        // Before Secondary update, getInjection is null (not yet init'd)
        expect(contextManager.getInjection()).toBe(null);

        // Simulate receiving Secondary face prompt update
        const updateResult = contextManager.receiveSecondaryUpdate(
          'Secondary: Referential framing with dual mode active'
        );
        expect(updateResult.ok).toBe(true);

        // After Secondary update, getInjection should return the Secondary-provided prompt
        expect(contextManager.getInjection()).toBe('Secondary: Referential framing with dual mode active');
      });
    });
  });

  // =========================================================================
  // Phase 11: REM Consolidation Integration
  // =========================================================================

  describe('Phase 11: handleSessionStart with remConsolidator', () => {
    it('calls remConsolidator.handleCrashRecovery (fire-and-forget)', async () => {
      const _calls = [];
      const mockRemConsolidator = {
        async handleCrashRecovery(sessionId) {
          _calls.push({ handleCrashRecovery: sessionId });
          return { hasOrphans: false, orphanedSessions: [], recoveryTriggered: false };
        },
        async handleDormantMaintenance() {
          _calls.push('handleDormantMaintenance');
          return { checked: 0, archived: 0, still_active: 0 };
        },
        async handleTier1(mindState) { _calls.push({ handleTier1: mindState }); },
        async handleTier3(ctx) { _calls.push({ handleTier3: ctx }); },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        remConsolidator: mockRemConsolidator,
      });

      await handlers.handleSessionStart({ session_id: 'test-session-1' });
      await new Promise(function (r) { setTimeout(r, 10); });
      const crashCalls = _calls.filter(function (c) { return typeof c === 'object' && c.handleCrashRecovery; });
      expect(crashCalls.length).toBe(1);
      expect(crashCalls[0].handleCrashRecovery).toBe('test-session-1');
    });

    it('calls remConsolidator.handleDormantMaintenance (fire-and-forget, per OPS-04)', async () => {
      const _calls = [];
      const mockRemConsolidator = {
        async handleCrashRecovery(sessionId) { _calls.push({ handleCrashRecovery: sessionId }); return { hasOrphans: false }; },
        async handleDormantMaintenance() {
          _calls.push('handleDormantMaintenance');
          return { checked: 5, archived: 1, still_active: 4 };
        },
        async handleTier1() {},
        async handleTier3() {},
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        remConsolidator: mockRemConsolidator,
      });

      await handlers.handleSessionStart({ session_id: 'test' });
      await new Promise(function (r) { setTimeout(r, 10); });
      expect(_calls).toContain('handleDormantMaintenance');
    });

    it('calls heartbeatMonitor.start()', async () => {
      const _calls = [];
      const mockHeartbeatMonitor = {
        start() { _calls.push('start'); },
        stop() { _calls.push('stop'); },
        isActive() { return true; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        heartbeatMonitor: mockHeartbeatMonitor,
      });

      await handlers.handleSessionStart({ session_id: 'test' });
      expect(_calls).toContain('start');
    });

    it('works without remConsolidator and heartbeatMonitor (backward compat)', async () => {
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleSessionStart({ session_id: 'test' });
      expect(result.hookSpecificOutput.hookEventName).toBe('SessionStart');
    });
  });

  describe('Phase 11: handleUserPromptSubmit with heartbeat', () => {
    it('sends HEARTBEAT message via Wire', async () => {
      const _sentEnvelopes = [];
      const mockWireTopology = {
        async send(envelope) {
          _sentEnvelopes.push(envelope);
          return { ok: true, value: { sent: true } };
        },
      };
      const mockSessionManager = {
        getState() { return { state: 'passive', secondary: 'sec-1', tertiary: null, config: {} }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        wireTopology: mockWireTopology,
        sessionManager: mockSessionManager,
      });

      await handlers.handleUserPromptSubmit({ user_prompt: 'Hello', session_id: 'test' });
      await new Promise(function (r) { setTimeout(r, 10); });
      const heartbeats = _sentEnvelopes.filter(function (e) { return e.type === 'heartbeat'; });
      expect(heartbeats.length).toBe(1);
      expect(heartbeats[0].from).toBe('primary');
      expect(heartbeats[0].to).toBe('secondary');
      expect(heartbeats[0].urgency).toBe('background');
      expect(heartbeats[0].payload.timestamp).toBeDefined();
    });
  });

  describe('Phase 11: handlePreCompact with remConsolidator', () => {
    it('calls remConsolidator.handleTier1 (fire-and-forget)', async () => {
      const _calls = [];
      const mockRemConsolidator = {
        async handleCrashRecovery() { return { hasOrphans: false }; },
        async handleDormantMaintenance() { return { checked: 0, archived: 0, still_active: 0 }; },
        async handleTier1(mindState) {
          _calls.push({ handleTier1: mindState });
          return { ok: true, value: {} };
        },
        async handleTier3() {},
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager({ _injection: 'face prompt text for testing' }),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        remConsolidator: mockRemConsolidator,
      });

      await handlers.handlePreCompact({ session_id: 'test' });
      await new Promise(function (r) { setTimeout(r, 10); });
      const tier1Calls = _calls.filter(function (c) { return c.handleTier1; });
      expect(tier1Calls.length).toBe(1);
      expect(tier1Calls[0].handleTier1.attention_pointer).toBe(null);
      expect(tier1Calls[0].handleTier1.self_model_prompt_state).toBeDefined();
    });
  });

  describe('Phase 11: handleStop with REM transition', () => {
    it('calls modeManager.requestRem then sessionManager.transitionToRem', async () => {
      const _calls = [];
      const mockModeManager = {
        async requestRem(reason) { _calls.push({ requestRem: reason }); return { ok: true, value: { mode: 'rem', changed: true } }; },
        async requestDormant() { _calls.push('requestDormant'); return { ok: true, value: { mode: 'dormant', changed: true } }; },
      };
      const mockSessionManager = {
        async start() { return { ok: true }; },
        async stop() { _calls.push('stop'); return { ok: true }; },
        async transitionToRem() { _calls.push('transitionToRem'); return { ok: true, value: { state: 'rem_processing' } }; },
        async completeRem() { _calls.push('completeRem'); return { ok: true }; },
        getState() { return { state: 'passive' }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        modeManager: mockModeManager,
        sessionManager: mockSessionManager,
      });

      await handlers.handleStop({ session_id: 'test' });
      const remCalls = _calls.filter(function (c) { return typeof c === 'object' && c.requestRem; });
      expect(remCalls.length).toBe(1);
      expect(remCalls[0].requestRem).toBe('session_end');
      expect(_calls).toContain('transitionToRem');
    });

    it('fires-and-forgets remConsolidator.handleTier3', async () => {
      const _calls = [];
      const mockModeManager = {
        async requestRem(reason) { _calls.push({ requestRem: reason }); return { ok: true, value: { mode: 'rem' } }; },
        async requestDormant() { _calls.push('requestDormant'); return { ok: true }; },
      };
      const mockSessionManager = {
        async start() { return { ok: true }; },
        async stop() { _calls.push('stop'); return { ok: true }; },
        async transitionToRem() { _calls.push('transitionToRem'); return { ok: true }; },
        async completeRem() { _calls.push('completeRem'); return { ok: true }; },
        getState() { return { state: 'passive' }; },
      };
      const mockRemConsolidator = {
        async handleCrashRecovery() { return { hasOrphans: false }; },
        async handleDormantMaintenance() { return { checked: 0, archived: 0, still_active: 0 }; },
        async handleTier1() {},
        async handleTier3(ctx) {
          _calls.push({ handleTier3: true });
          return { promoted: 3, discarded: 1, conditioningUpdated: true };
        },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        modeManager: mockModeManager,
        sessionManager: mockSessionManager,
        remConsolidator: mockRemConsolidator,
      });

      await handlers.handleStop({ session_id: 'test' });
      // Tier 3 is fire-and-forget, give it a tick
      await new Promise(function (r) { setTimeout(r, 20); });
      const tier3Calls = _calls.filter(function (c) { return typeof c === 'object' && c.handleTier3; });
      expect(tier3Calls.length).toBe(1);
      // After Tier 3, requestDormant and completeRem should also be called
      expect(_calls).toContain('requestDormant');
      expect(_calls).toContain('completeRem');
    });

    it('still calls contextManager.persistWarmStart', async () => {
      const cm = createMockContextManager();
      const mockModeManager = {
        async requestRem() { return { ok: true, value: { mode: 'rem' } }; },
        async requestDormant() { return { ok: true }; },
      };
      const mockSessionManager = {
        async stop() { return { ok: true }; },
        async transitionToRem() { return { ok: true }; },
        async completeRem() { return { ok: true }; },
        getState() { return { state: 'passive' }; },
      };
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        modeManager: mockModeManager,
        sessionManager: mockSessionManager,
      });

      await handlers.handleStop({ session_id: 'test' });
      expect(cm.getCalls()).toContain('persistWarmStart');
    });

    it('fallback to sessionManager.stop when modeManager not available', async () => {
      const _calls = [];
      const mockSessionManager = {
        async start() { return { ok: true }; },
        async stop() { _calls.push('stop'); return { ok: true }; },
        getState() { return { state: 'passive' }; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        sessionManager: mockSessionManager,
        // no modeManager -- Phase 10 fallback path
      });

      await handlers.handleStop({ session_id: 'test' });
      expect(_calls).toContain('stop');
    });

    it('calls heartbeatMonitor.stop()', async () => {
      const _calls = [];
      const mockHeartbeatMonitor = {
        start() { _calls.push('hb-start'); },
        stop() { _calls.push('hb-stop'); },
        isActive() { return true; },
      };
      const handlers = createHookHandlers({
        contextManager: createMockContextManager(),
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
        heartbeatMonitor: mockHeartbeatMonitor,
      });

      await handlers.handleStop({ session_id: 'test' });
      expect(_calls).toContain('hb-stop');
    });

    it('all existing Phase 8/9/10 behavior preserved via null-guard backward compat', async () => {
      // No remConsolidator, no heartbeatMonitor, no modeManager -- pure Phase 8/10 behavior
      const cm = createMockContextManager();
      const handlers = createHookHandlers({
        contextManager: cm,
        switchboard: createMockSwitchboard(),
        lathe: createMockLathe(),
        dataDir: '/tmp/test-reverie',
      });

      const result = await handlers.handleStop({ session_id: 'test' });
      expect(cm.getCalls()).toContain('persistWarmStart');
      expect(result).toEqual({});
    });
  });
});
