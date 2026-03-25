'use strict';

/**
 * Reverie CLI command registration orchestrator.
 *
 * Registers all Reverie CLI subcommands via Circuit's registerCommand(),
 * which auto-prefixes with the module name ('reverie') for Pulley routing.
 *
 * Registered command groups:
 * - status: Operational dashboard per D-01
 * - inspect: Deep drill-down (fragment, domains, associations, self-model, identity, relational, conditioning) per D-02
 * - history: Timeline lenses (sessions, fragments, consolidations) per D-03
 * - reset: Scoped resets with --confirm gate per D-04
 *
 * Per Pitfall 1: Each subcommand registered individually (no catch-all).
 *
 * @module reverie/components/cli/register-commands
 */

const { ok, err } = require('../../../../lib/result.cjs');
const { createStatusHandler } = require('./status.cjs');
const { createInspectHandlers } = require('./inspect.cjs');
const { createHistoryHandlers } = require('./history.cjs');
const { createResetHandlers } = require('./reset.cjs');

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers all Reverie CLI commands with the Circuit API.
 *
 * @param {Object} circuitApi - Scoped Circuit API with registerCommand()
 * @param {Object} context - Reverie component context
 * @param {Object|null} context.modeManager - Mode Manager
 * @param {Object|null} context.selfModel - Self Model
 * @param {Object|null} context.journal - Journal provider
 * @param {Object|null} context.switchboard - Switchboard service
 * @param {Object|null} context.wire - Wire service
 * @param {Object|null} context.formationPipeline - Formation pipeline
 * @param {Object|null} context.fragmentWriter - FragmentWriter instance
 * @param {Object|null} context.lathe - Lathe filesystem service
 * @param {string} context.dataDir - Reverie data directory path
 * @returns {import('../../../../lib/result.cjs').Result<{registered: number}>}
 */
function registerReverieCommands(circuitApi, context) {
  let registered = 0;

  // ---- status (D-01) ----
  const statusHandler = createStatusHandler(context);
  circuitApi.registerCommand('status', statusHandler.handle, {
    description: 'Show Reverie operational dashboard',
  });
  registered++;

  // ---- inspect subcommands (7 total, per D-02) ----
  const inspectHandlers = createInspectHandlers(context);

  circuitApi.registerCommand('inspect fragment', inspectHandlers.handleInspectFragment, {
    description: 'Inspect a specific fragment',
  });
  registered++;

  circuitApi.registerCommand('inspect domains', inspectHandlers.handleInspectDomains, {
    description: 'List all domains with fragment counts',
  });
  registered++;

  circuitApi.registerCommand('inspect associations', inspectHandlers.handleInspectAssociations, {
    description: 'Show association graph around an entity',
  });
  registered++;

  circuitApi.registerCommand('inspect self-model', inspectHandlers.handleInspectSelfModel, {
    description: 'Show complete Self Model state',
  });
  registered++;

  circuitApi.registerCommand('inspect identity', inspectHandlers.handleInspectIdentity, {
    description: 'Show Identity Core aspect',
  });
  registered++;

  circuitApi.registerCommand('inspect relational', inspectHandlers.handleInspectRelational, {
    description: 'Show Relational Model aspect',
  });
  registered++;

  circuitApi.registerCommand('inspect conditioning', inspectHandlers.handleInspectConditioning, {
    description: 'Show Conditioning aspect',
  });
  registered++;

  // ---- history subcommands (D-03) ----
  const historyHandlers = createHistoryHandlers(context);

  circuitApi.registerCommand('history sessions', historyHandlers.handleHistorySessions, {
    description: 'Chronological session list',
  });
  registered++;

  circuitApi.registerCommand('history fragments', historyHandlers.handleHistoryFragments, {
    description: 'Fragment formation timeline',
  });
  registered++;

  circuitApi.registerCommand('history consolidations', historyHandlers.handleHistoryConsolidations, {
    description: 'REM consolidation events',
  });
  registered++;

  // ---- reset subcommands (D-04) ----
  const resetHandlers = createResetHandlers(context);

  circuitApi.registerCommand('reset fragments', resetHandlers.handleResetFragments, {
    description: 'Wipe all fragments, keep Self Model',
  });
  registered++;

  circuitApi.registerCommand('reset self-model', resetHandlers.handleResetSelfModel, {
    description: 'Reinitialize Self Model from cold start',
  });
  registered++;

  circuitApi.registerCommand('reset all', resetHandlers.handleResetAll, {
    description: 'Full factory reset',
  });
  registered++;

  // ---- backfill command (FRG-10, Phase 12) ----
  if (context.backfillPipeline) {
    circuitApi.registerCommand('backfill', async function handleBackfill(args, flags) {
      const filePath = args[0];
      if (!filePath) {
        return err('MISSING_PATH', 'Usage: dynamo reverie backfill <path-to-export.json> [--dry-run] [--limit N] [--batch-size N]');
      }

      // Read the export file
      const fileContent = context.lathe ? context.lathe.readFileSync(filePath) : null;
      if (!fileContent) {
        return err('FILE_NOT_FOUND', 'Could not read file: ' + filePath);
      }

      const isDryRun = process.argv.includes('--dry-run');
      const limitIdx = process.argv.indexOf('--limit');
      const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : null;
      const batchIdx = process.argv.indexOf('--batch-size');
      const batchSize = batchIdx >= 0 ? parseInt(process.argv[batchIdx + 1], 10) : undefined;

      if (isDryRun) {
        var dryResult = context.backfillPipeline.dryRun(fileContent);
        if (!dryResult.ok) return dryResult;
        return ok({
          human: 'Dry run: ' + dryResult.value.conversations + ' conversations, ' + dryResult.value.user_turns + ' user turns, ~' + dryResult.value.estimated_fragments + ' estimated fragments',
          json: dryResult.value,
          raw: JSON.stringify(dryResult.value),
        });
      }

      var result = await context.backfillPipeline.runBatch(fileContent, { limit: limit, batchSize: batchSize });
      if (!result.ok) return result;
      return ok({
        human: 'Backfill complete: ' + result.value.conversations_processed + ' conversations, ' + result.value.fragments_formed + ' fragments formed',
        json: result.value,
        raw: JSON.stringify(result.value),
      });
    }, { description: 'Import historical conversation data' });
    registered++;
  }

  return ok({ registered: registered });
}

module.exports = { registerReverieCommands };
