import { useAuth } from '../../auth';
import { StudentCourses } from './StudentCourses';
import { TeacherCourses } from './TeacherCourses';

/** /courses — "My Courses" for teachers, published "Courses" for students. */
export function Courses() {
  const { session } = useAuth();
  return session?.role === 'student' ? <StudentCourses /> : <TeacherCourses />;
}
