-- =====================================================
-- ELIMINAR TODOS LOS DATOS DEL TRACKER
-- ⚠️ ADVERTENCIA: Esto eliminará TODOS los reportes y logs
-- =====================================================

-- Opción 1: Eliminar TODOS los datos del tracker (todos los empleados)
-- Descomenta las siguientes líneas si quieres eliminar TODO:
-- DELETE FROM public.tracker_logs;
-- DELETE FROM public.tracker_reports;

-- Opción 2: Eliminar solo los datos de un empleado específico
-- Reemplaza 'Alejandro' con el nombre del empleado que quieres limpiar
DELETE FROM public.tracker_logs
WHERE report_id IN (
  SELECT id FROM public.tracker_reports 
  WHERE employee_id = 'Alejandro'
);

DELETE FROM public.tracker_reports
WHERE employee_id = 'Alejandro';

-- Verificar que se eliminaron
SELECT 
  COUNT(*) as total_reports,
  COUNT(DISTINCT employee_id) as total_employees
FROM public.tracker_reports;

SELECT COUNT(*) as total_logs
FROM public.tracker_logs;

