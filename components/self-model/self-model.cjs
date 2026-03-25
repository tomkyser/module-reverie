'use strict';

/**
 * Self Model state manager with three-aspect persistence.
 *
 * Persists Self Model state (Identity Core, Relational Model, Conditioning)
 * across Journal (narrative markdown), Magnet (in-memory cache), and Ledger
 * (structured tables via Wire write coordinator).
 *
 * Implements:
 * - SM-01: Self Model state management
 * - SM-02: Identity Core, Relational Model, Conditioning aspects
 * - SM-03: Persistence across Journal + Ledger + Magnet
 *
 * Architecture decisions:
 * - D-05: One Journal file per aspect (identity-core.md, relational-model.md, conditioning.md)
 * - D-06: One Ledger table per structured field type
 * - D-07/D-08: Entropy engine integration (via cold-start, not here)
 *
 * @module reverie/components/self-model/self-model
 */

const { ok, err, createContract } = require('../../../../lib/index.cjs');
const { SM_ASPECTS } = require('../../lib/constants.cjs');
const {
  identityCoreSchema,
  relationalModelSchema,
  conditioningSchema,
} = require('../../lib/schemas.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Contract shape for the Self Model manager.
 * @type {import('../../../../lib/contract.cjs').ContractShape}
 */
const SELF_MODEL_SHAPE = {
  required: ['save', 'load', 'getAspect', 'setAspect', 'getVersion'],
  optional: [],
};

/**
 * Maps aspect name to its short name for version strings.
 * identity-core -> identity, relational-model -> relational, conditioning -> conditioning
 * @type {Record<string, string>}
 */
const ASPECT_SHORT_NAMES = Object.freeze({
  'identity-core': 'identity',
  'relational-model': 'relational',
  'conditioning': 'conditioning',
});

/**
 * Maps aspect name to its zod validation schema.
 * @type {Record<string, import('zod').ZodType>}
 */
const ASPECT_SCHEMAS = Object.freeze({
  'identity-core': identityCoreSchema,
  'relational-model': relationalModelSchema,
  'conditioning': conditioningSchema,
});

/**
 * Maps aspect names to their Ledger table field mappings (D-06).
 * Each aspect key maps to an object of { frontmatterField -> ledgerTableName }.
 * @type {Record<string, Record<string, string>>}
 */
const LEDGER_TABLE_MAP = Object.freeze({
  'identity-core': {
    value_orientations: 'sm_value_orientations',
    expertise_map: 'sm_expertise_map',
  },
  'relational-model': {
    trust_calibration: 'sm_trust_calibration',
    interaction_rhythm: 'sm_interaction_rhythm',
  },
  'conditioning': {
    attention_biases: 'sm_attention_biases',
    association_priors: 'sm_association_priors',
    sublimation_sensitivity: 'sm_sublimation_sensitivity',
  },
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Self Model state manager instance.
 *
 * @param {Object} options - Dependency injection options
 * @param {Object} options.journal - Journal provider instance (narrative markdown files per D-05)
 * @param {Object} options.magnet - Magnet service instance (in-memory cache)
 * @param {Object} options.wire - Wire service instance (Ledger writes via write coordinator per D-06)
 * @param {Object} options.switchboard - Switchboard for event emission
 * @returns {import('../../../../lib/result.cjs').Result<Object>} Frozen contract instance on success
 */
function createSelfModel(options) {
  if (!options) {
    return err('INIT_FAILED', 'createSelfModel requires options object');
  }

  const { journal, magnet, wire, switchboard } = options;

  /**
   * Internal version tracking per aspect.
   * @type {Record<string, number>}
   */
  const _versions = {
    'identity-core': 0,
    'relational-model': 0,
    'conditioning': 0,
  };

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Validates frontmatter against the correct aspect schema.
   *
   * @param {string} aspectName - The aspect name
   * @param {Object} frontmatter - Frontmatter to validate
   * @returns {{ valid: boolean, error?: string }}
   */
  function _validate(aspectName, frontmatter) {
    const schema = ASPECT_SCHEMAS[aspectName];
    if (!schema) {
      return { valid: false, error: `No schema for aspect: ${aspectName}` };
    }

    const result = schema.safeParse(frontmatter);
    if (result.success) {
      return { valid: true };
    }

    const message = result.error.issues
      ? result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
      : String(result.error);

    return { valid: false, error: message };
  }

  /**
   * Queues Ledger writes for structured fields in frontmatter via Wire.
   *
   * @param {string} aspectName - The aspect name
   * @param {Object} frontmatter - Frontmatter with structured fields
   */
  function _queueLedgerWrites(aspectName, frontmatter) {
    if (!wire) return;

    const tableMap = LEDGER_TABLE_MAP[aspectName];
    if (!tableMap) return;

    for (const [field, table] of Object.entries(tableMap)) {
      if (frontmatter[field] !== undefined && frontmatter[field] !== null) {
        wire.queueWrite({
          table,
          data: frontmatter[field],
          aspect: aspectName,
          field,
          version: frontmatter.version,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Saves an aspect's state to Journal, Magnet, and Ledger.
   *
   * 1. Validates aspectName
   * 2. Increments version
   * 3. Sets updated timestamp
   * 4. Validates against schema
   * 5. Writes to Journal
   * 6. Caches in Magnet
   * 7. Queues Ledger writes via Wire
   * 8. Emits update event
   *
   * @param {string} aspectName - One of SM_ASPECTS
   * @param {{ frontmatter: Object, body: string }} data - Aspect data
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ aspect: string, version: string }>>}
   */
  async function save(aspectName, { frontmatter, body }) {
    // 1. Validate aspect name
    if (!SM_ASPECTS.includes(aspectName)) {
      return err('INVALID_ASPECT', `Invalid aspect name: ${aspectName}`, {
        aspect: aspectName,
        valid: SM_ASPECTS,
      });
    }

    // 2. Increment version
    _versions[aspectName]++;
    const shortName = ASPECT_SHORT_NAMES[aspectName];
    frontmatter.version = `sm-${shortName}-v${_versions[aspectName]}`;

    // 3. Set updated timestamp
    frontmatter.updated = new Date().toISOString();

    // 4. Validate against schema
    const validation = _validate(aspectName, frontmatter);
    if (!validation.valid) {
      // Roll back version increment on validation failure
      _versions[aspectName]--;
      return err('INVALID_SELF_MODEL', validation.error, {
        aspect: aspectName,
        errors: validation.error,
      });
    }

    // 5. Write to Journal
    if (journal) {
      await journal.write(aspectName, { frontmatter, body });
    }

    // 6. Cache in Magnet
    if (magnet) {
      magnet.set('module', 'reverie', 'self-model.' + aspectName, { frontmatter, body });
    }

    // 7. Queue Ledger writes via Wire
    _queueLedgerWrites(aspectName, frontmatter);

    // 8. Emit update event
    if (switchboard) {
      switchboard.emit('reverie:self-model:updated', {
        aspect: aspectName,
        version: frontmatter.version,
      });
    }

    // 9. Return success
    return ok({ aspect: aspectName, version: frontmatter.version });
  }

  /**
   * Loads an aspect's state, checking Magnet cache first, then Journal.
   *
   * @param {string} aspectName - One of SM_ASPECTS
   * @returns {Promise<import('../../../../lib/result.cjs').Result<{ frontmatter: Object, body: string }>>}
   */
  async function load(aspectName) {
    // 1. Check Magnet cache first
    if (magnet) {
      const cached = magnet.get('module', 'reverie', 'self-model.' + aspectName);
      if (cached) {
        return ok(cached);
      }
    }

    // 2. Read from Journal
    if (!journal) {
      return err('NO_JOURNAL', 'Journal not available');
    }

    const readResult = await journal.read(aspectName);
    if (!readResult.ok) {
      return readResult;
    }

    // 3. Extract frontmatter and body
    const { data: frontmatter, body } = readResult.value;

    // 4. Validate against schema
    const validation = _validate(aspectName, frontmatter);
    if (!validation.valid) {
      return err('CORRUPTED_SELF_MODEL', `Corrupted Self Model data for ${aspectName}: ${validation.error}`, {
        aspect: aspectName,
        errors: validation.error,
      });
    }

    // 5. Cache in Magnet
    const result = { frontmatter, body };
    if (magnet) {
      magnet.set('module', 'reverie', 'self-model.' + aspectName, result);
    }

    return ok(result);
  }

  /**
   * Synchronous cache read from Magnet.
   *
   * @param {string} aspectName - One of SM_ASPECTS
   * @returns {Object|null} Cached aspect data or null
   */
  function getAspect(aspectName) {
    if (!magnet) return null;
    const cached = magnet.get('module', 'reverie', 'self-model.' + aspectName);
    return cached || null;
  }

  /**
   * Synchronous cache write to Magnet. No persistence (use save for that).
   *
   * @param {string} aspectName - One of SM_ASPECTS
   * @param {Object} data - Data to cache
   */
  function setAspect(aspectName, data) {
    if (magnet) {
      magnet.set('module', 'reverie', 'self-model.' + aspectName, data);
    }
  }

  /**
   * Returns current version number for an aspect.
   *
   * @param {string} aspectName - One of SM_ASPECTS
   * @returns {number} Current version number (0 = never saved)
   */
  function getVersion(aspectName) {
    return _versions[aspectName] || 0;
  }

  return createContract('selfModel', SELF_MODEL_SHAPE, {
    save,
    load,
    getAspect,
    setAspect,
    getVersion,
  });
}

module.exports = { createSelfModel };
