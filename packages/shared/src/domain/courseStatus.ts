/**
 * Course lifecycle rules (draft -> published -> archived). Kept small on
 * purpose: a course can be published, returned to draft, archived, and an
 * archived course can be restored to draft (never straight to published).
 */
import type { CourseStatus } from './types.js';

export const COURSE_TRANSITIONS: Record<CourseStatus, readonly CourseStatus[]> = {
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
};

export function canTransitionCourse(from: CourseStatus, to: CourseStatus): boolean {
  return from === to || COURSE_TRANSITIONS[from].includes(to);
}
