import getpass
import sys
import random
import time
import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
from pathlib import Path
from providers.factory import get_provider
from providers.base import ChatMessage
from session import ChatSession
from Database import (
    AccountTableHandler,
    LoginRecordTableHandler,
    QuizBankPythonTableHandler,
    QuizRecordTableHandler,
)
sys.stdout.flush()

TRAIN_MODEL = True
WORKING_DIR = Path(__file__).parent

QUIZ_ENCOURAGE = [
    "Keep up the good work!!!",
    "You're doing great, keep it up!!!",
    "Don't give up, you're almost there!!!",
    "Believe in yourself, you can do it!!!",
    "Every step you take is progress, keep going!!!",
]


def slow_print(text, split_by_line=True, print_delay=None):
    if split_by_line:
        delay = print_delay if print_delay is not None else 0.1
        for line in text.split("\n"):
            print(line, end='\n', flush=True)
            time.sleep(delay)
    else:
        delay = print_delay if print_delay is not None else 0.01
        for char in text:
            print(char, end='', flush=True)
            time.sleep(delay)
    print()


def make_session() -> ChatSession:
    provider = get_provider("nltk", {
        "working_dir": WORKING_DIR,
        "force_retrain": TRAIN_MODEL,
        "epochs_list": [500],
        "batch_size_list": [16],
    })
    return ChatSession(
        provider=provider,
        account_handler=AccountTableHandler(f"{WORKING_DIR}/rsc/tables/AccountTable.json"),
        login_record_handler=LoginRecordTableHandler(f"{WORKING_DIR}/rsc/tables/LoginRecordTable.json"),
        quiz_bank_handler=QuizBankPythonTableHandler(f"{WORKING_DIR}/rsc/tables/QuizBankPythonTable.json"),
        quiz_record_handler=QuizRecordTableHandler(f"{WORKING_DIR}/rsc/tables/QuizRecordTable.json"),
    )


def run():
    session = make_session()

    # Login loop
    while True:
        print("\nPolyU SPEED SEHS4678 NKH, CLS, WFW, WST")
        print("\n=== Login ===")
        username = input("Enter username: ")
        password = getpass.getpass("Enter password: ")
        result = session.login(username, password)
        if not result["ok"]:
            print(result["message"])
            continue
        slow_print(f"\n{result['message']}", split_by_line=False, print_delay=0.02)
        break

    # Main menu loop
    id_choose_map = {"1": "quiz", "2": "encourage", "3": "chat"}
    while True:
        slow_print("\n=== Please choose ===\n1. Quiz me\n2. Encourage me\n3. Chat with me")
        inp = input("Enter your Choose: ").rstrip()

        choose = id_choose_map.get(inp) or session.menu_route(inp)

        if choose == "quiz":
            _run_quiz(session)
        elif choose == "encourage":
            msg = session.get_encourage()
            slow_print(f"\nBot: {msg}", split_by_line=False, print_delay=0.002)
        elif choose == "chat":
            _run_chat(session)


def _run_quiz(session: ChatSession):
    print("\n=== Quiz ===")
    questions = session.start_quiz()
    if not questions:
        print("No quiz questions available.")
        return

    for index, q in enumerate(questions, start=1):
        slow_print(f"\nQuestion {index}/{len(questions)}:\n{q['question']}")
        if q["is_mcq"]:
            slow_print(f"A. {q['option_a']}\nB. {q['option_b']}\nC. {q['option_c']}\nD. {q['option_d']}")
            while True:
                user_input = input("Enter your answer (A/B/C/D): ").strip().upper()
                if user_input in ["A", "B", "C", "D"]:
                    break
                print("Please enter A, B, C, or D.")
        else:
            user_input = input("Enter your answer: ").strip()

        result = session.submit_answer(index - 1, user_input)
        if result["correct"]:
            print("Correct!")
        else:
            print(f"Incorrect. Correct answer: {result['correct_answer']}")
        slow_print(f"\nBot: {random.choice(QUIZ_ENCOURAGE)}\n", split_by_line=False, print_delay=0.02)

    final = session.finish_quiz()
    print(f"\nQuiz finished. Score: {final['score']}")


def _run_chat(session: ChatSession):
    print("\n=== Chat ===")
    slow_print("Bot: Hello! I'm a chatbot, how can I help you today?", print_delay=0.02, split_by_line=False)
    history: list[ChatMessage] = []
    while True:
        user_input = input("You: ").strip()
        response, tag = session.chat_turn(user_input, history)
        slow_print(f"Bot: {response}", split_by_line=False)
        if tag == "goodbye":
            break
        history.append(ChatMessage(role="user", content=user_input))
        history.append(ChatMessage(role="assistant", content=response))


if __name__ == "__main__":
    run()
