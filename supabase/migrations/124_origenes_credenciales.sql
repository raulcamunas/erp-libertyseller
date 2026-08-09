-- =====================================================
-- 124 · LAS CREDENCIALES DE LOS ORÍGENES DE FICHERO
-- =====================================================
-- Los tres exploradores de origen (Drive, SFTP y correo) necesitan una cosa que
-- hasta hoy el módulo de perfiles de lectura no guardaba: UNA CONTRASEÑA DE UN
-- CLIENTE. El SFTP de un cliente pide usuario y contraseña —o una clave
-- privada—, y eso no se puede dejar donde está el resto de la configuración.
--
--
-- ============ POR QUÉ UNA TABLA APARTE Y NO UNA COLUMNA ============
--
-- Lo natural sería añadir `origen_secreto_enc` a stock_read_profiles y ya está.
-- No se hace, por una razón muy concreta y muy fácil de olvidar:
--
--     lib/stock-sync/perfiles.ts carga los perfiles con `select('*')`,
--     y esa respuesta VIAJA ENTERA AL NAVEGADOR.
--
-- Una columna nueva en esa tabla nace, por omisión, dentro del JSON que recibe
-- la pantalla. Va cifrada, sí, pero un ciphertext en el navegador es material
-- que no tiene ninguna razón para salir del servidor: se queda en la caché del
-- disco, en el historial de la pestaña de red y en cualquier extensión que lea
-- respuestas. Y la protección dependería de que nadie, nunca, olvide excluir esa
-- columna de un `select('*')` — que es exactamente la clase de candado que se
-- rompe seis meses después, en un `select` escrito con prisa por otra persona.
--
-- Con una tabla aparte el candado no depende de la memoria de nadie: la fila
-- solo aparece si alguien la pide explícitamente, y el único sitio que la pide
-- es lib/stock-sync/origenes/credenciales.ts.
--
-- Es el mismo razonamiento que llevó a DESTINO_FIELDS en lib/stock-sync/
-- perfiles.ts (lista de columnas escrita a mano para que refresh_token_enc no
-- salga de amazon_connections), pero un paso más allá: allí hay que acordarse de
-- la lista; aquí no hay nada que recordar.
--
--
-- ============ CÓMO ESTÁ CIFRADO ============
--
-- AES-256-GCM con lib/amazon/crypto.ts (encryptToken / decryptToken), la misma
-- función y la misma clave (AMAZON_TOKEN_KEY) que protege los refresh token de
-- Amazon. Lo pidió así el encargo.
--
-- CONSECUENCIA QUE HAY QUE SABER: al compartir función se comparte el AAD
-- ('amazon.refresh_token.v1'), o sea que un valor cifrado de aquí se puede pegar
-- en amazon_connections.refresh_token_enc y descifra sin protestar (y al revés).
-- Eso NO abre ningún camino nuevo a quien no tenga ya la clave —el AAD no es un
-- permiso, es una etiqueta— pero sí quita la red que impide confundir dos
-- columnas al restaurar una copia de seguridad a mano. Si algún día se quiere
-- separar, es un fichero nuevo con `const AAD = 'stock.origen.credencial.v1'` y
-- un recifrado de estas filas; el formato guardado ('v1.<iv>.<tag>.<ct>') ya
-- lleva versión delante justo para eso.
--
-- Y LO QUE EL CIFRADO NO HACE: proteger de quien ya ejecuta código en nuestro
-- servidor. Protege el VOLCADO de la base —una copia de seguridad, el panel de
-- Supabase, la service key— que es donde una contraseña de SFTP de un cliente
-- se queda tirada durante años.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: reventar
-- aquí deja la base intacta en vez de a medias.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stock_read_profiles'
  ) THEN
    RAISE EXCEPTION
      'No existe public.stock_read_profiles. Lanza antes 120_stock_profiles.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían esta tabla abierta a cualquiera.';
  END IF;
END $$;

-- =====================================================
-- 1 · LA TABLA
-- =====================================================

CREATE TABLE IF NOT EXISTS public.stock_origen_credenciales (
  -- La clave primaria ES el perfil, no un id suelto. Un perfil, una credencial:
  -- así no hay forma de que la configuración de un perfil apunte a la
  -- contraseña de otro, ni de que queden filas huérfanas cuando se borra un
  -- perfil (el CASCADE se las lleva).
  profile_id UUID PRIMARY KEY
    REFERENCES public.stock_read_profiles(id) ON DELETE CASCADE,

  -- Qué es lo que hay guardado. Lo necesita el conector para decidir si se lo
  -- pasa a ssh2 como `password` o como `privateKey`, y lo necesita la pantalla
  -- para decir «hay una clave privada guardada» sin enseñar nada.
  tipo TEXT NOT NULL CHECK (tipo IN ('password', 'clave_privada')),

  -- 'v1.<iv>.<tag>.<ciphertext>' en base64url. Ver la cabecera.
  secreto_enc TEXT NOT NULL CHECK (btrim(secreto_enc) <> ''),

  -- La frase de paso de la clave privada, si la tiene. Va cifrada igual: una
  -- clave privada protegida por una frase de paso guardada en claro al lado es
  -- una clave privada sin proteger.
  passphrase_enc TEXT,

  -- Los cuatro datos que hacen falta para auditar sin revelar nada.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Últimos cuatro caracteres de la HUELLA (sha256) del valor cifrado, no del
  -- valor. Sirve para que la pantalla pueda decir «la credencial ha cambiado»
  -- sin que exista ningún camino de vuelta al secreto. No se calcula en SQL: lo
  -- escribe el servidor, que es quien tiene el valor delante.
  huella TEXT
);

COMMENT ON TABLE public.stock_origen_credenciales IS
  'Contraseñas y claves privadas de los orígenes de fichero de los clientes (SFTP, y lo que venga). Cifradas con AES-256-GCM (lib/amazon/crypto.ts). Tabla aparte de stock_read_profiles a propósito: aquella se carga con select(*) y viaja al navegador.';

COMMENT ON COLUMN public.stock_origen_credenciales.secreto_enc IS
  'Contraseña o clave privada cifrada. NUNCA se devuelve al navegador, ni se escribe en un log, ni se mete en un mensaje de error.';

COMMENT ON COLUMN public.stock_origen_credenciales.huella IS
  'Huella corta y NO reversible del valor cifrado, solo para poder decir en pantalla que la credencial ha cambiado.';

-- updated_at: se reutiliza la función que ya creó la 120 para este mismo módulo
-- (public.update_stock_profiles_updated_at). El CREATE OR REPLACE la deja igual
-- si ya está y la crea si la base viniera a medio migrar: es la misma definición
-- literal, así que repetirla no cambia nada de lo que ya funciona.
CREATE OR REPLACE FUNCTION public.update_stock_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_origen_credenciales_updated ON public.stock_origen_credenciales;
CREATE TRIGGER trg_stock_origen_credenciales_updated
  BEFORE UPDATE ON public.stock_origen_credenciales
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_profiles_updated_at();

-- =====================================================
-- 2 · QUIÉN PUEDE TOCARLA: NADIE DESDE EL NAVEGADOR
-- =====================================================
-- Nivel 2 del ERP, el mismo que amazon_connections: NI SE LEE. No hay política
-- de SELECT, así que aunque alguien restaurara los GRANT algún día, RLS seguiría
-- diciendo que no. Son dos candados en el mismo sentido, y es a propósito.
--
-- REVOKE ALL y no la lista de cuatro verbos: el GRANT ALL que Supabase reparte
-- por omisión incluye TRIGGER y REFERENCES, y un trigger propio sobre esta tabla
-- podría leer la columna del secreto saltándose que no haya SELECT. TRUNCATE
-- entra en el mismo saco y además RLS no se aplica a TRUNCATE.
--
-- El único que entra aquí es service_role, desde
-- lib/stock-sync/origenes/credenciales.ts, y solo después de requireAmazonAdmin().

ALTER TABLE public.stock_origen_credenciales ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_origen_credenciales FROM authenticated, anon;

-- Por si una migración anterior o el panel dejaron alguna: se quitan todas.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_origen_credenciales'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stock_origen_credenciales', pol.policyname);
  END LOOP;
END $$;

-- FUERA DE REALTIME, y no por olvido: una publicación emite la FILA ENTERA a
-- quien esté suscrito, y esta fila lleva dentro la contraseña del cliente.
-- Es la misma razón por la que amazon_connections tampoco está.

-- =====================================================
-- 3 · COMPROBACIÓN
-- =====================================================
DO $$
DECLARE
  n_politicas INTEGER;
  n_grants INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_politicas
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'stock_origen_credenciales';

  SELECT COUNT(*) INTO n_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'stock_origen_credenciales'
    AND grantee IN ('authenticated', 'anon');

  IF n_politicas > 0 OR n_grants > 0 THEN
    RAISE EXCEPTION
      'La tabla de credenciales ha quedado accesible (% políticas, % permisos). Revisa la sección 2 antes de guardar ninguna contraseña.',
      n_politicas, n_grants;
  END IF;

  RAISE NOTICE 'Migración 124 aplicada: stock_origen_credenciales creada y cerrada al navegador.';
END $$;
