'use strict';

/**
 * History subcommand handlers for Reverie CLI (D-03).
 *
 * Provides three timeline lenses into Reverie's memory:
 * - sessions: Chronological session list with mode, fragment count, REM outcomes
 * - fragments: Fragment formation timeline filterable by domain/type
 * - consolidations: REM consolidation event timeline
 *
 * All handlers return { human, json, raw } for Pulley's three output modes.
 *
 * @module reverie/components/cli/history
 */

const { ok } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates history subcommand handlers with injected dependencies.
 *
 * @param {Object} context - Dependency injection context
 * @param {Object} context.journal - Journal provider (listFragments, listSessions)
 * @param {Object} context.wire - Wire service
 * @param {Object} context.switchboard - Switchboard for events
 * @returns {{ handleHistorySessions: Function, handleHistoryFragments: Function, handleHistoryConsolidations: Function }}
 */
function createHistoryHandlers(context) {
  const _journal = context.journal;

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Lists session history in chronological order (most recent first).
   *
   * Each session record includes: session_id, timestamp, mode, fragment_count,
   * rem_outcome (promoted/discarded), conditioning_drift.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Array, raw: string}>}
   */
  function handleHistorySessions(args, flags) {
    const sessionsResult = _journal.listSessions();
    if (!sessionsResult.ok) {
      return sessionsResult;
    }

    const sessions = sessionsResult.value.slice();

    // Sort by timestamp descending (most recent first)
    sessions.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return tb - ta;
    });

    // Build human-readable table
    const header = 'Date                     | Mode    | Fragments | REM (promoted/discarded) | Drift';
    const separator = '-'.repeat(header.length);
    const rows = sessions.map(s => {
      const date = s.timestamp;
      const mode = (s.mode || 'Unknown').padEnd(7);
      const frags = String(s.fragment_count).padStart(9);
      const rem = s.rem_outcome
        ? `${s.rem_outcome.promoted}/${s.rem_outcome.discarded}`
        : 'N/A';
      const drift = s.conditioning_drift != null ? s.conditioning_drift.toFixed(3) : 'N/A';
      return `${date} | ${mode} | ${frags} | ${rem.padEnd(24)} | ${drift}`;
    });

    const human = [header, separator, ...rows].join('\n');

    return ok({ human, json: sessions, raw: JSON.stringify(sessions) });
  }

  // -------------------------------------------------------------------------
  // Fragments
  // -------------------------------------------------------------------------

  /**
   * Lists fragment formation timeline, optionally filtered by domain or type.
   *
   * Supported flags (passed via flags object or process.argv):
   * - --domain <name>: Filter fragments containing this domain
   * - --type <name>: Filter fragments of this type
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (may contain domain, type)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Array, raw: string}>}
   */
  function handleHistoryFragments(args, flags) {
    const fragmentsResult = _journal.listFragments();
    if (!fragmentsResult.ok) {
      return fragmentsResult;
    }

    let fragments = fragmentsResult.value.slice();

    // Apply domain filter
    const domainFilter = flags.domain || null;
    if (domainFilter) {
      fragments = fragments.filter(f => {
        const domains = (f.associations && f.associations.domains) || [];
        return domains.includes(domainFilter);
      });
    }

    // Apply type filter
    const typeFilter = flags.type || null;
    if (typeFilter) {
      fragments = fragments.filter(f => f.type === typeFilter);
    }

    // Sort by created descending (most recent first)
    fragments.sort((a, b) => {
      const ta = new Date(a.created).getTime();
      const tb = new Date(b.created).getTime();
      return tb - ta;
    });

    // Map to output format
    const outputFragments = fragments.map(f => ({
      id: f.id,
      type: f.type,
      created: f.created,
      domains: (f.associations && f.associations.domains) || [],
      decay_weight: f.decay ? f.decay.current_weight : null,
      lifecycle: f._lifecycle || 'unknown',
    }));

    // Build human-readable list
    const header = 'Created                  | Type            | Domains                    | Weight | Lifecycle';
    const separator = '-'.repeat(header.length);
    const rows = outputFragments.map(f => {
      const created = f.created;
      const type = (f.type || 'unknown').padEnd(15);
      const domains = (f.domains.join(', ') || 'none').padEnd(26);
      const weight = f.decay_weight != null ? f.decay_weight.toFixed(2).padStart(6) : '  N/A ';
      const lifecycle = f.lifecycle;
      return `${created} | ${type} | ${domains} | ${weight} | ${lifecycle}`;
    });

    const human = [header, separator, ...rows].join('\n');

    return ok({ human, json: outputFragments, raw: JSON.stringify(outputFragments) });
  }

  // -------------------------------------------------------------------------
  // Consolidations
  // -------------------------------------------------------------------------

  /**
   * Lists REM consolidation events (consolidation-type fragments).
   *
   * Extracts formation trigger as the consolidation description.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Array, raw: string}>}
   */
  function handleHistoryConsolidations(args, flags) {
    const fragmentsResult = _journal.listFragments();
    if (!fragmentsResult.ok) {
      return fragmentsResult;
    }

    // Filter to consolidation-type only
    const consolidations = fragmentsResult.value
      .filter(f => f.type === 'consolidation')
      .map(f => ({
        id: f.id,
        created: f.created,
        trigger: (f.formation && f.formation.trigger) || 'Unknown',
        domains: (f.associations && f.associations.domains) || [],
        attention_tags: (f.associations && f.associations.attention_tags) || [],
      }));

    // Sort by created descending
    consolidations.sort((a, b) => {
      const ta = new Date(a.created).getTime();
      const tb = new Date(b.created).getTime();
      return tb - ta;
    });

    // Build human-readable timeline
    const header = 'Created                  | Trigger                                          | Domains';
    const separator = '-'.repeat(header.length);
    const rows = consolidations.map(c => {
      const created = c.created;
      const trigger = (c.trigger || '').padEnd(48);
      const domains = (c.domains.join(', ') || 'none');
      return `${created} | ${trigger} | ${domains}`;
    });

    const human = consolidations.length > 0
      ? [header, separator, ...rows].join('\n')
      : 'No consolidation events found.';

    return ok({ human, json: consolidations, raw: JSON.stringify(consolidations) });
  }

  return {
    handleHistorySessions,
    handleHistoryFragments,
    handleHistoryConsolidations,
  };
}

module.exports = { createHistoryHandlers };
