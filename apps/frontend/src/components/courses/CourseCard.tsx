import { Link } from 'react-router-dom';
import type { StaffCourse, StudentCourse } from '../../api';
import { percentLabel } from '../../lib/courses';
import { cleanName, formatRelative } from '../../lib/progress';
import { Badge, Icon, ProgressBar } from '../ui';
import { CourseCover } from './CourseCover';
import { CourseStatusBadge } from './CourseStatusBadge';

type CourseCardProps =
  | { variant: 'teacher'; course: StaffCourse }
  | { variant: 'student'; course: StudentCourse };

/**
 * Course card for My Courses (teacher: status + resource counts) and Courses
 * (student: teacher + own progress). The whole card links to the course.
 */
export function CourseCard(props: CourseCardProps) {
  const { course } = props;
  return (
    <article className="cq-course-card">
      <CourseCover title={course.title} category={course.category} coverUrl={course.coverUrl} />
      <div className="cq-course-card__body">
        <div className="cq-resource__tags">
          {props.variant === 'teacher' && <CourseStatusBadge status={props.course.status} />}
          {course.isDemo && <Badge tone="warning" upper>Demo</Badge>}
        </div>
        <h3 className="cq-course-card__title">
          <Link to={`/courses/${course.id}`} className="cq-course-card__link">{course.title}</Link>
        </h3>
        {course.description && <p className="cq-course-card__desc">{course.description}</p>}

        {props.variant === 'teacher' ? (
          <p className="cq-course-card__meta">
            <span><Icon name="layers" size={14} /> {props.course.resourceCount} {props.course.resourceCount === 1 ? 'resource' : 'resources'}</span>
            <span>{props.course.completedCount} ready</span>
            <span>Updated {formatRelative(course.updatedAt)}</span>
          </p>
        ) : (
          <>
            <p className="cq-course-card__meta">
              <span><Icon name="user" size={14} /> {cleanName(course.creatorName)}</span>
              <span><Icon name="layers" size={14} /> {props.course.available} {props.course.available === 1 ? 'resource' : 'resources'}</span>
            </p>
            <div className="cq-course-card__progress">
              <div className="cq-course-card__progress-head">
                <span>{props.course.opened} / {props.course.available} opened</span>
                <strong>{percentLabel(props.course.coverage)}</strong>
              </div>
              <ProgressBar value={props.course.coverage * 100} label={`${course.title}: resources opened`} />
            </div>
          </>
        )}
      </div>
    </article>
  );
}
