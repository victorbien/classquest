import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError, type Asset, type DashboardMetrics, type StaffCourse } from '../api';
import { formatDate, searchAndSort, TYPE_LABEL } from '../lib/assets';
import { assetStateCounts, share } from '../lib/operations';
import { formatRelative } from '../lib/progress';
import { PageHeader } from '../components/shell/PageHeader';
import { CourseStatusBadge } from '../components/courses/CourseStatusBadge';
import { Badge, Card, EmptyState, Icon, ProgressBar, STATUS_TONE, StatCard } from '../components/ui';

const BAR_TONE = { completed: 'success', failed: 'danger', processing: 'primary', queued: 'primary', submitted: 'primary' } as const;

/**
 * Teacher Dashboard. The teacher's own courses from GET /courses, library-wide
 * pipeline counts from GET /dashboard/metrics and the newest resources from
 * GET /assets. No student analytics: pipeline metrics are library-wide, so
 * only the course list is labelled "mine".
 */
export function TeacherDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recent, setRecent] = useState<Asset[] | null>(null);
  const [courses, setCourses] = useState<StaffCourse[] | null>(null);
  // SQS reachability from /health: the metrics API reports depth 0 when SQS is down.
  const [sqsUp, setSqsUp] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, a, h, c] = await Promise.allSettled([api.dashboard(), api.listAssets(), api.health(), api.listCourses()]);
    setSqsUp(h.status === 'fulfilled' ? h.value.dependencies?.sqs : undefined);
    if (m.status === 'fulfilled') setMetrics(m.value);
    if (a.status === 'fulfilled') setRecent(searchAndSort(a.value.assets, '', 'newest').slice(0, 6));
    if (c.status === 'fulfilled') setCourses(c.value.courses);
    const failed = [m, a, c].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setError(failed ? ((failed.reason as ApiError)?.message ?? 'Some information could not be loaded') : null);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10000);
    return () => clearInterval(t);
  }, [load]);

  const s = metrics?.jobs.byStatus ?? {};
  const inPipeline = (s.submitted ?? 0) + (s.queued ?? 0) + (s.processing ?? 0);
  const states = metrics ? assetStateCounts(metrics.jobs.byStatus) : null;
  const courseCount = (status: StaffCourse['status']) => (courses ?? []).filter((c) => c.status === status).length;

  return (
    <>
      <PageHeader
        eyebrow="Teacher Portal"
        title="Dashboard"
        description="Your courses, and an overview of the resource library and its processing pipeline."
        actions={
          <>
            <Link className="cq-btn cq-btn--secondary" to="/courses">
              <Icon name="course" size={18} /> My Courses
            </Link>
            <Link className="cq-btn cq-btn--primary" to="/publish">
              <Icon name="publish" size={18} /> Publish resource
            </Link>
          </>
        }
      />

      {error && <p className="cq-stale" role="status">{error}</p>}

      <div className="cq-kpi-grid cq-ops-section">
        <StatCard label="Published resources" icon="check" value={metrics ? (s.completed ?? 0) : '—'} sub="Completed · library-wide" tone="success" />
        <StatCard label="In pipeline" icon="cpu" value={metrics ? inPipeline : '—'} sub="Submitted, queued or processing" tone="primary" />
        <StatCard label="Failed" icon="alert" value={metrics ? (s.failed ?? 0) : '—'} sub="Processing failed" tone="danger" />
        <StatCard
          label="Queue depth"
          icon="queue"
          value={!metrics ? '—' : sqsUp === false ? 'Unavailable' : metrics.jobs.queueDepth}
          unit={metrics && sqsUp !== false ? (metrics.jobs.queueDepth === 1 ? 'message' : 'messages') : undefined}
          sub={sqsUp === false ? 'SQS is not responding — see Operations' : 'Amazon SQS main queue'}
          tone={sqsUp === false ? 'danger' : 'callout'}
        />
      </div>

      <div className="cq-ops-columns cq-ops-section">
        <Card
          title="My Courses"
          subtitle="Courses you created, most recently updated first."
          action={<Link className="cq-btn cq-btn--link" to="/courses">View all →</Link>}
        >
          {!courses ? (
            <p className="cq-small">Loading…</p>
          ) : courses.length === 0 ? (
            <EmptyState
              icon="course"
              title="No courses yet"
              description="Create a course, then add resources to it."
              action={<Link className="cq-btn cq-btn--primary" to="/courses/new">Create Course</Link>}
            />
          ) : (
            <>
              <div className="cq-mini-stats">
                <StatCard label="Published" value={courseCount('published')} tone="success" />
                <StatCard label="Draft" value={courseCount('draft')} tone="warning" />
                <StatCard label="Archived" value={courseCount('archived')} tone="callout" />
              </div>
              <ul className="cq-recent cq-dashboard-courses">
                {courses.slice(0, 4).map((c) => (
                  <li key={c.id} className="cq-recent__item">
                    <span className="cq-recent__icon cq-resource__thumb--book" aria-hidden="true"><Icon name="course" size={18} /></span>
                    <div className="cq-recent__text">
                      <Link to={`/courses/${c.id}`} className="cq-recent__title">{c.title}</Link>
                      <span className="cq-small">
                        {c.resourceCount} {c.resourceCount === 1 ? 'resource' : 'resources'} · {c.completedCount} ready · Updated {formatRelative(c.updatedAt)}
                      </span>
                    </div>
                    <CourseStatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="Pipeline summary"
          subtitle="Resource processing states across the library."
          action={<Link className="cq-btn cq-btn--link" to="/operations">System status →</Link>}
        >
          {!states ? (
            <p className="cq-small">Loading…</p>
          ) : (
            <ul className="cq-state-list">
              {states.rows.map((r) => (
                <li key={r.state} className="cq-state-row">
                  <Badge tone={STATUS_TONE[r.state] ?? 'neutral'} upper>{r.state}</Badge>
                  <ProgressBar value={share(r.count, states.total)} tone={BAR_TONE[r.state]} label={`${r.state} share of resources`} />
                  <span className="cq-state-row__count">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Recent Resources"
        subtitle="The newest resources in the library, from all teachers."
        action={<Link className="cq-btn cq-btn--link" to="/library">Open Library</Link>}
      >
        {!recent ? (
          <p className="cq-small">Loading…</p>
        ) : recent.length === 0 ? (
          <EmptyState icon="library" title="No resources yet" description="Publish a resource, or seed the demo catalogue from Operations." />
        ) : (
          <div className="cq-table-wrap">
            <table className="cq-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Course</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Storage tier</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}>
                    <td className="cq-table__title">
                      <span className={`cq-recent__icon cq-resource__thumb--${a.type}`} aria-hidden="true"><Icon name={a.type} size={16} /></span>
                      <span>{a.title}</span>
                    </td>
                    <td><Link to={`/courses/${a.courseId}`}>{a.courseTitle}</Link></td>
                    <td>{TYPE_LABEL[a.type]}</td>
                    <td><Badge tone={STATUS_TONE[a.status] ?? 'neutral'} upper>{a.status}</Badge></td>
                    <td><Badge tone={a.storageClass === 'GLACIER' ? 'neutral' : 'callout'} upper>{a.storageClass === 'GLACIER' ? 'Glacier' : 'Standard'}</Badge></td>
                    <td className="cq-small">{formatDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
