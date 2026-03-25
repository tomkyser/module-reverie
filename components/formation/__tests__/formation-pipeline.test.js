'use strict';

const { describe, it, expect } = require('bun:test');

describe('formation-pipeline', () => {
  let createFormationPipeline;

  function loadModule() {
    if (!createFormationPipeline) {
      ({ createFormationPipeline } = require('../formation-pipeline.cjs'));
    }
  }

  // ---------------------------------------------------------------------------
  // Mock factories
  // ---------------------------------------------------------------------------

  function createMockFragmentWriter() {
    const written = [];
    let idCounter = 0;
    return {
      generateFragmentId() {
        idCounter++;
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        return `frag-${y}-${m}-${d}-${String(idCounter).padStart(8, '0')}`;
      },
      async writeFragment(frontmatter, body) {
        written.push({ frontmatter, body });
        return { ok: true, value: { id: frontmatter.id, path: `working/${frontmatter.id}.md` } };
      },
      getWritten() { return written; },
    };
  }

  function createMockSelfModel() {
    const aspects = {
      'identity-core': { frontmatter: {}, body: 'I am a thoughtful assistant.' },
      'relational-model': { frontmatter: {}, body: 'We work well together on code.' },
      'conditioning': { frontmatter: {}, body: 'I tend to ask clarifying questions.' },
    };
    return {
      getAspect(name) {
        return aspects[name] || null;
      },
    };
  }

  function createMockLathe() {
    return {
      async writeFile() { return { ok: true }; },
      async readFile() { return { ok: false }; },
      async stat() { return { ok: true, value: { mtimeMs: Date.now() } }; },
    };
  }

  function createMockWire() {
    const queued = [];
    return {
      queueWrite(envelope) {
        queued.push(envelope);
        return { ok: true, value: undefined };
      },
      getQueued() { return queued; },
    };
  }

  function createMockSwitchboard() {
    const events = [];
    return {
      emit(name, data) { events.push({ name, data }); },
      getEvents() { return events; },
    };
  }

  function createMockAssay() {
    return {
      async search() {
        return { ok: true, value: { results: [] } };
      },
    };
  }

  function makePipeline(overrides) {
    loadModule();
    const defaults = {
      fragmentWriter: createMockFragmentWriter(),
      selfModel: createMockSelfModel(),
      lathe: createMockLathe(),
      wire: createMockWire(),
      switchboard: createMockSwitchboard(),
      assay: createMockAssay(),
    };
    return createFormationPipeline(Object.assign(defaults, overrides || {}));
  }

  // ---------------------------------------------------------------------------
  // prepareStimulus
  // ---------------------------------------------------------------------------

  describe('prepareStimulus', () => {
    it('returns stimulus package with turn_context, self_model, recalled_fragments, user_name, session_id', () => {
      const pipeline = makePipeline();
      const result = pipeline.prepareStimulus(
        { user_prompt: 'Tell me about your design philosophy' },
        { position: 5, turnNumber: 3, userName: 'Tom', sessionId: 'sess-001' }
      );

      expect(result).toBeDefined();
      expect(result.turn_context).toBeDefined();
      expect(result.turn_context.user_prompt).toBe('Tell me about your design philosophy');
      expect(result.turn_context.session_position).toBe(5);
      expect(result.turn_context.turn_number).toBe(3);
      expect(result.self_model).toBeDefined();
      expect(result.self_model.identity_summary).toBe('I am a thoughtful assistant.');
      expect(result.self_model.relational_summary).toBe('We work well together on code.');
      expect(result.self_model.conditioning_summary).toBe('I tend to ask clarifying questions.');
      expect(result.recalled_fragments).toEqual([]);
      expect(result.user_name).toBe('Tom');
      expect(result.session_id).toBe('sess-001');
    });

    it('reads Self Model aspects via getAspect for identity-core, relational-model, conditioning', () => {
      const calls = [];
      const mockSelfModel = {
        getAspect(name) {
          calls.push(name);
          return { body: 'test body for ' + name };
        },
      };
      const pipeline = makePipeline({ selfModel: mockSelfModel });
      pipeline.prepareStimulus(
        { user_prompt: 'Testing self model reads' },
        { sessionId: 's1' }
      );

      expect(calls).toContain('identity-core');
      expect(calls).toContain('relational-model');
      expect(calls).toContain('conditioning');
    });
  });

  // ---------------------------------------------------------------------------
  // processFormationOutput
  // ---------------------------------------------------------------------------

  describe('processFormationOutput', () => {
    it('returns formed: 0 when should_form is false', async () => {
      const pipeline = makePipeline();
      const result = await pipeline.processFormationOutput(
        JSON.stringify({ should_form: false }),
        { sessionId: 's1' }
      );

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(0);
    });

    it('processes valid JSON output, calls assembler and writes via fragmentWriter', async () => {
      const writer = createMockFragmentWriter();
      const pipeline = makePipeline({ fragmentWriter: writer });
      const output = JSON.stringify({
        should_form: true,
        fragments: [
          {
            formation_frame: 'relational',
            domains: ['trust'],
            entities: ['Tom'],
            attention_tags: ['vulnerability'],
            self_model_relevance: { identity: 0.3, relational: 0.8, conditioning: 0.1 },
            emotional_valence: 0.6,
            initial_weight: 0.7,
            body: 'There was something genuine in how they asked.',
          },
        ],
      });

      const result = await pipeline.processFormationOutput(output, { sessionId: 's1' });

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(1);
      expect(writer.getWritten().length).toBe(1);
      expect(writer.getWritten()[0].body).toBe('There was something genuine in how they asked.');
    });

    it('writes nudge via nudgeManager when output contains nudge text', async () => {
      let nudgeWritten = null;
      const mockLathe = {
        async writeFile(path, content) { nudgeWritten = content; },
      };
      const pipeline = makePipeline({ lathe: mockLathe });
      const output = JSON.stringify({
        should_form: true,
        nudge: 'A sense of openness colors the moment.',
        fragments: [
          {
            formation_frame: 'experiential',
            domains: ['openness'],
            entities: [],
            attention_tags: [],
            self_model_relevance: { identity: 0.2, relational: 0.3, conditioning: 0.1 },
            emotional_valence: 0.4,
            initial_weight: 0.5,
            body: 'They seem more open today.',
          },
        ],
      });

      await pipeline.processFormationOutput(output, { sessionId: 's1' });

      // The nudge manager should have been called; verify through lathe writeFile
      expect(nudgeWritten).not.toBeNull();
    });

    it('handles 1-3 fragments with formation group tagging and sibling references', async () => {
      const writer = createMockFragmentWriter();
      const pipeline = makePipeline({ fragmentWriter: writer });
      const output = JSON.stringify({
        should_form: true,
        fragments: [
          { formation_frame: 'relational', domains: ['trust'], entities: ['Tom'], attention_tags: ['patience'], self_model_relevance: { identity: 0.3, relational: 0.7, conditioning: 0.1 }, emotional_valence: 0.5, initial_weight: 0.6, body: 'Fragment one.' },
          { formation_frame: 'experiential', domains: ['trust', 'growth'], entities: ['Tom'], attention_tags: ['patience'], self_model_relevance: { identity: 0.4, relational: 0.5, conditioning: 0.2 }, emotional_valence: 0.3, initial_weight: 0.5, body: 'Fragment two.' },
          { formation_frame: 'reflective', domains: ['growth'], entities: [], attention_tags: ['change'], self_model_relevance: { identity: 0.6, relational: 0.2, conditioning: 0.3 }, emotional_valence: 0.2, initial_weight: 0.4, body: 'Fragment three.' },
        ],
      });

      const result = await pipeline.processFormationOutput(output, { sessionId: 's1' });

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(3);
      expect(result.value.formationGroup).toBeDefined();
      expect(result.value.formationGroup.startsWith('fg-')).toBe(true);

      // All siblings should share same formation group
      const written = writer.getWritten();
      expect(written.length).toBe(3);
      const groups = written.map(w => w.frontmatter.formation_group);
      expect(groups[0]).toBe(groups[1]);
      expect(groups[1]).toBe(groups[2]);

      // Each fragment should reference its siblings (not itself)
      for (let i = 0; i < 3; i++) {
        const siblings = written[i].frontmatter.sibling_fragments;
        expect(siblings.length).toBe(2);
        expect(siblings).not.toContain(written[i].frontmatter.id);
      }
    });

    it('caps at FORMATION_DEFAULTS.max_fragments_per_stimulus (3)', async () => {
      const writer = createMockFragmentWriter();
      const pipeline = makePipeline({ fragmentWriter: writer });
      const frag = { formation_frame: 'experiential', domains: ['test'], entities: [], attention_tags: [], self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 }, emotional_valence: 0, initial_weight: 0.5, body: 'frag' };
      const output = JSON.stringify({
        should_form: true,
        fragments: [frag, frag, frag, frag, frag],
      });

      const result = await pipeline.processFormationOutput(output, { sessionId: 's1' });

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(3);
      expect(result.value.total).toBe(3);
      expect(writer.getWritten().length).toBe(3);
    });

    it('handles parse failure gracefully', async () => {
      const pipeline = makePipeline();
      const result = await pipeline.processFormationOutput('not valid json at all', { sessionId: 's1' });

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getFormationStats
  // ---------------------------------------------------------------------------

  describe('getFormationStats', () => {
    it('returns totalFormed, sessionFormed, lastFormationTime', async () => {
      const pipeline = makePipeline();

      // Before any formation
      let stats = pipeline.getFormationStats();
      expect(stats.totalFormed).toBe(0);
      expect(stats.sessionFormed).toBe(0);
      expect(stats.lastFormationTime).toBeNull();

      // After a formation
      const output = JSON.stringify({
        should_form: true,
        fragments: [
          { formation_frame: 'experiential', domains: ['test'], entities: [], attention_tags: [], self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 }, emotional_valence: 0, initial_weight: 0.5, body: 'test body' },
        ],
      });
      await pipeline.processFormationOutput(output, { sessionId: 's1' });

      stats = pipeline.getFormationStats();
      expect(stats.totalFormed).toBe(1);
      expect(stats.sessionFormed).toBe(1);
      expect(stats.lastFormationTime).not.toBeNull();
      expect(typeof stats.lastFormationTime).toBe('number');
    });
  });
});
