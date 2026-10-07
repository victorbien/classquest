import { pipelineModel, type JobState } from '../lib/pipeline';
import { Icon } from './ui';

interface PipelineStepperProps {
  state: JobState;
  attempts: number;
  error: string | null;
  /** Accessible name, e.g. the resource title. */
  label: string;
}

/**
 * Submitted → Queued → Processing → Completed, driven by GET /jobs/:id.
 * A failed job ends on a red "Failed" step and shows the recorded error.
 */
export function PipelineStepper({ state, attempts, error, label }: PipelineStepperProps) {
  const model = pipelineModel({ state, attempts, error });
  return (
    <div className="cq-stepper-wrap">
      <ol className="cq-stepper" aria-label={`Processing pipeline for ${label}`}>
        {model.steps.map((s) => (
          <li key={s.key} className={`cq-step cq-step--${s.status}`} aria-current={s.status === 'current' ? 'step' : undefined}>
            <span className="cq-step__dot" aria-hidden="true">
              {s.status === 'done' && <Icon name="check" size={14} />}
              {s.status === 'failed' && <Icon name="x" size={14} />}
            </span>
            <span className="cq-step__label">{s.label}</span>
            <span className="cq-visually-hidden">
              {s.status === 'done' ? ' (done)' : s.status === 'current' ? ' (in progress)' : s.status === 'failed' ? ' (failed)' : ''}
            </span>
          </li>
        ))}
      </ol>

      {model.retrying && (
        <p className="cq-stepper__note cq-stepper__note--warning">
          <Icon name="refresh" size={14} /> Attempt {attempts} failed — retrying automatically. {error && <span>({error})</span>}
        </p>
      )}
      {model.failed && (
        <p className="cq-stepper__note cq-stepper__note--danger" role="alert">
          <Icon name="alert" size={14} /> Processing failed{attempts > 0 ? ` after ${attempts} attempt${attempts === 1 ? '' : 's'}` : ''}
          {error ? `: ${error}` : '.'}
        </p>
      )}
    </div>
  );
}
