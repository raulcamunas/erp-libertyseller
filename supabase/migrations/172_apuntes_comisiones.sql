-- ==================================================================
-- 172 · APUNTES DE COMISIONES: EL MODELO PACTADO CON CADA CLIENTE
-- ==================================================================
--
-- Que se cobra a cada cliente y sobre que. Hoy eso vive en la cabeza de dos
-- personas y en correos de hace meses, y cada vez que hay que revisar una
-- factura hay que reconstruirlo: cuanto fue el set up, si llevaba comision,
-- cuanto es el mantenimiento, y sobre que se calcula la comision —sobre lo del
-- año pasado o sobre las ventas de ahora—, que es la parte que mas se olvida y
-- la que cambia el importe.
--
--
-- POR QUE TODO SON TEXTOS Y NO NUMEROS
-- ------------------------------------
-- Porque esto NO calcula nada: son apuntes. Los tratos reales no caben en un
-- numero: «10 % sobre el incremento», «5 % los tres primeros meses y luego 3»,
-- «1.500 € en tres pagos». Con una columna numerica habria que inventarse una
-- forma para cada trato o dejar la mitad fuera, y entonces el apunte deja de
-- servir para lo unico que sirve: mirarlo antes de facturar.
--
-- El dia que haya que calcular con esto, se añaden columnas numericas al lado.
-- Guardar mal el dato hoy para poder calcular manaña es como se pierden los dos.
--
--
-- POR QUE `client_id` PUEDE SER NULO
-- ----------------------------------
-- Los clientes que ya facturan salen solos de `treasury_clients`. Pero el trato
-- se pacta ANTES de la primera factura, y ese es justo el momento en que hay que
-- apuntarlo. Con `client_id` obligatorio habria que dar de alta al cliente en
-- Tesoreria para poder anotar lo que se ha hablado con el, y entonces aparece en
-- la tabla de facturacion de este mes con todo a cero.
--
-- Asi que una fila lleva `client_id` (cliente que ya factura) o `nombre` (todavia
-- no), y el CHECK obliga a que sea una de las dos.

CREATE TABLE IF NOT EXISTS public.treasury_commission_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id UUID REFERENCES public.treasury_clients(id) ON DELETE CASCADE,
  /** Solo para los que todavia no estan en Tesoreria. Ver la nota de arriba */
  nombre TEXT,

  setup_precio TEXT,
  setup_comision TEXT,
  mantenimiento_precio TEXT,
  mantenimiento_comision TEXT,

  -- Sobre que se calcula la comision. Es la parte que mas se olvida y la que
  -- cambia el importe, por eso tiene columna propia y no vive en las notas.
  base TEXT CHECK (base IS NULL OR base IN ('ano_anterior', 'ventas_actuales', 'otro')),

  notas TEXT,
  position INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT treasury_commission_models_quien
    CHECK (client_id IS NOT NULL OR (nombre IS NOT NULL AND btrim(nombre) <> '')),

  -- Un cliente, un modelo. Si se pacta otro, se corrige el que hay: dos filas
  -- para el mismo cliente son dos versiones y nadie sabe cual manda.
  CONSTRAINT treasury_commission_models_uno_por_cliente UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS treasury_commission_models_orden_idx
  ON public.treasury_commission_models (position, created_at);

COMMENT ON TABLE public.treasury_commission_models IS
  'El modelo comercial pactado con cada cliente: set up, mantenimiento, comisiones y sobre que se calculan. Son APUNTES, no una tabla de calculo: por eso los importes son texto.';
COMMENT ON COLUMN public.treasury_commission_models.base IS
  'Sobre que se calcula la comision: ano_anterior, ventas_actuales u otro. Tiene columna propia porque es lo que mas se olvida y lo que cambia el importe.';

ALTER TABLE public.treasury_commission_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treasury_commission_models_todo ON public.treasury_commission_models;
CREATE POLICY treasury_commission_models_todo ON public.treasury_commission_models
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- Una fila por cliente que ya factura ----------
-- Vacias: son el sitio donde apuntar, no una suposicion sobre lo pactado.
INSERT INTO public.treasury_commission_models (client_id, position)
SELECT c.id, COALESCE(c.position, 0)
FROM public.treasury_clients c
WHERE c.is_active
ON CONFLICT (client_id) DO NOTHING;

-- ---------- Comprobacion ----------
DO $$
DECLARE
  filas INTEGER;
BEGIN
  SELECT count(*) INTO filas FROM public.treasury_commission_models;
  RAISE NOTICE 'Listo. Apuntes de comisiones creados con % clientes de Tesoreria. Se rellenan a mano desde la pantalla.', filas;
END $$;
