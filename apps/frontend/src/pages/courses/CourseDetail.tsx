import { useAuth } from '../../auth';
import { StudentCourseDetail } from './StudentCourseDetail';
import { TeacherCourseDetail } from './TeacherCourseDetail';

/** /courses/:courseId — management view for teachers, learning view for students. */
export function CourseDetail() {
  const { session } = useAuth();
  return session?.role === 'student' ? <StudentCourseDetail /> : <TeacherCourseDetail />;
}
