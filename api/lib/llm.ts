// Minimal LLM closure for server-side operations.
// Uses ANTHROPIC_API_KEY + CLAUDE_MEM_LEARNING_LLM_MODEL env var.
export function getLlmClosure(): (prompt: string) => Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MEM_LEARNING_LLM_MODEL ?? 'claude-sonnet-4-6';
  if (!apiKey) {
    return async () => { throw new Error('ANTHROPIC_API_KEY missing'); };
  }
  return async (prompt: string): Promise<string> => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
    const json = await resp.json() as any;
    const text = json?.content?.[0]?.text ?? '';
    return String(text);
  };
}
