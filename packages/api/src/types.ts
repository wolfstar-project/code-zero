import type { TaskEvent, TaskResult } from '@code-zero/shared';

export type ControlPlaneTaskStatus = 'queued' | 'running' | 'completed' | 'needs-human' | 'failed';
export type ApprovalDecision = 'approved' | 'rejected';

export interface TaskApproval {
  decision: ApprovalDecision;
  actor: string;
  comment: string | null;
  decidedAt: string;
}

export interface DashboardTask {
  id: string;
  repository: string;
  status: ControlPlaneTaskStatus;
  createdAt: string;
  updatedAt: string;
  events: TaskEvent[];
  result?: TaskResult;
  approval?: TaskApproval;
}

export interface DashboardOverview {
  tasks: DashboardTask[];
  active: number;
  queued: number;
  awaitingApproval: number;
  totalTokens: number;
  costUsd: number;
}
