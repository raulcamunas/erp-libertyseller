-- =====================================================
-- ACTUALIZAR CATEGORÍAS DEL TRACKER
-- Añadir nuevas categorías: linkedin, amazon, navegación
-- =====================================================

-- Primero, necesitamos eliminar la columna calculada existente
ALTER TABLE public.tracker_logs DROP COLUMN IF EXISTS category;

-- Recrear la columna calculada con las nuevas categorías
ALTER TABLE public.tracker_logs ADD COLUMN category TEXT GENERATED ALWAYS AS (
  CASE 
    WHEN LOWER(domain) LIKE '%linkedin%' THEN 'linkedin'
    WHEN LOWER(domain) LIKE '%amazon%' OR LOWER(domain) LIKE '%amazonaws%' THEN 'amazon'
    WHEN LOWER(domain) LIKE '%google%' OR LOWER(domain) LIKE '%googlesearch%' OR LOWER(domain) LIKE '%google.com%' OR LOWER(domain) LIKE '%google.es%' THEN 'navegación'
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
) STORED;

-- Recrear el índice si es necesario
DROP INDEX IF EXISTS idx_tracker_logs_category;
CREATE INDEX IF NOT EXISTS idx_tracker_logs_category ON public.tracker_logs(category);

