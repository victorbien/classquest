import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError, type StaffCourse } from '../../api';
import { categoriesOf, filterCourses, type StatusFilter } from '../../lib/courses';
import { PageHeader } from '../../components/shell/PageHeader';
import { CourseCard } from '../../components/courses/CourseCard';
import { Button, Card, EmptyState, Icon, SearchInput, SegmentedControl, Select, type SegmentOption } from '../../components/ui';

const STATUS_OPTIONS: SegmentOption<StatusFilter>[] = [
  { value: 'active', label: 'Active' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

/** My Courses (teacher): the teacher's own courses from GET /courses. */
export function TeacherCourses() {
  const [courses, setCourses] = useState<StaffCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [category, setCategory] = useState('all');

  const load = useCallback(async () => {
    try {
      setCourses((await api.listCourses()).courses);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message ?? 'Courses could not be loaded');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => categoriesOf(courses ?? []), [courses]);
  const visible = useMemo(() => filterCourses(courses ?? [], { query, status, category }), [courses, query, status, category]);
  const filtered = query.trim() !== '' || category !== 'all' || status !== 'active';

  return (
    <>
      <PageHeader
        eyebrow="Teacher Portal"
        title="My Courses"
        description="Courses you have created. Students only see courses you publish, and only the resources that have finished processing."
        actions={
          <Link className="cq-btn cq-btn--primary" to="/courses/new">
            <Icon name="plus" size={18} /> Create Course
          </Link>
        }
      />

      <Card variant="compact" className="cq-library-filters">
        <SearchInput value={query} onChange={setQuery} label="Search courses" placeholder="Search by title, description or category…" />
        <div className="cq-library-filters__row">
          <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} label="Course status" />
          <Select
            label="Category"
            hideLabel
            value={category}
            onChange={setCategory}
            options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
        </div>
      </Card>

      {error && !courses ? (
        <Card>
          <EmptyState
            icon="alert"
            title="Courses could not be loaded"
            description={error}
            action={<Button variant="secondary" iconLeft="refresh" onClick={() => void load()}>Try again</Button>}
          />
        </Card>
      ) : !courses ? (
        <div className="cq-course-grid" aria-busy="true" aria-label="Loading courses">
          {[0, 1, 2].map((i) => <div key={i} className="cq-resource cq-resource--skeleton" />)}
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <EmptyState
            icon="course"
            title="No courses yet"
            description="Create a course, then add lecture slides, readings and recordings to it. You can also seed the demo courses from Operations."
            action={<Link className="cq-btn cq-btn--primary" to="/courses/new">Create Course</Link>}
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="search"
            title="No matching courses"
            description="Try another search, status or category."
            action={
              filtered && (
                <Button variant="secondary" onClick={() => { setQuery(''); setStatus('active'); setCategory('all'); }}>
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="cq-course-grid">
          {visible.map((c) => <CourseCard key={c.id} variant="teacher" course={c} />)}
        </div>
      )}
    </>
  );
}
