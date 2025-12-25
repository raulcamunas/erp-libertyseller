-- Script para verificar datos del tracker
-- Ejecutar en Supabase SQL Editor

-- 1. Verificar reportes del día 25/12/2025
SELECT 
  id,
  employee_id,
  report_date,
  created_at,
  LENGTH(employee_id) as employee_id_length,
  TRIM(employee_id) as employee_id_trimmed
FROM tracker_reports
WHERE report_date >= '2025-12-25 00:00:00'::timestamptz
  AND report_date < '2025-12-26 00:00:00'::timestamptz
ORDER BY created_at DESC;

-- 2. Verificar logs asociados a esos reportes
SELECT 
  tl.id,
  tl.report_id,
  tl.domain,
  tl.url,
  tl.title,
  tl.duration_seconds,
  tl.start_time,
  tl.end_time,
  tl.category,
  tr.employee_id,
  tr.report_date
FROM tracker_logs tl
JOIN tracker_reports tr ON tl.report_id = tr.id
WHERE tr.report_date >= '2025-12-25 00:00:00'::timestamptz
  AND tr.report_date < '2025-12-26 00:00:00'::timestamptz
ORDER BY tl.start_time;

-- 3. Verificar todos los employee_id únicos en reportes
SELECT DISTINCT 
  employee_id,
  LENGTH(employee_id) as length,
  TRIM(employee_id) as trimmed
FROM tracker_reports
ORDER BY employee_id;

-- 4. Verificar si la función insert_tracker_log acepta NULL
SELECT 
  proname,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc
WHERE proname = 'insert_tracker_log';

