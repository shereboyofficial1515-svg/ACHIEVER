-- =====================================================================
-- ACHIEVER — Supabase Storage buckets
-- Uploads are performed by the backend (service role) after it validates the
-- file's real type (magic bytes), size and the caller's authorisation.
-- Private buckets are read only through short-lived signed URLs issued by the
-- API. No storage.objects policies are granted to anon/authenticated, so the
-- browser cannot list, read or write private objects directly.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',               'avatars',               true,  2097152,  array['image/jpeg','image/png','image/webp']),
  ('group-images',          'group-images',          true,  3145728,  array['image/jpeg','image/png','image/webp']),
  ('message-attachments',   'message-attachments',   false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('verification-documents','verification-documents',false, 5242880,  array['image/jpeg','image/png','application/pdf']),
  ('receipts',              'receipts',              false, 5242880,  array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets: object paths are random UUIDs and contain no personal data
-- beyond the image itself. Reads are served via the public CDN URL.
