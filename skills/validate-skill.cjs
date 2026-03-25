'use strict';

/**
 * Dynamo E2E validation skill.
 *
 * Conversational wrapper that orchestrates end-to-end validation of the
 * Dynamo + Reverie platform installation (per D-16).
 *
 * Runs the integration test harness and presents pass/fail results per
 * success criterion. This is the go-live gate per D-17.
 *
 * Per D-05: Registered via exciter.registerSkill() during Reverie module
 * registration.
 *
 * @module reverie/skills/validate-skill
 */

/**
 * Markdown content body for the /dynamo-validate skill.
 *
 * Instructs Claude to run the E2E validation harness and present
 * go-live readiness assessment per success criteria.
 *
 * @type {string}
 */
const VALIDATE_SKILL_CONTENT = `# Dynamo E2E Validation

Run end-to-end validation of the Dynamo + Reverie platform installation.

## Steps

1. Run the integration test harness:
   \`bun test modules/reverie/validation/ --reporter=default\`
2. Parse the test output and report results per success criterion:
   - SC-1: Module discovery and automatic registration
   - SC-2: Claude Code hooks fire through Exciter/Armature into Reverie
   - SC-3: Skills are registered and accessible
   - SC-4: Session triplet spawning with Wire topology
   - SC-5: Multi-triplet isolation (Wire registry + Switchboard scoping)
   - SC-6: Full lifecycle (boot -> load -> hooks -> personality -> formation -> recall -> REM)
3. Present pass/fail for each criterion with evidence
4. If all green: "Platform validation passed. Go-live gate clear."
5. If any red: "Validation failed on: [criteria]. These must be fixed before go-live."
6. Write checkpoint log: run \`bun run modules/reverie/validation/checkpoint-log.cjs\` to persist results

This is the go-live gate per D-17. All 6 success criteria must be green.`;

/**
 * Registers the /dynamo-validate skill with the Exciter integration surface.
 *
 * @param {Object} exciter - Exciter service instance with registerSkill()
 * @returns {import('../../../lib/result.cjs').Result<{name: string, path: string}>}
 */
function registerValidateSkill(exciter) {
  return exciter.registerSkill('dynamo-validate', {
    description: 'Run end-to-end validation of Dynamo + Reverie installation. Checks all success criteria for go-live readiness.',
    content: VALIDATE_SKILL_CONTENT,
  });
}

module.exports = { registerValidateSkill, VALIDATE_SKILL_CONTENT };
