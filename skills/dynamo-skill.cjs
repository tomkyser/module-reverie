'use strict';

/**
 * Dynamo platform dashboard skill.
 *
 * Conversational wrapper over existing Pulley CLI commands (per D-03).
 * Presents platform health, loaded modules, active services, and hook
 * status as a conversational summary rather than raw CLI output.
 *
 * Per D-01: /dynamo is a platform dashboard skill -- single skill,
 * conversational presentation. Not a namespace for subcommands.
 *
 * Per D-05: Registered via exciter.registerSkill() during Reverie module
 * registration.
 *
 * @module reverie/skills/dynamo-skill
 */

/**
 * Markdown content body for the /dynamo skill.
 *
 * Instructs Claude to run existing Pulley CLI commands and present
 * results conversationally -- not as raw CLI output.
 *
 * @type {string}
 */
const DYNAMO_SKILL_CONTENT = `# Dynamo Platform Dashboard

Show the user a conversational summary of the Dynamo platform state.

## Commands

1. Check platform status: \`bun bin/dynamo.cjs status\`
2. Run service health check: \`bun bin/dynamo.cjs health\`
3. View version info: \`bun bin/dynamo.cjs version\`
4. View configuration: \`bun bin/dynamo.cjs config\`
   - View specific key: \`bun bin/dynamo.cjs config <key>\`

## Presentation

- Platform lifecycle state (running/stopped/error)
- Loaded modules and their registration status
- Active services count and any unhealthy services
- Hook registration status (how many hook types wired)
- If any services are unhealthy, highlight them and suggest next steps
- If Dynamo is not booted, check config auto_init setting and advise accordingly

Present results conversationally -- not as raw CLI output. Summarize, highlight issues, suggest actions.`;

/**
 * Registers the /dynamo skill with the Exciter integration surface.
 *
 * @param {Object} exciter - Exciter service instance with registerSkill()
 * @returns {import('../../../lib/result.cjs').Result<{name: string, path: string}>}
 */
function registerDynamoSkill(exciter) {
  return exciter.registerSkill('dynamo', {
    description: 'Dynamo platform dashboard. Shows platform health, loaded modules, active services, hook status. Use when checking platform state or diagnosing issues.',
    content: DYNAMO_SKILL_CONTENT,
  });
}

module.exports = { registerDynamoSkill, DYNAMO_SKILL_CONTENT };
