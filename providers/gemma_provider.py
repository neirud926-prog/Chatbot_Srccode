import json
import os
import re
from pathlib import Path
from providers.base import AIProvider, ChatMessage, ProviderContext, QuizAttempt
from providers.prompts import (
    CHAT_SYSTEM_PROMPT,
    MENU_CLASSIFIER_PROMPT,
    REVISION_NOTE_PROMPT,
    QUIZ_MC_QUESTION_PROMPT,
    QUIZ_FITB_QUESTION_PROMPT,
)
from providers.knowledge import load_all_topics, load_topic, _MAX_CHARS_PER_TOPIC
from providers.utils import parse_json_object

DEFAULT_MODEL_PATH = str(Path(__file__).parent.parent / "rsc/models/gemma-2-2b-it-Q4_K_M.gguf")


class GemmaProvider(AIProvider):
    name = "gemma"
    supports_generation = True

    def __init__(self, settings: dict):
        try:
            from llama_cpp import Llama
        except ImportError:
            raise RuntimeError(
                "llama-cpp-python not installed. Run: pip install llama-cpp-python"
            )
        model_path = settings.get("model_path", DEFAULT_MODEL_PATH)
        if not Path(model_path).exists():
            raise FileNotFoundError(
                f"Gemma GGUF not found at {model_path}.\n"
                "Download gemma-2-2b-it-Q4_K_M.gguf from: "
                "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf"
            )
        # 2 threads by default caps CPU at ~12–25% on an 8-core machine.
        # Override with GEMMA_N_THREADS env var for faster-but-hotter inference.
        # n_gpu_layers=-1 offloads everything to GPU (requires CUDA llama-cpp build).
        default_threads = int(os.getenv("GEMMA_N_THREADS", "2"))
        self._llm = Llama(
            model_path=model_path,
            n_ctx=settings.get("n_ctx", 2048),
            n_threads=settings.get("n_threads", default_threads),
            n_batch=settings.get("n_batch", 128),   # smaller batch = smoother load
            n_gpu_layers=settings.get("n_gpu_layers", 0),
            verbose=False,
        )

    def _format_prompt(self, system: str, user: str) -> str:
        parts = []
        if system:
            parts.append(f"<start_of_turn>user\n{system}<end_of_turn>\n")
        parts.append(f"<start_of_turn>user\n{user}<end_of_turn>\n<start_of_turn>model\n")
        return "".join(parts)

    def _complete(self, prompt: str, max_tokens: int = 1024, temperature: float = 0.8) -> str:
        result = self._llm(
            prompt,
            max_tokens=max_tokens,
            stop=["<end_of_turn>"],
            echo=False,
            temperature=temperature,
        )
        return result["choices"][0]["text"].strip()

    def predict_menu_intent(self, text: str) -> tuple[str, str]:
        prompt = self._format_prompt("", MENU_CLASSIFIER_PROMPT.format(text=text))
        raw = self._complete(prompt, max_tokens=10).lower().strip()
        tag = raw if raw in ("quiz", "encourage", "chat", "goodbye") else "chat"
        return "", tag

    def predict_chat_intent(self, text: str) -> tuple[str, str]:
        return "", "chat"

    def generate_chat(self, user_text: str, history: list[ChatMessage], context: ProviderContext | None = None) -> str:
        turns = ""
        for msg in history:
            role = "user" if msg.role == "user" else "model"
            turns += f"<start_of_turn>{role}\n{msg.content}<end_of_turn>\n"
        turns += f"<start_of_turn>user\n{user_text}<end_of_turn>\n<start_of_turn>model\n"
        full_prompt = f"<start_of_turn>user\n{CHAT_SYSTEM_PROMPT}<end_of_turn>\n{turns}"
        return self._complete(full_prompt)

    def generate_revision_note(self, wrong_answers: list[QuizAttempt], context: ProviderContext | None = None) -> str:
        ctx = context or ProviderContext()
        lines = []
        for i, a in enumerate(wrong_answers, 1):
            lines.append(f"{i}. Question: {a.question}")
            lines.append(f"   Student answered: {a.user_answer}")
            lines.append(f"   Correct answer: {a.correct_answer}")
        prompt = self._format_prompt(
            "",
            REVISION_NOTE_PROMPT.format(
                n_wrong=len(wrong_answers),
                formatted_list="\n".join(lines),
                attempt_n=ctx.attempt_number,
                prev_score=ctx.previous_score,
                knowledge_base=load_all_topics(max_chars_per_topic=_MAX_CHARS_PER_TOPIC),
            ),
        )
        return self._complete(prompt, max_tokens=1500)  # was 3072

    def _fix_mc_correct_answer(self, q: dict) -> dict | None:
        """Ensure MC correct_answer is the exact text of one of the four options.

        Gemma often paraphrases the correct option text.  Try progressively more
        lenient matching so we don't silently drop valid questions:
          1. Exact match (case-insensitive).
          2. Substring containment in either direction.
          3. Word-overlap — pick the option that shares the most meaningful words.
        Only discard if every option is empty or no word overlap at all.
        """
        ca = (q.get("correct_answer") or "").strip()
        if not ca:
            return None
        ca_lower = ca.lower()
        opts = {
            "option_a": (q.get("option_a") or "").strip(),
            "option_b": (q.get("option_b") or "").strip(),
            "option_c": (q.get("option_c") or "").strip(),
            "option_d": (q.get("option_d") or "").strip(),
        }
        # 1. Exact match — already fine
        for val in opts.values():
            if val.lower() == ca_lower:
                return q
        # 2. Substring match — use the option text verbatim
        for val in opts.values():
            if val and (ca_lower in val.lower() or val.lower() in ca_lower):
                q["correct_answer"] = val
                print(f"[gemma] fixed correct_answer (substring): '{ca}' → '{val}'", flush=True)
                return q
        # 3. Word-overlap fallback — tokenise and count shared non-trivial words
        _STOP = {"a", "an", "the", "is", "are", "of", "to", "in", "and", "or", "it", "be", "as", "for"}
        def _words(s: str) -> set[str]:
            return {w for w in re.findall(r"\w+", s.lower()) if len(w) > 2 and w not in _STOP}
        ca_words = _words(ca)
        if ca_words:
            best_key, best_score = None, 0
            for key, val in opts.items():
                if not val:
                    continue
                overlap = len(ca_words & _words(val))
                if overlap > best_score:
                    best_key, best_score = key, overlap
            if best_key and best_score >= 1:
                val = opts[best_key]
                q["correct_answer"] = val
                print(f"[gemma] fixed correct_answer (word-overlap {best_score}): '{ca}' → '{val}'", flush=True)
                return q
        # No relationship at all — discard
        print(f"[gemma] discarding MC: correct_answer '{ca}' not in {list(opts.values())}", flush=True)
        return None

    def _generate_one_question(
        self, topic: str, q_type: str, kb: str, existing: list[dict], attempt: int = 0
    ) -> dict | None:
        """Generate a single MC or FITB question, avoiding duplicates.

        `attempt` (0-based) bumps temperature on retries so Gemma doesn't repeat
        the same malformed output when the first try fails to parse/validate.
        """
        already_asked = "; ".join(q["question"] for q in existing) if existing else "none"
        template = QUIZ_FITB_QUESTION_PROMPT if q_type == "fitb" else QUIZ_MC_QUESTION_PROMPT
        prompt = self._format_prompt(
            "",
            template.format(
                topic=topic,
                knowledge_base=kb,
                already_asked=already_asked,
            ),
        )
        temperature = 0.7 + 0.1 * attempt  # 0.70 → 0.80 → 0.90 → 1.00
        raw = self._complete(prompt, max_tokens=500, temperature=temperature)
        print(f"[gemma] {topic}/{q_type} attempt {attempt + 1} (T={temperature:.2f}) raw:\n{raw}\n---", flush=True)
        try:
            q = parse_json_object(raw)
        except Exception as e:
            print(f"[gemma] {topic}/{q_type} parse failed: {e}", flush=True)
            return None
        # For MC: validate / auto-correct the correct_answer field
        if q and q.get("type") == "mc":
            q = self._fix_mc_correct_answer(q)
        return q

    def generate_quiz_questions(self, topics: list[str], n_per_topic: int = 4) -> list[dict]:
        """Generate questions one at a time — more reliable for small models.

        Key invariant: each prompt receives ONLY the KB for its target topic (via
        `load_topic(topic)`) so Gemma can't drift onto unrelated content.  Up to
        3 attempts per question with rising temperature; a per-topic summary is
        printed at the end so silent failures are visible in the server console.
        """
        results: list[dict] = []
        seen: set[str] = set()
        per_topic_outcome: dict[str, int] = {t: 0 for t in topics}
        MAX_ATTEMPTS = 4
        for topic in topics:
            kb = load_topic(topic, max_chars=_MAX_CHARS_PER_TOPIC)
            if not kb:
                print(f"[gemma] WARNING: no KB text loaded for topic '{topic}' — skipping", flush=True)
                continue
            # For demo (n_per_topic=1): just 1 MC per topic.
            # For full quiz: 1 FITB + rest MC per topic (60-80% MC overall).
            if n_per_topic == 1:
                types = ["mc"]
            else:
                types = ["fitb"] + ["mc"] * (n_per_topic - 1)
            for q_type in types:
                q = None
                for attempt in range(MAX_ATTEMPTS):
                    q = self._generate_one_question(topic, q_type, kb, results, attempt=attempt)
                    if q:
                        break
                if not q:
                    print(f"[gemma] gave up on {topic}/{q_type} after {MAX_ATTEMPTS} attempts", flush=True)
                    continue
                # Deduplicate by question text (guards against Gemma repeating itself)
                key = q.get("question", "").strip().lower()
                if not key:
                    continue
                if key in seen:
                    print(f"[gemma] duplicate question dropped: {key[:60]}...", flush=True)
                    continue
                seen.add(key)
                results.append(q)
                per_topic_outcome[topic] += 1
        # Per-topic summary — makes silent failures obvious
        summary = ", ".join(f"{t}={per_topic_outcome.get(t, 0)}" for t in topics)
        print(f"[gemma] quiz generation summary → {summary} (total {len(results)})", flush=True)
        return results
