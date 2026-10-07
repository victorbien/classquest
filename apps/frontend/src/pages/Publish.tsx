import { useCallback, useEffect, useId, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type ApiError, type Asset, type StaffCourse } from '../api';
import { ACCEPTED, fileKind, formatBytes, formatDate, isTerminal, searchAndSort, TYPE_LABEL, type AssetType } from '../lib/assets';
import type { JobState } from '../lib/pipeline';
import { PageHeader } from '../components/shell/PageHeader';
import { PipelineStepper } from '../components/PipelineStepper';
import { Badge, Button, Card, EmptyState, Icon, Select, STATUS_TONE } from '../components/ui';

interface TrackedJob {
  jobId: string;
  assetId: string;
  courseId: string;
  courseTitle: string;
  title: string;
  type: AssetType;
  state: JobState;
  attempts: number;
  error: string | null;
}

const TYPES: AssetType[] = ['document', 'book', 'video'];
const TILE_HINT: Record<AssetType, string> = {
  document: 'Notes, worksheets, handouts',
  book: 'Digital books and study guides',
  video: 'Recorded lessons and clips',
};

function isAssetType(v: string | null): v is AssetType {
  return v === 'document' || v === 'book' || v === 'video';
}

/** `accept` attribute: extensions + MIME types (browsers differ on which they match). */
function acceptFor(type: AssetType): string {
  return [...ACCEPTED[type].extensions.map((e) => `.${e.toLowerCase()}`), ...ACCEPTED[type].mime].join(',');
}

/**
 * Publish Resource (/publish) and Add Resource (/courses/:courseId/resources/new).
 * The teacher picks a course, then the same workflow as before runs:
 * POST /assets -> S3 -> MySQL -> SQS -> worker -> completed/failed,
 * tracked by polling GET /jobs/:id. The completed resource appears in the course.
 */
export function Publish() {
  const [params] = useSearchParams();
  const { courseId: routeCourseId } = useParams();
  const initialType = params.get('type');
  const [type, setType] = useState<AssetType>(isAssetType(initialType) ? initialType : 'document');
  const [courses, setCourses] = useState<StaffCourse[] | null>(null);
  const [courseId, setCourseId] = useState(routeCourseId ?? params.get('courseId') ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [section, setSection] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<TrackedJob[]>([]);
  const [recent, setRecent] = useState<Asset[] | null>(null);
  const fileInputId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const sectionId = useId();

  // Resources can be added to the teacher's own courses that are not archived.
  useEffect(() => {
    api
      .listCourses()
      .then((r) => setCourses(r.courses.filter((c) => c.status !== 'archived')))
      .catch(() => setCourses([]));
  }, []);
  const selectedCourse = courses?.find((c) => c.id === courseId) ?? null;
  const lockedCourse = !!routeCourseId;

  const loadRecent = useCallback(async () => {
    try {
      const { assets } = await api.listAssets();
      setRecent(searchAndSort(assets, '', 'newest').slice(0, 6));
    } catch {
      setRecent((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  // Poll every in-flight job until it reaches a terminal state.
  const activeKey = tracked.filter((j) => !isTerminal(j.state)).map((j) => j.jobId).join(',');
  useEffect(() => {
    if (!activeKey) return;
    const ids = activeKey.split(',');
    const timer = setInterval(async () => {
      const results = await Promise.all(
        ids.map((id) => api.getJob(id).then((s) => [id, s] as const).catch(() => null)),
      );
      setTracked((prev) =>
        prev.map((j) => {
          const hit = results.find((r) => r && r[0] === j.jobId);
          return hit ? { ...j, state: hit[1].state, attempts: hit[1].attempts, error: hit[1].error } : j;
        }),
      );
      void loadRecent();
    }, 2000);
    return () => clearInterval(timer);
  }, [activeKey, loadRecent]);

  function chooseFile(f: File | null | undefined) {
    setFile(f ?? null);
    setError(null);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    chooseFile(e.dataTransfer.files?.[0]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCourse) {
      setError('Choose the course this resource belongs to');
      return;
    }
    if (!file || !title.trim()) {
      setError('Title and file are required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('courseId', selectedCourse.id);
      form.append('title', title.trim());
      form.append('type', type);
      if (description.trim()) form.append('description', description.trim());
      if (section.trim()) form.append('sectionLabel', section.trim());
      form.append('file', file);
      const r = await api.uploadAsset(form);
      setTracked((prev) => [
        {
          jobId: r.jobId, assetId: r.assetId, courseId: selectedCourse.id, courseTitle: selectedCourse.title,
          title: title.trim(), type, state: r.status as JobState, attempts: 0, error: null,
        },
        ...prev,
      ]);
      setTitle('');
      setDescription('');
      setFile(null);
      void loadRecent();
    } catch (err) {
      setError((err as ApiError).message ?? 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  const detected = file ? file.type || 'application/octet-stream' : '';
  // Advisory only — the backend allow-list decides.
  const mismatch = !!file && !!file.type && !ACCEPTED[type].mime.includes(file.type);

  return (
    <>
      {lockedCourse && (
        <Link className="cq-back-link" to={`/courses/${routeCourseId}`}><Icon name="arrow-left" size={16} /> Back to course</Link>
      )}
      <PageHeader
        eyebrow="Teacher Portal"
        title={lockedCourse ? 'Add Resource' : 'Publish Resource'}
        description="Add a document, book or video to one of your courses. It is stored in Amazon S3 and processed asynchronously through Amazon SQS; students see it in the course once processing completes."
      />

      {courses !== null && courses.length === 0 ? (
        <Card>
          <EmptyState
            icon="course"
            title="Create a course first"
            description="Every resource belongs to a course. Create one (it can stay a draft), then add resources to it."
            action={<Link className="cq-btn cq-btn--primary" to="/courses/new">Create Course</Link>}
          />
        </Card>
      ) : (
        <div className="cq-publish">
          <Card className="cq-publish__form" title="New resource" subtitle="Course, type, title and file are required.">
            <form onSubmit={submit} noValidate>
              <div className="cq-publish__section">
                <span className="cq-eyebrow">1 · Course</span>
                {lockedCourse ? (
                  selectedCourse ? (
                    <div className="cq-file-chip">
                      <span className="cq-file-chip__icon cq-resource__thumb--book"><Icon name="course" size={20} /></span>
                      <div className="cq-file-chip__text">
                        <span className="cq-file-chip__name">{selectedCourse.title}</span>
                        <span className="cq-small">{selectedCourse.category} · {selectedCourse.status === 'published' ? 'Published' : 'Draft'} · {selectedCourse.resourceCount} {selectedCourse.resourceCount === 1 ? 'resource' : 'resources'}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="cq-small">{courses === null ? 'Loading course…' : 'This course is not available (it may be archived or not yours).'}</p>
                  )
                ) : (
                  <Select
                    label="Course"
                    hideLabel
                    value={courseId}
                    onChange={setCourseId}
                    disabled={courses === null}
                    options={[
                      { value: '', label: courses === null ? 'Loading courses…' : 'Select a course…' },
                      ...(courses ?? []).map((c) => ({ value: c.id, label: `${c.title}${c.status === 'draft' ? ' (draft)' : ''}` })),
                    ]}
                  />
                )}
                {selectedCourse?.status === 'draft' && (
                  <p className="cq-hint"><Icon name="info" size={14} /> This course is a draft: students will see the resource once you publish the course.</p>
                )}
              </div>

              <fieldset className="cq-publish__section">
                <legend className="cq-eyebrow">2 · Resource type</legend>
                <div className="cq-type-tiles" role="radiogroup" aria-label="Resource type">
                  {TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={type === t}
                      className={`cq-type-tile cq-type-tile--${t}${type === t ? ' is-selected' : ''}`}
                      onClick={() => setType(t)}
                    >
                      <span className="cq-type-tile__icon"><Icon name={t} size={22} /></span>
                      <span className="cq-type-tile__label">{TYPE_LABEL[t]}</span>
                      <span className="cq-type-tile__hint">{TILE_HINT[t]}</span>
                      <span className="cq-type-tile__formats">{ACCEPTED[t].extensions.join(' · ')}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="cq-publish__section">
                <label className="cq-eyebrow" htmlFor={titleId}>3 · Title</label>
                <div className="cq-field">
                  <input
                    id={titleId}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Week 1 Lecture Slides"
                    maxLength={200}
                    required
                  />
                </div>
                <div className="cq-form__row">
                  <div className="cq-field">
                    <label htmlFor={descriptionId}>Description <span className="cq-small">(optional)</span></label>
                    <textarea id={descriptionId} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} placeholder="What students will find in this resource." />
                  </div>
                  <div className="cq-field cq-field--narrow">
                    <label htmlFor={sectionId}>Week / section <span className="cq-small">(optional)</span></label>
                    <input id={sectionId} value={section} onChange={(e) => setSection(e.target.value)} maxLength={80} placeholder="e.g. Week 1" />
                  </div>
                </div>
              </div>

              <div className="cq-publish__section">
                <span className="cq-eyebrow">4 · File</span>
                <input
                  id={fileInputId}
                  type="file"
                  className="cq-visually-hidden"
                  accept={acceptFor(type)}
                  onChange={(e) => {
                    chooseFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {!file ? (
                  <label
                    htmlFor={fileInputId}
                    className={`cq-dropzone${dragging ? ' is-dragging' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                  >
                    <span className="cq-dropzone__icon"><Icon name="upload-cloud" size={28} /></span>
                    <span className="cq-dropzone__title">Drag a file here, or <u>browse</u></span>
                    <span className="cq-small">
                      {TYPE_LABEL[type]} formats: {ACCEPTED[type].extensions.join(', ')}
                    </span>
                  </label>
                ) : (
                  <div className="cq-file-chip">
                    <span className={`cq-file-chip__icon cq-resource__thumb--${type}`}><Icon name={type} size={20} /></span>
                    <div className="cq-file-chip__text">
                      <span className="cq-file-chip__name">{file.name}</span>
                      <span className="cq-small">
                        {fileKind(detected)} · {formatBytes(file.size)} · uploading as <strong>{TYPE_LABEL[type]}</strong>
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" iconOnly="x" onClick={() => chooseFile(null)}>
                      Remove file
                    </Button>
                  </div>
                )}
                {mismatch && (
                  <p className="cq-hint cq-hint--warning">
                    <Icon name="alert" size={14} /> {fileKind(detected)} files are not normally accepted for {TYPE_LABEL[type].toLowerCase()}s; the server may reject this upload.
                  </p>
                )}
              </div>

              {error && (
                <div className="cq-form-error" role="alert">
                  {error}
                </div>
              )}

              <Button type="submit" iconLeft="publish" disabled={busy} block>
                {busy ? 'Uploading…' : 'Upload & publish'}
              </Button>
            </form>
          </Card>

          <div className="cq-publish__side">
            <Card title="Processing pipeline" subtitle="Live status of resources uploaded in this session.">
              {tracked.length === 0 ? (
                <EmptyState
                  icon="upload-cloud"
                  title="Nothing uploaded yet"
                  description="After you upload, each resource moves through Submitted → Queued → Processing → Completed here."
                />
              ) : (
                <ul className="cq-tracked">
                  {tracked.map((j) => (
                    <li key={j.jobId} className="cq-tracked__item">
                      <div className="cq-tracked__head">
                        <span className="cq-tracked__title">{j.title}</span>
                        <Badge tone="info" upper>{TYPE_LABEL[j.type]}</Badge>
                      </div>
                      <PipelineStepper state={j.state} attempts={j.attempts} error={j.error} label={j.title} />
                      <p className="cq-small cq-tracked__course">
                        In <Link to={`/courses/${j.courseId}`}>{j.courseTitle}</Link>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Recent Resources"
              subtitle="The latest resources in the library, from all teachers."
            >
              {recent === null ? (
                <p className="cq-small">Loading…</p>
              ) : recent.length === 0 ? (
                <p className="cq-small">No resources in the library yet.</p>
              ) : (
                <ul className="cq-recent">
                  {recent.map((a) => (
                    <li key={a.id} className="cq-recent__item">
                      <span className={`cq-recent__icon cq-resource__thumb--${a.type}`}><Icon name={a.type} size={18} /></span>
                      <div className="cq-recent__text">
                        <span className="cq-recent__title">{a.title}</span>
                        <span className="cq-small">
                          {a.courseTitle} · {TYPE_LABEL[a.type]} · {fileKind(a.contentType)} · {formatBytes(a.sizeBytes)} · {formatDate(a.createdAt)}
                        </span>
                      </div>
                      <Badge tone={STATUS_TONE[a.status] ?? 'neutral'} upper>{a.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
