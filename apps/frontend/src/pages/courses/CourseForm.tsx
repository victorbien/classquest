import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ApiError, type Course, type CourseStatus } from '../../api';
import { categoriesOf, coverProblem, lifecycleActions, STATUS_LABEL } from '../../lib/courses';
import { PageHeader } from '../../components/shell/PageHeader';
import { CourseCover } from '../../components/courses/CourseCover';
import { CourseStatusBadge } from '../../components/courses/CourseStatusBadge';
import { Button, Card, EmptyState, Icon, SegmentedControl, type SegmentOption } from '../../components/ui';

const CREATE_STATUS: SegmentOption<'draft' | 'published'>[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

const ACTION_COPY = {
  publish: { label: 'Publish course', to: 'published', variant: 'primary', hint: 'Students can see the course and its completed resources.' },
  draft: { label: 'Return to draft', to: 'draft', variant: 'secondary', hint: 'Hides the course from students; nothing is deleted.' },
  archive: { label: 'Archive course', to: 'archived', variant: 'danger', hint: 'Hides the course from students and stops new resources. Access history is kept.' },
  restore: { label: 'Restore to draft', to: 'draft', variant: 'secondary', hint: 'Brings the course back as a draft so you can edit and republish it.' },
} as const;

/**
 * Create Course (/courses/new) and Edit Course (/courses/:courseId/edit).
 * Course fields are saved as JSON; an optional cover image is uploaded
 * separately to S3 (PUT /courses/:id/cover).
 */
export function CourseForm() {
  const { courseId } = useParams();
  const editing = !!courseId;
  const navigate = useNavigate();
  const ids = { title: useId(), description: useId(), category: useId(), categories: useId(), cover: useId() };

  const [course, setCourse] = useState<Course | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listCourses().then((r) => setKnownCategories(categoriesOf(r.courses))).catch(() => undefined);
    if (!courseId) return;
    api
      .getCourse(courseId)
      .then(({ course }) => {
        setCourse(course);
        setTitle(course.title);
        setDescription(course.description);
        setCategory(course.category);
      })
      .catch((err: ApiError) => setLoadError(err.message ?? 'Course not found'));
  }, [courseId]);

  // Local preview of a newly chosen cover image. A data: URL, because the Web
  // Tier's CSP allows data: images but not blob: URLs.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!coverFile) {
      setPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(coverFile);
    return () => reader.abort();
  }, [coverFile]);
  const shownCover = preview ?? (removeCover ? null : (course?.coverUrl ?? null));

  function chooseCover(file: File | undefined) {
    if (!file) return;
    const problem = coverProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setCoverFile(file);
    setRemoveCover(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !category.trim()) {
      setError('Title and category are required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fields = { title: title.trim(), description: description.trim(), category: category.trim() };
      const saved = editing
        ? (await api.updateCourse(courseId!, fields)).course
        : (await api.createCourse({ ...fields, status })).course;
      try {
        if (coverFile) await api.uploadCover(saved.id, coverFile);
        else if (removeCover && course?.coverUrl) await api.deleteCover(saved.id);
      } catch (err) {
        // The course itself is saved; say so rather than losing the work.
        navigate(`/courses/${saved.id}`, { state: { notice: `Course saved, but the cover image was not: ${(err as ApiError).message}` } });
        return;
      }
      navigate(`/courses/${saved.id}`);
    } catch (err) {
      setError((err as ApiError).message ?? 'The course could not be saved');
      setBusy(false);
    }
  }

  async function changeStatus(to: CourseStatus) {
    if (!course) return;
    setBusy(true);
    setError(null);
    try {
      setCourse((await api.updateCourse(course.id, { status: to })).course);
    } catch (err) {
      setError((err as ApiError).message ?? 'The status could not be changed');
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
  if (editing && !course) return <Card><p className="cq-small">Loading…</p></Card>;

  return (
    <>
      <Link className="cq-back-link" to={editing ? `/courses/${courseId}` : '/courses'}>
        <Icon name="arrow-left" size={16} /> {editing ? 'Back to course' : 'My Courses'}
      </Link>
      <PageHeader
        eyebrow="Teacher Portal"
        title={editing ? 'Edit Course' : 'Create Course'}
        description={
          editing
            ? 'Update the course details students see on the course page.'
            : 'Give the course a title and category. You can save it as a draft and add resources before publishing.'
        }
      />

      <div className="cq-publish">
        <Card className="cq-publish__form" title="Course details" subtitle="Title and category are required.">
          <form onSubmit={submit} noValidate className="cq-form">
            <div className="cq-field">
              <label htmlFor={ids.title}>Title</label>
              <input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Cloud Computing" required />
            </div>

            <div className="cq-field">
              <label htmlFor={ids.description}>Description</label>
              <textarea
                id={ids.description}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={5}
                placeholder="What the course covers and what students will find in it."
              />
              <span className="cq-small cq-field__counter">{description.length} / 2000</span>
            </div>

            <div className="cq-field">
              <label htmlFor={ids.category}>Category</label>
              <input
                id={ids.category}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={80}
                list={ids.categories}
                placeholder="e.g. Computer Science"
                required
              />
              <datalist id={ids.categories}>
                {knownCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div className="cq-field">
              <span className="cq-field__label">Cover image <span className="cq-small">(optional)</span></span>
              <div className="cq-cover-field">
                <div className="cq-cover-field__preview">
                  <CourseCover title={title || 'New course'} category={category || 'Course'} coverUrl={shownCover} />
                </div>
                <div className="cq-cover-field__actions">
                  <input
                    id={ids.cover}
                    type="file"
                    className="cq-visually-hidden"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      chooseCover(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <label htmlFor={ids.cover} className="cq-btn cq-btn--secondary cq-btn--sm">
                    <Icon name="image" size={16} /> {shownCover ? 'Replace image' : 'Choose image'}
                  </label>
                  {shownCover && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCoverFile(null);
                        setRemoveCover(true);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                  <span className="cq-small">PNG, JPEG or WebP up to 2 MB. Without an image a placeholder is shown.</span>
                </div>
              </div>
            </div>

            {!editing && (
              <div className="cq-field">
                <span className="cq-field__label">Status</span>
                <SegmentedControl options={CREATE_STATUS} value={status} onChange={setStatus} label="Course status" />
                <span className="cq-small">
                  {status === 'draft'
                    ? 'Drafts are only visible to you. Publish when the course is ready.'
                    : 'Students can see the course straight away; resources appear once processing completes.'}
                </span>
              </div>
            )}

            {error && <div className="cq-form-error" role="alert">{error}</div>}

            <div className="cq-form__actions">
              <Link className="cq-btn cq-btn--secondary" to={editing ? `/courses/${courseId}` : '/courses'}>Cancel</Link>
              <Button type="submit" iconLeft={editing ? 'check' : 'plus'} disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : status === 'draft' ? 'Save as draft' : 'Create & publish'}
              </Button>
            </div>
          </form>
        </Card>

        {editing && course && (
          <div className="cq-publish__side">
            <Card title="Course status" subtitle="Students only see published courses." action={<CourseStatusBadge status={course.status} />}>
              <ul className="cq-lifecycle">
                {lifecycleActions(course.status).map((a) => {
                  const copy = ACTION_COPY[a];
                  return (
                    <li key={a} className="cq-lifecycle__item">
                      <div>
                        <strong>{copy.label}</strong>
                        <p className="cq-small">{copy.hint}</p>
                      </div>
                      <Button size="sm" variant={copy.variant} disabled={busy} onClick={() => void changeStatus(copy.to)}>
                        {copy.label}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <p className="cq-small cq-footnote">Current status: {STATUS_LABEL[course.status]}.</p>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
