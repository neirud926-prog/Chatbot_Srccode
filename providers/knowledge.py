"""Load local knowledge-base markdown files for quiz generation and revision notes."""
from pathlib import Path

_KB_DIR = Path(__file__).parent.parent / "rsc" / "knowledge"

TOPICS = {
    "sets": "sets.md",
    "dictionaries": "dictionaries.md",
    "lambda": "lambda.md",
}


_MAX_CHARS_PER_TOPIC = 1_800   # ~450 tokens — enough for 12-question quiz


def load_topic(topic: str, max_chars: int = 0) -> str:
    """Return the markdown text for a knowledge-base topic.

    Pass max_chars > 0 to truncate (saves tokens / reduces CPU heat).
    """
    filename = TOPICS.get(topic.lower())
    if not filename:
        return ""
    path = _KB_DIR / filename
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    if max_chars and len(text) > max_chars:
        # Truncate at a paragraph boundary if possible
        cutoff = text.rfind("\n\n", 0, max_chars)
        text = text[: cutoff if cutoff > 0 else max_chars]
    return text


def load_all_topics(max_chars_per_topic: int = 0) -> str:
    """Concatenate all knowledge-base topics into one document."""
    parts = []
    for topic, filename in TOPICS.items():
        path = _KB_DIR / filename
        if path.exists():
            text = path.read_text(encoding="utf-8")
            if max_chars_per_topic and len(text) > max_chars_per_topic:
                cutoff = text.rfind("\n\n", 0, max_chars_per_topic)
                text = text[: cutoff if cutoff > 0 else max_chars_per_topic]
            parts.append(text)
    return "\n\n---\n\n".join(parts)
