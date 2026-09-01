-- ==================================================================
-- 170 · EL PROGRAMADOR DE INFORMES DE MARKETING
-- ==================================================================
--
-- Un calendario donde cada dia que se marca lleva su cliente y su periodo. La
-- gracia es que el periodo NO es fijo: la idea es poder montar «esta semana 7
-- dias, la siguiente 14, la otra 7, la otra 4 semanas» y verlo de un vistazo.
-- Por eso no hay una tabla de «reglas que se repiten» sino una fila por fecha:
-- el calendario ES el plan.
--
--
-- EL PERIODO VA POR SEMANAS COMPLETAS, NO POR DIAS HACIA ATRAS
-- ------------------------------------------------------------
-- Y esta es la regla que hace que los informes sirvan para comparar.
--
-- Un informe programado para el MIERCOLES con periodo de 7 dias NO coge del
-- miercoles anterior al martes: coge LA SEMANA ANTERIOR COMPLETA, de lunes a
-- domingo. Con 14 dias, las dos semanas anteriores completas. Con 4 semanas,
-- las cuatro.
--
-- Asi dos informes del mismo cliente en semanas distintas cubren periodos
-- comparables, y el numero de una semana es siempre el mismo lo mires el
-- miercoles o el viernes. Con «ultimos 7 dias» cada informe cortaria por un
-- sitio distinto y no habria forma de poner dos al lado.
--
--
-- NO SE GUARDA NINGUN EXCEL
-- -------------------------
-- El fichero se arma al descargarlo, nunca antes —ver la ruta del Excel—. Lo
-- unico que se guarda es el identificador que devuelve Amazon, que es texto. Asi
-- que aqui no hay nada que ocupe espacio y nada que purgar por tamaño; lo que se
-- purga son las filas viejas, y eso va en lib/plataforma/limpieza.ts.

CREATE TABLE IF NOT EXISTS public.marketing_programaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La cuenta de anunciante de Amazon Ads, no el cliente del ERP: es lo que
  -- identifica de quien son los datos que se piden.
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,

  /** El dia en que hay que generarlo. Una fila por dia marcado en el calendario */
  fecha DATE NOT NULL,

  -- '7d' = la semana anterior completa · '14d' = las dos anteriores
  -- '4s'  = las cuatro anteriores, que es el mensual de la agencia
  periodo TEXT NOT NULL CHECK (periodo IN ('7d', '14d', '4s')),

  -- Que informes pedir. Vacio = los que se puedan pedir, que es lo normal.
  plantillas TEXT[] NOT NULL DEFAULT '{}',

  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'lanzado', 'error')),

  -- El encargo que genero, cuando ya se ha lanzado. Si se borra el encargo esto
  -- vuelve a NULL y la fila se queda como constancia de que se programo.
  informe_id UUID REFERENCES public.marketing_informes(id) ON DELETE SET NULL,

  error TEXT,
  lanzado_at TIMESTAMPTZ,

  creado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dos veces el mismo cliente, el mismo dia y el mismo periodo es un clic
  -- repetido, no dos informes. Distinto periodo el mismo dia SI vale: puede
  -- interesar el semanal y el mensual a la vez.
  UNIQUE (perfil_id, fecha, periodo)
);

CREATE INDEX IF NOT EXISTS marketing_programaciones_pendientes_idx
  ON public.marketing_programaciones (fecha)
  WHERE estado = 'pendiente';

COMMENT ON TABLE public.marketing_programaciones IS
  'El calendario de informes de Amazon Ads: una fila por dia marcado, con su cuenta y su periodo. El periodo se resuelve SIEMPRE a semanas completas de lunes a domingo anteriores a esa fecha.';
COMMENT ON COLUMN public.marketing_programaciones.periodo IS
  '7d = la semana anterior completa. 14d = las dos anteriores. 4s = las cuatro. Nunca «ultimos N dias»: si no, dos informes del mismo cliente no se podrian comparar.';

ALTER TABLE public.marketing_programaciones ENABLE ROW LEVEL SECURITY;

-- Mismo criterio que el resto del modulo: lo lee y escribe quien tiene la app de
-- marketing, y el trabajo automatico va con la clave de servicio.
DROP POLICY IF EXISTS marketing_programaciones_lectura ON public.marketing_programaciones;
CREATE POLICY marketing_programaciones_lectura ON public.marketing_programaciones
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS marketing_programaciones_escritura ON public.marketing_programaciones;
CREATE POLICY marketing_programaciones_escritura ON public.marketing_programaciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- Comprobacion ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'marketing_programaciones'
  ) THEN
    RAISE EXCEPTION 'La tabla marketing_programaciones no se ha creado.';
  END IF;
  RAISE NOTICE 'Listo. Ya se pueden programar informes desde el calendario de Informes Marketing.';
END $$;
