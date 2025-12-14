-- =====================================================
-- AÑADIR MÉTRICAS ADICIONALES A PPC WEEKLY SNAPSHOTS
-- =====================================================

-- Añadir columnas adicionales para métricas completas
ALTER TABLE public.ppc_weekly_snapshots
  ADD COLUMN IF NOT EXISTS total_clicks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_cpc NUMERIC(8, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_ctr NUMERIC(5, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roas NUMERIC(8, 2) DEFAULT 0;

-- Comentarios para documentación
COMMENT ON COLUMN public.ppc_weekly_snapshots.total_clicks IS 'Total de clics de la semana';
COMMENT ON COLUMN public.ppc_weekly_snapshots.avg_cpc IS 'CPC promedio (Cost Per Click)';
COMMENT ON COLUMN public.ppc_weekly_snapshots.avg_ctr IS 'CTR promedio (Click Through Rate)';
COMMENT ON COLUMN public.ppc_weekly_snapshots.roas IS 'ROAS (Return on Ad Spend)';

