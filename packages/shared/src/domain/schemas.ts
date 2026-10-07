/**
 * Input validation schemas (zod). Every external input is validated before
 * use (report 13 error handling, 12.4 security validation).
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const assetTypeSchema = z.enum(['document', 'book', 'video']);

/** Optional short label: blank input means "no label". */
const optionalLabel = z
  .string()
  .trim()
  .max(80)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Multipart text fields accompanying an upload (the file is validated separately). */
export const assetUploadSchema = z.object({
  title: z.string().min(1).max(200),
  type: assetTypeSchema,
  /** The course the resource is published into (required). */
  courseId: z.string().uuid(),
  description: z.string().trim().max(2000).optional().default(''),
  sectionLabel: optionalLabel,
  /** Multipart sends strings; blank means "append to the end of the course". */
  displayOrder: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
    .pipe(z.number().int().min(0).max(100_000).optional()),
  isDemo: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
export type AssetUploadInput = z.infer<typeof assetUploadSchema>;

/** Allowed MIME types per asset type (file type allow-list, report 13). */
export const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
  document: ['application/pdf', 'text/plain', 'application/msword', 'text/markdown'],
  book: ['application/pdf', 'application/epub+zip'],
  video: ['video/mp4', 'video/webm', 'application/octet-stream'],
};

export function isContentTypeAllowed(type: string, contentType: string): boolean {
  const allowed = ALLOWED_CONTENT_TYPES[type];
  return allowed ? allowed.includes(contentType) : false;
}

// ---------- courses ----------
export const courseStatusSchema = z.enum(['draft', 'published', 'archived']);

const courseFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  category: z.string().trim().min(1).max(80),
};

/** POST /courses. A new course starts as draft or published, never archived. */
export const courseCreateSchema = z
  .object({
    ...courseFields,
    description: courseFields.description.optional().default(''),
    status: z.enum(['draft', 'published']).optional().default('draft'),
  })
  .strict();
export type CourseCreateInput = z.infer<typeof courseCreateSchema>;

/** PATCH /courses/:id — any subset of the editable fields. */
export const courseUpdateSchema = z
  .object({ ...courseFields, status: courseStatusSchema })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type CourseUpdateInput = z.infer<typeof courseUpdateSchema>;

/** PATCH /assets/:id — resource details within (or between) courses. */
export const assetUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000),
    sectionLabel: optionalLabel,
    displayOrder: z.number().int().min(0).max(100_000),
    courseId: z.string().uuid(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type AssetUpdateInput = z.infer<typeof assetUpdateSchema>;

/** PUT /courses/:id/order — every resource id of the course, in the new order. */
export const courseOrderSchema = z
  .object({ assetIds: z.array(z.string().uuid()).min(1).max(500) })
  .strict();

/** Course cover images (optional). */
export const COVER_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** Readable one-line summary of a zod error for API responses. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}
