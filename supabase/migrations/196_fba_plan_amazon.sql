-- ============================================================================
-- 196 · EL PLAN EN AMAZON: POR DÓNDE VA Y QUÉ ENVÍOS HA GENERADO
-- ============================================================================
--
-- Crear un envío en Amazon no es una llamada: son nueve pasos encadenados, y
-- cada uno hay que guardarlo. Si no, una pasada que se corta en el paso seis
-- deja un plan a medias en la cuenta del cliente que nadie sabe ni que existe.
--
--
-- ============ POR QUÉ SE GUARDA CADA IDENTIFICADOR ============
--
-- Los de Amazon no se pueden recalcular: la opción de empaquetado y la de
-- reparto se eligieron entre varias, con sus tarifas, en un momento concreto, y
-- CADUCAN. Si se pierden, no hay forma de saber cuál se eligió ni de seguir
-- desde donde estaba: hay que cancelar el plan y empezar de cero.
--
-- `paso_plan` es lo que permite retomar. Sin él, la pantalla tendría que
-- deducir por dónde va preguntándole a Amazon por cada cosa, y una respuesta
-- ambigua —una opción confirmada pero sin envíos todavía— la haría repetir un
-- paso que ya se dio.
-- ============================================================================

ALTER TABLE public.fba_remesas
  /**
   * Dónde está el plan. NULL = todavía no se ha creado.
   *
   *   creado        · existe el plan con sus artículos
   *   empaquetado   · elegida la forma de agrupar
   *   cajas         · mandadas nuestras cajas con medidas y pesos
   *   reparto       · Amazon ha propuesto centros, falta elegir
   *   confirmado    · IRREVERSIBLE. Nacen los FBA… de verdad
   *   transporte    · elegido el transportista
   *   seguimientos  · mandados los números, si el transporte es propio
   */
  ADD COLUMN IF NOT EXISTS paso_plan TEXT,
  /** La opción de agrupado elegida. Caduca, y no se puede recalcular */
  ADD COLUMN IF NOT EXISTS packing_option_id TEXT,
  /** La de reparto por centros. Lo mismo */
  ADD COLUMN IF NOT EXISTS placement_option_id TEXT,
  /** Lo que dijo Amazon la última vez que algo salió mal, para poder enseñarlo */
  ADD COLUMN IF NOT EXISTS plan_error TEXT,
  ADD COLUMN IF NOT EXISTS plan_at TIMESTAMPTZ;

COMMENT ON COLUMN public.fba_remesas.paso_plan IS
  'creado · empaquetado · cajas · reparto · confirmado · transporte · seguimientos. '
  'Es lo que permite retomar un plan a medias sin repetir un paso ya dado.';

/* ------------------------------------------------------------------ */
/* Los envíos que Amazon genera a partir del plan                       */
/* ------------------------------------------------------------------ */
--
-- UNA REMESA PUEDE ACABAR EN VARIOS ENVÍOS, y esto es lo que más sorprende la
-- primera vez: Amazon decide repartir la mercancía entre varios centros
-- logísticos según dónde le venga bien, y cada trozo es un envío con su
-- identificador, su destino y su transportista.
--
-- Por eso es una tabla y no unas columnas en la remesa.

CREATE TABLE IF NOT EXISTS public.fba_envios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,

  /** El identificador dentro del plan. Existe desde que Amazon reparte */
  shipment_id TEXT NOT NULL,
  /**
   * El FBA… de verdad, el que va impreso en las etiquetas de caja.
   * NULL hasta que se confirma el reparto: antes de eso el envío es una
   * propuesta, no existe para el almacén.
   */
  confirmation_id TEXT,

  nombre TEXT,
  /** El centro logístico al que va */
  destino TEXT,
  estado TEXT,

  transportation_option_id TEXT,
  transportista TEXT,
  /** true = transportista asociado de Amazon: los seguimientos los pone él */
  es_de_amazon BOOLEAN,
  coste NUMERIC(10,2),
  moneda TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE (remesa_id, shipment_id)
);

COMMENT ON TABLE public.fba_envios IS
  'Los envíos en que Amazon parte una remesa. Una remesa puede acabar en varios '
  'porque Amazon reparte entre centros logísticos, y cada uno tiene su '
  'identificador, su destino y su transportista.';

CREATE INDEX IF NOT EXISTS fba_envios_confirmacion_idx
  ON public.fba_envios (confirmation_id) WHERE confirmation_id IS NOT NULL;

/** A qué envío pertenece cada caja. Lo dice Amazon al repartir */
ALTER TABLE public.fba_cajas
  ADD COLUMN IF NOT EXISTS envio_id UUID REFERENCES public.fba_envios(id) ON DELETE SET NULL;

/* ------------------------------------------------------------------ */
/* RLS · lo mismo que las cajas                                         */
/* ------------------------------------------------------------------ */

ALTER TABLE public.fba_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Con acceso leen envios" ON public.fba_envios;
CREATE POLICY "Con acceso leen envios"
  ON public.fba_envios FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fba_remesas r
    WHERE r.id = remesa_id AND public.puede_ver_remesas_de(auth.uid(), r.client_id)
  ));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_envios FROM authenticated, anon;

/* ------------------------------------------------------------------ */
/* La dirección desde la que se envía                                   */
/* ------------------------------------------------------------------ */
--
-- Amazon la exige al crear el plan, y es por cliente: cada uno manda desde su
-- almacén. Se guarda en la ficha del cliente para no pedirla en cada envío.

CREATE TABLE IF NOT EXISTS public.fba_direcciones (
  client_id UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  nombre TEXT NOT NULL,
  empresa TEXT NOT NULL,
  linea1 TEXT NOT NULL,
  linea2 TEXT,
  ciudad TEXT NOT NULL,
  /** El código de provincia. En España, dos letras: MD, B, V… */
  provincia TEXT NOT NULL,
  codigo_postal TEXT NOT NULL,
  /** ISO de dos letras: ES, FR… */
  pais TEXT NOT NULL DEFAULT 'ES',
  telefono TEXT NOT NULL,
  email TEXT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.fba_direcciones IS
  'Desde dónde manda cada cliente. Amazon la exige al crear el plan y no cambia '
  'de un envío a otro, así que se guarda una vez.';

ALTER TABLE public.fba_direcciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Con acceso leen su direccion" ON public.fba_direcciones;
CREATE POLICY "Con acceso leen su direccion"
  ON public.fba_direcciones FOR SELECT TO authenticated
  USING (public.puede_ver_remesas_de(auth.uid(), client_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_direcciones FROM authenticated, anon;
