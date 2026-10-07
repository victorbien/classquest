import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  assetUploadSchema,
  isContentTypeAllowed,
} from '../../packages/shared/src/domain/schemas.js';
import { ASSET_PREFIX } from '../../packages/shared/src/domain/types.js';

describe('validation schemas (report 13 / 12.4)', () => {
  describe('loginSchema', () => {
    it('accepts a valid credential pair', () => {
      const r = loginSchema.safeParse({ email: 'a@b.com', password: 'secret' });
      expect(r.success).toBe(true);
    });
    it('rejects a malformed email', () => {
      expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    });
    it('rejects an empty password', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
    });
  });

  describe('assetUploadSchema', () => {
    // Every upload names its course; each case below differs only in the field under test.
    const courseId = '11111111-1111-4111-8111-111111111111';
    it('accepts valid metadata and coerces isDemo', () => {
      const r = assetUploadSchema.safeParse({ title: 'T', type: 'document', courseId, isDemo: 'true' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.isDemo).toBe(true);
    });
    it('rejects an unknown asset type', () => {
      expect(assetUploadSchema.safeParse({ title: 'T', type: 'spreadsheet', courseId }).success).toBe(false);
    });
    it('rejects an empty title', () => {
      expect(assetUploadSchema.safeParse({ title: '', type: 'video', courseId }).success).toBe(false);
    });
  });

  describe('isContentTypeAllowed (file allow-list)', () => {
    it('allows PDF for documents and books', () => {
      expect(isContentTypeAllowed('document', 'application/pdf')).toBe(true);
      expect(isContentTypeAllowed('book', 'application/pdf')).toBe(true);
    });
    it('allows mp4 for video', () => {
      expect(isContentTypeAllowed('video', 'video/mp4')).toBe(true);
    });
    it('blocks disallowed types', () => {
      expect(isContentTypeAllowed('document', 'application/x-msdownload')).toBe(false);
      expect(isContentTypeAllowed('video', 'text/plain')).toBe(false);
    });
  });

  describe('ASSET_PREFIX (report 5.4.2)', () => {
    it('maps asset types to S3 key prefixes', () => {
      expect(ASSET_PREFIX.document).toBe('documents');
      expect(ASSET_PREFIX.book).toBe('documents');
      expect(ASSET_PREFIX.video).toBe('videos');
    });
  });
});

describe('course schemas and lifecycle', async () => {
  const { courseCreateSchema, courseUpdateSchema, assetUploadSchema, assetUpdateSchema, canTransitionCourse } = await import(
    '../../packages/shared/src/index.js'
  );
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('course create defaults to draft and trims fields', () => {
    expect(courseCreateSchema.parse({ title: '  Cloud  ', category: ' CS ' })).toEqual({ title: 'Cloud', category: 'CS', description: '', status: 'draft' });
    expect(courseCreateSchema.safeParse({ title: 'x', category: 'y', status: 'archived' }).success).toBe(false);
    expect(courseCreateSchema.safeParse({ title: '', category: 'y' }).success).toBe(false);
  });

  it('course update needs at least one known field', () => {
    expect(courseUpdateSchema.safeParse({}).success).toBe(false);
    expect(courseUpdateSchema.safeParse({ status: 'archived' }).success).toBe(true);
    expect(courseUpdateSchema.safeParse({ creatorId: 'x' }).success).toBe(false);
  });

  it('uploads require a course id; optional section and order are parsed from multipart strings', () => {
    expect(assetUploadSchema.safeParse({ title: 't', type: 'document' }).success).toBe(false);
    expect(assetUploadSchema.parse({ title: 't', type: 'document', courseId: uuid, sectionLabel: ' Week 1 ', displayOrder: '3' })).toMatchObject({
      courseId: uuid, sectionLabel: 'Week 1', displayOrder: 3, description: '',
    });
    expect(assetUploadSchema.parse({ title: 't', type: 'document', courseId: uuid, sectionLabel: '', displayOrder: '' })).toMatchObject({
      sectionLabel: null, displayOrder: undefined,
    });
    expect(assetUploadSchema.safeParse({ title: 't', type: 'document', courseId: uuid, displayOrder: '-1' }).success).toBe(false);
  });

  it('resource edits accept a null section label', () => {
    expect(assetUpdateSchema.parse({ sectionLabel: null })).toEqual({ sectionLabel: null });
    expect(assetUpdateSchema.safeParse({ courseId: 'not-a-uuid' }).success).toBe(false);
  });

  it('course lifecycle: archived can only be restored to draft', () => {
    expect(canTransitionCourse('draft', 'published')).toBe(true);
    expect(canTransitionCourse('published', 'draft')).toBe(true);
    expect(canTransitionCourse('published', 'archived')).toBe(true);
    expect(canTransitionCourse('archived', 'draft')).toBe(true);
    expect(canTransitionCourse('archived', 'published')).toBe(false);
  });
});
