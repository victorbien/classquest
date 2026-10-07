/**
 * Asset routes — the primary end-to-end workflow (report 3.7, FR-2/3/4/5/7).
 *
 *   POST  /assets  (teacher)  -> S3 putObject + MySQL insert + SQS enqueue,
 *                                into a course the teacher manages
 *   GET   /assets             -> list assets (students: completed resources
 *                                of published courses only)
 *   GET   /assets/:id         -> metadata + presigned download URL
 *                                (students: same visibility rule)
 *   PATCH /assets/:id         -> edit title/description/section/order, or
 *                                move to another course (teacher/admin)
 *   GET   /assets/:id/job     -> processing status (teacher/admin)
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import {
  assetUploadSchema,
  assetUpdateSchema,
  assetTypeSchema,
  describeIssues,
  courseRepo,
  isContentTypeAllowed,
  assetRepo,
  accessRepo,
  createLogger,
  requireAuth,
  requireRole,
  type Asset,
  type AssetType,
  type JwtPayload,
} from '@classquest/shared';
import { ApiError } from '../middleware.js';
import { storage, metrics, config } from '../services.js';
import { publishAsset } from '../publish.js';
import { assertOpenForResources, manageableCourse } from '../courses.js';

export const assetsRouter = Router();
const log = createLogger('app-tier');

/**
 * Students may only see resources that finished processing AND belong to a
 * published course (drafts and archived courses stay hidden).
 */
function visibleTo(user: JwtPayload | undefined, asset: Asset): boolean {
  return user?.role !== 'student' || (asset.status === 'completed' && asset.courseStatus === 'published');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

/** POST /assets — teacher uploads and publishes a learning asset. */
assetsRouter.post(
  '/',
  requireAuth,
  requireRole('teacher', 'admin'),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const anyErr = err as { code?: string; message?: string };
        if (anyErr.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(413, 'FILE_TOO_LARGE', 'Uploaded file exceeds the size limit'));
        }
        return next(new ApiError(400, 'UPLOAD_ERROR', anyErr.message ?? 'Upload failed'));
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = assetUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, 'VALIDATION_ERROR', describeIssues(parsed.error));
      }
      const file = req.file;
      if (!file) {
        throw new ApiError(400, 'NO_FILE', 'A file is required');
      }
      const { title, type, isDemo, courseId, description, sectionLabel, displayOrder } = parsed.data;
      const course = await manageableCourse(req.user!, courseId);
      assertOpenForResources(course);

      // File type allow-list (report 13).
      if (!isContentTypeAllowed(type, file.mimetype)) {
        throw new ApiError(
          400,
          'UNSUPPORTED_CONTENT_TYPE',
          `Content type ${file.mimetype} is not allowed for ${type}`,
        );
      }

      const { asset, jobId } = await publishAsset({
        ownerId: req.user!.sub,
        courseId: course.id,
        title,
        description,
        sectionLabel,
        displayOrder,
        type: type as AssetType,
        body: file.buffer,
        contentType: file.mimetype,
        originalName: file.originalname,
        isDemo,
      });
      void metrics.incrementCounter('AssetsSubmitted');

      res.status(202).json({ assetId: asset.id, jobId, status: asset.status, courseId: course.id });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /assets — list assets (optionally filtered by type). */
assetsRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const typeParam = req.query.type;
    const filter: { type?: AssetType; status?: 'completed'; studentVisible?: boolean } = {};
    if (typeof typeParam === 'string') {
      const t = assetTypeSchema.safeParse(typeParam);
      if (!t.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid type filter');
      filter.type = t.data;
    }
    if (req.user?.role === 'student') {
      filter.status = 'completed';
      filter.studentVisible = true;
    }
    const assets = await assetRepo.list(filter);
    res.json({ assets });
  } catch (err) {
    next(err);
  }
});

/** GET /assets/:id — metadata plus a presigned download URL (report 4.9.6). */
assetsRouter.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await assetRepo.findById(req.params.id);
    // Unpublished assets are reported as not found to students (no presigned
    // URL, and no confirmation that the asset exists).
    if (!asset || !visibleTo(req.user, asset)) throw new ApiError(404, 'NOT_FOUND', 'Asset not found');
    // Report the live S3 tier (STANDARD vs GLACIER) for the UI (report 5.4.4).
    let currentTier = asset.storageClass;
    try {
      currentTier = await storage.headObjectTier(asset.s3Key);
    } catch {
      /* object may not exist yet in rare races; fall back to stored value */
    }
    const downloadUrl = await storage.getPresignedUrl(asset.s3Key);
    // Student opens feed My Progress. Recorded only after the presigned URL
    // was issued (students can only reach here for completed assets).
    // Best-effort: a tracking failure must not block access.
    if (req.user?.role === 'student') {
      await accessRepo
        .recordOpen(req.user.sub, asset.id)
        .catch((err: Error) => log.warn({ assetId: asset.id, err: err.message }, 'resource access not recorded'));
    }
    res.json({ asset: { ...asset, storageClass: currentTier }, downloadUrl });
  } catch (err) {
    next(err);
  }
});

/** PATCH /assets/:id — edit a resource's course-page details (teacher/admin). */
assetsRouter.patch('/:id', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await assetRepo.findById(req.params.id);
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Asset not found');
    await manageableCourse(req.user!, asset.courseId);
    const parsed = assetUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', describeIssues(parsed.error));
    const fields = { ...parsed.data };
    if (fields.courseId && fields.courseId !== asset.courseId) {
      // Moving: the caller must manage the target course too, and it must be open.
      assertOpenForResources(await manageableCourse(req.user!, fields.courseId));
      fields.displayOrder ??= await courseRepo.nextDisplayOrder(fields.courseId);
    }
    res.json({ asset: await assetRepo.update(asset.id, fields) });
  } catch (err) {
    next(err);
  }
});

/** GET /assets/:id/job — current job state for this asset's processing. */
assetsRouter.get('/:id/job', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await assetRepo.findById(req.params.id);
    if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Asset not found');
    res.json({ status: asset.status });
  } catch (err) {
    next(err);
  }
});
