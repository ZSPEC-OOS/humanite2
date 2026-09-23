"""
Token-level reconstruction of document-wide AI-likeness from overlapping
window predictions (spec §9): each token's estimate q_t is the mean of
every window covering it, and the document's ai_fraction is the mean of
q_t over every token actually covered. This avoids double-counting the
overlap regions a naive average-of-window-probabilities would introduce.

Also builds display segments for the heatmap (spec §45) by run-length
encoding token-level classification bands and merging runs shorter than a
minimum length into their larger neighbor — a plain, non-learned stand-in
for the "weighted smoothing + minimum segment length" §28 describes as an
acceptable initial implementation, ahead of an eventual HMM/CRF upgrade.
"""
from ..preprocessing.segment import Window

# Provisional, uncalibrated thresholds — spec §27 explicitly warns against
# hard-coding 0.5 and calls for these to be fitted against validation data
# with a target false-positive rate once that data exists (Phase 3).
HUMAN_MAX = 0.35
AI_MIN = 0.65
MIN_SEGMENT_TOKENS = 30


def reconstruct_token_probabilities(
    windows: list[Window],
    probabilities: list[float],
    total_tokens: int,
) -> list[float | None]:
    sums = [0.0] * total_tokens
    counts = [0] * total_tokens
    for w, p in zip(windows, probabilities):
        end = min(w.end_token, total_tokens)
        for t in range(w.start_token, end):
            sums[t] += p
            counts[t] += 1
    return [sums[t] / counts[t] if counts[t] > 0 else None for t in range(total_tokens)]


def ai_fraction_from_token_probs(token_probs: list[float | None]) -> float:
    covered = [p for p in token_probs if p is not None]
    return sum(covered) / len(covered) if covered else 0.5


def coverage_from_token_probs(token_probs: list[float | None]) -> tuple[int, int, float]:
    total = len(token_probs)
    analyzed = sum(1 for p in token_probs if p is not None)
    fraction = analyzed / total if total else 0.0
    return analyzed, total, fraction


def _bucket(prob: float | None) -> str:
    if prob is None:
        return "uncertain"   # not analyzed — genuinely unknown, not "human"
    if prob >= AI_MIN:
        return "ai-generated"
    if prob <= HUMAN_MAX:
        return "human-written"
    return "uncertain"


def build_segments(
    spans: list[tuple[int, int]],
    token_probs: list[float | None],
) -> list[dict]:
    n = len(token_probs)
    if n == 0:
        return []

    buckets = [_bucket(p) for p in token_probs]

    def _is_gap(run: list) -> bool:
        """True for a run that is entirely unanalyzed data (no covering
        window), as opposed to a run classified "uncertain" because its
        probability landed in the borderline band. A gap must never be
        smoothed away — that would misrepresent unanalyzed text as scored."""
        return all(token_probs[t] is None for t in range(run[0], run[1]))

    runs: list[list] = []  # [start_token, end_token(exclusive), bucket]
    start = 0
    for i in range(1, n + 1):
        if i == n or buckets[i] != buckets[start]:
            runs.append([start, i, buckets[start]])
            start = i

    merged = True
    while merged and len(runs) > 1:
        merged = False
        for i, run in enumerate(runs):
            if run[1] - run[0] >= MIN_SEGMENT_TOKENS or _is_gap(run):
                continue
            prev_ok = i > 0 and not _is_gap(runs[i - 1])
            next_ok = i < len(runs) - 1 and not _is_gap(runs[i + 1])
            prev_len = runs[i - 1][1] - runs[i - 1][0] if prev_ok else -1
            next_len = runs[i + 1][1] - runs[i + 1][0] if next_ok else -1
            if prev_len < 0 and next_len < 0:
                continue
            target = i - 1 if prev_len >= next_len else i + 1
            label = runs[target][2]
            lo, hi = sorted((i, target))
            runs[lo] = [runs[lo][0], runs[hi][1], label]
            del runs[hi]
            merged = True
            break

    segments: list[dict] = []
    for idx, (start_tok, end_tok, bucket) in enumerate(runs):
        probs_in_range = [p for p in token_probs[start_tok:end_tok] if p is not None]
        avg_prob = sum(probs_in_range) / len(probs_in_range) if probs_in_range else 0.5

        if not probs_in_range:
            # No covering window at all (a quick-mode coverage gap) — there
            # is nothing to be confident about, regardless of how tidy an
            # empty variance would compute.
            confidence = 0.05
        else:
            variance = (
                sum((p - avg_prob) ** 2 for p in probs_in_range) / len(probs_in_range)
                if len(probs_in_range) > 1 else 0.0
            )
            # Agreement-based confidence: tight window predictions within a
            # segment -> high confidence; wide disagreement -> low. A real
            # signal, not a placeholder, but still a heuristic pending the
            # learned confidence model in spec §26.
            confidence = max(0.05, min(0.99, 1.0 - min(variance ** 0.5 / 0.5, 1.0)))
        segments.append({
            "id": f"seg-{idx}",
            "start_char": spans[start_tok][0],
            "end_char": spans[end_tok - 1][1],
            "start_token": start_tok,
            "end_token": end_tok,
            "ai_probability": round(avg_prob, 4),
            "classification": bucket,
            "confidence": round(confidence, 4),
        })
    return segments
