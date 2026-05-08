"""Unit tests for app.llm_utils – specifically the JSON parsing helper."""
import json
import pytest

from app.llm_utils import _parse_llm_json


SAMPLE_QUESTIONS = [
    {
        "type": "mcq",
        "question": "What is 2+2?",
        "options": ["3", "4", "5", "6"],
        "answer": "4",
    },
    {
        "type": "subjective",
        "question": "Explain gravity.",
        "answer": "Gravity is a force of attraction.",
    },
]


def test_parse_plain_json():
    text = json.dumps(SAMPLE_QUESTIONS)
    result = _parse_llm_json(text)
    assert result == SAMPLE_QUESTIONS


def test_parse_json_with_markdown_fence():
    text = f"```json\n{json.dumps(SAMPLE_QUESTIONS)}\n```"
    result = _parse_llm_json(text)
    assert result == SAMPLE_QUESTIONS


def test_parse_json_with_plain_fence():
    text = f"```\n{json.dumps(SAMPLE_QUESTIONS)}\n```"
    result = _parse_llm_json(text)
    assert result == SAMPLE_QUESTIONS


def test_parse_json_with_leading_whitespace():
    text = f"   \n{json.dumps(SAMPLE_QUESTIONS)}\n"
    result = _parse_llm_json(text)
    assert result == SAMPLE_QUESTIONS


def test_parse_invalid_json_raises():
    with pytest.raises(json.JSONDecodeError):
        _parse_llm_json("this is not json")


def test_parse_empty_list():
    assert _parse_llm_json("[]") == []
