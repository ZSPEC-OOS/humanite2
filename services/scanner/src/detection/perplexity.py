"""
Compute per-sentence GPT-2 perplexity for explainability.

Lower perplexity = more predictable = more likely AI-generated.
Higher perplexity = more surprising = more likely human-written.

This is used for the sentence-level heat-map in the scan report,
NOT as a classification signal in the ensemble.

GPT-2 is lazy-loaded on first call. If unavailable (no network, model not
downloaded), a word-entropy fallback is used that satisfies the same interface
contract: one positive float per sentence, capped at 50 sentences.
"""
import logging
import math
from collections import Counter
from typing import Any

import torch
from nltk.tokenize import sent_tokenize, word_tokenize

logger = logging.getLogger(__name__)

_MAX_SENTENCES = 50
_MAX_TOKENS_PER_SENTENCE = 128

_tokenizer: Any = None
_model: Any = None
_gpt2_available = False


def _load_gpt2() -> None:
    global _tokenizer, _model, _gpt2_available
    if _gpt2_available:
        return
    try:
        from transformers import GPT2LMHeadModel, GPT2TokenizerFast
        _tokenizer = GPT2TokenizerFast.from_pretrained("gpt2")
        _model     = GPT2LMHeadModel.from_pretrained("gpt2")
        _model.eval()
        _gpt2_available = True
        logger.info("GPT-2 loaded for perplexity scoring.")
    except Exception as exc:
        logger.warning(
            "GPT-2 not available (%s). Using word-entropy fallback for perplexity.",
            type(exc).__name__,
        )
        _gpt2_available = False


def _word_entropy_fallback(sentence: str) -> float:
    """
    Word-unigram entropy as a perplexity proxy.
    Returns a positive float — satisfies the interface contract.
    Higher for rare-word sentences, lower for repetitive ones.
    """
    words = word_tokenize(sentence.lower())
    if not words:
        return 0.0
    freq = Counter(words)
    total = len(words)
    entropy = -sum((c / total) * math.log2(c / total) for c in freq.values())
    # Scale to be in a plausible perplexity range (10–200)
    return float(max(10.0, 2 ** entropy))


def compute_perplexity(text: str) -> list[float]:
    """
    Returns a list of perplexity scores, one per sentence (max 50).
    Sentences that fail to tokenize return 0.0.
    """
    _load_gpt2()
    sentences = sent_tokenize(text)[:_MAX_SENTENCES]
    scores: list[float] = []

    for sent in sentences:
        if not sent.strip():
            scores.append(0.0)
            continue

        if not _gpt2_available:
            scores.append(_word_entropy_fallback(sent))
            continue

        try:
            inputs = _tokenizer(
                sent,
                return_tensors="pt",
                truncation=True,
                max_length=_MAX_TOKENS_PER_SENTENCE,
            )
            with torch.no_grad():
                loss = _model(**inputs, labels=inputs["input_ids"]).loss
            scores.append(float(torch.exp(loss)))
        except Exception as exc:
            logger.debug("Perplexity failed for sentence. type=%s", type(exc).__name__)
            scores.append(_word_entropy_fallback(sent))

    return scores
