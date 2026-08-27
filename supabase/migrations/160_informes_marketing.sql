-- ==================================================================
-- 160 · INFORMES DE MARKETING
-- ==================================================================
--
-- Un sitio donde pedir los informes de Amazon Ads de una cuenta y unas fechas, y
-- volver luego a por el Excel.
--
--
-- POR QUE HAY QUE ENCARGARLOS Y NO SE PUEDEN «PEDIR Y YA»
-- ------------------------------------------------------
-- Los informes de la v3 de Ads van en tres pasos: se piden, Amazon los prepara,
-- y cuando estan se descargan de una URL firmada. Entre el primero y el tercero
-- pasan de diez segundos a varios minutos, POR INFORME. Y una plantilla puede
-- ser varias peticiones —«Campaña» son tres: Products, Brands y Display—, asi
-- que un Excel de nueve plantillas son doce o quince informes.
--
-- Eso no cabe en una peticion HTTP y no hay forma de que quepa. De ahi este par
-- de tablas: el encargo queda escrito, un proceso lo va empujando cada pocos
-- minutos, y quien lo pidio vuelve cuando esta.
--
--
-- POR QUE LAS FILAS NO SE GUARDAN AQUI
-- ------------------------------------
-- Un informe de terminos de busqueda de un mes son decenas de miles de filas.
-- Por doce informes, y por cada encargo. Guardarlas seria llenar la base con
-- copias de algo que Amazon ya tiene — y esta base ya se paso de cuota una vez
-- por escribir series que nadie leia.
--
-- Se guarda el `report_id`, que es lo unico que hace falta: preguntando por el
-- se obtiene una URL NUEVA cada vez. La URL caduca en minutos; el informe, no.
-- El Excel se arma al descargarlo, con los datos recien traidos.

-- ---------- El encargo ----------
CREATE TABLE IF NOT EXISTS public.marketing_informes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A quien se le piden. El perfil de Ads ya sabe de que cliente es y en que
  -- pais, asi que no hace falta repetirlo.
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,

  -- El rango, en dias. Amazon los quiere como AAAA-MM-DD y en la zona horaria
  -- del perfil, que por eso se guarda en ads_profiles.
  desde DATE NOT NULL,
  hasta DATE NOT NULL,

  -- Que plantillas se han pedido. Los identificadores son los de
  -- lib/ads/plantillas.ts, que es donde vive el catalogo.
  plantillas TEXT[] NOT NULL,

  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'preparando', 'listo', 'error', 'cancelado')),
  error TEXT,

  pedido_por UUID REFERENCES public.profiles(id),
  pedido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  listo_at TIMESTAMPTZ,
  -- Ultima vez que el proceso lo miro. Sirve para ver si se ha quedado parado.
  tocado_at TIMESTAMPTZ,
  descargado_veces INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT marketing_informes_rango CHECK (hasta >= desde),
  CONSTRAINT marketing_informes_algo_que_pedir CHECK (cardinality(plantillas) > 0)
);

CREATE INDEX IF NOT EXISTS idx_marketing_informes_estado
  ON public.marketing_informes (estado, pedido_at);
CREATE INDEX IF NOT EXISTS idx_marketing_informes_perfil
  ON public.marketing_informes (perfil_id, pedido_at DESC);

COMMENT ON TABLE public.marketing_informes IS
  'Encargos de informes de Amazon Ads. El Excel se arma al descargarlo: aqui solo vive el encargo y los identificadores de informe de Amazon.';

-- ---------- Cada peticion suelta ----------
-- Una fila por VARIANTE, no por plantilla: «Campaña» son tres informes
-- distintos (Products, Brands, Display) y cada uno se pide, se espera y falla
-- por su cuenta. Que Brands no exista en esa cuenta no puede dejar sin informe
-- a Products.
CREATE TABLE IF NOT EXISTS public.marketing_informe_partes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  informe_id UUID NOT NULL REFERENCES public.marketing_informes(id) ON DELETE CASCADE,

  plantilla TEXT NOT NULL,
  -- Con que se pidio, copiado del catalogo EN EL MOMENTO DE PEDIRLO. Si mañana
  -- se cambian las columnas de una plantilla, un encargo viejo tiene que seguir
  -- sabiendo con que se hizo — o el Excel saldria con otras columnas que las que
  -- se encargaron y nadie sabria por que.
  report_type_id TEXT NOT NULL,
  ad_product TEXT NOT NULL,
  columnas TEXT[] NOT NULL,
  hoja TEXT NOT NULL,

  -- El identificador que da Amazon. Con el se pide una URL nueva cuando haga
  -- falta: la URL caduca a los pocos minutos, el informe no.
  report_id TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'pedido', 'listo', 'error', 'sin_datos')),
  error TEXT,
  filas INTEGER,

  intentos INTEGER NOT NULL DEFAULT 0,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_partes_informe
  ON public.marketing_informe_partes (informe_id);

COMMENT ON COLUMN public.marketing_informe_partes.columnas IS
  'Las columnas con las que se pidio, copiadas del catalogo en ese momento. Un encargo viejo tiene que poder explicarse solo.';
COMMENT ON COLUMN public.marketing_informe_partes.estado IS
  'sin_datos = Amazon lo preparo y no habia nada en ese rango. No es un error: es una respuesta.';

-- ---------- RLS ----------
ALTER TABLE public.marketing_informes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_informe_partes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_informes_admin ON public.marketing_informes;
CREATE POLICY marketing_informes_admin ON public.marketing_informes
  FOR ALL USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS marketing_partes_admin ON public.marketing_informe_partes;
CREATE POLICY marketing_partes_admin ON public.marketing_informe_partes
  FOR ALL USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- ---------- Comprobacion ----------
DO $$
BEGIN
  IF to_regclass('public.marketing_informes') IS NULL
     OR to_regclass('public.marketing_informe_partes') IS NULL THEN
    RAISE EXCEPTION 'No se han creado las tablas de informes de marketing.';
  END IF;
  -- Sin ads_profiles esto no puede existir: el encargo apunta a un perfil.
  IF to_regclass('public.ads_profiles') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_profiles. Aplica antes la migracion de Amazon Ads.';
  END IF;
  RAISE NOTICE 'Informes de marketing: tablas listas.';
END $$;
