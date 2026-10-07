/**
 * Maps a job's real state (GET /jobs/:id) onto the four-step pipeline
 * Submitted -> Queued -> Processing -> Completed, with a Failed end state.
 * No backend semantics are changed; this is presentation only.
 */
export type JobState = 'submitted' | 'queued' | 'processing' | 'completed' | 'failed';
export type StepStatus = 'done' | 'current' | 'upcoming' | 'failed';

export interface PipelineStep {
  key: 'submitted' | 'queued' | 'processing' | 'completed';
  label: string;
  status: StepStatus;
}

export interface PipelineModel {
  steps: PipelineStep[];
  /** A retry is in progress: the job failed an attempt and was re-queued. */
  retrying: boolean;
  failed: boolean;
}

const ORDER: PipelineStep['key'][] = ['submitted', 'queued', 'processing', 'completed'];
const LABEL: Record<PipelineStep['key'], string> = {
  submitted: 'Submitted',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
};

export function pipelineModel(job: { state: JobState; attempts: number; error: string | null }): PipelineModel {
  const failed = job.state === 'failed';
  // A failed job with no attempts never reached the worker (e.g. enqueue failed).
  const failedAt: PipelineStep['key'] = job.attempts > 0 ? 'completed' : 'queued';
  const retrying = job.state === 'queued' && job.attempts > 0 && !!job.error;

  const current = failed ? ORDER.indexOf(failedAt) : ORDER.indexOf(job.state as PipelineStep['key']);
  const steps = ORDER.map((key, i): PipelineStep => {
    let status: StepStatus;
    if (failed) status = i < current ? 'done' : i === current ? 'failed' : 'upcoming';
    else if (job.state === 'completed') status = 'done';
    else status = i < current ? 'done' : i === current ? 'current' : 'upcoming';
    const label = failed && i === current ? 'Failed' : LABEL[key];
    return { key, label, status };
  });
  return { steps, retrying, failed };
}
