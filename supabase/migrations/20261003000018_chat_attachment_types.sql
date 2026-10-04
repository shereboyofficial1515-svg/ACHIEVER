-- =====================================================================
-- ACHIEVER — chat attachments: PowerPoint, plain text and phone videos
-- The API still checks every file by its content (magic bytes / UTF-8 text)
-- and the 10 MB limit; this only widens what the private bucket accepts.
-- Safe to run more than once.
-- =====================================================================
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg',
  'video/mp4','video/webm','video/quicktime',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain']
 where id = 'message-attachments';
