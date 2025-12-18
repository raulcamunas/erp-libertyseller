-- =====================================================
-- TABLA DE DOCUMENTOS DE CLIENTES
-- =====================================================

-- Crear tabla para documentos de clientes
CREATE TABLE IF NOT EXISTS public.client_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  doc_name TEXT NOT NULL,
  category TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  last_edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_edited_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden ver documentos de clientes accesibles
CREATE POLICY "Users can view documents of accessible clients"
  ON public.client_documents
  FOR SELECT
  USING (
    -- Es creador del cliente
    public.is_user_client_creator(client_documents.client_id, auth.uid())
    -- O es miembro del cliente
    OR public.is_user_client_member(client_documents.client_id, auth.uid())
    -- O es admin
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los usuarios pueden crear documentos en clientes accesibles
CREATE POLICY "Users can create documents in accessible clients"
  ON public.client_documents
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_documents.client_id
      AND (
        public.is_user_client_creator(client_documents.client_id, auth.uid())
        OR public.is_user_client_member(client_documents.client_id, auth.uid())
        OR public.get_user_role_safe(auth.uid()) = 'admin'
      )
    )
    AND created_by = auth.uid()
  );

-- Política: Los usuarios pueden actualizar documentos de clientes accesibles
CREATE POLICY "Users can update documents in accessible clients"
  ON public.client_documents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_documents.client_id
      AND (
        public.is_user_client_creator(client_documents.client_id, auth.uid())
        OR public.is_user_client_member(client_documents.client_id, auth.uid())
        OR public.get_user_role_safe(auth.uid()) = 'admin'
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_documents.client_id
      AND (
        public.is_user_client_creator(client_documents.client_id, auth.uid())
        OR public.is_user_client_member(client_documents.client_id, auth.uid())
        OR public.get_user_role_safe(auth.uid()) = 'admin'
      )
    )
  );

-- Política: Los usuarios pueden eliminar documentos de clientes accesibles
CREATE POLICY "Users can delete documents in accessible clients"
  ON public.client_documents
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.client_canvas
      WHERE client_canvas.id = client_documents.client_id
      AND (
        public.is_user_client_creator(client_documents.client_id, auth.uid())
        OR public.is_user_client_member(client_documents.client_id, auth.uid())
        OR public.get_user_role_safe(auth.uid()) = 'admin'
      )
    )
  );

-- Trigger para actualizar updated_at
CREATE TRIGGER update_client_documents_updated_at
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para actualizar last_edited_by y last_edited_at al editar
CREATE OR REPLACE FUNCTION public.update_document_editor()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_edited_by = auth.uid();
  NEW.last_edited_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_document_editor_trigger
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW
  WHEN (OLD.doc_name IS DISTINCT FROM NEW.doc_name OR OLD.category IS DISTINCT FROM NEW.category)
  EXECUTE FUNCTION public.update_document_editor();

