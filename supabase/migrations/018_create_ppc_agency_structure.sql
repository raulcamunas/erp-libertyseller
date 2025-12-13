-- =====================================================
-- LIBERTY PPC AGENCY HUB - ESTRUCTURA BASE
-- =====================================================

-- Tabla de Clientes PPC
CREATE TABLE IF NOT EXISTS public.ppc_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Tabla de Snapshots Semanales (Histórico de Rendimiento)
CREATE TABLE IF NOT EXISTS public.ppc_weekly_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.ppc_clients(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  total_spend NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_sales NUMERIC(12, 2) NOT NULL DEFAULT 0,
  global_acos NUMERIC(5, 2) NOT NULL DEFAULT 0,
  top_products JSONB DEFAULT '[]'::jsonb,
  ai_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(client_id, week_start_date)
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_ppc_clients_status ON public.ppc_clients(status);
CREATE INDEX IF NOT EXISTS idx_ppc_clients_created_at ON public.ppc_clients(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppc_weekly_snapshots_client_id ON public.ppc_weekly_snapshots(client_id);
CREATE INDEX IF NOT EXISTS idx_ppc_weekly_snapshots_week_start_date ON public.ppc_weekly_snapshots(week_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_ppc_weekly_snapshots_client_week ON public.ppc_weekly_snapshots(client_id, week_start_date DESC);

-- Trigger para actualizar updated_at en ppc_clients
CREATE OR REPLACE FUNCTION update_ppc_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ppc_clients_updated_at ON public.ppc_clients;
CREATE TRIGGER trigger_update_ppc_clients_updated_at
  BEFORE UPDATE ON public.ppc_clients
  FOR EACH ROW
  EXECUTE FUNCTION update_ppc_clients_updated_at();

-- Trigger para actualizar updated_at en ppc_weekly_snapshots
CREATE OR REPLACE FUNCTION update_ppc_weekly_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ppc_weekly_snapshots_updated_at ON public.ppc_weekly_snapshots;
CREATE TRIGGER trigger_update_ppc_weekly_snapshots_updated_at
  BEFORE UPDATE ON public.ppc_weekly_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_ppc_weekly_snapshots_updated_at();

-- Habilitar RLS
ALTER TABLE public.ppc_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ppc_weekly_snapshots ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para ppc_clients
-- Eliminar políticas si existen antes de crearlas
DROP POLICY IF EXISTS "Users can view all ppc clients" ON public.ppc_clients;
DROP POLICY IF EXISTS "Users can insert ppc clients" ON public.ppc_clients;
DROP POLICY IF EXISTS "Users can update ppc clients" ON public.ppc_clients;
DROP POLICY IF EXISTS "Users can delete ppc clients" ON public.ppc_clients;

CREATE POLICY "Users can view all ppc clients"
  ON public.ppc_clients
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert ppc clients"
  ON public.ppc_clients
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update ppc clients"
  ON public.ppc_clients
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete ppc clients"
  ON public.ppc_clients
  FOR DELETE
  TO authenticated
  USING (true);

-- Políticas RLS para ppc_weekly_snapshots
-- Eliminar políticas si existen antes de crearlas
DROP POLICY IF EXISTS "Users can view all ppc weekly snapshots" ON public.ppc_weekly_snapshots;
DROP POLICY IF EXISTS "Users can insert ppc weekly snapshots" ON public.ppc_weekly_snapshots;
DROP POLICY IF EXISTS "Users can update ppc weekly snapshots" ON public.ppc_weekly_snapshots;
DROP POLICY IF EXISTS "Users can delete ppc weekly snapshots" ON public.ppc_weekly_snapshots;

CREATE POLICY "Users can view all ppc weekly snapshots"
  ON public.ppc_weekly_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert ppc weekly snapshots"
  ON public.ppc_weekly_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update ppc weekly snapshots"
  ON public.ppc_weekly_snapshots
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete ppc weekly snapshots"
  ON public.ppc_weekly_snapshots
  FOR DELETE
  TO authenticated
  USING (true);

