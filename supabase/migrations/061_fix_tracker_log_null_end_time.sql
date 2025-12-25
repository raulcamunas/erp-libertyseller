-- =====================================================
-- FIX: PERMITIR NULL EN p_end_time EN insert_tracker_log
-- =====================================================

-- Actualizar la función para aceptar p_end_time como NULL
CREATE OR REPLACE FUNCTION public.insert_tracker_log(
  p_report_id UUID,
  p_domain TEXT,
  p_url TEXT,
  p_title TEXT,
  p_duration_seconds INTEGER,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ DEFAULT NULL
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
    CASE 
      WHEN p_end_time IS NULL THEN NULL
      WHEN p_end_time = '1970-01-01'::TIMESTAMPTZ THEN NULL
      ELSE p_end_time
    END
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- Permitir que usuarios anónimos ejecuten esta función
GRANT EXECUTE ON FUNCTION public.insert_tracker_log TO anon;
GRANT EXECUTE ON FUNCTION public.insert_tracker_log TO authenticated;

