from providers.base import AIProvider, ChatMessage, ProviderContext, QuizAttempt
from providers.prompts import (
    MENU_CLASSIFIER_PROMPT,
    CHAT_SYSTEM_PROMPT,
    REVISION_NOTE_PROMPT,
    QUIZ_GENERATION_PROMPT,
)
from providers.knowledge import load_all_topics, load_topic
from providers.utils import parse_json_array

# Default model — large, smart, free on HuggingFace Serverless Inference API.
# Override with HF_MODEL env var or "model" key in settings.
DEFAULT_MODEL = "openai/gpt-oss-120b"


class HuggingFaceProvider(AIProvider):
    name = "huggingface"
    supports_generation = True

    def __init__(self, settings: dict):
        try:
            from huggingface_hub import InferenceClient
        except ImportError:
            raise RuntimeError(
                "huggingface_hub not installed. Run: pip install huggingface_hub"
            )
        api_key = settings.get("api_key") or settings.get("hf_api_key")
        if not api_key:
            raise ValueError("HuggingFaceProvider requires 'api_key' in settings")
        self._model = settings.get("model", DEFAULT_MODEL)
        self._client = InferenceClient(token=api_key)

    def _chat(self, messages: list[dict], max_tokens: int = 1024) -> str:
        """Call the HuggingFace Inference API via OpenAI-compatible chat_completion."""
        response = self._client.chat_completion(
            model=self._model,
            messages=messages,
            max_tokens=max_tokens,
        )
        return (response.choices[0].message.content or "").strip()

    def _generate(self, prompt: str, max_tokens: int = 1024) -> str:
        """Single-turn generation: wrap the prompt as a user message."""
        return self._chat(
            [{"role": "system", "content": CHAT_SYSTEM_PROMPT},
             {"role": "user", "content": prompt}],
            max_tokens=max_tokens,
        )

    # ------------------------------------------------------------------
    # Intent routing
    # ------------------------------------------------------------------

    def predict_menu_intent(self, text: str) -> tuple[str, str]:
        tag = self._chat(
            [{"role": "user", "content": MENU_CLASSIFIER_PROMPT.format(text=text)}],
            max_tokens=10,
        ).lower().strip()
        if tag not in ("quiz", "encourage", "chat"):
            tag = "chat"
        return "", tag

    def predict_chat_intent(self, text: str) -> tuple[str, str]:
        return "", "chat"

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    def generate_chat(
        self, user_text: str, history: list[ChatMessage], context: ProviderContext | None = None
    ) -> str:
        messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": user_text})
        return self._chat(messages)

    # ------------------------------------------------------------------
    # Revision note
    # ------------------------------------------------------------------

    def generate_revision_note(
        self, wrong_answers: list[QuizAttempt], context: ProviderContext | None = None
    ) -> str:
        ctx = context or ProviderContext()
        lines = []
        for i, a in enumerate(wrong_answers, 1):
            lines.append(f"{i}. Question: {a.question}")
            lines.append(f"   Student answered: {a.user_answer}")
            lines.append(f"   Correct answer: {a.correct_answer}")
        prompt = REVISION_NOTE_PROMPT.format(
            n_wrong=len(wrong_answers),
            formatted_list="\n".join(lines),
            attempt_n=ctx.attempt_number,
            prev_score=ctx.previous_score,
            knowledge_base=load_all_topics(),
        )
        return self._generate(prompt, max_tokens=2048)

    # ------------------------------------------------------------------
    # Quiz generation — 1 API call for ALL topics and questions
    # ------------------------------------------------------------------

    def generate_quiz_questions(self, topics: list[str], n_per_topic: int = 4) -> list[dict]:
        """Single API call generates all questions for all topics at once.

        3 topics × 4 questions = 12 questions in 1 API call (was 12 calls).
        KB for all topics is included so the model has full context.
        """
        n_questions = len(topics) * n_per_topic
        fitb_count = len(topics)           # 1 FITB per topic
        mc_count = n_questions - fitb_count

        kb_parts = []
        for t in topics:
            content = load_topic(t)
            if content:
                kb_parts.append(content)
        knowledge_base = "\n\n---\n\n".join(kb_parts) if kb_parts else load_all_topics()

        prompt = QUIZ_GENERATION_PROMPT.format(
            n_questions=n_questions,
            topics=", ".join(topics),
            per_topic=n_per_topic,
            mc_count=mc_count,
            fitb_count=fitb_count,
            knowledge_base=knowledge_base,
        )
        # Budget: ~300 tokens per question + prompt overhead
        max_tokens = n_questions * 300 + 400
        try:
            raw = self._generate(prompt, max_tokens=max_tokens)
            results = parse_json_array(raw)
        except Exception as e:
            print(f"[hf] quiz generation failed: {e}", flush=True)
            return []

        print(f"[hf] quiz generation → {len(results)} questions in 1 API call", flush=True)
        return results
