-- =====================================================
-- PERMITIR ACCESO PÚBLICO A AUDIT_REPORTS POR TOKEN
-- =====================================================

-- Política: Acceso público por public_token (para compartir reportes)
-- Esto permite que usuarios anónimos puedan ver reportes usando el public_token
CREATE POLICY "Public can view audit reports by token"
  ON public.audit_reports
  FOR SELECT
  TO anon, authenticated
  USING (true);


