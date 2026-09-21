#!/usr/bin/env python3
"""
Creates or regenerates the scanner golden evaluation dataset.

Generates a balanced parquet file with synthetic human-written and
ai-generated text samples for use by scanner_regression.py.

Usage:
    python create_golden_set.py \
        [--output ml/evaluation/golden_set/scanner_golden.parquet] \
        [--n-per-class 100] \
        [--seed 42]
"""
import argparse
import os
import random

import pandas as pd


# ── Synthetic sample banks ────────────────────────────────────────────────────

_HUMAN_TEMPLATES = [
    "I've been thinking a lot about {topic} lately, and honestly, I'm not sure what to make of it. "
    "Like, on one hand you've got the obvious {benefit}, but then again there's always the risk of {risk}.",

    "So I finally tried {activity} last weekend with my friends. It was pretty fun, though {observation}. "
    "Would definitely do it again tbh.",

    "Not gonna lie, {topic} is way more complicated than I thought it would be. "
    "My professor keeps saying {advice} but that feels kinda oversimplified to me.",

    "Had a weird conversation with my coworker today about {topic}. "
    "We totally disagree on {point}, which is fine I guess, but it got me thinking.",

    "Okay so {topic} — where do I even begin? I remember when {memory} and it completely changed how I see things.",

    "I don't know, maybe I'm wrong, but {claim}. Everyone else seems to think {counter}, but I just don't buy it.",

    "Just finished reading about {topic} and wow. {reaction}. Can't believe {fact}.",

    "Honestly the whole {topic} debate is exhausting. People act like {exaggeration} when really {reality}.",

    "My mom asked me about {topic} the other day and I had no idea what to say. "
    "I ended up just saying {response} and changing the subject lol.",

    "There's something kind of depressing about {topic} when you really think about it. "
    "I mean, {observation}, right? And yet we just {behavior}.",
]

_AI_TEMPLATES = [
    "{Topic} is a multifaceted subject that encompasses numerous dimensions of {domain}. "
    "It is essential to consider the various perspectives that stakeholders bring to this discussion. "
    "Furthermore, the implications of {topic} extend beyond immediate considerations to encompass long-term {outcome}.",

    "In examining {topic}, it is important to acknowledge the significant role that {factor} plays. "
    "Research indicates that {finding}, which suggests that a comprehensive approach is warranted. "
    "Therefore, it is recommended that {recommendation}.",

    "The concept of {topic} has gained considerable attention in recent years. "
    "This can be attributed to {reason}, as well as the growing recognition of {insight}. "
    "Moving forward, it will be crucial to {action} in order to {goal}.",

    "When considering {topic}, one must weigh the potential benefits against the associated risks. "
    "On one hand, {benefit} represents a compelling argument for {position}. "
    "On the other hand, {drawback} raises legitimate concerns that cannot be overlooked.",

    "A thorough analysis of {topic} reveals several key considerations. "
    "First, {point_1}. Second, {point_2}. Finally, {point_3}. "
    "These factors collectively underscore the complexity of {topic} and the need for nuanced solutions.",

    "{Topic} presents both opportunities and challenges for {stakeholder}. "
    "By leveraging {resource}, it becomes possible to {outcome}. "
    "However, this requires careful consideration of {constraint} and a commitment to {principle}.",

    "It is widely acknowledged that {topic} has transformative potential across multiple sectors. "
    "The integration of {technology} into existing frameworks offers promising pathways toward {goal}. "
    "Nonetheless, {challenge} remains a significant barrier to widespread adoption.",

    "The literature on {topic} consistently highlights the importance of {factor}. "
    "Empirical evidence suggests that {finding}, which has significant implications for {domain}. "
    "Practitioners are encouraged to apply these insights in their respective contexts.",

    "To address the complexities inherent in {topic}, a systematic approach is necessary. "
    "This involves {step_1}, followed by {step_2}, and ultimately achieving {outcome}. "
    "Such a structured methodology ensures that all relevant dimensions are appropriately considered.",

    "In conclusion, {topic} represents a critical area of focus for {domain}. "
    "The evidence presented herein demonstrates that {claim}. "
    "It is imperative that relevant parties take proactive measures to {action} and {goal}.",
]

_FILL = {
    "topic": ["climate change", "artificial intelligence", "remote work", "social media",
              "economic inequality", "mental health", "public education", "data privacy"],
    "Topic": ["Climate change", "Artificial intelligence", "Remote work", "Social media",
              "Economic inequality", "Mental health", "Public education", "Data privacy"],
    "domain": ["society", "technology", "policy", "research", "industry", "academia"],
    "benefit": ["increased efficiency", "broader access", "cost savings", "improved outcomes"],
    "risk":    ["unintended consequences", "equity concerns", "privacy issues", "systemic bias"],
    "activity": ["hiking", "cooking a new recipe", "attending a workshop", "trying yoga"],
    "observation": ["it took way longer than expected", "not everyone was into it",
                    "the results were surprisingly good", "I had no idea what I was doing"],
    "advice":  ["just focus on the fundamentals", "always consider context",
                "prioritize stakeholder needs", "think long-term"],
    "point":   ["the root causes", "the proposed solutions", "who's actually responsible",
                "whether the data is reliable"],
    "memory":  ["I was in high school and saw it firsthand",
                "my dad mentioned it at dinner once",
                "I read a really compelling article about it"],
    "claim":   ["we're overcomplicating this",
                "the simple solution is usually the right one",
                "nobody's talking about the real issue here"],
    "counter": ["it's extremely nuanced", "there are no easy answers", "experts disagree widely"],
    "reaction": ["I had to take a break and just sit with it",
                 "it completely reframed how I think about things",
                 "kind of blew my mind"],
    "fact":    ["it's been going on for decades", "most people have no idea",
                "the numbers are way worse than reported"],
    "exaggeration": ["it's the end of the world", "everything is fine", "there's nothing we can do"],
    "reality": ["it's complicated but manageable", "small actions do add up",
                "context matters a lot"],
    "response": ["oh yeah, it's complicated", "I don't really follow that stuff",
                 "I think it depends on who you ask"],
    "behavior": ["carry on like nothing happened", "scroll past it",
                 "wait for someone else to deal with it"],
    "factor":  ["structural inequalities", "technological advancements", "regulatory frameworks",
                "market dynamics"],
    "finding": ["there is a statistically significant correlation",
                "outcomes improve measurably with intervention",
                "the effect size is moderate but consistent"],
    "recommendation": ["organizations adopt evidence-based practices",
                       "further research be conducted",
                       "stakeholders engage in collaborative dialogue"],
    "reason":  ["rapid technological advancement", "shifting demographic trends",
                "increased public awareness", "policy imperatives"],
    "insight": ["interconnected systemic factors", "the role of institutional support",
                "the value of longitudinal approaches"],
    "action":  ["invest in capacity building", "develop robust frameworks",
                "foster cross-sector partnerships"],
    "goal":    ["achieve sustainable outcomes", "promote equitable access",
                "drive meaningful change"],
    "position": ["proactive intervention", "market-based solutions",
                 "regulatory oversight", "community-led approaches"],
    "drawback": ["implementation complexity", "resource constraints",
                 "potential for unintended consequences"],
    "point_1": ["the historical context is essential for understanding current dynamics"],
    "point_2": ["empirical evidence supports a measured approach"],
    "point_3": ["sustained commitment from all stakeholders is required"],
    "stakeholder": ["organizations", "policymakers", "practitioners", "communities"],
    "resource": ["existing infrastructure", "cross-disciplinary expertise",
                 "data-driven insights", "community knowledge"],
    "constraint": ["budgetary limitations", "regulatory requirements",
                   "capacity constraints", "stakeholder alignment"],
    "principle": ["transparency", "accountability", "inclusivity", "sustainability"],
    "technology": ["machine learning", "data analytics", "digital platforms",
                   "automation tools"],
    "challenge": ["resistance to change", "lack of standardization",
                  "data quality issues", "insufficient funding"],
    "step_1": ["conducting a comprehensive needs assessment"],
    "step_2": ["developing tailored implementation strategies"],
    "outcome": ["measurable improvements in key performance indicators",
                "enhanced stakeholder satisfaction",
                "long-term systemic change"],
}


def _fill_template(template: str, rng: random.Random) -> str:
    result = template
    for key, options in _FILL.items():
        placeholder = f"{{{key}}}"
        if placeholder in result:
            result = result.replace(placeholder, rng.choice(options))
    return result


def generate_samples(n_per_class: int, seed: int) -> pd.DataFrame:
    rng = random.Random(seed)
    records = []

    for _ in range(n_per_class):
        tmpl = rng.choice(_HUMAN_TEMPLATES)
        text = _fill_template(tmpl, rng)
        records.append({"text": text, "label": "human-written"})

    for _ in range(n_per_class):
        tmpl = rng.choice(_AI_TEMPLATES)
        text = _fill_template(tmpl, rng)
        records.append({"text": text, "label": "ai-generated"})

    rng.shuffle(records)
    return pd.DataFrame(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create scanner golden evaluation dataset")
    parser.add_argument(
        "--output",
        default="ml/evaluation/golden_set/scanner_golden.parquet",
        help="Output parquet file path",
    )
    parser.add_argument(
        "--n-per-class",
        type=int,
        default=100,
        help="Number of samples per class (default: 100)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    args = parser.parse_args()

    print(f"Generating {args.n_per_class} samples per class (seed={args.seed}) …")
    df = generate_samples(args.n_per_class, args.seed)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    df.to_parquet(args.output, index=False)

    print(f"Saved {len(df)} total samples → {args.output}")
    print(f"  human-written: {(df['label'] == 'human-written').sum()}")
    print(f"  ai-generated:  {(df['label'] == 'ai-generated').sum()}")


if __name__ == "__main__":
    main()
