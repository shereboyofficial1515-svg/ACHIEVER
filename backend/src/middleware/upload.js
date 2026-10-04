import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { UPLOAD_LIMITS } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';

/**
 * Single-file upload held in memory, then validated by magic bytes (the
 * declared Content-Type and extension are never trusted).
 */
/**
 * Plain text has no magic bytes: accept a .txt file only when it is valid UTF-8 with no
 * control characters (so a renamed binary or script cannot pass as text).
 */
export function plainText(file, limits) {
  if (!limits.mimes.includes('text/plain') || !/\.txt$/i.test(file.originalname || '')) return null;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(file.buffer);
  if (text.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return null;
  return { mime: 'text/plain', ext: 'txt' };
}

export function uploadSingle(field, limitKey) {
  const limits = UPLOAD_LIMITS[limitKey];
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxBytes, files: 1, fields: 5, fieldSize: 8 * 1024 },
  }).single(field);

  const verify = async (req, _res, next) => {
    try {
      if (!req.file) throw AppError.badRequest('Please attach a file', 'FILE_REQUIRED');
      const detected = (await fileTypeFromBuffer(req.file.buffer)) || plainText(req.file, limits);
      if (!detected || !limits.mimes.includes(detected.mime)) {
        throw AppError.unprocessable(`Unsupported file type. Allowed: ${limits.mimes.join(', ')}`, 'FILE_TYPE_NOT_ALLOWED');
      }
      req.file.detectedMime = detected.mime;
      req.file.detectedExt = detected.ext;
      next();
    } catch (err) {
      next(err);
    }
  };
  return [parser, verify];
}
