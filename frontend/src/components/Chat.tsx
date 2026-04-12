import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { api, type QuizQuestion, type WrongAnswer } from '../lib/api';
import {
  type ActionButton,
  type ChatSession,
  type NoteListPayload,
  type QuizQuestionPayload,
  type QuizAnswerReview,
  type QuizResultPayload,
  type RevisionNotePayload,
  type SessionMode,
  type StoredMessage,
  type ThinkingMetaPayload,
  claimAnonymousSessions,
  createSession,
  deleteSession,
  deriveTitle,
  loadSessions,
  saveSession,
} from '../lib/storage';
import { MarkdownWithMermaid } from '../lib/markdown-mermaid';
import { useTheme } from '../lib/theme';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    ) {
      return 'Today';
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const ACTION_BUTTONS: ActionButton[] = [
  { label: '📝 Quiz me', action: 'start_quiz' },
  { label: '🌟 Encourage me', action: 'encourage' },
  { label: '💬 Chat with me', action: 'start_chat' },
  { label: '📚 Revision notes', action: 'show_notes' },
];

function makeMsg(
  role: 'user' | 'assistant',
  content: string,
  kind: StoredMessage['kind'] = 'text',
  payload?: StoredMessage['payload'],
): StoredMessage {
  return { role, content, ts: new Date().toISOString(), kind, payload };
}

function buildLoginGreeting(): StoredMessage[] {
  return [
    makeMsg('assistant', 'Welcome to PolyU SPEED SEHS4678 Python tutor! Developed by NKH, CLS, WFW & WST. 👋'),
    makeMsg('assistant', 'Please enter your Username:'),
  ];
}

function buildMenuGreeting(username: string): StoredMessage[] {
  return [
    makeMsg('assistant', `Hi ${username}! How can I help support your learning today?`),
    makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
  ];
}

/** Generative backends get a "thinking" chip before their replies. */
function isGenerativeProvider(name: string): boolean {
  return name === 'huggingface' || name === 'gemma';
}

/** Human-readable label for the thinking chip — shows model name for HF. */
function providerLabel(providerName: string, hfModelId: string): string {
  if (providerName === 'huggingface') {
    return HF_MODELS.find((m) => m.id === hfModelId)?.label ?? 'HuggingFace';
  }
  return providerName;
}

// -----------------------------------------------------------------------------
// Providers for the model switcher
// -----------------------------------------------------------------------------

interface ProviderOption {
  id: string;
  label: string;
  short: string;
}
const PROVIDERS: ProviderOption[] = [
  { id: 'nltk', label: 'NLTK (baseline)', short: 'NLTK' },
  { id: 'huggingface', label: 'HuggingFace API', short: 'HF' },
  { id: 'gemma', label: 'Local Gemma 2B', short: 'Gemma' },
];

interface HFModelOption {
  id: string;       // HuggingFace model ID sent to backend
  label: string;    // full display name
  short: string;    // shown in the provider chip button
  desc: string;     // one-line description shown in picker
}
const HF_MODELS: HFModelOption[] = [
  {
    id: 'openai/gpt-oss-120b',
    label: 'openai gpt-oss-120b',
    short: 'openai gpt-oss-120b',
    desc: 'high-performance, private reasoning and agentic power',
  },
  {
    id: 'Qwen/Qwen2.5-72B-Instruct',
    label: 'Qwen 2.5 72B Instruct',
    short: 'Qwen 2.5 72B (API)',
    desc: 'Most capable — best accuracy, recommended for quizzes',
  },
  {
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    label: 'Llama 3.3 70B Instruct',
    short: 'Llama 3.3 70B (API)',
    desc: 'Excellent reasoning & strict instruction-following',
  },
  {
    id: 'Qwen/Qwen2.5-7B-Instruct',
    label: 'Qwen 2.5 7B Instruct',
    short: 'Qwen 2.5 7B (API)',
    desc: 'Fast — good for chat, lighter on API quota',
  },
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    label: 'Llama 3.1 8B Instruct',
    short: 'Llama 3.1 8B (API)',
    desc: 'Fast — industry standard small model',
  },
  {
    id: 'google/gemma-2-9b-it',
    label: 'Gemma 2 9B IT',
    short: 'Gemma 2 9B (API)',
    desc: 'Fast — Google model, strong conversation',
  },
];
const DEFAULT_HF_MODEL = HF_MODELS[0].id;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function Chat() {
  const prefersReducedMotion = useReducedMotion();
  const { theme, toggle: toggleTheme } = useTheme();

  // Auth + identity
  const [bootDone, setBootDone] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [provider, setProvider] = useState('nltk');
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [hfModel, setHfModel] = useState(DEFAULT_HF_MODEL);

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Input / UI
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Thinking...');
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) || null,
    [sessions, activeId],
  );

  const inPasswordMode = active?.mode.kind === 'await_password';

  // ---------------------------------------------------------------------------
  // Mutation helper — update the active session
  // ---------------------------------------------------------------------------

  const mutate = (
    updater: (s: ChatSession) => ChatSession,
    uid: number | null = userId,
  ) => {
    // IMPORTANT: read the freshest session from localStorage every time.
    // Closure capture would make two sequential appendMessages() calls
    // overwrite each other because each updater sees the stale `active`
    // from the handler's creation time. Loading fresh fixes that.
    const id = active?.id;
    if (!id) return;
    const latest = loadSessions(uid).find((s) => s.id === id);
    if (!latest) return;
    const next = updater(latest);
    saveSession(uid, next);
    setSessions(loadSessions(uid));
    setActiveId(next.id);
  };

  const appendMessages = (msgs: StoredMessage[], uid: number | null = userId) => {
    mutate((s) => {
      const combined = [...s.messages, ...msgs];
      return {
        ...s,
        messages: combined,
        title: s.title === 'New chat' ? deriveTitle(combined) : s.title,
      };
    }, uid);
  };

  const setMode = (mode: SessionMode, uid: number | null = userId) => {
    mutate((s) => ({ ...s, mode }), uid);
  };

  const consumeButtons = () => {
    mutate((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.kind === 'buttons' && !m.consumed ? { ...m, consumed: true } : m,
      ),
    }));
  };

  // ---------------------------------------------------------------------------
  // Boot — hydrate from /api/me + existing localStorage
  // ---------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        if (me.logged_in && me.user_id != null) {
          claimAnonymousSessions(me.user_id);
          setUserId(me.user_id);
          setUsername(me.username ?? null);
          setProvider(me.provider ?? 'nltk');

          let list = loadSessions(me.user_id);
          if (list.length === 0) {
            const fresh = createSession(me.user_id, {
              mode: { kind: 'idle' },
            });
            fresh.messages.push(...buildMenuGreeting(me.username ?? 'there'));
            saveSession(me.user_id, fresh);
            list = loadSessions(me.user_id);
          } else {
            // Inject buttons into any idle session that lacks an unconsumed buttons message
            // (happens when returning to an existing session from before this fix)
            const top = list[0];
            if (
              top.mode.kind === 'idle' &&
              !top.messages.some((m) => m.kind === 'buttons' && !m.consumed)
            ) {
              const patched = {
                ...top,
                messages: [
                  ...top.messages,
                  makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
                ],
              };
              saveSession(me.user_id, patched);
              list = loadSessions(me.user_id);
            }
          }
          setSessions(list);
          setActiveId(list[0].id);
        } else {
          // Anonymous — start a login session
          let list = loadSessions(null);
          if (list.length === 0) {
            const fresh = createSession(null, {
              mode: { kind: 'await_username' },
            });
            fresh.messages.push(...buildLoginGreeting());
            saveSession(null, fresh);
            list = loadSessions(null);
          }
          setSessions(list);
          setActiveId(list[0].id);
        }
      } catch {
        // Backend unreachable — start an anonymous empty session
        const fresh = createSession(null, { mode: { kind: 'await_username' } });
        fresh.messages.push(...buildLoginGreeting());
        saveSession(null, fresh);
        setSessions(loadSessions(null));
        setActiveId(fresh.id);
      } finally {
        setBootDone(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [active?.messages.length, busy, prefersReducedMotion]);

  // Keep input focused when switching sessions / finishing busy work
  useEffect(() => {
    if (!busy && bootDone) {
      inputRef.current?.focus();
    }
  }, [busy, bootDone, activeId]);

  // ---------------------------------------------------------------------------
  // Chat history → format for backend
  // ---------------------------------------------------------------------------

  const textHistoryForApi = (msgs: StoredMessage[]) =>
    msgs
      .filter((m) => m.kind === 'text' || m.kind === undefined)
      .map(({ role, content }) => ({ role, content }));

  // ---------------------------------------------------------------------------
  // Quiz helpers
  // ---------------------------------------------------------------------------

  const questionPrompt = (q: QuizQuestion, n: number, total: number): string =>
    `**Question ${n}/${total}**\n\n${q.question}`;

  const showQuizQuestion = (
    questions: QuizQuestion[],
    index: number,
    currentSession: ChatSession,
  ) => {
    const quiz_encourage = [
        "Keep up the good work!!!",
        "You're doing great, keep it up!!!",
        "Don't give up, you're almost there!!!",
        "Believe in yourself, you can do it!!!",
        "Every step you take is progress, keep going!!!",
    ];

    const random_message = makeMsg('assistant', quiz_encourage[Math.floor(Math.random() * quiz_encourage.length)]);

    const q = questions[index];
    const msg = makeMsg('assistant', questionPrompt(q, index + 1, questions.length), 'quiz-question', {
      question: q,
    } satisfies QuizQuestionPayload);

    let message_qeueue = [...currentSession.messages, msg];
    if (index !== 0)
      message_qeueue = [...currentSession.messages, random_message, msg];

    const next: ChatSession = {
      ...currentSession,
      messages: message_qeueue,
    };
    saveSession(userId, next);
    setSessions(loadSessions(userId));
    setActiveId(next.id);
  };

  const finishQuiz = async (questions: QuizQuestion[], answers: Record<number, string>) => {
    setBusy(true);
    try {
      const payload = questions.map((q) => ({
        quiz_id: q.quiz_id,
        user_answer: answers[q.quiz_id] || '',
      }));
      const res = await api.quizSubmit(payload);

      // Build per-question review (all questions, not just wrong ones)
      const wrongMap = new Map(res.wrong_answers.map((w) => [w.question, w]));
      const all_answers: QuizAnswerReview[] = questions.map((q) => {
        const ua = answers[q.quiz_id] || '';
        const skipped = ua.trim() === '';
        // For MC: grade by matching the selected option text to correct_answer
        let correct = false;
        if (q.is_mcq) {
          const optionMap: Record<string, string> = {
            A: q.option_a ?? '', B: q.option_b ?? '',
            C: q.option_c ?? '', D: q.option_d ?? '',
          };
          correct = (optionMap[ua.toUpperCase()] ?? '').trim().toLowerCase()
            === (q.correct_answer ?? '').trim().toLowerCase();
        } else {
          correct = ua.trim().toLowerCase() === (q.correct_answer ?? '').trim().toLowerCase();
        }
        // Prefer explanation from the wrong_answers response (server may enrich it)
        const serverWrong = wrongMap.get(q.question);
        return {
          question: q.question,
          user_answer: ua,
          correct_answer: q.correct_answer ?? '',
          correct: skipped ? false : correct,
          skipped,
          explanation: (serverWrong as { explanation?: string } | undefined)?.explanation
            ?? q.explanation,
          is_mcq: q.is_mcq,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
        } satisfies QuizAnswerReview;
      });

      appendMessages([
        makeMsg(
          'assistant',
          `Quiz finished — you scored **${res.score}/100**.`,
          'quiz-result',
          {
            score: res.score,
            total: questions.length,
            wrong_answers: res.wrong_answers,
            quiz_record_id: res.quiz_record_id,
            all_answers,
          } satisfies QuizResultPayload,
        ),
      ]);
      setMode({ kind: 'idle' });
      // After a beat, re-show the main menu
      setTimeout(() => {
        appendMessages([makeMsg('assistant', '', 'buttons', ACTION_BUTTONS)]);
      }, 250);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Quiz submit failed');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Button dispatch (main menu + in-chat action buttons)
  // ---------------------------------------------------------------------------

  const handleButton = async (action: string, extra?: unknown) => {
    if (!active) return;
    consumeButtons();

    if (action === 'start_quiz') {
      appendMessages([makeMsg('user', 'Quiz me')]);
      // For Gemma (local model), questions are generated one at a time — show per-question progress.
      // For other providers, use a simple label.
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      if (provider === 'gemma') {
        // Gemma generates one question per topic sequentially on CPU (~20 s each,
        // more on retry). Advance the label every 20 s; stick on "Preparing quiz..."
        // once the last step is reached so late retries don't look stuck.
        const quizLabels = [
          'Generating question 1 / 3 (sets)...',
          'Generating question 2 / 3 (dictionaries)...',
          'Generating question 3 / 3 (lambda)...',
          'Preparing quiz...',
        ];
        let labelIdx = 0;
        setBusyLabel(quizLabels[0]);
        progressTimer = setInterval(() => {
          labelIdx = Math.min(labelIdx + 1, quizLabels.length - 1);
          setBusyLabel(quizLabels[labelIdx]);
        }, 20000);
      } else {
        setBusyLabel('Generating quiz questions...');
      }
      setBusy(true);
      try {
        // Always quiz all 3 KB topics (Sets, Dictionary, Anonymous Function)
        const topics = ['sets', 'dictionaries', 'lambda'];
        const r = await api.quizStartKB(topics, 4);
        if (!r.questions.length) {
          appendMessages([makeMsg('assistant', 'No quiz questions available.')]);
          appendMessages([makeMsg('assistant', '', 'buttons', ACTION_BUTTONS)]);
          return;
        }
        setMode({ kind: 'quiz', questions: r.questions, index: 0, answers: {} });
        appendMessages([
          makeMsg(
            'assistant',
            `Starting a ${r.questions.length}-question Python quiz on **Sets, Dictionary & Anonymous Functions**.\nAnswer each one — I'll score you at the end.`,
          ),
        ]);
        setTimeout(() => {
          const latest = loadSessions(userId).find((s) => s.id === active.id);
          if (latest) showQuizQuestion(r.questions, 0, latest);
        }, 50);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Quiz start failed');
        appendMessages([makeMsg('assistant', '', 'buttons', ACTION_BUTTONS)]);
      } finally {
        if (progressTimer !== null) clearInterval(progressTimer);
        setBusyLabel('Thinking...');
        setBusy(false);
      }
      return;
    }

    if (action === 'encourage') {
      appendMessages([makeMsg('user', 'Encourage me')]);
      setBusyLabel('Generating encouragement...');
      setBusy(true);
      try {
        const r = await api.encourage();
        appendMessages([makeMsg('assistant', r.message)]);
        appendMessages([makeMsg('assistant', '', 'buttons', ACTION_BUTTONS)]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Encourage failed');
      } finally {
        setBusyLabel('Thinking...');
        setBusy(false);
      }
      return;
    }

    if (action === 'start_chat') {
      appendMessages([makeMsg('user', 'Chat with me')]);
      appendMessages([
        makeMsg(
          'assistant',
          `Great — ask me anything about Python. Say "bye" or click another menu button to exit.`,
        ),
      ]);
      setMode({ kind: 'chat' });
      return;
    }

    if (action === 'show_notes') {
      appendMessages([makeMsg('user', 'Revision notes')]);
      setBusy(true);
      try {
        const r = await api.listRevisionNotes();
        if (r.notes.length === 0) {
          appendMessages([
            makeMsg(
              'assistant',
              "You don't have any revision notes yet. Take a quiz, get some answers wrong, and I'll generate one for you.",
            ),
            makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
          ]);
        } else {
          const payload: NoteListPayload = {
            notes: r.notes.slice(0, 8).map((n) => ({
              id: n.id,
              title: `Note #${n.id}`,
              created_at: n.createdAt,
              provider: n.provider_used,
            })),
          };
          appendMessages([
            makeMsg(
              'assistant',
              `You have ${r.notes.length} revision note${r.notes.length === 1 ? '' : 's'}. Pick one to view:`,
              'note-list',
              payload,
            ),
            makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
          ]);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load notes');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'view_note' && typeof extra === 'number') {
      setBusy(true);
      try {
        const note = await api.getRevisionNote(extra);
        appendMessages([
          makeMsg('assistant', '', 'revision-note', {
            markdown: note.markdown,
            provider: note.provider_used,
            note_id: note.id,
            wrong_details: (note.wrong_details as QuizAnswerReview[] | undefined) ?? [],
          } satisfies RevisionNotePayload),
          makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
        ]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load note');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (action === 'generate_note' && extra && typeof extra === 'object') {
      const { wrong_answers, quiz_record_id, wrong_details = [] } = extra as {
        wrong_answers: WrongAnswer[];
        quiz_record_id: number | null;
        wrong_details?: QuizAnswerReview[];
      };

      // Revision notes require a generative provider. Auto-switch to Gemma if on NLTK.
      let noteProvider = provider;
      if (!isGenerativeProvider(provider)) {
        try {
          await api.setSettings({ provider: 'gemma' });
          setProvider('gemma');
          noteProvider = 'gemma';
          appendMessages([
            makeMsg('assistant', '🔄 Switched to **Gemma** (local AI) to generate your study guide.'),
          ]);
        } catch {
          appendMessages([
            makeMsg('assistant', '⚠️ Revision notes need HuggingFace or Gemma. Please switch provider in Settings first.'),
            makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
          ]);
          return;
        }
      }

      appendMessages([makeMsg('user', '✨ Generate revision note')]);
      setBusyLabel('Reviewing your answers...');
      let noteTimer: ReturnType<typeof setTimeout> | null = null;
      noteTimer = setTimeout(() => setBusyLabel('Generating revision note...'), 6000);
      setBusy(true);
      const t0 = Date.now();
      try {
        const r = await api.generateRevisionNote({ wrong_answers, quiz_record_id, wrong_details });
        const elapsed = Date.now() - t0;
        const msgs: StoredMessage[] = [];
        if (isGenerativeProvider(noteProvider)) {
          msgs.push(
            makeMsg('assistant', '', 'thinking-meta', {
              provider: noteProvider,
              elapsed_ms: elapsed,
              kind: 'revision-note',
              detail: `Generated by ${providerLabel(noteProvider, hfModel)} in ${(elapsed / 1000).toFixed(2)}s`,
            } satisfies ThinkingMetaPayload),
          );
        }
        msgs.push(
          makeMsg('assistant', '', 'revision-note', {
            markdown: r.markdown,
            provider: noteProvider,
            note_id: r.id,
            wrong_details: (r.wrong_details as QuizAnswerReview[] | undefined) ?? wrong_details,
          } satisfies RevisionNotePayload),
        );
        msgs.push(makeMsg('assistant', '', 'buttons', ACTION_BUTTONS));
        appendMessages(msgs);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not generate note';
        if (msg.includes('nltk does not support')) {
          appendMessages([
            makeMsg(
              'assistant',
              "NLTK can't generate revision notes — it's a pattern classifier, not a generative model. Switch to **Gemini** or **Gemma** using the model picker at the bottom-right of the input.",
            ),
            makeMsg('assistant', '', 'buttons', ACTION_BUTTONS),
          ]);
        } else {
          setError(msg);
        }
      } finally {
        if (noteTimer !== null) clearTimeout(noteTimer);
        setBusyLabel('Thinking...');
        setBusy(false);
      }
      return;
    }

    if (action === 'answer_mcq' && typeof extra === 'string') {
      await submitQuizAnswer(extra);
      return;
    }

    if (action === 'logout') {
      try {
        await api.logout();
      } catch {
        /* ignore */
      }
      window.location.reload();
      return;
    }
  };

  // ---------------------------------------------------------------------------
  // Send / state-machine dispatcher
  // ---------------------------------------------------------------------------

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy || !active) return;

    const mode = active.mode;

    // await_username → store and ask password
    if (mode.kind === 'await_username') {
      setInput('');
      appendMessages([makeMsg('user', text)]);
      setTimeout(() => {
        appendMessages([makeMsg('assistant', 'Please enter your Password:')]);
        setMode({ kind: 'await_password', username: text });
      }, 80);
      return;
    }

    // await_password → attempt login
    if (mode.kind === 'await_password') {
      setInput('');
      const masked = '•'.repeat(Math.min(text.length, 12));
      appendMessages([makeMsg('user', masked)]);
      setBusy(true);
      try {
        const result = await api.login(mode.username, text);
        if (result.ok && result.user_id != null) {
          // Migrate anonymous session into the user's storage
          claimAnonymousSessions(result.user_id);
          setUserId(result.user_id);
          setUsername(mode.username);
          // IMPORTANT: pass the fresh user_id explicitly — React's setUserId
          // is async so `userId` state is still null in this closure.
          appendMessages(buildMenuGreeting(mode.username), result.user_id);
          setMode({ kind: 'idle' }, result.user_id);
          // Refresh provider from backend
          api.getSettings().then((s) => setProvider(s.provider)).catch(() => {});
        } else if (result.ok) {
          // Login returned ok but no user_id — treat as failure
          appendMessages([
            makeMsg('assistant', '❌ Login succeeded but no user ID returned.'),
            makeMsg('assistant', 'Please enter your Username:'),
          ]);
          setMode({ kind: 'await_username' });
        } else {
          appendMessages([
            makeMsg('assistant', `❌ ${result.message}`),
            makeMsg('assistant', 'Please enter your Username:'),
          ]);
          setMode({ kind: 'await_username' });
        }
      } catch (e: unknown) {
        appendMessages([
          makeMsg('assistant', `❌ ${e instanceof Error ? e.message : 'Login failed'}`),
          makeMsg('assistant', 'Please enter your Username:'),
        ]);
        setMode({ kind: 'await_username' });
      } finally {
        setBusy(false);
      }
      return;
    }

    // quiz → submit as the current question's answer
    if (mode.kind === 'quiz') {
      const currentQ = mode.questions[mode.index];
      if (currentQ.is_mcq) {
        // Only accept A/B/C/D via text for MCQ
        const upper = text.toUpperCase();
        if (!['A', 'B', 'C', 'D'].includes(upper)) {
          appendMessages([
            makeMsg(
              'assistant',
              'Please answer with A, B, C, or D — or click one of the buttons above.',
            ),
          ]);
          setInput('');
          return;
        }
        setInput('');
        await submitQuizAnswer(upper);
      } else {
        setInput('');
        await submitQuizAnswer(text);
      }
      return;
    }

    // chat → free-chat mode
    if (mode.kind === 'chat') {
      setInput('');
      const userMsg = makeMsg('user', text);
      appendMessages([userMsg]);
      setBusyLabel('Thinking...');
      setBusy(true);
      const t0 = Date.now();
      try {
        const history = textHistoryForApi([...active.messages, userMsg]);
        const res = await api.chat(text, history);
        appendMessages(buildReplyMessages(res.reply, Date.now() - t0, 'chat'));
        if (res.tag === 'goodbye') {
          setMode({ kind: 'idle' });
          appendMessages([makeMsg('assistant', '', 'buttons', ACTION_BUTTONS)]);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Chat failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    // idle → treat as chat message (starts chat mode implicitly)
    if (mode.kind === 'idle') {
      setInput('');
      appendMessages([makeMsg('user', text)]);
      setBusyLabel('Thinking...');
      setBusy(true);
      const t0 = Date.now();
      try {
        const res = await api.chat(text, textHistoryForApi(active.messages));
        appendMessages(buildReplyMessages(res.reply, Date.now() - t0, 'chat'));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Chat failed');
      } finally {
        setBusy(false);
      }
      return;
    }
  };

  /** Wraps a generative reply with a collapsible thinking-meta chip. NLTK gets
   *  no chip because its latency is already <50ms and there's nothing to hide. */
  const buildReplyMessages = (
    reply: string,
    elapsedMs: number,
    kind: ThinkingMetaPayload['kind'],
  ): StoredMessage[] => {
    const msgs: StoredMessage[] = [];
    if (isGenerativeProvider(provider)) {
      msgs.push(
        makeMsg('assistant', '', 'thinking-meta', {
          provider,
          elapsed_ms: elapsedMs,
          kind,
          detail: `Generated by ${providerLabel(provider, hfModel)} in ${(elapsedMs / 1000).toFixed(2)}s`,
        } satisfies ThinkingMetaPayload),
      );
    }
    msgs.push(makeMsg('assistant', reply));
    return msgs;
  };

  const submitQuizAnswer = async (userAnswer: string) => {
    if (!active || active.mode.kind !== 'quiz') return;
    const mode = active.mode;
    const q = mode.questions[mode.index];

    // Grade locally for immediate feedback (backend will re-grade on submit)
    let correct = false;
    let correctAnswer = q.correct_answer || '';
    if (q.is_mcq) {
      const optionMap: Record<string, string> = {
        A: q.option_a ?? '',
        B: q.option_b ?? '',
        C: q.option_c ?? '',
        D: q.option_d ?? '',
      };
      const selected = (optionMap[userAnswer.toUpperCase()] || '').trim().toLowerCase();
      correct = selected === (q.correct_answer || '').trim().toLowerCase();
      correctAnswer = q.correct_answer || '';
    } else {
      correct =
        userAnswer.trim().toLowerCase() === (q.correct_answer || '').trim().toLowerCase();
    }

    // Mark the question message as answered and append a user-answer bubble
    mutate((s) => ({
      ...s,
      messages: s.messages.map((m, i) => {
        const isLastQuestion =
          m.kind === 'quiz-question' &&
          (m.payload as QuizQuestionPayload)?.question?.quiz_id === q.quiz_id &&
          !(m.payload as QuizQuestionPayload)?.answered &&
          i === s.messages.length - 1;
        if (!isLastQuestion) return m;
        return {
          ...m,
          payload: {
            ...(m.payload as QuizQuestionPayload),
            answered: { user_answer: userAnswer, correct, correct_answer: correctAnswer },
          },
        };
      }),
    }));

    const feedback = correct ? '✅ Correct!' : `❌ Incorrect. Correct answer: **${correctAnswer}**`;
    appendMessages([
      makeMsg('user', q.is_mcq ? `Option ${userAnswer.toUpperCase()}` : userAnswer),
      makeMsg('assistant', feedback),
    ]);

    const newAnswers = { ...mode.answers, [q.quiz_id]: userAnswer };
    if (mode.index + 1 < mode.questions.length) {
      setMode({ ...mode, index: mode.index + 1, answers: newAnswers });
      setTimeout(() => {
        const latest = loadSessions(userId).find((s) => s.id === active.id);
        if (latest) showQuizQuestion(mode.questions, mode.index + 1, latest);
      }, 80);
    } else {
      // Done
      await finishQuiz(mode.questions, newAnswers);
    }
  };

  // ---------------------------------------------------------------------------
  // Provider switch
  // ---------------------------------------------------------------------------

  const changeProvider = async (id: string) => {
    setProvider(id);
    // Keep menu open when switching to HF so the model sub-picker is visible
    if (id !== 'huggingface') setProviderMenuOpen(false);
    try {
      await api.setSettings({ provider: id });
    } catch {
      /* ignore */
    }
  };

  const changeHfModel = async (modelId: string) => {
    setHfModel(modelId);
    setProviderMenuOpen(false);
    try {
      await api.setSettings({ hf_model: modelId });
    } catch {
      /* ignore */
    }
  };

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  const newChat = () => {
    const isLoggedIn = userId != null;
    const fresh = createSession(userId, {
      mode: isLoggedIn ? { kind: 'idle' } : { kind: 'await_username' },
    });
    if (isLoggedIn) {
      fresh.messages.push(...buildMenuGreeting(username ?? 'there'));
    } else {
      fresh.messages.push(...buildLoginGreeting());
    }
    saveSession(userId, fresh);
    setSessions(loadSessions(userId));
    setActiveId(fresh.id);
    setError(null);
  };

  const removeSession = (id: string) => {
    if (!confirm('Delete this conversation?')) return;
    deleteSession(userId, id);
    const remaining = loadSessions(userId);
    setSessions(remaining);
    if (activeId === id) {
      if (remaining.length > 0) setActiveId(remaining[0].id);
      else newChat();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!bootDone) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center">
        Loading…
      </div>
    );
  }

  const showEmptyHero = active && active.messages.length <= 1 && active.mode.kind === 'await_username';

  return (
    <div className="h-screen flex bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      {/* ============================ SIDEBAR ============================= */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            key="sidebar"
            initial={{ width: prefersReducedMotion ? 260 : 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="shrink-0 bg-[var(--bg-elevated)] border-r border-[var(--border)] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-9 h-9 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text)]"
                title="Collapse menu"
                aria-label="Collapse menu"
              >
                ☰
              </button>
              <div className="text-sm text-[var(--text)] font-medium truncate">PolyU SPEED SEHS4678</div>
            </div>

            <div className="px-3">
              <button
                onClick={newChat}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full bg-[var(--bg-hover)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text)]"
              >
                <span className="text-lg leading-none">✎</span>
                New chat
              </button>
            </div>

            <div className="mt-6 px-3 text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
              Chats
            </div>
            <div className="flex-1 overflow-y-auto mt-1 px-2 pb-3">
              {sessions.length === 0 && (
                <div className="px-3 py-4 text-xs text-[var(--text-dim)]">No conversations yet.</div>
              )}
              {sessions.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <div
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`group px-3 py-2 rounded-lg cursor-pointer mb-0.5 ${
                      isActive ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{s.title}</div>
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                          {fmtDate(s.updatedAt)} · {fmtTime(s.updatedAt)}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSession(s.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-red-400 text-xs"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-[var(--border)] px-3 py-3">
              {username ? (
                <button
                  onClick={() => handleButton('logout')}
                  className="w-full text-left text-sm text-[var(--text)] hover:bg-[var(--bg-hover)] rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-xs font-bold">
                      {username.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="flex-1">{username}</span>
                    <span className="text-xs text-[var(--text-dim)]">Sign out</span>
                  </div>
                </button>
              ) : (
                <div className="text-xs text-[var(--text-dim)] px-3 py-2">Not signed in</div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ============================== MAIN =============================== */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-9 h-9 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text)]"
                title="Open menu"
                aria-label="Open menu"
              >
                ☰
              </button>
            )}
            <div className="text-[var(--text)] font-medium">PY Chatbot</div>
          </div>
          <div className="flex items-center gap-3 pr-2">
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)]"
              title={theme === 'dark' ? 'Switch to nature theme' : 'Switch to dark theme'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                // sun icon
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              ) : (
                // moon icon
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <div className="text-xs text-[var(--text-dim)]">
              {username ? `Signed in as ${username}` : 'Not signed in'}
            </div>
          </div>
        </header>

        {/* Messages area */}
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const bottom = el.scrollHeight - el.clientHeight - el.scrollTop;
            setAtBottom(bottom < 40);
          }}
          className="flex-1 overflow-y-auto px-4 md:px-8 py-6 relative"
        >
          {showEmptyHero && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-x-0 top-[18%] text-center pointer-events-none"
            >
              <div className="text-5xl md:text-6xl font-semibold bg-gradient-to-r from-brand-300 via-brand-400 to-fuchsia-400 bg-clip-text text-transparent">
                Hi there
              </div>
              <div className="text-3xl md:text-4xl text-[var(--text)] mt-2">
                Where should we start?
              </div>
            </motion.div>
          )}

          <div className="max-w-3xl mx-auto space-y-4">
            {active && active.messages.length > 0 && (
              <div className="text-center text-[10px] uppercase tracking-widest text-[var(--text-dim)] mb-1">
                Today
              </div>
            )}
            {(() => {
              if (!active) return null;
              const lastUserIdx = (() => {
                for (let i = active.messages.length - 1; i >= 0; i--) {
                  if (active.messages[i].role === 'user') return i;
                }
                return -1;
              })();
              return (
                <AnimatePresence initial={false}>
                  {active.messages.map((m, i) => (
                    <motion.div
                      key={`${active.id}-${i}`}
                      layout
                      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0.12 }
                          : { type: 'spring', stiffness: 360, damping: 28 }
                      }
                    >
                      <MessageView
                        msg={m}
                        onButton={handleButton}
                        disableButtons={busy}
                        isLastUserMessage={i === lastUserIdx}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              );
            })()}

            <AnimatePresence>
              {busy && (
                <motion.div
                  key="typing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-[var(--text-dim)] text-sm"
                >
                  <span className="inline-flex gap-1">
                    {[0, 1, 2].map((n) => (
                      <motion.span
                        key={n}
                        className="w-1.5 h-1.5 rounded-full bg-slate-400"
                        animate={prefersReducedMotion ? {} : { y: [0, -4, 0] }}
                        transition={{
                          duration: 0.9,
                          repeat: Infinity,
                          delay: n * 0.15,
                          ease: 'easeInOut',
                        }}
                      />
                    ))}
                  </span>
                  {busyLabel}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Floating scroll-to-bottom button */}
          <AnimatePresence>
            {!atBottom && (
              <motion.button
                key="scroll-btn"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.15 }}
                onClick={() =>
                  scrollRef.current?.scrollTo({
                    top: scrollRef.current.scrollHeight,
                    behavior: 'smooth',
                  })
                }
                className="sticky bottom-4 mx-auto block w-9 h-9 rounded-full bg-[var(--bg-card)] border border-[var(--border)] shadow-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
                title="Scroll to bottom"
                aria-label="Scroll to bottom"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {error && (
          <div className="px-6 py-2 text-sm text-red-400 border-t border-[var(--border)]">
            {error}{' '}
            <button onClick={() => setError(null)} className="underline ml-2">
              dismiss
            </button>
          </div>
        )}

        {/* Input bar */}
        <div className="px-3 md:px-8 py-4 border-t border-[var(--border)]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="max-w-3xl mx-auto"
          >
            <div className="flex items-center gap-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-full pl-5 pr-2 py-2 focus-within:border-brand-400 transition-colors">
              <input
                ref={inputRef}
                type={inPasswordMode ? 'password' : 'text'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  inPasswordMode
                    ? 'Enter your password…'
                    : active?.mode.kind === 'await_username'
                      ? 'Enter your username…'
                      : active?.mode.kind === 'quiz'
                        ? 'Type A, B, C, or D — or your answer…'
                        : 'Ask anything…'
                }
                className="flex-1 bg-transparent outline-none text-[var(--text)] placeholder:text-[var(--text-dim)]"
                disabled={busy}
                autoComplete={inPasswordMode ? 'current-password' : 'off'}
              />

              {/* Provider picker */}
              {username && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProviderMenuOpen((v) => !v)}
                    className="text-xs px-3 py-1.5 rounded-full bg-[var(--bg-hover)] hover:bg-[var(--bg-hover)] text-[var(--text)] mr-1"
                    title="Switch AI backend"
                  >
                    {provider === 'huggingface'
                      ? (HF_MODELS.find((m) => m.id === hfModel)?.short ?? 'HF (API)')
                      : (PROVIDERS.find((p) => p.id === provider)?.short || provider)
                    } ▾
                  </button>
                  <AnimatePresence>
                    {providerMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full right-0 mb-2 w-56 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden z-10"
                      >
                        {PROVIDERS.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => changeProvider(p.id)}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--bg-hover)] ${
                              p.id === provider
                                ? 'text-brand-300'
                                : 'text-[var(--text)]'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                        {/* Model picker — shown when HuggingFace is the active provider */}
                        {provider === 'huggingface' && (
                          <div className="border-t border-[var(--border)]">
                            <p className="px-4 py-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Model</p>
                            {HF_MODELS.map((m) => (
                              <button
                                type="button"
                                key={m.id}
                                onClick={() => changeHfModel(m.id)}
                                className={`w-full text-left px-4 py-2 hover:bg-[var(--bg-hover)] ${
                                  m.id === hfModel ? 'text-brand-300' : 'text-[var(--text)]'
                                }`}
                              >
                                <span className="block text-sm">{m.label}</span>
                                <span className="block text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">{m.desc}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <motion.button
                type="submit"
                disabled={busy || !input.trim()}
                whileTap={busy || !input.trim() ? {} : { scale: 0.94 }}
                className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white"
                title="Send"
                aria-label="Send"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
              </motion.button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

// -----------------------------------------------------------------------------
// One message rendered — Botpress-style layout:
//   - bot messages: B avatar on the left + gray bubble
//   - user messages: right-aligned brand-blue bubble + "Delivered" status on
//     the last one
//   - chip-only messages (buttons, option chips, thinking-meta) omit the
//     avatar but keep the left indent so they visually attach to the preceding
//     bot message.
// -----------------------------------------------------------------------------

const AVATAR_CLASS =
  'w-7 h-7 rounded-full bg-brand-500 text-white flex items-center justify-center text-xs font-bold shrink-0';

function BotAvatar() {
  return <div className={AVATAR_CLASS}>B</div>;
}

function BotAvatarSpacer() {
  return <div className="w-7 shrink-0" />;
}

function BotRow({
  children,
  showAvatar = true,
}: {
  children: React.ReactNode;
  showAvatar?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      {showAvatar ? <BotAvatar /> : <BotAvatarSpacer />}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block max-w-[88%] rounded-2xl rounded-tl-sm bg-[var(--bg-card)] border border-[var(--border)] px-4 py-2.5 text-[var(--text)] leading-relaxed">
      {children}
    </div>
  );
}

interface MessageViewProps {
  msg: StoredMessage;
  onButton: (action: string, extra?: unknown) => void;
  disableButtons: boolean;
  isLastUserMessage: boolean;
}

function MessageView({ msg, onButton, disableButtons, isLastUserMessage }: MessageViewProps) {
  const isUser = msg.role === 'user';

  // ---------- user text bubble ----------
  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[75%] bg-brand-500 text-white rounded-3xl rounded-tr-sm px-5 py-2.5 whitespace-pre-wrap">
          {msg.content}
        </div>
        {isLastUserMessage && (
          <div className="text-[10px] text-[var(--text-dim)] mt-1 mr-2">Delivered</div>
        )}
      </div>
    );
  }

  // ---------- thinking-meta chip (bot side, no avatar) ----------
  if (msg.kind === 'thinking-meta') {
    return <ThinkingChip payload={msg.payload as ThinkingMetaPayload} />;
  }

  // ---------- quick-reply buttons (bot side, no avatar) ----------
  if (msg.kind === 'buttons') {
    const buttons = (msg.payload as ActionButton[]) || [];
    return (
      <BotRow showAvatar={false}>
        <div className="flex flex-wrap gap-2">
          {buttons.map((b) => (
            <button
              key={b.label}
              onClick={() => onButton(b.action)}
              disabled={disableButtons || msg.consumed || b.disabled}
              className="px-4 py-1.5 rounded-full border border-brand-400/60 bg-brand-50 text-brand-700 text-sm hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-brand-500/10 dark:text-brand-200 dark:hover:bg-brand-500/20"
            >
              {b.label}
            </button>
          ))}
        </div>
      </BotRow>
    );
  }

  // ---------- quiz question ----------
  if (msg.kind === 'quiz-question') {
    const p = msg.payload as QuizQuestionPayload;
    const q = p.question;
    const answered = p.answered;
    const optionLetters = ['A', 'B', 'C', 'D'] as const;
    return (
      <div className="space-y-2">
        <BotRow>
          <BotBubble>
            <div className="whitespace-pre-wrap">
              <MarkdownWithMermaid source={msg.content} />
            </div>
            {q.is_mcq && (
              <div className="mt-2 text-sm space-y-0.5 text-[var(--text-muted)]">
                {optionLetters.map((letter) => {
                  const opt = (q as unknown as Record<string, string>)[
                    `option_${letter.toLowerCase()}`
                  ];
                  return (
                    <div key={letter}>
                      {letter} {opt}
                    </div>
                  );
                })}
              </div>
            )}
          </BotBubble>
        </BotRow>
        {q.is_mcq ? (
          <>
            <BotRow>
              <BotBubble>
                <span className="text-sm text-[var(--text-muted)]">
                  Make a choice from the list below
                </span>
              </BotBubble>
            </BotRow>
            <BotRow showAvatar={false}>
              <div className="flex flex-wrap gap-2">
                {optionLetters.map((letter) => {
                  const opt = (q as unknown as Record<string, string>)[
                    `option_${letter.toLowerCase()}`
                  ];
                  const isSelected =
                    answered && letter.toLowerCase() === answered.user_answer.toLowerCase();
                  const isRightAnswer =
                    answered &&
                    (q.correct_answer || '').trim().toLowerCase() ===
                      (opt || '').trim().toLowerCase();
                  const base =
                    'px-4 py-1.5 rounded-full border text-sm transition-colors disabled:cursor-not-allowed';
                  let stateClasses =
                    'border-brand-400/60 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:hover:bg-brand-500/20';
                  if (answered) {
                    if (isRightAnswer) {
                      stateClasses =
                        'border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
                    } else if (isSelected) {
                      stateClasses =
                        'border-red-500/60 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300';
                    } else {
                      stateClasses =
                        'border-[var(--border)] bg-transparent text-[var(--text-dim)] opacity-60';
                    }
                  }
                  return (
                    <button
                      key={letter}
                      onClick={() => !answered && onButton('answer_mcq', letter)}
                      disabled={disableButtons || !!answered}
                      className={`${base} ${stateClasses}`}
                    >
                      Option {letter}
                    </button>
                  );
                })}
              </div>
            </BotRow>
          </>
        ) : (
          <BotRow>
            <BotBubble>
              <span className="text-sm text-[var(--text-muted)] italic">
                Type your answer in the message box below.
              </span>
            </BotBubble>
          </BotRow>
        )}
      </div>
    );
  }

  // ---------- quiz result card ----------
  if (msg.kind === 'quiz-result') {
    const p = msg.payload as QuizResultPayload;
    const wrongCount = p.wrong_answers.length;
    const reviews = p.all_answers ?? [];
    const optionLetters = ['A', 'B', 'C', 'D'] as const;

    return (
      <BotRow>
        <div className="inline-block w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
          {/* Score header */}
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Quiz Score</div>
            <div className="text-4xl font-bold text-brand-500 mt-1">{p.score}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">
              {wrongCount === 0 ? 'Perfect score! 🎉' : `${wrongCount} wrong out of ${p.total}`}
            </div>
          </div>

          {/* Generate revision note button */}
          {wrongCount > 0 && !p.note_generated && (
            <button
              onClick={() => onButton('generate_note', {
                wrong_answers: p.wrong_answers,
                quiz_record_id: p.quiz_record_id,
                wrong_details: (p.all_answers ?? []).filter(a => !a.correct && !a.skipped),
              })}
              disabled={disableButtons}
              className="w-full rounded-full bg-brand-500 hover:bg-brand-400 text-white font-semibold py-2 text-sm disabled:opacity-50"
            >
              ✨ Generate revision note
            </button>
          )}

          {/* Per-question answer review */}
          {reviews.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-[var(--border)] max-h-[420px] overflow-y-auto pr-1">
              {reviews.map((r, i) => {
                const statusIcon = r.skipped ? '⏭' : r.correct ? '✓' : '✗';
                const statusColor = r.skipped
                  ? 'text-[var(--text-muted)]'
                  : r.correct
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-500 dark:text-red-400';
                const cardBg = r.correct
                  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30'
                  : r.skipped
                  ? 'bg-[var(--bg-hover)] border-[var(--border)]'
                  : 'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/30';

                return (
                  <div key={i} className={`rounded-xl border p-3 text-sm space-y-2 ${cardBg}`}>
                    {/* Question header */}
                    <div className="flex items-start gap-2">
                      <span className={`font-bold shrink-0 ${statusColor}`}>{statusIcon}</span>
                      <span className="font-medium text-[var(--text)]">{r.question}</span>
                    </div>

                    {/* MC options */}
                    {r.is_mcq && (
                      <div className="space-y-0.5 pl-5">
                        {optionLetters.map((letter) => {
                          const optVal = (r as unknown as Record<string, unknown>)[`option_${letter.toLowerCase()}`] as string | null;
                          if (!optVal) return null;
                          const isCorrect = optVal.trim().toLowerCase() === r.correct_answer.trim().toLowerCase();
                          const isUserPick = r.user_answer.toUpperCase() === letter;
                          return (
                            <div
                              key={letter}
                              className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 ${
                                isCorrect
                                  ? 'font-semibold text-emerald-700 dark:text-emerald-300'
                                  : isUserPick && !r.correct
                                  ? 'text-red-600 dark:text-red-300 line-through opacity-70'
                                  : 'text-[var(--text-dim)]'
                              }`}
                            >
                              <span className="shrink-0 w-4">{letter}.</span>
                              <span>{optVal}</span>
                              {isCorrect && <span className="ml-auto shrink-0">✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Answer summary row */}
                    <div className="pl-5 space-y-0.5 text-xs">
                      {!r.correct && !r.skipped && (
                        <div className="text-red-500 dark:text-red-400">
                          Your answer: <span className="font-medium">{r.user_answer || '(blank)'}</span>
                        </div>
                      )}
                      {r.skipped && (
                        <div className="text-[var(--text-muted)]">
                          Right answer <span className="text-[var(--text-dim)]">(skipped)</span>
                        </div>
                      )}
                      <div className={`${r.correct && !r.skipped ? statusColor : 'text-emerald-600 dark:text-emerald-400'} font-medium`}>
                        {r.correct && !r.skipped ? '✓ Correct!' : `Correct: ${r.correct_answer}`}
                      </div>
                    </div>

                    {/* Explanation */}
                    {r.explanation && (
                      <div className="pl-5 text-xs text-[var(--text-muted)] italic border-t border-[var(--border)] pt-1.5 mt-1">
                        {r.explanation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </BotRow>
    );
  }

  // ---------- revision note card ----------
  if (msg.kind === 'revision-note') {
    const p = msg.payload as RevisionNotePayload;
    const wrongDetails = p.wrong_details ?? [];
    const optionLetters = ['A', 'B', 'C', 'D'] as const;
    return (
      <BotRow>
        <div className="inline-block w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
          <div className="text-xs text-[var(--text-dim)]">
            Revision note {p.note_id ? `#${p.note_id}` : ''} · via {p.provider}
          </div>

          {/* Wrong question cards — same format as quiz review */}
          {wrongDetails.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                Your wrong answers
              </div>
              {wrongDetails.map((r, i) => (
                <div key={i} className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 p-3 text-sm space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="font-bold shrink-0 text-red-500">✗</span>
                    <span className="font-medium text-[var(--text)]">{r.question}</span>
                  </div>
                  {r.is_mcq && (
                    <div className="space-y-0.5 pl-5">
                      {optionLetters.map((letter) => {
                        const optVal = (r as unknown as Record<string, unknown>)[`option_${letter.toLowerCase()}`] as string | null;
                        if (!optVal) return null;
                        const isCorrect = optVal.trim().toLowerCase() === r.correct_answer.trim().toLowerCase();
                        const isUserPick = r.user_answer.toUpperCase() === letter;
                        return (
                          <div key={letter} className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 ${
                            isCorrect ? 'font-semibold text-emerald-700 dark:text-emerald-300'
                            : isUserPick ? 'text-red-600 dark:text-red-300 line-through opacity-70'
                            : 'text-[var(--text-dim)]'}`}>
                            <span className="shrink-0 w-4">{letter}.</span>
                            <span>{optVal}</span>
                            {isCorrect && <span className="ml-auto shrink-0">✓</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="pl-5 space-y-0.5 text-xs">
                    <div className="text-red-500 dark:text-red-400">
                      Your answer: <span className="font-medium">{r.user_answer || '(blank)'}</span>
                    </div>
                    <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Correct: {r.correct_answer}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* LLM explanation */}
          <div className={wrongDetails.length > 0 ? 'border-t border-[var(--border)] pt-4' : ''}>
            {wrongDetails.length > 0 && (
              <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
                Detailed explanation
              </div>
            )}
            <div className="text-[var(--text)]">
              <MarkdownWithMermaid source={p.markdown} />
            </div>
          </div>
        </div>
      </BotRow>
    );
  }

  // ---------- note list ----------
  if (msg.kind === 'note-list') {
    const p = msg.payload as NoteListPayload;
    return (
      <div className="space-y-2">
        <BotRow>
          <BotBubble>
            <span className="whitespace-pre-wrap">{msg.content}</span>
          </BotBubble>
        </BotRow>
        <BotRow showAvatar={false}>
          <div className="flex flex-wrap gap-2">
            {p.notes.map((n) => (
              <button
                key={n.id}
                onClick={() => onButton('view_note', n.id)}
                disabled={disableButtons}
                className="px-4 py-1.5 rounded-full border border-brand-400/60 bg-brand-50 text-brand-700 text-xs hover:bg-brand-100 disabled:opacity-50 dark:bg-brand-500/10 dark:text-brand-200 dark:hover:bg-brand-500/20"
              >
                {n.title} · {new Date(n.created_at).toLocaleDateString()}
              </button>
            ))}
          </div>
        </BotRow>
      </div>
    );
  }

  // ---------- plain bot text ----------
  return (
    <BotRow>
      <BotBubble>
        <MarkdownWithMermaid source={msg.content} />
      </BotBubble>
    </BotRow>
  );
}

// -----------------------------------------------------------------------------
// Collapsible thinking chip (shown above generative bot replies)
// -----------------------------------------------------------------------------

function ThinkingChip({ payload }: { payload: ThinkingMetaPayload }) {
  const [open, setOpen] = useState(false);
  const seconds = (payload.elapsed_ms / 1000).toFixed(payload.elapsed_ms < 1000 ? 2 : 1);
  return (
    <BotRow showAvatar={false}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        title="Show thinking details"
      >
        <span
          className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <span>Thought for {seconds}s</span>
        <span className="opacity-60">·</span>
        <span className="font-medium">{payload.provider}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 text-xs text-[var(--text-muted)] bg-[var(--bg-hover)] rounded-lg px-3 py-2 border border-[var(--border)]">
              <div>
                <span className="font-semibold">Backend:</span> {payload.provider}
              </div>
              <div>
                <span className="font-semibold">Elapsed:</span>{' '}
                {payload.elapsed_ms.toFixed(0)} ms
              </div>
              <div>
                <span className="font-semibold">Task:</span> {payload.kind}
              </div>
              {payload.detail && (
                <div className="mt-1 italic opacity-80">{payload.detail}</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </BotRow>
  );
}
