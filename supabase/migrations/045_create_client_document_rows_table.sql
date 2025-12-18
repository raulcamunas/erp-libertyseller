-- =====================================================
-- TABLA DE FILAS DE DOCUMENTOS DE CLIENTES (ESTILO NOTION/EXCEL)
-- =====================================================

-- Crear tabla para filas de documentos
CREATE TABLE IF NOT EXISTS public.client_document_rows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  motivo TEXT,
  asin TEXT,
  producto TEXT,
  informacion_a_rellenar TEXT,
  pdf_para_subir JSONB DEFAULT '[]'::jsonb, -- Array de objetos con {url, name, type}
  idioma_pdf TEXT,
  position INTEGER DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.client_document_rows ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden ver filas de documentos de clientes accesibles
CREATE POLICY "Users can view document rows of accessible clients"
  ON public.client_document_rows
  FOR SELECT
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los usuarios pueden crear filas en clientes accesibles
CREATE POLICY "Users can create document rows in accessible clients"
  ON public.client_document_rows
  FOR INSERT
  WITH CHECK (
    (
      public.is_user_client_creator(client_id, auth.uid())
      OR public.is_user_client_member(client_id, auth.uid())
      OR public.get_user_role_safe(auth.uid()) = 'admin'
    )
    AND created_by = auth.uid()
  );

-- Política: Los usuarios pueden actualizar filas en clientes accesibles
CREATE POLICY "Users can update document rows in accessible clients"
  ON public.client_document_rows
  FOR UPDATE
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  )
  WITH CHECK (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los usuarios pueden eliminar filas en clientes accesibles
CREATE POLICY "Users can delete document rows in accessible clients"
  ON public.client_document_rows
  FOR DELETE
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Trigger para actualizar updated_at
CREATE TRIGGER update_client_document_rows_updated_at
  BEFORE UPDATE ON public.client_document_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Crear bucket de storage para documentos de clientes si no existe
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-documents',
  'client-documents',
  true,
  52428800, -- 50MB
  ARRAY['image/*', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Política de storage: Los usuarios autenticados pueden subir archivos
CREATE POLICY "Authenticated users can upload client documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'client-documents');

-- Política de storage: Los usuarios autenticados pueden leer archivos
CREATE POLICY "Authenticated users can read client documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'client-documents');

-- Política de storage: Los usuarios autenticados pueden eliminar archivos
CREATE POLICY "Authenticated users can delete client documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'client-documents');

