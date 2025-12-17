-- =====================================================
-- CORREGIR POLÍTICAS RLS PARA TRACKER
-- Permitir inserciones anónimas desde la extensión
-- =====================================================

-- Eliminar políticas de INSERT existentes
DROP POLICY IF EXISTS "Allow tracker reports insert" ON public.tracker_reports;
DROP POLICY IF EXISTS "Allow tracker logs insert" ON public.tracker_logs;

-- Crear políticas para inserts anónimos (extensión de Chrome)
CREATE POLICY "anon_insert_tracker_reports"
  ON public.tracker_reports
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Crear políticas para inserts de usuarios autenticados
CREATE POLICY "authenticated_insert_tracker_reports"
  ON public.tracker_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Crear políticas para inserts anónimos de logs
CREATE POLICY "anon_insert_tracker_logs"
  ON public.tracker_logs
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Crear políticas para inserts de usuarios autenticados de logs
CREATE POLICY "authenticated_insert_tracker_logs"
  ON public.tracker_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);


