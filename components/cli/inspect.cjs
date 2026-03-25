'use strict';

/**
 * Reverie CLI inspect subcommand handlers.
 *
 * Provides deep drill-down inspection into memory and personality state:
 *   - inspect fragment <id>  — full fragment with frontmatter + body
 *   - inspect domains        — all domains with fragment counts and hierarchy
 *   - inspect associations   — association graph around an entity
 *   - inspect self-model     — complete Self Model (all three aspects)
 *   - inspect identity       — Identity Core aspect only
 *   - inspect relational     — Relational Model aspect only
 *   - inspect conditioning   — Conditioning aspect only
 *
 * Per INT-02 D-02: Full drill-down via subcommands across memory and personality.
 * Per Pitfall 1: Each subcommand registered separately (no catch-all).
 *
 * @module reverie/components/cli/inspect
 */

const { ok, err } = require('../../../../lib/result.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats an object for human-readable output with key-value lines.
 *
 * @param {Object} obj - Object to format
 * @param {string} [indent=''] - Indentation prefix
 * @returns {string} Formatted string
 */
function formatObject(obj, indent) {
  indent = indent || '';
  if (!obj || typeof obj !== 'object') {
    return indent + String(obj);
  }

  const lines = [];
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      lines.push(indent + key + ':');
      lines.push(formatObject(val, indent + '  '));
    } else if (Array.isArray(val)) {
      lines.push(indent + key + ': [' + val.join(', ') + ']');
    } else {
      lines.push(indent + key + ': ' + String(val));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates inspect subcommand handlers.
 *
 * @param {Object} context - Handler context
 * @param {Object|null} context.selfModel - Self Model for aspect inspection
 * @param {Object|null} context.journal - Journal provider for fragment reads
 * @param {Object|null} context.wire - Wire service for domain and association queries
 * @param {Object|null} context.switchboard - Switchboard service
 * @returns {Readonly<Object>} Frozen object with all 7 handler functions
 */
function createInspectHandlers(context) {
  const { selfModel, journal, wire } = context || {};

  // -----------------------------------------------------------------------
  // inspect fragment <id>
  // -----------------------------------------------------------------------

  /**
   * Inspects a specific fragment by ID. Returns full frontmatter and body.
   *
   * @param {string[]} args - [fragmentId]
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handleInspectFragment(args, flags) {
    const id = args && args[0];
    if (!id) {
      return err('MISSING_ID', 'Usage: dynamo reverie inspect fragment <id>');
    }

    if (!journal || typeof journal.read !== 'function') {
      return err('NO_JOURNAL', 'Journal provider not available');
    }

    const readResult = journal.read(id);
    if (!readResult || !readResult.ok) {
      return err('FRAGMENT_NOT_FOUND', 'Fragment "' + id + '" not found');
    }

    const fragment = readResult.value;
    const data = {
      frontmatter: fragment.frontmatter,
      body: fragment.body,
    };

    // Human format: frontmatter key-value pairs then body
    const humanLines = ['Fragment: ' + id, '---'];
    if (fragment.frontmatter) {
      humanLines.push(formatObject(fragment.frontmatter));
    }
    humanLines.push('---');
    humanLines.push(fragment.body || '');

    return ok({
      human: humanLines.join('\n'),
      json: data,
      raw: JSON.stringify(data),
    });
  }

  // -----------------------------------------------------------------------
  // inspect domains
  // -----------------------------------------------------------------------

  /**
   * Lists all domains with fragment counts, hierarchy, and archived status.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Array, raw: string}>}
   */
  function handleInspectDomains(args, flags) {
    let domains = [];

    if (wire && typeof wire.query === 'function') {
      const queryResult = wire.query('domains');
      if (queryResult && queryResult.ok && Array.isArray(queryResult.value)) {
        domains = queryResult.value;
      }
    }

    // Human format: tabular listing
    const header = 'ID          | Name            | Fragments | Status   | Parent';
    const sep =    '----------- | --------------- | --------- | -------- | ------';
    const rows = [header, sep];

    for (let i = 0; i < domains.length; i++) {
      const d = domains[i];
      const status = d.archived ? 'archived' : 'active';
      const parent = d.parent_domain_id || '-';
      rows.push(
        (d.id || '-').padEnd(11) + ' | ' +
        (d.name || '-').padEnd(15) + ' | ' +
        String(d.fragment_count || 0).padEnd(9) + ' | ' +
        status.padEnd(8) + ' | ' +
        parent
      );
    }

    if (domains.length === 0) {
      rows.push('(no domains)');
    }

    return ok({
      human: rows.join('\n'),
      json: domains,
      raw: JSON.stringify(domains),
    });
  }

  // -----------------------------------------------------------------------
  // inspect associations <entity>
  // -----------------------------------------------------------------------

  /**
   * Shows association graph edges around a named entity.
   *
   * @param {string[]} args - [entityName]
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Array, raw: string}>}
   */
  function handleInspectAssociations(args, flags) {
    const entity = args && args[0];
    if (!entity) {
      return err('MISSING_ENTITY', 'Usage: dynamo reverie inspect associations <entity>');
    }

    let edges = [];

    if (wire && typeof wire.query === 'function') {
      const queryResult = wire.query('associations');
      if (queryResult && queryResult.ok && Array.isArray(queryResult.value)) {
        // Filter to edges involving the entity
        edges = queryResult.value.filter(function (e) {
          return e.source === entity || e.target === entity;
        });
      }
    }

    // Human format: edge list with arrows
    const lines = ['Associations for: ' + entity, ''];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      lines.push('  ' + e.source + ' -> ' + e.target + ': weight=' + e.weight + ', co_occurrences=' + e.co_occurrence_count);
    }

    if (edges.length === 0) {
      lines.push('  (no associations found)');
    }

    return ok({
      human: lines.join('\n'),
      json: edges,
      raw: JSON.stringify(edges),
    });
  }

  // -----------------------------------------------------------------------
  // inspect self-model (all three aspects)
  // -----------------------------------------------------------------------

  /**
   * Shows complete Self Model state across all three aspects.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handleInspectSelfModel(args, flags) {
    const identity = selfModel ? selfModel.getAspect('identity-core') : null;
    const relational = selfModel ? selfModel.getAspect('relational-model') : null;
    const conditioning = selfModel ? selfModel.getAspect('conditioning') : null;

    const data = {
      identity: identity,
      relational: relational,
      conditioning: conditioning,
    };

    // Human format: section headers with key-value pairs
    const lines = ['Self Model State', '================', ''];

    lines.push('--- Identity Core ---');
    lines.push(identity ? formatObject(identity, '  ') : '  (not loaded)');
    lines.push('');

    lines.push('--- Relational Model ---');
    lines.push(relational ? formatObject(relational, '  ') : '  (not loaded)');
    lines.push('');

    lines.push('--- Conditioning ---');
    lines.push(conditioning ? formatObject(conditioning, '  ') : '  (not loaded)');

    return ok({
      human: lines.join('\n'),
      json: data,
      raw: JSON.stringify(data),
    });
  }

  // -----------------------------------------------------------------------
  // inspect identity
  // -----------------------------------------------------------------------

  /**
   * Shows Identity Core aspect only.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handleInspectIdentity(args, flags) {
    const aspect = selfModel ? selfModel.getAspect('identity-core') : null;

    const lines = ['Identity Core', '=============', ''];
    lines.push(aspect ? formatObject(aspect, '  ') : '  (not loaded)');

    return ok({
      human: lines.join('\n'),
      json: aspect || {},
      raw: JSON.stringify(aspect),
    });
  }

  // -----------------------------------------------------------------------
  // inspect relational
  // -----------------------------------------------------------------------

  /**
   * Shows Relational Model aspect only.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handleInspectRelational(args, flags) {
    const aspect = selfModel ? selfModel.getAspect('relational-model') : null;

    const lines = ['Relational Model', '================', ''];
    lines.push(aspect ? formatObject(aspect, '  ') : '  (not loaded)');

    return ok({
      human: lines.join('\n'),
      json: aspect || {},
      raw: JSON.stringify(aspect),
    });
  }

  // -----------------------------------------------------------------------
  // inspect conditioning
  // -----------------------------------------------------------------------

  /**
   * Shows Conditioning aspect only.
   *
   * @param {string[]} args - Positional arguments (unused)
   * @param {Object} flags - Command flags (unused)
   * @returns {import('../../../../lib/result.cjs').Result<{human: string, json: Object, raw: string}>}
   */
  function handleInspectConditioning(args, flags) {
    const aspect = selfModel ? selfModel.getAspect('conditioning') : null;

    const lines = ['Conditioning', '============', ''];
    lines.push(aspect ? formatObject(aspect, '  ') : '  (not loaded)');

    return ok({
      human: lines.join('\n'),
      json: aspect || {},
      raw: JSON.stringify(aspect),
    });
  }

  // -----------------------------------------------------------------------
  // Return frozen handler set
  // -----------------------------------------------------------------------

  return Object.freeze({
    handleInspectFragment: handleInspectFragment,
    handleInspectDomains: handleInspectDomains,
    handleInspectAssociations: handleInspectAssociations,
    handleInspectSelfModel: handleInspectSelfModel,
    handleInspectIdentity: handleInspectIdentity,
    handleInspectRelational: handleInspectRelational,
    handleInspectConditioning: handleInspectConditioning,
  });
}

module.exports = { createInspectHandlers };
