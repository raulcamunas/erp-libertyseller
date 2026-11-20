-- 327 · EN QUÉ HOJA IMPRIME CADA CLIENTE SUS ETIQUETAS
--
-- ShoesF imprime las de producto en la hoja A4 de 40 de Amazon (52,5 × 29,7 mm); Solter las de caja en la térmica de 10 × 15.
-- Una fila por cliente. Sin fila, o con un valor que ya no exista, se usa la hoja de siempre.
-- La lee y la escribe el servidor (service role): sin políticas para nadie más.

CREATE TABLE IF NOT EXISTS public.fba_preferencias_etiquetas (
  client_id        UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  -- Etiquetas de producto (FNSKU): un id de lib/fba/formatos-etiqueta.ts ('a4-21', 'a4-40', 'termica-57x32'…)
  formato_producto TEXT,
  -- Etiquetas de caja de Amazon: 'a4_2' | 'a4_4' | 'termica' | 'folio'
  hoja_caja        TEXT CHECK (hoja_caja IS NULL OR hoja_caja IN ('a4_2', 'a4_4', 'termica', 'folio')),
  actualizado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por  UUID
);

ALTER TABLE public.fba_preferencias_etiquetas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_preferencias_etiquetas FROM anon, authenticated;

-- Las dos de partida: ShoesF con la de 40 y Solter con la térmica de caja
INSERT INTO public.fba_preferencias_etiquetas (client_id, formato_producto)
SELECT id, 'a4-40' FROM public.amazon_clients WHERE name ILIKE '%shoesf%'
ON CONFLICT (client_id) DO UPDATE SET formato_producto = EXCLUDED.formato_producto, actualizado_at = now();

INSERT INTO public.fba_preferencias_etiquetas (client_id, hoja_caja)
SELECT id, 'termica' FROM public.amazon_clients WHERE name ILIKE '%solter%'
ON CONFLICT (client_id) DO UPDATE SET hoja_caja = EXCLUDED.hoja_caja, actualizado_at = now();

SELECT c.name, p.formato_producto, p.hoja_caja
FROM public.fba_preferencias_etiquetas p JOIN public.amazon_clients c ON c.id = p.client_id;
