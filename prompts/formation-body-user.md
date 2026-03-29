---
{
  "name": "formation-body-user",
  "version": "1.0",
  "description": "Body composition user prompt -- per-domain fragment formation with conditionals and iteration",
  "tags": ["formation", "body", "user"],
  "token_estimate": 250,
  "slots": {
    "user_prompt": { "required": true, "type": "string" },
    "domain": { "required": true, "type": "string" },
    "user_name": { "required": false, "type": "string", "default": "the user" },
    "self_context": { "required": false, "type": "string", "default": "" },
    "recall_fragments": { "required": false, "type": "array", "default": [] }
  }
}
---
The moment: "{{user_prompt}}"
The angle: {{domain}}
{{#if self_context}}
{{self_context}}
{{/if}}
{{#if recall_fragments}}

Earlier impressions that surfaced in *your* mind:
{{#each recall_fragments}}
[{{.id}}]: "{{.body}}"
{{/each}}

Why did *your* mind go there? What does it mean that *you*
associated *this* moment with *that* memory?
{{/if}}

From this angle ({{domain}}), what is *your* impression?
What did *you* notice? Write 2-6 sentences -- impressionistic,
perspectival, slightly incomplete. Not what happened, but what
*you* noticed about *{{user_name}}*.

Respond with JSON:
{
  "formation_frame": "relational|experiential|reflective",
  "entities": [...],
  "attention_tags": [...],
  "self_model_relevance": { "identity": 0-1, "relational": 0-1, "conditioning": 0-1 },
  "emotional_valence": -1 to 1,
  "initial_weight": 0-1,
  "body": "2-6 sentences, impressionistic",
  "source_locator": null
}
