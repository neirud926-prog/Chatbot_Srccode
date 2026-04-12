"""Flask API backend for the PY Chatbot upgrade.

Serves:
  - /api/*  JSON endpoints consumed by the React/Vite frontend
  - /      serves frontend/dist/index.html in production
"""

import json
import os
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("PYTHONUTF8", "1")

from pathlib import Path
from typing import Optional

from flask import Flask, jsonify, request, session, send_from_directory, abort
from flask_cors import CORS
from dotenv import load_dotenv

from Database import (
    AccountTableHandler,
    LoginRecordTableHandler,
    QuizBankPythonTableHandler,
    QuizRecordTableHandler,
    RevisionNoteTableHandler,
)
from providers.base import ChatMessage, QuizAttempt
from providers.factory import get_provider
from session import ChatSession

load_dotenv()

WORKING_DIR = Path(__file__).parent
FRONTEND_DIST = WORKING_DIR / "frontend" / "dist"

app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv("FLASK_SECRET", "dev-only-do-not-use-in-production")
CORS(app, supports_credentials=True, origins=["http://localhost:5173"])

# ---------- Table handlers (shared, stateless) ----------
account_handler = AccountTableHandler(f"{WORKING_DIR}/rsc/tables/AccountTable.json")
login_record_handler = LoginRecordTableHandler(f"{WORKING_DIR}/rsc/tables/LoginRecordTable.json")
quiz_bank_handler = QuizBankPythonTableHandler(f"{WORKING_DIR}/rsc/tables/QuizBankPythonTable.json")
quiz_record_handler = QuizRecordTableHandler(f"{WORKING_DIR}/rsc/tables/QuizRecordTable.json")
revision_note_handler = RevisionNoteTableHandler(f"{WORKING_DIR}/rsc/tables/RevisionNoteTable.json")

# ---------- Provider cache ----------
# Providers are expensive to construct (model load, API client). Cache by (name, key-fingerprint).
_provider_cache: dict = {}


def _provider_settings_for(name: str) -> dict:
    """Build provider-specific settings from env + session."""
    if name == "nltk":
        return {
            "working_dir": WORKING_DIR,
            "force_retrain": False,
            "epochs_list": [500],
            "batch_size_list": [16],
        }
    if name == "huggingface":
        key = session.get("hf_api_key") or os.getenv("HF_API_KEY", "")
        model = session.get("hf_model") or os.getenv("HF_MODEL", "")
        return {"api_key": key, **({"model": model} if model else {})}
    if name == "gemma":
        return {
            "model_path": str(WORKING_DIR / "rsc/models/gemma-2-2b-it-Q4_K_M.gguf"),
            "n_gpu_layers": int(os.getenv("GEMMA_GPU_LAYERS", "0")),  # 0 = CPU only (safe default); set -1 in .env for GPU
            "n_ctx": 2048,
        }
    raise ValueError(f"Unknown provider {name!r}")


def _get_cached_provider(name: str):
    settings = _provider_settings_for(name)
    cache_key = (name, settings.get("api_key", ""), settings.get("model_path", ""), settings.get("model", ""))
    if cache_key not in _provider_cache:
        _provider_cache[cache_key] = get_provider(name, settings)
    return _provider_cache[cache_key]


def _current_session() -> ChatSession:
    provider_name = session.get("provider", "nltk")
    provider = _get_cached_provider(provider_name)
    cs = ChatSession(
        provider=provider,
        account_handler=account_handler,
        login_record_handler=login_record_handler,
        quiz_bank_handler=quiz_bank_handler,
        quiz_record_handler=quiz_record_handler,
    )
    cs.current_user_id = session.get("user_id")
    return cs


def _require_login():
    if "user_id" not in session:
        abort(401, description="Not logged in")


# ---------- Auth ----------

@app.post("/api/login")
def api_login():
    data = request.get_json(force=True) or {}
    username = data.get("username", "")
    password = data.get("password", "")

    cs = _current_session()
    result = cs.login(username, password)
    if not result["ok"]:
        return jsonify(result), 401

    session["user_id"] = result["user_id"]
    session["username"] = username
    session.setdefault("provider", "nltk")
    return jsonify(result)


@app.post("/api/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    if "user_id" not in session:
        return jsonify({"logged_in": False})
    return jsonify({
        "logged_in": True,
        "user_id": session["user_id"],
        "username": session.get("username"),
        "provider": session.get("provider", "nltk"),
    })


# ---------- Settings ----------

@app.get("/api/settings")
def api_settings_get():
    _require_login()
    return jsonify({
        "provider": session.get("provider", "nltk"),
        "has_hf_key": bool(session.get("hf_api_key") or os.getenv("HF_API_KEY")),
        "gemma_gpu_enabled": int(os.getenv("GEMMA_GPU_LAYERS", "0")) != 0,
    })


@app.post("/api/settings")
def api_settings_set():
    _require_login()
    data = request.get_json(force=True) or {}
    provider = data.get("provider")
    if provider in ("nltk", "huggingface", "gemma"):
        session["provider"] = provider
    if "hf_api_key" in data:
        session["hf_api_key"] = data["hf_api_key"]
    if "hf_model" in data:
        session["hf_model"] = data["hf_model"]
    return jsonify({"ok": True, "provider": session.get("provider")})


@app.post("/api/settings/test")
def api_settings_test():
    """Smoke-test the selected provider without changing state."""
    _require_login()
    provider_name = (request.get_json(force=True) or {}).get("provider", session.get("provider", "nltk"))
    try:
        provider = _get_cached_provider(provider_name)
        _, tag = provider.predict_menu_intent("hello")
        return jsonify({"ok": True, "provider": provider_name, "sample_tag": tag})
    except Exception as e:
        return jsonify({"ok": False, "provider": provider_name, "error": str(e)}), 500


# ---------- Chat ----------

@app.post("/api/chat")
def api_chat():
    _require_login()
    data = request.get_json(force=True) or {}
    text = data.get("text", "")
    history_raw = data.get("history", [])
    history = [ChatMessage(role=m["role"], content=m["content"]) for m in history_raw]

    cs = _current_session()
    response, tag = cs.chat_turn(text, history)
    return jsonify({"reply": response, "tag": tag})


# ---------- Encourage ----------

@app.get("/api/encourage")
def api_encourage():
    _require_login()
    cs = _current_session()
    return jsonify({"message": cs.get_encourage()})


# ---------- Quiz ----------

KB_TOPICS = ["sets", "dictionaries", "lambda"]
KB_TOPIC_DISPLAY = {
    "sets": "Set",
    "dictionaries": "Dictionary",
    "lambda": "Anonymous Function (Lambda)",
}


@app.get("/api/quiz/topics")
def api_quiz_topics():
    """Return available knowledge-base topics."""
    _require_login()
    return jsonify({
        "topics": [
            {"id": t, "label": KB_TOPIC_DISPLAY[t]}
            for t in KB_TOPICS
        ]
    })


@app.post("/api/quiz/start")
def api_quiz_start():
    """Start a quiz.

    Body options:
      {}                              → random from full quiz bank (legacy)
      {"topics": ["sets", "lambda"]}  → KB-filtered static questions for NLTK;
                                        LLM-generated questions for Gemini/Gemma
      {"total": 10}                   → legacy: N random questions from the bank
    """
    _require_login()
    data = request.get_json(silent=True) or {}
    topics = data.get("topics")  # list of KB topic ids, or None

    cs = _current_session()

    if topics:
        # Validate topic names
        topics = [t for t in topics if t in KB_TOPICS]
        if not topics:
            topics = KB_TOPICS

        n_per_topic = min(int(data.get("n_per_topic", 4)), 4)
        n_per_topic = max(n_per_topic, 3)
        # Gemma runs locally — limit to 1 question per topic (≤3 total) for demo speed
        if cs.provider.name == "gemma":
            n_per_topic = 1

        if cs.provider.supports_generation:
            # LLM-generated questions from the knowledge base
            try:
                raw_qs = cs.provider.generate_quiz_questions(topics, n_per_topic)
            except Exception as e:
                return jsonify({"error": f"Question generation failed: {e}"}), 500
            if not raw_qs:
                return jsonify({
                    "error": (
                        "The AI model produced no valid questions. "
                        "Check the server console for the raw output, "
                        "or switch to Gemini in Settings."
                    )
                }), 500

            # Assign temporary negative IDs so the submit route can tell them apart
            questions = []
            gen_map = {}
            for i, q in enumerate(raw_qs):
                qid = -(i + 1)
                is_mc = q.get("type", "mc") == "mc"
                questions.append({
                    "quiz_id": qid,
                    "question": q.get("question", ""),
                    "correct_answer": q.get("correct_answer", ""),
                    "option_a": q.get("option_a") or None,
                    "option_b": q.get("option_b") or None,
                    "option_c": q.get("option_c") or None,
                    "option_d": q.get("option_d") or None,
                    "is_mcq": is_mc,
                    "hint": q.get("hint") or None,
                    "explanation": q.get("explanation") or None,
                    "topic": q.get("topic", ""),
                    "generated": True,
                })
                gen_map[qid] = {
                    "question": q.get("question", ""),
                    "correct_answer": q.get("correct_answer", ""),
                    "explanation": q.get("explanation") or None,
                    "option_a": q.get("option_a") or None,
                    "option_b": q.get("option_b") or None,
                    "option_c": q.get("option_c") or None,
                    "option_d": q.get("option_d") or None,
                    "type": q.get("type", "mc"),
                }

            session["active_quiz_ids"] = [q["quiz_id"] for q in questions]
            session["generated_quiz_map"] = gen_map
            session["quiz_answers"] = []
            return jsonify({"questions": questions, "source": "generated"})

        else:
            # NLTK: serve static KB questions filtered by topic from the bank
            all_qs = cs.quiz_bank_handler.get_all_quiz()
            filtered = [
                q for q in all_qs
                if getattr(q, "topic", None) in topics
            ]
            # Aim for n_per_topic per topic, total capped at 12
            selected = []
            for topic in topics:
                topic_qs = [q for q in filtered if getattr(q, "topic", None) == topic]
                import random
                random.shuffle(topic_qs)
                selected.extend(topic_qs[:n_per_topic])
            selected = selected[:12]

            if not selected:
                # Fallback to random bank questions if no topic-tagged ones exist
                questions = cs.start_quiz(int(data.get("total", 10)))
                session["active_quiz_ids"] = [q["quiz_id"] for q in questions]
                session.pop("generated_quiz_map", None)
                session["quiz_answers"] = []
                return jsonify({"questions": questions, "source": "bank"})

            questions = [_quiz_to_dict(q) for q in selected]
            session["active_quiz_ids"] = [q["quiz_id"] for q in questions]
            session.pop("generated_quiz_map", None)
            session["quiz_answers"] = []
            return jsonify({"questions": questions, "source": "bank"})

    else:
        # Legacy: random selection from full quiz bank
        total = int(data.get("total", 10))
        questions = cs.start_quiz(total)
        session["active_quiz_ids"] = [q["quiz_id"] for q in questions]
        session.pop("generated_quiz_map", None)
        session["quiz_answers"] = []
        return jsonify({"questions": questions, "source": "bank"})


def _quiz_to_dict(q) -> dict:
    return {
        "quiz_id": q.quiz_id,
        "question": q.question,
        "correct_answer": q.correct_answer,
        "option_a": q.option_a or None,
        "option_b": q.option_b or None,
        "option_c": q.option_c or None,
        "option_d": q.option_d or None,
    }


@app.post("/api/quiz/submit")
def api_quiz_submit():
    """One-shot quiz submission: accept full answer list, grade, persist, return score + wrong list."""
    _require_login()
    data = request.get_json(force=True) or {}
    answers = data.get("answers", [])  # [{quiz_id, user_answer}, ...]

    cs = _current_session()
    active_ids = session.get("active_quiz_ids", [])
    gen_map = session.get("generated_quiz_map", {})
    answer_map = {a["quiz_id"]: a.get("user_answer", "") for a in answers}

    correct = 0
    wrong_answers = []

    if gen_map:
        # Grade LLM-generated questions (negative quiz_ids)
        for qid in active_ids:
            qid_int = int(qid)
            q = gen_map.get(qid_int) or gen_map.get(str(qid_int))
            if not q:
                continue
            ua = answer_map.get(qid_int, "")
            ca = q["correct_answer"]
            # For MC: user sends a letter (A/B/C/D); map it to the option text first.
            ua_for_compare = ua
            if q.get("type", "mc") == "mc" and len(ua) == 1 and ua.upper() in "ABCD":
                option_key = f"option_{ua.lower()}"
                ua_for_compare = (q.get(option_key) or "").strip()
            if ua_for_compare.strip().lower() == ca.strip().lower():
                correct += 1
            else:
                wrong_answers.append({
                    "question": q["question"],
                    "user_answer": ua,
                    "correct_answer": ca,
                    "explanation": q.get("explanation"),
                })
        total = len(active_ids)
        score = round(correct / total * 100) if total else 0

        # Persist quiz record using a synthetic entry (score only, no bank reference)
        quiz_record_handler.save_quiz_result(
            user_id=session["user_id"],
            score=str(score),
        )
        records = quiz_record_handler.get_quiz_results_by_user_id(session["user_id"])
        latest_record_id = records[-1]["id"] if records else None

    else:
        # Grade from quiz bank (original flow)
        all_quizzes = {q.quiz_id: q for q in cs.quiz_bank_handler.get_all_quiz()}
        cs._active_quiz = [all_quizzes[i] for i in active_ids if i in all_quizzes]
        cs._quiz_results = []

        for idx, quiz in enumerate(cs._active_quiz):
            ua = answer_map.get(quiz.quiz_id, "")
            cs.submit_answer(idx, ua)

        final = cs.finish_quiz()
        score = final["score"]
        wrong_answers = [
            {
                "question": w.question,
                "user_answer": w.user_answer,
                "correct_answer": w.correct_answer,
            }
            for w in final["wrong_answers"]
        ]
        records = quiz_record_handler.get_quiz_results_by_user_id(session["user_id"])
        latest_record_id = records[-1]["id"] if records else None

    session.pop("active_quiz_ids", None)
    session.pop("generated_quiz_map", None)
    return jsonify({
        "score": score,
        "quiz_record_id": latest_record_id,
        "wrong_answers": wrong_answers,
    })


# ---------- Revision notes ----------

@app.post("/api/revision/generate")
def api_revision_generate():
    _require_login()
    data = request.get_json(force=True) or {}
    wrong_raw = data.get("wrong_answers", [])
    quiz_record_id: Optional[int] = data.get("quiz_record_id")
    wrong_details = data.get("wrong_details", [])  # full QuizAnswerReview objects from frontend

    if not wrong_raw:
        return jsonify({"ok": False, "error": "No wrong answers supplied"}), 400

    wrong = [
        QuizAttempt(
            question=w.get("question", ""),
            user_answer=w.get("user_answer", ""),
            correct_answer=w.get("correct_answer", ""),
        )
        for w in wrong_raw
    ]

    cs = _current_session()
    try:
        markdown = cs.build_revision_note(wrong)
    except NotImplementedError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    record = revision_note_handler.save_revision_note(
        user_id=session["user_id"],
        quiz_record_id=quiz_record_id,
        provider_used=cs.provider.name,
        markdown=markdown,
        wrong_details_json=json.dumps(wrong_details),
    )
    return jsonify({"ok": True, "id": record["id"], "markdown": markdown, "wrong_details": wrong_details})


@app.get("/api/revision")
def api_revision_list():
    _require_login()
    return jsonify({"notes": revision_note_handler.get_revision_notes_by_user_id(session["user_id"])})


@app.get("/api/revision/<int:note_id>")
def api_revision_get(note_id: int):
    _require_login()
    note = revision_note_handler.get_revision_note_by_id(note_id, session["user_id"])
    if note is None:
        abort(404)
    return jsonify(note)


# ---------- Static serving (production) ----------
#
# Supports both build modes:
#   npm run build          → multi-file: dist/index.html + dist/assets/*
#   npm run build:single   → single vanilla index.html with everything inlined
#
# Any non-/api path falls through to index.html so client-side router
# (react-router-dom) can handle /login, /chat, /quiz, etc.

def _serve_index():
    index_file = FRONTEND_DIST / "index.html"
    if not index_file.exists():
        return jsonify({
            "status": "ok",
            "message": (
                "API running. Build the frontend first:\n"
                "  cd frontend && npm run build           (multi-file)\n"
                "  cd frontend && npm run build:single    (single vanilla index.html)\n"
                "Or run the Vite dev server on :5173."
            ),
        })
    return send_from_directory(FRONTEND_DIST, "index.html")


@app.get("/assets/<path:filename>")
def assets(filename: str):
    return send_from_directory(FRONTEND_DIST / "assets", filename)


@app.get("/")
@app.get("/<path:path>")
def catch_all(path: str = ""):
    # /api/* is handled by dedicated routes above; Flask will dispatch there
    # before reaching this catch-all.
    if path and (FRONTEND_DIST / path).is_file():
        # Serve real static files like vite.svg, favicon.ico, manifest.json, …
        return send_from_directory(FRONTEND_DIST, path)
    return _serve_index()


# ---------- Error handlers ----------

@app.errorhandler(401)
def _401(e):
    return jsonify({"ok": False, "error": str(e.description) if hasattr(e, "description") else "Unauthorized"}), 401


@app.errorhandler(404)
def _404(e):
    return jsonify({"ok": False, "error": "Not found"}), 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
