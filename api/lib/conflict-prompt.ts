/**
 * Shared ConflictDetector prompt + types.
 *
 * Imported by both server (api/lib/ConflictDetector.ts) and client
 * (src/services/sync/ConflictDetector.ts). MUST NOT import Node or Bun
 * builtins — both Vercel serverless and the Bun-based worker must
 * compile this module.
 */

export type ConflictDecision = 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NOOP';

export interface ConflictCheckResult {
  decision: ConflictDecision;
  targetId?: number | null;
  reason?: string;
}

export interface SimilarItem {
  id: number;
  title: string | null;
  narrative: string | null;
  agent_name?: string | null;
  git_branch?: string | null;
}

export function buildConflictPrompt(
  item: { title: string; narrative?: string | null },
  similar: SimilarItem[]
): string {
  const similarText = similar
    .map(
      (s, i) =>
        `[${i + 1}] ID:${s.id} | Agent:${s.agent_name ?? 'unknown'} | Branch:${s.git_branch ?? 'unknown'}\n    TITLE: ${s.title ?? ''}\n    NARRATIVE: ${s.narrative ?? '(none)'}`
    )
    .join('\n\n');

  return `You are a memory conflict resolver for a shared AI coding assistant knowledge base.

A new item is about to be stored:
TITLE: ${item.title}
NARRATIVE: ${item.narrative ?? '(none)'}

Most semantically similar existing items:
${similarText}

Decide what to do. Choose ONE:
- ADD: New information, no conflict. Store it.
- UPDATE: Supersedes an existing one. Store new, invalidate old (provide targetId).
- INVALIDATE: Contradicts an existing one that appears wrong. Invalidate old, add new (provide targetId).
- NOOP: Duplicate or adds no value. Skip.

Respond ONLY with JSON: {"decision": "ADD"|"UPDATE"|"INVALIDATE"|"NOOP", "targetId": <number or null>, "reason": "<brief>"}`;
}
