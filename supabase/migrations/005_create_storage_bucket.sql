-- =====================================================
-- STORAGE BUCKET PARA ARCHIVOS DE FINANZAS
-- =====================================================

-- Crear el bucket para archivos adjuntos de finanzas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-attachments',
  'finance-attachments',
  true,
  52428800, -- 50MB
  ARRAY['image/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

-- Política: Usuarios autenticados pueden subir archivos
CREATE POLICY "Authenticated users can upload finance attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'finance-attachments');

-- Política: Usuarios autenticados pueden leer archivos
CREATE POLICY "Authenticated users can read finance attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'finance-attachments');

-- Política: Usuarios autenticados pueden eliminar archivos
CREATE POLICY "Authenticated users can delete finance attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'finance-attachments');

