import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError, type StudentCourse, type StudentProgress } from '../api';
import { useAuth } from '../auth';
import { fileKind, formatBytes, TYPE_LABEL } from '../lib/assets';
import { useOpenResource } from '../lib/openResource';
import { cleanName, coveragePercent, formatRelative } from '../lib/progress';
import { PageHeader } from '../components/shell/PageHeader';
import { CourseCard } from '../components/courses/CourseCard';
import { Badge, Button, Card, EmptyState, Icon, ProgressBar, StatCard } from '../components/ui';

const HOW_IT_WORKS = [
  { title: 'Choose a course', body: 'Your teachers publish courses with slides, readings and recordings.', icon: 'course' as const },
  { title: 'Open learning materials', body: 'Each resource opens through a secure, time-limited link.', icon: 'external' as const },
  { title: 'See what you have opened', body: 'My Progress shows the resources you have opened in each course.', icon: 'progress' as const },
];

/** Courses to feature on Home: most recently opened first, then unstarted ones by title. */
function featured(courses: StudentCourse[]): StudentCourse[] {
  const opened = (c: StudentCourse) => (c.lastOpenedAt ? Date.parse(c.lastOpenedAt) : 0);
  return [...courses].sort((a, b) => opened(b) - opened(a) || a.title.localeCompare(b.title)).slice(0, 3);
}

/**
 * Student Home. Real data only: the student's opens from GET /me/progress and
 * the published courses (with the student's progress) from GET /courses.
 */
export function StudentHome() {
  const { session } = useAuth();
  const [progress, setProgress] = useState<StudentProgress | null>(null);
  const [courses, setCourses] = useState<StudentCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.allSettled([api.progress(), api.listStudentCourses()]);
    if (p.status === 'fulfilled') setProgress(p.value);
    if (c.status === 'fulfilled') setCourses(c.value.courses);
    const failed = [p, c].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setError(failed ? ((failed.reason as ApiError)?.message ?? 'Some information could not be loaded') : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { open, openingId, errorId } = useOpenResource(() => void load());
  const last = progress?.recent[0];
  const name = session ? cleanName(session.displayName) : '';

  return (
    <>
      <PageHeader
        eyebrow="Learning portal"
        title={`Welcome back, ${name}`}
        description="Pick up where you left off, or continue one of your courses."
      />

      {error && <p className="cq-stale" role="status">{error}</p>}

      <div className="cq-home-top">
        <Card className="cq-continue" title="Continue where you left off" subtitle="The resource you opened most recently.">
          {!progress ? (
            <p className="cq-small">Loading…</p>
          ) : !last ? (
            <EmptyState
              icon="library"
              title="You haven't opened any resources yet"
              description="Open a resource in one of your courses — it will appear here next time."
              action={<Link className="cq-btn cq-btn--primary" to="/courses">Browse courses</Link>}
            />
          ) : (
            <div className="cq-continue__item">
              <div className={`cq-continue__thumb cq-resource__thumb--${last.asset.type}`} aria-hidden="true">
                <Icon name={last.asset.type} size={36} />
              </div>
              <div className="cq-continue__body">
                <div className="cq-resource__tags">
                  <Badge tone="info" upper>{TYPE_LABEL[last.asset.type]}</Badge>
                  {last.asset.isDemo && <Badge tone="warning" upper>Demo</Badge>}
                </div>
                <h3 className="cq-continue__title">{last.asset.title}</h3>
                <p className="cq-small">
                  <Link to={`/courses/${last.asset.courseId}`}>{last.asset.courseTitle}</Link> · {fileKind(last.asset.contentType)} ·{' '}
                  {formatBytes(last.asset.sizeBytes)} · Last opened {formatRelative(last.lastOpenedAt)}
                </p>
                <div>
                  <Button iconRight="external" onClick={() => void open(last.asset.id)} disabled={openingId === last.asset.id}>
                    {openingId === last.asset.id ? 'Opening…' : 'Open again'}
                  </Button>
                </div>
                {errorId === last.asset.id && <p className="cq-resource__error" role="alert">Could not open this resource. Please try again.</p>}
              </div>
            </div>
          )}
        </Card>

        <Card
          className="cq-home-summary"
          title="Your activity"
          action={<Link className="cq-btn cq-btn--link" to="/progress">My Progress</Link>}
        >
          {!progress ? (
            <p className="cq-small">Loading…</p>
          ) : (
            <>
              <div className="cq-mini-stats cq-mini-stats--two">
                <StatCard label="Opened" value={progress.opened} unit={progress.opened === 1 ? 'resource' : 'resources'} tone="primary" icon="external" />
                <StatCard label="Available" value={progress.available} unit={progress.available === 1 ? 'resource' : 'resources'} tone="callout" icon="library" />
              </div>
              <div className="cq-home-summary__coverage">
                <span className="cq-small">Resources opened across your courses</span>
                <ProgressBar value={coveragePercent(progress.opened, progress.available)} showLabel label="Resources opened across courses" />
              </div>
              <p className="cq-small">Counts resources you have opened — not grades or lesson completion.</p>
            </>
          )}
        </Card>
      </div>

      <section className="cq-ops-section" aria-labelledby="courses-title">
        <div className="cq-section-head">
          <h2 id="courses-title" className="cq-section-title">Your courses</h2>
          <Link className="cq-btn cq-btn--link" to="/courses">View all courses</Link>
        </div>
        {!courses ? (
          <p className="cq-small">Loading…</p>
        ) : courses.length === 0 ? (
          <Card>
            <EmptyState icon="course" title="No courses yet" description="Courses appear here once your teachers publish them." />
          </Card>
        ) : (
          <div className="cq-course-grid">
            {featured(courses).map((c) => (
              <CourseCard key={c.id} variant="student" course={c} />
            ))}
          </div>
        )}
      </section>

      <Card variant="callout" title="How ClassQuest works">
        <ol className="cq-steps">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="cq-steps__item">
              <span className="cq-steps__num" aria-hidden="true">{i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                <p className="cq-small">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
