'use strict';

const { describe, it, expect } = require('bun:test');

describe('fragment-assembler', () => {
  let createFragmentAssembler, validateFragment;

  function loadModules() {
    if (!createFragmentAssembler) {
      ({ createFragmentAssembler } = require('../fragment-assembler.cjs'));
      ({ validateFragment } = require('../../../lib/schemas.cjs'));
    }
  }

  // -------------------------------------------------------------------------
  // parseFormationOutput
  // -------------------------------------------------------------------------

  describe('parseFormationOutput', () => {
    it('parses valid JSON string with should_form and fragments', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const input = JSON.stringify({
        should_form: true,
        fragments: [{ formation_frame: 'relational', domains: ['trust'] }],
        nudge: 'A subtle awareness.',
      });

      const result = assembler.parseFormationOutput(input);
      expect(result.should_form).toBe(true);
      expect(result.fragments).toBeArray();
      expect(result.fragments.length).toBe(1);
      expect(result.nudge).toBe('A subtle awareness.');
    });

    it('extracts JSON from markdown code blocks', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const input = 'Here is the formation output:\n\n```json\n{"should_form": true, "fragments": []}\n```\n\nDone.';

      const result = assembler.parseFormationOutput(input);
      expect(result.should_form).toBe(true);
      expect(result.fragments).toBeArray();
    });

    it('extracts JSON from code blocks without language specifier', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const input = '```\n{"should_form": false}\n```';

      const result = assembler.parseFormationOutput(input);
      expect(result.should_form).toBe(false);
    });

    it('returns should_form: false on malformed input (random string)', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const result = assembler.parseFormationOutput('This is not JSON at all.');
      expect(result.should_form).toBe(false);
      expect(result.error).toBe('parse_failed');
    });

    it('returns should_form: false on empty string', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const result = assembler.parseFormationOutput('');
      expect(result.should_form).toBe(false);
      expect(result.error).toBe('parse_failed');
    });

    it('returns should_form: false on partial JSON', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const result = assembler.parseFormationOutput('{"should_form": true, "frag');
      expect(result.should_form).toBe(false);
      expect(result.error).toBe('parse_failed');
    });

    it('never throws regardless of input', () => {
      loadModules();
      const assembler = createFragmentAssembler({});

      // Should not throw for any of these
      expect(() => assembler.parseFormationOutput(null)).not.toThrow();
      expect(() => assembler.parseFormationOutput(undefined)).not.toThrow();
      expect(() => assembler.parseFormationOutput(42)).not.toThrow();
      expect(() => assembler.parseFormationOutput({})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // buildFrontmatter
  // -------------------------------------------------------------------------

  describe('buildFrontmatter', () => {
    /**
     * Creates a valid fragment data payload (simulating LLM formation output).
     */
    function makeFragmentData(overrides) {
      return {
        formation_frame: 'relational',
        domains: ['trust-building', 'communication-style'],
        entities: ['project-alpha'],
        attention_tags: ['deadline-pressure', 'tone-shift'],
        self_model_relevance: { identity: 0.3, relational: 0.7, conditioning: 0.2 },
        emotional_valence: 0.4,
        initial_weight: 0.65,
        body: 'Something shifted in how they talked about the timeline.',
        source_locator: null,
        source_fragments: [],
        ...overrides,
      };
    }

    /**
     * Creates a valid context object.
     */
    function makeContext(overrides) {
      return {
        id: 'frag-2026-03-24-abcd1234',
        formationGroup: 'fg-2026-03-24-001',
        siblings: ['frag-2026-03-24-efgh5678'],
        sessionContext: {
          sessionId: 'session-abc123',
          selfModelVersion: '0.1.0',
          sessionStart: '2026-03-24T12:00:00.000Z',
          sessionPosition: 0.25,
          turnNumber: 5,
          trigger: 'user_prompt',
        },
        ...overrides,
      };
    }

    it('produces a complete frontmatter object that passes validateFragment()', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const frontmatter = assembler.buildFrontmatter(makeFragmentData(), makeContext());
      const validation = validateFragment(frontmatter);

      expect(validation.ok).toBe(true);
    });

    it('sets type to experiential by default', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const frontmatter = assembler.buildFrontmatter(makeFragmentData(), makeContext());
      expect(frontmatter.type).toBe('experiential');
    });

    it('sets type to meta-recall when source_fragments present', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const data = makeFragmentData({ source_fragments: ['frag-2026-03-20-11112222'] });
      const frontmatter = assembler.buildFrontmatter(data, makeContext());
      expect(frontmatter.type).toBe('meta-recall');

      // Validate passes for meta-recall
      const validation = validateFragment(frontmatter);
      expect(validation.ok).toBe(true);
    });

    it('sets type to source-reference when source_locator present', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const data = makeFragmentData({
        source_locator: {
          type: 'file',
          path: '/tmp/docs/readme.md',
          url: null,
          content_hash: 'abc123',
          last_verified: new Date().toISOString(),
        },
      });
      const frontmatter = assembler.buildFrontmatter(data, makeContext());
      expect(frontmatter.type).toBe('source-reference');

      // Validate passes for source-reference
      const validation = validateFragment(frontmatter);
      expect(validation.ok).toBe(true);
    });

    it('populates all required base schema fields', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const frontmatter = assembler.buildFrontmatter(makeFragmentData(), makeContext());

      // Core fields
      expect(frontmatter.id).toBe('frag-2026-03-24-abcd1234');
      expect(frontmatter.type).toBe('experiential');
      expect(frontmatter.created).toBeDefined();
      expect(frontmatter.source_session).toBe('session-abc123');
      expect(frontmatter.self_model_version).toBe('0.1.0');
      expect(frontmatter.formation_group).toBe('fg-2026-03-24-001');
      expect(frontmatter.formation_frame).toBe('relational');
      expect(frontmatter.sibling_fragments).toEqual(['frag-2026-03-24-efgh5678']);

      // Temporal
      expect(frontmatter.temporal).toBeDefined();
      expect(frontmatter.temporal.absolute).toBeDefined();
      expect(typeof frontmatter.temporal.session_relative).toBe('number');
      expect(typeof frontmatter.temporal.sequence).toBe('number');

      // Decay
      expect(frontmatter.decay).toBeDefined();
      expect(frontmatter.decay.initial_weight).toBe(0.65);
      expect(frontmatter.decay.current_weight).toBe(0.65);
      expect(frontmatter.decay.access_count).toBe(0);
      expect(frontmatter.decay.consolidation_count).toBe(0);
      expect(frontmatter.decay.pinned).toBe(false);

      // Associations
      expect(frontmatter.associations.domains).toEqual(['trust-building', 'communication-style']);
      expect(frontmatter.associations.entities).toEqual(['project-alpha']);
      expect(frontmatter.associations.attention_tags).toEqual(['deadline-pressure', 'tone-shift']);
      expect(frontmatter.associations.self_model_relevance).toEqual({ identity: 0.3, relational: 0.7, conditioning: 0.2 });
      expect(frontmatter.associations.emotional_valence).toBe(0.4);

      // Pointers
      expect(frontmatter.pointers).toBeDefined();
      expect(frontmatter.pointers.causal_antecedents).toEqual([]);
      expect(frontmatter.pointers.thematic_siblings).toEqual(['frag-2026-03-24-efgh5678']);
      expect(frontmatter.pointers.source_fragments).toEqual([]);

      // Formation
      expect(frontmatter.formation).toBeDefined();
      expect(frontmatter.formation.trigger).toBe('user_prompt');
      expect(frontmatter.formation.attention_pointer).toBe('deadline-pressure');
      expect(frontmatter.formation.active_domains_at_formation).toEqual(['trust-building', 'communication-style']);
    });

    it('handles missing optional fields with safe defaults', () => {
      loadModules();
      const assembler = createFragmentAssembler({});
      const minimalData = {
        formation_frame: 'experiential',
        body: 'A moment noticed.',
      };
      const minimalContext = {
        id: 'frag-2026-03-24-00001111',
        formationGroup: 'fg-001',
        siblings: [],
        sessionContext: {
          sessionId: 'sess-1',
        },
      };

      const frontmatter = assembler.buildFrontmatter(minimalData, minimalContext);
      const validation = validateFragment(frontmatter);
      expect(validation.ok).toBe(true);

      // Check defaults applied
      expect(frontmatter.self_model_version).toBe('0.0.0');
      expect(frontmatter.decay.initial_weight).toBe(0.5);
      expect(frontmatter.associations.domains).toEqual([]);
      expect(frontmatter.associations.self_model_relevance).toEqual({ identity: 0, relational: 0, conditioning: 0 });
      expect(frontmatter.associations.emotional_valence).toBe(0);
    });
  });
});
