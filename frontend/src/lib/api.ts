// Thin typed wrapper over the Flask API. Every call sends cookies so the
// Flask session cookie works for auth.

export interface LoginResult {
  ok: boolean;
  user_id: number | null;
  login_count: number;
  message: string;
}

export interface MeResult {
  logged_in: boolean;
  user_id?: number;
  username?: string;
  provider?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface QuizQuestion {
  quiz_id: number;
  question: string;
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  correct_answer: string;
  is_mcq: boolean;
  explanation?: string;
  hint?: string;
}

export interface WrongAnswer {
  question: string;
  user_answer: string;
  correct_answer: string;
}

export interface QuizSubmitResult {
  score: number;
  quiz_record_id: number | null;
  wrong_answers: WrongAnswer[];
}

export interface RevisionNote {
  id: number;
  user_id: number;
  quiz_record_id: number | null;
  provider_used: string;
  markdown: string;
  createdAt: string;
  wrong_details?: object[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const msg = body?.error || body?.message || res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json();
}

export const api = {
  me: () => request<MeResult>('/api/me'),
  login: (username: string, password: string) =>
    request<LoginResult>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  getSettings: () =>
    request<{ provider: string; has_hf_key: boolean; gemma_gpu_enabled: boolean }>('/api/settings'),
  setSettings: (payload: { provider?: string; hf_api_key?: string; hf_model?: string }) =>
    request<{ ok: boolean; provider: string }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testSettings: (provider: string) =>
    request<{ ok: boolean; provider: string; sample_tag?: string; error?: string }>(
      '/api/settings/test',
      { method: 'POST', body: JSON.stringify({ provider }) },
    ),

  encourage: () => request<{ message: string }>('/api/encourage'),

  chat: (text: string, history: ChatMessage[]) =>
    request<{ reply: string; tag: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ text, history }),
    }),

  quizStart: (total = 10) =>
    request<{ questions: QuizQuestion[]; source?: string }>('/api/quiz/start', {
      method: 'POST',
      body: JSON.stringify({ total }),
    }),
  quizStartKB: (topics: string[], nPerTopic = 4) =>
    request<{ questions: QuizQuestion[]; source?: string }>('/api/quiz/start', {
      method: 'POST',
      body: JSON.stringify({ topics, n_per_topic: nPerTopic }),
    }),
  quizTopics: () =>
    request<{ topics: { id: string; label: string }[] }>('/api/quiz/topics'),
  quizSubmit: (answers: { quiz_id: number; user_answer: string }[]) =>
    request<QuizSubmitResult>('/api/quiz/submit', {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),

  generateRevisionNote: (payload: {
    wrong_answers: WrongAnswer[];
    quiz_record_id: number | null;
    wrong_details?: object[];
  }) =>
    request<{ ok: boolean; id: number; markdown: string; wrong_details?: object[] }>('/api/revision/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listRevisionNotes: () =>
    request<{ notes: RevisionNote[] }>('/api/revision'),
  getRevisionNote: (id: number) =>
    request<RevisionNote>(`/api/revision/${id}`),
};
