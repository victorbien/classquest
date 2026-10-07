import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type ApiError, type StudentCourseDetail as Detail } from '../../api';
import { fileKind, formatBytes, TYPE_LABEL } from '../../lib/assets';
import { groupBySection, percentLabel } from '../../lib/courses';
import { cleanName, formatRelative } from '../../lib/progress';
import { useOpenResource } from '../../lib/openResource';
import { CourseCover } from '../../components/courses/CourseCover';
import { Avatar, Badge, Button, Card, EmptyState, Icon, ProgressBar } from '../../components/ui';

/**
 * Course page (student). Only published courses and their completed
 * resources reach this page (enforced by the API). Opening a resource uses
 * the existing presigned-URL flow, which also records the open.
 */
export function StudentCourseDetail() {
  const { courseId = '' } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getStudentCourse(courseId));
      setError(null);
    } catch (err) {
      setError((err as ApiError).message ?? 'Course not found');
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { open, openingId, errorId } = useOpenResource(() => void load());

  if (error && !data) {
    return (
      <Card>
        <EmptyState
          icon="course"
          title="This course is not available"
          description="It may have been unpublished or archived by your teacher."
          action={<Link className="cq-btn cq-btn--secondary" to="/courses">Back to Courses</Link>}
        />
      </Card>
    );
  }
  if (!data) return <Card><p className="cq-small">Loading…</p></Card>;

  const { course, resources, progress } = data;
  const sections = groupBySection(resources);

  return (
    <>
      <Link className="cq-back-link" to="/courses"><Icon name="arrow-left" size={16} /> Courses</Link>

      <Card className="cq-course-hero">
        <CourseCover title={course.title} category={course.category} coverUrl={course.coverUrl} variant="hero" />
        <div className="cq-course-hero__body">
          <div className="cq-resource__tags">
            <Badge tone="info" upper>{course.category}</Badge>
            {course.isDemo && <Badge tone="warning" upper>Demo</Badge>}
          </div>
          <h1 className="cq-page-title">{course.title}</h1>
          {course.description && <p className="cq-body">{course.description}</p>}
          <div className="cq-course-hero__teacher">
            <Avatar name={course.creatorName} size={32} />
            <div>
              <span className="cq-eyebrow">Teacher</span>
              <div className="cq-course-hero__teacher-name">{cleanName(course.creatorName)}</div>
            </div>
          </div>
          <div className="cq-course-progress">
            <div className="cq-course-card__progress-head">
              <span><strong>{progress.opened} / {progress.available}</strong> resources opened</span>
              <strong>{percentLabel(progress.coverage)}</strong>
            </div>
            <ProgressBar value={progress.coverage * 100} label="Course resources opened" />
            <span className="cq-small">Counts resources you have opened — not grades or lesson completion.</span>
          </div>
        </div>
      </Card>

      <Card title="Course resources" subtitle="In the order your teacher arranged them. Each opens through a secure, time-limited link.">
        {resources.length === 0 ? (
          <EmptyState icon="layers" title="No resources yet" description="Resources appear here once your teacher adds them and processing completes." />
        ) : (
          sections.map((group, gi) => (
            <section key={`${group.label}-${gi}`} className="cq-course-section">
              {group.label && <h3 className="cq-course-section__label">{group.label}</h3>}
              <ul className="cq-course-resources">
                {group.items.map((a) => (
                  <li key={a.id} className="cq-course-resource">
                    <span className={`cq-recent__icon cq-resource__thumb--${a.type}`} aria-hidden="true"><Icon name={a.type} size={18} /></span>
                    <div className="cq-course-resource__body">
                      <div className="cq-course-resource__head">
                        <span className="cq-course-resource__title">{a.title}</span>
                        {a.access ? (
                          <Badge tone="success"><Icon name="check" size={12} /> Opened</Badge>
                        ) : (
                          <Badge tone="neutral">Not opened yet</Badge>
                        )}
                      </div>
                      {a.description && <p className="cq-small cq-course-resource__desc">{a.description}</p>}
                      <p className="cq-small">
                        {TYPE_LABEL[a.type]} · {fileKind(a.contentType)} · {formatBytes(a.sizeBytes)}
                        {a.access && <> · Last opened {formatRelative(a.access.lastOpenedAt)} · Opened {a.access.openCount} {a.access.openCount === 1 ? 'time' : 'times'}</>}
                      </p>
                      {errorId === a.id && <p className="cq-resource__error" role="alert">Could not open this resource. Please try again.</p>}
                    </div>
                    <div className="cq-course-resource__actions">
                      <Button size="sm" variant={a.access ? 'secondary' : 'primary'} iconRight="external" disabled={openingId === a.id} onClick={() => void open(a.id)}>
                        {openingId === a.id ? 'Opening…' : a.access ? 'Open again' : 'Open'}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </Card>
    </>
  );
}
