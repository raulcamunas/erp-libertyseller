-- =====================================================
-- COLD CALLING: de qué pestaña del Excel viene cada lead
-- =====================================================
-- Un comercial puede arrastrar varias listas: Alejandro trabaja «1a
-- lista», «2a lista» y «Alejandro V2»; José, «José» y «José V2»; Yamila y
-- Maoli solo la suya. Saber el origen permite filtrar por lista y no
-- mezclar carteras viejas con la actual.
--
-- Por si la 087 ya se ejecutó antes de existir esta columna.

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS source_list TEXT;

CREATE INDEX IF NOT EXISTS idx_cold_leads_source_list
  ON public.cold_leads(source_list);
