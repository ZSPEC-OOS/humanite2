"""
RoBERTa-base binary classifier: human-written (0) vs ai-generated (1).
Model is loaded from the path specified in config — trained by train_phase5.py.
Falls back to a statistical heuristic if the model file does not exist
(development convenience only — production must have a trained model).
"""
import logging
import os

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from ..config import settings

logger = logging.getLogger(__name__)

LABEL_MAP = {0: "human-written", 1: "ai-generated"}
_MAX_LENGTH = 512

_tokenizer: AutoTokenizer | None = None
_model: AutoModelForSequenceClassification | None = None
_model_available = False


def _load_model() -> None:
    global _tokenizer, _model, _model_available
    model_path = settings.scanner_model_path

    if not os.path.isdir(model_path):
        logger.warning(
            "Scanner model not found at %s. "
            "Run ml/training/scanner/train_phase5.py first. "
            "Using statistical fallback until model is available.",
            model_path,
        )
        _model_available = False
        return

    try:
        _tokenizer = AutoTokenizer.from_pretrained(model_path)
        _model     = AutoModelForSequenceClassification.from_pretrained(model_path)
        _model.eval()
        _model_available = True
        logger.info("Scanner model loaded from %s", model_path)
    except Exception as exc:
        logger.error("Failed to load scanner model. type=%s", type(exc).__name__)
        _model_available = False


def _statistical_fallback(text: str) -> dict:
    """
    Heuristic classifier used only when the trained model is unavailable.
    Uses AI vocabulary density and transition word frequency as a crude signal.
    Not suitable for production.
    """
    from .features import extract_features, FEATURE_NAMES
    features = extract_features(text)
    feat_dict = dict(zip(FEATURE_NAMES, features))

    ai_score = (
        feat_dict["ai_vocab_density"] * 30.0 +
        feat_dict["transition_density"] * 0.4 +
        (1.0 - feat_dict["sentence_length_cv"]) * 0.3
    )
    ai_prob    = float(min(ai_score, 1.0))
    human_prob = 1.0 - ai_prob

    return {
        "classification": "ai-generated" if ai_prob > 0.55 else "human-written",
        "confidence": max(ai_prob, human_prob),
        "human_probability": human_prob,
        "ai_probability": ai_prob,
        "model_used": "statistical_fallback",
    }


def classify(text: str) -> dict:
    """
    Returns classification dict with probabilities.
    If confidence < threshold, classification is overridden to 'uncertain'.
    """
    if not _model_available:
        return _statistical_fallback(text)

    assert _tokenizer is not None
    assert _model is not None

    inputs = _tokenizer(
        text,
        max_length=_MAX_LENGTH,
        truncation=True,
        return_tensors="pt",
        padding=True,
    )

    with torch.no_grad():
        logits = _model(**inputs).logits

    probs      = torch.softmax(logits, dim=-1)[0]
    human_prob = float(probs[0])
    ai_prob    = float(probs[1])
    max_prob   = max(human_prob, ai_prob)
    pred_idx   = int(torch.argmax(probs))

    if max_prob < settings.confidence_threshold_certain:
        classification = "uncertain"
    else:
        classification = LABEL_MAP[pred_idx]

    return {
        "classification": classification,
        "confidence": round(max_prob, 4),
        "human_probability": round(human_prob, 4),
        "ai_probability": round(ai_prob, 4),
        "model_used": settings.scanner_model_path,
    }
