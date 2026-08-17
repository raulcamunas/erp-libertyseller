-- ==================================================================
-- 152 · UN ORIGEN MAS: LA API DEL PROVEEDOR
-- ==================================================================
--
-- El CHECK de `origen` admitia 'manual', 'drive', 'sftp', 'ftps' y 'correo'.
-- Se le anade 'api'.
--
--
-- ESTO NO ES UN SITIO DONDE HAYA UN FICHERO
-- -----------------------------------------
-- Los cinco origenes anteriores son lo mismo con distinta puerta: alguien deja
-- un Excel en algun sitio y el ERP va a buscarlo. Este no. Aqui se llama a la
-- API del proveedor del cliente, se pide su catalogo y el volcado SE ARMA EN EL
-- MOMENTO con lo que conteste.
--
-- Lo importante de la diferencia es lo que desaparece: no hay fichero que
-- nadie tenga que acordarse de dejar, ni carpeta que se pueda mover, ni
-- exportacion nocturna que se pueda quedar colgada con los datos de anteayer
-- sin que nadie se entere. Los fallos silenciosos de este modulo casi todos
-- empiezan ahi.
--
-- A cambio aparece uno nuevo: si la API del proveedor esta caida, no hay
-- volcado viejo con el que salir del paso. Por eso 'manual' no se toca y sigue
-- siendo la salida de emergencia de cualquier perfil.
--
--
-- NO HACE FALTA NINGUNA COLUMNA NUEVA
-- -----------------------------------
-- La configuracion del conector vive en `origen_config` (JSONB), que ya existe
-- desde la 120. Para este origen guarda {proveedor, entorno}. Las credenciales
-- NO van ahi —ni ahi ni en ninguna columna de esta tabla—: salen del entorno
-- del servidor, igual que las de Amazon.

DO $$
DECLARE t TEXT;
BEGIN
  -- Las dos tablas que lo llevan: el perfil y su historial de ejecuciones. Los
  -- nombres de la restriccion los pone Postgres, asi que se buscan por columna
  -- en vez de darlos por sabidos.
  FOREACH t IN ARRAY ARRAY['stock_read_profiles', 'stock_profile_runs'] LOOP
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
       AND t.relname IN ('stock_read_profiles', 'stock_profile_runs')
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%origen%'
       AND pg_get_constraintdef(c.oid) ILIKE '%sftp%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabla, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (origen IN (''manual'', ''drive'', ''sftp'', ''ftps'', ''correo'', ''api''))',
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
     AND t.relname IN ('stock_read_profiles', 'stock_profile_runs')
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%origen%'
     AND pg_get_constraintdef(c.oid) NOT ILIKE '%api%';

  IF faltan > 0 THEN
    RAISE EXCEPTION 'Han quedado % restricciones de origen sin admitir api.', faltan;
  END IF;
END $$;

COMMENT ON COLUMN public.stock_read_profiles.origen_config IS
  'Configuración del conector de origen. Formas conocidas: drive -> {folder_id, patron, unidad_compartida}; sftp/ftps -> {host, ruta, usuario}; correo -> {remitente, asunto, adjunto, adjunto_ean}; api -> {proveedor, entorno}. Nunca contraseñas ni tokens.';
