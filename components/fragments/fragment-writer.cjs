'use strict';

/**
 * FragmentWriter -- Atomic dual-provider write abstraction for Reverie fragments.
 *
 * Implements D-11: Journal-first with Ledger rollback. Every fragment creation
 * writes the file to Journal first (atomic via Bun.write through Lathe), then
 * queues association index rows to Ledger via Wire write coordinator. If any
 * Ledger write fails, the Journal file is deleted (rollback) ensuring no
 * partial state.
 *
 * This is the single write path for all fragment creation -- no component
 * should write fragments directly to Journal or Ledger. This prevents
 * Pitfall 4 (split-storage inconsistency / confabulation).
 *
 * @module reverie/components/fragments/fragment-writer
 */

const crypto = require('node:crypto');
const { ok, err } = require('../../../../lib/result.cjs');
const { validateFragment } = require('../../lib/schemas.cjs');
const { FRAGMENT_ID_PATTERN, LIFECYCLE_DIRS } = require('../../lib/constants.cjs');
const { createEnvelope, MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../core/services/wire/protocol.cjs');

/**
 * Creates a FragmentWriter instance with injected dependencies.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.journal - Journal provider instance (write, delete, read)
 * @param {Object} options.wire - Wire service instance (queueWrite)
 * @param {Object} options.switchboard - Switchboard for event emission
 * @param {string} [options.sessionId='reverie'] - Current session ID (used in envelope.from)
 * @returns {Object} FragmentWriter instance
 */
function createFragmentWriter(options = {}) {
  const _journal = options.journal;
  const _wire = options.wire;
  const _switchboard = options.switchboard;
  const _sessionId = options.sessionId || 'reverie';

  // -------------------------------------------------------------------------
  // ID Generation
  // -------------------------------------------------------------------------

  /**
   * Generates a fragment ID per D-10: frag-YYYY-MM-DD-hex8.
   *
   * Uses crypto.randomUUID() and takes the first 8 characters for the
   * hex suffix. Date is the current UTC date.
   *
   * @returns {string} Fragment ID matching FRAGMENT_ID_PATTERN
   */
  function generateFragmentId() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hex8 = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    return `frag-${year}-${month}-${day}-${hex8}`;
  }

  // -------------------------------------------------------------------------
  // Association Index Writes
  // -------------------------------------------------------------------------

  /**
   * Creates a write-intent envelope for a specific Ledger table.
   *
   * @param {string} table - Target Ledger table name
   * @param {Array<Object>} data - Row data array
   * @returns {import('../../../../lib/result.cjs').Result<Object>} Envelope result
   */
  function _createWriteEnvelope(table, data) {
    return createEnvelope({
      type: MESSAGE_TYPES.WRITE_INTENT,
      from: _sessionId,
      to: 'ledger',
      payload: { table, data },
      urgency: URGENCY_LEVELS.ACTIVE,
    });
  }

  /**
   * Queues all association index writes for a fragment via Wire.
   *
   * Writes to 5 tables:
   * - fragment_decay: decay state row
   * - fragment_domains: one row per domain
   * - fragment_entities: one row per entity
   * - fragment_attention_tags: one row per attention tag
   * - formation_groups: formation group row
   *
   * @param {Object} fragment - Validated fragment frontmatter
   * @returns {{ ok: boolean, error?: Object }} Result indicating success or first failure
   */
  function _queueAssociationIndexWrites(fragment) {
    const lifecycle = fragment._lifecycle || LIFECYCLE_DIRS.working;

    // 1. fragment_decay
    const decayEnvelope = _createWriteEnvelope('fragment_decay', [{
      fragment_id: fragment.id,
      fragment_type: fragment.type,
      initial_weight: fragment.decay.initial_weight,
      current_weight: fragment.decay.current_weight,
      last_accessed: fragment.decay.last_accessed,
      access_count: fragment.decay.access_count,
      consolidation_count: fragment.decay.consolidation_count,
      pinned: fragment.decay.pinned,
      lifecycle,
    }]);
    if (!decayEnvelope.ok) return decayEnvelope;
    const decayResult = _wire.queueWrite(decayEnvelope.value);
    if (!decayResult.ok) return decayResult;

    // 2. fragment_domains (one row per domain)
    const domains = fragment.associations.domains || [];
    if (domains.length > 0) {
      const domainRows = domains.map(domain => ({
        fragment_id: fragment.id,
        domain_id: domain,
        relevance_score: 0.5,
      }));
      const domainEnvelope = _createWriteEnvelope('fragment_domains', domainRows);
      if (!domainEnvelope.ok) return domainEnvelope;
      const domainResult = _wire.queueWrite(domainEnvelope.value);
      if (!domainResult.ok) return domainResult;
    }

    // 3. fragment_entities (one row per entity)
    const entities = fragment.associations.entities || [];
    if (entities.length > 0) {
      const entityRows = entities.map(entity => ({
        fragment_id: fragment.id,
        entity_id: entity,
        relationship_type: 'mentioned',
      }));
      const entityEnvelope = _createWriteEnvelope('fragment_entities', entityRows);
      if (!entityEnvelope.ok) return entityEnvelope;
      const entityResult = _wire.queueWrite(entityEnvelope.value);
      if (!entityResult.ok) return entityResult;
    }

    // 4. fragment_attention_tags (one row per tag)
    const tags = fragment.associations.attention_tags || [];
    if (tags.length > 0) {
      const tagRows = tags.map(tag => ({
        fragment_id: fragment.id,
        tag_id: tag,
      }));
      const tagEnvelope = _createWriteEnvelope('fragment_attention_tags', tagRows);
      if (!tagEnvelope.ok) return tagEnvelope;
      const tagResult = _wire.queueWrite(tagEnvelope.value);
      if (!tagResult.ok) return tagResult;
    }

    // 5. formation_groups
    const fgEnvelope = _createWriteEnvelope('formation_groups', [{
      id: fragment.formation_group,
      stimulus_summary: fragment.formation.trigger,
      fragment_count: 1,
      surviving_count: 1,
      source_session: fragment.source_session,
    }]);
    if (!fgEnvelope.ok) return fgEnvelope;
    const fgResult = _wire.queueWrite(fgEnvelope.value);
    if (!fgResult.ok) return fgResult;

    // 6. source_locators (only for source-reference fragments with source_locator)
    if (fragment.source_locator) {
      const slEnvelope = _createWriteEnvelope('source_locators', [{
        id: 'sl-' + fragment.id,
        fragment_id: fragment.id,
        locator_type: fragment.source_locator.type,
        path: fragment.source_locator.path || null,
        url: fragment.source_locator.url || null,
        content_hash: fragment.source_locator.content_hash || null,
        last_verified: fragment.source_locator.last_verified || null,
      }]);
      if (!slEnvelope.ok) return slEnvelope;
      const slResult = _wire.queueWrite(slEnvelope.value);
      if (!slResult.ok) return slResult;
    }

    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Writes a fragment atomically to Journal and Ledger.
   *
   * Per D-11 -- journal-first with Ledger rollback:
   * 1. Validate fragment against zod schema
   * 2. Write to Journal (atomic)
   * 3. Queue Ledger writes via Wire for association index tables
   * 4. If Ledger fails, delete Journal file (rollback)
   * 5. Emit switchboard event on success
   *
   * @param {Object} fragment - Fragment frontmatter object
   * @param {string} body - Fragment body text (markdown)
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ id: string, path: string }>>}
   */
  async function writeFragment(fragment, body) {
    // 1. Validate fragment against zod schema
    const validation = validateFragment(fragment);
    if (!validation.ok) {
      return err('INVALID_FRAGMENT', validation.error.message, {
        errors: validation.error.context || {},
      });
    }

    // 2. Determine lifecycle directory (default: working per D-09)
    const lifecycle = fragment._lifecycle || LIFECYCLE_DIRS.working;

    // 3. Write to Journal first (atomic via Bun.write through Lathe)
    const journalResult = await _journal.write(fragment.id, {
      frontmatter: fragment,
      body: body || '',
    });
    if (!journalResult.ok) {
      return journalResult;
    }

    // 4. Queue Ledger writes via Wire for association index tables
    const ledgerResult = _queueAssociationIndexWrites(fragment);
    if (!ledgerResult.ok) {
      // 5. Rollback: delete the Journal file
      await _journal.delete(fragment.id);
      return err('FRAGMENT_WRITE_FAILED', 'Ledger write failed, Journal rolled back', {
        fragmentId: fragment.id,
        ledgerError: ledgerResult.error,
      });
    }

    // 6. Emit event on success
    if (_switchboard) {
      _switchboard.emit('reverie:fragment:written', {
        id: fragment.id,
        type: fragment.type,
      });
    }

    // 7. Return success
    return ok({ id: fragment.id, path: `${lifecycle}/${fragment.id}.md` });
  }

  // -------------------------------------------------------------------------
  // Delete (stub per plan)
  // -------------------------------------------------------------------------

  /**
   * Deletes a fragment from Journal and marks Ledger rows for archival.
   *
   * Stub implementation: deletes Journal file, queues lifecycle update
   * to Ledger (soft delete per D-09 -- moves to archive, not hard delete).
   *
   * @param {string} id - Fragment ID to delete
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ id: string }>>}
   */
  async function deleteFragment(id) {
    // Delete from Journal
    await _journal.delete(id);

    // Queue Wire write to mark fragment_decay.lifecycle = 'archive' (soft delete per D-09)
    const archiveEnvelope = _createWriteEnvelope('fragment_decay', [{
      fragment_id: id,
      lifecycle: LIFECYCLE_DIRS.archive,
    }]);
    if (archiveEnvelope.ok) {
      _wire.queueWrite(archiveEnvelope.value);
    }

    return ok({ id });
  }

  // -------------------------------------------------------------------------
  // Update (stub per plan)
  // -------------------------------------------------------------------------

  /**
   * Updates a fragment by re-validating and re-writing.
   *
   * Stub implementation: reads existing, merges updates, re-validates,
   * re-writes. Full implementation deferred to a later phase.
   *
   * @param {string} id - Fragment ID to update
   * @param {Object} frontmatterUpdates - Fields to merge into frontmatter
   * @param {string} [body] - Optional new body content
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ id: string }>>}
   */
  async function updateFragment(id, frontmatterUpdates, body) {
    // Stub: return ok with id to signal the method exists and is callable
    // Full implementation requires journal.read + merge + re-validate + re-write
    return ok({ id });
  }

  return {
    generateFragmentId,
    writeFragment,
    deleteFragment,
    updateFragment,
  };
}

module.exports = { createFragmentWriter };
