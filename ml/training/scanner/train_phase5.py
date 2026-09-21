"""
Train binary classifier: human-written (0) vs ai-generated (1).

Attempts to fine-tune roberta-base. If roberta-base is not cached locally,
falls back to training a tiny Roberta-architecture model from scratch —
sufficient for development and CI (macro_f1 > 0.50 on the synthetic dataset).

Run:
    cd /path/to/humanite
    python ml/training/scanner/create_synthetic_dataset.py
    python ml/training/scanner/train_phase5.py

Output: ml/models/scanner-roberta-phase5/best/
"""
import os
import sys
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import f1_score, classification_report
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedTokenizerFast,
    RobertaConfig,
    RobertaForSequenceClassification,
    Trainer,
    TrainingArguments,
)
from datasets import Dataset

OUTPUT_DIR  = "ml/models/scanner-roberta-phase5"
BEST_DIR    = f"{OUTPUT_DIR}/best"
NUM_LABELS  = 2
LABEL2ID    = {"human-written": 0, "ai-generated": 1}
ID2LABEL    = {0: "human-written", 1: "ai-generated"}
MAX_LENGTH  = 128
SEED        = 42


def _build_tiny_tokenizer(train_texts: list[str]) -> PreTrainedTokenizerFast:
    """
    Build a minimal BPE tokenizer from training data using the `tokenizers`
    library (bundled with transformers). No network access required.
    """
    from tokenizers import Tokenizer
    from tokenizers.models import BPE
    from tokenizers.trainers import BpeTrainer
    from tokenizers.pre_tokenizers import Whitespace
    from tokenizers.processors import TemplateProcessing

    tokenizer = Tokenizer(BPE(unk_token="[UNK]"))
    tokenizer.pre_tokenizer = Whitespace()

    trainer = BpeTrainer(
        vocab_size=4096,
        special_tokens=["[UNK]", "[PAD]", "[CLS]", "[SEP]", "[MASK]"],
        min_frequency=1,
    )
    tokenizer.train_from_iterator(train_texts, trainer=trainer)

    cls_token_id = tokenizer.token_to_id("[CLS]")
    sep_token_id = tokenizer.token_to_id("[SEP]")
    tokenizer.post_processor = TemplateProcessing(
        single="[CLS] $A [SEP]",
        special_tokens=[("[CLS]", cls_token_id), ("[SEP]", sep_token_id)],
    )
    tokenizer.enable_padding(pad_id=tokenizer.token_to_id("[PAD]"), pad_token="[PAD]")
    tokenizer.enable_truncation(max_length=MAX_LENGTH)

    fast_tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="[UNK]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        sep_token="[SEP]",
        mask_token="[MASK]",
    )
    return fast_tokenizer


def _build_tiny_model(vocab_size: int) -> RobertaForSequenceClassification:
    """
    Randomly-initialized tiny Roberta model — no pretrained weights needed.
    Small enough to train quickly on CPU (< 2 min).
    """
    config = RobertaConfig(
        vocab_size=vocab_size,
        hidden_size=128,
        num_hidden_layers=2,
        num_attention_heads=2,
        intermediate_size=256,
        max_position_embeddings=MAX_LENGTH + 2,
        num_labels=NUM_LABELS,
        label2id=LABEL2ID,
        id2label=ID2LABEL,
        pad_token_id=1,
    )
    return RobertaForSequenceClassification(config)


def load_split(path: str) -> Dataset:
    df = pd.read_parquet(path)
    df["label"] = df["label"].map(LABEL2ID)
    return Dataset.from_pandas(df[["text", "label"]])


def tokenize_batch(batch: dict, tokenizer) -> dict:
    return tokenizer(
        batch["text"],
        max_length=MAX_LENGTH,
        truncation=True,
        padding="max_length",
    )


def compute_metrics(eval_pred) -> dict:
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    macro_f1 = f1_score(labels, preds, average="macro")
    return {"macro_f1": macro_f1}


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    train_ds = load_split("ml/datasets/phase5_train.parquet")
    eval_ds  = load_split("ml/datasets/phase5_eval.parquet")
    train_texts = train_ds["text"]

    # Try to load roberta-base; fall back to tiny model if unavailable
    tokenizer = None
    model = None
    base_model = "roberta-base"

    try:
        print(f"Attempting to load {base_model} tokenizer…")
        tokenizer = AutoTokenizer.from_pretrained(base_model, local_files_only=True)
        model     = AutoModelForSequenceClassification.from_pretrained(
            base_model,
            num_labels=NUM_LABELS,
            label2id=LABEL2ID,
            id2label=ID2LABEL,
            local_files_only=True,
        )
        print(f"Loaded {base_model} from local cache.")
    except Exception:
        print(f"{base_model} not in local cache. Building tiny model from scratch…")
        tokenizer = _build_tiny_tokenizer(train_texts)
        model     = _build_tiny_model(vocab_size=len(tokenizer))
        print(f"Tiny model built (vocab={len(tokenizer)}, hidden=128, layers=2).")

    tok_fn = lambda b: tokenize_batch(b, tokenizer)
    train_ds = train_ds.map(tok_fn, batched=True, remove_columns=["text"])
    eval_ds  = eval_ds.map(tok_fn,  batched=True, remove_columns=["text"])

    args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=5,
        per_device_train_batch_size=32,
        per_device_eval_batch_size=64,
        learning_rate=5e-4,
        warmup_ratio=0.1,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        greater_is_better=True,
        fp16=False,
        seed=SEED,
        report_to="none",
        logging_steps=50,
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        compute_metrics=compute_metrics,
    )

    print(f"Training on {len(train_ds)} samples, evaluating on {len(eval_ds)} samples…")
    trainer.train()

    trainer.save_model(BEST_DIR)
    tokenizer.save_pretrained(BEST_DIR)

    preds_output = trainer.predict(eval_ds)
    preds = np.argmax(preds_output.predictions, axis=-1)
    print("\nFinal evaluation:")
    print(classification_report(
        preds_output.label_ids, preds,
        target_names=list(LABEL2ID.keys()),
    ))
    print(f"\nModel saved to {BEST_DIR}")


if __name__ == "__main__":
    main()
