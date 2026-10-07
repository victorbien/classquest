import { useEffect, useState, type ReactNode } from 'react';
import { api, type ApiError, type JobStatus } from '../../api';
import type { IconName } from '../../navigation';
import { isTerminal } from '../../lib/assets';
import { PipelineStepper } from '../PipelineStepper';
import { Badge, Button, Card, Icon, type ButtonVariant } from '../ui';

type Outcome = { tone: 'success' | 'danger'; content: ReactNode } | null;

interface ControlProps {
  icon: IconName;
  title: string;
  demonstrates: string;
  actionLabel: string;
  variant: ButtonVariant;
  disruptive?: boolean;
  onRun: () => Promise<ReactNode>;
  /** Called after every run so the page refreshes its live data. */
  onDone: () => void;
  children?: ReactNode;
}

function Control({ icon, title, demonstrates, actionLabel, variant, disruptive, onRun, onDone, children }: ControlProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function run() {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome({ tone: 'success', content: await onRun() });
    } catch (err) {
      setOutcome({ tone: 'danger', content: (err as ApiError).message ?? 'The request failed' });
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <article className={`cq-demo${disruptive ? ' cq-demo--disruptive' : ''}`}>
      <div className="cq-demo__head">
        <span className="cq-demo__icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
        <h3 className="cq-card-title">{title}</h3>
        {disruptive && <Badge tone="warning" upper>Disruptive</Badge>}
      </div>
      <p className="cq-body">{demonstrates}</p>
      <div>
        <Button variant={variant} onClick={run} disabled={busy}>
          {busy ? 'Running…' : actionLabel}
        </Button>
      </div>
      {outcome && (
        <div className={`cq-demo__result cq-demo__result--${outcome.tone}`} role="status">
          {outcome.content}
        </div>
      )}
      {children}
    </article>
  );
}

/** Polls the induced job through the existing GET /jobs/:id until it finishes. */
function InducedJob({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobStatus | null>(null);
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const j = await api.getJob(jobId);
        if (stop) return;
        setJob(j);
        if (isTerminal(j.state)) return;
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 2000);
    }
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);
  if (!job) return <p className="cq-small">Waiting for the job status…</p>;
  return <PipelineStepper state={job.state} attempts={job.attempts} error={job.error} label="induced failure job" />;
}

const DLQ_CHECK =
  "docker compose exec localstack sh -c 'awslocal sqs get-queue-attributes --attribute-names ApproximateNumberOfMessages " +
  "--queue-url $(awslocal sqs get-queue-url --queue-name classquest-asset-processing-dlq --query QueueUrl --output text)'";

interface DemoControlsProps {
  /** Configured HTTP 400 threshold (metrics.alerting.threshold); burst sends threshold + 10. */
  threshold: number | null;
  onDone: () => void;
}

/** Existing demo endpoints, grouped and explained (teacher/admin only — backend-enforced). */
export function DemoControls({ threshold, onDone }: DemoControlsProps) {
  const [inducedJobId, setInducedJobId] = useState<string | null>(null);
  const burstSize = (threshold ?? 50) + 10;

  return (
    <Card
      title="Demonstration Controls"
      subtitle="Drive the architecture live. Everything created here is labelled DEMO/SAMPLE. Available to teachers and administrators."
    >
      <div className="cq-demo-grid">
        <Control
          icon="upload-cloud"
          title="Seed demo catalogue"
          demonstrates="Creates the sample courses and publishes their resources through the normal path: S3 upload, MySQL record, SQS message, worker processing. Already-seeded courses and resources are skipped."
          actionLabel="Seed demo catalogue"
          variant="secondary"
          onRun={async () => {
            const r = await api.demoSeed();
            return (
              <>
                <strong>{r.message}</strong>
                <span>
                  {r.courses.created.length} new course{r.courses.created.length === 1 ? '' : 's'} ({r.courses.total} sample courses in total);{' '}
                  {r.assets.length} new resource{r.assets.length === 1 ? '' : 's'} queued for processing
                  {r.skipped.length > 0 && `; ${r.skipped.length} already present and skipped`}.
                </span>
              </>
            );
          }}
          onDone={onDone}
        />

        <Control
          icon="alert"
          title="Induce processing failure"
          demonstrates="Queues a job the worker fails on every attempt. Watch the retries, the final Failed state, and SQS's redrive policy move the message to the dead-letter queue."
          actionLabel="Induce failure"
          variant="accent"
          disruptive
          onRun={async () => {
            const r = await api.demoInduceFailure();
            setInducedJobId(r.jobId);
            return (
              <>
                <strong>{r.message}</strong>
                <span>Up to {r.maxAttempts} attempts before the job is marked failed.</span>
              </>
            );
          }}
          onDone={onDone}
        >
          {inducedJobId && (
            <div className="cq-demo__extra">
              <InducedJob key={inducedJobId} jobId={inducedJobId} />
              <p className="cq-small">
                <Icon name="terminal" size={14} /> The DLQ count is not shown by this page’s API. Verify the redrive from a terminal:
              </p>
              <code className="cq-code cq-code--block">{DLQ_CHECK}</code>
            </div>
          )}
        </Control>

        <Control
          icon="snowflake"
          title="Simulate Glacier lifecycle"
          demonstrates="Moves up to 10 completed demo resources still in the Standard tier to the GLACIER storage class now, instead of waiting for the 90-day lifecycle rule. A local simulation; restore is not emulated."
          actionLabel="Simulate Glacier tiering"
          variant="accent"
          disruptive
          onRun={async () => {
            const r = await api.demoLifecycleSimulate();
            return (
              <>
                <strong>{r.message}</strong>
                <span>
                  {r.transitionedCount === 0
                    ? 'All completed demo resources are already in GLACIER.'
                    : `${r.transitionedCount} resource${r.transitionedCount === 1 ? '' : 's'} now in GLACIER: ${r.transitioned.join(', ')}`}
                </span>
              </>
            );
          }}
          onDone={onDone}
        />

        <Control
          icon="zap"
          title="Generate HTTP 400 burst"
          demonstrates={`Sends ${burstSize} intentional bad requests through the Web Tier — above the ${threshold ?? 50}-per-minute alarm threshold. Each is written to the CloudWatch access log that feeds the HTTP 400 metric filter.`}
          actionLabel={`Send ${burstSize} bad requests`}
          variant="danger"
          disruptive
          onRun={async () => {
            const r = await api.demo400Burst(burstSize);
            return (
              <>
                <strong>
                  {r.got400} of {r.requested} requests returned HTTP 400
                  {r.completed < r.requested && ` (${r.requested - r.completed} did not complete)`}.
                </strong>
                <span>The App Tier count above updates immediately; the CloudWatch alarm state is shown in the monitoring card.</span>
              </>
            );
          }}
          onDone={onDone}
        />
      </div>
    </Card>
  );
}
