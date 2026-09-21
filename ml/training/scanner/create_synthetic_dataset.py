"""
Creates a minimal synthetic dataset for development and CI.
Replace with real labeled data before production deployment.

Real data sources to use in production:
- Human: CC-News (CC-BY), Project Gutenberg, arXiv abstracts pre-2021
- AI: GPT-3.5-turbo + GPT-4 outputs at temperature 0.7, diverse prompts

Run: python ml/training/scanner/create_synthetic_dataset.py
"""
import os
import pandas as pd
import numpy as np

os.makedirs("ml/datasets", exist_ok=True)

HUMAN_SAMPLES = [
    "I woke up at six and couldn't get back to sleep. Just lay there staring at the ceiling, thinking about everything and nothing. Made coffee eventually.",
    "The train was late again. Third time this week. Stood on the platform in the rain wondering if I should just start cycling to work.",
    "We argued about the thermostat again. I know it's stupid but somehow it became the hill we both decided to die on.",
    "Finished the novel last night. Cried at the ending, which I did not expect at all. Told no one because I'd never live it down.",
    "The meeting ran forty minutes over. Nothing was decided. We scheduled another meeting to decide what to decide.",
    "My daughter asked me why the sky is blue and I started explaining Rayleigh scattering and she walked away mid-sentence.",
    "The coffee here is genuinely bad. I keep coming back because the wifi is fast and nobody bothers you.",
    "Three rejection emails in one morning. I made soup. The soup was good, at least.",
    "Saw a heron standing perfectly still at the edge of the pond. Stayed to watch for longer than I expected.",
    "Called my dad. He asked if I was eating properly. I said yes. We both knew I was lying.",
    "The study found no significant correlation between the two variables when controlling for socioeconomic status.",
    "Temperatures in the upper midwest dropped sharply overnight, with several counties recording their lowest October readings in decades.",
    "The company reported a quarterly loss of $340 million, citing supply chain disruptions and reduced consumer demand.",
    "He pushed the door open with his shoulder and stood in the doorway, letting his eyes adjust to the dark.",
    "The legislation passed narrowly, 52 to 48, after three weeks of floor debate and a last-minute amendment on enforcement.",
]

AI_SAMPLES = [
    "Furthermore, it is important to note that machine learning models have demonstrated remarkable capabilities across a diverse range of tasks. Moreover, these models leverage large-scale training data to achieve state-of-the-art performance.",
    "In conclusion, the implementation of robust natural language processing techniques enables comprehensive text analysis. Additionally, this multifaceted approach ensures optimal results across various domains.",
    "The utilization of advanced algorithms facilitates the processing of complex datasets. Furthermore, the integration of multiple methodologies ensures comprehensive coverage of the problem space.",
    "It is worth noting that the system demonstrates significant improvements over baseline methods. Moreover, the robust framework enables scalable deployment across enterprise environments.",
    "In summary, this approach leverages cutting-edge techniques to deliver superior outcomes. The comprehensive analysis reveals multifaceted insights that inform strategic decision-making processes.",
    "As an AI language model, I must note that this topic requires careful consideration. Furthermore, it is important to acknowledge the multifaceted nature of the issue at hand.",
    "The comprehensive framework outlined above provides a robust foundation for addressing these challenges. Additionally, the seamless integration of these components ensures optimal system performance.",
    "Moreover, the utilization of state-of-the-art methodologies facilitates the achievement of groundbreaking results. Furthermore, this paradigm shift represents a transformative approach to the problem.",
    "It is crucial to note that the implementation of these synergistic solutions will fundamentally transform the landscape. Additionally, the robust nature of this framework ensures long-term sustainability.",
    "In conclusion, this multifaceted analysis demonstrates the comprehensive nature of the proposed solution. Furthermore, the seamless integration of all components ensures optimal performance across all use cases.",
    "The model was trained on a comprehensive dataset encompassing a diverse range of linguistic patterns. Furthermore, the robust training procedure ensures generalization across multiple domains.",
    "To summarize, the proposed methodology leverages advanced techniques to facilitate optimal outcomes. Moreover, the implementation of these robust solutions ensures comprehensive coverage.",
    "Additionally, it is important to highlight the transformative potential of this approach. Furthermore, the seamless integration of cutting-edge technologies enables unprecedented performance gains.",
    "The utilization of this paradigm enables organizations to leverage their existing infrastructure while simultaneously facilitating the adoption of innovative solutions.",
    "Moreover, the comprehensive evaluation demonstrates that the proposed framework achieves state-of-the-art performance across multiple benchmarks while maintaining robust generalization capabilities.",
]

# Expand to 1500 samples per class for a minimal training set
rng = np.random.default_rng(42)
human_expanded = [HUMAN_SAMPLES[i % len(HUMAN_SAMPLES)] for i in range(1500)]
ai_expanded    = [AI_SAMPLES[i % len(AI_SAMPLES)]    for i in range(1500)]

rows = (
    [{"text": t, "label": "human-written"} for t in human_expanded] +
    [{"text": t, "label": "ai-generated"}  for t in ai_expanded]
)

df = pd.DataFrame(rows)
df = df.sample(frac=1, random_state=42).reset_index(drop=True)

split = int(len(df) * 0.85)
train_df = df[:split]
eval_df  = df[split:]

train_df.to_parquet("ml/datasets/phase5_train.parquet", index=False)
eval_df.to_parquet("ml/datasets/phase5_eval.parquet",   index=False)

print(f"Dataset created:")
print(f"  Train: {len(train_df)} samples")
print(f"  Eval:  {len(eval_df)} samples")
print(f"  Train label distribution:\n{train_df['label'].value_counts()}")
