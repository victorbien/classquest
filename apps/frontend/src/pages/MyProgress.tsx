import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError, type StudentProgress } from '../api';
import { TYPE_LABEL, type AssetType } from '../lib/assets';
import { useOpenResource } from '../lib/openResource';
import { coveragePercent, formatRelative, percent } from '../lib/progress';
import { percentLabel } from '../lib/courses';
import { PageHeader } from '../components/shell/PageHeader';
import { Badge, Button, Card, EmptyState, Icon, ProgressBar, StatCard } from '../components/ui';

const TYPES: Array<{ type: AssetType; label: string }> = [
  { type: 'document', label: 'Documents' },
  { type: 'book', label: 'Books' },
  { type: 'video', label: 'Videos' },
];

/**
 * My Progress: which resources of published courses the student has opened
 * (GET /me/progress) — overall, per course and per type. Access only — not
 * grades, mastery or completion.
 */
export function MyProgress() {
  const [progress, setProgress] = useState<StudentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProgress(await api.progress());
      setError(null);
    } catch (err) {
      setError((err as ApiError).message ?? 'Progress could not be loaded');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { open, openingId, errorId } = useOpenResource(() => void load());

  return (
    <>
      <PageHeader
        eyebrow="Learning portal"
        title="My Progress"
        description="The course resources you have opened in ClassQuest."
      />

      <p className="cq-scope-note" role="note">
        <Icon name="info" size={16} />
        Progress on this page represents resources opened in ClassQuest. It does not represent grades, mastery or lesson
        completion.
      </p>

      {error && !progress ? (
        <Card>
          <EmptyState
            icon="alert"
            title="Progress could not be loaded"
            description={error}
            action={<Button variant="secondary" iconLeft="refresh" onClick={() => void load()}>Try again</Button>}
          />
        </Card>
      ) : !progress ? (
        <Card><p className="cq-small">Loading…</p></Card>
      ) : (
        <>
          <div className="cq-kpi-grid cq-ops-section">
            <StatCard label="Resources opened" icon="external" value={progress.opened} sub="Distinct resources" tone="primary" />
            <StatCard label="Resources available" icon="library" value={progress.available} sub="In published courses" tone="callout" />
            <StatCard
              label="Overall coverage"
              icon="progress"
              value={percent(progress.coverage)}
              unit="%"
              sub={`${progress.opened} of ${progress.available} opened`}
              tone="success"
            />
            <StatCard
              label="Last opened"
              icon="clock"
              value={<span className="cq-kpi--text">{formatRelative(progress.lastOpenedAt)}</span>}
              sub={progress.lastOpenedAt ? new Date(progress.lastOpenedAt).toLocaleString() : 'Open a resource to get started'}
              tone="warning"
            />
          </div>

          <Card
            className="cq-ops-section"
            title="By course"
            subtitle="Resources opened out of those available in each published course."
            action={<Link className="cq-btn cq-btn--link" to="/courses">All courses</Link>}
          >
            {progress.courses.length === 0 ? (
              <EmptyState icon="course" title="No published courses yet" description="Courses appear here once your teachers publish them." />
            ) : (
              <ul className="cq-course-progress-list">
                {progress.courses.map((c) => (
                  <li key={c.courseId} className="cq-course-progress-row">
                    <div className="cq-course-progress-row__text">
                      <Link to={`/courses/${c.courseId}`} className="cq-course-progress-row__title">{c.title}</Link>
                      <span className="cq-small">
                        {c.category}
                        {c.lastOpenedAt ? ` · Last opened ${formatRelative(c.lastOpenedAt)}` : ' · Not started'}
                      </span>
                    </div>
                    <span className="cq-course-progress-row__count">
                      {c.opened} / {c.available} <span className="cq-small">resources opened</span>
                    </span>
                    <div className="cq-course-progress-row__bar">
                      <ProgressBar value={c.coverage * 100} label={`${c.title}: resources opened`} />
                    </div>
                    <strong className="cq-course-progress-row__pct">{percentLabel(c.coverage)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="cq-ops-columns cq-ops-section">
            <Card title="By resource type" subtitle="Resources opened out of those available.">
              <ul className="cq-type-progress">
                {TYPES.map(({ type, label }) => {
                  const c = progress.byType[type];
                  return (
                    <li key={type} className="cq-type-progress__row">
                      <div className="cq-type-progress__head">
                        <span className={`cq-recent__icon cq-resource__thumb--${type}`} aria-hidden="true"><Icon name={type} size={16} /></span>
                        <span className="cq-type-progress__label">{label}</span>
                        <span className="cq-type-progress__count">
                          {c.opened} / {c.available}
                        </span>
                      </div>
                      <ProgressBar value={coveragePercent(c.opened, c.available)} label={`${label} opened`} />
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card
              title="Recently opened"
              subtitle="Your most recent resources, newest first."
              action={<Link className="cq-btn cq-btn--link" to="/courses">Courses</Link>}
            >
              {progress.recent.length === 0 ? (
                <EmptyState
                  icon="library"
                  title="Nothing opened yet"
                  description="Resources you open from your courses will be listed here."
                  action={<Link className="cq-btn cq-btn--primary" to="/courses">Browse courses</Link>}
                />
              ) : (
                <ul className="cq-recent">
                  {progress.recent.map((r) => (
                    <li key={r.asset.id} className="cq-recent__item">
                      <span className={`cq-recent__icon cq-resource__thumb--${r.asset.type}`} aria-hidden="true">
                        <Icon name={r.asset.type} size={18} />
                      </span>
                      <div className="cq-recent__text">
                        <span className="cq-recent__title">{r.asset.title}</span>
                        <span className="cq-small">
                          {r.asset.courseTitle} · {TYPE_LABEL[r.asset.type]} · Last opened {formatRelative(r.lastOpenedAt)} · Opened {r.openCount}{' '}
                          {r.openCount === 1 ? 'time' : 'times'}
                        </span>
                        {errorId === r.asset.id && <span className="cq-resource__error" role="alert">Could not open — try again.</span>}
                      </div>
                      {r.asset.isDemo && <Badge tone="warning" upper>Demo</Badge>}
                      <Button
                        size="sm"
                        variant="secondary"
                        iconRight="external"
                        onClick={() => void open(r.asset.id)}
                        disabled={openingId === r.asset.id}
                      >
                        {openingId === r.asset.id ? 'Opening…' : 'Open again'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
