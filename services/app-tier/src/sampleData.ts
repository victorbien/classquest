/**
 * Loads the synthetic sample dataset (sample-data/) for demo mode.
 * All records are flagged is_demo = true (brief §8, §18).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve sample-data whether running from source (tsx) or compiled (dist).
function sampleRoot(): string {
  const candidates = [
    path.resolve(__dirname, '../../../sample-data'), // dist: services/app-tier/dist/.. -> repo root
    path.resolve(__dirname, '../../../../sample-data'),
    path.resolve(process.cwd(), 'sample-data'),
    '/app/sample-data',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // default to the first; callers handle missing files gracefully
  return candidates[0];
}

export interface SampleUser {
  email: string;
  password: string;
  role: 'student' | 'teacher' | 'admin';
  displayName: string;
}

export interface SampleCourse {
  title: string;
  description: string;
  category: string;
  status: 'draft' | 'published';
}

/** One sample resource; `course` is the title of an entry in courses.json. */
export interface SampleCatalogEntry {
  course: string;
  order: number;
  section: string | null;
  title: string;
  description: string;
  type: 'document' | 'book' | 'video';
  contentType: string;
  filename: string;
}

export async function loadSampleUsers(): Promise<SampleUser[]> {
  const file = path.join(sampleRoot(), 'users.json');
  return JSON.parse(await readFile(file, 'utf8')) as SampleUser[];
}

export async function loadSampleCourses(): Promise<SampleCourse[]> {
  const file = path.join(sampleRoot(), 'courses.json');
  return JSON.parse(await readFile(file, 'utf8')) as SampleCourse[];
}

export async function loadSampleCatalog(): Promise<SampleCatalogEntry[]> {
  const file = path.join(sampleRoot(), 'catalog.json');
  return JSON.parse(await readFile(file, 'utf8')) as SampleCatalogEntry[];
}

export async function loadSampleAsset(filename: string): Promise<Buffer> {
  const file = path.join(sampleRoot(), 'assets', filename);
  return readFile(file);
}
