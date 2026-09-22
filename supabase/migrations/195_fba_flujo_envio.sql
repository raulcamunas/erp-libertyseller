-- ============================================================================
-- 195 · EL FLUJO DE UN ENVÍO: DE LA PROPUESTA A LAS CAJAS
-- ============================================================================
--
-- Hasta ahora una remesa era un apunte de lo que ya se había mandado. Pasa a ser
-- un PROCESO con dos actores que se van pasando el turno:
--
--   1. borrador      · la agencia monta qué se va a mandar.
--   2. aprobada      · EL CLIENTE da el OK. A partir de aquí se imprimen las
--                      etiquetas de producto y él las pega.
--   3. encajando     · EL CLIENTE mete la mercancía en cajas y sube medidas,
--                      pesos y qué va en cada una.
--   4. lista         · el cliente dice que ha terminado. Le toca a la agencia.
--   5. en_amazon     · la agencia ha creado el plan en Amazon y hay etiquetas
--                      de caja que devolverle.
--   6. enviada       · la mercancía ha salido, con sus seguimientos.
--   7. cerrada       · Amazon lo ha cerrado. Ya no cambia.
--
-- El orden no es decorativo: cada paso deja al otro un trabajo que no puede
-- empezar antes. Imprimir etiquetas de algo que el cliente no ha aprobado es
-- tirar papel, y crear el plan en Amazon sin los pesos de las cajas es crearlo
-- mal.
--
--
-- ============ POR QUÉ NO HAY UN CHECK CON LOS ESTADOS ============
--
-- Porque el día que haya que meter un paso intermedio —y lo habrá, en cuanto
-- entren los palés— un CHECK obliga a una migración con la tabla bloqueada para
-- algo que solo lee el código. Quien manda sobre las transiciones válidas es
-- lib/fba/flujo.ts, que además sabe QUIÉN puede hacer cada una, cosa que un
-- CHECK no puede saber.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) El estado, y quién movió cada paso                                */
/* ------------------------------------------------------------------ */

ALTER TABLE public.fba_remesas
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'cerrada',
  ADD COLUMN IF NOT EXISTS aprobada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS encajado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lista_at TIMESTAMPTZ,
  /** El plan en Amazon. Lo devuelve createInboundPlan y es la llave de todo
      lo que viene después */
  ADD COLUMN IF NOT EXISTS inbound_plan_id TEXT;

COMMENT ON COLUMN public.fba_remesas.estado IS
  'borrador · aprobada · encajando · lista · en_amazon · enviada · cerrada. '
  'Las transiciones válidas y quién puede hacerlas están en lib/fba/flujo.ts.';

-- Las que ya existen son historia: se mandaron hace meses y no hay nada que
-- aprobar. Por eso el DEFAULT es 'cerrada' y no 'borrador' — al revés, las diez
-- remesas de ShoesF aparecerían mañana como pendientes de aprobar por el
-- cliente, que es exactamente el tipo de aviso falso que hace que la gente deje
-- de mirar los avisos.
UPDATE public.fba_remesas SET estado = 'cerrada' WHERE estado IS NULL;

CREATE INDEX IF NOT EXISTS fba_remesas_estado_idx
  ON public.fba_remesas (client_id, estado, fecha_envio DESC);


/* ------------------------------------------------------------------ */
/* 2) Las cajas                                                         */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_cajas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,

  /** 1, 2, 3… Es como las llama todo el mundo y como van rotuladas */
  numero INTEGER NOT NULL CHECK (numero > 0),

  /**
   * Centímetros y kilos, que es como se miden y como las pide Amazon en
   * Europa. NUMERIC y no INTEGER: una caja de 13,2 kg es lo normal, y
   * redondear el peso a 13 hace que el transportista cobre otra cosa.
   */
  largo_cm NUMERIC(6,1),
  ancho_cm NUMERIC(6,1),
  alto_cm NUMERIC(6,1),
  peso_kg NUMERIC(6,2),

  /** El identificador que Amazon le da a esta caja. Llega al crear el plan y
      es lo que hay que devolver al mandar los seguimientos por bulto */
  box_id_amazon TEXT,
  /** El seguimiento del transportista, cuando es transporte propio */
  seguimiento TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE (remesa_id, numero)
);

COMMENT ON TABLE public.fba_cajas IS
  'Las cajas físicas de una remesa. Las rellena el CLIENTE cuando encaja la '
  'mercancía: él es quien tiene la báscula y el metro.';


/* ------------------------------------------------------------------ */
/* 3) Qué va dentro de cada caja                                        */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_caja_contenido (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  caja_id UUID NOT NULL REFERENCES public.fba_cajas(id) ON DELETE CASCADE,

  /** El mismo SKU que en la línea de la remesa. Es por donde se cuadra */
  sku TEXT NOT NULL,
  unidades INTEGER NOT NULL CHECK (unidades > 0),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  /** Un SKU una vez por caja: si van cuatro pares de la 41 en la caja 1, es
      una línea de cuatro, no cuatro líneas de una */
  UNIQUE (caja_id, sku)
);

CREATE INDEX IF NOT EXISTS fba_caja_contenido_sku_idx ON public.fba_caja_contenido (sku);

/**
 * EL CUADRE ES LO QUE HACE QUE ESTO SIRVA.
 *
 * La suma de lo encajado tiene que dar exactamente lo declarado en la remesa.
 * En la hoja de cálculo que sustituye esto había tres celdas —Total unidades,
 * Total Envío y Discrepancia— y ese cero era lo que se miraba antes de cerrar.
 *
 * Es una vista y no un CHECK porque mientras se encaja el descuadre es NORMAL:
 * vas metiendo cajas y hasta la última no cuadra. Un CHECK impediría guardar la
 * primera caja. Lo que hace falta es poder PREGUNTAR si cuadra, y eso es esto.
 */
CREATE OR REPLACE VIEW public.fba_cuadre_cajas AS
SELECT
  r.id AS remesa_id,
  l.sku,
  l.unidades AS declaradas,
  COALESCE(SUM(c.unidades), 0)::INTEGER AS encajadas,
  (l.unidades - COALESCE(SUM(c.unidades), 0))::INTEGER AS diferencia
FROM public.fba_remesas r
JOIN public.fba_remesa_lineas l ON l.remesa_id = r.id
LEFT JOIN public.fba_cajas cj ON cj.remesa_id = r.id
LEFT JOIN public.fba_caja_contenido c ON c.caja_id = cj.id AND c.sku = l.sku
GROUP BY r.id, l.sku, l.unidades;


/* ------------------------------------------------------------------ */
/* 4) El FNSKU en el espejo del catálogo                                */
/* ------------------------------------------------------------------ */
--
-- Sin él no hay etiqueta de producto, y hoy solo lo tenemos en las 372 líneas
-- que vinieron del Excel de ShoesF. El libro mayor trae una columna FNSKU que
-- ya leemos cada noche: basta con guardarla.

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS fnsku TEXT;

COMMENT ON COLUMN public.amazon_listings.fnsku IS
  'El código con el que Amazon identifica ESTE producto de ESTE vendedor. Va '
  'en la etiqueta que se pega en cada unidad. Se rellena desde el libro mayor.';

CREATE INDEX IF NOT EXISTS amazon_listings_fnsku_idx
  ON public.amazon_listings (fnsku) WHERE fnsku IS NOT NULL;


/* ------------------------------------------------------------------ */
/* 5) RLS · las cajas las ve y las toca quien vea la remesa             */
/* ------------------------------------------------------------------ */

ALTER TABLE public.fba_cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fba_caja_contenido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Con acceso leen cajas" ON public.fba_cajas;
CREATE POLICY "Con acceso leen cajas"
  ON public.fba_cajas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fba_remesas r
    WHERE r.id = remesa_id AND public.puede_ver_remesas_de(auth.uid(), r.client_id)
  ));

DROP POLICY IF EXISTS "Con acceso leen contenido" ON public.fba_caja_contenido;
CREATE POLICY "Con acceso leen contenido"
  ON public.fba_caja_contenido FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fba_cajas c
    JOIN public.fba_remesas r ON r.id = c.remesa_id
    WHERE c.id = caja_id AND public.puede_ver_remesas_de(auth.uid(), r.client_id)
  ));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_cajas FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_caja_contenido FROM authenticated, anon;
