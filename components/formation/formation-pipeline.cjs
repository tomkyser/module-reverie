'use strict';

/**
 * Formation pipeline orchestrator -- end-to-end fragment formation.
 *
 * Coordinates the full formation cycle:
 * 1. Prepare stimulus packages from hook payloads and session context
 * 2. Process subagent formation output (parse, validate, assemble)
 * 3. Populate master association index tables (domains, entities, attention_tags)
 *    via Wire upserts BEFORE writing fragments (Research Pitfall 5)
 * 4. Write validated fragments via FragmentWriter
 * 5. Deliver nudges via NudgeManager for passive recall injection
 *
 * Per D-16: Formation behavior is defined by prompt templates, not code paths.
 * This orchestrator handles the scaffolding (spawn, receive, validate, write)
 * while the cognition layer (prompt-templates.cjs) defines what formation produces.
 *
 * Per Research Pitfall 5: Master association tables (domains, entities, attention_tags)
 * must be populated BEFORE fragment join table writes to prevent FK gaps.
 *
 * @module reverie/components/formation/formation-pipeline
 */

const crypto = require('node:crypto');
const { ok, err } = require('../../../../lib/result.cjs');
const { FORMATION_DEFAULTS, DATA_DIR_DEFAULT } = require('../../lib/constants.cjs');
const { createAttentionGate } = require('./attention-gate.cjs');
const { createFragmentAssembler } = require('./fragment-assembler.cjs');
const { createNudgeManager } = require('./nudge-manager.cjs');
const { FORMATION_TEMPLATES } = require('./prompt-templates.cjs');
const { createEnvelope, MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../core/services/wire/protocol.cjs');

/**
 * Creates a formation pipeline instance with options-based DI.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.fragmentWriter - FragmentWriter instance (required)
 * @param {Object} options.selfModel - Self Model manager (required)
 * @param {Object} options.lathe - Lathe service for file I/O (required)
 * @param {Object} options.wire - Wire service for master table upserts (required)
 * @param {Object} [options.switchboard] - Switchboard for event emission
 * @param {Object} [options.assay] - Assay for passive recall during formation
 * @param {string} [options.dataDir] - Data directory path (default DATA_DIR_DEFAULT)
 * @returns {{ prepareStimulus: Function, processFormationOutput: Function, getFormationStats: Function }}
 */
function createFormationPipeline(options) {
  const opts = options || {};
  const fragmentWriter = opts.fragmentWriter;
  const selfModel = opts.selfModel;
  const lathe = opts.lathe;
  const wire = opts.wire;
  const switchboard = opts.switchboard;
  const assay = opts.assay;
  const dataDir = opts.dataDir || DATA_DIR_DEFAULT;

  // Internal component creation
  const _attentionGate = createAttentionGate({});
  const _assembler = createFragmentAssembler({});
  const _nudgeManager = createNudgeManager({ lathe, dataDir });
  const _templates = FORMATION_TEMPLATES;

  // Internal state
  let _totalFormed = 0;
  let _sessionFormed = 0;
  let _lastFormationTime = null;

  // ---------------------------------------------------------------------------
  // prepareStimulus
  // ---------------------------------------------------------------------------

  /**
   * Prepares a stimulus package from a hook payload and session context.
   *
   * Reads Self Model aspects synchronously via getAspect, optionally performs
   * passive recall for formation context via Assay.
   *
   * @param {Object} hookPayload - Raw hook payload
   * @param {string} hookPayload.user_prompt - User's prompt text
   * @param {Object} sessionContext - Session metadata
   * @param {string[]} [sessionContext.recentTools] - Recently used tools
   * @param {number} [sessionContext.position] - Session position
   * @param {number} [sessionContext.turnNumber] - Turn sequence number
   * @param {string} [sessionContext.userName] - User's name
   * @param {string} [sessionContext.sessionId] - Session identifier
   * @returns {Object} Stimulus package
   */
  function prepareStimulus(hookPayload, sessionContext) {
    const hp = hookPayload || {};
    const sc = sessionContext || {};

    // Read Self Model aspects synchronously
    const identity = selfModel.getAspect('identity-core');
    const relational = selfModel.getAspect('relational-model');
    const conditioning = selfModel.getAspect('conditioning');

    // Passive recall during formation is async -- skip for synchronous path
    // If assay is provided, caller can do async recall separately
    const recalled = [];

    return {
      turn_context: {
        user_prompt: hp.user_prompt || '',
        tools_used: sc.recentTools || [],
        session_position: sc.position || 0,
        turn_number: sc.turnNumber || 0,
      },
      self_model: {
        identity_summary: identity ? identity.body : '',
        relational_summary: relational ? relational.body : '',
        conditioning_summary: conditioning ? conditioning.body : '',
      },
      recalled_fragments: recalled,
      user_name: sc.userName || 'the user',
      session_id: sc.sessionId || 'unknown',
    };
  }

  // ---------------------------------------------------------------------------
  // Association master table population (Research Pitfall 5)
  // ---------------------------------------------------------------------------

  /**
   * Populates master association index tables via Wire upserts.
   *
   * Collects ALL unique domain names, entity names, and attention tag names
   * across all fragments in the formation batch. Queues INSERT OR IGNORE
   * upserts to master tables BEFORE fragment writes.
   *
   * @param {Array<Object>} fragments - Fragment data from formation output
   * @param {string} sessionId - Current session ID
   */
  function _populateMasterTables(fragments, sessionId) {
    const allDomains = new Set();
    const allEntities = new Set();
    const allTags = new Set();

    for (const frag of fragments) {
      if (Array.isArray(frag.domains)) {
        for (const d of frag.domains) allDomains.add(d);
      }
      if (Array.isArray(frag.entities)) {
        for (const e of frag.entities) allEntities.add(e);
      }
      if (Array.isArray(frag.attention_tags)) {
        for (const t of frag.attention_tags) allTags.add(t);
      }
    }

    const now = new Date().toISOString();
    const from = sessionId || 'reverie';

    // Upsert domains
    if (allDomains.size > 0) {
      const domainData = [];
      for (const domainName of allDomains) {
        domainData.push({ id: domainName, name: domainName, created: now, fragment_count: 1 });
      }
      const domainEnvelope = createEnvelope({
        type: MESSAGE_TYPES.WRITE_INTENT,
        from,
        to: 'ledger',
        payload: { table: 'domains', data: domainData, upsert: true },
        urgency: URGENCY_LEVELS.ACTIVE,
      });
      if (domainEnvelope.ok) {
        wire.queueWrite(domainEnvelope.value);
      }
    }

    // Upsert entities
    if (allEntities.size > 0) {
      const entityData = [];
      for (const entityName of allEntities) {
        entityData.push({ id: entityName, name: entityName, type: 'auto', created: now });
      }
      const entityEnvelope = createEnvelope({
        type: MESSAGE_TYPES.WRITE_INTENT,
        from,
        to: 'ledger',
        payload: { table: 'entities', data: entityData, upsert: true },
        urgency: URGENCY_LEVELS.ACTIVE,
      });
      if (entityEnvelope.ok) {
        wire.queueWrite(entityEnvelope.value);
      }
    }

    // Upsert attention tags
    if (allTags.size > 0) {
      const tagData = [];
      for (const tagName of allTags) {
        tagData.push({ id: tagName, tag: tagName, created: now });
      }
      const tagEnvelope = createEnvelope({
        type: MESSAGE_TYPES.WRITE_INTENT,
        from,
        to: 'ledger',
        payload: { table: 'attention_tags', data: tagData, upsert: true },
        urgency: URGENCY_LEVELS.ACTIVE,
      });
      if (tagEnvelope.ok) {
        wire.queueWrite(tagEnvelope.value);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // processFormationOutput
  // ---------------------------------------------------------------------------

  /**
   * Processes raw subagent formation output into validated fragments.
   *
   * Flow:
   * 1. Parse via assembler.parseFormationOutput
   * 2. If should_form is false, return { formed: 0 }
   * 3. Cap fragments at FORMATION_DEFAULTS.max_fragments_per_stimulus
   * 4. Generate fragment IDs and formation group ID
   * 5. Populate master association tables (Research Pitfall 5)
   * 6. Build frontmatter and write each fragment via FragmentWriter
   * 7. Write nudge if present
   * 8. Emit formation:complete event
   *
   * @param {string} rawOutput - Raw text output from formation subagent
   * @param {Object} sessionContext - Session metadata
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ formed: number, total: number, formationGroup: string }>>}
   */
  async function processFormationOutput(rawOutput, sessionContext) {
    const sc = sessionContext || {};

    // 1. Parse output
    const parsed = _assembler.parseFormationOutput(rawOutput);

    // 2. Check should_form
    if (parsed.should_form === false) {
      return ok({ formed: 0 });
    }

    // Guard against missing fragments
    if (!Array.isArray(parsed.fragments) || parsed.fragments.length === 0) {
      return ok({ formed: 0 });
    }

    // 3. Cap fragments
    const cappedFragments = parsed.fragments.slice(0, FORMATION_DEFAULTS.max_fragments_per_stimulus);

    // 4. Generate IDs and formation group
    const siblingIds = cappedFragments.map(() => fragmentWriter.generateFragmentId());
    const formationGroup = FORMATION_DEFAULTS.formation_group_prefix +
      crypto.randomUUID().replace(/-/g, '').slice(0, 8);

    // 5. Populate master association tables BEFORE writing fragments (Pitfall 5)
    _populateMasterTables(cappedFragments, sc.sessionId);

    // 6. Build frontmatter and write each fragment
    let successCount = 0;
    for (let i = 0; i < cappedFragments.length; i++) {
      const frag = cappedFragments[i];
      const siblings = siblingIds.filter((_, j) => j !== i);

      const frontmatter = _assembler.buildFrontmatter(frag, {
        id: siblingIds[i],
        formationGroup,
        siblings,
        sessionContext: {
          sessionId: sc.sessionId || 'unknown',
          selfModelVersion: sc.selfModelVersion,
          sessionStart: sc.sessionStart,
          sessionPosition: sc.sessionPosition,
          turnNumber: sc.turnNumber,
          trigger: sc.trigger || 'user_prompt',
        },
      });

      const writeResult = await fragmentWriter.writeFragment(frontmatter, frag.body);
      if (writeResult.ok) {
        successCount++;
        _totalFormed++;
        _sessionFormed++;
        _lastFormationTime = Date.now();
      }
    }

    // 7. Write nudge if present
    if (parsed.nudge) {
      await _nudgeManager.writeNudge(parsed.nudge);
    }

    // 8. Emit event
    if (switchboard) {
      switchboard.emit('reverie:formation:complete', {
        formed: successCount,
        formationGroup,
      });
    }

    return ok({
      formed: successCount,
      total: cappedFragments.length,
      formationGroup,
    });
  }

  // ---------------------------------------------------------------------------
  // getFormationStats
  // ---------------------------------------------------------------------------

  /**
   * Returns formation statistics for the current pipeline instance.
   *
   * @returns {{ totalFormed: number, sessionFormed: number, lastFormationTime: number|null }}
   */
  function getFormationStats() {
    return {
      totalFormed: _totalFormed,
      sessionFormed: _sessionFormed,
      lastFormationTime: _lastFormationTime,
    };
  }

  return Object.freeze({
    prepareStimulus,
    processFormationOutput,
    getFormationStats,
  });
}

module.exports = { createFormationPipeline };
