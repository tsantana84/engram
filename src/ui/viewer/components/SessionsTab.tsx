import React from 'react';
import { Feed } from './Feed';
import { Observation, Summary, UserPrompt } from '../types';

interface SessionsTabProps {
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
  onLoadMore: () => Promise<void>;
  isLoading: boolean;
  hasMore: boolean;
}

export function SessionsTab({ observations, summaries, prompts, onLoadMore, isLoading, hasMore }: SessionsTabProps) {
  return (
    <Feed
      observations={observations}
      summaries={summaries}
      prompts={prompts}
      onLoadMore={onLoadMore}
      isLoading={isLoading}
      hasMore={hasMore}
    />
  );
}
