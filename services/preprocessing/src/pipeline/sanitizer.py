"""
Strip malicious content, normalize encoding, remove steganographic artifacts.
Returns clean UTF-8 text. Optionally redacts PII patterns.
"""
import re
import unicodedata

# Zero-width and invisible characters sometimes used for covert watermarking
_ZERO_WIDTH = re.compile(
    r'[​‌‍‎‏‪-‮⁠-⁤﻿­]'
)

# Collapse 3+ consecutive spaces/tabs to a single space (keep newlines for paragraph detection)
_EXCESSIVE_SPACES = re.compile(r'[ \t]{3,}')

# Strip HTML tags
_HTML_TAGS = re.compile(r'<[^>]{0,500}>', re.DOTALL)

# Collapse 3+ consecutive newlines to two (one blank line)
_EXCESSIVE_NEWLINES = re.compile(r'\n{3,}')

# PII patterns — only applied when redact_pii=True
_PII_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b', re.IGNORECASE), '[EMAIL]'),
    (re.compile(r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'), '[PHONE]'),
    (re.compile(r'\b\d{3}-\d{2}-\d{4}\b'), '[SSN]'),
    (re.compile(r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b'), '[CARD]'),
]

# XSS / injection attempts — raise ValueError if found
_INJECTION_PATTERNS: list[re.Pattern] = [
    re.compile(r'<script', re.IGNORECASE),
    re.compile(r'javascript\s*:', re.IGNORECASE),
    re.compile(r'on\w{1,20}\s*=\s*["\']', re.IGNORECASE),
    re.compile(r'<!--.*?-->', re.DOTALL),
    re.compile(r'<\s*iframe', re.IGNORECASE),
]


def sanitize(text: str, redact_pii: bool = False) -> str:
    """
    Raises ValueError on injection attempts.
    Returns clean, normalized UTF-8 text.
    """
    # 1. Injection check — reject before any processing
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(text):
            raise ValueError("INJECTION_ATTEMPT: Input contains disallowed markup or script content.")

    # 2. Normalize to UTF-8 NFC (canonical composition)
    text = unicodedata.normalize("NFC", text)

    # 3. Remove zero-width and invisible characters
    text = _ZERO_WIDTH.sub("", text)

    # 4. Strip HTML tags
    text = _HTML_TAGS.sub("", text)

    # 5. Collapse excessive whitespace (preserve paragraph breaks)
    text = _EXCESSIVE_SPACES.sub(" ", text)
    text = _EXCESSIVE_NEWLINES.sub("\n\n", text)

    # 6. Optional PII redaction
    if redact_pii:
        for pattern, replacement in _PII_PATTERNS:
            text = pattern.sub(replacement, text)

    return text.strip()
