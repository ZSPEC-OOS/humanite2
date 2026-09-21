"""
Build system + user prompts for the humanization LLM call.
Fact locks are injected as hard constraints in the user prompt.
The system prompt instructs the LLM never to alter locked spans.
"""
from jinja2 import Environment, BaseLoader

_SYSTEM_PROMPT = """\
You are a professional editor. Your only job is to rewrite the provided text \
so it reads as natural, fluent human prose. You must:
- Preserve every fact, number, name, date, citation, and technical term exactly as written.
- Never add information that is not in the original.
- Never correct factual errors — your job is style, not content.
- Never remove content — only restructure and rephrase.
- Output ONLY the rewritten text. No preamble, no commentary, no explanation."""

_USER_TEMPLATE = """\
## HARD CONSTRAINTS — DO NOT ALTER THESE EXACT STRINGS
The following spans must appear in your output verbatim (identical spelling, \
capitalisation, punctuation, and spacing):
{% for lock in fact_locks %}
- "{{ lock.text }}" [{{ lock.lock_type }}/{{ lock.label }}]
{% endfor %}
{% if not fact_locks %}
- (no explicit locks — still preserve all numbers, names, and dates exactly)
{% endif %}

## STYLE PARAMETERS
Tone: {{ tone }}
Domain: {{ domain }}
Intensity: {{ intensity }}/10
{% if intensity <= 3 %}
Apply minimal changes — fix only the most obvious AI patterns (flatten transition \
word overuse, reduce passive voice). Keep structure identical.
{% elif intensity <= 6 %}
Apply moderate rewriting — vary sentence rhythm, replace AI-typical vocabulary, \
restructure for flow. Preserve all paragraph breaks.
{% else %}
Apply thorough rewriting — diversify sentence lengths aggressively (mix 6-word \
fragments with 28-word sentences), add natural register markers (parentheticals, \
em-dashes, rhetorical questions where appropriate), replace all AI-typical openers \
and vocabulary. Preserve paragraph structure.
{% endif %}

## VOCABULARY SUBSTITUTIONS (mandatory at all intensity levels)
Replace these words wherever they appear, unless they are inside a locked span:
- "utilize" → "use"
- "leverage" (verb) → "apply" or "use"
- "delve into" → "explore" or "look into"
- "robust" (generic) → "strong", "reliable", or "solid"
- "multifaceted" → "complex" or "varied"
- "comprehensive" → "thorough" or "complete"
- "facilitate" → "help" or "enable"
- "Furthermore," (sentence opener) → remove or replace with natural connector
- "Moreover," (sentence opener) → remove or replace with natural connector
- "Additionally," (sentence opener) → remove or replace with natural connector
- "In conclusion," → remove; restructure the closing sentence naturally
- "It is important to note that" → remove; integrate the content directly

## INPUT TEXT
{{ input_text }}"""

_env = Environment(loader=BaseLoader(), autoescape=False)
_template = _env.from_string(_USER_TEMPLATE)


def build_prompt(
    text: str,
    fact_locks: list[dict],
    intensity: int = 5,
    tone: str = "balanced",
    domain: str = "general",
) -> tuple[str, str]:
    """Returns (system_prompt, user_prompt)."""
    user_prompt = _template.render(
        fact_locks=fact_locks,
        tone=tone,
        domain=domain,
        intensity=intensity,
        input_text=text,
    )
    return _SYSTEM_PROMPT, user_prompt
