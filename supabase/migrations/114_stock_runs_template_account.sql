-- =====================================================
-- DE QUÉ CUENTA DE VENDEDOR ERA LA PLANTILLA DE CADA PROCESO
-- =====================================================
-- La plantilla «Precio y cantidad» que se sube al módulo lleva grabada, en la
-- cadena de configuración de su celda A1, la cuenta de vendedor para la que
-- Amazon la generó (contributorId) y el marketplace (primaryMarketplaceId).
-- Todo lo demás —las columnas, sus nombres técnicos, las hojas— es idéntico en
-- la plantilla de cualquier cuenta.
--
-- Eso es exactamente lo que hace peligrosa una equivocación: si se procesa al
-- cliente A con la plantilla que se descargó ayer para el cliente B, el módulo
-- la rellena sin una sola queja y el fichero se sube a la cuenta de B con los
-- SKU de A. Ninguno existe allí, así que el informe de procesamiento de Seller
-- Central devuelve un error por SKU y la actualización del día se pierde.
--
-- Guardando aquí la cuenta de cada proceso, el siguiente puede compararse con
-- el anterior del mismo cliente y avisar antes de que el fichero salga del
-- ERP. La primera vez que se ve una cuenta se registra sin decir nada: no hay
-- con qué compararla y bloquear al primer uso sería ruido puro.
--
-- Van en stock_runs y no en stock_clients por los permisos: quien procesa el
-- stock dos veces por semana es un 'employee', que puede insertar runs pero no
-- editar el cliente (ver las políticas de la 106). En stock_clients la
-- escritura fallaría en silencio para justo la persona que usa el módulo.

ALTER TABLE public.stock_runs
  ADD COLUMN IF NOT EXISTS template_contributor_id TEXT,
  ADD COLUMN IF NOT EXISTS template_marketplace_id TEXT;

COMMENT ON COLUMN public.stock_runs.template_contributor_id IS
  'Cuenta de vendedor de la plantilla de Amazon usada en el proceso (amzn1.cr.o.…). NULL si no se subió plantilla.';
COMMENT ON COLUMN public.stock_runs.template_marketplace_id IS
  'Marketplace de esa plantilla (amzn1.mp.o.… ; A1RKKUPIHCS9HS es Amazon.es).';

-- La consulta que hace la ruta es «el último proceso de ESTE cliente que llevó
-- plantilla». El índice de la 106 ya ordena por (client_id, created_at DESC),
-- pero sin el filtro parcial habría que recorrer también los procesos sin
-- plantilla, que son la mayoría mientras el módulo convive con el .xlsx de
-- tres columnas.
CREATE INDEX IF NOT EXISTS idx_stock_runs_template_account
  ON public.stock_runs(client_id, created_at DESC)
  WHERE template_contributor_id IS NOT NULL;
