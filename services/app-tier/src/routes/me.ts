/**
 * Per-user views. GET /me/progress (student): which completed library
 * resources the student has opened. Access only — no grades, mastery,
 * completion or study time are recorded or implied.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { accessRepo, requireAuth, requireRole } from '@classquest/shared';

export const meRouter = Router();

meRouter.get('/progress', requireAuth, requireRole('student'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await accessRepo.progressFor(req.user!.sub));
  } catch (err) {
    next(err);
  }
});
