"""
Extract 18 statistical features from text.
These are language-agnostic signals that distinguish human and AI writing
at the distributional level, independent of content.

Feature groups:
  Lexical (4):    TTR, avg word length, hapax ratio, content/function word ratio
  Sentence (5):   avg length, std dev, CV, burstiness index, count
  Punctuation (3): comma density, period density, punctuation entropy
  Discourse (3):  transition word density, AI vocabulary density, passive ratio
  Syntactic (3):  avg parse depth, subordinate clause ratio, nominalization ratio
"""
import math
import re
import string
from collections import Counter

import numpy as np
import spacy
from nltk.tokenize import sent_tokenize, word_tokenize

_nlp = spacy.load("en_core_web_sm", disable=["ner"])   # NER not needed here

_TRANSITION_WORDS: frozenset[str] = frozenset({
    "furthermore", "moreover", "additionally", "however", "nevertheless",
    "consequently", "therefore", "thus", "hence", "subsequently",
    "in conclusion", "in summary", "to summarize", "in addition",
    "on the other hand", "as a result", "for instance", "for example",
})

_AI_VOCABULARY: frozenset[str] = frozenset({
    "leverage", "utilize", "facilitate", "robust", "multifaceted",
    "comprehensive", "seamless", "paradigm", "synergy", "transformative",
    "groundbreaking", "cutting-edge", "state-of-the-art", "optimal",
    "innovative", "streamline", "holistic", "dynamic", "proactive",
})

_FUNCTION_POS: frozenset[str] = frozenset({
    "ADP", "AUX", "CCONJ", "DET", "PART", "PRON", "SCONJ",
})

FEATURE_NAMES: list[str] = [
    "ttr",
    "avg_word_length",
    "hapax_ratio",
    "content_function_ratio",
    "avg_sentence_length",
    "sentence_length_std",
    "sentence_length_cv",
    "burstiness_index",
    "sentence_count",
    "comma_density",
    "period_density",
    "punct_entropy",
    "transition_density",
    "ai_vocab_density",
    "passive_ratio",
    "avg_parse_depth",
    "subclause_ratio",
    "nominalization_ratio",
]


def extract_features(text: str) -> np.ndarray:
    """Returns a (18,) float32 feature vector."""
    words_all   = word_tokenize(text.lower())
    words_alpha = [w for w in words_all if w.isalpha()]
    sentences   = sent_tokenize(text)
    doc         = _nlp(text[:8000])   # Cap for performance

    n_words = max(len(words_alpha), 1)
    n_sents = max(len(sentences), 1)
    n_chars = max(len(text), 1)

    # ── Lexical ───────────────────────────────────────────────────────────────
    unique_words = set(words_alpha)
    ttr = len(unique_words) / n_words

    avg_word_length = sum(len(w) for w in words_alpha) / n_words

    freq = Counter(words_alpha)
    hapax_ratio = sum(1 for c in freq.values() if c == 1) / n_words

    content_count  = sum(1 for t in doc if t.pos_ not in _FUNCTION_POS and t.is_alpha)
    function_count = sum(1 for t in doc if t.pos_ in _FUNCTION_POS)
    content_function_ratio = content_count / max(function_count, 1)

    # ── Sentence-level ────────────────────────────────────────────────────────
    sent_lengths = [len(word_tokenize(s)) for s in sentences]
    avg_sentence_length = sum(sent_lengths) / n_sents

    if len(sent_lengths) > 1:
        sentence_length_std = float(np.std(sent_lengths, ddof=1))
    else:
        sentence_length_std = 0.0

    sentence_length_cv = (
        sentence_length_std / avg_sentence_length if avg_sentence_length > 0 else 0.0
    )

    # Burstiness: (σ - μ) / (σ + μ) — negative = regular (AI), positive = bursty (human)
    mu, sigma = avg_sentence_length, sentence_length_std
    burstiness_index = (sigma - mu) / (sigma + mu + 1e-9)

    sentence_count = float(n_sents)

    # ── Punctuation ───────────────────────────────────────────────────────────
    punct_counts = Counter(c for c in text if c in string.punctuation)
    comma_density  = punct_counts.get(",", 0) / n_chars
    period_density = punct_counts.get(".", 0) / n_chars

    common_punct = [",", ".", ";", ":", "!", "?", "-", "—"]
    punct_freqs  = [punct_counts.get(p, 0) / n_chars for p in common_punct]
    total_punct  = sum(punct_freqs) + 1e-9
    punct_probs  = [f / total_punct for f in punct_freqs]
    punct_entropy = -sum(p * math.log2(p + 1e-9) for p in punct_probs)

    # ── Discourse ─────────────────────────────────────────────────────────────
    text_lower = text.lower()
    transition_hits = sum(1 for tw in _TRANSITION_WORDS if tw in text_lower)
    transition_density = transition_hits / n_sents

    ai_vocab_hits = sum(text_lower.count(w) for w in _AI_VOCABULARY)
    ai_vocab_density = ai_vocab_hits / n_words

    passive_count = sum(1 for t in doc if t.dep_ == "nsubjpass")
    passive_ratio = passive_count / n_sents

    # ── Syntactic ─────────────────────────────────────────────────────────────
    depths: list[int] = []
    for token in doc:
        depth, head = 0, token
        while head.head != head and depth < 25:
            head = head.head
            depth += 1
        depths.append(depth)
    avg_parse_depth = float(np.mean(depths)) if depths else 0.0

    # Subordinate clauses: tokens with dep_ in advcl, relcl, ccomp, xcomp
    subclause_deps = {"advcl", "relcl", "ccomp", "xcomp"}
    subclause_count = sum(1 for t in doc if t.dep_ in subclause_deps)
    subclause_ratio = subclause_count / n_sents

    # Nominalizations: nouns ending in -tion, -ment, -ness, -ity, -ism, -ance
    _nom_re = re.compile(r'(?:tion|ment|ness|ity|ism|ance|ence)$', re.IGNORECASE)
    nom_count = sum(1 for t in doc if t.pos_ == "NOUN" and _nom_re.search(t.text))
    nominalization_ratio = nom_count / n_words

    features = np.array([
        ttr, avg_word_length, hapax_ratio, content_function_ratio,
        avg_sentence_length, sentence_length_std, sentence_length_cv, burstiness_index,
        sentence_count,
        comma_density, period_density, punct_entropy,
        transition_density, ai_vocab_density, passive_ratio,
        avg_parse_depth, subclause_ratio, nominalization_ratio,
    ], dtype=np.float32)

    return features
