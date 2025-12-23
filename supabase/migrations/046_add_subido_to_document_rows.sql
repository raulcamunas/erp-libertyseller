-- =====================================================
-- AÑADIR CAMPO "subido" A client_document_rows
-- =====================================================

-- Añadir columna subido (boolean) a client_document_rows
ALTER TABLE public.client_document_rows
ADD COLUMN IF NOT EXISTS subido BOOLEAN DEFAULT false;

-- Crear índice para búsquedas rápidas por estado de subido
CREATE INDEX IF NOT EXISTS idx_client_document_rows_subido 
ON public.client_document_rows(subido);



