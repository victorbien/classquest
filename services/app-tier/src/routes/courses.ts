/**
 * Course routes. A course groups resources (assets); the asset publishing
 * pipeline itself is unchanged (POST /assets with a courseId).
 *
 *   GET    /courses                 student: published courses + own progress
 *                                   teacher: own courses · admin: all courses
 *   POST   /courses                 teacher/admin: create (draft or published)
 *   GET    /courses/:id             student: published only, completed resources
 *                                   staff: every resource with pipeline state
 *   PATCH  /courses/:id             edit title/description/category/status
 *   PUT    /courses/:id/cover       upload a cover image (multipart "cover")
 *   DELETE /courses/:id/cover       back to the placeholder cover
 *   PUT    /courses/:id/order       reorder the course's resources
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import {
  assetRepo,
  accessRepo,
  courseRepo,
  courseCreateSchema,
  courseUpdateSchema,
  courseOrderSchema,
  canTransitionCourse,
  describeIssues,
  COVER_CONTENT_TYPES,
  MAX_COVER_BYTES,
  CourseOrderError,
  createLogger,
  requireAuth,
  requireRole,
} from '@classquest/shared';
import { ApiError } from '../middleware.js';
import { storage } from '../services.js';
import { courseDto, manageableCourse } from '../courses.js';

export const coursesRouter = Router();
const log = createLogger('app-tier');

const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_COVER_BYTES } });

const ratio = (opened: number, available: number) =>
  available > 0 ? Math.round((opened / available) * 10_000) / 10_000 : 0;

/** GET /courses — the caller's course list (shape depends on role). */
coursesRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role === 'student') {
      const courses = await courseRepo.publishedFor(user.sub);
      res.json({ courses: await Promise.all(courses.map(courseDto)) });
      return;
    }
    const courses = await courseRepo.list(user.role === 'teacher' ? { creatorId: user.sub } : {});
    res.json({ courses: await Promise.all(courses.map(courseDto)) });
  } catch (err) {
    next(err);
  }
});

/** POST /courses — create a course owned by the caller. */
coursesRouter.post('/', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = courseCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', describeIssues(parsed.error));
    const course = await courseRepo.create({ ...parsed.data, creatorId: req.user!.sub });
    res.status(201).json({ course: await courseDto(course) });
  } catch (err) {
    next(err);
  }
});

/** GET /courses/:id — course page data. */
coursesRouter.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    if (user.role === 'student') {
      const course = await courseRepo.findById(req.params.id);
      // Drafts and archived courses do not exist as far as students can tell.
      if (!course || course.status !== 'published') throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
      const [resources, access] = await Promise.all([
        assetRepo.list({ courseId: course.id, studentVisible: true }),
        accessRepo.forCourse(user.sub, course.id),
      ]);
      const opened = resources.filter((a) => access[a.id]).length;
      res.json({
        course: await courseDto(course),
        resources: resources.map((a) => ({ ...a, access: access[a.id] ?? null })),
        progress: { opened, available: resources.length, coverage: ratio(opened, resources.length) },
      });
      return;
    }
    const course = await manageableCourse(user, req.params.id);
    const resources = await assetRepo.list({ courseId: course.id });
    res.json({ course: await courseDto(course), resources });
  } catch (err) {
    next(err);
  }
});

/** PATCH /courses/:id — edit details and/or change the lifecycle status. */
coursesRouter.patch('/:id', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const course = await manageableCourse(req.user!, req.params.id);
    const parsed = courseUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', describeIssues(parsed.error));
    const { status } = parsed.data;
    if (status && !canTransitionCourse(course.status, status)) {
      throw new ApiError(409, 'INVALID_TRANSITION', `A ${course.status} course cannot move to ${status}`);
    }
    const updated = await courseRepo.update(course.id, parsed.data);
    res.json({ course: await courseDto(updated!) });
  } catch (err) {
    next(err);
  }
});

/** PUT /courses/:id/cover — store a cover image in S3 (pictures/covers/). */
coursesRouter.put(
  '/:id/cover',
  requireAuth,
  requireRole('teacher', 'admin'),
  (req: Request, res: Response, next: NextFunction) => {
    coverUpload.single('cover')(req, res, (err: unknown) => {
      if (!err) return next();
      const e = err as { code?: string; message?: string };
      next(
        e.code === 'LIMIT_FILE_SIZE'
          ? new ApiError(413, 'FILE_TOO_LARGE', `Cover images are limited to ${MAX_COVER_BYTES / 1024 / 1024} MB`)
          : new ApiError(400, 'UPLOAD_ERROR', e.message ?? 'Upload failed'),
      );
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const course = await manageableCourse(req.user!, req.params.id);
      const file = req.file;
      if (!file) throw new ApiError(400, 'NO_FILE', 'A cover image is required');
      if (!COVER_CONTENT_TYPES.includes(file.mimetype)) {
        throw new ApiError(400, 'UNSUPPORTED_CONTENT_TYPE', 'Cover images must be PNG, JPEG or WebP');
      }
      const key = storage.buildCoverKey(course.id, file.originalname);
      await storage.putObject(key, file.buffer, file.mimetype);
      await courseRepo.setCover(course.id, { key, contentType: file.mimetype });
      if (course.coverKey) {
        await storage.deleteObject(course.coverKey).catch((e: Error) => log.warn({ err: e.message }, 'old cover not deleted'));
      }
      res.json({ course: await courseDto((await courseRepo.findById(course.id))!) });
    } catch (err) {
      next(err);
    }
  },
);

/** DELETE /courses/:id/cover — remove the cover; the placeholder is shown. */
coursesRouter.delete('/:id/cover', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const course = await manageableCourse(req.user!, req.params.id);
    await courseRepo.setCover(course.id, null);
    if (course.coverKey) {
      await storage.deleteObject(course.coverKey).catch((e: Error) => log.warn({ err: e.message }, 'cover not deleted'));
    }
    res.json({ course: await courseDto((await courseRepo.findById(course.id))!) });
  } catch (err) {
    next(err);
  }
});

/** PUT /courses/:id/order — `assetIds` lists every resource of the course in its new order. */
coursesRouter.put('/:id/order', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const course = await manageableCourse(req.user!, req.params.id);
    const parsed = courseOrderSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', describeIssues(parsed.error));
    try {
      await courseRepo.reorder(course.id, parsed.data.assetIds);
    } catch (err) {
      if (err instanceof CourseOrderError) throw new ApiError(400, 'VALIDATION_ERROR', err.message);
      throw err;
    }
    res.json({ resources: await assetRepo.list({ courseId: course.id }) });
  } catch (err) {
    next(err);
  }
});
