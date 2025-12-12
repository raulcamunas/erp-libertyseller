-- =====================================================
-- PERMITIR ACCESO PÚBLICO A REPORTES CON SLUG
-- =====================================================

-- Política para permitir lectura pública de reportes que tienen slug
-- (solo lectura, no modificación)
CREATE POLICY "Public can read commission reports with slug"
  ON public.commission_reports
  FOR SELECT
  TO anon, authenticated
  USING (slug IS NOT NULL);

-- También necesitamos permitir lectura pública de la tabla clients
-- para que se pueda mostrar el nombre del cliente en el reporte público
CREATE POLICY "Public can read clients for public reports"
  ON public.clients
  FOR SELECT
  TO anon, authenticated
  USING (true);

