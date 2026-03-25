'use strict';

/**
 * Context Manager orchestrator for face prompt lifecycle management.
 *
 * Central orchestrator: composes face prompts from Self Model state via
 * template-composer, tracks context budget via budget-tracker, manages
 * the face prompt file for injection and warm-start caching, handles
 * compaction checkpoints, and provides synchronous getInjection() for
 * the hot path (< 1ms, zero I/O per Research Pitfall 4).
 *
 * Per D-02: The face prompt file serves as both the active injection
 * source AND the warm-start cache (single file, dual purpose).
 *
 * Per D-03: Recomposition triggers: SessionStart (initial), budget phase
 * transitions, and post-compaction reset.
 *
 * Per D-09: Checkpoint saves full state to Journal before compaction.
 * Per D-10: Post-compaction resets budget to Phase 1 and recomposes.
 * Per D-12: Stop hook persists warm-start via persistWarmStart().
 * Per D-13: SessionStart reads warm-start or runs cold-start.
 *
 * @module reverie/components/context/context-manager
 */

const path = require('node:path');
const { ok, err } = require('../../../../lib/result.cjs');
const { createContract } = require('../../../../lib/contract.cjs');
const { createBudgetTracker } = require('./budget-tracker.cjs');
const { createTemplateComposer } = require('./template-composer.cjs');
const { createColdStartSeed } = require('../self-model/cold-start.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Contract shape for the Context Manager.
 * @type {import('../../../../lib/contract.cjs').ContractShape}
 */
const CONTEXT_MANAGER_SHAPE = {
  required: [
    'init',
    'compose',
    'getInjection',
    'trackBytes',
    'getBudgetPhase',
    'getMicroNudge',
    'checkpoint',
    'resetAfterCompaction',
    'getSessionSnapshot',
    'persistWarmStart',
  ],
  optional: ['incrementTurn', 'getNudge', 'receiveSecondaryUpdate', 'setSecondaryActive'],
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Context Manager orchestrator instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.selfModel - Self Model manager with getAspect()/save()
 * @param {Object} options.lathe - Lathe service for file I/O
 * @param {Object} options.switchboard - Switchboard for event emission
 * @param {Object} [options.entropy] - Entropy engine for cold-start variance
 * @param {Object} [options.journal] - Journal provider (for future use)
 * @param {string} [options.dataDir='~/.dynamo/reverie'] - Data directory path
 * @returns {import('../../../../lib/result.cjs').Result<Object>} Frozen contract instance
 */
function createContextManager(options) {
  if (!options) {
    return err('INIT_FAILED', 'createContextManager requires options object');
  }

  const { selfModel, lathe, switchboard, entropy, journal } = options;
  const _nudgeManager = options.nudgeManager || null;
  const dataDir = options.dataDir || '~/.dynamo/reverie';

  // Resolve ~ to HOME
  const resolvedDataDir = dataDir.startsWith('~')
    ? path.join(process.env.HOME || '/tmp', dataDir.slice(1))
    : dataDir;

  // Internal state
  const _budgetTracker = createBudgetTracker({ contextWindowTokens: 200000 });
  const _templateComposer = createTemplateComposer({ selfModel });
  let _currentFacePrompt = null;
  const _facePromptPath = path.join(resolvedDataDir, 'face-prompt.md');
  const _checkpointDir = path.join(resolvedDataDir, 'data', 'checkpoints');
  let _initialized = false;
  let _secondaryActive = false;

  // -------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------

  /**
   * Initializes the Context Manager.
   *
   * Warm-start path: reads existing face prompt file, caches in memory.
   * Cold-start path: generates seed, saves aspects, composes initial prompt.
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ source: string }>>}
   */
  async function init() {
    // Try warm-start: read existing face prompt file
    const readResult = await lathe.readFile(_facePromptPath);

    if (readResult.ok) {
      // Warm-start: cache the existing face prompt
      _currentFacePrompt = readResult.value;
      _initialized = true;
      return ok({ source: 'warm-start' });
    }

    // Cold-start: no existing face prompt file
    const seed = createColdStartSeed({ entropy });

    // Save each aspect via selfModel
    await selfModel.save('identity-core', seed.identityCore);
    await selfModel.save('relational-model', seed.relationalModel);
    await selfModel.save('conditioning', seed.conditioning);

    // Compose initial face prompt
    await compose();

    _initialized = true;
    return ok({ source: 'cold-start' });
  }

  /**
   * Composes a face prompt from Self Model state for the current budget phase.
   *
   * 1. Gets current phase from budget tracker
   * 2. Calls template composer to generate text
   * 3. Caches in memory for synchronous getInjection()
   * 4. Writes to face prompt file via lathe
   * 5. Emits composition event
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ phase: number, path: string }>>}
   */
  async function compose() {
    // When Secondary is active, it is the face prompt authority (per D-04).
    // Skip local composition and return the Secondary-provided face prompt.
    if (_secondaryActive && _currentFacePrompt) {
      return ok({ phase: _budgetTracker.getPhase(), path: _facePromptPath, source: 'secondary' });
    }

    const phase = _budgetTracker.getPhase();
    const text = _templateComposer.compose(phase);

    _currentFacePrompt = text;

    await lathe.writeFile(_facePromptPath, _currentFacePrompt);

    if (switchboard) {
      switchboard.emit('reverie:face-prompt-composed', {
        phase,
        tokens: Math.ceil(_currentFacePrompt.length / 4),
      });
    }

    return ok({ phase, path: _facePromptPath });
  }

  /**
   * Returns the in-memory cached face prompt string.
   *
   * CRITICAL: This is synchronous with zero I/O (hot path per Pitfall 4).
   * Called on every UserPromptSubmit -- must be < 1ms.
   *
   * @returns {string|null} Cached face prompt or null if not yet composed
   */
  function getInjection() {
    return _currentFacePrompt;
  }

  /**
   * Tracks additional bytes consumed and triggers recompose on phase change.
   *
   * @param {number} byteCount - Number of bytes to add
   * @param {string} [source] - Source identifier
   * @returns {{ changed: boolean, from: number, to: number }} Transition info
   */
  function trackBytes(byteCount, source) {
    const transition = _budgetTracker.trackBytes(byteCount, source);

    if (transition.changed) {
      // Fire-and-forget recompose on phase change
      compose();

      if (switchboard) {
        switchboard.emit('reverie:budget-phase-changed', {
          from: transition.from,
          to: transition.to,
        });
      }
    }

    return transition;
  }

  /**
   * Returns the current budget phase number (1-4).
   * @returns {number}
   */
  function getBudgetPhase() {
    return _budgetTracker.getPhase();
  }

  /**
   * Returns a micro-nudge string when in Phase 3 (reinforced), null otherwise.
   *
   * @returns {string|null}
   */
  function getMicroNudge() {
    if (_budgetTracker.getPhase() === 3) {
      return _templateComposer.getMicroNudge();
    }
    return null;
  }

  /**
   * Saves a checkpoint to the checkpoint directory before compaction.
   *
   * Per D-09: Checkpoint includes full face prompt text, budget phase,
   * cumulative bytes, attention directives, entropy state, and timestamp.
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result<Object>>}
   */
  async function checkpoint() {
    const stats = _budgetTracker.getStats();
    const conditioningAspect = selfModel ? selfModel.getAspect('conditioning') : null;
    const attentionDirectives = conditioningAspect
      && conditioningAspect.frontmatter
      && conditioningAspect.frontmatter.attention_biases
      ? conditioningAspect.frontmatter.attention_biases
      : {};

    const cp = {
      facePromptText: _currentFacePrompt,
      budgetPhase: stats.phase,
      cumulativeBytes: stats.cumulativeBytes,
      attentionDirectives,
      entropyState: entropy ? entropy.getState() : null,
      timestamp: new Date().toISOString(),
    };

    const cpPath = path.join(_checkpointDir, 'compact-' + Date.now() + '.json');
    await lathe.writeFile(cpPath, JSON.stringify(cp, null, 2));

    return ok(cp);
  }

  /**
   * Resets after compaction: resets budget to Phase 1 and recomposes.
   *
   * Per D-10: Post-compaction full reinjection. Reset budget to Phase 1
   * using DEFAULT_POST_COMPACTION_TOKENS estimate.
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ phase: number }>>}
   */
  async function resetAfterCompaction() {
    _budgetTracker.reset();
    await compose();

    if (switchboard) {
      switchboard.emit('reverie:post-compaction-reset', {
        phase: _budgetTracker.getPhase(),
      });
    }

    return ok({ phase: _budgetTracker.getPhase() });
  }

  /**
   * Returns a full session state snapshot.
   *
   * @returns {{ budgetPhase: number, cumulativeBytes: number, turnCount: number, utilization: number, contextWindowBytes: number, entropyState: Object|null, facePromptPath: string }}
   */
  function getSessionSnapshot() {
    const stats = _budgetTracker.getStats();
    return {
      budgetPhase: stats.phase,
      cumulativeBytes: stats.cumulativeBytes,
      turnCount: stats.turnCount,
      utilization: stats.utilization,
      contextWindowBytes: stats.contextWindowBytes,
      entropyState: entropy ? entropy.getState() : null,
      facePromptPath: _facePromptPath,
    };
  }

  /**
   * Writes current face prompt to file for warm-start caching.
   *
   * Per D-02: Same file as compose writes -- dual purpose.
   * Per D-12: Called by Stop hook for next session warm-start.
   *
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ path: string }>>}
   */
  async function persistWarmStart() {
    await lathe.writeFile(_facePromptPath, _currentFacePrompt);
    return ok({ path: _facePromptPath });
  }

  /**
   * Increments the turn count in the budget tracker.
   */
  function incrementTurn() {
    _budgetTracker.incrementTurn();
  }

  /**
   * Receives a face prompt update from Secondary (Mind) session.
   *
   * When Secondary is running, face prompt composition is Secondary-driven.
   * Context Manager caches what Secondary provides and serves it via
   * getInjection() on the hot path.
   *
   * @param {string} facePrompt - Face prompt string composed by Secondary
   * @returns {import('../../../../lib/result.cjs').Result<{ source: string, length: number }>}
   */
  function receiveSecondaryUpdate(facePrompt) {
    if (!facePrompt || typeof facePrompt !== 'string' || facePrompt.length === 0) {
      return err('INVALID_FACE_PROMPT', 'facePrompt must be a non-empty string');
    }

    _currentFacePrompt = facePrompt;
    _secondaryActive = true;

    if (switchboard) {
      switchboard.emit('context:face-prompt-updated', { source: 'secondary', length: facePrompt.length });
    }

    return ok({ source: 'secondary', length: facePrompt.length });
  }

  /**
   * Sets the Secondary active flag.
   *
   * Called by Session Manager when Secondary starts or stops to control
   * whether compose() defers to Secondary-provided face prompts.
   *
   * @param {boolean} active - Whether Secondary is active
   */
  function setSecondaryActive(active) {
    _secondaryActive = !!active;
  }

  /**
   * Returns the latest formation nudge text if available and fresh.
   * Reads from nudge manager (filesystem). Returns null if no nudge
   * or nudge is stale.
   *
   * @returns {Promise<string|null>}
   */
  async function getNudge() {
    if (!_nudgeManager) return null;
    const result = await _nudgeManager.readLatestNudge();
    if (!result.ok || !result.value) return null;
    return result.value.text;
  }

  return createContract('contextManager', CONTEXT_MANAGER_SHAPE, {
    init,
    compose,
    getInjection,
    trackBytes,
    getBudgetPhase,
    getMicroNudge,
    checkpoint,
    resetAfterCompaction,
    getSessionSnapshot,
    persistWarmStart,
    incrementTurn,
    getNudge,
    receiveSecondaryUpdate,
    setSecondaryActive,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  CONTEXT_MANAGER_SHAPE,
  createContextManager,
};
