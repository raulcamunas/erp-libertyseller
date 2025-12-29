-- =====================================================
-- FUNCIÓN PARA ELIMINAR REPORTES DE TRACKER (BYPASS RLS)
-- =====================================================

-- Función para eliminar reportes de tracker (y sus logs por CASCADE)
CREATE OR REPLACE FUNCTION public.delete_tracker_reports(
  p_employee_id TEXT,
  p_day_start TIMESTAMPTZ,
  p_day_end TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con permisos del creador de la función
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Eliminar reportes del día (los logs se eliminan automáticamente por CASCADE)
  WITH deleted_reports AS (
    DELETE FROM public.tracker_reports
    WHERE employee_id = p_employee_id
      AND report_date >= p_day_start
      AND report_date < p_day_end
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted_reports;
  
  RETURN v_deleted_count;
END;
$$;

-- Permitir que usuarios autenticados ejecuten esta función
GRANT EXECUTE ON FUNCTION public.delete_tracker_reports TO authenticated;


