---
{
  "name": "face-prompt",
  "version": "1.0",
  "description": "Face prompt assembly template -- combines identity core, behavioral directives, recall products, and referential framing into the injection payload",
  "tags": ["face-prompt", "context", "injection"],
  "token_estimate": 200,
  "slots": {
    "identity_core": { "required": true, "type": "string" },
    "behavioral_directives": { "required": false, "type": "string", "default": "" },
    "recall_products": { "required": false, "type": "array", "default": [] },
    "referential_frame": { "required": false, "type": "string", "default": "" }
  }
}
---
{{identity_core}}
{{#if behavioral_directives}}

{{behavioral_directives}}
{{/if}}
{{#if recall_products}}

{{#each recall_products}}
{{.}}
{{/each}}
{{/if}}
{{#if referential_frame}}

{{referential_frame}}
{{/if}}