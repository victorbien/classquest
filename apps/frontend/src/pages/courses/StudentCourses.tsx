import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiError, type StudentCourse } from '../../api';
import { categoriesOf, filterCourses } from '../../lib/courses';
import { PageHeader } from '../../components/shell/PageHeader';
import { CourseCard } from '../../components/courses/CourseCard';
import { Button, Card, EmptyState, SearchInput, Select } from '../../components/ui';

/** Courses (student): published courses with the student's own progress. */
export function StudentCourses() {
  const [courses, setCourses] = useState<StudentCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const load = useCallback(async () => {
    try {
      setCourses((await api.listStudentCourses()).courses);
      setError(null);
    } catch (err) {
      setError((err as ApiError).message ?? 'Courses could not be loaded');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => categoriesOf(courses ?? []), [courses]);
  const visible = useMemo(() => filterCourses(courses ?? [], { query, category }), [courses, query, category]);

  return (
    <>
      <PageHeader
        eyebrow="Learning portal"
        title="Courses"
        description="Courses your teachers have published. Progress shows how many of each course's resources you have opened."
        actions={
          <div className="cq-count-chip" aria-live="polite">
            <span className="cq-count-chip__value">{courses ? courses.length : '–'}</span>
            <span className="cq-count-chip__label">{courses?.length === 1 ? 'course' : 'courses'}</span>
          </div>
        }
      />

      <Card variant="compact" className="cq-library-filters">
        <div className="cq-library-filters__row">
          <SearchInput className="cq-grow" value={query} onChange={setQuery} label="Search courses" placeholder="Search courses…" />
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
      ) : visible.length === 0 ? (
        <Card>
          {courses.length === 0 ? (
            <EmptyState icon="course" title="No courses yet" description="Courses appear here once your teachers publish them." />
          ) : (
            <EmptyState
              icon="search"
              title="No matching courses"
              description="Try another search or category."
              action={<Button variant="secondary" onClick={() => { setQuery(''); setCategory('all'); }}>Clear filters</Button>}
            />
          )}
        </Card>
      ) : (
        <div className="cq-course-grid">
          {visible.map((c) => <CourseCard key={c.id} variant="student" course={c} />)}
        </div>
      )}
    </>
  );
}
