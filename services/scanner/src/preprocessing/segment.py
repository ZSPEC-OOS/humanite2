"""
Multi-window segmentation so classification covers the whole document
instead of truncating to the classifier's max input length (previously the
transformer's own 512-token cap meant only the first ~400 words of *any*
document were ever seen — see spec §11/§85).

Windows are defined over whitespace-delimited "tokens" purely for chunking
geometry — the classifier still subword-tokenizes each window's text
independently, and each window (<= a few hundred words) comfortably fits
under that limit.
"""
from dataclasses import dataclass


@dataclass
class Window:
    index: int
    start_char: int
    end_char: int
    start_token: int   # inclusive, word-token index
    end_token: int      # exclusive, word-token index
    text: str


def word_token_spans(text: str) -> list[tuple[int, int]]:
    """Return (start_char, end_char) for each whitespace-delimited token."""
    spans: list[tuple[int, int]] = []
    i, n = 0, len(text)
    while i < n:
        while i < n and text[i].isspace():
            i += 1
        start = i
        while i < n and not text[i].isspace():
            i += 1
        if i > start:
            spans.append((start, i))
    return spans


def build_windows(
    text: str,
    spans: list[tuple[int, int]],
    window_tokens: int = 384,
    stride: int = 192,
) -> list[Window]:
    """
    Slide a window_tokens-wide window across the whole document with the
    given stride. A document shorter than one window naturally produces a
    single window covering the entire text — no special-casing needed.
    """
    if not spans:
        return []

    windows: list[Window] = []
    i = 0
    while i < len(spans):
        j = min(i + window_tokens, len(spans))
        start_char, end_char = spans[i][0], spans[j - 1][1]
        windows.append(Window(
            index=len(windows),
            start_char=start_char,
            end_char=end_char,
            start_token=i,
            end_token=j,
            text=text[start_char:end_char],
        ))
        if j >= len(spans):
            break
        i += stride
    return windows


def stratified_sample(windows: list[Window], fraction: float) -> list[Window]:
    """
    Evenly spaced subset of windows across the whole document — quick mode's
    replacement for "scan the first N characters only" (spec §12). Coverage
    ends up spread across the document rather than concentrated at the start.
    """
    if fraction >= 1.0 or len(windows) <= 1:
        return windows
    n = max(1, round(len(windows) * fraction))
    step = len(windows) / n
    picked = sorted({int(k * step) for k in range(n)})
    return [windows[i] for i in picked]
