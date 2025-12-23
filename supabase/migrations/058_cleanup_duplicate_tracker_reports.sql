-- =====================================================
-- LIMPIAR REPORTES DUPLICADOS EXISTENTES
-- =====================================================

-- Esta migración elimina reportes duplicados, manteniendo solo el más reciente
-- para cada combinación de empleado y hora

-- Primero, mover los logs de reportes duplicados al reporte principal
WITH duplicate_reports AS (
  SELECT 
    employee_id,
    date_trunc('hour', report_date) as hour_start,
    array_agg(id ORDER BY created_at DESC) as report_ids
  FROM public.tracker_reports
  GROUP BY employee_id, date_trunc('hour', report_date)
  HAVING COUNT(*) > 1
),
keep_reports AS (
  SELECT 
    dr.employee_id,
    dr.hour_start,
    dr.report_ids[1] as keep_id,
    dr.report_ids[2:] as duplicate_ids
  FROM duplicate_reports dr
)
UPDATE public.tracker_logs
SET report_id = kr.keep_id
FROM keep_reports kr
WHERE report_id = ANY(kr.duplicate_ids);

-- Ahora eliminar los reportes duplicados (los logs ya fueron movidos)
WITH duplicate_reports AS (
  SELECT 
    employee_id,
    date_trunc('hour', report_date) as hour_start,
    array_agg(id ORDER BY created_at DESC) as report_ids
  FROM public.tracker_reports
  GROUP BY employee_id, date_trunc('hour', report_date)
  HAVING COUNT(*) > 1
),
duplicate_ids AS (
  SELECT unnest(report_ids[2:]) as id
  FROM duplicate_reports
)
DELETE FROM public.tracker_reports
WHERE id IN (SELECT id FROM duplicate_ids);

-- Actualizar report_date de los reportes restantes para que estén redondeados a la hora
UPDATE public.tracker_reports
SET report_date = date_trunc('hour', report_date)
WHERE report_date != date_trunc('hour', report_date);

