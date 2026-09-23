import type { Employee, Recommendation } from './types.js';

interface OpenAIResponse {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
}

export async function rankWithOpenAI(employee: Employee, candidates: Recommendation[]): Promise<string[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || candidates.length === 0) return null;
  const shortlist = candidates.slice(0, 8);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        store: false,
        instructions: 'You rank eligible career-development activities. Select 1 to 3 distinct event IDs from the supplied candidates only. Prioritize critical promotion skills, realistic skill gain, prerequisites already checked, and participation history. A repeated no-show, decline or drop is negative evidence. Never select mandatory or compliance training. Return JSON only.',
        input: JSON.stringify({
          employee: { role: employee.role, grade: employee.grade, goal: employee.career_goal },
          candidates: shortlist.map(item => ({
            event_id: item.event.event_id,
            title: item.event.title,
            format: item.event.format,
            score: item.score,
            closes: item.closes,
            history: item.historyNote,
          })),
        }),
        text: { format: {
          type: 'json_schema', name: 'career_recommendations', strict: true,
          schema: { type: 'object', properties: {
            event_ids: { type: 'array', items: { type: 'string' } },
          }, required: ['event_ids'], additionalProperties: false },
        } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const body = await response.json() as OpenAIResponse;
    const outputText = body.output?.flatMap(item => item.content ?? [])
      .filter(content => content.type === 'output_text').map(content => content.text ?? '').join('') ?? '';
    const parsed = JSON.parse(outputText) as { event_ids?: unknown };
    if (!Array.isArray(parsed.event_ids)) return null;
    const valid = new Set(shortlist.map(item => item.event.event_id));
    const ids = [...new Set(parsed.event_ids.filter((id): id is string => typeof id === 'string' && valid.has(id)))].slice(0, 3);
    return ids.length ? ids : null;
  } catch (error) {
    console.warn('OpenAI ranking unavailable, using deterministic ranking:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
