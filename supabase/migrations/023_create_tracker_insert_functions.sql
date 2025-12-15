-- =====================================================
-- CREAR FUNCIONES PARA INSERTAR TRACKER (BYPASS RLS)
-- Estas funciones permiten inserts sin restricciones RLS
-- =====================================================

-- Función para insertar tracker report desde extensión
CREATE OR REPLACE FUNCTION public.insert_tracker_report(
  p_employee_id TEXT,
  p_report_date TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  employee_id TEXT,
  report_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con permisos del creador de la función
AS $$
DECLARE
  v_result RECORD;
BEGIN
  INSERT INTO public.tracker_reports (
    employee_id,
    report_date
  ) VALUES (
    p_employee_id,
    p_report_date
  )
  RETURNING * INTO v_result;
  
  RETURN QUERY SELECT
    v_result.id,
    v_result.employee_id,
    v_result.report_date,
    v_result.created_at;
END;
$$;

-- Función para insertar un tracker log desde extensión
CREATE OR REPLACE FUNCTION public.insert_tracker_log(
  p_report_id UUID,
  p_domain TEXT,
  p_url TEXT,
  p_title TEXT,
  p_duration_seconds INTEGER,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con permisos del creador de la función
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.tracker_logs (
    report_id,
    domain,
    url,
    title,
    duration_seconds,
    start_time,
    end_time
  ) VALUES (
    p_report_id,
    p_domain,
    p_url,
    NULLIF(p_title, ''),
    p_duration_seconds,
    p_start_time,
    NULLIF(p_end_time, '1970-01-01'::TIMESTAMPTZ)
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- Permitir que usuarios anónimos ejecuten estas funciones
GRANT EXECUTE ON FUNCTION public.insert_tracker_report TO anon;
GRANT EXECUTE ON FUNCTION public.insert_tracker_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_tracker_log TO anon;
GRANT EXECUTE ON FUNCTION public.insert_tracker_log TO authenticated;

