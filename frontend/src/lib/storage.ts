// Multi-session chat history with a conversational state machine per session.
// Everything in the PY Chatbot UI happens inside a chat: login prompts, the
// main menu, quizzes, encouragements, revision notes — all represented as
// messages with a `kind` discriminator. The session's `mode` drives what the
// Send button does next.

import type { QuizQuestion } from './api';

const MAX_MESSAGES_PER_SESSION = 300;

// -----------------------------------------------------------------------------
// Session mode (state machine)
// -----------------------------------------------------------------------------

export type SessionMode =
  | { kind: 'await_username' }
  | { kind: 'await_password'; username: string }
  | { kind: 'idle' } // logged in, showing the 4-action buttons
  | { kind: 'chat' } // free-chat mode with the selected backend
  | {
      kind: 'quiz';
      questions: QuizQuestion[];
      index: number;
      answers: Record<number, string>;
    }
  | { kind: 'busy' }; // transient — ignore user input while an API call is in flight

// -----------------------------------------------------------------------------
// Rich message kinds
// -----------------------------------------------------------------------------

export type MessageKind =
  | 'text'
  | 'buttons'
  | 'quiz-question'
  | 'quiz-answer'
  | 'quiz-result'
  | 'revision-note'
  | 'note-list'
  | 'thinking-meta';

export interface ActionButton {
  label: string;
  action: string; // dispatched by Chat.tsx
  disabled?: boolean;
}

export interface QuizQuestionPayload {
  question: QuizQuestion;
  answered?: {
    user_answer: string;
    correct: boolean;
    correct_answer: string;
  };
}

export interface QuizAnswerReview {
  question: string;
  user_answer: string;
  correct_answer: string;
  correct: boolean;
  skipped: boolean;
  explanation?: string;
  is_mcq: boolean;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
}

export interface QuizResultPayload {
  score: number;
  total: number;
  wrong_answers: { question: string; user_answer: string; correct_answer: string }[];
  quiz_record_id: number | null;
  note_generated?: boolean;
  all_answers?: QuizAnswerReview[];
}

export interface RevisionNotePayload {
  markdown: string;
  provider: string;
  note_id?: number;
  wrong_details?: QuizAnswerReview[];
}

export interface NoteListPayload {
  notes: { id: number; title: string; created_at: string; provider: string }[];
}

export interface ThinkingMetaPayload {
  provider: string;
  elapsed_ms: number;
  kind: 'chat' | 'revision-note' | 'menu-route';
  /** Optional extra detail shown when the chip is expanded. */
  detail?: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  kind?: MessageKind;
  payload?:
    | ActionButton[]
    | QuizQuestionPayload
    | QuizResultPayload
    | RevisionNotePayload
    | NoteListPayload
    | ThinkingMetaPayload;
  consumed?: boolean; // buttons that have already been clicked
}

export interface ChatSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  mode: SessionMode;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Storage keys — scoped per user when known, anonymous otherwise
// -----------------------------------------------------------------------------

const sessionsKey = (userId: number | null) =>
  userId == null ? 'chat_sessions_anon' : `chat_sessions_${userId}`;
const legacyKey = (userId: number) => `chat_history_${userId}`;

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Ensure every session loaded from storage has a valid `mode` and message
 *  shapes we can render. Old sessions (from prior storage versions) lacked
 *  `mode` entirely, which crashed reads of `session.mode.kind`. */
function normalizeSession(s: unknown): ChatSession | null {
  if (!s || typeof s !== 'object') return null;
  const sess = s as Partial<ChatSession> & Record<string, unknown>;
  if (typeof sess.id !== 'string' || !Array.isArray(sess.messages)) return null;

  const mode: SessionMode =
    sess.mode && typeof (sess.mode as SessionMode).kind === 'string'
      ? (sess.mode as SessionMode)
      : { kind: 'idle' };

  const messages: StoredMessage[] = (sess.messages as StoredMessage[]).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: typeof m.content === 'string' ? m.content : '',
    ts: typeof m.ts === 'string' ? m.ts : now(),
    kind: m.kind ?? 'text',
    payload: m.payload,
    consumed: m.consumed,
  }));

  return {
    id: sess.id,
    title: typeof sess.title === 'string' ? sess.title : 'New chat',
    messages,
    mode,
    createdAt: typeof sess.createdAt === 'string' ? sess.createdAt : now(),
    updatedAt: typeof sess.updatedAt === 'string' ? sess.updatedAt : now(),
  };
}

function readRaw(userId: number | null): ChatSession[] {
  try {
    const raw = localStorage.getItem(sessionsKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession).filter((s): s is ChatSession => s !== null);
  } catch {
    return [];
  }
}

function writeRaw(userId: number | null, sessions: ChatSession[]): void {
  try {
    localStorage.setItem(sessionsKey(userId), JSON.stringify(sessions));
  } catch {
    /* quota exceeded */
  }
}

/** One-time migration from legacy single-history format. */
function migrateLegacy(userId: number): ChatSession | null {
  try {
    const raw = localStorage.getItem(legacyKey(userId));
    if (!raw) return null;
    localStorage.removeItem(legacyKey(userId));
    const parsed = JSON.parse(raw);
    const msgs = Array.isArray(parsed?.messages) ? parsed.messages : [];
    if (msgs.length === 0) return null;
    return {
      id: newId(),
      title: 'Previous chat',
      messages: msgs.map((m: { role: 'user' | 'assistant'; content: string }) => ({
        ...m,
        ts: now(),
        kind: 'text' as const,
      })),
      mode: { kind: 'idle' },
      createdAt: now(),
      updatedAt: now(),
    };
  } catch {
    return null;
  }
}

export function loadSessions(userId: number | null): ChatSession[] {
  let sessions = readRaw(userId);
  if (sessions.length === 0 && userId != null) {
    const migrated = migrateLegacy(userId);
    if (migrated) {
      sessions = [migrated];
      writeRaw(userId, sessions);
    }
  }
  return sessions;
}

export function saveSession(userId: number | null, session: ChatSession): void {
  const sessions = readRaw(userId);
  const idx = sessions.findIndex((s) => s.id === session.id);
  const trimmed: ChatSession = {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
    updatedAt: now(),
  };
  if (idx >= 0) sessions[idx] = trimmed;
  else sessions.unshift(trimmed);
  sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  writeRaw(userId, sessions);
}

export function deleteSession(userId: number | null, sessionId: string): void {
  const sessions = readRaw(userId).filter((s) => s.id !== sessionId);
  writeRaw(userId, sessions);
}

/** Move every session under the anonymous key into the user's keyed storage. */
export function claimAnonymousSessions(userId: number): void {
  const anon = readRaw(null);
  if (anon.length === 0) return;
  const existing = readRaw(userId);
  writeRaw(userId, [...anon, ...existing]);
  try {
    localStorage.removeItem(sessionsKey(null));
  } catch {
    /* ignore */
  }
}

export function createSession(
  userId: number | null,
  opts: { title?: string; mode?: SessionMode } = {},
): ChatSession {
  const session: ChatSession = {
    id: newId(),
    title: opts.title ?? 'New chat',
    messages: [],
    mode: opts.mode ?? { kind: 'idle' },
    createdAt: now(),
    updatedAt: now(),
  };
  saveSession(userId, session);
  return session;
}

/** Derive a short title from the first meaningful user text. */
export function deriveTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find(
    (m) => m.role === 'user' && m.kind !== 'quiz-answer' && m.content !== '••••••••',
  );
  if (!firstUser) return 'New chat';
  const clean = firstUser.content.trim().replace(/\s+/g, ' ');
  return clean.length > 32 ? clean.slice(0, 32) + '…' : clean;
}
