"""
Deterministic post-processing applied AFTER LLM output and BEFORE quality gates.
Catches vocabulary that the LLM missed despite being instructed to replace it.
Does NOT touch any span that appears in the fact locks.
"""
import re
from dataclasses import dataclass


@dataclass
class PostprocessResult:
    text: str
    substitutions_made: int


# (pattern, replacement) pairs — applied in order
# Only plain-text substitutions; regex groups not used to keep this auditable
_SUBSTITUTIONS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\butilize[sd]?\b', re.IGNORECASE),    "use"),
    (re.compile(r'\butilizing\b',    re.IGNORECASE),    "using"),
    (re.compile(r'\bdelve[sd]?\b',   re.IGNORECASE),    "explore"),
    (re.compile(r'\bdelving\b',      re.IGNORECASE),    "exploring"),
    (re.compile(r'\brobust\b',       re.IGNORECASE),    "strong"),
    (re.compile(r'\bmultifaceted\b', re.IGNORECASE),    "complex"),
    (re.compile(r'\bfacilitate[sd]?\b', re.IGNORECASE), "enable"),
    (re.compile(r'\bfacilitating\b', re.IGNORECASE),    "enabling"),
    # Sentence-opener transitions — only at the start of a sentence
    (re.compile(r'(?m)^Furthermore,\s+', re.IGNORECASE),    ""),
    (re.compile(r'(?m)^Moreover,\s+',    re.IGNORECASE),    ""),
    (re.compile(r'(?m)^Additionally,\s+',re.IGNORECASE),    ""),
    (re.compile(r'(?m)^In conclusion,\s+',re.IGNORECASE),   ""),
    (re.compile(r'\bIt is important to note that\b', re.IGNORECASE), ""),
]


def _build_locked_spans(fact_locks: list[dict]) -> list[tuple[int, int]]:
    return [(l["char_start"], l["char_end"]) for l in fact_locks]


def _is_inside_lock(start: int, end: int, locked_spans: list[tuple[int, int]]) -> bool:
    return any(ls <= start and end <= le for ls, le in locked_spans)


def postprocess(text: str, fact_locks: list[dict]) -> PostprocessResult:
    # Mutable copy — updated as each substitution shifts character positions
    locked_spans = list(_build_locked_spans(fact_locks))
    substitution_count = 0

    for pattern, replacement in _SUBSTITUTIONS:
        new_text = text
        offset = 0
        for m in list(pattern.finditer(text)):
            adj_start = m.start() + offset
            adj_end   = m.end()   + offset
            if _is_inside_lock(adj_start, adj_end, locked_spans):
                continue
            new_text = new_text[:adj_start] + replacement + new_text[adj_end:]
            delta = len(replacement) - (m.end() - m.start())
            # Shift every locked span that starts after the substitution point
            locked_spans = [
                (ls + delta if ls > adj_start else ls,
                 le + delta if le > adj_start else le)
                for ls, le in locked_spans
            ]
            offset += delta
            substitution_count += 1
        text = new_text

    return PostprocessResult(text=text.strip(), substitutions_made=substitution_count)
