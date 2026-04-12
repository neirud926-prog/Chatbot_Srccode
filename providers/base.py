from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class ChatMessage:
    role: Literal["user", "assistant"]
    content: str


@dataclass
class QuizAttempt:
    question: str
    user_answer: str
    correct_answer: str
    option_a: str = ""
    option_b: str = ""
    option_c: str = ""
    option_d: str = ""


@dataclass
class ProviderContext:
    attempt_number: int = 1
    previous_score: int = 0


class AIProvider(ABC):
    name: str
    supports_generation: bool = False

    @abstractmethod
    def predict_menu_intent(self, text: str) -> tuple[str, str]:
        """Returns (response, tag). Response may be empty for generative providers."""
        ...

    @abstractmethod
    def predict_chat_intent(self, text: str) -> tuple[str, str]:
        """Returns (response, tag). For generative providers, delegates to generate_chat."""
        ...

    def generate_chat(self, user_text: str, history: list, context: "ProviderContext | None" = None) -> str:
        raise NotImplementedError(f"{self.name} does not support free-form chat generation")

    def generate_revision_note(self, wrong_answers: list, context: "ProviderContext | None" = None) -> str:
        raise NotImplementedError(f"{self.name} does not support revision note generation")

    def generate_quiz_questions(self, topics: list[str], n_per_topic: int = 3) -> list[dict]:
        """Generate quiz questions from knowledge base. Returns list of question dicts."""
        raise NotImplementedError(f"{self.name} does not support quiz generation from knowledge base")
