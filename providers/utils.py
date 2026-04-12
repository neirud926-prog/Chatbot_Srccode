"""Shared utilities for AI providers."""
import json
import re


def parse_json_array(raw: str) -> list:
    """Robustly extract and parse a JSON array from LLM output.

    Handles:
    - Markdown code fences (```json ... ```)
    - Leading/trailing prose before/after the array
    - Truncated arrays (Gemma hits max_tokens mid-object)
    - Trailing commas before ] (common LLM mistake)
    """
    # Strip markdown fences
    raw = raw.strip()
    if raw.startswith("```"):
        # Remove opening fence line and closing fence
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    # Find start of JSON array (skip any preamble prose)
    start = raw.find("[")
    if start == -1:
        raise ValueError("No JSON array found in model response")
    raw = raw[start:]

    # Remove trailing commas before ] or } (invalid JSON, common from LLMs)
    raw = re.sub(r",\s*([}\]])", r"\1", raw)

    # Try to parse as-is first
    try:
        result = json.loads(raw)
        if isinstance(result, list):
            return result
    except json.JSONDecodeError:
        pass

    # Repair: model was cut off mid-array — find the last complete object
    # Walk backwards to find the last '}' that closes a top-level object
    depth = 0
    last_complete_end = -1
    in_string = False
    escape_next = False
    for i, ch in enumerate(raw):
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                last_complete_end = i

    if last_complete_end != -1:
        fixed = raw[: last_complete_end + 1] + "]"
        # Remove trailing commas again after repair
        fixed = re.sub(r",\s*([}\]])", r"\1", fixed)
        try:
            result = json.loads(fixed)
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

    raise ValueError(
        f"Could not parse JSON array from model response "
        f"(first 200 chars: {raw[:200]!r})"
    )


def parse_json_object(raw: str) -> dict:
    """Extract and parse a single JSON object from LLM output."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in model response")
    raw = raw[start : end + 1]

    # Remove trailing commas before } (common LLM mistake)
    raw = re.sub(r",\s*([}\]])", r"\1", raw)

    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object, got something else")
    return result
