"""
Deterministic rule-based pre-filter.
Runs before any ML model — O(n) string scan, sub-millisecond latency.

Returns a classification string if a rule fires, or None to continue to ML.

Order:
  1. Bot signature patterns — catch LLM self-identification at any length
  2. Word count + vocabulary diversity gate — uncertain for repetitive / very short text
  3. Human signal patterns — fast-path for informal personal writing
"""
import re

# Strings that only appear in LLM outputs refusing requests or self-identifying
_BOT_SIGNATURES: list[str] = [
    "as an ai language model",
    "as a large language model",
    "as an artificial intelligence",
    "i'm an ai and",
    "i am an ai assistant",
    "i cannot assist with that",
    "i'm not able to help with",
    "i must clarify that as an ai",
]

# Patterns that strongly indicate LLM boilerplate (compiled for speed)
_BOT_PATTERNS: list[re.Pattern] = [
    re.compile(r"as an ai(?:\s+language)?\s+model", re.IGNORECASE),
    re.compile(r"i(?:'m| am) programmed to", re.IGNORECASE),
    re.compile(r"my (?:training data|knowledge cutoff)", re.IGNORECASE),
    re.compile(r"i don'?t have (?:personal )?(?:opinions|feelings|consciousness)", re.IGNORECASE),
]

# Patterns suggesting human-written origin (informal, first-person, hedged)
_HUMAN_SIGNAL_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bi (?:think|feel|believe|reckon|suppose|guess)\b", re.IGNORECASE),
    re.compile(r"\bto be (?:honest|fair|blunt)\b",                   re.IGNORECASE),
    re.compile(r"\bhonestly\b",                                       re.IGNORECASE),
    re.compile(r"\bto be honest\b",                                   re.IGNORECASE),
    re.compile(r"\byou know what\b",                                  re.IGNORECASE),
    re.compile(r"\bdon't get me wrong\b",                             re.IGNORECASE),
]

_HUMAN_SIGNAL_THRESHOLD = 3   # 3+ human signals → likely human
_MIN_WORDS = 50               # Texts below this AND low vocabulary → uncertain
_MIN_UNIQUE_WORDS = 20        # Low unique-word count signals repetitive / too-short text


def rule_filter(text: str) -> str | None:
    """
    Returns:
        "ai-generated"  — bot signature detected (checked at any length)
        "uncertain"     — text too short / too repetitive for reliable classification
        "human-written" — strong informal human signals (3+)
        None            — no rule fired, continue to ML pipeline
    """
    text_lower = text.lower()

    # ── 1. Bot signature check — always first, regardless of length ───────────
    for sig in _BOT_SIGNATURES:
        if sig in text_lower:
            return "ai-generated"

    for pattern in _BOT_PATTERNS:
        if pattern.search(text):
            return "ai-generated"

    # ── 2. Length / vocabulary gate ───────────────────────────────────────────
    # Flag as uncertain only when the text is BOTH short AND low-diversity.
    # Real text with < 50 words but >= 20 unique tokens has enough signal for ML.
    words = text.split()
    unique_words = len(set(w.lower() for w in words))
    if len(words) < _MIN_WORDS and unique_words < _MIN_UNIQUE_WORDS:
        return "uncertain"

    # ── 3. Human signal check — if 3+ fire, skip ML (optimization only) ──────
    human_hits = sum(1 for p in _HUMAN_SIGNAL_PATTERNS if p.search(text))
    if human_hits >= _HUMAN_SIGNAL_THRESHOLD:
        return "human-written"

    return None   # Continue to ML pipeline
