export type DashboardTaskStatus = 'queued' | 'running' | 'completed' | 'needs-human' | 'failed';

interface DashboardTaskEvent {
  state: string;
  message: string;
  timestamp: string;
}

interface DashboardTaskResult {
  attempts: number;
  verified: boolean;
  summary: string;
  usage: {
    totalTokens: number;
  };
}

/** A recorded human decision on a task that stopped for one. Absent while it is still waiting. */
export interface DashboardTaskApproval {
  decision: 'approved' | 'rejected';
  actor: string;
  comment: string | null;
  decidedAt: string;
}

export interface DashboardTask {
  id: string;
  repository: string;
  status: DashboardTaskStatus;
  createdAt: string;
  updatedAt: string;
  events: DashboardTaskEvent[];
  result?: DashboardTaskResult;
  approval?: DashboardTaskApproval;
}

export interface DashboardOverview {
  tasks: DashboardTask[];
  active: number;
  queued: number;
  awaitingApproval: number;
  totalTokens: number;
  costUsd: number;
}
