/**
 * Course helpers shared by the course and asset routes: who may manage a
 * course, and how a course is presented over the API.
 */
import { courseRepo, type Course, type JwtPayload } from '@classquest/shared';
import { ApiError } from './middleware.js';
import { storage } from './services.js';

/** Cover links last longer than resource links: they are page images, not downloads. */
const COVER_URL_SECONDS = 900;

/**
 * The course, if this staff user may manage it: admins manage every course,
 * teachers only the courses they created. Unknown course -> 404, someone
 * else's course -> 403.
 */
export async function manageableCourse(user: JwtPayload, courseId: string): Promise<Course> {
  const course = await courseRepo.findById(courseId);
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  if (user.role === 'admin') return course;
  if (user.role === 'teacher' && course.creatorId === user.sub) return course;
  throw new ApiError(403, 'FORBIDDEN', 'You can only manage your own courses');
}

/** Resources can only be added to (or moved into) a course that is not archived. */
export function assertOpenForResources(course: Course): void {
  if (course.status === 'archived') {
    throw new ApiError(409, 'COURSE_ARCHIVED', 'Archived courses cannot receive new resources; restore the course to draft first');
  }
}

/** API shape of a course: the cover is a time-limited S3 link (or null for the placeholder). */
export async function courseDto<T extends Course>(course: T) {
  const { coverKey, coverContentType: _type, ...rest } = course;
  let coverUrl: string | null = null;
  if (coverKey) {
    try {
      coverUrl = await storage.getPresignedUrl(coverKey, COVER_URL_SECONDS);
    } catch {
      coverUrl = null; // the placeholder is shown instead
    }
  }
  return { ...rest, coverUrl };
}
