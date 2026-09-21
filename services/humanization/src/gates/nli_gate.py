"""
Natural Language Inference entailment gate.
Checks that the rewritten text is entailed by the original.
Threshold: entailment score >= 0.80
Model: facebook/bart-large-mnli
"""
import logging
from typing import Any

import torch
from transformers import pipeline as hf_pipeline

logger = logging.getLogger(__name__)

_DEVICE = 0 if torch.cuda.is_available() else -1
THRESHOLD = 0.80

# Lazy-loaded — initialised on first call, cached for lifetime of the process
_nli_pipe: Any = None


def _get_nli_pipe() -> Any:
    global _nli_pipe
    if _nli_pipe is None:
        logger.info("Loading facebook/bart-large-mnli NLI model…")
        _nli_pipe = hf_pipeline(
            "text-classification",
            model="facebook/bart-large-mnli",
            device=_DEVICE,
            top_k=None,         # Return all labels
        )
        logger.info("NLI model loaded.")
    return _nli_pipe


def check_nli(original: str, rewritten: str) -> tuple[bool, float]:
    """
    Returns (passed, entailment_score).
    Truncates to 1024 chars each to stay within model limits.
    """
    premise    = original[:1024]
    hypothesis = rewritten[:1024]

    # BART-MNLI uses </s></s> as separator
    input_text = f"{premise} </s></s> {hypothesis}"

    try:
        results: list[dict] = _get_nli_pipe()(input_text, truncation=True)
        entail_score = next(
            (r["score"] for r in results if r["label"].upper() == "ENTAILMENT"), 0.0
        )
        passed = entail_score >= THRESHOLD
        logger.debug("NLI entailment=%.4f threshold=%.2f passed=%s", entail_score, THRESHOLD, passed)
        return passed, entail_score
    except Exception as exc:
        logger.error("NLI gate raised exception type=%s", type(exc).__name__)
        raise
