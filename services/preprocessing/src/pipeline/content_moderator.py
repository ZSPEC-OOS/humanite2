"""
Hard-reject content that violates platform policy BEFORE any LLM call.
This runs before fact-locking, language detection, and everything else.

No user text is logged on violation — only the violation category.
"""
import re
from dataclasses import dataclass


@dataclass
class ModerationResult:
    allowed: bool
    violation_category: str | None = None
    violation_group: str | None = None


# ---------------------------------------------------------------------------
# Pattern groups
# ---------------------------------------------------------------------------

_GROUP_ACADEMIC_DISHONESTY = "ACADEMIC_DISHONESTY"
_GROUP_PROHIBITED = "PROHIBITED_CONTENT"
_GROUP_PII_HARVESTING = "PII_HARVESTING"
_GROUP_VIOLENCE = "VIOLENCE_INCITEMENT"
_GROUP_SPAM = "SPAM_MANIPULATION"

_ACADEMIC_DISHONESTY: list[re.Pattern] = [
    re.compile(r'bypass\s+(?:turnitin|grammarly|copyleaks|originality\.ai)', re.IGNORECASE),
    re.compile(r'make\s+(?:this|it)\s+undetectable', re.IGNORECASE),
    re.compile(r'avoid\s+(?:ai\s+)?detection', re.IGNORECASE),
    re.compile(
        r'pass\s+(?:a\s+)?(?:plagiarism|ai)\s+(?:check|detector|scanner|tool|test)',
        re.IGNORECASE,
    ),
    re.compile(
        r'cheat\s+(?:my|the|a|on\s+(?:my|the|a))\s+'
        r'(?:professor|teacher|exam|test|assignment|essay|homework|course)',
        re.IGNORECASE,
    ),
    re.compile(
        r'write\s+my\s+(?:essay|paper|thesis|dissertation|assignment|homework)\s+for\s+me',
        re.IGNORECASE,
    ),
    re.compile(r'submit\s+(?:this|as)\s+(?:my|as\s+my)\s+own', re.IGNORECASE),
    re.compile(r'paraphrase\s+\S.*?\b(?:avoid|fool|trick)\s+(?:turnitin|plagiarism|detection)', re.IGNORECASE),
    re.compile(r'rewrite\s+(?:so|to)\s+(?:it\s+)?(?:passes?|fools?|tricks?)\s+\w+', re.IGNORECASE),
]

_PROHIBITED_CONTENT: list[re.Pattern] = [
    re.compile(
        r'how\s+to\s+(?:make|build|create|synthesize)\s+(?:a\s+)?'
        r'(?:bomb|explosive|weapon|poison|virus|malware|ransomware)',
        re.IGNORECASE,
    ),
    re.compile(r'(?:child|minor)\s+(?:sexual|explicit|nude|naked|abuse|exploitation)', re.IGNORECASE),
    re.compile(r'\bcsam\b', re.IGNORECASE),
    re.compile(r'(?:manufacture|synthesize|cook)\s+(?:meth|heroin|fentanyl|cocaine)', re.IGNORECASE),
    re.compile(
        r'step[\s-]by[\s-]step\s+(?:guide|instructions?|tutorial)\s+(?:to|for)\s+\w+\s+'
        r'(?:bomb|weapon|malware)',
        re.IGNORECASE,
    ),
]

_PII_HARVESTING: list[re.Pattern] = [
    re.compile(r'extract\s+(?:all\s+)?(?:emails?|phone\s+numbers?|ssn|social\s+security)', re.IGNORECASE),
    re.compile(r'collect\s+(?:personal|private|sensitive)\s+(?:data|information|details)', re.IGNORECASE),
    re.compile(r'scrape\s+(?:email|contact|personal)\s+(?:addresses?|info|data)', re.IGNORECASE),
    re.compile(r'harvest\s+(?:email|personal|user)\s+(?:data|information|addresses?)', re.IGNORECASE),
]

_VIOLENCE_INCITEMENT: list[re.Pattern] = [
    re.compile(
        r'(?:kill|murder|assassinate|execute)\s+(?:all\s+)?(?:the\s+)?'
        r'(?:jews?|muslims?|christians?|blacks?|whites?|immigrants?|gays?)',
        re.IGNORECASE,
    ),
    re.compile(r'(?:incite|call\s+(?:to|for))\s+(?:violence|riot|murder|genocide|terrorism)', re.IGNORECASE),
    re.compile(
        r'attack\s+(?:the\s+)?(?:mosque|synagogue|church|temple|school|hospital)\s+'
        r'(?:now|tonight|today)',
        re.IGNORECASE,
    ),
]

_SPAM_MANIPULATION: list[re.Pattern] = [
    re.compile(
        r'click\s+(?:the\s+)?link\s+(?:below|above|here)\s+to\s+(?:claim|win|get)\s+'
        r'(?:your\s+)?(?:prize|reward|money)',
        re.IGNORECASE,
    ),
    re.compile(r'you\s+(?:have\s+)?(?:won|been\s+selected|are\s+the\s+winner)', re.IGNORECASE),
    re.compile(
        r'send\s+(?:me\s+)?your\s+(?:bank|credit\s+card|ssn|social\s+security)\s+'
        r'(?:details?|number|info)',
        re.IGNORECASE,
    ),
    re.compile(r'(?:nigerian?\s+prince|lottery\s+winnings?|inheritance\s+transfer)', re.IGNORECASE),
]

# Ordered list: (patterns, violation_category, violation_group)
_CHECKS: list[tuple[list[re.Pattern], str, str]] = [
    (_ACADEMIC_DISHONESTY, "ACADEMIC_DISHONESTY_INTENT", _GROUP_ACADEMIC_DISHONESTY),
    (_PROHIBITED_CONTENT, "PROHIBITED_CONTENT", _GROUP_PROHIBITED),
    (_PII_HARVESTING, "PII_HARVESTING_ATTEMPT", _GROUP_PII_HARVESTING),
    (_VIOLENCE_INCITEMENT, "VIOLENCE_INCITEMENT", _GROUP_VIOLENCE),
    (_SPAM_MANIPULATION, "SPAM_MANIPULATION", _GROUP_SPAM),
]


def moderate(text: str) -> ModerationResult:
    """
    Returns immediately on first match.
    Does NOT log the matched text — only the category.
    """
    for patterns, category, group in _CHECKS:
        for pattern in patterns:
            if pattern.search(text):
                return ModerationResult(
                    allowed=False,
                    violation_category=category,
                    violation_group=group,
                )

    return ModerationResult(allowed=True)
