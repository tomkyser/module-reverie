'use strict';

/**
 * Spec compliance test: Self Model (reverie-spec-v2.md sections 2.1-2.4).
 *
 * Verifies:
 * - Section 2.1: Self Model has three aspects (Face/Mind/Subconscious)
 * - Section 2.2: Identity Core (5 fields), Relational Model (6 fields), Conditioning (5 fields)
 * - Section 2.3: Cold start produces valid sparse defaults
 * - Section 2.4: Self Model prompting (template composer has Face, Subconscious, Mind prompts)
 *
 * Known deviations (documented in STATE.md, marked as D not V):
 * - [Phase 07] JSON frontmatter not YAML
 * - [Phase 07] Zod 4 record syntax
 * - Relational Model field naming: code uses communication_patterns/domain_map/preference_history
 *   (without user_ prefix) — architectural simplification, all code is consistent
 * - Identity Core: code uses 'boundaries' instead of spec 'boundary_definitions'
 * - Relational Model: code omits 'relational_dynamics' field — not implemented in initial phases
 *
 * @module reverie/validation/spec-self-model.test
 */

const { describe, it, expect } = require('bun:test');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Self Model: Spec sections 2.1-2.4 compliance
// ---------------------------------------------------------------------------

describe('Self Model: Spec sections 2.1-2.4 compliance', () => {

  // -------------------------------------------------------------------------
  // Spec 2.1: Three Aspects
  // -------------------------------------------------------------------------

  describe('Spec 2.1: Self Model Three Aspects', () => {
    it('SM_ASPECTS constant defines exactly three aspects', () => {
      const { SM_ASPECTS } = require('../lib/constants.cjs');
      expect(SM_ASPECTS).toHaveLength(3);
    });

    it('aspects map to Face(identity-core), Mind(relational-model), Subconscious(conditioning)', () => {
      const { SM_ASPECTS } = require('../lib/constants.cjs');
      expect(SM_ASPECTS).toContain('identity-core');
      expect(SM_ASPECTS).toContain('relational-model');
      expect(SM_ASPECTS).toContain('conditioning');
    });

    it('Self Model manager provides getAspect/setAspect for all three aspects', () => {
      const { createSelfModel } = require('../components/self-model/self-model.cjs');
      // Create with minimal mock deps
      const mockMagnet = {
        get: () => null,
        set: () => {},
      };
      const result = createSelfModel({ magnet: mockMagnet });
      expect(result.ok).toBe(true);
      const sm = result.value;
      expect(typeof sm.getAspect).toBe('function');
      expect(typeof sm.setAspect).toBe('function');
    });

    it('Self Model exposes save, load, getAspect, setAspect, getVersion (SHAPE contract)', () => {
      const { createSelfModel } = require('../components/self-model/self-model.cjs');
      const result = createSelfModel({ magnet: { get: () => null, set: () => {} } });
      expect(result.ok).toBe(true);
      const sm = result.value;
      expect(typeof sm.save).toBe('function');
      expect(typeof sm.load).toBe('function');
      expect(typeof sm.getAspect).toBe('function');
      expect(typeof sm.setAspect).toBe('function');
      expect(typeof sm.getVersion).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Spec 2.2: Self Model State — Identity Core
  // -------------------------------------------------------------------------

  describe('Spec 2.2: Identity Core fields', () => {
    it('identityCoreSchema validates personality_traits field', () => {
      const { identityCoreSchema } = require('../lib/schemas.cjs');
      const valid = identityCoreSchema.safeParse({
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: new Date().toISOString(),
        personality_traits: { openness: 0.5 },
      });
      expect(valid.success).toBe(true);
    });

    it('identityCoreSchema validates communication_style field', () => {
      const { identityCoreSchema } = require('../lib/schemas.cjs');
      const valid = identityCoreSchema.safeParse({
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: new Date().toISOString(),
        communication_style: { formality: 'casual' },
      });
      expect(valid.success).toBe(true);
    });

    it('identityCoreSchema validates value_orientations field', () => {
      const { identityCoreSchema } = require('../lib/schemas.cjs');
      const valid = identityCoreSchema.safeParse({
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: new Date().toISOString(),
        value_orientations: [{ name: 'honesty', weight: 0.8 }],
      });
      expect(valid.success).toBe(true);
    });

    it('identityCoreSchema validates expertise_map field', () => {
      const { identityCoreSchema } = require('../lib/schemas.cjs');
      const valid = identityCoreSchema.safeParse({
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: new Date().toISOString(),
        expertise_map: { javascript: 0.9 },
      });
      expect(valid.success).toBe(true);
    });

    it('identityCoreSchema validates boundary_definitions field (code: boundaries)', () => {
      // Deviation: spec says "boundary_definitions", code uses "boundaries"
      // This is a known naming simplification, consistent across all code
      const { identityCoreSchema } = require('../lib/schemas.cjs');
      const valid = identityCoreSchema.safeParse({
        aspect: 'identity-core',
        version: 'sm-identity-v1',
        updated: new Date().toISOString(),
        boundaries: ['Default Claude safety boundaries active'],
      });
      expect(valid.success).toBe(true);
    });

    it('all 5 Identity Core fields are present in schema (personality_traits, communication_style, value_orientations, expertise_map, boundaries)', () => {
      const { identityCoreSchema } = require('../lib/schemas.cjs');
      const shape = identityCoreSchema.shape;
      expect(shape.personality_traits).toBeDefined();
      expect(shape.communication_style).toBeDefined();
      expect(shape.value_orientations).toBeDefined();
      expect(shape.expertise_map).toBeDefined();
      expect(shape.boundaries).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Spec 2.2: Self Model State — Relational Model
  // -------------------------------------------------------------------------

  describe('Spec 2.2: Relational Model fields', () => {
    it('relationalModelSchema validates user_communication_patterns (code: communication_patterns)', () => {
      // Deviation: spec says "user_communication_patterns", code uses "communication_patterns"
      // Consistent naming simplification across all code
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const valid = relationalModelSchema.safeParse({
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: new Date().toISOString(),
        communication_patterns: { directness: 'high' },
      });
      expect(valid.success).toBe(true);
    });

    it('relationalModelSchema validates user_domain_map (code: domain_map)', () => {
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const valid = relationalModelSchema.safeParse({
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: new Date().toISOString(),
        domain_map: { javascript: 0.9 },
      });
      expect(valid.success).toBe(true);
    });

    it('relationalModelSchema validates user_preference_history (code: preference_history)', () => {
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const valid = relationalModelSchema.safeParse({
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: new Date().toISOString(),
        preference_history: [{ action: 'liked_concise_answer' }],
      });
      expect(valid.success).toBe(true);
    });

    it('relationalModelSchema validates trust_calibration', () => {
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const valid = relationalModelSchema.safeParse({
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: new Date().toISOString(),
        trust_calibration: { latitude: 0.3 },
      });
      expect(valid.success).toBe(true);
    });

    it('relationalModelSchema validates interaction_rhythm', () => {
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const valid = relationalModelSchema.safeParse({
        aspect: 'relational-model',
        version: 'sm-relational-v1',
        updated: new Date().toISOString(),
        interaction_rhythm: { avg_session_length: 45 },
      });
      expect(valid.success).toBe(true);
    });

    it('Deviation: relational_dynamics not in schema (spec 2.2 field not yet implemented)', () => {
      // This is a known omission -- relational_dynamics is specified in spec 2.2
      // but not yet implemented in the Relational Model schema. Tracked as intentional
      // deviation for future phase implementation.
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const shape = relationalModelSchema.shape;
      // Document that this field is absent — not a violation, tracked for follow-up
      expect(shape.relational_dynamics).toBeUndefined();
    });

    it('5 of 6 Relational Model fields present in schema (communication_patterns, domain_map, preference_history, trust_calibration, interaction_rhythm)', () => {
      const { relationalModelSchema } = require('../lib/schemas.cjs');
      const shape = relationalModelSchema.shape;
      expect(shape.communication_patterns).toBeDefined();
      expect(shape.domain_map).toBeDefined();
      expect(shape.preference_history).toBeDefined();
      expect(shape.trust_calibration).toBeDefined();
      expect(shape.interaction_rhythm).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Spec 2.2: Self Model State — Conditioning
  // -------------------------------------------------------------------------

  describe('Spec 2.2: Conditioning fields', () => {
    it('conditioningSchema validates attention_biases', () => {
      const { conditioningSchema } = require('../lib/schemas.cjs');
      const valid = conditioningSchema.safeParse({
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: new Date().toISOString(),
        attention_biases: { coding: 0.8 },
      });
      expect(valid.success).toBe(true);
    });

    it('conditioningSchema validates association_priors', () => {
      const { conditioningSchema } = require('../lib/schemas.cjs');
      const valid = conditioningSchema.safeParse({
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: new Date().toISOString(),
        association_priors: { debugging: 0.7 },
      });
      expect(valid.success).toBe(true);
    });

    it('conditioningSchema validates sublimation_sensitivity', () => {
      const { conditioningSchema } = require('../lib/schemas.cjs');
      const valid = conditioningSchema.safeParse({
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: new Date().toISOString(),
        sublimation_sensitivity: { creative: 0.6 },
      });
      expect(valid.success).toBe(true);
    });

    it('conditioningSchema validates recall_strategies', () => {
      const { conditioningSchema } = require('../lib/schemas.cjs');
      const valid = conditioningSchema.safeParse({
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: new Date().toISOString(),
        recall_strategies: [{ name: 'temporal_proximity' }],
      });
      expect(valid.success).toBe(true);
    });

    it('conditioningSchema validates error_history', () => {
      const { conditioningSchema } = require('../lib/schemas.cjs');
      const valid = conditioningSchema.safeParse({
        aspect: 'conditioning',
        version: 'sm-conditioning-v1',
        updated: new Date().toISOString(),
        error_history: [{ description: 'overcorrected tone' }],
      });
      expect(valid.success).toBe(true);
    });

    it('all 5 Conditioning fields present in schema', () => {
      const { conditioningSchema } = require('../lib/schemas.cjs');
      const shape = conditioningSchema.shape;
      expect(shape.attention_biases).toBeDefined();
      expect(shape.association_priors).toBeDefined();
      expect(shape.sublimation_sensitivity).toBeDefined();
      expect(shape.recall_strategies).toBeDefined();
      expect(shape.error_history).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Spec 2.3: Cold Start Initialization
  // -------------------------------------------------------------------------

  describe('Spec 2.3: Cold Start Initialization', () => {
    it('cold start produces identityCore with neutral personality trait values', () => {
      const { createColdStartSeed } = require('../components/self-model/cold-start.cjs');
      const seed = createColdStartSeed({});
      const traits = seed.identityCore.frontmatter.personality_traits;

      // All traits should be 0.5 (neutral) except neuroticism (0.3)
      expect(traits.openness).toBe(0.5);
      expect(traits.conscientiousness).toBe(0.5);
      expect(traits.extraversion).toBe(0.5);
      expect(traits.agreeableness).toBe(0.5);
      expect(traits.neuroticism).toBe(0.3);
    });

    it('cold start produces empty relational model', () => {
      const { createColdStartSeed } = require('../components/self-model/cold-start.cjs');
      const seed = createColdStartSeed({});
      const rm = seed.relationalModel.frontmatter;

      expect(rm.communication_patterns).toEqual({});
      expect(rm.domain_map).toEqual({});
      expect(rm.preference_history).toEqual([]);
    });

    it('cold start produces default conditioning with uniform biases', () => {
      const { createColdStartSeed } = require('../components/self-model/cold-start.cjs');
      const seed = createColdStartSeed({});
      const cond = seed.conditioning.frontmatter;

      expect(cond.attention_biases).toEqual({});
      expect(cond.association_priors).toEqual({});
      expect(cond.sublimation_sensitivity).toEqual({});
      expect(cond.recall_strategies).toEqual([]);
      expect(cond.error_history).toEqual([]);
    });

    it('cold start seed passes schema validation for all three aspects', () => {
      const { createColdStartSeed } = require('../components/self-model/cold-start.cjs');
      const { identityCoreSchema, relationalModelSchema, conditioningSchema } = require('../lib/schemas.cjs');
      const seed = createColdStartSeed({});

      const identityResult = identityCoreSchema.safeParse(seed.identityCore.frontmatter);
      expect(identityResult.success).toBe(true);

      const relationalResult = relationalModelSchema.safeParse(seed.relationalModel.frontmatter);
      expect(relationalResult.success).toBe(true);

      const conditioningResult = conditioningSchema.safeParse(seed.conditioning.frontmatter);
      expect(conditioningResult.success).toBe(true);
    });

    it('cold start identity core has narrative body (not empty)', () => {
      const { createColdStartSeed } = require('../components/self-model/cold-start.cjs');
      const seed = createColdStartSeed({});

      expect(seed.identityCore.body).toBeTruthy();
      expect(seed.identityCore.body.length).toBeGreaterThan(0);
    });

    it('entropy engine integration applies variance to trait weights', () => {
      const { createColdStartSeed } = require('../components/self-model/cold-start.cjs');
      const { createEntropyEngine } = require('../components/self-model/entropy-engine.cjs');

      const entropy = createEntropyEngine({ seed: 'test-seed-123', sigma: 0.1 });
      const seed = createColdStartSeed({ entropy });
      const traits = seed.identityCore.frontmatter.personality_traits;

      // With entropy, values should differ from defaults (at least some)
      const defaults = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.3 };
      let anyDifferent = false;
      for (const [key, val] of Object.entries(defaults)) {
        if (traits[key] !== val) anyDifferent = true;
      }
      expect(anyDifferent).toBe(true);
    });

    it('seed prompt variant appends seed text to identity body', () => {
      const { generateSeedFromPrompt } = require('../components/self-model/cold-start.cjs');
      const seed = generateSeedFromPrompt('Be helpful and kind', {});
      expect(seed.identityCore.body).toContain('Be helpful and kind');
    });
  });

  // -------------------------------------------------------------------------
  // Spec 2.4: Self Model Prompting Across Sessions
  // -------------------------------------------------------------------------

  describe('Spec 2.4: Self Model Prompting Across Sessions', () => {
    it('template composer creates Face prompt with all 5 slots', () => {
      const { createTemplateComposer, SLOT_NAMES } = require('../components/context/template-composer.cjs');
      const composer = createTemplateComposer({ selfModel: null });
      const prompt = composer.compose(1);

      // Verify all 5 slots are present
      expect(prompt).toContain('Identity Frame');
      expect(prompt).toContain('Relational Context');
      expect(prompt).toContain('Attention Directives');
      expect(prompt).toContain('Behavioral Directives');
      expect(prompt).toContain('Referential Framing');
    });

    it('SLOT_NAMES constant defines exactly 5 slots', () => {
      const { SLOT_NAMES } = require('../components/context/template-composer.cjs');
      expect(SLOT_NAMES).toHaveLength(5);
      expect(SLOT_NAMES).toContain('identity_frame');
      expect(SLOT_NAMES).toContain('relational_context');
      expect(SLOT_NAMES).toContain('attention_directives');
      expect(SLOT_NAMES).toContain('behavioral_directives');
      expect(SLOT_NAMES).toContain('referential_framing');
    });

    it('template composer produces non-empty output for all 4 budget phases', () => {
      const { createTemplateComposer } = require('../components/context/template-composer.cjs');
      const composer = createTemplateComposer({ selfModel: null });

      for (let phase = 1; phase <= 4; phase++) {
        const prompt = composer.compose(phase);
        expect(prompt.length).toBeGreaterThan(0);
      }
    });

    it('template composer has budget phases for Face prompt sizing', () => {
      const { PHASE_BUDGETS } = require('../components/context/template-composer.cjs');
      expect(PHASE_BUDGETS[1]).toBeDefined();
      expect(PHASE_BUDGETS[2]).toBeDefined();
      expect(PHASE_BUDGETS[3]).toBeDefined();
      expect(PHASE_BUDGETS[4]).toBeDefined();
    });

    it('Phase 3 (reinforced) budget is larger than Phase 1 (full) per spec D-05/D-06', () => {
      const { PHASE_BUDGETS } = require('../components/context/template-composer.cjs');
      const phase1Total = Object.values(PHASE_BUDGETS[1]).reduce((a, b) => a + b, 0);
      const phase3Total = Object.values(PHASE_BUDGETS[3]).reduce((a, b) => a + b, 0);
      expect(phase3Total).toBeGreaterThan(phase1Total);
    });

    it('micro-nudge provides personality reinforcement text', () => {
      const { createTemplateComposer } = require('../components/context/template-composer.cjs');
      const composer = createTemplateComposer({ selfModel: null });
      const nudge = composer.getMicroNudge();
      expect(nudge.length).toBeGreaterThan(0);
      expect(nudge).toContain('Remember:');
    });
  });
});
