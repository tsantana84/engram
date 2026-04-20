// Minimal LLM closure for server-side operations.
// Provider selected via CLAUDE_MEM_LEARNING_LLM_PROVIDER env var ('openai' | 'anthropic').
// Defaults to OpenAI if OPENAI_API_KEY is set, otherwise falls back to Anthropic.
export function getLlmClosure(): (prompt: string) => Promise<string> {
  const provider = process.env.CLAUDE_MEM_LEARNING_LLM_PROVIDER
    ?? (process.env.OPENAI_API_KEY ? 'openai' : 'anthropic');

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.CLAUDE_MEM_LEARNING_LLM_MODEL ?? 'gpt-4o-mini';
    if (!apiKey) return async () => { throw new Error('OPENAI_API_KEY missing'); };
    return async (prompt: string): Promise<string> => {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) throw new Error(`OpenAI API ${resp.status}`);
      const json = await resp.json() as any;
      return String(json?.choices?.[0]?.message?.content ?? '');
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MEM_LEARNING_LLM_MODEL ?? 'claude-sonnet-4-6';
  if (!apiKey) return async () => { throw new Error('ANTHROPIC_API_KEY missing'); };
  return async (prompt: string): Promise<string> => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
    const json = await resp.json() as any;
    return String(json?.content?.[0]?.text ?? '');
  };
}
