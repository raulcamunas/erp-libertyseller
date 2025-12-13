-- Tabla para el historial de cambios de estado de los prospectos
CREATE TABLE IF NOT EXISTS prospect_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES company_prospects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('identified', 'connected', 'messaged', 'replied')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_prospect_status_history_prospect_id ON prospect_status_history(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_status_history_changed_at ON prospect_status_history(changed_at DESC);

-- Función para registrar automáticamente cambios de estado
CREATE OR REPLACE FUNCTION log_prospect_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo registrar si el estado cambió
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO prospect_status_history (prospect_id, status, changed_at)
    VALUES (NEW.id, NEW.status, NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para registrar cambios automáticamente
-- Eliminar trigger si existe antes de crearlo
DROP TRIGGER IF EXISTS trigger_prospect_status_change ON company_prospects;
CREATE TRIGGER trigger_prospect_status_change
  AFTER UPDATE ON company_prospects
  FOR EACH ROW
  EXECUTE FUNCTION log_prospect_status_change();

-- RLS Policies
ALTER TABLE prospect_status_history ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas si existen antes de crearlas
DROP POLICY IF EXISTS "Users can read prospect history" ON prospect_status_history;
DROP POLICY IF EXISTS "Users can insert prospect history" ON prospect_status_history;

-- Permitir lectura a usuarios autenticados
CREATE POLICY "Users can read prospect history"
  ON prospect_status_history
  FOR SELECT
  TO authenticated
  USING (true);

-- Permitir inserción a usuarios autenticados (aunque el trigger lo hace automáticamente)
CREATE POLICY "Users can insert prospect history"
  ON prospect_status_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

