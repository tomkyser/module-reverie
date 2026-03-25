'use strict';

/**
 * Spec compliance test: Platform Architecture (new-plan.md).
 *
 * Verifies:
 * - All 9 core services + Exciter (10 total) registered in bootstrap
 * - All 2 core providers + Lithograph (3 total) registered in bootstrap
 * - Each service/provider has a createContract()-wrapped SHAPE constant
 * - Layer hierarchy: no reverse dependencies (lib/ must not import core/)
 * - All source files use CJS format ('use strict' + require/module.exports)
 * - No YAML parsing imports (JSON for structured data per new-plan.md)
 * - No LLM API endpoint/integration below SDK scope
 *
 * @module reverie/validation/spec-platform.test
 */

const { describe, it, expect } = require('bun:test');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Recursively collects .cjs files from a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectCjsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and __tests__
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...collectCjsFiles(full));
    } else if (entry.name.endsWith('.cjs') && !entry.name.endsWith('.test.cjs')) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Platform Architecture: new-plan.md compliance
// ---------------------------------------------------------------------------

describe('Platform Architecture: new-plan.md compliance', () => {

  // -------------------------------------------------------------------------
  // Core Services Registration
  // -------------------------------------------------------------------------

  describe('Core Services Registration', () => {
    const EXPECTED_SERVICES = [
      'services.switchboard',
      'services.commutator',
      'services.magnet',
      'services.conductor',
      'services.forge',
      'services.lathe',
      'services.relay',
      'services.wire',
      'services.assay',
    ];

    it('bootstrap registers all 9 core services from new-plan.md', () => {
      const coreSource = fs.readFileSync(path.join(ROOT, 'core', 'core.cjs'), 'utf8');

      for (const serviceName of EXPECTED_SERVICES) {
        expect(coreSource).toContain(`'${serviceName}'`);
      }
    });

    it('bootstrap also registers Exciter service (10th service from Phase 9.1)', () => {
      const coreSource = fs.readFileSync(path.join(ROOT, 'core', 'core.cjs'), 'utf8');
      expect(coreSource).toContain("'services.exciter'");
    });

    it('each core service has a SHAPE constant wrapped by createContract()', () => {
      const serviceShapes = {
        Switchboard: { file: 'core/services/switchboard/switchboard.cjs', shape: 'SWITCHBOARD_SHAPE' },
        Commutator: { file: 'core/services/commutator/commutator.cjs', shape: 'COMMUTATOR_SHAPE' },
        Magnet: { file: 'core/services/magnet/magnet.cjs', shape: 'MAGNET_SHAPE' },
        Conductor: { file: 'core/services/conductor/conductor.cjs', shape: 'CONDUCTOR_SHAPE' },
        Forge: { file: 'core/services/forge/forge.cjs', shape: 'FORGE_SHAPE' },
        Lathe: { file: 'core/services/lathe/lathe.cjs', shape: 'LATHE_SHAPE' },
        Relay: { file: 'core/services/relay/relay.cjs', shape: 'RELAY_SHAPE' },
        Wire: { file: 'core/services/wire/wire.cjs', shape: 'WIRE_SHAPE' },
        Assay: { file: 'core/services/assay/assay.cjs', shape: 'ASSAY_SHAPE' },
        Exciter: { file: 'core/services/exciter/exciter.cjs', shape: 'EXCITER_SHAPE' },
      };

      for (const [name, info] of Object.entries(serviceShapes)) {
        const source = fs.readFileSync(path.join(ROOT, info.file), 'utf8');
        expect(source).toContain(info.shape);
        expect(source).toContain('createContract(');
      }
    });

    it('each core service factory is require()-able from bootstrap', () => {
      const factories = [
        { factory: 'createSwitchboard', path: 'core/services/switchboard/switchboard.cjs' },
        { factory: 'createCommutator', path: 'core/services/commutator/commutator.cjs' },
        { factory: 'createMagnet', path: 'core/services/magnet/magnet.cjs' },
        { factory: 'createConductor', path: 'core/services/conductor/conductor.cjs' },
        { factory: 'createForge', path: 'core/services/forge/forge.cjs' },
        { factory: 'createLathe', path: 'core/services/lathe/lathe.cjs' },
        { factory: 'createRelay', path: 'core/services/relay/relay.cjs' },
        { factory: 'createWire', path: 'core/services/wire/wire.cjs' },
        { factory: 'createAssay', path: 'core/services/assay/assay.cjs' },
        { factory: 'createExciter', path: 'core/services/exciter/exciter.cjs' },
      ];

      for (const { factory, path: modPath } of factories) {
        const mod = require(path.join(ROOT, modPath));
        expect(typeof mod[factory]).toBe('function');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Core Providers Registration
  // -------------------------------------------------------------------------

  describe('Core Providers Registration', () => {
    it('bootstrap registers Ledger provider', () => {
      const coreSource = fs.readFileSync(path.join(ROOT, 'core', 'core.cjs'), 'utf8');
      expect(coreSource).toContain("'providers.ledger'");
    });

    it('bootstrap registers Journal provider', () => {
      const coreSource = fs.readFileSync(path.join(ROOT, 'core', 'core.cjs'), 'utf8');
      expect(coreSource).toContain("'providers.journal'");
    });

    it('bootstrap registers Lithograph provider (Phase 9.1 addition)', () => {
      const coreSource = fs.readFileSync(path.join(ROOT, 'core', 'core.cjs'), 'utf8');
      expect(coreSource).toContain("'providers.lithograph'");
    });

    it('providers use DATA_PROVIDER_SHAPE contract', () => {
      const providerContract = require(path.join(ROOT, 'core', 'providers', 'provider-contract.cjs'));
      expect(providerContract.DATA_PROVIDER_SHAPE).toBeDefined();
      expect(providerContract.DATA_PROVIDER_SHAPE.required).toBeInstanceOf(Array);
      expect(providerContract.DATA_PROVIDER_SHAPE.required.length).toBeGreaterThan(0);
    });

    it('Ledger factory is require()-able', () => {
      const { createLedger } = require(path.join(ROOT, 'core', 'providers', 'ledger', 'ledger.cjs'));
      expect(typeof createLedger).toBe('function');
    });

    it('Journal factory is require()-able', () => {
      const { createJournal } = require(path.join(ROOT, 'core', 'providers', 'journal', 'journal.cjs'));
      expect(typeof createJournal).toBe('function');
    });

    it('Lithograph factory is require()-able', () => {
      const { createLithograph } = require(path.join(ROOT, 'core', 'providers', 'lithograph', 'lithograph.cjs'));
      expect(typeof createLithograph).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Layer Hierarchy
  // -------------------------------------------------------------------------

  describe('Layer Hierarchy', () => {
    it('lib/ does not import from core/ (no reverse dependencies)', () => {
      const libFiles = collectCjsFiles(path.join(ROOT, 'lib'));
      for (const file of libFiles) {
        const source = fs.readFileSync(file, 'utf8');
        // lib/ should never require anything from core/
        const coreImports = source.match(/require\(['"]\.\.\/(core|\.\.\/core)\//g);
        expect(coreImports).toBeNull();
      }
    });

    it('lib/ does not import from modules/ (no reverse dependencies)', () => {
      const libFiles = collectCjsFiles(path.join(ROOT, 'lib'));
      for (const file of libFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const moduleImports = source.match(/require\(['"].*modules\//g);
        expect(moduleImports).toBeNull();
      }
    });

    it('core/services/ does not import from modules/ (services are platform-level)', () => {
      const serviceFiles = collectCjsFiles(path.join(ROOT, 'core', 'services'));
      for (const file of serviceFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const moduleImports = source.match(/require\(['"].*modules\//g);
        expect(moduleImports).toBeNull();
      }
    });

    it('core/providers/ does not import from modules/ (providers are platform-level)', () => {
      const providerFiles = collectCjsFiles(path.join(ROOT, 'core', 'providers'));
      for (const file of providerFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const moduleImports = source.match(/require\(['"].*modules\//g);
        expect(moduleImports).toBeNull();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Engineering Principles
  // -------------------------------------------------------------------------

  describe('Engineering Principles', () => {
    it('all core .cjs source files use strict mode', () => {
      const coreFiles = collectCjsFiles(path.join(ROOT, 'core'));
      expect(coreFiles.length).toBeGreaterThan(0);

      for (const file of coreFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const firstNonComment = source.trimStart();
        expect(firstNonComment.startsWith("'use strict'")).toBe(true);
      }
    });

    it('all lib .cjs source files use strict mode', () => {
      const libFiles = collectCjsFiles(path.join(ROOT, 'lib'));
      expect(libFiles.length).toBeGreaterThan(0);

      for (const file of libFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const firstNonComment = source.trimStart();
        expect(firstNonComment.startsWith("'use strict'")).toBe(true);
      }
    });

    it('all core .cjs files use CJS exports (module.exports)', () => {
      const coreFiles = collectCjsFiles(path.join(ROOT, 'core'));
      for (const file of coreFiles) {
        const source = fs.readFileSync(file, 'utf8');
        expect(source).toContain('module.exports');
      }
    });

    it('no YAML parsing imports in core (JSON for structured data per new-plan.md)', () => {
      const allFiles = [
        ...collectCjsFiles(path.join(ROOT, 'lib')),
        ...collectCjsFiles(path.join(ROOT, 'core')),
      ];

      for (const file of allFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const yamlImports = source.match(/require\(['"].*yaml['"]\)/gi);
        expect(yamlImports).toBeNull();
      }
    });

    it('no LLM API endpoint imports below SDK scope', () => {
      const allFiles = [
        ...collectCjsFiles(path.join(ROOT, 'lib')),
        ...collectCjsFiles(path.join(ROOT, 'core')),
      ];

      const forbiddenPatterns = [
        /require\(['"]openai['"]\)/i,
        /require\(['"]@anthropic-ai/i,
        /require\(['"]openrouter/i,
        /api\.openai\.com/i,
        /api\.anthropic\.com/i,
      ];

      for (const file of allFiles) {
        const source = fs.readFileSync(file, 'utf8');
        for (const pattern of forbiddenPatterns) {
          expect(source.match(pattern)).toBeNull();
        }
      }
    });

    it('no ESM syntax in core .cjs source files', () => {
      const coreFiles = collectCjsFiles(path.join(ROOT, 'core'));
      for (const file of coreFiles) {
        const source = fs.readFileSync(file, 'utf8');
        // Check for ESM export syntax (but not in comments/strings)
        const lines = source.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip comments
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          // Check for ESM patterns at start of line
          expect(trimmed.startsWith('export default ')).toBe(false);
          expect(trimmed.startsWith('export const ')).toBe(false);
          expect(trimmed.startsWith('export function ')).toBe(false);
          expect(trimmed.startsWith('export class ')).toBe(false);
        }
      }
    });
  });
});
