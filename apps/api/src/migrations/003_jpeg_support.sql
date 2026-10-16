ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_content_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_content_type_check CHECK(content_type IN ('application/pdf','image/png','image/jpeg'));
