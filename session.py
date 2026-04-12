import random
from datetime import datetime
from typing import Optional

from providers.base import AIProvider, ChatMessage, QuizAttempt, ProviderContext
from Database import (
    AccountTableHandler,
    LoginRecordTableHandler,
    QuizBankPythonTableHandler,
    QuizRecordTableHandler,
    Quiz,
)


class ChatSession:
    def __init__(
        self,
        provider: AIProvider,
        account_handler: AccountTableHandler,
        login_record_handler: LoginRecordTableHandler,
        quiz_bank_handler: QuizBankPythonTableHandler,
        quiz_record_handler: QuizRecordTableHandler,
    ):
        self.provider = provider
        self.account_handler = account_handler
        self.login_record_handler = login_record_handler
        self.quiz_bank_handler = quiz_bank_handler
        self.quiz_record_handler = quiz_record_handler
        self.current_user_id: Optional[int] = None
        self._active_quiz: list[Quiz] = []
        self._quiz_results: list[dict] = []

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def login(self, username: str, password: str) -> dict:
        """Returns {"ok": bool, "user_id": int|None, "login_count": int, "message": str}."""
        user_id = self.account_handler.verify_username_password(username, password)
        if user_id is None:
            return {"ok": False, "user_id": None, "login_count": 0,
                    "message": "Username or password is incorrect."}
        self.current_user_id = user_id
        login_count = len(self.login_record_handler.query_login_records_by_user_id(user_id))
        self.login_record_handler.insert_login_record(user_id)
        msg = (f"Happy to see you again, {username}!!"
               if login_count > 0
               else f"This is the first time to see you, {username}!!")
        return {"ok": True, "user_id": user_id, "login_count": login_count, "message": msg}

    # ------------------------------------------------------------------
    # Menu routing
    # ------------------------------------------------------------------

    def menu_route(self, text: str) -> str:
        """Returns tag: 'quiz', 'encourage', or 'chat'."""
        _, tag = self.provider.predict_menu_intent(text)
        return tag

    # ------------------------------------------------------------------
    # Encourage
    # ------------------------------------------------------------------

    def get_encourage(self) -> str:
        """Returns personalised encouragement string."""
        # Base response from provider
        if self.provider.supports_generation:
            base = self.provider.generate_chat(
                "Give me a short, warm encouraging message to motivate a student studying Python programming.",
                [],
            )
        else:
            base, _ = self.provider.predict_menu_intent("encourage me")

        # Dynamic context prefix (login frequency + quiz score delta)
        prefix = ""
        login_records = self.login_record_handler.query_login_records_by_user_id(self.current_user_id)
        if login_records:
            if len(login_records) > 1:
                t1 = datetime.strptime(login_records[-2]["login_time"], "%Y-%m-%dT%H:%M:%S")
                t2 = datetime.strptime(login_records[-1]["login_time"], "%Y-%m-%dT%H:%M:%S")
                if (t2 - t1).total_seconds() < 60 * 24:
                    prefix += "I can see that you have logged in frequently with a short interval! That's great!! "
            prefix += "Your last login time is {}. ".format(
                login_records[-1]["login_time"].replace("T", " ")
            )

        quiz_records = self.quiz_record_handler.get_quiz_results_by_user_id(self.current_user_id)
        if quiz_records:
            score_msg = ""
            if len(quiz_records) > 1:
                s1 = quiz_records[-2]["score"]
                s2 = quiz_records[-1]["score"]
                if s2 > s1:
                    score_msg = f"I can see that your quiz score has improved from {s1} to {s2}! Keep it up!! "
            if not score_msg:
                score_msg = f"Your latest quiz score is {quiz_records[-1]['score']}. "
            prefix += score_msg

        return f"{prefix}{base}" if prefix else base

    # ------------------------------------------------------------------
    # Quiz
    # ------------------------------------------------------------------

    def start_quiz(self, total: int = 10) -> list[dict]:
        """Selects random questions, returns list of question dicts."""
        quiz_bank = self.quiz_bank_handler.get_all_quiz()
        if not quiz_bank:
            return []
        total = min(total, len(quiz_bank))
        self._active_quiz = random.sample(quiz_bank, total)
        self._quiz_results = []
        return [self._quiz_to_dict(q) for q in self._active_quiz]

    def _quiz_to_dict(self, q: Quiz) -> dict:
        return {
            "quiz_id": q.quiz_id,
            "question": q.question,
            "option_a": q.option_a,
            "option_b": q.option_b,
            "option_c": q.option_c,
            "option_d": q.option_d,
            "correct_answer": q.correct_answer,
            "is_mcq": q.option_a.strip() != "",
        }

    def submit_answer(self, quiz_index: int, user_answer: str) -> dict:
        """Returns {"correct": bool, "correct_answer": str, "score_so_far": int}."""
        quiz = self._active_quiz[quiz_index]
        correct_answer = quiz.correct_answer.strip().lower()

        if quiz.option_a.strip():  # MCQ
            option_map = {
                "A": quiz.option_a, "B": quiz.option_b,
                "C": quiz.option_c, "D": quiz.option_d,
            }
            selected = option_map.get(user_answer.upper(), "").strip().lower()
            correct = selected == correct_answer
        else:
            correct = user_answer.strip().lower() == correct_answer

        self._quiz_results.append({"quiz": quiz, "user_answer": user_answer, "correct": correct})
        return {
            "correct": correct,
            "correct_answer": quiz.correct_answer,
            "score_so_far": sum(1 for r in self._quiz_results if r["correct"]),
        }

    def finish_quiz(self) -> dict:
        """Calculates final score, saves to DB. Returns {"score": int, "wrong_answers": list[QuizAttempt]}."""
        total = len(self._active_quiz)
        correct_count = sum(1 for r in self._quiz_results if r["correct"])
        score = round(correct_count / total * 100) if correct_count > 0 else 0
        self.quiz_record_handler.save_quiz_result(self.current_user_id, score)
        wrong_answers = [
            QuizAttempt(
                question=r["quiz"].question,
                user_answer=r["user_answer"],
                correct_answer=r["quiz"].correct_answer,
                option_a=r["quiz"].option_a,
                option_b=r["quiz"].option_b,
                option_c=r["quiz"].option_c,
                option_d=r["quiz"].option_d,
            )
            for r in self._quiz_results if not r["correct"]
        ]
        return {"score": score, "wrong_answers": wrong_answers}

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    def chat_turn(self, user_text: str, history: list[ChatMessage]) -> tuple[str, str]:
        """Returns (response_text, tag). NLTK uses intent model; generative providers use generate_chat."""
        if self.provider.supports_generation:
            response = self.provider.generate_chat(user_text, history)
            return response, "chat"
        response, tag = self.provider.predict_chat_intent(user_text)
        if tag == "hour":
            response = response.replace("$time", datetime.now().strftime("%I:%M %p"))
        return response, tag

    # ------------------------------------------------------------------
    # Revision notes
    # ------------------------------------------------------------------

    def build_revision_note(self, wrong_answers: list[QuizAttempt]) -> str:
        """Generates a revision note markdown string. Raises NotImplementedError for NLTK."""
        quiz_records = self.quiz_record_handler.get_quiz_results_by_user_id(self.current_user_id)
        prev_score = int(quiz_records[-2]["score"]) if len(quiz_records) > 1 else 0
        context = ProviderContext(
            attempt_number=len(quiz_records),
            previous_score=prev_score,
        )
        return self.provider.generate_revision_note(wrong_answers, context)
