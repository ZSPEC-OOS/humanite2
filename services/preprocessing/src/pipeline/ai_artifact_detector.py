"""
Detect vocabulary and structural patterns strongly associated with LLM output.

These are NOT content policy violations — they are signals fed to the
humanization engine and scanner. High flag counts increase humanization
intensity and inform the scanner's prior probability.
"""
import re
from dataclasses import dataclass

# Pattern → descriptive tag
_OPENER_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bFurthermore\b', re.IGNORECASE), "transition:furthermore"),
    (re.compile(r'\bMoreover\b', re.IGNORECASE), "transition:moreover"),
    (re.compile(r'\bAdditionally\b', re.IGNORECASE), "transition:additionally"),
    (re.compile(r'\bIn conclusion\b', re.IGNORECASE), "transition:in_conclusion"),
    (re.compile(r'\bIn summary\b', re.IGNORECASE), "transition:in_summary"),
    (re.compile(r'\bTo summarize\b', re.IGNORECASE), "transition:to_summarize"),
    (re.compile(
        r'\bIt is (?:important|crucial|worth(?:while)?|essential) to (?:note|mention|highlight|emphasize)\b',
        re.IGNORECASE,
    ), "meta_commentary:it_is_important"),
    (re.compile(
        r'\bThis (?:essay|paper|article|document|response|text) (?:will|aims|seeks|attempts)\b',
        re.IGNORECASE,
    ), "meta_commentary:document_declaration"),
    (re.compile(r'\bAs an AI\b', re.IGNORECASE), "identity:as_an_ai"),
    (re.compile(r'\bAs a large language model\b', re.IGNORECASE), "identity:as_llm"),
]

_VOCABULARY_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bdelve(?:s|d|ing)?\b', re.IGNORECASE), "vocab:delve"),
    (re.compile(r'\bleverage[sd]?\b', re.IGNORECASE), "vocab:leverage"),
    (re.compile(r'\butili[sz]e[sd]?\b', re.IGNORECASE), "vocab:utilize"),
    (re.compile(r'\brobust\b', re.IGNORECASE), "vocab:robust"),
    (re.compile(r'\bmultifaceted\b', re.IGNORECASE), "vocab:multifaceted"),
    (re.compile(r'\bcomprehensive\b', re.IGNORECASE), "vocab:comprehensive"),
    (re.compile(r'\bfacilitate[sd]?\b', re.IGNORECASE), "vocab:facilitate"),
    (re.compile(r'\boptimal(?:ly|ize[sd]?)?\b', re.IGNORECASE), "vocab:optimal"),
    (re.compile(r'\bseamless(?:ly)?\b', re.IGNORECASE), "vocab:seamless"),
    (re.compile(r'\bparadigm\b', re.IGNORECASE), "vocab:paradigm"),
    (re.compile(r'\bsynergy\b', re.IGNORECASE), "vocab:synergy"),
    (re.compile(r'\btransformative\b', re.IGNORECASE), "vocab:transformative"),
    (re.compile(r'\bgroundbreaking\b', re.IGNORECASE), "vocab:groundbreaking"),
    (re.compile(r'\bcutting[-\s]edge\b', re.IGNORECASE), "vocab:cutting_edge"),
    (re.compile(r'\bstate[-\s]of[-\s]the[-\s]art\b', re.IGNORECASE), "vocab:state_of_the_art"),
]


@dataclass
class AIArtifactResult:
    flags: list[str]
    flag_count: int
    opener_flags: list[str]
    vocabulary_flags: list[str]
    ai_signal_strength: float   # 0.0–1.0 normalized


def detect_ai_artifacts(text: str) -> AIArtifactResult:
    opener_flags: list[str] = []
    vocabulary_flags: list[str] = []

    for pattern, tag in _OPENER_PATTERNS:
        if pattern.search(text):
            opener_flags.append(tag)

    for pattern, tag in _VOCABULARY_PATTERNS:
        count = len(pattern.findall(text))
        if count > 0:
            vocabulary_flags.append(f"{tag}:×{count}")

    all_flags = opener_flags + vocabulary_flags
    # Normalize: 10+ flags → 1.0 signal strength
    strength = min(len(all_flags) / 10.0, 1.0)

    return AIArtifactResult(
        flags=all_flags,
        flag_count=len(all_flags),
        opener_flags=opener_flags,
        vocabulary_flags=vocabulary_flags,
        ai_signal_strength=round(strength, 3),
    )
