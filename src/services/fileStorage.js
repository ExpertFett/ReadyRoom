/**
 * Document file storage on the local filesystem.
 *
 * Files live under a per-wing subdirectory of UPLOADS_ROOT, named after the
 * document ID with the original filename suffixed for human navigability:
 *
 *   <UPLOADS_ROOT>/<wing_id>/<doc_id>__<original_name>
 *
 * Resolution order (same precedence as the SQLite DB path):
 *   1. UPLOADS_ROOT env var (explicit override)
 *   2. $RAILWAY_VOLUME_MOUNT_PATH/uploads  — auto on Railway
 *   3. ./data/uploads                       — local dev
 *
 * The volume mount on Railway ensures uploads survive deploys (same lesson
 * as the SQLite DB persistence work earlier in the day).
 */

import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const volumeMount = (process.env.RAILWAY_VOLUME_MOUNT_PATH
  || process.env.RAILWAY_PERSISTENT_VOLUME_PATH
  || '').replace(/\/$/, '');
const UPLOADS_ROOT = process.env.UPLOADS_ROOT
  || (volumeMount ? `${volumeMount}/uploads` : './data/uploads');

mkdirSync(UPLOADS_ROOT, { recursive: true });
console.log(`[files] uploads at ${UPLOADS_ROOT}`);

// Sanitize a filename for filesystem safety. Keeps the original extension.
function safeName(name) {
  const cleaned = String(name || 'file')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .slice(0, 120);
  return cleaned || 'file';
}

/**
 * Write the given buffer to the document's slot. Replaces any existing file.
 * Returns the relative path (stored in documents.file_path).
 */
export function saveDocFile(wingId, docId, originalName, buffer) {
  const rel = `${wingId}/${docId}__${safeName(originalName)}`;
  const abs = join(UPLOADS_ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  return rel;
}

/**
 * Read a stored file. Returns { buffer, size } or null if missing.
 */
export function readDocFile(relativePath) {
  if (!relativePath) return null;
  const abs = join(UPLOADS_ROOT, relativePath);
  if (!existsSync(abs)) return null;
  return { buffer: readFileSync(abs), size: statSync(abs).size };
}

/**
 * Best-effort delete. Silently no-ops if the file is already gone.
 */
export function deleteDocFile(relativePath) {
  if (!relativePath) return false;
  const abs = join(UPLOADS_ROOT, relativePath);
  if (!existsSync(abs)) return false;
  try { unlinkSync(abs); return true; } catch { return false; }
}

export const MAX_DOC_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
