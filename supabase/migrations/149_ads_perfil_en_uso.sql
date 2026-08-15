-- ==================================================================
-- 149 · QUE CUENTAS DE ANUNCIANTE SE TRABAJAN DE VERDAD
-- ==================================================================
--
-- Al conectar, Amazon devuelve TODAS las cuentas a las que llega el Gmail que
-- autorizo. Y eso incluye las de encargos viejos: en la primera conexion real
-- salieron tres cuentas de un cliente al que ya no se le lleva la publicidad.
--
-- Traerlas no es el problema —hay que verlas para poder elegir—. El problema
-- seria darlas por buenas: cada cuenta que el ERP considere suya es cupo de la
-- API gastado en pedir informes que nadie mira, y datos de un anunciante que ya
-- no es cliente guardados en nuestra base. Eso segundo no es un detalle de
-- limpieza, es el compromiso firmado con Amazon: los datos de un vendedor se
-- usan exclusivamente para operar SU cuenta.
--
--
-- NACE APAGADO. SIEMPRE
-- ---------------------
-- DEFAULT false y sin excepciones. Una cuenta empieza a trabajarse porque
-- alguien la marca, nunca porque apareciera en una lista. Al reves —encendidas
-- por omision— la unica forma de no trabajar una cuenta seria acordarse de
-- apagarla, y de eso nadie se acuerda: se descubre tres meses despues mirando
-- por que el informe tarda el triple.
--
-- Y por eso mismo se marca la COLUMNA, no se borran las filas: una cuenta que
-- no se usa hoy puede ser un cliente el mes que viene, y borrarla haria que
-- volviera a aparecer en cada refresco como si fuera nueva.

DO $$
BEGIN
  IF to_regclass('public.ads_profiles') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_profiles: lanza antes 148_ads_api.sql.';
  END IF;
END $$;

ALTER TABLE public.ads_profiles
  ADD COLUMN IF NOT EXISTS en_uso BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ads_profiles.en_uso IS
  'true = esta cuenta de anunciante se trabaja: se le piden informes y se guardan '
  'sus datos. NACE EN false a proposito: al conectar salen todas las cuentas a las '
  'que llega el correo que autorizo, incluidas las de encargos viejos.';

-- ---------- Comprobacion ----------
DO $$
DECLARE por_defecto TEXT;
BEGIN
  SELECT column_default INTO por_defecto
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ads_profiles'
     AND column_name = 'en_uso';

  IF por_defecto IS NULL THEN
    RAISE EXCEPTION 'No se ha creado ads_profiles.en_uso.';
  END IF;
  IF por_defecto NOT ILIKE '%false%' THEN
    RAISE EXCEPTION
      'ads_profiles.en_uso no nace en false (default: %). Con true por omision, cada cuenta '
      'que apareciera al conectar se daria por buena sin que nadie la eligiera.', por_defecto;
  END IF;
END $$;
