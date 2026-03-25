'use strict';

const { describe, it, expect } = require('bun:test');
const { join } = require('node:path');

const { validateModuleManifest } = require('../../../core/sdk/circuit/module-manifest.cjs');

// ---------------------------------------------------------------------------
// Tests: Module manifest validation
// ---------------------------------------------------------------------------

describe('Reverie module manifest', () => {
  let manifest;

  // Load manifest before each test to ensure fresh parse
  function loadManifest() {
    const manifestPath = join(__dirname, '..', 'manifest.json');
    const raw = require('node:fs').readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw);
  }

  it('parses as valid JSON', () => {
    expect(() => loadManifest()).not.toThrow();
    manifest = loadManifest();
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe('object');
  });

  it('validates against MODULE_MANIFEST_SCHEMA', () => {
    manifest = loadManifest();
    const result = validateModuleManifest(manifest);
    expect(result.ok).toBe(true);
  });

  it('has name === "reverie"', () => {
    manifest = loadManifest();
    expect(manifest.name).toBe('reverie');
  });

  it('has version matching semver pattern', () => {
    manifest = loadManifest();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has main === "reverie.cjs"', () => {
    manifest = loadManifest();
    expect(manifest.main).toBe('reverie.cjs');
  });

  it('has enabled === true', () => {
    manifest = loadManifest();
    expect(manifest.enabled).toBe(true);
  });

  it('declares required service dependencies', () => {
    manifest = loadManifest();
    const services = manifest.dependencies.services;
    expect(services).toContain('switchboard');
    expect(services).toContain('lathe');
    expect(services).toContain('magnet');
    expect(services).toContain('wire');
    expect(services).toContain('conductor');
    expect(services).toContain('assay');
    expect(services).toContain('exciter');
  });

  it('declares required provider dependencies', () => {
    manifest = loadManifest();
    const providers = manifest.dependencies.providers;
    expect(providers).toContain('journal');
    expect(providers).toContain('lithograph');
  });

  it('declares all 8 Claude Code hook types', () => {
    manifest = loadManifest();
    const hooks = manifest.hooks;
    expect(hooks.SessionStart).toBe(true);
    expect(hooks.UserPromptSubmit).toBe(true);
    expect(hooks.PreToolUse).toBe(true);
    expect(hooks.PostToolUse).toBe(true);
    expect(hooks.Stop).toBe(true);
    expect(hooks.PreCompact).toBe(true);
    expect(hooks.SubagentStart).toBe(true);
    expect(hooks.SubagentStop).toBe(true);
    expect(Object.keys(hooks).length).toBe(8);
  });
});
