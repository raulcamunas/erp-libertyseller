-- 266 · Cobo Family (5 % del excedente contra el año anterior), Solter (4 %, igual) y Opinas (15 % del beneficio) como clientes de comisiones.
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. No toca ninguna otra fila.

-- 1) Un modo de cálculo nuevo: el de ShoesF (excedente del mes contra el mismo mes del año anterior), decidido por dato y no por nombre.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_modo_calculo_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_modo_calculo_check
  CHECK (modo_calculo IN ('facturacion', 'beneficio', 'excedente_anual'));

-- 2) Los dos clientes, si no existen ya
INSERT INTO public.clients (name, base_commission_rate, modo_calculo)
SELECT 'Cobo Family', 0.05, 'excedente_anual'
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Cobo Family');

INSERT INTO public.clients (name, base_commission_rate, modo_calculo)
SELECT 'Solter', 0.04, 'excedente_anual'
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Solter');

INSERT INTO public.clients (name, base_commission_rate, modo_calculo)
SELECT 'Opinas', 0.15, 'beneficio'
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE name = 'Opinas');

-- 3) Su pareja en Tesorería: las filas se llaman igual, y solo se enlaza si ese cliente de Tesorería no lo tiene ya otro
UPDATE public.clients c
   SET treasury_client_id = t.id
  FROM public.treasury_clients t
 WHERE c.name IN ('Cobo Family', 'Solter', 'Opinas')
   AND c.treasury_client_id IS NULL
   AND t.name = c.name
   AND NOT EXISTS (SELECT 1 FROM public.clients o WHERE o.treasury_client_id = t.id);

-- 4) Comprobación
DO $$
DECLARE fila RECORD;
BEGIN
  FOR fila IN SELECT name, modo_calculo, base_commission_rate, treasury_client_id IS NOT NULL AS enlazado
                FROM public.clients WHERE name IN ('Cobo Family', 'Solter', 'Opinas') ORDER BY name
  LOOP
    RAISE NOTICE '266 · % · modo % · tasa % · enlazado con Tesorería: %', fila.name, fila.modo_calculo, fila.base_commission_rate, fila.enlazado;
  END LOOP;
END $$;
