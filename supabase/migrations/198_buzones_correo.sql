-- ============================================================================
-- 198 · LOS BUZONES DE CORREO SE DAN DE ALTA UNA VEZ, EN SU PROPIO SITIO
-- ============================================================================
--
-- Hoy, para que el fichero de stock de un cliente llegue por correo, se elige
-- el origen «Correo» en el perfil de ese cliente y se TECLEA A MANO la
-- direccion del buzon. Tres problemas, y los tres se arreglan aqui:
--
--   1. La direccion se escribe una vez POR CLIENTE. Diez clientes que mandan
--      al mismo stock@ son diez sitios donde equivocarse de letra, y una letra
--      de mas da «ese buzon no existe» sin decir cual.
--   2. No hay forma de dar de alta un buzon QUE NO SEA DEL WORKSPACE. El
--      conector de Gmail entra por delegacion de dominio, asi que un buzon de
--      Hostinger escrito en ese campo no funciona, y el error que sale habla
--      de permisos de Google — que es el diagnostico equivocado y manda a
--      tocar la consola de Workspace para nada.
--   3. La contrasena de un buzon IMAP colgaba del PERFIL
--      (stock_origen_credenciales, PK = profile_id, migracion 124). Un buzon
--      compartido por diez clientes no cabe en ese modelo: o se teclea la
--      misma contrasena diez veces, o no se puede.
--
-- A partir de aqui hay UN CATALOGO DE BUZONES (public.stock_buzones) que es
-- configuracion de la AGENCIA, y el perfil de cada cliente solo APUNTA a uno.
--
--
-- ============ DONDE SE CONFIGURA «EL DOMINIO ESE» ============
--
-- En ninguna pantalla del ERP, y se deja escrito aqui porque es la pregunta
-- que se repite. El conector de Gmail (lib/stock-sync/origenes/correo.ts)
-- entra en el buzon suplantandolo con una cuenta de servicio, y eso se monta
-- en el panel de Google Workspace: Seguridad > Controles de API > Delegacion
-- en todo el dominio, dando de alta el Client ID de la cuenta de servicio con
-- el scope gmail.readonly (hoy solo tiene el de calendario).
--
-- Y SOLO SIRVE PARA BUZONES DE NUESTRO WORKSPACE. Un buzon de Hostinger, de
-- un hosting cualquiera o del propio cliente no se lee asi por mucho permiso
-- que se le de a Google: ese va por IMAP, con su servidor y su contrasena. Es
-- exactamente esa distincion la que este fichero saca de la cabeza de quien
-- configura y la mete en una columna (`transporte`).
--
--
-- ============ POR QUE buzon_id ES UNA COLUMNA Y NO UNA CLAVE DEL JSONB ======
--
-- Porque origen_config es texto libre: nada impide que apunte a un buzon
-- borrado, ni que el perfil del cliente A apunte al buzon del cliente B. Con
-- una columna hay clave ajena, hay indice, y hay dos triggers que lo vigilan
-- tambien cuando alguien escribe desde el editor SQL de Supabase — que es como
-- se trabaja en este repo la mitad de las veces.
--
--
-- ============ POR QUE EL BUZON TIENE DUENO (client_id) ============
--
-- Un catalogo COMPARTIDO entre clientes distintos es justo el sitio por donde
-- se cuela un cruce, y cruzar datos entre clientes es lo que este proyecto
-- tiene firmado con Amazon que no hace. Si el buzon del cliente A queda
-- elegible en el perfil del cliente B, el fichero de stock de uno acaba
-- publicado en la cuenta de Amazon del otro, y NO da ningun error: se publica
-- y ya esta.
--
--   client_id NULL  -> buzon de la agencia (stock@libertyseller.es). Cualquier
--                      perfil lo puede elegir. Lo que separa un cliente de
--                      otro dentro de ese buzon es el campo `remitente` del
--                      perfil, y por eso la pantalla avisa cuando esta vacio.
--   client_id lleno -> nos lo dio ESE cliente. Solo sus perfiles lo ven.
--
--
-- ============ POR QUE LA CONTRASENA VA EN OTRA TABLA ============
--
-- Por lo mismo que la 124: loadPerfiles() hace select('*') y esa respuesta
-- viaja entera al navegador. Una columna nueva en stock_buzones nace, por
-- omision, dentro de lo que ve el cliente. Con tabla aparte no hay nada que
-- acordarse de excluir.
--
--
-- ============ EL CHECK DE origen NO SE AMPLIA A 'imap', Y ES A PROPOSITO ====
--
-- La tentacion era anadir 'imap' a la lista de origenes validos, porque el
-- conector existe (lib/stock-sync/origenes/imap.ts). NO SE HACE, y conviene
-- que quede escrito para que nadie lo «arregle» dentro de seis meses:
--
--   · A partir de esta migracion NO HAY DOS ORIGENES DE CORREO. Hay uno,
--     'correo', y el BUZON elegido decide por dentro si se lee por la API de
--     Gmail o por IMAP. Quien configura no tiene que saber cual es cual: era
--     justo esa eleccion la que hacia equivocarse de pestana.
--   · Y ampliarlo seria armar una mina: `origen` SI esta en CAMPOS_EDITABLES
--     (lib/stock-sync/perfiles.ts), la ruta no valida su valor contra la lista
--     de conectores, y la pantalla busca el conector con
--     conectores.find(c => c.id === perfil.origen). Con 'imap' guardado eso
--     devuelve undefined: el perfil se queda sin campos, sin explorador y sin
--     ningun boton marcado, SIN UN SOLO ERROR EN PANTALLA, y el cron llamaria
--     al conector con la configuracion vacia cada quince minutos.
--     Hoy ese PATCH lo rechaza la base con un 23514. Se deja asi, y ademas la
--     ruta pasa a validarlo con una frase en espanol.
--
--
-- ============ QUE PASA CON LO QUE YA FUNCIONA ============
--
-- El bloque 5 da de alta en el catalogo las direcciones que ya estan tecleadas
-- y enlaza cada perfil con la suya. Un perfil de correo que hoy funciona sigue
-- funcionando sin tocarlo. Los que tengan basura en ese campo —que YA estaban
-- rotos— se apagan y se dicen por nombre al final: apagado y a la vista es
-- mejor que encendido leyendo el buzon de la casa, que es donde caerian.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) EL CATALOGO DE BUZONES                                           */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.stock_buzones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /** Como lo llama una persona: «Buzon de stock de la agencia» */
  nombre TEXT NOT NULL CHECK (btrim(nombre) <> ''),

  /**
   * La direccion del buzon, y es el dato principal a proposito: es lo unico
   * que alguien sabe de memoria, hace de `subject` de la suplantacion en
   * Gmail, hace de login por omision en IMAP, y es la clave natural para
   * detectar que un buzon se ha dado de alta dos veces.
   */
  direccion TEXT NOT NULL
    CHECK (direccion ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  /**
   * COMO SE ENTRA. Se GUARDA en vez de readivinarse en cada ciclo: readivinar
   * a las tres de la manana, cuando el dominio ha cambiado de proveedor, es
   * cambiar de comportamiento sin que nadie lo haya pedido.
   *   'google' -> API de Gmail, delegacion de dominio, SIN contrasena.
   *               Solo vale para direcciones de NUESTRO Workspace.
   *   'imap'   -> cualquier proveedor, con servidor y contrasena propios.
   */
  transporte TEXT NOT NULL DEFAULT 'imap'
    CHECK (transporte IN ('google', 'imap')),

  /**
   * DE QUIEN ES ESTE BUZON. NULL = de la agencia, elegible por el perfil de
   * cualquier cliente. Con valor = nos lo dio ESE cliente y solo sus perfiles
   * lo ven. Ver la cabecera: es lo que impide cruzar clientes.
   *
   * CASCADE y no RESTRICT a proposito: un buzon del cliente no significa nada
   * sin el cliente. Un CASCADE que BORRA un secreto es seguro; el peligroso
   * seria el que lo deja huerfano.
   */
  client_id UUID REFERENCES public.stock_clients(id) ON DELETE CASCADE,

  host TEXT,
  puerto INTEGER CHECK (puerto IS NULL OR puerto BETWEEN 1 AND 65535),

  /** NULL = el login ES la direccion. Solo se rellena en los proveedores
      raros cuyo usuario no coincide con el correo */
  usuario TEXT,

  /** La de fabrica. El perfil de un cliente concreto la puede pisar si le
      llega a una carpeta con regla */
  carpeta TEXT NOT NULL DEFAULT 'INBOX',

  /** false solo para servidores viejos que no cifran. Se avisa en pantalla */
  seguro BOOLEAN NOT NULL DEFAULT true,

  /** Apagar sin borrar. Convencion `activo` de las tablas de configuracion
      nuevas; las viejas en ingles usan is_active */
  activo BOOLEAN NOT NULL DEFAULT true,

  notas TEXT,

  /**
   * EL RESULTADO DEL BOTON «PROBAR», en tres columnas y no en una: «nunca se
   * probo» y «se probo y fallo» no se parecen en nada, y con una sola columna
   * se pareceran. La fecha se enseña SIEMPRE al lado del resultado: un «bien»
   * de hace tres semanas, con la contrasena caducada ayer, es una mentira.
   */
  ultima_prueba_at TIMESTAMPTZ,
  ultima_prueba_ok BOOLEAN,
  ultima_prueba_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  /** Un buzon IMAP sin servidor no se puede abrir */
  CONSTRAINT stock_buzones_imap_ok
    CHECK (transporte <> 'imap' OR btrim(COALESCE(host, '')) <> ''),

  /** Y uno de Gmail no tiene servidor que valga: se entra por la API, no por
      un host. Un host escrito ahi solo serviria para confundir */
  CONSTRAINT stock_buzones_google_ok
    CHECK (transporte <> 'google' OR (host IS NULL AND puerto IS NULL))
);

COMMENT ON TABLE public.stock_buzones IS
  'Los buzones de correo de los que el ERP saca ficheros de stock. Es configuracion de la AGENCIA: se da de alta cada buzon una vez y los perfiles de los clientes apuntan a el. client_id NULL = de la agencia, con valor = solo de ese cliente. La contrasena NO esta aqui: vive en stock_buzon_credenciales.';

COMMENT ON COLUMN public.stock_buzones.transporte IS
  'google = API de Gmail por delegacion de dominio, solo para direcciones de nuestro Workspace, sin contrasena. imap = cualquier proveedor, con host, puerto y contrasena propios.';

COMMENT ON COLUMN public.stock_buzones.client_id IS
  'NULL = buzon de la agencia, elegible por cualquier perfil. Con valor = nos lo dio ese cliente y solo sus perfiles pueden elegirlo. Lo vigila el trigger trg_stock_read_profiles_buzon.';

-- El mismo buzon dado de alta dos veces son dos contrasenas que se pisan y
-- nadie sabria cual esta usando el cron. Indice unico sobre expresiones y no
-- UNIQUE de columna, porque host es NULL en los de Google.
CREATE UNIQUE INDEX IF NOT EXISTS stock_buzones_identidad_idx
  ON public.stock_buzones (lower(direccion), lower(COALESCE(host, '')));

CREATE INDEX IF NOT EXISTS stock_buzones_elegibles_idx
  ON public.stock_buzones (client_id, nombre) WHERE activo;

DROP TRIGGER IF EXISTS trg_stock_buzones_updated ON public.stock_buzones;
CREATE TRIGGER trg_stock_buzones_updated
  BEFORE UPDATE ON public.stock_buzones
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_profiles_updated_at();

-- RLS nivel 1, el mismo de stock_read_profiles. La politica de SELECT no hace
-- falta para que el desplegable funcione —lo rellena el servidor con
-- service_role— pero se pone igual: es el segundo candado, el que sigue
-- diciendo que no si alguien restaura los GRANT.
ALTER TABLE public.stock_buzones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read stock buzones" ON public.stock_buzones;
CREATE POLICY "Admins read stock buzones"
  ON public.stock_buzones FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_buzones FROM authenticated, anon;


/* ------------------------------------------------------------------ */
/* 2) LA CONTRASENA DEL BUZON: TABLA APARTE Y CERRADA                  */
/* ------------------------------------------------------------------ */
-- Clon de 124_origenes_credenciales.sql, con otra clave y por su mismo motivo.

CREATE TABLE IF NOT EXISTS public.stock_buzon_credenciales (
  /**
   * La clave primaria ES el buzon. Un buzon, una contrasena: asi no hay forma
   * de que un buzon apunte a la contrasena de otro, ni de que queden filas
   * huerfanas cuando se borra un buzon (el CASCADE se las lleva).
   */
  buzon_id UUID PRIMARY KEY
    REFERENCES public.stock_buzones(id) ON DELETE CASCADE,

  /** Aqui solo hay contrasenas: IMAP no tiene clave privada. La columna queda
      por simetria con stock_origen_credenciales */
  tipo TEXT NOT NULL DEFAULT 'password' CHECK (tipo IN ('password')),

  /** 'v1.<iv>.<tag>.<ciphertext>' en base64url, AES-256-GCM. Ver la 124 */
  secreto_enc TEXT NOT NULL CHECK (btrim(secreto_enc) <> ''),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  /** Ultimos caracteres de la HUELLA (sha256) del valor CIFRADO, no del valor.
      Sirve para poder decir en pantalla «la contrasena ha cambiado» sin que
      exista ningun camino de vuelta al secreto. Lo escribe el servidor */
  huella TEXT
);

COMMENT ON TABLE public.stock_buzon_credenciales IS
  'Contrasenas de los buzones IMAP, cifradas con AES-256-GCM (lib/amazon/crypto.ts). Tabla aparte de stock_buzones a proposito: aquella se lee y viaja al navegador. Los buzones de transporte google NO tienen fila aqui: entran por delegacion de dominio.';

COMMENT ON COLUMN public.stock_buzon_credenciales.secreto_enc IS
  'Contrasena cifrada. NUNCA se devuelve al navegador, ni se escribe en un log, ni se mete en un mensaje de error.';

DROP TRIGGER IF EXISTS trg_stock_buzon_credenciales_updated ON public.stock_buzon_credenciales;
CREATE TRIGGER trg_stock_buzon_credenciales_updated
  BEFORE UPDATE ON public.stock_buzon_credenciales
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_profiles_updated_at();

-- ---------- NIVEL 2: NI SE LEE ----------
-- No hay politica de SELECT, y no es un olvido. REVOKE ALL y no la lista de
-- cuatro verbos: el GRANT ALL que Supabase reparte por omision incluye TRIGGER
-- y REFERENCES, y un trigger propio sobre esta tabla podria leer la columna del
-- secreto saltandose que no haya SELECT. TRUNCATE entra en el mismo saco, y
-- ademas RLS no se aplica a TRUNCATE.

ALTER TABLE public.stock_buzon_credenciales ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_buzon_credenciales FROM authenticated, anon;

-- Por si una migracion anterior o el panel dejaron alguna: se quitan todas.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_buzon_credenciales'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stock_buzon_credenciales', pol.policyname);
  END LOOP;
END $$;

-- FUERA DE REALTIME, y no por olvido: una publicacion emite la FILA ENTERA a
-- quien este suscrito, y esta fila lleva dentro la contrasena de un buzon.


/* ------------------------------------------------------------------ */
/* 3) EL ENGANCHE EN EL PERFIL, Y EL CANDADO CONTRA EL CRUCE           */
/* ------------------------------------------------------------------ */

/**
 * SIN «ON DELETE RESTRICT», Y ESTO NO ES UN DESCUIDO.
 *
 * Lo natural aqui parece RESTRICT: «un buzon que se esta usando no se borra».
 * Pero stock_clients CASCADEA a la vez sobre stock_read_profiles (120) y sobre
 * stock_buzones (bloque 1), y RESTRICT se comprueba INMEDIATAMENTE, no al
 * final de la sentencia. Borrar un cliente que tenia su propio buzon usado por
 * su propio perfil reventaria con «violates foreign key constraint» si el
 * disparador del buzon corre antes que el del perfil — y ese orden no lo
 * controla nadie.
 *
 * Con NO ACTION (lo de fabrica, que Postgres comprueba al final de la
 * sentencia) el borrado del cliente sale bien, porque para entonces sus
 * perfiles ya no estan. Y «no se borra un buzon en uso» sigue siendo verdad:
 * lo comprueba la ruta de borrado ANTES, con la lista de perfiles por nombre,
 * y si aun asi llega a la base, el 23503 se traduce a un 409 con esa lista.
 * La regla se mantiene; lo que cambia es quien la dice y con que frase.
 */
ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS buzon_id UUID
    REFERENCES public.stock_buzones(id);

COMMENT ON COLUMN public.stock_read_profiles.buzon_id IS
  'De que buzon del catalogo sale el fichero de este perfil. NULL en los perfiles que no leen de correo, y tambien en los de correo que usan la cuenta de siempre del ERP (GOOGLE_IMPERSONATE_SUBJECT). Un buzon en uso no se borra: lo impide la ruta de borrado, no la clave ajena (ver el comentario de la 198).';

CREATE INDEX IF NOT EXISTS stock_read_profiles_buzon_idx
  ON public.stock_read_profiles (buzon_id) WHERE buzon_id IS NOT NULL;

/**
 * EL PERFIL DE UN CLIENTE NO PUEDE APUNTAR AL BUZON DE OTRO.
 *
 * Un buzon de la agencia (client_id NULL) lo puede usar cualquiera. Uno con
 * dueno, solo sus perfiles. Sin esto, el fichero de stock del cliente A
 * acabaria publicado en la cuenta de Amazon del cliente B, que es el peor
 * fallo que puede dar este modulo y ademas uno que no da ningun error.
 *
 * La ruta comprueba lo mismo y da una frase en espanol; esto es el segundo
 * candado, el que sigue aqui cuando alguien escribe por otro camino — por
 * ejemplo desde este mismo editor SQL.
 */
CREATE OR REPLACE FUNCTION public.stock_perfil_buzon_del_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE duenyo UUID;
BEGIN
  IF NEW.buzon_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.client_id INTO duenyo
    FROM public.stock_buzones b WHERE b.id = NEW.buzon_id;

  IF duenyo IS NOT NULL AND duenyo <> NEW.client_id THEN
    RAISE EXCEPTION
      'Ese buzon es de otro cliente y este perfil no puede usarlo. Un buzon con dueno solo lo pueden elegir los perfiles de ese cliente; si es compartido, quitale el dueno en Amazon API > Buzones.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stock_read_profiles_buzon ON public.stock_read_profiles;
CREATE TRIGGER trg_stock_read_profiles_buzon
  BEFORE INSERT OR UPDATE OF buzon_id, client_id ON public.stock_read_profiles
  FOR EACH ROW EXECUTE FUNCTION public.stock_perfil_buzon_del_cliente();

/**
 * Y EL MISMO CANDADO POR EL OTRO LADO.
 *
 * El trigger de arriba vigila al perfil cuando elige buzon. Pero la regla se
 * puede romper tambien desde el buzon: dar dueno a un buzon de la agencia que
 * ya estan usando los perfiles de tres clientes distintos deja a dos de ellos
 * leyendo de un buzon que ya no es suyo, sin que nada lo diga.
 *
 * El ERRCODE es el mismo (check_violation, 23514) en los dos a proposito: la
 * ruta traduce los mensajes de la base mirando ese codigo, y un RAISE
 * EXCEPTION pelado sale como P0001, que esa traduccion no mira — el usuario
 * veria el error crudo de Postgres.
 */
CREATE OR REPLACE FUNCTION public.stock_buzon_dueno_compatible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cuantos INTEGER;
BEGIN
  IF NEW.client_id IS NULL OR NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO cuantos
    FROM public.stock_read_profiles p
   WHERE p.buzon_id = NEW.id AND p.client_id <> NEW.client_id;

  IF cuantos > 0 THEN
    RAISE EXCEPTION
      'No se le puede poner dueno a este buzon: lo estan usando % perfiles de otros clientes. Cambialos de buzon primero.', cuantos
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stock_buzones_dueno ON public.stock_buzones;
CREATE TRIGGER trg_stock_buzones_dueno
  BEFORE UPDATE OF client_id ON public.stock_buzones
  FOR EACH ROW EXECUTE FUNCTION public.stock_buzon_dueno_compatible();


/* ------------------------------------------------------------------ */
/* 4) PASO DE DATOS: LO QUE YA ESTABA TECLEADO                         */
/* ------------------------------------------------------------------ */
--
-- Idempotente: se puede relanzar el fichero entero sin duplicar nada.
--
-- EL DUENO NO SE PONE A NULL PARA TODOS, Y ESE ES EL DETALLE QUE IMPORTA.
-- Dar de alta todas las direcciones como buzones «de la agencia» seria abrir
-- de par en par justo el cruce que el resto del fichero existe para impedir:
-- la direccion que hoy esta tecleada en el perfil del cliente A —que puede ser
-- un buzon dedicado suyo— apareceria manana en el desplegable del cliente B.
--
-- Asi que el dueno se DEDUCE de lo que ya hay: si esa direccion la usa un solo
-- cliente, el buzon nace suyo. Solo si la comparten dos o mas nace de la
-- agencia, porque compartida ya estaba.

INSERT INTO public.stock_buzones (nombre, direccion, transporte, client_id)
SELECT 'Buzon ' || d.direccion,
       d.direccion,
       -- 'google' porque el conector de Gmail, por construccion, no podia
       -- estar leyendo otra cosa: todo lo que hay guardado hoy salio de ahi.
       'google',
       CASE WHEN d.cuantos_clientes = 1 THEN d.unico_cliente ELSE NULL END
  FROM (
    SELECT lower(btrim(p.origen_config->>'buzon')) AS direccion,
           COUNT(DISTINCT p.client_id)             AS cuantos_clientes,
           MIN(p.client_id::TEXT)::UUID            AS unico_cliente
      FROM public.stock_read_profiles p
     WHERE p.origen = 'correo'
       AND btrim(COALESCE(p.origen_config->>'buzon', '')) <> ''
       AND lower(btrim(p.origen_config->>'buzon'))
           ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     GROUP BY 1
  ) d
ON CONFLICT DO NOTHING;

-- El enlace. La condicion del dueno esta para que relanzar el fichero despues
-- de haber cambiado a mano el dueno de un buzon no reviente contra el trigger:
-- lo que no encaje se queda sin enlazar y sale por el apagado de abajo.
UPDATE public.stock_read_profiles p
   SET buzon_id = b.id
  FROM public.stock_buzones b
 WHERE p.origen = 'correo'
   AND p.buzon_id IS NULL
   AND b.transporte = 'google'
   AND lower(btrim(COALESCE(p.origen_config->>'buzon', ''))) = lower(b.direccion)
   AND (b.client_id IS NULL OR b.client_id = p.client_id);

/**
 * LOS QUE NO SE HAN PODIDO ENLAZAR SE APAGAN, Y NO ES UNA CRUELDAD.
 *
 * Un perfil de correo con algo tecleado en `buzon` que no se ha catalogado
 * —porque no parece una direccion, o porque el buzon que le tocaria es de otro
 * cliente— se quedaria con buzon_id NULL. Y buzon_id NULL significa, a partir
 * de ahora, «la cuenta de siempre del ERP»: ese perfil pasaria de fallar con
 * «ese buzon no existe» a LEER EN SILENCIO el buzon principal de la agencia,
 * filtrado solo por remitente, asunto y adjunto, que son los tres opcionales.
 *
 * O sea: de roto y a la vista, a funcionando mal y callado. Se apaga, se dice
 * cual, y se vuelve a encender desde la pantalla cuando se le elija buzon.
 */
UPDATE public.stock_read_profiles
   SET is_active = false
 WHERE origen = 'correo'
   AND buzon_id IS NULL
   AND btrim(COALESCE(origen_config->>'buzon', '')) <> ''
   AND is_active;

-- La clave 'buzon' se queda dentro de origen_config a proposito: es el unico
-- rastro de lo que se tecleo si el enlazado sale mal. Huerfana e inofensiva.


/* ------------------------------------------------------------------ */
/* 5) LA DOCUMENTACION DE origen_config, AL DIA                        */
/* ------------------------------------------------------------------ */

COMMENT ON COLUMN public.stock_read_profiles.origen_config IS
  'Configuracion del conector de origen. Formas conocidas: drive -> {folder_id, patron, unidad_compartida}; sftp/ftps -> {host, ruta, usuario}; correo -> {remitente, asunto, adjunto, adjunto_ean, dias, carpeta} (el buzon NO va aqui: va en la columna buzon_id); api -> {proveedor, entorno}. Nunca contrasenas ni tokens.';


/* ------------------------------------------------------------------ */
/* 6) COMPROBACION Y RECUENTO                                          */
/* ------------------------------------------------------------------ */
-- Lo que sale por pantalla al final NO es decorativo: si «apagados» no es
-- cero, ESO es lo primero que hay que mirar antes de seguir.

DO $$
DECLARE
  n_buzones   INTEGER;
  n_enlazados INTEGER;
  n_apagados  INTEGER;
  n_grants    INTEGER;
  nombres     TEXT;
BEGIN
  -- Que la tabla del secreto quedo cerrada de verdad.
  SELECT COUNT(*) INTO n_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'stock_buzon_credenciales'
     AND grantee IN ('authenticated', 'anon');

  IF n_grants > 0 THEN
    RAISE EXCEPTION
      'stock_buzon_credenciales ha quedado con % permisos para authenticated/anon. Ahi dentro van contrasenas de buzones: la migracion no se da por buena.', n_grants;
  END IF;

  SELECT COUNT(*) INTO n_buzones   FROM public.stock_buzones;
  SELECT COUNT(*) INTO n_enlazados FROM public.stock_read_profiles WHERE buzon_id IS NOT NULL;

  SELECT COUNT(*), string_agg(name, ', ' ORDER BY name)
    INTO n_apagados, nombres
    FROM public.stock_read_profiles
   WHERE origen = 'correo'
     AND buzon_id IS NULL
     AND btrim(COALESCE(origen_config->>'buzon', '')) <> '';

  RAISE NOTICE '198 aplicada. Buzones en el catalogo: %. Perfiles enlazados: %.',
    n_buzones, n_enlazados;

  IF n_apagados > 0 THEN
    RAISE NOTICE
      'ATENCION: % perfiles de correo se han APAGADO porque lo que tenian tecleado en el buzon no se ha podido catalogar: %. Dales de alta su buzon en Amazon API > Buzones, eligelo en el perfil y vuelve a encenderlos.',
      n_apagados, nombres;
  ELSE
    RAISE NOTICE 'Ningun perfil se ha quedado sin buzon. Nada que revisar.';
  END IF;
END $$;
