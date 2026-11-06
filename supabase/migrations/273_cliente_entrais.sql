-- 273 · Entrais como cliente de comisiones: 3 % del excedente contra el mismo mes del año anterior, sin IVA.
-- El contrato lo cobra desde el mes 4, que es noviembre de 2026 (los tres primeros, 800 € de setup sin comisión).
-- Aplicada el 6 nov 2026 por la API. IDEMPOTENTE: lanzarla otra vez no cambia nada. No toca ninguna otra fila.

INSERT INTO public.clients (name, base_commission_rate, modo_calculo)
SELECT 'Entrais', 0.03, 'excedente_anual'
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Entrais');

-- Su pareja en Tesorería: se llaman igual, y solo se enlaza si ese cliente de Tesorería no lo tiene ya otro
UPDATE public.clients c
   SET treasury_client_id = t.id
  FROM public.treasury_clients t
 WHERE c.name = 'Entrais'
   AND c.treasury_client_id IS NULL
   AND t.name = c.name
   AND NOT EXISTS (SELECT 1 FROM public.clients o WHERE o.treasury_client_id = t.id);
