'use strict';

/**
 * Taxonomy Governor -- Self-organizing taxonomy governance for Reverie.
 *
 * Implements FRG-07: domain split, retire, and cap pressure enforcement
 * integrated into the REM editorial pass. Provides:
 * - Cap pressure computation (D-06)
 * - Split candidate detection (D-07: fragment density threshold)
 * - Retire candidate detection (D-08: inactive REM cycles)
 * - Domain split application with parent-child hierarchy
 * - Domain retirement with archival
 * - Taxonomy narrative fragment creation (D-09)
 * - Pressure gradient text for editorial prompt urgency
 *
 * All Ledger mutations go through Wire write-intent envelopes -- never
 * direct Ledger access (Pitfall 1 compliance: single writer via Wire).
 *
 * @module reverie/components/taxonomy/taxonomy-governor
 */

const { ok, err } = require('../../../../lib/result.cjs');
const { TAXONOMY_DEFAULTS, LIFECYCLE_DIRS } = require('../../lib/constants.cjs');
const { createEnvelope, MESSAGE_TYPES, URGENCY_LEVELS } = require('../../../../core/services/wire/protocol.cjs');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a taxonomy governor instance with injected dependencies.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.wire - Wire service for write-intent envelopes
 * @param {Object} options.switchboard - Switchboard for event emission
 * @param {Object} options.fragmentWriter - FragmentWriter for narrative writes
 * @param {Object} [options.config] - Configuration overrides
 * @returns {Object} Taxonomy governor instance (frozen)
 */
function createTaxonomyGovernor(options = {}) {
  const _wire = options.wire;
  const _switchboard = options.switchboard;
  const _fragmentWriter = options.fragmentWriter;
  const _config = options.config || {};

  // -------------------------------------------------------------------------
  // Wire Envelope Helper
  // -------------------------------------------------------------------------

  /**
   * Creates a write-intent envelope for a Ledger table operation.
   *
   * @param {string} table - Target Ledger table
   * @param {Array<Object>} data - Row data
   * @param {string} operation - Operation type (update, delete, insert)
   * @param {string} sessionId - Current session ID
   * @returns {import('../../../../lib/result.cjs').Result<Object>}
   */
  function _createGovernanceEnvelope(table, data, operation, sessionId) {
    return createEnvelope({
      type: MESSAGE_TYPES.WRITE_INTENT,
      from: sessionId || 'taxonomy-governor',
      to: 'ledger',
      payload: { table, data, operation },
      urgency: URGENCY_LEVELS.ACTIVE,
    });
  }

  // -------------------------------------------------------------------------
  // Cap Pressure Computation (D-06)
  // -------------------------------------------------------------------------

  /**
   * Computes taxonomy cap pressure as ratios of current counts to hard caps.
   *
   * isUnderPressure is true when ANY dimension reaches the pressure_threshold
   * (default 0.8). This triggers more aggressive merge/retire in editorial.
   *
   * @param {number} domainCount - Current total domain count
   * @param {number} maxEntityCount - Highest entity count in any single domain
   * @param {number} edgeCount - Current total association edge count
   * @returns {{ domainCount: number, maxEntityCount: number, edgeCount: number, domainPressure: number, entityPressure: number, edgePressure: number, isUnderPressure: boolean }}
   */
  function computeCapPressure(domainCount, maxEntityCount, edgeCount) {
    const caps = _config.taxonomy || TAXONOMY_DEFAULTS;

    const domainPressure = domainCount / caps.max_domains;
    const entityPressure = maxEntityCount / caps.max_entities_per_domain;
    const edgePressure = edgeCount / caps.max_association_edges;

    return {
      domainCount,
      maxEntityCount,
      edgeCount,
      domainPressure,
      entityPressure,
      edgePressure,
      isUnderPressure: domainPressure >= caps.pressure_threshold
        || entityPressure >= caps.pressure_threshold
        || edgePressure >= caps.pressure_threshold,
    };
  }

  // -------------------------------------------------------------------------
  // Pressure Gradient Text
  // -------------------------------------------------------------------------

  /**
   * Returns urgency text for editorial prompt based on pressure level.
   *
   * @param {Object} capPressure - Cap pressure object from computeCapPressure
   * @returns {string} Urgency text for editorial prompt (empty if below threshold)
   */
  function getPressureGradientText(capPressure) {
    const maxPressure = Math.max(
      capPressure.domainPressure || 0,
      capPressure.entityPressure || 0,
      capPressure.edgePressure || 0
    );

    if (maxPressure >= 0.95) {
      return 'URGENT: Near taxonomy cap. Merge near-synonyms with minimal justification. Retire all inactive domains.';
    }
    if (maxPressure >= 0.9) {
      return 'Prioritize merging near-synonyms and retiring sparse domains. Taxonomy cap approaching.';
    }
    if (maxPressure >= 0.8) {
      return 'Consider merging near-synonym domains and retiring inactive domains.';
    }
    return '';
  }

  // -------------------------------------------------------------------------
  // Split Candidate Detection (D-07)
  // -------------------------------------------------------------------------

  /**
   * Identifies domains with fragment density above the split threshold.
   *
   * @param {Array<Object>} domains - Domain objects with id, name, fragment_count, archived
   * @returns {Array<{ domain_id: string, domain_name: string, fragment_count: number }>}
   */
  function identifySplitCandidates(domains) {
    const caps = _config.taxonomy || TAXONOMY_DEFAULTS;

    return (domains || [])
      .filter(d => !d.archived && d.fragment_count >= caps.split_fragment_threshold)
      .map(d => ({
        domain_id: d.id,
        domain_name: d.name,
        fragment_count: d.fragment_count,
      }));
  }

  // -------------------------------------------------------------------------
  // Retire Candidate Detection (D-08)
  // -------------------------------------------------------------------------

  /**
   * Identifies domains with consecutive inactive REM cycles above threshold.
   *
   * @param {Array<Object>} domains - Domain objects with id, name, archived
   * @param {Map<string, number>} inactiveCycleMap - Map<domain_id, consecutive_inactive_cycles>
   * @returns {Array<{ domain_id: string, domain_name: string, inactive_cycles: number }>}
   */
  function identifyRetireCandidates(domains, inactiveCycleMap) {
    const caps = _config.taxonomy || TAXONOMY_DEFAULTS;

    return (domains || [])
      .filter(d => {
        if (d.archived) return false;
        const cycles = inactiveCycleMap.get(d.id) || 0;
        return cycles >= caps.retire_inactive_cycles;
      })
      .map(d => ({
        domain_id: d.id,
        domain_name: d.name,
        inactive_cycles: inactiveCycleMap.get(d.id) || 0,
      }));
  }

  // -------------------------------------------------------------------------
  // Domain Split (D-07, Pitfall 7)
  // -------------------------------------------------------------------------

  /**
   * Applies a domain split: creates child domains, redistributes associations.
   *
   * Per Pitfall 7: redistributes fragment_domains, entity_domains, and
   * domain_relationships. All mutations go through Wire write-intent envelopes.
   *
   * @param {string} parentDomainId - ID of the domain being split
   * @param {Array<{ name: string, description: string, fragment_ids: Array<string> }>} childDomains - Child domain specs from LLM editorial
   * @param {string} sessionId - Current session ID
   * @returns {Promise<{ children_created: number, fragments_redistributed: number }>}
   */
  async function applyDomainSplit(parentDomainId, childDomains, sessionId) {
    let childrenCreated = 0;
    let fragmentsRedistributed = 0;
    const childIds = [];

    for (let i = 0; i < childDomains.length; i++) {
      const child = childDomains[i];
      const childId = `${parentDomainId}-${i}`;
      childIds.push(childId);

      // Create child domain row
      const domainEnvelope = _createGovernanceEnvelope(
        'domains',
        [{
          id: childId,
          name: child.name,
          description: child.description,
          parent_domain_id: parentDomainId,
          fragment_count: (child.fragment_ids || []).length,
          weight: 1.0,
          archived: false,
        }],
        'insert',
        sessionId
      );
      if (domainEnvelope.ok) {
        _wire.queueWrite(domainEnvelope.value);
        childrenCreated++;
      }

      // Reassign fragment_domains from parent to child
      const fragmentIds = child.fragment_ids || [];
      if (fragmentIds.length > 0) {
        const fdEnvelope = _createGovernanceEnvelope(
          'fragment_domains',
          fragmentIds.map(fid => ({
            fragment_id: fid,
            old_domain_id: parentDomainId,
            new_domain_id: childId,
          })),
          'update',
          sessionId
        );
        if (fdEnvelope.ok) {
          _wire.queueWrite(fdEnvelope.value);
          fragmentsRedistributed += fragmentIds.length;
        }
      }

      // Create entity_domains entries for entities in each child
      // (entities inherit from the parent domain's entity set, scoped to child)
      const edEnvelope = _createGovernanceEnvelope(
        'entity_domains',
        [{
          domain_id: childId,
          inherited_from: parentDomainId,
        }],
        'insert',
        sessionId
      );
      if (edEnvelope.ok) {
        _wire.queueWrite(edEnvelope.value);
      }
    }

    // Create domain_relationships: parent-child and sibling relationships
    const relationships = [];

    // Parent-child relationships
    for (const childId of childIds) {
      relationships.push({
        source_domain_id: parentDomainId,
        target_domain_id: childId,
        relationship_type: 'parent-child',
        strength: 1.0,
      });
    }

    // Sibling relationships between children
    for (let i = 0; i < childIds.length; i++) {
      for (let j = i + 1; j < childIds.length; j++) {
        relationships.push({
          source_domain_id: childIds[i],
          target_domain_id: childIds[j],
          relationship_type: 'sibling',
          strength: 0.8,
        });
      }
    }

    if (relationships.length > 0) {
      const relEnvelope = _createGovernanceEnvelope(
        'domain_relationships',
        relationships,
        'insert',
        sessionId
      );
      if (relEnvelope.ok) {
        _wire.queueWrite(relEnvelope.value);
      }
    }

    // Emit event
    if (_switchboard) {
      _switchboard.emit('reverie:taxonomy:domain-split', {
        parent: parentDomainId,
        children: childIds,
        fragments_redistributed: fragmentsRedistributed,
      });
    }

    return { children_created: childrenCreated, fragments_redistributed: fragmentsRedistributed };
  }

  // -------------------------------------------------------------------------
  // Domain Retire (D-08)
  // -------------------------------------------------------------------------

  /**
   * Archives a domain: sets archived=true, stops appearing in formation/recall.
   *
   * @param {string} domainId - ID of the domain to retire
   * @param {string} sessionId - Current session ID
   * @returns {Promise<{ domain_id: string, archived: boolean }>}
   */
  async function applyDomainRetire(domainId, sessionId) {
    const envelope = _createGovernanceEnvelope(
      'domains',
      [{ id: domainId, archived: true }],
      'update',
      sessionId
    );
    if (envelope.ok) {
      _wire.queueWrite(envelope.value);
    }

    // Emit event
    if (_switchboard) {
      _switchboard.emit('reverie:taxonomy:domain-retired', {
        domain_id: domainId,
      });
    }

    return { domain_id: domainId, archived: true };
  }

  // -------------------------------------------------------------------------
  // Taxonomy Narrative (D-09)
  // -------------------------------------------------------------------------

  /**
   * Creates a consolidation-type narrative fragment recording a taxonomy operation.
   *
   * Extends the merge narrative pattern from editorial-pass.cjs to splits and
   * retirements. All taxonomy operations become part of Reverie's memory.
   *
   * @param {'split'|'retire'|'merge'} operation - Taxonomy operation type
   * @param {Object} details - Operation-specific details
   * @param {string} sessionId - Current session ID
   * @returns {Promise<import('../../../../lib/result.cjs').Result>}
   */
  async function writeTaxonomyNarrative(operation, details, sessionId) {
    const fragmentId = _fragmentWriter.generateFragmentId();
    const now = new Date().toISOString();

    // Build trigger text based on operation
    let trigger;
    let narrativeBody;
    let domainRefs = [];

    switch (operation) {
      case 'split': {
        const childNames = (details.children || []).map(c => c.name).join(', ');
        trigger = `REM editorial pass - domain split: ${details.parent} into [${childNames}]`;
        narrativeBody = details.narrative || `Domain ${details.parent} split into sub-domains: ${childNames}`;
        domainRefs = [details.parent];
        break;
      }
      case 'retire': {
        const cycles = details.inactive_cycles || details.cycles || 0;
        trigger = `REM editorial pass - domain retired: ${details.domain} after ${cycles} inactive cycles`;
        narrativeBody = details.narrative || `Domain ${details.name || details.domain} retired after ${cycles} inactive REM cycles`;
        domainRefs = [details.domain];
        break;
      }
      case 'merge': {
        trigger = `REM editorial pass - domain merge: ${details.merged} into ${details.surviving}`;
        narrativeBody = details.narrative || `Domain ${details.merged} merged into ${details.surviving}`;
        domainRefs = [details.surviving || details.domain];
        break;
      }
      default: {
        trigger = `REM editorial pass - taxonomy operation: ${operation}`;
        narrativeBody = details.narrative || `Taxonomy operation: ${operation}`;
        break;
      }
    }

    const narrativeFragment = {
      id: fragmentId,
      type: 'consolidation',
      created: now,
      source_session: sessionId || 'taxonomy-governor',
      self_model_version: 'sm-identity-v1',
      formation_group: `fg-editorial-${Date.now()}`,
      formation_frame: 'consolidation',
      sibling_fragments: [],
      temporal: {
        absolute: now,
        session_relative: 1.0,
        sequence: 0,
      },
      decay: {
        initial_weight: 0.6,
        current_weight: 0.6,
        last_accessed: now,
        access_count: 0,
        consolidation_count: 0,
        pinned: false,
      },
      associations: {
        domains: domainRefs,
        entities: [],
        self_model_relevance: { identity: 0.1, relational: 0.1, conditioning: 0.2 },
        emotional_valence: 0.0,
        attention_tags: [`taxonomy-${operation}`, 'editorial'],
      },
      pointers: {
        causal_antecedents: [],
        causal_consequents: [],
        thematic_siblings: [],
        contradictions: [],
        meta_recalls: [],
        source_fragments: [],
      },
      formation: {
        trigger,
        attention_pointer: `taxonomy-${operation}`,
        active_domains_at_formation: domainRefs,
        sublimation_that_prompted: null,
      },
      _lifecycle: LIFECYCLE_DIRS.active,
    };

    const writeResult = await _fragmentWriter.writeFragment(narrativeFragment, narrativeBody);
    return writeResult;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return Object.freeze({
    computeCapPressure,
    getPressureGradientText,
    identifySplitCandidates,
    identifyRetireCandidates,
    applyDomainSplit,
    applyDomainRetire,
    writeTaxonomyNarrative,
  });
}

module.exports = { createTaxonomyGovernor };
