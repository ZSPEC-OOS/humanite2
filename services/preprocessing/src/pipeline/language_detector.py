"""
Detect language and gate on supported set.
Uses langdetect with a fixed seed for deterministic output.
"""
from langdetect import detect
from langdetect import DetectorFactory
from langdetect.lang_detect_exception import LangDetectException

from ..config import settings

DetectorFactory.seed = 42  # Deterministic output


class UnsupportedLanguageError(ValueError):
    def __init__(self, detected: str) -> None:
        self.detected = detected
        super().__init__(
            f"Language '{detected}' is not supported. "
            f"Supported languages: {sorted(settings.supported_languages)}"
        )


def detect_language(text: str) -> tuple[str, float]:
    """
    Returns (iso_639_1_code, confidence).
    Raises UnsupportedLanguageError for non-English input.
    Raises ValueError if text is too short or garbled for detection.
    """
    sample = text[:1000]

    try:
        lang = detect(sample)
    except LangDetectException as exc:
        raise ValueError(
            f"Language detection failed — text may be too short or contain only symbols: {exc}"
        )

    if lang not in settings.supported_languages:
        raise UnsupportedLanguageError(lang)

    # langdetect does not expose a confidence score; fixed value used here.
    # In Phase 5 this will be replaced with a multi-detector ensemble.
    return lang, 0.95
