"""
Extract immutable fact locks from text using spaCy NER + regex fallback.

A fact lock represents content the humanization engine MUST NOT alter:
- Named entities (persons, orgs, dates, locations, money, percentages, events)
- Explicit numeric values with or without units
- Negation spans (the entire predicate containing "not", "never", "cannot")
- Citation-like patterns ([1], (Smith, 2024), etc.)
"""
import re
from dataclasses import dataclass, field

import spacy

# Load once at module level — never reload per request
_NLP_LG = spacy.load("en_core_web_lg")

# spaCy entity labels to lock
_ENTITY_LOCK_LABELS: frozenset[str] = frozenset({
    "PERSON", "ORG", "GPE", "LOC", "FAC",
    "DATE", "TIME",
    "CARDINAL", "ORDINAL",
    "MONEY", "PERCENT", "QUANTITY",
    "EVENT", "WORK_OF_ART", "LAW", "PRODUCT",
})

# Numeric patterns not caught by NER (units, decimals, ranges)
_NUMBER_RE = re.compile(
    r'\b\d{1,3}(?:,\d{3})*(?:\.\d+)?'
    r'(?:\s*(?:%|°[CF]|km|m|cm|mm|kg|g|mg|'
    r'lb|oz|ml|l|L|USD|EUR|GBP|JPY|CAD|AUD|'
    r'mph|kph|Hz|MHz|GHz|TB|GB|MB|KB))?\b'
)

# Citation patterns
_CITATION_RE = re.compile(
    r'(?:\[\d+(?:,\s*\d+)*\]'
    r'|\(\w[\w\s,\.]+,\s*\d{4}\)'
    r'|et\s+al\.\s*(?:\(\d{4}\)|\[\d+\]))'
)

# Negation dependency labels in spaCy
_NEGATION_DEPS: frozenset[str] = frozenset({"neg"})


@dataclass
class FactLock:
    char_start: int
    char_end: int
    text: str
    lock_type: str      # "entity" | "number" | "negation" | "citation"
    label: str          # spaCy entity label, "NUM", "NEG", or "CITE"
    confidence: float
    metadata: dict = field(default_factory=dict)


def extract_fact_locks(text: str) -> list[FactLock]:
    """
    Run NER + regex pass over text and return sorted, non-overlapping fact locks.
    """
    doc = _NLP_LG(text)
    locks: list[FactLock] = []
    covered: set[tuple[int, int]] = set()

    def _overlaps(start: int, end: int) -> bool:
        return any(s <= start < e or s < end <= e for s, e in covered)

    # ── 1. Named entities from spaCy NER ─────────────────────────────────────
    for ent in doc.ents:
        if ent.label_ not in _ENTITY_LOCK_LABELS:
            continue
        span = (ent.start_char, ent.end_char)
        if _overlaps(*span):
            continue
        locks.append(FactLock(
            char_start=ent.start_char,
            char_end=ent.end_char,
            text=ent.text,
            lock_type="entity",
            label=ent.label_,
            confidence=0.95,
        ))
        covered.add(span)

    # ── 2. Numeric patterns not already covered by NER ────────────────────────
    for m in _NUMBER_RE.finditer(text):
        if _overlaps(m.start(), m.end()):
            continue
        locks.append(FactLock(
            char_start=m.start(),
            char_end=m.end(),
            text=m.group(),
            lock_type="number",
            label="NUM",
            confidence=0.99,
        ))
        covered.add((m.start(), m.end()))

    # ── 3. Citations ──────────────────────────────────────────────────────────
    for m in _CITATION_RE.finditer(text):
        if _overlaps(m.start(), m.end()):
            continue
        locks.append(FactLock(
            char_start=m.start(),
            char_end=m.end(),
            text=m.group(),
            lock_type="citation",
            label="CITE",
            confidence=0.99,
        ))
        covered.add((m.start(), m.end()))

    # ── 4. Negation spans ────────────────────────────────────────────────────
    for token in doc:
        if token.dep_ not in _NEGATION_DEPS:
            continue
        head = token.head
        span = doc[head.left_edge.i: head.right_edge.i + 1]
        if _overlaps(span.start_char, span.end_char):
            continue
        # Only lock if span is reasonably short (avoid locking entire sentences)
        if (span.end_char - span.start_char) > 120:
            continue
        locks.append(FactLock(
            char_start=span.start_char,
            char_end=span.end_char,
            text=span.text,
            lock_type="negation",
            label="NEG",
            confidence=0.90,
            metadata={"negation_token": token.text, "head_verb": head.text},
        ))
        covered.add((span.start_char, span.end_char))

    return sorted(locks, key=lambda lock: lock.char_start)
