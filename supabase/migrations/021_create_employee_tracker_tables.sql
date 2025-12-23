-- =====================================================
-- EMPLOYEE TRACKER TABLES
-- =====================================================

-- Tabla de reportes de tracking
CREATE TABLE IF NOT EXISTS public.tracker_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL,
  report_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de logs de actividad
CREATE TABLE IF NOT EXISTS public.tracker_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.tracker_reports(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  duration_seconds INTEGER NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Columna calculada para categoría
  category TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN LOWER(domain) LIKE '%linkedin%' THEN 'Prospecting'
      WHEN LOWER(domain) LIKE '%youtube%' THEN 'Entertainment'
      WHEN LOWER(domain) LIKE '%netflix%' THEN 'Entertainment'
      WHEN LOWER(domain) LIKE '%facebook%' THEN 'Entertainment'
      WHEN LOWER(domain) LIKE '%instagram%' THEN 'Entertainment'
      WHEN LOWER(domain) LIKE '%twitter%' THEN 'Entertainment'
      WHEN LOWER(domain) LIKE '%x.com%' THEN 'Entertainment'
      WHEN LOWER(domain) LIKE '%gmail%' THEN 'Communication'
      WHEN LOWER(domain) LIKE '%outlook%' THEN 'Communication'
      WHEN LOWER(domain) LIKE '%slack%' THEN 'Communication'
      WHEN LOWER(domain) LIKE '%notion%' THEN 'Productivity'
      WHEN LOWER(domain) LIKE '%trello%' THEN 'Productivity'
      WHEN LOWER(domain) LIKE '%asana%' THEN 'Productivity'
      ELSE 'Other'
    END
  ) STORED
);

-- Índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_tracker_reports_employee_id ON public.tracker_reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_tracker_reports_report_date ON public.tracker_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_tracker_logs_report_id ON public.tracker_logs(report_id);
CREATE INDEX IF NOT EXISTS idx_tracker_logs_start_time ON public.tracker_logs(start_time);
CREATE INDEX IF NOT EXISTS idx_tracker_logs_category ON public.tracker_logs(category);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_tracker_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_tracker_reports_updated_at ON public.tracker_reports;
CREATE TRIGGER trigger_update_tracker_reports_updated_at
  BEFORE UPDATE ON public.tracker_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_tracker_reports_updated_at();

-- RLS Policies
ALTER TABLE public.tracker_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Los usuarios autenticados pueden ver sus propios reportes
DROP POLICY IF EXISTS "Users can view their own tracker reports" ON public.tracker_reports;
CREATE POLICY "Users can view their own tracker reports"
  ON public.tracker_reports
  FOR SELECT
  USING (
    auth.uid()::text = employee_id 
    OR EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Policy: Permitir inserción desde API (puede ser ajustado según necesidades)
DROP POLICY IF EXISTS "Allow tracker reports insert" ON public.tracker_reports;
CREATE POLICY "Allow tracker reports insert"
  ON public.tracker_reports
  FOR INSERT
  WITH CHECK (true); -- Por ahora permitimos inserción libre desde la extensión

-- Policy: Los usuarios pueden ver logs de sus propios reportes
DROP POLICY IF EXISTS "Users can view their own tracker logs" ON public.tracker_logs;
CREATE POLICY "Users can view their own tracker logs"
  ON public.tracker_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tracker_reports
      WHERE tracker_reports.id = tracker_logs.report_id
      AND (
        auth.uid()::text = tracker_reports.employee_id
        OR EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() 
          AND profiles.role = 'admin'
        )
      )
    )
  );

-- Policy: Permitir inserción de logs desde API
DROP POLICY IF EXISTS "Allow tracker logs insert" ON public.tracker_logs;
CREATE POLICY "Allow tracker logs insert"
  ON public.tracker_logs
  FOR INSERT
  WITH CHECK (true); -- Por ahora permitimos inserción libre desde la extensión

-- Comentarios para documentación
COMMENT ON TABLE public.tracker_reports IS 'Reportes de actividad de empleados generados por la extensión de Chrome';
COMMENT ON TABLE public.tracker_logs IS 'Logs individuales de actividad web de los empleados';
COMMENT ON COLUMN public.tracker_logs.category IS 'Categoría automática basada en el dominio (Prospecting, Entertainment, Communication, Productivity, Other)';




