import { describe, expect, test } from 'bun:test';
import type {
  ExtractedLearning,
  LearningPayload,
  LearningPushRequest,
  LearningReviewAction,
} from '../learning-types.js';

describe('learning-types', () => {
  test('ExtractedLearning has claim, evidence, scope, confidence', () => {
    const l: ExtractedLearning = {
      claim: 'Queue retries at 5s intervals.',
      evidence: 'SyncQueue.ts sets RETRY_DELAY = 5000',
      scope: 's',
      confidence: 0.9,
    };
    expect(l.confidence).toBe(0.9);
  });

  test('LearningPushRequest requires target_status', () => {
    const req: LearningPushRequest = {
      learnings: [],
      target_status: 'approved',
    };
    expect(req.target_status).toBe('approved');
  });

  test('LearningReviewAction union covers all three actions', () => {
    const approve: LearningReviewAction = { action: 'approve' };
    const reject: LearningReviewAction = { action: 'reject', rejection_reason: 'duplicate' };
    const edit: LearningReviewAction = {
      action: 'edit_approve',
      edited: { claim: 'refined claim' },
    };
    expect([approve.action, reject.action, edit.action]).toEqual(['approve', 'reject', 'edit_approve']);
  });
});
