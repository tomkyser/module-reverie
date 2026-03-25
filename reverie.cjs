'use strict';

/**
 * Reverie module entry point.
 *
 * Registers Reverie with the Dynamo platform via Circuit's module API.
 * Creates the Context Manager orchestrator and registers all 8 Claude Code
 * hook handlers through Exciter's integration surface.
 *
 * Per INT-01 + D-09: All hooks are registered via exciter.registerHooks(),
 * which delegates to Armature's createHookRegistry internally. This ensures
 * hooks are discoverable, inspectable, and follow the Armature contract
 * while routing through Dynamo's integration surface.
 *
 * @module reverie
 */

const { createContextManager } = require('./components/context/context-manager.cjs');
const { createHookHandlers } = require('./hooks/hook-handlers.cjs');
const { createSelfModel } = require('./components/self-model/self-model.cjs');
const { createEntropyEngine } = require('./components/self-model/entropy-engine.cjs');
const { createFragmentWriter } = require('./components/fragments/fragment-writer.cjs');
const { createFormationPipeline } = require('./components/formation/formation-pipeline.cjs');
const { createRecallEngine } = require('./components/recall/recall-engine.cjs');
const { createNudgeManager } = require('./components/formation/nudge-manager.cjs');
const { DATA_DIR_DEFAULT } = require('./lib/constants.cjs');

// Phase 10: Three-session architecture components
const { createSessionManager } = require('./components/session/session-manager.cjs');
const { createSessionConfig, FRAMING_MODES } = require('./components/session/session-config.cjs');
const { createMindCycle } = require('./components/session/mind-cycle.cjs');
const { createSublimationLoop } = require('./components/session/sublimation-loop.cjs');
const { createWireTopology } = require('./components/session/wire-topology.cjs');
const { createModeManager } = require('./components/modes/mode-manager.cjs');
const { createReferentialFraming } = require('./components/context/referential-framing.cjs');

// Phase 11: REM consolidation components
const { createTriage } = require('./components/rem/triage.cjs');
const { createHeartbeatMonitor } = require('./components/rem/heartbeat-monitor.cjs');
const { createConditioningUpdater } = require('./components/rem/conditioning-updater.cjs');
const { createQualityEvaluator } = require('./components/rem/quality-evaluator.cjs');
const { createRetroactiveEvaluator } = require('./components/rem/retroactive-evaluator.cjs');
const { createEditorialPass } = require('./components/rem/editorial-pass.cjs');
const { createFullRem } = require('./components/rem/full-rem.cjs');
const { createProvisionalRem } = require('./components/rem/provisional-rem.cjs');
const { createRemConsolidator } = require('./components/rem/rem-consolidator.cjs');

// Phase 12: Integration Surface & Backfill
const { createTaxonomyGovernor } = require('./components/taxonomy/taxonomy-governor.cjs');
const { createBackfillPipeline } = require('./components/formation/backfill-pipeline.cjs');
const { registerReverieCommands } = require('./components/cli/register-commands.cjs');

/**
 * Registers the Reverie module with the Circuit API.
 *
 * Creates all required components (Self Model, Context Manager, Hook Handlers)
 * and wires 8 hook handlers through Armature's hook registry to Switchboard.
 *
 * @param {Object} facade - Scoped Circuit API with getService, getProvider, events, etc.
 * @returns {{ name: string, status: string, hooks: number }} Registration result
 */
function register(facade) {
  const { events, getService, getProvider } = facade;

  // Resolve platform services
  const switchboard = getService('switchboard');
  const lathe = getService('lathe');
  const magnet = getService('magnet');
  const wire = getService('wire');
  const journal = getProvider('journal');

  // Create Self Model manager
  const selfModelResult = createSelfModel({ journal, magnet, wire, switchboard });
  if (!selfModelResult.ok) {
    return { name: 'reverie', status: 'error', error: selfModelResult.error };
  }
  const selfModel = selfModelResult.value;

  // Create entropy engine for session variance
  const entropy = createEntropyEngine({});

  // Resolve additional services for Phase 9
  const assay = getService('assay');

  // Resolve Exciter integration surface and Lithograph transcript provider (Phase 9.1)
  const exciter = getService('exciter');
  const lithograph = getProvider('lithograph');

  // Create FragmentWriter for formation
  const fragmentWriter = createFragmentWriter({
    journal, wire, switchboard, sessionId: 'reverie-formation',
  });

  // Create nudge manager for formation -> context manager coordination
  const nudgeManager = createNudgeManager({ lathe, dataDir: DATA_DIR_DEFAULT });

  // Create Context Manager orchestrator (with Phase 9 nudge integration)
  const ctxResult = createContextManager({
    selfModel,
    lathe,
    switchboard,
    entropy,
    journal,
    dataDir: DATA_DIR_DEFAULT,
    nudgeManager,
  });
  if (!ctxResult.ok) {
    return { name: 'reverie', status: 'error', error: ctxResult.error };
  }
  const contextManager = ctxResult.value;

  // Create formation pipeline (FRG-03)
  const formationPipeline = createFormationPipeline({
    fragmentWriter, selfModel, lathe, wire, switchboard, assay,
    dataDir: DATA_DIR_DEFAULT,
  });

  // Create recall engine (FRG-04)
  const recallEngine = createRecallEngine({
    assay, selfModel, switchboard,
  });

  // -------------------------------------------------------------------------
  // Phase 10: Three-session architecture components
  // -------------------------------------------------------------------------

  // Resolve Conductor for session spawning
  const conductor = getService('conductor');

  // Create session config (defaults: dual framing, opus secondary, sonnet tertiary)
  const sessionConfig = createSessionConfig({});

  // Create referential framing templates for face prompt slot 5
  const referentialFraming = createReferentialFraming({ mode: sessionConfig.framing_mode });

  // Create sublimation loop (Tertiary cycle config + system prompt)
  const sublimationLoop = createSublimationLoop({ config: sessionConfig });

  // Create Wire topology (topology-validated Wire wrapper with ACK protocol)
  const wireTopology = createWireTopology({ wire, switchboard, config: sessionConfig });

  // Create Mind cognitive cycle (Secondary processing center)
  const mindCycle = createMindCycle({
    selfModel,
    formationPipeline,
    recallEngine,
    templateComposer: null, // Mind composes face prompts via referentialFraming + selfModel directly
    referentialFraming,
    sublimationLoop,
    switchboard,
    wire,
    lithograph,
    config: sessionConfig,
  });

  // Create Session Manager (lifecycle state machine, spawns Secondary/Tertiary)
  const sessionManager = createSessionManager({
    conductor,
    wire,
    selfModel,
    switchboard,
    sublimationLoop,
    config: sessionConfig,
  });

  // Create Mode Manager (Active/Passive with automatic fallback)
  const modeManager = createModeManager({
    sessionManager,
    conductor,
    switchboard,
    config: sessionConfig,
  });

  // -------------------------------------------------------------------------
  // Phase 11: REM consolidation components (order matters -- dependencies flow downward)
  // -------------------------------------------------------------------------

  // Tier 1: Triage (fast state snapshot on PreCompact)
  const triage = createTriage({ lathe, switchboard, dataDir: DATA_DIR_DEFAULT, sessionId: 'reverie' });

  // Heartbeat monitor (Wire heartbeat timeout detection for Tier 2)
  const heartbeatMonitor = createHeartbeatMonitor({
    switchboard,
    config: sessionConfig,
  });

  // Conditioning updater (SM-04: EMA-based conditioning field updates)
  const conditioningUpdater = createConditioningUpdater({
    selfModel,
    config: sessionConfig,
  });

  // Quality evaluator (D-12: dual-signal behavioral + LLM quality score)
  const qualityEvaluator = createQualityEvaluator({
    entropyEngine: entropy,
    config: sessionConfig,
  });

  // Retroactive evaluator (D-06: LLM re-evaluation of fragments against session arc)
  const retroactiveEvaluator = createRetroactiveEvaluator({
    fragmentWriter,
    journal,
    wire,
    switchboard,
    config: sessionConfig,
  });

  // Phase 12: Taxonomy governance (FRG-07)
  const taxonomyGovernor = createTaxonomyGovernor({
    wire, switchboard, fragmentWriter, config: sessionConfig,
  });

  // Editorial pass (D-08: LLM-driven association index editorial operations)
  const editorialPass = createEditorialPass({
    wire,
    switchboard,
    fragmentWriter,
    config: sessionConfig,
    taxonomyGovernor,  // Phase 12: governance split/retire via editorial pass
  });

  // Full REM pipeline (Tier 3: complete editorial orchestrator)
  const fullRem = createFullRem({
    retroactiveEvaluator,
    editorialPass,
    conditioningUpdater,
    qualityEvaluator,
    selfModel,
    journal,
    wire,
    switchboard,
    config: sessionConfig,
    taxonomyGovernor,  // Phase 12: cap pressure computation for editorial pass
  });

  // Provisional REM (Tier 2: tentative promotion with abort-and-revert)
  const provisionalRem = createProvisionalRem({
    fullRem,
    journal,
    wire,
    switchboard,
    config: sessionConfig,
  });

  // REM Consolidator (single entry point for all consolidation -- enforces REM-07 gate)
  const remConsolidator = createRemConsolidator({
    triage,
    provisionalRem,
    fullRem,
    heartbeatMonitor,
    journal,
    decay: require('./components/fragments/decay.cjs'),
    lathe,
    wire,
    switchboard,
    config: sessionConfig,
  });

  // -------------------------------------------------------------------------
  // Phase 12: Historical data backfill pipeline (FRG-10)
  // -------------------------------------------------------------------------

  const backfillPipeline = createBackfillPipeline({
    formationPipeline, selfModel, switchboard, lathe, config: sessionConfig,
  });

  // -------------------------------------------------------------------------
  // Phase 11: Wire heartbeat monitor to Switchboard for Tier 2 trigger
  // -------------------------------------------------------------------------

  // Heartbeat timeout triggers Tier 2 provisional REM
  switchboard.on('reverie:heartbeat:timeout', function () {
    // Trigger Tier 2 provisional REM
    const sessionContext = {
      summary: {},
      fragments: [],
      recallEvents: [],
      metrics: {},
      domainData: { domainPairs: [], entityList: [], associationStats: [] },
    };
    remConsolidator.handleTier2(sessionContext).catch(function (_e) {
      // Tier 2 failure is non-fatal
    });
  });

  // Heartbeat resumption aborts in-progress Tier 2 (D-03: abort-and-revert)
  switchboard.on('reverie:heartbeat:received', function () {
    if (provisionalRem.isRunning()) {
      remConsolidator.abortTier2().catch(function (_e) {
        // Abort failure is non-fatal
      });
    }
  });

  // -------------------------------------------------------------------------
  // Phase 10 Gap Closure: Wire Secondary face prompt authority pipeline
  // -------------------------------------------------------------------------

  // 1. Listen for session state changes to toggle Secondary authority.
  //    When Session Manager transitions to passive or active, Secondary is running
  //    and is the face prompt authority (per D-04). When stopped, revert to local.
  switchboard.on('session:state-changed', function onSessionStateChanged(data) {
    if (!data) return;
    if (data.to === 'passive' || data.to === 'active') {
      // Secondary is running — it is the face prompt authority (per D-04)
      contextManager.setSecondaryActive(true);
    } else if (data.to === 'stopped') {
      // All sessions terminated — revert to local composition
      contextManager.setSecondaryActive(false);
    }
  });

  // 2. Subscribe Primary to Wire topology for face prompt updates from Secondary.
  //    wireTopology.subscribe filters by topology rules: Primary only receives from Secondary.
  //    DIRECTIVE envelopes with payload.role === 'face_prompt' are routed to
  //    contextManager.receiveSecondaryUpdate() to update the cached face prompt.
  wireTopology.subscribe('primary', 'primary', function onPrimaryMessage(envelope) {
    if (envelope.type === 'directive' && envelope.payload && envelope.payload.role === 'face_prompt') {
      contextManager.receiveSecondaryUpdate(envelope.payload.content);
    }
  });

  // -------------------------------------------------------------------------
  // Phase 12: CLI command registration (INT-02)
  // -------------------------------------------------------------------------

  if (typeof facade.registerCommand === 'function') {
    const cliContext = {
      modeManager, selfModel, formationPipeline, journal, wire,
      switchboard, fragmentWriter, lathe, dataDir: DATA_DIR_DEFAULT,
      backfillPipeline,
    };
    registerReverieCommands(facade, cliContext);
  }

  // Create hook handlers (lathe + dataDir needed for Stop snapshot writes)
  // Phase 9: formation pipeline and recall engine wired for formation triggers and recall injection
  // Phase 10: session manager, wire topology, and mode manager for three-session lifecycle
  // Phase 11: REM consolidator and heartbeat monitor for REM lifecycle
  const handlers = createHookHandlers({
    contextManager,
    switchboard,
    lathe,
    dataDir: DATA_DIR_DEFAULT,
    formationPipeline,
    recallEngine,
    lithograph,
    sessionManager,    // Phase 10
    wireTopology,      // Phase 10
    modeManager,       // Phase 10
    remConsolidator,   // Phase 11
    heartbeatMonitor,  // Phase 11
  });

  // Register all 8 hooks via Exciter integration surface (per D-09)
  // Exciter delegates to Armature's createHookRegistry internally.
  // wireToSwitchboard is called during Exciter's start() phase.
  const hookResult = exciter.registerHooks('reverie', {
    SessionStart: handlers.handleSessionStart,
    UserPromptSubmit: handlers.handleUserPromptSubmit,
    PreToolUse: handlers.handlePreToolUse,
    PostToolUse: handlers.handlePostToolUse,
    Stop: handlers.handleStop,
    PreCompact: handlers.handlePreCompact,
    SubagentStart: handlers.handleSubagentStart,
    SubagentStop: handlers.handleSubagentStop,
  });
  if (!hookResult.ok) {
    return { name: 'reverie', status: 'error', error: hookResult.error };
  }

  return {
    name: 'reverie',
    status: 'registered',
    hooks: hookResult.value,
    formation: true,
    recall: true,
    sessions: true,     // Phase 10: three-session architecture
    modes: true,        // Phase 10: operational mode management
    rem: {              // Phase 11: REM consolidation
      consolidator: remConsolidator,
      heartbeatMonitor,
    },
    taxonomy: taxonomyGovernor,    // Phase 12: taxonomy governance
    backfill: backfillPipeline,    // Phase 12: historical data backfill
    cli: true,                     // Phase 12: CLI commands registered
  };
}

module.exports = { register };
