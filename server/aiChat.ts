export type ChatSummary = { topics: string[]; decisions: string[]; tasks: string[]; open_questions: string[] };
export type SummaryMessage = { id: string; sender: string; body: string; created_at: string; chat?: string };

function redact(body: string): string {
  if (/password|пароль|token|токен|api[_ -]?key|secret|секрет|credential|authorization|private key|connection string/i.test(body))
    return '[сообщение скрыто: возможно содержит секрет]';
  return body.slice(0, 700)
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{12,}/g, '[секрет удалён]')
    .replace(/(?:ghp_|github_pat_|sb_secret_)[A-Za-z0-9_-]{12,}/g, '[секрет удалён]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, '[секрет удалён]')
    .replace(/\b(?:password|пароль|token|токен|api[_ -]?key|secret|секрет)\s*[:=]\s*\S+/gi, '[секрет удалён]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[строка подключения удалена]');
}

export async function summarizeChat(messages: SummaryMessage[], team = false): Promise<ChatSummary> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY не настроен; AI-сводка недоступна'),{ status: 503 });
  if (!messages.length) throw Object.assign(new Error('В выбранном периоде нет сообщений'),{ status: 400 });
  const payload = messages.slice(-50).map(message => ({
    id: message.id, author: message.sender.slice(0,80), time: message.created_at,
    chat: message.chat?.slice(0,80), text: redact(message.body),
  }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', store: false,
        instructions: `Ты составляешь краткую корпоративную сводку ${team ? 'нескольких обращений контакт-центра' : 'обсуждения'}.
          Используй ТОЛЬКО переданные сообщения. Не придумывай темы, решения, поручения, сроки или факты.
          Если в категории нет подтверждённой информации, верни ["Не определено"].
          Задачи указывай только если исполнитель и действие явно названы. Не оценивай людей, не присваивай рейтинг.
          Не повторяй возможные секреты. Пиши на русском, компактно.`,
        input: JSON.stringify(payload),
        text: { format: { type: 'json_schema', name: 'chat_summary', strict: true,
          schema: { type: 'object', properties: {
            topics: { type: 'array', items: { type: 'string' } },
            decisions: { type: 'array', items: { type: 'string' } },
            tasks: { type: 'array', items: { type: 'string' } },
            open_questions: { type: 'array', items: { type: 'string' } },
          }, required: ['topics','decisions','tasks','open_questions'], additionalProperties: false } } },
      }),
    });
    if (!response.ok) throw Object.assign(new Error(`OpenAI HTTP ${response.status}`),{ status: 502 });
    const result = await response.json() as { output?: { content?: { type: string; text?: string }[] }[] };
    const raw = result.output?.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text')
      .map(item => item.text ?? '').join('') ?? '';
    const parsed = JSON.parse(raw) as ChatSummary;
    for (const field of ['topics','decisions','tasks','open_questions'] as const) {
      if (!Array.isArray(parsed[field]) || !parsed[field].every(item => typeof item === 'string'))
        throw new Error('Некорректный ответ AI');
      parsed[field] = parsed[field].slice(0,8).map(item => item.slice(0,500));
      if (!parsed[field].length) parsed[field] = ['Не определено'];
    }
    return parsed;
  } finally { clearTimeout(timeout); }
}
