"""
BERTScore semantic similarity gate.
Threshold: F1 >= 0.92
Uses roberta-large for highest accuracy.
Model is cached after first load — never reloaded per request.
"""
import logging

import torch
from bert_score import score as _bertscore

logger = logging.getLogger(__name__)

_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
_MODEL_TYPE = "roberta-large"
THRESHOLD = 0.92


def check_bertscore(original: str, rewritten: str) -> tuple[bool, float]:
    """
    Returns (passed, f1_score).
    Runs on CPU in development — ~3s per call. GPU reduces to ~0.3s.
    """
    try:
        _, _, F1 = _bertscore(
            cands=[rewritten],
            refs=[original],
            lang="en",
            model_type=_MODEL_TYPE,
            device=_DEVICE,
            verbose=False,
            rescale_with_baseline=False,
        )
        f1 = float(F1[0])
        passed = f1 >= THRESHOLD
        logger.debug("BERTScore F1=%.4f threshold=%.2f passed=%s", f1, THRESHOLD, passed)
        return passed, f1
    except Exception as exc:
        # Gate failure is a hard stop — do not pass on exception
        logger.error("BERTScore gate raised exception type=%s", type(exc).__name__)
        raise
