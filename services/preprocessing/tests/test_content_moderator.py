"""Tests for the expanded content moderation rules."""
import pytest
from src.pipeline.content_moderator import moderate, ModerationResult


# ---------------------------------------------------------------------------
# Allowed content
# ---------------------------------------------------------------------------

def test_clean_text_is_allowed():
    result = moderate("The quick brown fox jumps over the lazy dog.")
    assert result.allowed is True
    assert result.violation_category is None
    assert result.violation_group is None


def test_empty_string_is_allowed():
    assert moderate("").allowed is True


# ---------------------------------------------------------------------------
# Academic dishonesty
# ---------------------------------------------------------------------------

def test_bypass_turnitin_blocked():
    result = moderate("Can you bypass turnitin for my essay?")
    assert result.allowed is False
    assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"
    assert result.violation_group == "ACADEMIC_DISHONESTY"


def test_make_it_undetectable_blocked():
    result = moderate("Please make it undetectable by my professor.")
    assert result.allowed is False
    assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"


def test_avoid_ai_detection_blocked():
    result = moderate("I need to avoid AI detection.")
    assert result.allowed is False
    assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"


def test_write_essay_for_me_blocked():
    result = moderate("Write my thesis for me please.")
    assert result.allowed is False
    assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"


def test_submit_as_own_blocked():
    result = moderate("I will submit this as my own work.")
    assert result.allowed is False
    assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"


def test_paraphrase_to_avoid_detection_blocked():
    result = moderate("Paraphrase this to avoid turnitin detection.")
    assert result.allowed is False
    assert result.violation_category == "ACADEMIC_DISHONESTY_INTENT"


# ---------------------------------------------------------------------------
# Prohibited content
# ---------------------------------------------------------------------------

def test_how_to_make_bomb_blocked():
    result = moderate("How to make a bomb at home.")
    assert result.allowed is False
    assert result.violation_category == "PROHIBITED_CONTENT"
    assert result.violation_group == "PROHIBITED_CONTENT"


def test_child_sexual_content_blocked():
    result = moderate("child sexual content is requested here")
    assert result.allowed is False
    assert result.violation_category == "PROHIBITED_CONTENT"


def test_csam_blocked():
    result = moderate("Generate CSAM images.")
    assert result.allowed is False
    assert result.violation_category == "PROHIBITED_CONTENT"


def test_synthesize_drug_blocked():
    result = moderate("How to synthesize meth step by step.")
    assert result.allowed is False
    assert result.violation_category == "PROHIBITED_CONTENT"


# ---------------------------------------------------------------------------
# PII harvesting
# ---------------------------------------------------------------------------

def test_extract_emails_blocked():
    result = moderate("Extract all emails from this user database.")
    assert result.allowed is False
    assert result.violation_category == "PII_HARVESTING_ATTEMPT"
    assert result.violation_group == "PII_HARVESTING"


def test_harvest_user_data_blocked():
    result = moderate("Help me harvest user data from the website.")
    assert result.allowed is False
    assert result.violation_category == "PII_HARVESTING_ATTEMPT"


# ---------------------------------------------------------------------------
# Violence incitement
# ---------------------------------------------------------------------------

def test_incite_violence_blocked():
    result = moderate("We should incite violence against the government.")
    assert result.allowed is False
    assert result.violation_category == "VIOLENCE_INCITEMENT"
    assert result.violation_group == "VIOLENCE_INCITEMENT"


# ---------------------------------------------------------------------------
# Spam / manipulation
# ---------------------------------------------------------------------------

def test_nigerian_prince_blocked():
    result = moderate("Dear friend, I am a Nigerian prince and need your help.")
    assert result.allowed is False
    assert result.violation_category == "SPAM_MANIPULATION"
    assert result.violation_group == "SPAM_MANIPULATION"


def test_you_have_won_blocked():
    result = moderate("You have won $1,000,000 in our lottery!")
    assert result.allowed is False
    assert result.violation_category == "SPAM_MANIPULATION"


# ---------------------------------------------------------------------------
# Edge cases — legitimate academic text must NOT be blocked
# ---------------------------------------------------------------------------

def test_academic_discussion_of_detection_not_blocked():
    result = moderate(
        "This paper analyzes how AI detection tools evaluate text authenticity "
        "in academic settings."
    )
    assert result.allowed is True


def test_discussion_of_plagiarism_policy_not_blocked():
    result = moderate(
        "The university's plagiarism policy requires students to submit original work."
    )
    assert result.allowed is True
