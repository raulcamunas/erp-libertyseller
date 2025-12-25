-- =====================================================
-- ELIMINAR DATOS DEL TRACKER POR FECHA
-- Elimina todos los reportes y logs de un rango de fechas
-- =====================================================

-- Cambiar estas fechas según lo que necesites eliminar
-- Formato: 'YYYY-MM-DD'
DO $$
DECLARE
  start_date DATE := '2025-12-20';
  end_date DATE := '2025-12-31';
BEGIN
  -- Eliminar logs de reportes en el rango de fechas
  DELETE FROM public.tracker_logs
  WHERE report_id IN (
    SELECT id FROM public.tracker_reports 
    WHERE report_date >= start_date::timestamp
      AND report_date < (end_date + INTERVAL '1 day')::timestamp
  );
  
  -- Eliminar reportes en el rango de fechas
  DELETE FROM public.tracker_reports
  WHERE report_date >= start_date::timestamp
    AND report_date < (end_date + INTERVAL '1 day')::timestamp;
  
  RAISE NOTICE 'Eliminados reportes y logs del % al %', start_date, end_date;
END $$;

-- Verificar qué quedó
SELECT 
  employee_id,
  DATE(report_date) as fecha,
  COUNT(*) as total_reportes
FROM public.tracker_reports
GROUP BY employee_id, DATE(report_date)
ORDER BY fecha DESC, employee_id;

