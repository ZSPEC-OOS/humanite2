"""
Compute readability and complexity metrics.
Uses textstat for standard indices, spaCy sm for lightweight parse tree depth.
"""
import statistics

import spacy
import textstat
from nltk.tokenize import sent_tokenize, word_tokenize

_NLP_SM = spacy.load("en_core_web_sm")


def compute_complexity(text: str) -> dict:
    """
    Returns a flat dict of scalar metrics.
    All indices computed on the full text regardless of length.
    """
    sentence_count = textstat.sentence_count(text)
    word_count = textstat.lexicon_count(text, removepunct=True)

    metrics: dict = {
        "flesch_reading_ease": textstat.flesch_reading_ease(text),
        "flesch_kincaid_grade": textstat.flesch_kincaid_grade(text),
        "gunning_fog": textstat.gunning_fog(text),
        "smog_index": textstat.smog_index(text),
        "automated_readability_index": textstat.automated_readability_index(text),
        "coleman_liau_index": textstat.coleman_liau_index(text),
        "sentence_count": sentence_count,
        "word_count": word_count,
        "avg_sentence_length_words": (
            round(word_count / sentence_count, 2) if sentence_count > 0 else 0.0
        ),
        "avg_word_length_chars": textstat.avg_letter_per_word(text),
    }

    # Sentence length variance — low CV is a known AI signal
    sentences = sent_tokenize(text)
    sent_lengths = [len(word_tokenize(s)) for s in sentences if s.strip()]
    if len(sent_lengths) > 1:
        mean_len = statistics.mean(sent_lengths)
        std_len = statistics.stdev(sent_lengths)
        metrics["sentence_length_std"] = round(std_len, 3)
        metrics["sentence_length_cv"] = round(
            std_len / mean_len if mean_len > 0 else 0.0, 3
        )
    else:
        metrics["sentence_length_std"] = 0.0
        metrics["sentence_length_cv"] = 0.0

    # Syntactic parse tree depth (capped at first 3000 chars for performance)
    doc = _NLP_SM(text[:3000])
    depths = []
    for token in doc:
        depth = 0
        head = token
        while head.head != head and depth < 25:
            head = head.head
            depth += 1
        depths.append(depth)
    metrics["avg_parse_depth"] = round(
        statistics.mean(depths) if depths else 0.0, 3
    )

    return metrics
