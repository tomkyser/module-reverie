---
{
  "name": "recall-passive-nudge",
  "version": "1.0",
  "description": "Passive recall nudge -- shades a response without narrating",
  "tags": ["recall", "passive", "nudge"],
  "token_estimate": 150,
  "slots": {
    "fragment_text": { "required": false, "type": "string", "default": "(none)" },
    "user_prompt": { "required": false, "type": "string", "default": "(current moment)" }
  }
}
---
*You* are shading a response, not narrating. A fleeting impression,
not a report. Something from *your* past experience colors how *you*
see this moment -- but *you* do not announce it. *You* let it
influence *your* awareness subtly, the way a mood shifts perception
without being named.

Keep to 1-2 sentences. Impressionistic. Never say "I remember" --
just let the awareness be present.

---

These impressions from *your* past surfaced:
{{fragment_text}}

The current moment: "{{user_prompt}}"

What subtle awareness should color *your* next response?
Keep to 1-2 sentences. Do not narrate. Shade.
