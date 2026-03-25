'use strict';

/**
 * Spec compliance test: Context Management (reverie-spec-v2.md sections 8.1-8.7).
 *
 * Verifies:
 * - Section 8.3: Continuous Self Model Reinjection on every UserPromptSubmit
 * - Section 8.4: Referential Framing Prompt design and <referential_frame> XML tags
 * - Section 8.5: Context Budget Management with 4 phases (full/compressed/reinforced/compaction)
 * - Section 8.6: Self Model as Compaction Frame (PreCompact framing preserves personality)
 *
 * Known deviations (documented in STATE.md):
 * - [Phase 08] additionalContext not systemMessage per Pitfall 1
 * - [Phase 08] Phase 3 reinforced LARGER than Phase 1 per PITFALLS research D-05/D-06
 * - [Phase 10] Referential framing templates wrapped in <referential_frame> XML tags
 *
 * Sections 8.1, 8.2, 8.7 are informational/research -- marked NA.
 *
 * @module reverie/validation/spec-context.test
 */

const { describe, it, expect } = require('bun:test');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Spec 8.3: Continuous Self Model Reinjection
// ---------------------------------------------------------------------------

describe('Spec 8.3: Continuous Self Model Reinjection', () => {

  it('context-manager.cjs exports createContextManager factory', () => {
    const mod = require('../components/context/context-manager.cjs');
    expect(typeof mod.createContextManager).toBe('function');
  });

  it('Context Manager provides getInjection() for synchronous face prompt retrieval', () => {
    const { CONTEXT_MANAGER_SHAPE } = require('../components/context/context-manager.cjs');
    expect(CONTEXT_MANAGER_SHAPE.required).toContain('getInjection');
  });

  it('hook-handlers inject face prompt on every UserPromptSubmit via additionalContext (not systemMessage)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    // Verify handleUserPromptSubmit calls getInjection and returns it as additionalContext
    expect(source).toContain('handleUserPromptSubmit');
    expect(source).toContain('contextManager.getInjection()');
    expect(source).toContain('additionalContext');

    // Verify it does NOT use systemMessage for injection (per [Phase 08] deviation)
    // The only usage of systemMessage should be in comments/docs, not as output key
    const hookOutputs = source.match(/hookSpecificOutput:\s*\{[^}]*systemMessage[^}]*\}/g);
    expect(hookOutputs).toBeNull();
  });

  it('hook-handlers inject face prompt on SessionStart via additionalContext', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    // SessionStart must also inject the face prompt
    expect(source).toContain('handleSessionStart');
    // The handler returns additionalContext with the injection
    expect(source).toContain("hookEventName: 'SessionStart'");
  });

  it('UserPromptSubmit tracks prompt bytes and increments turn count', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    expect(source).toContain("contextManager.trackBytes(promptBytes, 'user_prompt')");
    expect(source).toContain('contextManager.incrementTurn()');
  });

  it('template-composer has 5-slot system per [Phase 08]', () => {
    const { SLOT_NAMES } = require('../components/context/template-composer.cjs');
    expect(SLOT_NAMES).toHaveLength(5);
    expect(SLOT_NAMES).toContain('identity_frame');
    expect(SLOT_NAMES).toContain('relational_context');
    expect(SLOT_NAMES).toContain('attention_directives');
    expect(SLOT_NAMES).toContain('behavioral_directives');
    expect(SLOT_NAMES).toContain('referential_framing');
  });

  it('injection includes communication style directives (spec 8.3 component list)', () => {
    const { createTemplateComposer } = require('../components/context/template-composer.cjs');
    const mockSelfModel = {
      getAspect(name) {
        if (name === 'identity-core') return {
          frontmatter: {
            personality_traits: { warmth: 0.8 },
            communication_style: { tone: 'friendly' },
            value_orientations: [],
            expertise_map: {},
            boundaries: [],
          },
          body: '',
        };
        if (name === 'relational-model') return {
          frontmatter: {
            communication_patterns: { verbosity: 'moderate' },
            domain_map: {},
            preference_history: [],
            trust_calibration: { latitude: 0.6 },
            interaction_rhythm: {},
          },
          body: '',
        };
        if (name === 'conditioning') return {
          frontmatter: {
            attention_biases: { coding: 0.7 },
            association_priors: {},
            sublimation_sensitivity: {},
            recall_strategies: [],
            error_history: [],
          },
          body: '',
        };
        return null;
      },
    };
    const composer = createTemplateComposer({ selfModel: mockSelfModel });
    const prompt = composer.compose(1);

    // Spec 8.3: injection includes communication style directives
    expect(prompt).toContain('Communication style');
    // Spec 8.3: injection includes relational context
    expect(prompt).toContain('Relational Context');
    // Spec 8.3: injection includes attention priorities
    expect(prompt).toContain('Attention Directives');
    // Spec 8.3: injection includes behavioral constraints
    expect(prompt).toContain('Behavioral Directives');
  });

  it('token budget is approximately 800-1800 tokens across all phases', () => {
    const { PHASE_BUDGETS } = require('../components/context/template-composer.cjs');

    for (let phase = 1; phase <= 4; phase++) {
      const budgets = PHASE_BUDGETS[phase];
      const total = Object.values(budgets).reduce((sum, v) => sum + v, 0);
      // Total per-turn injection budget: ~800-1800 tokens per spec 8.3
      // Phase 3 (reinforced) is intentionally larger (1900) per [Phase 08] deviation
      expect(total).toBeGreaterThanOrEqual(800);
      expect(total).toBeLessThanOrEqual(2000);
    }
  });
});

// ---------------------------------------------------------------------------
// Spec 8.4: Referential Framing Prompt
// ---------------------------------------------------------------------------

describe('Spec 8.4: Referential Framing Prompt', () => {

  it('referential-framing.cjs exports FRAMING_TEMPLATES with full/dual/soft modes', () => {
    const { FRAMING_TEMPLATES } = require('../components/context/referential-framing.cjs');
    expect(FRAMING_TEMPLATES).toBeDefined();
    expect(typeof FRAMING_TEMPLATES.full).toBe('string');
    expect(typeof FRAMING_TEMPLATES.dual).toBe('string');
    expect(typeof FRAMING_TEMPLATES.soft).toBe('string');
  });

  it('templates wrapped in <referential_frame> XML tags per [Phase 10] deviation', () => {
    const { FRAMING_TEMPLATES } = require('../components/context/referential-framing.cjs');

    for (const [mode, template] of Object.entries(FRAMING_TEMPLATES)) {
      expect(template).toContain('<referential_frame>');
      expect(template).toContain('</referential_frame>');
    }
  });

  it('full mode: Primary treats context as reference material subordinate to Self Model directives (spec 8.4)', () => {
    const { FRAMING_TEMPLATES } = require('../components/context/referential-framing.cjs');
    const full = FRAMING_TEMPLATES.full;

    // Spec 8.4 core framing point 1: reference material, not basis for independent decisions
    expect(full).toContain('reference material');
    // Spec 8.4 core framing point 2: defer to Self Model directives
    expect(full).toContain('defer');
    expect(full).toContain('Self Model directives');
  });

  it('dual mode: relational deference + technical autonomy', () => {
    const { FRAMING_TEMPLATES } = require('../components/context/referential-framing.cjs');
    const dual = FRAMING_TEMPLATES.dual;

    // Relational deference
    expect(dual).toContain('relational');
    expect(dual).toContain('defer');
    // Technical autonomy
    expect(dual).toContain('technical');
    expect(dual).toContain('independent judgment');
  });

  it('createReferentialFraming supports dynamic mode switching', () => {
    const { createReferentialFraming } = require('../components/context/referential-framing.cjs');
    const framing = createReferentialFraming({ mode: 'dual' });

    expect(framing.getMode()).toBe('dual');

    const result = framing.setMode('full');
    expect(result.ok).toBe(true);
    expect(framing.getMode()).toBe('full');
  });

  it('referential framing is slot 5 of the 5-slot template system', () => {
    const { SLOT_NAMES } = require('../components/context/template-composer.cjs');
    // Slot 5 (0-indexed: 4) is referential_framing
    expect(SLOT_NAMES[4]).toBe('referential_framing');
  });

  it('template-composer composes referential framing in slot 5 of face prompt output', () => {
    const { createTemplateComposer } = require('../components/context/template-composer.cjs');
    const mockSelfModel = {
      getAspect() { return null; },
    };
    const composer = createTemplateComposer({ selfModel: mockSelfModel });
    const prompt = composer.compose(1);

    // The output contains all 5 section headers in order
    expect(prompt).toContain('## Identity Frame');
    expect(prompt).toContain('## Relational Context');
    expect(prompt).toContain('## Attention Directives');
    expect(prompt).toContain('## Behavioral Directives');
    expect(prompt).toContain('## Referential Framing');

    // Referential Framing section is the last structural section
    const framingIdx = prompt.indexOf('## Referential Framing');
    const behavioralIdx = prompt.indexOf('## Behavioral Directives');
    expect(framingIdx).toBeGreaterThan(behavioralIdx);
  });
});

// ---------------------------------------------------------------------------
// Spec 8.5: Context Budget Management
// ---------------------------------------------------------------------------

describe('Spec 8.5: Context Budget Management', () => {

  describe('4 budget phases', () => {
    it('BUDGET_PHASES defines all 4 phases: FULL, COMPRESSED, REINFORCED, COMPACTION', () => {
      const { BUDGET_PHASES } = require('../components/context/budget-tracker.cjs');
      expect(BUDGET_PHASES.FULL).toBe(1);
      expect(BUDGET_PHASES.COMPRESSED).toBe(2);
      expect(BUDGET_PHASES.REINFORCED).toBe(3);
      expect(BUDGET_PHASES.COMPACTION).toBe(4);
    });

    it('PHASE_THRESHOLDS define utilization boundaries based on research (not spec verbatim)', () => {
      const { PHASE_THRESHOLDS } = require('../components/context/budget-tracker.cjs');

      // Per [Phase 08] deviation: thresholds based on PITFALLS research, not spec 8.5 exact %
      expect(PHASE_THRESHOLDS.COMPRESSED_AT).toBe(0.30);
      expect(PHASE_THRESHOLDS.REINFORCED_AT).toBe(0.60);
      expect(PHASE_THRESHOLDS.COMPACTION_AT).toBe(0.80);
    });

    it('PHASE_BUDGETS defines token allocations for all 4 phases', () => {
      const { PHASE_BUDGETS } = require('../components/context/template-composer.cjs');
      expect(PHASE_BUDGETS[1]).toBeDefined();
      expect(PHASE_BUDGETS[2]).toBeDefined();
      expect(PHASE_BUDGETS[3]).toBeDefined();
      expect(PHASE_BUDGETS[4]).toBeDefined();
    });
  });

  describe('Phase transitions', () => {
    it('calculateBudgetPhase returns correct phase for each utilization range', () => {
      const { calculateBudgetPhase, BUDGET_PHASES } = require('../components/context/budget-tracker.cjs');
      const windowBytes = 800000; // 200k tokens * 4 bytes

      // Phase 1: FULL (0-30%)
      expect(calculateBudgetPhase(0, windowBytes)).toBe(BUDGET_PHASES.FULL);
      expect(calculateBudgetPhase(200000, windowBytes)).toBe(BUDGET_PHASES.FULL);

      // Phase 2: COMPRESSED (30-60%)
      expect(calculateBudgetPhase(240000, windowBytes)).toBe(BUDGET_PHASES.COMPRESSED);
      expect(calculateBudgetPhase(400000, windowBytes)).toBe(BUDGET_PHASES.COMPRESSED);

      // Phase 3: REINFORCED (60-80%)
      expect(calculateBudgetPhase(480000, windowBytes)).toBe(BUDGET_PHASES.REINFORCED);
      expect(calculateBudgetPhase(600000, windowBytes)).toBe(BUDGET_PHASES.REINFORCED);

      // Phase 4: COMPACTION (>=80%)
      expect(calculateBudgetPhase(640000, windowBytes)).toBe(BUDGET_PHASES.COMPACTION);
      expect(calculateBudgetPhase(800000, windowBytes)).toBe(BUDGET_PHASES.COMPACTION);
    });

    it('budget tracker detects phase transitions and reports them', () => {
      const { createBudgetTracker, BUDGET_PHASES } = require('../components/context/budget-tracker.cjs');
      const tracker = createBudgetTracker({ contextWindowTokens: 1000 }); // 4000 bytes

      expect(tracker.getPhase()).toBe(BUDGET_PHASES.FULL);

      // Push to compressed threshold (30% = 1200 bytes)
      const transition = tracker.trackBytes(1200, 'test');
      expect(transition.changed).toBe(true);
      expect(transition.from).toBe(BUDGET_PHASES.FULL);
      expect(transition.to).toBe(BUDGET_PHASES.COMPRESSED);
    });

    it('injection size adapts at each boundary (phase 3 > phase 1 per [Phase 08] deviation)', () => {
      const { PHASE_BUDGETS } = require('../components/context/template-composer.cjs');

      const phase1Total = Object.values(PHASE_BUDGETS[1]).reduce((s, v) => s + v, 0);
      const phase2Total = Object.values(PHASE_BUDGETS[2]).reduce((s, v) => s + v, 0);
      const phase3Total = Object.values(PHASE_BUDGETS[3]).reduce((s, v) => s + v, 0);
      const phase4Total = Object.values(PHASE_BUDGETS[4]).reduce((s, v) => s + v, 0);

      // Phase 2 (compressed) < Phase 1 (full) -- normal compression
      expect(phase2Total).toBeLessThan(phase1Total);

      // Phase 3 (reinforced) > Phase 1 (full) -- per [Phase 08] D-05/D-06 deviation
      expect(phase3Total).toBeGreaterThan(phase1Total);

      // Phase 4 (compaction) is also large (full injection + compaction advocacy)
      expect(phase4Total).toBeGreaterThan(phase1Total);
    });
  });

  it('Phase 4 appends compaction advocacy directive', () => {
    const { createTemplateComposer } = require('../components/context/template-composer.cjs');
    const mockSelfModel = { getAspect() { return null; } };
    const composer = createTemplateComposer({ selfModel: mockSelfModel });

    const phase4Prompt = composer.compose(4);
    // Spec 8.5 Phase 4: proactive compaction advocacy
    expect(phase4Prompt).toContain('compaction');
    // Should contain context utilization warning
    expect(phase4Prompt).toContain('CONTEXT UTILIZATION CRITICAL');
  });

  it('budget tracker provides getUtilization() for monitoring', () => {
    const { createBudgetTracker } = require('../components/context/budget-tracker.cjs');
    const tracker = createBudgetTracker({ contextWindowTokens: 1000 });
    tracker.trackBytes(2000, 'test'); // 2000 / 4000 = 0.5
    expect(tracker.getUtilization()).toBeCloseTo(0.5, 2);
  });

  it('budget tracker reset() returns to Phase 1 for post-compaction', () => {
    const { createBudgetTracker, BUDGET_PHASES } = require('../components/context/budget-tracker.cjs');
    const tracker = createBudgetTracker({ contextWindowTokens: 200000 });

    // Push to compaction phase
    tracker.trackBytes(700000, 'test');
    expect(tracker.getPhase()).toBe(BUDGET_PHASES.COMPACTION);

    // Reset post-compaction -- should return to a low phase
    tracker.reset();
    // Post-compaction estimate is 33000 tokens * 4 = 132000 bytes
    // 132000 / 800000 = 16.5% -> Phase 1
    expect(tracker.getPhase()).toBe(BUDGET_PHASES.FULL);
  });
});

// ---------------------------------------------------------------------------
// Spec 8.6: Self Model as Compaction Frame
// ---------------------------------------------------------------------------

describe('Spec 8.6: Self Model as Compaction Frame', () => {

  it('PreCompact handler injects compaction framing via additionalContext', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    // PreCompact handler must return additionalContext with framing text
    expect(source).toContain("hookEventName: 'PreCompact'");
    expect(source).toContain('additionalContext: COMPACTION_FRAMING');
  });

  it('COMPACTION_FRAMING preserves Self Model personality perspective (not neutral summary)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    // Must preserve personality identity
    expect(source).toContain('Self Model identity frame');
    expect(source).toContain('personality directives');
    // Must preserve user intent
    expect(source).toContain('current intent');
    // Must preserve attention priorities
    expect(source).toContain('attention priorities');
    // Must mention discarding re-retrievable content
    expect(source).toContain('Discard raw source content');
  });

  it('PreCompact saves checkpoint before compaction (spec 8.6 persistence)', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'hooks', 'hook-handlers.cjs'), 'utf8'
    );

    // handlePreCompact calls checkpoint() first
    expect(source).toContain('contextManager.checkpoint()');
  });

  it('Context Manager checkpoint includes face prompt, budget phase, and attention directives', () => {
    const { CONTEXT_MANAGER_SHAPE } = require('../components/context/context-manager.cjs');
    expect(CONTEXT_MANAGER_SHAPE.required).toContain('checkpoint');

    // Verify checkpoint implementation stores the required state
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'components', 'context', 'context-manager.cjs'), 'utf8'
    );
    expect(source).toContain('facePromptText');
    expect(source).toContain('budgetPhase');
    expect(source).toContain('attentionDirectives');
    expect(source).toContain('entropyState');
  });

  it('resetAfterCompaction resets budget to Phase 1 and recomposes face prompt', () => {
    const { CONTEXT_MANAGER_SHAPE } = require('../components/context/context-manager.cjs');
    expect(CONTEXT_MANAGER_SHAPE.required).toContain('resetAfterCompaction');

    // Verify implementation resets budget and recomposes
    const source = fs.readFileSync(
      path.join(ROOT, 'modules', 'reverie', 'components', 'context', 'context-manager.cjs'), 'utf8'
    );
    expect(source).toContain('_budgetTracker.reset()');
    // It composes a new face prompt after reset
    const resetFn = source.slice(source.indexOf('async function resetAfterCompaction'));
    expect(resetFn).toContain('compose()');
  });
});
