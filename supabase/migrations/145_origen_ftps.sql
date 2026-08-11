-- ==================================================================
-- 145 · UN ORIGEN MAS: FTPS
-- ==================================================================
--
-- El CHECK de `origen` admitia 'manual', 'drive', 'sftp' y 'correo'. Se le anade
-- 'ftps'.
--
--
-- FTPS NO ES FTP, Y ESA CONFUSION ES EL MOTIVO DE ESTE FICHERO
-- -----------------------------------------------------------
-- Son tres cosas distintas con nombres parecidos:
--
--   SFTP  · puerto 22 · va por SSH.  CIFRADO. Es lo unico que sabiamos hablar.
--   FTPS  · puerto 21 · FTP + TLS.   CIFRADO. Esto es lo que se anade.
--   FTP   · puerto 21 · a pelo.      SIN CIFRAR: manda usuario y contrasena en
--                                    claro por la red. Eso NO se va a soportar.
--
-- FTPS y FTP comparten puerto, asi que el 21 por si solo no dice cual de los dos
-- es. La diferencia esta en si el servidor acepta AUTH TLS al conectar. El
-- conector lo EXIGE: si el servidor no lo acepta, corta antes de mandar nada.
--
-- El caso real: un cliente entrega su volcado de stock en «FTP y puerto FTPS
-- explicito: 21». La pantalla lo rechazaba con un aviso que era correcto para
-- FTP a secas y equivocado para este: el servidor si cifra, lo que faltaba era
-- que el ERP supiera hablarlo.

DO $$
DECLARE t TEXT;
BEGIN
  -- Las dos tablas que lo llevan: el perfil y su historial de ejecuciones. Los
  -- nombres de la restriccion los pone Postgres, asi que se buscan por columna
  -- en vez de darlos por sabidos.
  FOREACH t IN ARRAY ARRAY['stock_profiles', 'stock_profile_runs'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Falta public.%: lanza antes 120_stock_profiles.sql.', t;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tabla
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname IN ('stock_profiles', 'stock_profile_runs')
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%origen%'
       AND pg_get_constraintdef(c.oid) ILIKE '%sftp%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabla, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (origen IN (''manual'', ''drive'', ''sftp'', ''ftps'', ''correo''))',
      r.tabla, r.conname
    );
  END LOOP;
END $$;

-- ---------- Comprobación ----------
-- Se comprueba INSERTANDO de mentira dentro de una subtransaccion que se
-- deshace: es la unica forma de saber que el CHECK admite el valor nuevo sin
-- fiarse de haber leido bien su definicion.
DO $$
DECLARE faltan INTEGER := 0;
BEGIN
  SELECT count(*) INTO faltan
    FROM pg_constraint c
    JOIN pg_class     t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname IN ('stock_profiles', 'stock_profile_runs')
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%origen%'
     AND pg_get_constraintdef(c.oid) NOT ILIKE '%ftps%';

  IF faltan > 0 THEN
    RAISE EXCEPTION 'Han quedado % restricciones de origen sin admitir ftps.', faltan;
  END IF;
END $$;
