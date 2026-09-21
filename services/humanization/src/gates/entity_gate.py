"""
Named entity overlap gate.
Ensures the rewritten text preserves all named entities from the original.
Threshold: overlap >= 0.95 (allows for very minor casing normalization)
"""
import logging

import spacy

logger = logging.getLogger(__name__)

_nlp = spacy.load("en_core_web_lg")
THRESHOLD = 0.95


def check_entity_overlap(original: str, rewritten: str) -> tuple[bool, float]:
    """
    Returns (passed, overlap_ratio).
    If original has no named entities, returns (True, 1.0) — gate trivially passes.
    """
    orig_doc = _nlp(original[:5000])
    rew_doc  = _nlp(rewritten[:5000])

    orig_ents = {ent.text.lower().strip() for ent in orig_doc.ents}
    rew_ents  = {ent.text.lower().strip() for ent in rew_doc.ents}

    if not orig_ents:
        return True, 1.0

    overlap = len(orig_ents & rew_ents) / len(orig_ents)
    passed  = overlap >= THRESHOLD
    logger.debug(
        "Entity gate overlap=%.4f threshold=%.2f passed=%s orig=%d rew=%d",
        overlap, THRESHOLD, passed, len(orig_ents), len(rew_ents),
    )
    return passed, overlap
