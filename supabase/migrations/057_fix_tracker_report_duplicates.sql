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
  v_result_id UUID;
  v_result_employee_id TEXT;
  v_result_report_date TIMESTAMPTZ;
  v_result_created_at TIMESTAMPTZ;
  v_existing_report_id UUID;
  v_hour_start TIMESTAMPTZ;
BEGIN
  -- Redondear la fecha a la hora (eliminar minutos y segundos)
  v_hour_start := date_trunc('hour', p_report_date);
  
  -- Buscar si ya existe un reporte para este empleado en esta hora
  SELECT tr.id INTO v_existing_report_id
  FROM public.tracker_reports tr
  WHERE tr.employee_id = p_employee_id
    AND date_trunc('hour', tr.report_date) = v_hour_start
  ORDER BY tr.created_at DESC
  LIMIT 1;
  
  -- Si existe, retornar el existente
  IF v_existing_report_id IS NOT NULL THEN
    SELECT tr.id, tr.employee_id, tr.report_date, tr.created_at 
    INTO v_result_id, v_result_employee_id, v_result_report_date, v_result_created_at
    FROM public.tracker_reports tr
    WHERE tr.id = v_existing_report_id;
    
    RETURN QUERY SELECT
      v_result_id,
      v_result_employee_id,
      v_result_report_date,
      v_result_created_at;
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
  RETURNING 
    tracker_reports.id,
    tracker_reports.employee_id,
    tracker_reports.report_date,
    tracker_reports.created_at
  INTO 
    v_result_id,
    v_result_employee_id,
    v_result_report_date,
    v_result_created_at;
  
  RETURN QUERY SELECT
    v_result_id,
    v_result_employee_id,
    v_result_report_date,
    v_result_created_at;
END;
$$;

