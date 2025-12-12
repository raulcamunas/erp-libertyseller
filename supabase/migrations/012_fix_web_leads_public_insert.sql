-- =====================================================
-- CORREGIR POLÍTICA RLS PARA WEB_LEADS
-- Asegurar que los inserts públicos funcionen correctamente
-- =====================================================

-- Eliminar TODAS las políticas de INSERT existentes
DROP POLICY IF EXISTS "Public can insert web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "Authenticated users can insert web_leads" ON public.web_leads;

-- Crear política para inserts anónimos (webhooks públicos)
CREATE POLICY "anon_can_insert_web_leads"
  ON public.web_leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Crear política para inserts de usuarios autenticados
CREATE POLICY "authenticated_can_insert_web_leads"
  ON public.web_leads
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

