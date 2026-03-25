'use strict';

/**
 * Mind cognitive cycle orchestrator -- Secondary session processing center.
 *
 * Implements D-04 (full Mind minus REM): the cognitive center that orchestrates
 * attention management, formation, recall, Self Model authority, directive
 * generation, sublimation evaluation, and face prompt composition.
 *
 * The Mind cycle defines how Secondary processes each user turn:
 * 1. Attention check via formation pipeline's prepareStimulus
 * 2. Formation orchestration (delegates actual spawning to Session Manager)
 * 3. Passive recall on every turn, explicit recall on keyword triggers
 * 4. Face prompt composition with referential framing (D-12)
 * 5. Sublimation evaluation from Tertiary candidates
 * 6. Directive generation for Primary (face prompt, behavioral, recall)
 *
 * Per D-05: Secondary spawns formation subagents under Mind authority.
 * Per D-06: Dual context feed -- Wire for snapshots, Lithograph for depth.
 * Per D-08/Pitfall 4: Sublimation intake capped at config.max_sublimation_intake.
 *
 * @module reverie/components/session/mind-cycle
 */

const { ok, err } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex for detecting explicit recall keywords in user prompts.
 * When matched, triggers recallExplicit in addition to passive recall.
 *
 * @type {RegExp}
 */
const RECALL_KEYWORDS = /\b(remember|recall|what did|last time|we discussed|you said)\b/i;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Mind cognitive cycle orchestrator instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.selfModel - Self Model manager (getAspect, setAspect)
 * @param {Object} options.formationPipeline - Formation pipeline (prepareStimulus, processFormationOutput)
 * @param {Object} [options.recallEngine] - Recall engine (recallPassive, recallExplicit)
 * @param {Object} [options.templateComposer] - Template composer (compose)
 * @param {Object} [options.referentialFraming] - Referential framing (getPrompt)
 * @param {Object} [options.sublimationLoop] - Sublimation loop config (getCycleConfig)
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.wire] - Wire service for inter-session messaging
 * @param {Object} [options.lithograph] - Lithograph transcript provider
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Readonly<{
 *   processTurn: Function,
 *   processSublimation: Function,
 *   composeFacePrompt: Function,
 *   getState: Function,
 *   drainSublimations: Function
 * }>}
 */
function createMindCycle(options) {
  const opts = options || {};
  const selfModel = opts.selfModel;
  const formationPipeline = opts.formationPipeline;
  const recallEngine = opts.recallEngine || null;
  const templateComposer = opts.templateComposer || null;
  const referentialFraming = opts.referentialFraming || null;
  const sublimationLoop = opts.sublimationLoop || null;
  const switchboard = opts.switchboard || null;
  const wire = opts.wire || null;
  const lithograph = opts.lithograph || null;
  const config = opts.config || {};

  // Default config values
  const maxSublimationIntake = config.max_sublimation_intake != null
    ? config.max_sublimation_intake
    : 5;

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  let _turnsProcessed = 0;
  let _formationsInitiated = 0;
  let _sublimationsEvaluated = 0;
  let _lastTurnAt = null;
  let _pendingSublimations = [];

  // -------------------------------------------------------------------------
  // processTurn
  // -------------------------------------------------------------------------

  /**
   * Processes a single user turn through the full cognitive pipeline.
   *
   * Flow:
   * 1. Increment counter, update timestamp
   * 2. Attention check via formationPipeline.prepareStimulus
   * 3. If attention-worthy: increment formations, mark formed
   * 4. Passive recall (every turn)
   * 5. Explicit recall on keyword triggers
   * 6. Generate directives (face prompt, recall, behavioral)
   * 7. Return result
   *
   * @param {Object} turnData
   * @param {string} turnData.userPrompt - User's prompt text
   * @param {*} [turnData.toolUse] - Tool use data
   * @param {number} [turnData.turnNumber] - Turn sequence number
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{
   *   formed: boolean,
   *   reason?: string,
   *   stimulus?: Object,
   *   fragments_initiated?: number,
   *   recall?: Object,
   *   directives?: Object
   * }>>}
   */
  async function processTurn({ userPrompt, toolUse, turnNumber } = {}) {
    // 1. Increment counter, update timestamp
    _turnsProcessed++;
    _lastTurnAt = Date.now();

    // 2. Attention check via formation pipeline
    const stimulus = formationPipeline.prepareStimulus(
      { user_prompt: userPrompt, tool_use: toolUse },
      { turnNumber }
    );

    // Determine if stimulus is attention-worthy
    // A stimulus with an empty user_prompt in turn_context indicates below-threshold
    const isWorthy = stimulus &&
      stimulus.turn_context &&
      stimulus.turn_context.user_prompt &&
      stimulus.turn_context.user_prompt.length > 0;

    let formed = false;
    let recallResult = null;

    if (!isWorthy) {
      // Below threshold -- still run recall if available
      recallResult = await _runRecall(userPrompt, turnNumber);

      return ok({
        formed: false,
        reason: 'below_threshold',
        recall: recallResult,
        directives: {
          facePromptUpdate: composeFacePrompt(),
          recall: recallResult,
          behavioral: null,
        },
      });
    }

    // 3. Attention-worthy: increment formations
    _formationsInitiated++;
    formed = true;

    // 4. Run recall (passive and possibly explicit)
    recallResult = await _runRecall(userPrompt, turnNumber);

    // 5. Generate directives
    const directives = {
      facePromptUpdate: composeFacePrompt(),
      recall: recallResult,
      behavioral: null, // Phase 11 conditioning replaces this
    };

    // 6. Emit event
    if (switchboard) {
      switchboard.emit('reverie:mind:turn-processed', {
        turnNumber,
        formed,
        formationsInitiated: _formationsInitiated,
      });
    }

    return ok({
      formed: true,
      stimulus,
      fragments_initiated: 1,
      recall: recallResult,
      directives,
    });
  }

  // -------------------------------------------------------------------------
  // _runRecall (internal)
  // -------------------------------------------------------------------------

  /**
   * Runs recall for a turn -- passive always, explicit on keyword match.
   *
   * @param {string} userPrompt - User's prompt
   * @param {number} turnNumber - Turn sequence number
   * @returns {Promise<Object|null>} Recall result or null
   */
  async function _runRecall(userPrompt, turnNumber) {
    if (!recallEngine) return null;

    let passiveResult = null;
    let explicitResult = null;

    // Passive recall on every turn
    try {
      passiveResult = await recallEngine.recallPassive({
        userPrompt,
        turnNumber,
      });
    } catch (_e) {
      // Recall failure is non-fatal
    }

    // Explicit recall on keyword triggers
    if (userPrompt && RECALL_KEYWORDS.test(userPrompt)) {
      try {
        explicitResult = await recallEngine.recallExplicit({
          user_prompt: userPrompt,
          turn_number: turnNumber,
        });
      } catch (_e) {
        // Recall failure is non-fatal
      }
    }

    return {
      passive: passiveResult,
      explicit: explicitResult,
    };
  }

  // -------------------------------------------------------------------------
  // processSublimation
  // -------------------------------------------------------------------------

  /**
   * Evaluates sublimation candidates from Tertiary session.
   *
   * Filters by sensitivity threshold (from sublimationLoop config),
   * caps at max_sublimation_intake per D-08/Pitfall 4, and queues
   * worthy candidates for the next formation evaluation cycle.
   *
   * @param {Object} sublimationData
   * @param {Array<Object>} sublimationData.candidates - Fragment candidates with scores
   * @param {number[]} sublimationData.resonanceScores - Corresponding resonance scores
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{
   *   evaluated: number,
   *   worthy: number,
   *   queued: number
   * }>>}
   */
  async function processSublimation({ candidates, resonanceScores } = {}) {
    const candidateList = candidates || [];

    // 1. Track total evaluations
    _sublimationsEvaluated += candidateList.length;

    // 2. Get sensitivity threshold from sublimation loop config
    let sensitivity_threshold = 0.3; // default
    if (sublimationLoop) {
      const cycleConfig = sublimationLoop.getCycleConfig();
      sensitivity_threshold = cycleConfig.sensitivity_threshold;
    }

    // 3. Filter candidates by resonance score >= threshold
    const worthyCandidates = candidateList.filter((candidate, index) => {
      const score = (resonanceScores && resonanceScores[index] != null)
        ? resonanceScores[index]
        : (candidate.score || 0);
      return score >= sensitivity_threshold;
    });

    // 4. Cap at max_sublimation_intake per D-08/Pitfall 4
    const capped = worthyCandidates.slice(0, maxSublimationIntake);

    // 5. Queue for next formation evaluation
    for (const candidate of capped) {
      _pendingSublimations.push(candidate);
    }

    // 6. Emit event
    if (switchboard) {
      switchboard.emit('reverie:mind:sublimation-evaluated', {
        evaluated: candidateList.length,
        worthy: capped.length,
        queued: _pendingSublimations.length,
      });
    }

    return ok({
      evaluated: candidateList.length,
      worthy: capped.length,
      queued: _pendingSublimations.length,
    });
  }

  // -------------------------------------------------------------------------
  // composeFacePrompt
  // -------------------------------------------------------------------------

  /**
   * Composes the face prompt for Primary session injection.
   *
   * Delegates to templateComposer.compose() with current budget phase,
   * then appends referential framing content from referentialFraming.getPrompt().
   *
   * If templateComposer is not available, returns a minimal prompt from
   * Self Model identity data.
   *
   * @param {number} [budgetPhase=1] - Current context budget phase
   * @returns {string} Composed face prompt string
   */
  function composeFacePrompt(budgetPhase) {
    const phase = budgetPhase || 1;

    if (templateComposer) {
      let prompt = templateComposer.compose(phase);

      // Append referential framing if available
      if (referentialFraming) {
        const framingContent = referentialFraming.getPrompt();
        if (framingContent) {
          prompt += '\n\n' + framingContent;
        }
      }

      return prompt;
    }

    // Minimal fallback when no template composer
    let minimal = '## Self Model\n';
    if (selfModel) {
      const identity = selfModel.getAspect('identity-core');
      if (identity && identity.body) {
        minimal += identity.body;
      } else {
        minimal += 'Identity loading...';
      }
    } else {
      minimal += 'Self Model not available.';
    }

    // Append referential framing even in minimal mode
    if (referentialFraming) {
      const framingContent = referentialFraming.getPrompt();
      if (framingContent) {
        minimal += '\n\n' + framingContent;
      }
    }

    return minimal;
  }

  // -------------------------------------------------------------------------
  // getState
  // -------------------------------------------------------------------------

  /**
   * Returns the current cognitive cycle state metrics.
   *
   * @returns {{
   *   turns_processed: number,
   *   formations_initiated: number,
   *   sublimations_evaluated: number,
   *   last_turn_at: number|null,
   *   pending_sublimations: number
   * }}
   */
  function getState() {
    return {
      turns_processed: _turnsProcessed,
      formations_initiated: _formationsInitiated,
      sublimations_evaluated: _sublimationsEvaluated,
      last_turn_at: _lastTurnAt,
      pending_sublimations: _pendingSublimations.length,
    };
  }

  // -------------------------------------------------------------------------
  // drainSublimations
  // -------------------------------------------------------------------------

  /**
   * Returns and clears the pending sublimations queue.
   * Called by the formation pipeline to process queued sublimation candidates.
   *
   * @returns {Array<Object>} Drained sublimation candidates
   */
  function drainSublimations() {
    const drained = _pendingSublimations.slice();
    _pendingSublimations = [];
    return drained;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return Object.freeze({
    processTurn,
    processSublimation,
    composeFacePrompt,
    getState,
    drainSublimations,
  });
}

module.exports = { createMindCycle };
