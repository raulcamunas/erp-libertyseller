-- =====================================================
-- CORREGIR POLÍTICA RLS PARA WEB_LEADS
-- Asegurar que los inserts públicos funcionen correctamente
-- =====================================================

-- Eliminar política existente si existe
DROP POLICY IF EXISTS "Public can insert web_leads" ON public.web_leads;

-- Crear política más específica para inserts públicos
CREATE POLICY "Public can insert web_leads"
  ON public.web_leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- También permitir inserts para usuarios autenticados
CREATE POLICY "Authenticated users can insert web_leads"
  ON public.web_leads
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

