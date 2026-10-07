import type { CourseStatus } from '../../api';
import { COURSE_STATUS_TONE, STATUS_LABEL } from '../../lib/courses';
import { Badge } from '../ui';

export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  return <Badge tone={COURSE_STATUS_TONE[status]} upper>{STATUS_LABEL[status]}</Badge>;
}
