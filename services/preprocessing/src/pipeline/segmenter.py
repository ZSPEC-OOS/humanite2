"""
Split text into structural segments: paragraphs, headings, list items, sentences.
Preserves character offsets so fact locks remain aligned with the original text.
"""
import re
from dataclasses import dataclass


@dataclass
class Segment:
    index: int
    segment_type: str      # "paragraph" | "heading" | "list_item" | "blank"
    text: str
    char_start: int
    char_end: int
    sentence_count: int


_HEADING = re.compile(r'^#{1,6}\s+.+$', re.MULTILINE)
_LIST_ITEM = re.compile(r'^[\s]*[-*•]\s+.+$', re.MULTILINE)
_SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z])')


def segment_text(text: str) -> list[Segment]:
    segments: list[Segment] = []
    paragraphs = re.split(r'\n{2,}', text)
    offset = 0
    idx = 0

    for raw_para in paragraphs:
        para = raw_para.strip()
        start = text.find(para, offset)
        end = start + len(para)

        if not para:
            offset = end + 2
            continue

        if _HEADING.match(para):
            seg_type = "heading"
        elif _LIST_ITEM.match(para):
            seg_type = "list_item"
        else:
            seg_type = "paragraph"

        sentences = _SENTENCE_SPLIT.split(para)

        segments.append(Segment(
            index=idx,
            segment_type=seg_type,
            text=para,
            char_start=start,
            char_end=end,
            sentence_count=len(sentences),
        ))
        idx += 1
        offset = end

    return segments
