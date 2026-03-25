'use strict';

/**
 * Hook handler implementations for all 8 Claude Code hook types.
 *
 * Thin dispatch layer: each handler delegates to Context Manager methods
 * and formats the response according to the Claude Code hook output contract.
 *
 * Per Research Pitfall 1: ALL context injection uses `additionalContext`
 * inside `hookSpecificOutput`, NEVER `systemMessage` (which is a user-facing
 * warning field, not a model context injection field).
 *
 * Per Research Pattern 3: Hook handlers are thin dispatch -- business logic
 * lives in Context Manager, handlers just wire hook payloads to CM methods
 * and format the response.
 *
 * @module reverie/hooks/hook-handlers
 */

const path = require('node:path');
const { MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../core/services/wire/protocol.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Recall keyword regex for explicit recall trigger detection.
 * When a user prompt matches any of these patterns, explicit recall is invoked.
 * @type {RegExp}
 */
const RECALL_KEYWORDS = /\b(remember when|recall|what do you remember|do you remember)\b/i;

/**
 * Agent name for the formation background subagent.
 * Used to filter SubagentStop events and only process formation output.
 * @type {string}
 */
const FORMATION_AGENT_NAME = 'reverie-formation';

/**
 * Well-known directory paths for stimulus/output file coordination.
 * @type {string}
 */
const FORMATION_STIMULUS_DIR = 'data/formation/stimulus';
const FORMATION_OUTPUT_DIR = 'data/formation/output';

/**
 * Compaction framing text injected via PreCompact additionalContext.
 * Per D-09: best-effort framing guidance for how compaction should summarize.
 * @type {string}
 */
const COMPACTION_FRAMING = [
  'When summarizing this conversation, preserve the following as high priority:',
  '1. The Self Model identity frame and personality directives (they define WHO the assistant is)',
  '2. The user\'s current intent and active task context',
  '3. Active attention priorities and domain focus',
  '',
  'Summarize through the lens of current attention priorities. Discard raw source content that can be re-retrieved.',
].join('\n');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates hook handler implementations for all 8 Claude Code hook types.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.contextManager - Context Manager instance
 * @param {Object} options.switchboard - Switchboard for event emission
 * @param {Object} options.lathe - Lathe service for file writes
 * @param {string} options.dataDir - Data directory for session snapshots
 * @param {Object} [options.sessionManager] - Phase 10: Session Manager for lifecycle ops
 * @param {Object} [options.wireTopology] - Phase 10: Wire topology for inter-session messaging
 * @param {Object} [options.modeManager] - Phase 10: Mode Manager for operational mode
 * @param {Object} [options.remConsolidator] - Phase 11: REM Consolidator for tiered consolidation
 * @param {Object} [options.heartbeatMonitor] - Phase 11: Heartbeat monitor for Tier 2 detection
 * @returns {Object} Object with 8 handler functions
 */
function createHookHandlers(options) {
  const { contextManager, switchboard, lathe, dataDir } = options || {};
  const formationPipeline = (options && options.formationPipeline) || null;
  const recallEngine = (options && options.recallEngine) || null;
  const lithograph = (options && options.lithograph) || null;
  const sessionManager = (options && options.sessionManager) || null;
  const wireTopology = (options && options.wireTopology) || null;
  const modeManager = (options && options.modeManager) || null;
  const remConsolidator = (options && options.remConsolidator) || null;
  const heartbeatMonitor = (options && options.heartbeatMonitor) || null;

  // Resolve ~ to HOME for dataDir
  const resolvedDataDir = dataDir && dataDir.startsWith('~')
    ? path.join(process.env.HOME || '/tmp', dataDir.slice(1))
    : (dataDir || '/tmp');

  // -------------------------------------------------------------------------
  // Handler implementations
  // -------------------------------------------------------------------------

  /**
   * SessionStart hook handler.
   *
   * - Normal start/resume: calls contextManager.init() (warm-start or cold-start)
   * - Post-compaction (source='compact'): calls contextManager.resetAfterCompaction()
   * - Returns face prompt as additionalContext for immediate personality injection
   *
   * @param {Object} payload - Hook payload
   * @param {string} [payload.source] - 'compact' if post-compaction restart
   * @returns {Promise<Object>} Hook output with additionalContext
   */
  async function handleSessionStart(payload) {
    // Per D-03: Inject session-scoped transcript_path into Lithograph
    // so all subsequent read/write/query ops target this session's transcript.
    // transcript_path comes from Claude Code hook stdin JSON payload.
    if (lithograph && payload && payload.transcript_path) {
      lithograph.setTranscriptPath(payload.transcript_path);
    }

    if (payload && payload.source === 'compact') {
      await contextManager.resetAfterCompaction();
    } else {
      await contextManager.init();
    }

    const injection = contextManager.getInjection();

    if (switchboard) {
      switchboard.emit('reverie:hook:session-start', {
        source: (payload && payload.source) || 'new',
      });
    }

    // Phase 10: Start Session Manager (spawns Secondary, enters Passive mode)
    // Fire-and-forget -- don't block hook return
    if (sessionManager) {
      sessionManager.start().catch(function (_e) {
        // Session Manager start failure is non-fatal for the hook
      });
    }

    // Phase 11: Crash recovery -- detect orphaned working/ fragments from prior sessions
    if (remConsolidator) {
      const sessionId = (payload && payload.session_id) || 'reverie';
      remConsolidator.handleCrashRecovery(sessionId).catch(function (_e) {
        // Crash recovery failure is non-fatal for the hook
      });
    }

    // Phase 11: Dormant maintenance -- decay catch-up on session start per D-14/OPS-04
    // This is the trigger point for dormant maintenance. Decay is time-based so
    // retroactive computation on SessionStart produces the same result as scheduled runs.
    if (remConsolidator) {
      remConsolidator.handleDormantMaintenance().catch(function (_e) {
        // Dormant maintenance failure is non-fatal for the hook
      });
    }

    // Phase 11: Start heartbeat monitor for Tier 2 detection
    if (heartbeatMonitor) {
      heartbeatMonitor.start();
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: injection,
      },
    };
  }

  /**
   * UserPromptSubmit hook handler.
   *
   * Tracks prompt bytes + estimated model response bytes, increments turn,
   * returns the current face prompt as additionalContext.
   *
   * @param {Object} payload - Hook payload
   * @param {string} payload.user_prompt - The user's prompt text
   * @returns {Promise<Object>} Hook output with face prompt as additionalContext
   */
  async function handleUserPromptSubmit(payload) {
    const promptText = (payload && payload.user_prompt) || '';
    const promptBytes = Buffer.byteLength(promptText, 'utf8');

    // Track user prompt bytes
    contextManager.trackBytes(promptBytes, 'user_prompt');

    // Estimate model response (~1.5x prompt)
    contextManager.trackBytes(Math.ceil(promptBytes * 1.5), 'model_response_estimate');

    // Increment turn
    contextManager.incrementTurn();

    const injection = contextManager.getInjection();

    // --- Phase 9: Formation trigger ---
    // Per D-01: Spawn fire-and-forget background formation after each significant turn.
    // Formation pipeline prepares stimulus synchronously for the subagent.
    if (formationPipeline) {
      const sessionContext = {
        recentTools: [],
        position: 0,
        turnNumber: 0,
        userName: 'the user',
        sessionId: 'reverie',
      };
      try {
        formationPipeline.prepareStimulus(payload || {}, sessionContext);
      } catch (_e) {
        // Formation preparation failure is non-fatal -- log but continue
      }
    }

    // --- Phase 9: Nudge injection ---
    let nudgeText = null;
    if (contextManager.getNudge) {
      nudgeText = await contextManager.getNudge();
    }

    // --- Phase 9: Explicit recall ---
    let recallText = null;
    if (recallEngine && RECALL_KEYWORDS.test(promptText)) {
      try {
        const recallResult = await recallEngine.recallExplicit({
          domains: [],
          entities: [],
          attention_tags: [],
          user_prompt: promptText,
          turn_number: 0,
        });
        if (recallResult.ok && recallResult.value.reconstructionPrompt) {
          recallText = recallResult.value.reconstructionPrompt;
        }
      } catch (_e) {
        // Recall failure is non-fatal
      }
    }

    // --- Phase 10: Forward conversation snapshot to Secondary via Wire ---
    if (wireTopology && sessionManager && sessionManager.getState().state !== 'stopped') {
      try {
        wireTopology.send({
          from: 'primary',
          to: 'secondary',
          type: MESSAGE_TYPES.SNAPSHOT,
          urgency: URGENCY_LEVELS.ACTIVE,
          payload: {
            userPrompt: (payload && payload.user_prompt) || '',
            turnNumber: (payload && payload.turn_number) || 0,
            toolsUsed: (payload && payload.tools_used) || [],
          },
        }).catch(function (_e) {
          // Snapshot send failure is non-fatal
        });
      } catch (_e) {
        // Non-fatal
      }
    }

    // Phase 11: Send heartbeat to Secondary for Tier 2 idle detection per D-02
    if (wireTopology && sessionManager && sessionManager.getState().state !== 'stopped') {
      try {
        wireTopology.send({
          from: 'primary',
          to: 'secondary',
          type: MESSAGE_TYPES.HEARTBEAT,
          urgency: URGENCY_LEVELS.BACKGROUND,
          payload: { timestamp: Date.now() },
        }).catch(function (_e) {
          // Heartbeat send failure is non-fatal
        });
      } catch (_e) {
        // Non-fatal
      }
    }

    // Build combined additionalContext
    let combinedInjection = injection || '';
    if (nudgeText) {
      combinedInjection += '\n\n---\n[Inner impression: ' + nudgeText + ']';
    }
    if (recallText) {
      combinedInjection += '\n\n---\n[Memory reconstruction: ' + recallText + ']';
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: combinedInjection || injection,
      },
    };
  }

  /**
   * PreToolUse hook handler.
   *
   * Tracks bytes from tool input. No context injection on PreToolUse per D-11.
   *
   * @param {Object} payload - Hook payload
   * @param {string} payload.tool_name - Tool being invoked
   * @param {Object} payload.tool_input - Tool input parameters
   * @returns {Promise<Object>} Empty object (no injection)
   */
  async function handlePreToolUse(payload) {
    const inputStr = JSON.stringify((payload && payload.tool_input) || {});
    const inputBytes = Buffer.byteLength(inputStr, 'utf8');

    contextManager.trackBytes(inputBytes, 'tool_input');

    if (switchboard) {
      switchboard.emit('reverie:hook:pre-tool-use', {
        tool: payload && payload.tool_name,
      });
    }

    return {};
  }

  /**
   * PostToolUse hook handler.
   *
   * Tracks bytes from tool output. Returns micro-nudge as additionalContext
   * only when budget phase is 3 (reinforced) per D-08.
   *
   * @param {Object} payload - Hook payload
   * @param {string|Object} payload.tool_output - Tool execution output
   * @returns {Promise<Object>} Hook output with micro-nudge if Phase 3, empty otherwise
   */
  async function handlePostToolUse(payload) {
    const rawOutput = payload && payload.tool_output;
    const outputStr = typeof rawOutput === 'string'
      ? rawOutput
      : JSON.stringify(rawOutput || '');
    const outputBytes = Buffer.byteLength(outputStr, 'utf8');

    contextManager.trackBytes(outputBytes, 'tool_output');

    // --- Phase 9: Formation trigger for tool-heavy turns ---
    // Per CONTEXT.md: PostToolUse triggers formation for tool-heavy turns
    if (formationPipeline) {
      // Only trigger if there is meaningful tool output (not empty)
      if (outputStr.length > 100) {
        // Fire-and-forget
        try {
          const stimResult = formationPipeline.prepareStimulus(
            { user_prompt: '', tool_output: outputStr, tool_name: payload && payload.tool_name },
            { recentTools: [payload && payload.tool_name], sessionId: 'reverie' }
          );
        } catch (_e) {
          // Non-fatal
        }
      }
    }

    const nudge = contextManager.getMicroNudge();
    if (nudge) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: nudge,
        },
      };
    }

    return {};
  }

  /**
   * PreCompact hook handler.
   *
   * Saves checkpoint to Journal and injects compaction framing text.
   * Per D-09 + Research Pitfall 1: uses additionalContext, NOT systemMessage.
   *
   * @param {Object} payload - Hook payload
   * @returns {Promise<Object>} Hook output with compaction framing as additionalContext
   */
  async function handlePreCompact(payload) {
    await contextManager.checkpoint();

    // Phase 11: Tier 1 triage -- fast state snapshot per D-01
    if (remConsolidator) {
      try {
        const mindState = {
          attention_pointer: null, // Context Manager provides this
          working_fragments: [],   // Populated from Journal working/ listing
          sublimation_candidates: [],
          self_model_prompt_state: contextManager.getInjection ? contextManager.getInjection().slice(0, 100) : null,
        };
        remConsolidator.handleTier1(mindState).catch(function (_e) {
          // Tier 1 failure is non-fatal -- compaction still proceeds
        });
      } catch (_e) {
        // Non-fatal
      }
    }

    // Phase 10: Notify Secondary of compaction via Wire
    if (wireTopology) {
      try {
        wireTopology.send({
          from: 'primary',
          to: 'secondary',
          type: MESSAGE_TYPES.SNAPSHOT,
          urgency: URGENCY_LEVELS.URGENT,
          payload: { event: 'pre_compact' },
        }).catch(function (_e) {
          // Compaction notification failure is non-fatal
        });
      } catch (_e) {
        // Non-fatal
      }
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PreCompact',
        additionalContext: COMPACTION_FRAMING,
      },
    };
  }

  /**
   * Stop hook handler.
   *
   * Persists warm-start cache and writes session-end snapshot.
   * Per D-12: face prompt file IS the warm-start cache (dual-purpose).
   *
   * @param {Object} payload - Hook payload
   * @returns {Promise<Object>} Empty object (no injection on Stop)
   */
  async function handleStop(payload) {
    // Phase 11: Stop heartbeat monitor
    if (heartbeatMonitor) {
      heartbeatMonitor.stop();
    }

    // Phase 11: Transition to REM mode instead of direct stop per D-13, D-15
    // Stop hook must return quickly (Pitfall 6). REM runs asynchronously on Secondary.
    if (modeManager && sessionManager) {
      try {
        // Step 1: Request REM mode (stops Tertiary, keeps Secondary)
        await modeManager.requestRem('session_end');

        // Step 2: Transition Session Manager to REM_PROCESSING state
        // This stops Tertiary but keeps Secondary alive for REM
        await sessionManager.transitionToRem();

        // Step 3: Fire-and-forget Tier 3 REM on Secondary
        // Secondary will run REM, then call sessionManager.completeRem() and terminate itself
        if (remConsolidator) {
          // Build session context for REM
          const sessionContext = {
            summary: contextManager.getSessionSnapshot ? contextManager.getSessionSnapshot() : {},
            fragments: [],  // Populated from Journal working/ listing
            recallEvents: [],
            metrics: {},
            domainData: { domainPairs: [], entityList: [], associationStats: [] },
          };
          remConsolidator.handleTier3(sessionContext).then(function (_result) {
            // After REM completes, transition to Dormant
            if (modeManager) modeManager.requestDormant();
            if (sessionManager) sessionManager.completeRem();
          }).catch(function (_e) {
            // REM failure -- still complete the session
            if (sessionManager) sessionManager.completeRem().catch(function () {});
          });
        }
      } catch (_e) {
        // Fallback: if REM transition fails, do direct stop
        try { await sessionManager.stop(); } catch (__e) { }
      }
    } else if (sessionManager) {
      // No REM components -- fall back to Phase 10 direct stop behavior
      try { await sessionManager.stop(); } catch (_e) { }
    }

    // These still execute regardless of REM:
    await contextManager.persistWarmStart();

    const snapshot = contextManager.getSessionSnapshot();
    const snapshotPath = path.join(resolvedDataDir, 'data', 'session-end-' + Date.now() + '.json');
    await lathe.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

    if (switchboard) {
      switchboard.emit('reverie:hook:stop', { snapshot });
    }

    return {};
  }

  /**
   * SubagentStart hook handler.
   *
   * Tracks estimated bytes (~500) for subagent context overhead.
   *
   * @param {Object} payload - Hook payload
   * @returns {Promise<Object>} Empty object
   */
  async function handleSubagentStart(payload) {
    contextManager.trackBytes(500, 'subagent_start');

    if (switchboard) {
      switchboard.emit('reverie:hook:subagent-start', {
        subagent_id: payload && payload.subagent_id,
      });
    }

    return {};
  }

  /**
   * SubagentStop hook handler.
   *
   * Processes formation subagent output when the reverie-formation agent completes.
   * Per D-01: The formation subagent runs in the background and writes its
   * output (JSON with fragments + nudge) to a well-known output file. When
   * the subagent stops, this handler reads that output and routes it through
   * formationPipeline.processFormationOutput() which:
   *   1. Parses the JSON via fragment-assembler
   *   2. Populates association index master tables
   *   3. Writes validated fragments via FragmentWriter
   *   4. Writes nudge via nudge-manager
   *
   * Without this handler, prepareStimulus fires but nothing ever processes
   * the subagent's response -- no fragments are written, FRG-03 is incomplete.
   *
   * @param {Object} payload - Hook payload
   * @returns {Promise<Object>} Hook output
   */
  async function handleSubagentStop(payload) {
    contextManager.trackBytes(500, 'subagent_stop');

    // Only process output from the reverie-formation subagent
    const agentName = payload && payload.agent_name;
    if (agentName === FORMATION_AGENT_NAME && formationPipeline) {
      try {
        // Read the formation output file written by the subagent.
        // The output path follows the convention: {dataDir}/{FORMATION_OUTPUT_DIR}/latest-output.json
        const outputPath = path.join(
          resolvedDataDir, FORMATION_OUTPUT_DIR, 'latest-output.json'
        );

        // Read output file via lathe (injected dependency)
        const readResult = await lathe.readFile(outputPath);
        if (readResult && readResult.ok && readResult.value) {
          const rawOutput = readResult.value;

          // Build session context for formation processing
          const sessionContext = {
            sessionId: 'reverie',
            selfModelVersion: '0.0.0',
            sessionStart: new Date().toISOString(),
            sessionPosition: 0,
            turnNumber: 0,
            trigger: 'subagent_stop',
          };

          // Process the formation output: parse -> populate master tables -> write fragments -> write nudge
          const processResult = await formationPipeline.processFormationOutput(rawOutput, sessionContext);

          if (processResult && processResult.ok) {
            // Emit formation completion event for observability
            if (switchboard && switchboard.emit) {
              switchboard.emit('reverie:formation:subagent-complete', {
                formed: processResult.value.formed,
                formationGroup: processResult.value.formationGroup,
              });
            }
          }
        }
      } catch (_e) {
        // Formation output processing failure is non-fatal.
        // The formation pipeline handles its own error cases internally.
        // We catch here to prevent the hook from crashing the primary session.
      }

      return {
        hookSpecificOutput: {
          hookEventName: 'SubagentStop',
        },
      };
    }

    if (switchboard) {
      switchboard.emit('reverie:hook:subagent-stop', {
        subagent_id: payload && payload.subagent_id,
      });
    }

    return {};
  }

  return {
    handleSessionStart,
    handleUserPromptSubmit,
    handlePreToolUse,
    handlePostToolUse,
    handleStop,
    handlePreCompact,
    handleSubagentStart,
    handleSubagentStop,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { createHookHandlers };
