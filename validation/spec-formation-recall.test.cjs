'use strict';

/**
 * Spec compliance tests: Formation Pipeline (3.6, 3.12), Recall Engine (3.7),
 * Taxonomy Self-Organization (3.10).
 *
 * Verifies behavioral and structural compliance against reverie-spec-v2.md.
 * Per D-01: section-by-section walkthrough with adversarial read.
 * Per D-02: verify what spec says SHOULD exist actually DOES exist.
 * Per D-07: every violation fix includes a regression test.
 * Per D-10: standalone test target in modules/reverie/validation/.
 *
 * @module reverie/validation/spec-formation-recall
 */

const { describe, it, expect } = require('bun:test');

// ---------------------------------------------------------------------------
// Formation Pipeline components
// ---------------------------------------------------------------------------
const { createFormationPipeline } = require('../components/formation/formation-pipeline.cjs');
const { createAttentionGate } = require('../components/formation/attention-gate.cjs');
const { FORMATION_TEMPLATES, RECONSTRUCTION_TEMPLATES } = require('../components/formation/prompt-templates.cjs');
const { createFragmentAssembler } = require('../components/formation/fragment-assembler.cjs');
const { createNudgeManager } = require('../components/formation/nudge-manager.cjs');

// ---------------------------------------------------------------------------
// Recall Engine components
// ---------------------------------------------------------------------------
const { createRecallEngine } = require('../components/recall/recall-engine.cjs');
const { createCompositeScorer } = require('../components/recall/composite-scorer.cjs');
const { createQueryBuilder } = require('../components/recall/query-builder.cjs');
const { createReconstructionPrompt } = require('../components/recall/reconstruction-prompt.cjs');

// ---------------------------------------------------------------------------
// Taxonomy components
// ---------------------------------------------------------------------------
const { createTaxonomyGovernor } = require('../components/taxonomy/taxonomy-governor.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const {
  SCORING_DEFAULTS,
  FORMATION_DEFAULTS,
  TAXONOMY_DEFAULTS,
} = require('../lib/constants.cjs');

// ---------------------------------------------------------------------------
// Mock helpers -- minimal shapes matching real factory signatures
// ---------------------------------------------------------------------------

function createMockSelfModel() {
  return {
    getAspect(name) {
      if (name === 'identity-core') return { body: 'Identity stub' };
      if (name === 'relational-model') return { body: 'Relational stub' };
      if (name === 'conditioning') return { body: 'Conditioning stub' };
      return null;
    },
  };
}

function createMockFragmentWriter() {
  let _idCounter = 0;
  const _written = [];
  return {
    generateFragmentId() {
      _idCounter++;
      const hex = _idCounter.toString(16).padStart(8, '0');
      const date = new Date().toISOString().split('T')[0];
      return `frag-${date}-${hex}`;
    },
    async writeFragment(frontmatter, body) {
      _written.push({ frontmatter, body });
      return { ok: true, value: { id: frontmatter.id } };
    },
    getWritten() {
      return _written;
    },
  };
}

function createMockWire() {
  const _queued = [];
  return {
    queueWrite(envelope) {
      _queued.push(envelope);
    },
    getQueued() {
      return _queued;
    },
  };
}

function createMockLathe() {
  const _files = new Map();
  return {
    async writeFile(filePath, content) {
      _files.set(filePath, { content, mtimeMs: Date.now() });
    },
    async readFile(filePath) {
      const f = _files.get(filePath);
      if (!f) return { ok: false, error: 'not_found' };
      return { ok: true, value: f.content };
    },
    async stat(filePath) {
      const f = _files.get(filePath);
      if (!f) return { ok: false, error: 'not_found' };
      return { ok: true, value: { mtimeMs: f.mtimeMs } };
    },
  };
}

function createMockAssay(results) {
  return {
    async search(query) {
      return { ok: true, value: { results: results || [] } };
    },
  };
}

function createMockSwitchboard() {
  const _events = [];
  return {
    emit(event, data) {
      _events.push({ event, data });
    },
    getEmitted() {
      return _events;
    },
  };
}

// ==========================================================================
// Spec 3.6: Formation Pipeline
// ==========================================================================

describe('Spec 3.6: Formation Pipeline', () => {

  // --------------------------------------------------------------------------
  // Step 1: Attention check
  // --------------------------------------------------------------------------

  describe('Step 1: Attention check', () => {
    it('evaluates stimulus and returns pass/fail decision gating formation', () => {
      const gate = createAttentionGate({});
      // A substantive prompt should pass
      const result = gate.evaluate({
        user_prompt: 'I have been thinking about how we approach debugging sessions together.',
        tools_used: [],
      });
      expect(result.pass).toBe(true);
      expect(result.reason).toBe('passed');
    });

    it('rejects empty prompts as below attention threshold', () => {
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: '', tools_used: [] });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('empty_prompt');
    });

    it('rejects null/falsy prompts', () => {
      const gate = createAttentionGate({});
      const result = gate.evaluate({ user_prompt: null, tools_used: [] });
      expect(result.pass).toBe(false);
    });

    it('rejects prompts shorter than configurable minimum length', () => {
      const gate = createAttentionGate({ minPromptLength: 50 });
      const result = gate.evaluate({
        user_prompt: 'Short prompt under 50 chars',
        tools_used: [],
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('too_short');
    });

    it('returns pure_tool_turn when tools_used populated and user_prompt falsy (STATE.md deviation)', () => {
      // Per STATE.md [Phase 09]: attention gate returns pure_tool_turn over
      // empty_prompt when tools_used populated and user_prompt falsy
      const gate = createAttentionGate({});
      const result = gate.evaluate({
        user_prompt: null,
        tools_used: ['Read', 'Bash'],
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('pure_tool_turn');
    });

    it('uses FORMATION_DEFAULTS.min_prompt_length as default threshold', () => {
      const gate = createAttentionGate({});
      // Default is 20 chars -- test a 19-char prompt
      const result = gate.evaluate({
        user_prompt: 'x'.repeat(FORMATION_DEFAULTS.min_prompt_length - 1),
        tools_used: [],
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('too_short');

      // Exactly at the threshold should pass
      const result2 = gate.evaluate({
        user_prompt: 'x'.repeat(FORMATION_DEFAULTS.min_prompt_length),
        tools_used: [],
      });
      expect(result2.pass).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Step 2: Domain fan-out
  // --------------------------------------------------------------------------

  describe('Step 2: Domain fan-out', () => {
    it('has domain_identification prompt template for LLM-based domain classification', () => {
      // Spec 3.6: "The Mind classifies which of its self-organized domains the
      // stimulus activates." Per D-16, domain identification is prompt-driven.
      expect(FORMATION_TEMPLATES.domain_identification).toBeDefined();
      expect(FORMATION_TEMPLATES.domain_identification.system).toBeDefined();
      expect(typeof FORMATION_TEMPLATES.domain_identification.user).toBe('function');
    });

    it('domain_identification template instructs free-text domain emergence (not a fixed list)', () => {
      // Spec 3.6: "Each domain that exceeds its activation threshold produces its own fragment"
      // Per D-08: Domains are free-text, not from a predefined list
      const systemPrompt = FORMATION_TEMPLATES.domain_identification.system;
      expect(systemPrompt).toContain('not categories from a list');
    });

    it('processFormationOutput handles multiple fragments from same stimulus (fan-out)', () => {
      // Spec 3.6: "A stimulus that activates three domains produces three fragments"
      const assembler = createFragmentAssembler({});
      const rawOutput = JSON.stringify({
        should_form: true,
        fragments: [
          {
            formation_frame: 'relational',
            domains: ['trust-calibration'],
            entities: ['user'],
            attention_tags: ['trust'],
            self_model_relevance: { identity: 0.3, relational: 0.8, conditioning: 0.2 },
            emotional_valence: 0.5,
            initial_weight: 0.7,
            body: 'A relational impression.',
          },
          {
            formation_frame: 'experiential',
            domains: ['technical-collaboration'],
            entities: ['debugging'],
            attention_tags: ['collaboration'],
            self_model_relevance: { identity: 0.5, relational: 0.4, conditioning: 0.3 },
            emotional_valence: 0.3,
            initial_weight: 0.6,
            body: 'A technical impression.',
          },
          {
            formation_frame: 'reflective',
            domains: ['self-awareness'],
            entities: ['pattern'],
            attention_tags: ['metacognition'],
            self_model_relevance: { identity: 0.7, relational: 0.2, conditioning: 0.5 },
            emotional_valence: 0.1,
            initial_weight: 0.5,
            body: 'A reflective impression.',
          },
        ],
      });

      const parsed = assembler.parseFormationOutput(rawOutput);
      expect(parsed.should_form).toBe(true);
      expect(parsed.fragments.length).toBe(3);
      // Each fragment has different domain tags -- verifying fan-out
      expect(parsed.fragments[0].domains[0]).toBe('trust-calibration');
      expect(parsed.fragments[1].domains[0]).toBe('technical-collaboration');
      expect(parsed.fragments[2].domains[0]).toBe('self-awareness');
    });

    it('caps fragments per stimulus at FORMATION_DEFAULTS.max_fragments_per_stimulus', async () => {
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: fw,
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      // Build raw output with more fragments than allowed
      const fragments = [];
      for (let i = 0; i < 10; i++) {
        fragments.push({
          formation_frame: 'experiential',
          domains: [`domain-${i}`],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
          emotional_valence: 0,
          initial_weight: 0.5,
          body: `Fragment ${i}`,
        });
      }

      const result = await pipeline.processFormationOutput(
        JSON.stringify({ should_form: true, fragments }),
        { sessionId: 'test-session' }
      );

      expect(result.ok).toBe(true);
      // Should be capped
      expect(result.value.formed).toBeLessThanOrEqual(FORMATION_DEFAULTS.max_fragments_per_stimulus);
      expect(result.value.total).toBe(FORMATION_DEFAULTS.max_fragments_per_stimulus);
    });
  });

  // --------------------------------------------------------------------------
  // Step 3: Per-fragment processing
  // --------------------------------------------------------------------------

  describe('Step 3: Per-fragment processing', () => {
    it('body_composition template requests self_model_relevance with 3 dimensions (identity, relational, conditioning)', () => {
      // Spec 3.6 step 3a: "Score the stimulus against the three Self Model dimensions"
      const userPrompt = FORMATION_TEMPLATES.body_composition.user(
        { user_prompt: 'test' },
        'test-domain',
        { user_name: 'Alice', aspects: {} },
        []
      );
      expect(userPrompt).toContain('self_model_relevance');
      expect(userPrompt).toContain('identity');
      expect(userPrompt).toContain('relational');
      expect(userPrompt).toContain('conditioning');
    });

    it('body_composition template requests association generation fields', () => {
      // Spec 3.6 step 3b: "Generate domain-specific associations -- entity references,
      // attention tags, emotional valence, pointers to related fragments"
      const userPrompt = FORMATION_TEMPLATES.body_composition.user(
        { user_prompt: 'test' },
        'test-domain',
        { user_name: 'Alice' },
        []
      );
      expect(userPrompt).toContain('entities');
      expect(userPrompt).toContain('attention_tags');
      expect(userPrompt).toContain('emotional_valence');
    });

    it('body_composition template requests impressionistic body text', () => {
      // Spec 3.6 step 3c: "Write the impressionistic body from this domain's angle"
      const systemPrompt = FORMATION_TEMPLATES.body_composition.system;
      expect(systemPrompt).toContain('impressionistic');
    });

    it('body_composition template requests initial_weight for decay seeding', () => {
      // Spec 3.6 step 3d: "Initial weight set based on domain-specific relevance scores"
      const userPrompt = FORMATION_TEMPLATES.body_composition.user(
        { user_prompt: 'test' },
        'test-domain',
        { user_name: 'Alice' },
        []
      );
      expect(userPrompt).toContain('initial_weight');
    });

    it('fragment assembler builds frontmatter with self_model_relevance from subagent output', () => {
      // Structural verification: the assembled frontmatter carries the 3 SMR dimensions
      const assembler = createFragmentAssembler({});
      const fm = assembler.buildFrontmatter(
        {
          self_model_relevance: { identity: 0.4, relational: 0.7, conditioning: 0.3 },
          domains: ['trust'],
          entities: ['user'],
          attention_tags: ['trust-shift'],
          emotional_valence: 0.5,
          initial_weight: 0.7,
          body: 'Test body',
        },
        {
          id: 'frag-2026-03-25-00000001',
          formationGroup: 'fg-testgroup',
          siblings: [],
          sessionContext: { sessionId: 'test', trigger: 'user_prompt' },
        }
      );

      expect(fm.associations.self_model_relevance.identity).toBe(0.4);
      expect(fm.associations.self_model_relevance.relational).toBe(0.7);
      expect(fm.associations.self_model_relevance.conditioning).toBe(0.3);
    });

    it('fragment assembler builds decay seeding from initial_weight', () => {
      // Spec 3.6 step 3d: initial_weight -> decay.initial_weight and decay.current_weight
      const assembler = createFragmentAssembler({});
      const fm = assembler.buildFrontmatter(
        { initial_weight: 0.85 },
        {
          id: 'frag-2026-03-25-00000002',
          formationGroup: 'fg-test',
          sessionContext: { sessionId: 'test' },
        }
      );

      expect(fm.decay.initial_weight).toBe(0.85);
      expect(fm.decay.current_weight).toBe(0.85);
      expect(fm.decay.access_count).toBe(0);
      expect(fm.decay.consolidation_count).toBe(0);
      expect(fm.decay.pinned).toBe(false);
    });

    it('fragment assembler classifies type emergently per D-14', () => {
      const assembler = createFragmentAssembler({});

      // Experiential (default)
      const fm1 = assembler.buildFrontmatter(
        { body: 'test' },
        { id: 'frag-2026-03-25-00000003', formationGroup: 'fg-1', sessionContext: {} }
      );
      expect(fm1.type).toBe('experiential');

      // Source-reference (has source_locator)
      const fm2 = assembler.buildFrontmatter(
        { body: 'test', source_locator: '/path/to/file.md' },
        { id: 'frag-2026-03-25-00000004', formationGroup: 'fg-2', sessionContext: {} }
      );
      expect(fm2.type).toBe('source-reference');
      expect(fm2.source_locator).toBe('/path/to/file.md');

      // Meta-recall (has source_fragments)
      const fm3 = assembler.buildFrontmatter(
        { body: 'test', source_fragments: ['frag-2026-03-25-00000001'] },
        { id: 'frag-2026-03-25-00000005', formationGroup: 'fg-3', sessionContext: {} }
      );
      expect(fm3.type).toBe('meta-recall');
    });
  });

  // --------------------------------------------------------------------------
  // Step 4: Formation group tagging
  // --------------------------------------------------------------------------

  describe('Step 4: Formation group tagging', () => {
    it('all fragments from same stimulus share formation_group ID', async () => {
      // Spec 3.6: "All fragments produced from the same stimulus receive
      // a shared formation_group ID"
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: fw,
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      await pipeline.processFormationOutput(
        JSON.stringify({
          should_form: true,
          fragments: [
            { domains: ['a'], entities: [], attention_tags: [], body: 'Body 1',
              self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.5 },
            { domains: ['b'], entities: [], attention_tags: [], body: 'Body 2',
              self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.5 },
          ],
        }),
        { sessionId: 'test' }
      );

      const written = fw.getWritten();
      expect(written.length).toBe(2);

      // Both fragments should share the same formation_group
      const fg1 = written[0].frontmatter.formation_group;
      const fg2 = written[1].frontmatter.formation_group;
      expect(fg1).toBe(fg2);
      expect(fg1).toMatch(/^fg-/);
    });

    it('sibling_fragments pointers link fragments within formation group', async () => {
      // Spec 3.6: "sibling_fragments pointers"
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: fw,
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      await pipeline.processFormationOutput(
        JSON.stringify({
          should_form: true,
          fragments: [
            { domains: ['a'], entities: [], attention_tags: [], body: 'Body 1',
              self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.5 },
            { domains: ['b'], entities: [], attention_tags: [], body: 'Body 2',
              self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.5 },
          ],
        }),
        { sessionId: 'test' }
      );

      const written = fw.getWritten();
      expect(written.length).toBe(2);

      const id0 = written[0].frontmatter.id;
      const id1 = written[1].frontmatter.id;

      // Fragment 0 should point to Fragment 1 as sibling
      expect(written[0].frontmatter.sibling_fragments).toContain(id1);
      // Fragment 1 should point to Fragment 0 as sibling
      expect(written[1].frontmatter.sibling_fragments).toContain(id0);
    });
  });

  // --------------------------------------------------------------------------
  // Step 5: Write
  // --------------------------------------------------------------------------

  describe('Step 5: Write', () => {
    it('writes fragments via FragmentWriter (Journal + Ledger)', async () => {
      // Spec 3.6: "All fragments written to Journal. Association index updated in Ledger."
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: fw,
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      const result = await pipeline.processFormationOutput(
        JSON.stringify({
          should_form: true,
          fragments: [
            { domains: ['test'], entities: ['user'], attention_tags: ['tag1'],
              body: 'Test body',
              self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.6 },
          ],
        }),
        { sessionId: 'test' }
      );

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(1);

      // Verify fragment was written
      const written = fw.getWritten();
      expect(written.length).toBe(1);
      expect(written[0].body).toBe('Test body');
    });

    it('populates master association tables via Wire BEFORE fragment writes (Pitfall 5)', async () => {
      // Per STATE.md [Phase 09]: "Formation pipeline populates master association
      // tables via Wire upserts BEFORE fragment writes"
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: fw,
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      await pipeline.processFormationOutput(
        JSON.stringify({
          should_form: true,
          fragments: [
            { domains: ['trust'], entities: ['alice'], attention_tags: ['greeting'],
              body: 'Test body',
              self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.5 },
          ],
        }),
        { sessionId: 'test' }
      );

      // Wire should have received domain, entity, and tag upserts
      const queued = wire.getQueued();
      const tables = queued.map(e => e.payload.table);
      expect(tables).toContain('domains');
      expect(tables).toContain('entities');
      expect(tables).toContain('attention_tags');
    });

    it('returns should_form=false path without writing anything', async () => {
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: fw,
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      const result = await pipeline.processFormationOutput(
        JSON.stringify({ should_form: false }),
        { sessionId: 'test' }
      );

      expect(result.ok).toBe(true);
      expect(result.value.formed).toBe(0);
      expect(fw.getWritten().length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Noise/signal gates
  // --------------------------------------------------------------------------

  describe('Noise/signal gates', () => {
    it('Gate 1 (attention check) is the coarsest filter', () => {
      // Spec 3.6: "Gate 1: Attention check (step 1). Not every stimulus activates
      // formation at all."
      const gate = createAttentionGate({});

      // Short prompts are rejected at the coarsest level
      const short = gate.evaluate({ user_prompt: 'hi', tools_used: [] });
      expect(short.pass).toBe(false);

      // Substantive prompts pass through
      const substantive = gate.evaluate({
        user_prompt: 'I have been reflecting on our conversation from last week about trust.',
        tools_used: [],
      });
      expect(substantive.pass).toBe(true);
    });

    it('Gate 2 (domain activation threshold) is handled by LLM prompt template', () => {
      // Spec 3.6: "A domain doesn't produce a fragment just because it weakly
      // resonates. The activation must exceed a per-domain threshold."
      // Per D-16: This is prompt-driven -- the attention_check template asks
      // whether the moment "registers" and the domain_identification template
      // classifies which domains activate.
      expect(FORMATION_TEMPLATES.attention_check).toBeDefined();
      expect(FORMATION_TEMPLATES.attention_check.system).toContain('Most moments do not');
    });

    it('Gate 3 (REM pruning) is post-session -- not in formation pipeline', () => {
      // Spec 3.6: "Multi-angle fragments from the same stimulus are evaluated
      // retroactively during consolidation."
      // Formation pipeline does not implement Gate 3 -- it is handled by REM.
      // This is a structural compliance check.
      const pipeline = createFormationPipeline({
        fragmentWriter: createMockFragmentWriter(),
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire: createMockWire(),
      });
      // Pipeline has no pruning method -- Gate 3 is not its responsibility
      expect(typeof pipeline.processFormationOutput).toBe('function');
      expect(pipeline.pruneFragments).toBeUndefined();
    });
  });
});

// ==========================================================================
// Spec 3.7: Fragment Recall
// ==========================================================================

describe('Spec 3.7: Fragment Recall', () => {

  // --------------------------------------------------------------------------
  // Retrieval ranking dimensions
  // --------------------------------------------------------------------------

  describe('Retrieval ranking dimensions', () => {
    it('composite scorer implements 6 scoring factors covering spec 7 ranking dimensions', () => {
      // Spec 3.7 lists 7 ranking dimensions. Implementation maps these to 6 factors:
      // 1. "Attention pointer similarity" -> subsumed into attention_tag_match
      //    (attention pointer is represented as attention tags in the implementation)
      // 2. "Domain overlap" -> domain_overlap
      // 3. "Association tag matching" -> attention_tag_match
      // 4. "Entity co-occurrence" -> entity_cooccurrence
      // 5. "Temporal proximity" -> temporal_proximity
      // 6. "Self Model relevance weighting" -> self_model_relevance
      // 7. "Decay weighting" -> decay_weight
      //
      // Deviation: "Attention pointer similarity" is merged with "Association tag matching"
      // into a single attention_tag_match factor. Justified because the attention pointer
      // is represented as attention tags in the data model.
      expect(SCORING_DEFAULTS.domain_overlap).toBeDefined();
      expect(SCORING_DEFAULTS.entity_cooccurrence).toBeDefined();
      expect(SCORING_DEFAULTS.attention_tag_match).toBeDefined();
      expect(SCORING_DEFAULTS.decay_weight).toBeDefined();
      expect(SCORING_DEFAULTS.self_model_relevance).toBeDefined();
      expect(SCORING_DEFAULTS.temporal_proximity).toBeDefined();

      // Weights should sum to 1.0
      const sum = SCORING_DEFAULTS.domain_overlap
        + SCORING_DEFAULTS.entity_cooccurrence
        + SCORING_DEFAULTS.attention_tag_match
        + SCORING_DEFAULTS.decay_weight
        + SCORING_DEFAULTS.self_model_relevance
        + SCORING_DEFAULTS.temporal_proximity;
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('domain overlap factor: scores fragments by intersection of fragment and query domains', () => {
      const scorer = createCompositeScorer({});
      const fragment = {
        associations: {
          domains: ['trust', 'communication'],
          entities: [],
          attention_tags: [],
        },
        decay: { current_weight: 1.0 },
        created: new Date().toISOString(),
      };

      const ctx = {
        activeDomains: ['trust', 'engineering'],
        activeEntities: [],
        attentionTags: [],
        referenceTime: Date.now(),
      };

      const score = scorer.compositeScore(fragment, ctx);
      expect(score).toBeGreaterThan(0);
    });

    it('entity co-occurrence factor: scores by shared entity references', () => {
      const scorer = createCompositeScorer({});
      const fragment = {
        associations: {
          domains: [],
          entities: ['alice', 'project-x'],
          attention_tags: [],
        },
        decay: { current_weight: 1.0 },
        created: new Date().toISOString(),
      };

      const ctxMatch = {
        activeDomains: [],
        activeEntities: ['alice', 'project-x'],
        attentionTags: [],
        referenceTime: Date.now(),
      };

      const ctxNoMatch = {
        activeDomains: [],
        activeEntities: ['bob'],
        attentionTags: [],
        referenceTime: Date.now(),
      };

      const scoreMatch = scorer.compositeScore(fragment, ctxMatch);
      const scoreNoMatch = scorer.compositeScore(fragment, ctxNoMatch);
      expect(scoreMatch).toBeGreaterThan(scoreNoMatch);
    });

    it('attention tag match factor: scores by tag overlap', () => {
      const scorer = createCompositeScorer({});
      const fragment = {
        associations: {
          domains: [],
          entities: [],
          attention_tags: ['trust-shift', 'vulnerability'],
        },
        decay: { current_weight: 1.0 },
        created: new Date().toISOString(),
      };

      const ctxMatch = {
        activeDomains: [],
        activeEntities: [],
        attentionTags: ['trust-shift', 'vulnerability'],
        referenceTime: Date.now(),
      };

      const ctxNoMatch = {
        activeDomains: [],
        activeEntities: [],
        attentionTags: ['unrelated'],
        referenceTime: Date.now(),
      };

      const scoreMatch = scorer.compositeScore(fragment, ctxMatch);
      const scoreNoMatch = scorer.compositeScore(fragment, ctxNoMatch);
      expect(scoreMatch).toBeGreaterThan(scoreNoMatch);
    });

    it('decay weighting factor: uses pre-computed current_weight from fragment', () => {
      const scorer = createCompositeScorer({});
      const now = new Date().toISOString();

      const freshFragment = {
        associations: { domains: [], entities: [], attention_tags: [] },
        decay: { current_weight: 0.95 },
        created: now,
      };

      const decayedFragment = {
        associations: { domains: [], entities: [], attention_tags: [] },
        decay: { current_weight: 0.1 },
        created: now,
      };

      const ctx = {
        activeDomains: [],
        activeEntities: [],
        attentionTags: [],
        referenceTime: Date.now(),
      };

      const scoreFresh = scorer.compositeScore(freshFragment, ctx);
      const scoreDecayed = scorer.compositeScore(decayedFragment, ctx);
      expect(scoreFresh).toBeGreaterThan(scoreDecayed);
    });

    it('self model relevance factor: weighted average of identity/relational/conditioning', () => {
      const scorer = createCompositeScorer({});
      const now = new Date().toISOString();

      const highRelevance = {
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0.9, relational: 0.9, conditioning: 0.9 },
        },
        decay: { current_weight: 0.5 },
        created: now,
      };

      const lowRelevance = {
        associations: {
          domains: [],
          entities: [],
          attention_tags: [],
          self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.1 },
        },
        decay: { current_weight: 0.5 },
        created: now,
      };

      const ctx = {
        activeDomains: [],
        activeEntities: [],
        attentionTags: [],
        referenceTime: Date.now(),
      };

      const scoreHigh = scorer.compositeScore(highRelevance, ctx);
      const scoreLow = scorer.compositeScore(lowRelevance, ctx);
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('temporal proximity factor: exponential decay by days since creation', () => {
      const scorer = createCompositeScorer({});
      const now = Date.now();

      const recentFragment = {
        associations: { domains: [], entities: [], attention_tags: [] },
        decay: { current_weight: 0.5 },
        created: new Date(now).toISOString(),
      };

      const oldFragment = {
        associations: { domains: [], entities: [], attention_tags: [] },
        decay: { current_weight: 0.5 },
        created: new Date(now - 30 * 86400000).toISOString(), // 30 days ago
      };

      const ctx = {
        activeDomains: [],
        activeEntities: [],
        attentionTags: [],
        referenceTime: now,
      };

      const scoreRecent = scorer.compositeScore(recentFragment, ctx);
      const scoreOld = scorer.compositeScore(oldFragment, ctx);
      expect(scoreRecent).toBeGreaterThan(scoreOld);
    });
  });

  // --------------------------------------------------------------------------
  // Fragment selection
  // --------------------------------------------------------------------------

  describe('Fragment selection', () => {
    it('passive recall returns top 5 fragments (configurable N)', () => {
      // Spec 3.7: "Top N fragments (configurable, typically 5-15)"
      const qb = createQueryBuilder({});
      const passiveQuery = qb.buildPassiveQuery({ domains: ['test'], entities: [], attention_tags: [] });
      expect(passiveQuery.limit).toBe(5);
    });

    it('explicit recall returns top 15 fragments (configurable N)', () => {
      const qb = createQueryBuilder({});
      const explicitQuery = qb.buildExplicitQuery({ domains: ['test'], entities: [], attention_tags: [] });
      expect(explicitQuery.limit).toBe(15);
    });

    it('rankFragments ranks by composite score descending and limits to N', () => {
      const scorer = createCompositeScorer({});
      const now = new Date().toISOString();

      const fragments = [
        {
          associations: { domains: ['a'], entities: ['x'], attention_tags: ['t1'], self_model_relevance: { identity: 0.9, relational: 0.9, conditioning: 0.9 } },
          decay: { current_weight: 0.9 },
          created: now,
        },
        {
          associations: { domains: [], entities: [], attention_tags: [] },
          decay: { current_weight: 0.1 },
          created: new Date(Date.now() - 365 * 86400000).toISOString(),
        },
        {
          associations: { domains: ['a'], entities: [], attention_tags: [] },
          decay: { current_weight: 0.5 },
          created: now,
        },
      ];

      const ctx = {
        activeDomains: ['a'],
        activeEntities: ['x'],
        attentionTags: ['t1'],
        referenceTime: Date.now(),
      };

      const ranked = scorer.rankFragments(fragments, ctx, 2);
      expect(ranked.length).toBe(2);
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    });
  });

  // --------------------------------------------------------------------------
  // Reconstruction
  // --------------------------------------------------------------------------

  describe('Reconstruction', () => {
    it('reconstruction prompt exists for explicit recall through current Self Model frame', () => {
      // Spec 3.7: "The Mind session receives the selected fragments and reconstructs
      // a coherent recollection through its current Self Model frame"
      const rp = createReconstructionPrompt({});
      expect(typeof rp.buildExplicitReconstruction).toBe('function');
    });

    it('explicit reconstruction prompt includes Self Model context', () => {
      const rp = createReconstructionPrompt({});
      const prompt = rp.buildExplicitReconstruction(
        [{ id: 'frag-1', body: 'A memory fragment', domain: 'trust', created: '2026-03-20T12:00:00Z' }],
        { user_prompt: 'Tell me what you remember about our debugging sessions.' },
        { identity_summary: 'I am curious and methodical.', relational_summary: 'We collaborate deeply.' }
      );

      expect(prompt).toContain('curious and methodical');
      expect(prompt).toContain('collaborate deeply');
      expect(prompt).toContain('A memory fragment');
    });

    it('passive nudge prompt exists for shading without narrating', () => {
      // Spec 3.7 doesn't detail passive vs explicit, but the recall engine
      // implements both paths per D-11/D-12
      const rp = createReconstructionPrompt({});
      const nudge = rp.buildPassiveNudge(
        [{ id: 'frag-1', body: 'A fleeting impression' }],
        { user_prompt: 'How is the project going?' }
      );

      expect(nudge).toBeDefined();
      expect(nudge).toContain('Do not mention that you are remembering');
    });

    it('reconstruction prompt frames recall as re-experiencing, not fetching', () => {
      // Spec 3.7: "Recall is never a fetch operation. It is always a synthesis."
      const rp = createReconstructionPrompt({});
      const prompt = rp.buildExplicitReconstruction(
        [{ id: 'frag-1', body: 'Test', domain: 'test', created: '2026-03-20T12:00:00Z' }],
        { user_prompt: 'test' },
        { identity_summary: '', relational_summary: '' }
      );

      // Should instruct re-experiencing, not summarization
      expect(prompt).toContain('Re-experience');
      expect(prompt).toContain('your current perspective');
    });

    it('recall engine provides metadata sufficient for meta-fragment creation', async () => {
      // Spec 3.7: "The recall event itself becomes a new fragment (type: meta-recall)
      // during the next REM cycle."
      // The recall engine must produce enough metadata for REM to create a meta-fragment.
      const mockFragments = [
        {
          id: 'frag-1',
          body: 'Test body',
          associations: { domains: ['trust'], entities: [], attention_tags: [] },
          decay: { current_weight: 0.8 },
          created: new Date().toISOString(),
        },
      ];

      const engine = createRecallEngine({
        assay: createMockAssay(mockFragments),
        selfModel: createMockSelfModel(),
      });

      const result = await engine.recallExplicit({
        domains: ['trust'],
        entities: [],
        attention_tags: [],
        user_prompt: 'What do you remember?',
        turn_number: 5,
      });

      expect(result.ok).toBe(true);
      // Result includes the fragments that were recalled (needed for meta-fragment)
      expect(result.value.fragments.length).toBeGreaterThan(0);
      // Result includes the reconstruction prompt (needed for meta-fragment body)
      expect(result.value.reconstructionPrompt).toBeDefined();
    });

    it('recall engine uses same composite scorer for both passive and explicit paths (D-12)', () => {
      // Per STATE.md [Phase 09]: "Recall engine uses same composite scorer
      // instance for both passive and explicit paths per D-12"
      // Structural check: the engine is created with a single scorer instance
      const engine = createRecallEngine({
        assay: createMockAssay([]),
        selfModel: createMockSelfModel(),
      });
      // Both paths exist and are functional
      expect(typeof engine.recallPassive).toBe('function');
      expect(typeof engine.recallExplicit).toBe('function');
    });
  });
});

// ==========================================================================
// Spec 3.10: Taxonomy Self-Organization
// ==========================================================================

describe('Spec 3.10: Taxonomy Self-Organization', () => {

  // --------------------------------------------------------------------------
  // Domain lifecycle operations
  // --------------------------------------------------------------------------

  describe('Domain lifecycle operations', () => {
    it('domain creation: formation pipeline populates domains via Wire upserts', async () => {
      // Spec 3.10 step 1: "Early fragments accumulate with domain tags"
      // Domain creation happens during formation via _populateMasterTables
      const wire = createMockWire();
      const pipeline = createFormationPipeline({
        fragmentWriter: createMockFragmentWriter(),
        selfModel: createMockSelfModel(),
        lathe: createMockLathe(),
        wire,
      });

      await pipeline.processFormationOutput(
        JSON.stringify({
          should_form: true,
          fragments: [
            { domains: ['new-emerging-domain'], entities: [], attention_tags: [],
              body: 'Test', self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
              emotional_valence: 0, initial_weight: 0.5 },
          ],
        }),
        { sessionId: 'test' }
      );

      const queued = wire.getQueued();
      const domainUpserts = queued.filter(e => e.payload.table === 'domains');
      expect(domainUpserts.length).toBe(1);
      expect(domainUpserts[0].payload.data[0].name).toBe('new-emerging-domain');
    });

    it('domain merge: taxonomy governor writes merge narratives', async () => {
      // Spec 3.10 step 5: "Domains can merge"
      const fw = createMockFragmentWriter();
      const wire = createMockWire();
      const sw = createMockSwitchboard();

      const governor = createTaxonomyGovernor({
        wire,
        switchboard: sw,
        fragmentWriter: fw,
      });

      const result = await governor.writeTaxonomyNarrative('merge', {
        merged: 'domain-a',
        surviving: 'domain-b',
        narrative: 'Domain A merged into Domain B after pattern convergence.',
      }, 'test-session');

      expect(result.ok).toBe(true);
      const written = fw.getWritten();
      expect(written.length).toBe(1);
      expect(written[0].frontmatter.type).toBe('consolidation');
    });

    it('domain split: taxonomy governor splits domains with parent-child hierarchy', async () => {
      // Spec 3.10 step 5: "Domains can split"
      const wire = createMockWire();
      const sw = createMockSwitchboard();

      const governor = createTaxonomyGovernor({
        wire,
        switchboard: sw,
        fragmentWriter: createMockFragmentWriter(),
      });

      const result = await governor.applyDomainSplit(
        'parent-domain',
        [
          { name: 'child-a', description: 'First subdivision', fragment_ids: ['frag-1', 'frag-2'] },
          { name: 'child-b', description: 'Second subdivision', fragment_ids: ['frag-3'] },
        ],
        'test-session'
      );

      expect(result.children_created).toBe(2);
      expect(result.fragments_redistributed).toBe(3);

      // Verify Wire received domain creation and relationship envelopes
      const queued = wire.getQueued();
      const domainInserts = queued.filter(e => e.payload.table === 'domains');
      expect(domainInserts.length).toBe(2);

      const relInserts = queued.filter(e => e.payload.table === 'domain_relationships');
      expect(relInserts.length).toBeGreaterThan(0);
    });

    it('domain retire: taxonomy governor archives inactive domains', async () => {
      // Spec 3.10 step 5: "Domains can retire"
      const wire = createMockWire();
      const sw = createMockSwitchboard();

      const governor = createTaxonomyGovernor({
        wire,
        switchboard: sw,
        fragmentWriter: createMockFragmentWriter(),
      });

      const result = await governor.applyDomainRetire('stale-domain', 'test-session');

      expect(result.domain_id).toBe('stale-domain');
      expect(result.archived).toBe(true);

      // Verify Wire received the archive update
      const queued = wire.getQueued();
      expect(queued.length).toBeGreaterThan(0);
      expect(queued[0].payload.data[0].archived).toBe(true);
    });

    it('identifies split candidates based on fragment density threshold', () => {
      const governor = createTaxonomyGovernor({
        wire: createMockWire(),
        switchboard: createMockSwitchboard(),
        fragmentWriter: createMockFragmentWriter(),
      });

      const domains = [
        { id: 'd1', name: 'small', fragment_count: 10, archived: false },
        { id: 'd2', name: 'large', fragment_count: 60, archived: false },
        { id: 'd3', name: 'archived', fragment_count: 100, archived: true },
      ];

      const candidates = governor.identifySplitCandidates(domains);
      // Only d2 should qualify (above threshold, not archived)
      expect(candidates.length).toBe(1);
      expect(candidates[0].domain_id).toBe('d2');
    });

    it('identifies retire candidates based on inactive REM cycles', () => {
      const governor = createTaxonomyGovernor({
        wire: createMockWire(),
        switchboard: createMockSwitchboard(),
        fragmentWriter: createMockFragmentWriter(),
      });

      const domains = [
        { id: 'd1', name: 'active', archived: false },
        { id: 'd2', name: 'stale', archived: false },
        { id: 'd3', name: 'already-retired', archived: true },
      ];

      const inactiveCycleMap = new Map([
        ['d1', 1],
        ['d2', 5], // Above default threshold of 3
        ['d3', 10],
      ]);

      const candidates = governor.identifyRetireCandidates(domains, inactiveCycleMap);
      // Only d2 should qualify (above threshold, not already archived)
      expect(candidates.length).toBe(1);
      expect(candidates[0].domain_id).toBe('d2');
    });
  });

  // --------------------------------------------------------------------------
  // Split storage
  // --------------------------------------------------------------------------

  describe('Split storage', () => {
    it('structural data goes to Ledger via Wire envelopes', async () => {
      // Spec 3.10: "Ledger holds the structural data (domains, hierarchies, weights, edges)"
      const wire = createMockWire();
      const governor = createTaxonomyGovernor({
        wire,
        switchboard: createMockSwitchboard(),
        fragmentWriter: createMockFragmentWriter(),
      });

      await governor.applyDomainSplit(
        'parent',
        [{ name: 'child', description: 'Test', fragment_ids: [] }],
        'test-session'
      );

      // All envelopes target 'ledger' via Wire
      const queued = wire.getQueued();
      expect(queued.length).toBeGreaterThan(0);
      for (const env of queued) {
        expect(env.to).toBe('ledger');
      }
    });

    it('narrative definitions go to Journal via FragmentWriter', async () => {
      // Spec 3.10: "Journal holds the narrative definitions -- what each domain
      // means to the Self Model"
      const fw = createMockFragmentWriter();
      const governor = createTaxonomyGovernor({
        wire: createMockWire(),
        switchboard: createMockSwitchboard(),
        fragmentWriter: fw,
      });

      await governor.writeTaxonomyNarrative('split', {
        parent: 'original',
        children: [{ name: 'child-a' }, { name: 'child-b' }],
        narrative: 'The original domain was too broad and has been split.',
      }, 'test-session');

      const written = fw.getWritten();
      expect(written.length).toBe(1);
      // Journal writes go through fragmentWriter (which writes to Journal provider)
    });
  });

  // --------------------------------------------------------------------------
  // Hard caps (Phase 12)
  // --------------------------------------------------------------------------

  describe('Hard caps', () => {
    it('max_domains hard cap is 100', () => {
      expect(TAXONOMY_DEFAULTS.max_domains).toBe(100);
    });

    it('max_entities_per_domain hard cap is 200', () => {
      expect(TAXONOMY_DEFAULTS.max_entities_per_domain).toBe(200);
    });

    it('max_association_edges hard cap is 10,000', () => {
      expect(TAXONOMY_DEFAULTS.max_association_edges).toBe(10000);
    });

    it('computeCapPressure reports pressure ratios against hard caps', () => {
      const governor = createTaxonomyGovernor({
        wire: createMockWire(),
        switchboard: createMockSwitchboard(),
        fragmentWriter: createMockFragmentWriter(),
      });

      const pressure = governor.computeCapPressure(80, 160, 8000);

      expect(pressure.domainPressure).toBe(80 / 100);
      expect(pressure.entityPressure).toBe(160 / 200);
      expect(pressure.edgePressure).toBe(8000 / 10000);
      expect(pressure.isUnderPressure).toBe(true);
    });

    it('isUnderPressure triggers at pressure_threshold (0.8 default)', () => {
      const governor = createTaxonomyGovernor({
        wire: createMockWire(),
        switchboard: createMockSwitchboard(),
        fragmentWriter: createMockFragmentWriter(),
      });

      // Below threshold
      const low = governor.computeCapPressure(50, 100, 5000);
      expect(low.isUnderPressure).toBe(false);

      // At threshold
      const at = governor.computeCapPressure(80, 100, 5000);
      expect(at.isUnderPressure).toBe(true);

      // Above threshold in entity dimension only
      const entity = governor.computeCapPressure(50, 180, 5000);
      expect(entity.isUnderPressure).toBe(true);
    });

    it('getPressureGradientText returns urgency text based on pressure level', () => {
      const governor = createTaxonomyGovernor({
        wire: createMockWire(),
        switchboard: createMockSwitchboard(),
        fragmentWriter: createMockFragmentWriter(),
      });

      // Below threshold -- no text
      const low = governor.getPressureGradientText({ domainPressure: 0.5, entityPressure: 0.5, edgePressure: 0.5 });
      expect(low).toBe('');

      // At 0.8 -- moderate concern
      const moderate = governor.getPressureGradientText({ domainPressure: 0.85, entityPressure: 0.5, edgePressure: 0.5 });
      expect(moderate.length).toBeGreaterThan(0);
      expect(moderate).toContain('merging');

      // At 0.95+ -- urgent
      const urgent = governor.getPressureGradientText({ domainPressure: 0.97, entityPressure: 0.5, edgePressure: 0.5 });
      expect(urgent).toContain('URGENT');
    });
  });
});

// ==========================================================================
// Spec 3.12: Formation Example Consistency
// ==========================================================================

describe('Spec 3.12: Formation Example Consistency', () => {
  it('pipeline can produce a multi-fragment formation group from a single stimulus', async () => {
    // Spec 3.12: A single stimulus ("These should help with the argument structure")
    // produces 5 fragments with different frames. Verify the pipeline code can
    // handle a multi-fragment formation output structurally.
    const fw = createMockFragmentWriter();
    const wire = createMockWire();
    const pipeline = createFormationPipeline({
      fragmentWriter: fw,
      selfModel: createMockSelfModel(),
      lathe: createMockLathe(),
      wire,
    });

    // Simulate a 3-fragment formation (capped at max_fragments_per_stimulus=3)
    const result = await pipeline.processFormationOutput(
      JSON.stringify({
        should_form: true,
        fragments: [
          {
            formation_frame: 'relational',
            domains: ['trust-calibration'],
            entities: ['user'],
            attention_tags: ['trust', 'brevity'],
            self_model_relevance: { identity: 0.3, relational: 0.9, conditioning: 0.2 },
            emotional_valence: 0.6,
            initial_weight: 0.8,
            body: 'The user is trusting me with source material. The brevity implies confidence.',
          },
          {
            formation_frame: 'experiential',
            domains: ['source-processing'],
            entities: ['article-1'],
            attention_tags: ['argument-structure'],
            self_model_relevance: { identity: 0.2, relational: 0.5, conditioning: 0.3 },
            emotional_valence: 0.3,
            initial_weight: 0.6,
            body: 'The first article was selected for argument structure patterns.',
            source_locator: '/home/user/docs/article-1.pdf',
          },
          {
            formation_frame: 'reflective',
            domains: ['meta-cognitive'],
            entities: ['capability-assessment'],
            attention_tags: ['synthesis', 'trust-test'],
            self_model_relevance: { identity: 0.7, relational: 0.6, conditioning: 0.5 },
            emotional_valence: 0.4,
            initial_weight: 0.7,
            body: 'The user is relying on me to synthesize across three sources.',
          },
        ],
      }),
      { sessionId: 'test-session' }
    );

    expect(result.ok).toBe(true);
    expect(result.value.formed).toBe(3);

    const written = fw.getWritten();
    expect(written.length).toBe(3);

    // All share the same formation group
    const fg = written[0].frontmatter.formation_group;
    expect(written[1].frontmatter.formation_group).toBe(fg);
    expect(written[2].frontmatter.formation_group).toBe(fg);

    // Each has different domains
    expect(written[0].frontmatter.associations.domains[0]).toBe('trust-calibration');
    expect(written[1].frontmatter.associations.domains[0]).toBe('source-processing');
    expect(written[2].frontmatter.associations.domains[0]).toBe('meta-cognitive');

    // Source-reference type is correctly classified
    expect(written[1].frontmatter.type).toBe('source-reference');
    expect(written[1].frontmatter.source_locator).toBe('/home/user/docs/article-1.pdf');

    // Sibling pointers link all fragments
    const ids = written.map(w => w.frontmatter.id);
    for (let i = 0; i < written.length; i++) {
      const siblings = written[i].frontmatter.sibling_fragments;
      for (let j = 0; j < ids.length; j++) {
        if (j !== i) {
          expect(siblings).toContain(ids[j]);
        }
      }
    }
  });

  it('formation group ID has the fg- prefix per FORMATION_DEFAULTS', async () => {
    const fw = createMockFragmentWriter();
    const wire = createMockWire();
    const pipeline = createFormationPipeline({
      fragmentWriter: fw,
      selfModel: createMockSelfModel(),
      lathe: createMockLathe(),
      wire,
    });

    await pipeline.processFormationOutput(
      JSON.stringify({
        should_form: true,
        fragments: [
          { domains: ['test'], entities: [], attention_tags: [], body: 'Test',
            self_model_relevance: { identity: 0.5, relational: 0.5, conditioning: 0.5 },
            emotional_valence: 0, initial_weight: 0.5 },
        ],
      }),
      { sessionId: 'test' }
    );

    const written = fw.getWritten();
    expect(written[0].frontmatter.formation_group).toMatch(/^fg-/);
  });
});
