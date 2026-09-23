import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { UPLOAD_LIMITS } from '../config/constants.js';
import { AppError } from '../utils/AppError.js';

/**
 * Single-file upload held in memory, then validated by magic bytes (the
 * declared Content-Type and extension are never trusted).
 */
export function uploadSingle(field, limitKey) {
  const limits = UPLOAD_LIMITS[limitKey];
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxBytes, files: 1, fields: 5, fieldSize: 8 * 1024 },
  }).single(field);

  const verify = async (req, _res, next) => {
    try {
      if (!req.file) throw AppError.badRequest('Please attach a file', 'FILE_REQUIRED');
      const detected = await fileTypeFromBuffer(req.file.buffer);
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
