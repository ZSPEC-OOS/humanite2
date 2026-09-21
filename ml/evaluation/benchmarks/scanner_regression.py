#!/usr/bin/env python3
"""
ML regression gate for the Humanite scanner classifier.

Evaluates the current classifier against a golden parquet dataset and
compares macro_f1, f1_human, and f1_ai against a stored baseline JSON.
Exits 1 if any metric drops more than --max-drop (default 0.02).

Usage:
    python scanner_regression.py \
        --golden ml/evaluation/golden_set/scanner_golden.parquet \
        --baseline ml/evaluation/benchmarks/baseline_metrics.json \
        [--max-drop 0.02] \
        [--update-baseline]
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, f1_score


def _load_golden(path: str) -> tuple[list[str], list[str]]:
    df = pd.read_parquet(path)
    required = {"text", "label"}
    if not required.issubset(df.columns):
        sys.exit(f"ERROR: Golden set must have columns {required}. Found: {list(df.columns)}")
    return df["text"].tolist(), df["label"].tolist()


def _run_classifier(texts: list[str]) -> list[str]:
    """Import and run the scanner classifier on a list of texts."""
    services_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "../../../services/scanner")
    )
    sys.path.insert(0, services_path)

    from src.detection.classifier import classify  # type: ignore

    predictions = []
    for text in texts:
        try:
            result = classify(text)
            predictions.append(result["classification"])
        except Exception as exc:
            print(f"WARN: classify() raised {type(exc).__name__} — defaulting to 'uncertain'")
            predictions.append("uncertain")
    return predictions


def _compute_metrics(y_true: list[str], y_pred: list[str]) -> dict:
    labels = ["human-written", "ai-generated"]
    report = classification_report(y_true, y_pred, labels=labels, output_dict=True, zero_division=0)

    macro_f1 = f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)
    f1_human = report.get("human-written", {}).get("f1-score", 0.0)
    f1_ai    = report.get("ai-generated",  {}).get("f1-score", 0.0)

    return {
        "macro_f1": round(float(macro_f1), 4),
        "f1_human": round(float(f1_human), 4),
        "f1_ai":    round(float(f1_ai),    4),
        "n_samples": len(y_true),
    }


def _compare(current: dict, baseline: dict, max_drop: float) -> list[str]:
    failures = []
    for metric in ("macro_f1", "f1_human", "f1_ai"):
        current_val  = current.get(metric, 0.0)
        baseline_val = baseline.get(metric, 0.0)
        drop = baseline_val - current_val
        status = "PASS" if drop <= max_drop else "FAIL"
        print(f"  {metric:12s}: baseline={baseline_val:.4f}  current={current_val:.4f}  drop={drop:+.4f}  [{status}]")
        if status == "FAIL":
            failures.append(f"{metric} dropped {drop:.4f} (limit {max_drop})")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Scanner ML regression gate")
    parser.add_argument(
        "--golden",
        default="ml/evaluation/golden_set/scanner_golden.parquet",
        help="Path to golden parquet file",
    )
    parser.add_argument(
        "--baseline",
        default="ml/evaluation/benchmarks/baseline_metrics.json",
        help="Path to baseline JSON file",
    )
    parser.add_argument(
        "--max-drop",
        type=float,
        default=0.02,
        help="Maximum allowed metric drop before failing (default: 0.02)",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Write current metrics as the new baseline (do not fail)",
    )
    args = parser.parse_args()

    print(f"Loading golden set from {args.golden} …")
    texts, y_true = _load_golden(args.golden)
    print(f"  {len(texts)} samples loaded.")

    print("Running classifier …")
    y_pred = _run_classifier(texts)

    print("\nMetrics:")
    current = _compute_metrics(y_true, y_pred)
    for k, v in current.items():
        print(f"  {k}: {v}")

    if args.update_baseline:
        os.makedirs(os.path.dirname(args.baseline), exist_ok=True)
        with open(args.baseline, "w") as f:
            json.dump(current, f, indent=2)
        print(f"\nBaseline updated → {args.baseline}")
        return

    if not os.path.exists(args.baseline):
        sys.exit(
            f"ERROR: Baseline file not found: {args.baseline}\n"
            "Run with --update-baseline to create it."
        )

    with open(args.baseline) as f:
        baseline = json.load(f)

    print(f"\nComparing against baseline ({args.baseline}):")
    failures = _compare(current, baseline, args.max_drop)

    if failures:
        print(f"\nREGRESSION DETECTED — {len(failures)} metric(s) failed:")
        for msg in failures:
            print(f"  ✗ {msg}")
        sys.exit(1)

    print("\nAll metrics within acceptable range. Regression gate PASSED.")


if __name__ == "__main__":
    main()
