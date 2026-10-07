import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, type ApiError, type Asset, type Course, type CourseStatus, type StaffCourse } from '../../api';
import { fileKind, formatBytes, formatDate, isTerminal, TYPE_LABEL } from '../../lib/assets';
import { moveItem } from '../../lib/courses';
import { cleanName, formatRelative } from '../../lib/progress';
import { useOpenResource } from '../../lib/openResource';
import { CourseCover } from '../../components/courses/CourseCover';
import { CourseStatusBadge } from '../../components/courses/CourseStatusBadge';
import { Badge, Button, Card, EmptyState, Icon, STATUS_TONE } from '../../components/ui';

/** Course Detail (teacher): course header, lifecycle actions and the ordered resource list. */
export function TeacherCourseDetail() {
  const { courseId = '' } = useParams();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  const [course, setCourse] = useState<Course | null>(null);
  const [resources, setResources] = useState<Asset[]>([]);
  const [otherCourses, setOtherCourses] = useState<StaffCourse[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { open, openingId, errorId } = useOpenResource();

  const load = useCallback(async () => {
    try {
      const r = await api.getCourse(courseId);
      setCourse(r.course);
      setResources(r.resources);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as ApiError).message ?? 'Course not found');
    }
  }, [courseId]);

  useEffect(() => {
    void load();
    void api.listCourses().then((r) => setOtherCourses(r.courses)).catch(() => undefined);
  }, [load]);

  // Refresh while resources are still moving through the pipeline.
  const inFlight = resources.some((a) => !isTerminal(a.status));
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  async function setStatus(to: CourseStatus) {
    setBusy(true);
    setActionError(null);
    try {
      setCourse((await api.updateCourse(courseId, { status: to })).course);
    } catch (err) {
      setActionError((err as ApiError).message ?? 'The status could not be changed');
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const ids = moveItem(resources.map((r) => r.id), index, direction);
    setBusy(true);
    setActionError(null);
    try {
      setResources((await api.reorderCourse(courseId, ids)).resources);
    } catch (err) {
      setActionError((err as ApiError).message ?? 'The order could not be saved');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Card>
        <EmptyState
          icon="alert"
          title="Course not available"
          description={loadError}
          action={<Link className="cq-btn cq-btn--secondary" to="/courses">Back to My Courses</Link>}
        />
      </Card>
    );
  }
  if (!course) return <Card><p className="cq-small">Loading…</p></Card>;

  const archived = course.status === 'archived';
  const ready = resources.filter((r) => r.status === 'completed').length;
  const moveTargets = otherCourses.filter((c) => c.status !== 'archived');

  return (
    <>
      <Link className="cq-back-link" to="/courses"><Icon name="arrow-left" size={16} /> My Courses</Link>

      {notice && <p className="cq-stale" role="status">{notice}</p>}

      <Card className="cq-course-hero">
        <CourseCover title={course.title} category={course.category} coverUrl={course.coverUrl} variant="hero" />
        <div className="cq-course-hero__body">
          <div className="cq-resource__tags">
            <Badge tone="info" upper>{course.category}</Badge>
            <CourseStatusBadge status={course.status} />
            {course.isDemo && <Badge tone="warning" upper>Demo</Badge>}
          </div>
          <h1 className="cq-page-title">{course.title}</h1>
          {course.description && <p className="cq-body">{course.description}</p>}
          <p className="cq-course-card__meta">
            <span><Icon name="user" size={14} /> {cleanName(course.creatorName)}</span>
            <span><Icon name="layers" size={14} /> {resources.length} {resources.length === 1 ? 'resource' : 'resources'} · {ready} ready</span>
            <span>Updated {formatRelative(course.updatedAt)}</span>
          </p>
          <div className="cq-course-hero__actions">
            {!archived && (
              <Link className="cq-btn cq-btn--primary" to={`/courses/${course.id}/resources/new`}>
                <Icon name="plus" size={18} /> Add Resource
              </Link>
            )}
            <Link className="cq-btn cq-btn--secondary" to={`/courses/${course.id}/edit`}>
              <Icon name="edit" size={18} /> Edit Course
            </Link>
            {course.status === 'draft' && (
              <Button variant="accent" iconLeft="check" disabled={busy} onClick={() => void setStatus('published')}>Publish Course</Button>
            )}
            {course.status === 'published' && (
              <Button variant="secondary" disabled={busy} onClick={() => void setStatus('draft')}>Return to Draft</Button>
            )}
            {archived && (
              <Button variant="secondary" iconLeft="refresh" disabled={busy} onClick={() => void setStatus('draft')}>Restore to Draft</Button>
            )}
          </div>
          {actionError && <div className="cq-form-error" role="alert">{actionError}</div>}
        </div>
      </Card>

      {course.status !== 'published' && (
        <p className="cq-scope-note" role="note">
          <Icon name="info" size={16} />
          {archived
            ? 'This course is archived: students cannot see it and new resources cannot be added. Restore it to draft to make changes.'
            : 'This course is a draft: students cannot see it until you publish it.'}
        </p>
      )}

      <Card
        title="Resources"
        subtitle="Shown to students in this order once processing completes. Use the arrows to reorder."
        action={<span className="cq-small">{resources.length} total</span>}
      >
        {resources.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No resources yet"
            description="Add lecture slides, readings, recordings or briefs. Each upload goes through S3 → SQS → worker before students can open it."
            action={!archived && <Link className="cq-btn cq-btn--primary" to={`/courses/${course.id}/resources/new`}>Add Resource</Link>}
          />
        ) : (
          <ol className="cq-course-resources">
            {resources.map((a, i) => (
              <li key={a.id} className="cq-course-resource">
                <span className="cq-course-resource__order" aria-label={`Position ${i + 1}`}>{i + 1}</span>
                <span className={`cq-recent__icon cq-resource__thumb--${a.type}`} aria-hidden="true"><Icon name={a.type} size={18} /></span>
                <div className="cq-course-resource__body">
                  {editingId === a.id ? (
                    <ResourceEditForm
                      asset={a}
                      courses={moveTargets}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => {
                        setEditingId(null);
                        void load();
                      }}
                    />
                  ) : (
                    <>
                      <div className="cq-course-resource__head">
                        <span className="cq-course-resource__title">{a.title}</span>
                        {a.sectionLabel && <Badge tone="callout">{a.sectionLabel}</Badge>}
                      </div>
                      {a.description && <p className="cq-small cq-course-resource__desc">{a.description}</p>}
                      <div className="cq-course-resource__meta">
                        <Badge tone="info" upper>{TYPE_LABEL[a.type]}</Badge>
                        <Badge tone={STATUS_TONE[a.status] ?? 'neutral'} upper>{a.status}</Badge>
                        <Badge tone={a.storageClass === 'GLACIER' ? 'neutral' : 'callout'} upper>
                          {a.storageClass === 'GLACIER' ? 'Glacier tier' : 'Standard tier'}
                        </Badge>
                        <span className="cq-small">{fileKind(a.contentType)} · {formatBytes(a.sizeBytes)} · Added {formatDate(a.createdAt)}</span>
                      </div>
                      {errorId === a.id && <p className="cq-resource__error" role="alert">Could not open this resource.</p>}
                    </>
                  )}
                </div>
                {editingId !== a.id && (
                  <div className="cq-course-resource__actions">
                    <Button size="sm" variant="ghost" iconOnly="arrow-up" disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                      {`Move ${a.title} up`}
                    </Button>
                    <Button size="sm" variant="ghost" iconOnly="arrow-down" disabled={busy || i === resources.length - 1} onClick={() => void move(i, 1)}>
                      {`Move ${a.title} down`}
                    </Button>
                    <Button size="sm" variant="ghost" iconOnly="edit" onClick={() => setEditingId(a.id)}>
                      {`Edit ${a.title}`}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      iconRight="external"
                      disabled={a.status !== 'completed' || openingId === a.id}
                      title={a.status === 'completed' ? 'Open via a time-limited S3 link' : 'Available once processing completes'}
                      onClick={() => void open(a.id)}
                    >
                      {openingId === a.id ? 'Opening…' : 'Open'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

/** Inline editor for a resource's title, description, section label and course. */
function ResourceEditForm({
  asset,
  courses,
  onCancel,
  onSaved,
}: {
  asset: Asset;
  courses: StaffCourse[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const ids = { title: useId(), description: useId(), section: useId(), course: useId() };
  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description);
  const [section, setSection] = useState(asset.sectionLabel ?? '');
  const [courseId, setCourseId] = useState(asset.courseId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('A title is required');
      return;
    }
    setBusy(true);
    try {
      await api.updateAsset(asset.id, {
        title: title.trim(),
        description: description.trim(),
        sectionLabel: section.trim() || null,
        ...(courseId !== asset.courseId ? { courseId } : {}),
      });
      onSaved();
    } catch (err) {
      setError((err as ApiError).message ?? 'The resource could not be saved');
      setBusy(false);
    }
  }

  return (
    <form className="cq-form cq-resource-edit" onSubmit={save} noValidate>
      <div className="cq-form__row">
        <div className="cq-field">
          <label htmlFor={ids.title}>Title</label>
          <input id={ids.title} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="cq-field cq-field--narrow">
          <label htmlFor={ids.section}>Week / section</label>
          <input id={ids.section} value={section} maxLength={80} placeholder="e.g. Week 3" onChange={(e) => setSection(e.target.value)} />
        </div>
      </div>
      <div className="cq-field">
        <label htmlFor={ids.description}>Description</label>
        <textarea id={ids.description} value={description} maxLength={2000} rows={2} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="cq-field">
        <label htmlFor={ids.course}>Course</label>
        <select id={ids.course} className="cq-input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.some((c) => c.id === asset.courseId) ? null : <option value={asset.courseId}>{asset.courseTitle}</option>}
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        {courseId !== asset.courseId && <span className="cq-small">The resource moves to the end of the selected course.</span>}
      </div>
      {error && <div className="cq-form-error" role="alert">{error}</div>}
      <div className="cq-form__actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button size="sm" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}
