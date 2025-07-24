import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const UPLOADS_ROOT = path.resolve(__dirname, '../../../uploads');

async function ensureAssignmentDir(assignmentId: string) {
  const dir = path.join(UPLOADS_ROOT, assignmentId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function saveImage(buffer: Buffer, ext: string, assignmentId: string) {
  const dir = await ensureAssignmentDir(assignmentId);
  const filename = `${uuidv4()}.${ext.replace(/^\./, '')}`;
  const fullPath = path.join(dir, filename);
  await writeFile(fullPath, buffer);
  return { filename, fullPath };
}

export function getFileStream(filename: string, assignmentId: string) {
  const filePath = path.join(UPLOADS_ROOT, assignmentId, filename);
  return fs.createReadStream(filePath);
}

export async function deleteFile(filename: string, assignmentId: string) {
  const filePath = path.join(UPLOADS_ROOT, assignmentId, filename);
  await unlink(filePath);
} 