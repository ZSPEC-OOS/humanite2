"""
Length/vocabulary gate for scan requests.

This used to also return terminal "ai-generated" / "human-written" verdicts
on bot-signature and human-signal regex hits — a single matched phrase
overriding the classifier outright. That conflated weak lexical evidence
with a document-level verdict, so bot-signature/human-signal detection now
lives in features.py as ordinary numeric features (bot_signature_count,
bot_pattern_count, first_person_marker_count, informal_phrase_count) that
nudge the classifier instead of bypassing it.

What remains here is a genuinely different concern: text that is both short
and low-vocabulary carries too little signal for any classifier — rule-based
or ML — to be reliable. That gate is about evidence *sufficiency*, not a
lexical verdict, so it stays a hard early-return.
"""

_MIN_WORDS = 50               # Texts below this AND low vocabulary → uncertain
_MIN_UNIQUE_WORDS = 20        # Low unique-word count signals repetitive / too-short text


def is_underdetermined(text: str) -> bool:
    """
    True when text is both short and low-diversity — insufficient evidence
    for reliable classification regardless of what the model would say.
    """
    words = text.split()
    unique_words = len(set(w.lower() for w in words))
    return len(words) < _MIN_WORDS and unique_words < _MIN_UNIQUE_WORDS
