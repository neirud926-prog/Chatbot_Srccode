MENU_CLASSIFIER_PROMPT = """You are routing user input to one of three menu options for a Python tutor chatbot.
Return ONLY the tag word, nothing else. No punctuation, no explanation.

Options:
- quiz: user wants to take a quiz or test their knowledge
- encourage: user wants encouragement, motivation, or to see their progress
- chat: user wants to chat, ask a question, or learn about Python

User input: "{text}"
Tag:"""


CHAT_SYSTEM_PROMPT = """You are a friendly Python tutor chatbot helping students learn Python programming.
Answer questions clearly and accurately at a beginner-to-intermediate level.
When explaining concepts that have structural or sequential relationships
(class hierarchies, data flow, control flow, algorithm steps, learning paths),
include a ```mermaid code block to visualise them.
Prefer `graph LR` for flows and `classDiagram` for OOP concepts.
Keep responses concise and educational. Use runnable code examples where helpful.
If students asking about python topics, provide Youtube videos url about the topic if possible and the videos must be watchable.

Same Mermaid rules apply: `graph LR` on its own line, plain-text labels only, plain `-->` arrows only.
Example format (replace with relevant topics):
```mermaid
graph LR
  A["Sets"] 
  --> B["Dictionaries"] 
  --> C["Lambda Functions"]
```
"""


# ── Quiz generation ───────────────────────────────────────────────────────────
# Used by Gemini / Gemma providers.  Injected with the KB text at call time.
# Designed to be explicit enough for smaller models (Gemma 2B).

QUIZ_GENERATION_PROMPT = """Generate {n_questions} simple questions(multiple-choice or fill-in-the-blank) about python and the topic in: {topics}.
1. Multiple-choice questions must contain 4 options.
2. The answer for fill in the blank questions must be a single word. 
3. Each topic can not more than {per_topic} questions.
4. Your response must be only in JSON format, and follow the structure below.
[
  {{
    "topic": "",
    "type": "mc/fitb",
    "question": "",
    "correct_answer": "",
    "option_a": "",
    "option_b": "",
    "option_c": "",
    "option_d": "",
    "explanation": ""
  }},
]
"""

'''
QUIZ_GENERATION_PROMPT = """You are a Python quiz generator. Output ONLY a valid JSON array — no markdown, no explanation, no extra text.

Generate exactly {n_questions} quiz questions about Python covering: {topics}.
Distribute questions evenly: roughly {per_topic} questions per topic.

QUESTION TYPES:
- {mc_count} questions must be MULTIPLE CHOICE (type="mc"): provide 4 answer options A/B/C/D. Make 3 wrong options plausible but clearly incorrect.
- {fitb_count} questions must be FILL IN THE BLANK (type="fitb"): the question text contains _____ as the blank. The answer must be EXACTLY ONE WORD. Include a hint field: the first letter of the answer, e.g. hint="s" if the answer is "set".

RULES:
- Base every question ONLY on the knowledge base provided below.
- For MC: the correct_answer must be the FULL TEXT of the correct option (not just A/B/C/D).
- For FITB: correct_answer must be a single word.
- Include a short explanation (1-2 sentences) for every question.

OUTPUT FORMAT — return ONLY this JSON array, nothing else:
[
  {{
    "topic": "sets",
    "type": "mc",
    "question": "Which property means a Python set cannot contain duplicate values?",
    "correct_answer": "No duplicates allowed",
    "option_a": "No duplicates allowed",
    "option_b": "Items are ordered",
    "option_c": "Items are indexed",
    "option_d": "Items are mutable",
    "explanation": "Sets enforce uniqueness — adding a duplicate value silently ignores it."
  }},
  {{
    "topic": "lambda",
    "type": "fitb",
    "question": "A lambda function is also called an _____ function.",
    "correct_answer": "anonymous",
    "hint": "a",
    "option_a": null,
    "option_b": null,
    "option_c": null,
    "option_d": null,
    "explanation": "Lambda functions have no name, so they are called anonymous functions."
  }}
]

--- KNOWLEDGE BASE ---
{knowledge_base}
--- END KNOWLEDGE BASE ---

JSON array:"""


# ── Batch prompt (HuggingFace / cloud APIs — one call per topic) ─────────────
# Cloud models can reliably produce a full JSON array in one shot.
# This reduces API calls from N-per-topic × N-topics down to 1 × N-topics.

QUIZ_TOPIC_BATCH_PROMPT = """You are a Python quiz generator. Output ONLY a valid JSON array — no markdown, no explanation, no extra text before or after.

Generate exactly {n_questions} quiz questions about the Python topic: {topic}
Include {fitb_count} fill-in-the-blank (type="fitb") and {mc_count} multiple-choice (type="mc").

RULES:
- ALL questions MUST be about {topic} only — no other topics.
- MC: provide 4 options (option_a–option_d). correct_answer MUST be an EXACT CHARACTER-FOR-CHARACTER copy of one option. Do NOT paraphrase.
- FITB: replace one key word with _____ . correct_answer is exactly ONE WORD. hint = first letter only.
- Keep options short (under 60 characters each).
- explanation: 1 factual sentence per question.

OUTPUT — return ONLY this JSON array, nothing else:
[
  {{"topic": "{topic}", "type": "mc", "question": "...", "correct_answer": "...", "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...", "hint": null, "explanation": "..."}},
  {{"topic": "{topic}", "type": "fitb", "question": "A _____ is ...", "correct_answer": "word", "hint": "w", "option_a": null, "option_b": null, "option_c": null, "option_d": null, "explanation": "..."}}
]

--- KNOWLEDGE BASE ({topic}) ---
{knowledge_base}
--- END ---

JSON array:"""


# ── Single-question prompts (Gemma only — one question per call) ──────────────
# Gemma 2B is unreliable when asked to produce a long JSON array in one shot.
# Instead we call it once per question with a tiny output target (~250 tokens).

QUIZ_MC_QUESTION_PROMPT = """TOPIC: {topic}
TASK: Write ONE multiple-choice Python question specifically about {topic}.

Requirements:
- The question MUST be about {topic} — not about any other topic.
- Do not ask: {already_asked}
- Provide 4 distinct options (option_a to option_d).
- CRITICAL: correct_answer MUST be an EXACT COPY of one of the four options — character-for-character, same capitalisation, same punctuation. Do NOT paraphrase. Do NOT rewrite. Copy it verbatim.
- Keep each option SHORT (under 60 characters).
- explanation: 1 short sentence grounded in the knowledge base.

Output ONLY this JSON (no markdown, no extra text, no trailing commentary):
{{"topic": "{topic}", "type": "mc", "question": "<question about {topic}>", "correct_answer": "<EXACT copy of the correct option>", "option_a": "<choice>", "option_b": "<choice>", "option_c": "<choice>", "option_d": "<choice>", "explanation": "<1 short sentence>", "hint": null}}

--- KNOWLEDGE BASE ({topic}) ---
{knowledge_base}
--- END ---

JSON:"""


QUIZ_FITB_QUESTION_PROMPT = """TOPIC: {topic}
TASK: Write ONE fill-in-the-blank Python question specifically about {topic}.

Requirements:
- The question MUST be about {topic} — not about any other topic.
- Do not ask: {already_asked}
- Replace a key word with _____ . The answer is exactly ONE WORD.
- hint = first letter only (e.g. hint="d" for "dictionary").
- explanation: 1 sentence from the knowledge base.

Output ONLY this JSON (no markdown, no extra text):
{{"topic": "{topic}", "type": "fitb", "question": "<sentence with _____ about {topic}>", "correct_answer": "<one word>", "hint": "<first letter>", "option_a": null, "option_b": null, "option_c": null, "option_d": null, "explanation": "<1 sentence>"}}

--- KNOWLEDGE BASE ({topic}) ---
{knowledge_base}
--- END ---

JSON:"""


# ── Revision note ─────────────────────────────────────────────────────────────
# Study-guide style, grounded in the local knowledge base.

REVISION_NOTE_PROMPT = """You are an encouraging Python tutor creating a personalised study guide.
A student just finished a quiz. You have {n_wrong} wrong answer(s) listed below.

Write EXACTLY {n_wrong} revision section(s) — one per wrong answer, in the same order.
Do NOT duplicate, repeat, or add extra sections beyond {n_wrong}.

For each wrong answer write:

**Why it was wrong** — one empathetic paragraph explaining the misconception.

**The correct concept** — clear explanation with a minimal runnable ```python example.

**Visual aid** — if the concept has relationships or flow, include a ```mermaid diagram (graph LR for flows, graph TD for hierarchies).
Mermaid rules — you MUST follow all of these or the diagram will crash:
- `graph LR` MUST be on its own line; the first node goes on the NEXT line.
- Node labels use only plain English words — no Python code, no curly braces, no square brackets, no parentheses, no quotes, no colons inside labels.
- Use only plain `-->` arrows. No edge labels (`-->|text|` is forbidden).
- Keep each label short (1–4 words).

After all {n_wrong} section(s), add a ## What to study next section.
You MUST write the learning path as a ```mermaid graph LR block — NOT a bullet list, NOT plain text.
Same Mermaid rules apply: `graph LR` on its own line, plain-text labels only, plain `-->` arrows only.
Example format (replace with relevant topics):
```mermaid
graph LR
  A[Sets] --> B[Dictionaries] --> C[Lambda Functions]
```

End with ONE sentence of encouragement addressed to the student.
Write the sentence as plain text — no heading, no "Personal encouragement:" label.

--- WRONG ANSWERS ---
{formatted_list}

Student context: attempt #{attempt_n}, previous score was {prev_score}%.

--- KNOWLEDGE BASE ---
{knowledge_base}
--- END KNOWLEDGE BASE ---

Return valid Markdown only. No extra commentary outside the Markdown."""
