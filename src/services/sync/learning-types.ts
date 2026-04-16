export interface ExtractedLearning {
  claim: string;
  evidence: string | null;
  scope: string | null;
  confidence: number; // 0.0–1.0
}

export interface LearningPayload extends ExtractedLearning {
  project: string;
  source_session: string;
  content_hash: string;
}

export type LearningTargetStatus = 'approved' | 'pending';

export interface LearningPushRequest {
  learnings: LearningPayload[];
  target_status: LearningTargetStatus;
}

export interface LearningPushResult {
  content_hash: string;
  id?: number;
  action: 'inserted' | 'dedupe_noop' | 'invalidated_target' | 'updated_target';
  error?: string;
}

export interface LearningPushResponse {
  results: LearningPushResult[];
}

export type LearningReviewAction =
  | { action: 'approve' }
  | { action: 'reject'; rejection_reason?: string }
  | { action: 'edit_approve'; edited: Partial<Pick<LearningPayload, 'claim' | 'evidence' | 'scope'>> };

export interface LearningRecord extends LearningPayload {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  invalidated: boolean;
  invalidated_by: number | null;
  extracted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  edit_diff: Record<string, unknown> | null;
  rejection_reason: string | null;
}
