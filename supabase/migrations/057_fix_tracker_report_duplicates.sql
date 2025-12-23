-- =====================================================
-- FIX: EVITAR REPORTES DUPLICADOS EN TRACKER
-- =====================================================

-- Modificar la función para buscar un reporte existente en la misma hora
-- antes de crear uno nuevo
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
SECURITY DEFINER
AS $$
DECLARE
  v_result RECORD;
  v_existing_report_id UUID;
  v_hour_start TIMESTAMPTZ;
BEGIN
  -- Redondear la fecha a la hora (eliminar minutos y segundos)
  v_hour_start := date_trunc('hour', p_report_date);
  
  -- Buscar si ya existe un reporte para este empleado en esta hora
  SELECT id INTO v_existing_report_id
  FROM public.tracker_reports
  WHERE employee_id = p_employee_id
    AND date_trunc('hour', report_date) = v_hour_start
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Si existe, retornar el existente
  IF v_existing_report_id IS NOT NULL THEN
    SELECT * INTO v_result
    FROM public.tracker_reports
    WHERE id = v_existing_report_id;
    
    RETURN QUERY SELECT
      v_result.id,
      v_result.employee_id,
      v_result.report_date,
      v_result.created_at;
    RETURN;
  END IF;
  
  -- Si no existe, crear uno nuevo con la hora redondeada
  INSERT INTO public.tracker_reports (
    employee_id,
    report_date
  ) VALUES (
    p_employee_id,
    v_hour_start
  )
  RETURNING * INTO v_result;
  
  RETURN QUERY SELECT
    v_result.id,
    v_result.employee_id,
    v_result.report_date,
    v_result.created_at;
END;
$$;

