"""
Determines which pipeline stages run at each intensity level.
Intensity 1–3: LLM rewrite only (conservative)
Intensity 4–6: LLM rewrite + postprocessor vocabulary substitution
Intensity 7–10: All of the above + aggressive opener/transition removal
"""
from dataclasses import dataclass


@dataclass
class PipelineConfig:
    run_postprocessor: bool
    aggressive_opener_removal: bool
    llm_max_tokens: int


def get_pipeline_config(intensity: int) -> PipelineConfig:
    if intensity <= 3:
        return PipelineConfig(
            run_postprocessor=False,
            aggressive_opener_removal=False,
            llm_max_tokens=2048,
        )
    elif intensity <= 6:
        return PipelineConfig(
            run_postprocessor=True,
            aggressive_opener_removal=False,
            llm_max_tokens=3072,
        )
    else:
        return PipelineConfig(
            run_postprocessor=True,
            aggressive_opener_removal=True,
            llm_max_tokens=4096,
        )
