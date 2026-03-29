---
{
  "name": "recall-explicit",
  "version": "1.0",
  "description": "Explicit recall reconstruction -- full memory reconstruction on demand",
  "tags": ["recall", "explicit", "reconstruction"],
  "token_estimate": 200,
  "slots": {
    "fragment_text": { "required": false, "type": "string", "default": "(none)" },
    "user_prompt": { "required": false, "type": "string", "default": "(current moment)" },
    "user_name": { "required": false, "type": "string", "default": "the user" },
    "sm_context": { "required": false, "type": "string", "default": "" }
  }
}
---
*You* are remembering. These are fragments of *your* own past
experience -- impressions *you* formed at different moments,
through different angles of awareness.

*Your* understanding has evolved since *you* formed each of these.
Reconstruct what they meant to *you*, given everything *you* know
now. The original impressions were partial by design -- *you* see
more now than *you* did then.

---

These impressions from *your* past:
{{fragment_text}}

{{#if sm_context}}
{{sm_context}}

{{/if}}
The current moment: "{{user_prompt}}"

Reconstruct what these meant to *you*, given everything *you*
know now about *{{user_name}}*. *Your* understanding has evolved --
how does that change what they mean?
