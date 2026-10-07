/** Job status route (report 3.7, FR-5): poll a processing job's state (teacher/admin). */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { jobRepo, requireAuth, requireRole } from '@classquest/shared';
import { ApiError } from '../middleware.js';

export const jobsRouter = Router();

jobsRouter.get('/:id', requireAuth, requireRole('teacher', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await jobRepo.findById(req.params.id);
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    res.json({
      id: job.id,
      state: job.state,
      attempts: job.attempts,
      error: job.lastError,
      submittedAt: job.submittedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
  } catch (err) {
    next(err);
  }
});
