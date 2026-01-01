-- =====================================================
-- FUNCIÓN PARA ELIMINAR REPORTES INDIVIDUALES DE TRACKER
-- =====================================================

-- Función para eliminar un reporte individual de tracker_reports
-- (los logs se eliminan automáticamente por CASCADE)
CREATE OR REPLACE FUNCTION public.delete_tracker_report(
  p_report_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con permisos del creador de la función
AS $$
BEGIN
  -- Eliminar el reporte específico (los logs se eliminan automáticamente por CASCADE)
  DELETE FROM public.tracker_reports
  WHERE id = p_report_id;
  
  -- FOUND es una variable especial de PL/pgSQL que se establece automáticamente
  -- después de operaciones DML (DELETE, UPDATE, INSERT)
  RETURN FOUND;
END;
$$;

-- Permitir que usuarios autenticados ejecuten esta función
GRANT EXECUTE ON FUNCTION public.delete_tracker_report TO authenticated;

