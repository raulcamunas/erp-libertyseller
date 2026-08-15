-- ==================================================================
-- 148 · MARKETING API · LA CONEXION CON AMAZON ADS
-- ==================================================================
--
-- El primer ladrillo y NADA MAS: guardar la autorizacion de cada cliente y sus
-- cuentas de anunciante. Ni campañas, ni informes, ni metricas. Eso se monta
-- despues, cuando se sepa que estructura hace falta de verdad.
--
--
-- POR QUE UNA TABLA APARTE Y NO amazon_connections
-- ------------------------------------------------
-- Porque son DOS AUTORIZACIONES DISTINTAS del mismo cliente, con aplicaciones
-- LWA distintas, scopes distintos y ciclos de vida independientes:
--
--   amazon_connections -> Selling Partner API. Catalogo, stock, precios.
--                         App: AMAZON_LWA_CLIENT_ID.
--   ads_connections    -> Advertising API. Campañas e informes.
--                         App: AMAZON_ADS_CLIENT_ID, scope
--                         advertising::campaign_management.
--
-- Un cliente puede tener una y no la otra —de hecho es lo normal al empezar— y
-- revocar una no revoca la otra. Meterlas en la misma tabla obligaria a que la
-- mitad de las columnas fueran NULL segun el caso, y a que cada consulta se
-- acordara de filtrar por cual es. Eso se olvida una vez y se lee el token
-- equivocado.
--
--
-- EL TOKEN VA CIFRADO, igual que en SP-API
-- ----------------------------------------
-- Con la misma AES-256-GCM de lib/amazon/crypto.ts y la misma llave
-- (AMAZON_TOKEN_KEY). Aqui se guarda el texto cifrado y nada mas: la base nunca
-- ve un refresh token en claro, ni siquiera un administrador mirando la tabla.
--
-- Y NINGUNA POLITICA RLS DA ACCESO A `authenticated`. Ni de lectura. El token de
-- un cliente solo lo toca el servidor con la llave de servicio, dentro de la
-- llamada que lo va a usar. Es la misma decision que en la migracion 118 y por
-- el mismo motivo: la clave anonima viaja en el navegador.

DO $$
BEGIN
  IF to_regclass('public.amazon_clients') IS NULL THEN
    RAISE EXCEPTION 'Falta public.amazon_clients: lanza antes 118_amazon_api.sql.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION 'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql.';
  END IF;
END $$;

-- =====================================================
-- 1) LA AUTORIZACION DE CADA CLIENTE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.ads_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /**
   * La region del ENDPOINT, que no es el pais del anunciante.
   *
   * Un cliente español y uno aleman comparten el mismo servidor
   * (advertising-api-eu). Lo que cambia por pais es el PERFIL, que va en la
   * tabla de abajo. Confundirlos lleva a llamar al servidor americano con un
   * token europeo, que contesta 401 sin explicar nada.
   */
  region TEXT NOT NULL DEFAULT 'eu' CHECK (region IN ('eu', 'na', 'fe')),

  /** AES-256-GCM. NUNCA en claro. Ver la cabecera */
  refresh_token_cifrado TEXT NOT NULL,

  /**
   * El access token tambien cifrado, con su caducidad.
   *
   * Se guarda para no pedir uno nuevo en cada llamada: duran una hora y el
   * canje cuesta un viaje a Amazon. Es cache, no un dato: borrarlo no rompe
   * nada, solo obliga a renovarlo.
   */
  access_token_cifrado TEXT,
  access_token_expira_at TIMESTAMPTZ,

  estado TEXT NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'revocada', 'error')),
  /** Lo ultimo que contesto Amazon cuando fallo. En español y para enseñar */
  ultimo_error TEXT,

  conectado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  conectado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_uso_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Una autorizacion por cliente y region. Volver a conectar ACTUALIZA la que
  -- hay en vez de dejar dos tokens vivos de los que nadie sabe cual se usa.
  UNIQUE (client_id, region)
);

-- =====================================================
-- 2) SUS CUENTAS DE ANUNCIANTE (los «perfiles» de Ads)
-- =====================================================
--
-- Un perfil es «esta cuenta de anunciante, en este pais». Un cliente que vende
-- en cinco paises tiene cinco perfiles bajo la MISMA autorizacion, y cada
-- llamada a la API lleva el suyo en la cabecera Amazon-Advertising-API-Scope.
-- Sin ese numero no se puede pedir absolutamente nada, asi que es lo primero
-- que hay que traer despues de conectar.
CREATE TABLE IF NOT EXISTS public.ads_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.ads_connections(id) ON DELETE CASCADE,

  /** El profileId de Amazon. Es lo que va en la cabecera de cada llamada */
  profile_id BIGINT NOT NULL,
  pais TEXT,
  moneda TEXT,
  zona_horaria TEXT,
  /** 'seller' | 'vendor' | 'agency'. Cambia que endpoints admite */
  tipo TEXT,
  nombre TEXT,
  /** El id de vendedor o de proveedor, para cruzarlo con SP-API */
  id_externo TEXT,

  /**
   * La respuesta de Amazon TAL CUAL.
   *
   * Se guarda entera a proposito y solo en esta fase: todavia no se sabe que
   * campos van a hacer falta, y el coste de descubrirlo con el dato delante es
   * cero frente a volver a pedirselo a Amazon. Cuando la estructura este
   * decidida, esta columna se recorta o se va.
   */
  crudo JSONB NOT NULL DEFAULT '{}'::jsonb,

  visto_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_ads_profiles_conexion
  ON public.ads_profiles(connection_id);

-- =====================================================
-- 3) EL ESTADO DEL OAUTH, PARA QUE NADIE EMPUJE UN «state»
-- =====================================================
--
-- El `state` de OAuth existe para una sola cosa: que la vuelta de Amazon
-- corresponda a una ida que hemos iniciado NOSOTROS. Sin comprobarlo, cualquiera
-- puede llamar a nuestro callback con un `code` suyo y dejar SU cuenta de Ads
-- conectada al cliente que elija.
--
-- Se guarda en la base y no en una cookie porque el callback lo abre Amazon en
-- una pestaña que puede no llevar nuestra sesion.
CREATE TABLE IF NOT EXISTS public.ads_oauth_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  region TEXT NOT NULL DEFAULT 'eu' CHECK (region IN ('eu', 'na', 'fe')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  /** Se marca al canjearlo. Un state usado no vale dos veces */
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ads_oauth_states_caducidad
  ON public.ads_oauth_states(expires_at);

-- =====================================================
-- 4) PERMISOS: NADIE ENTRA POR PostgREST
-- =====================================================
ALTER TABLE public.ads_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_oauth_states ENABLE ROW LEVEL SECURITY;

-- ads_connections y ads_oauth_states se quedan SIN NINGUNA POLITICA. Con RLS
-- encendida y cero politicas, `authenticated` no puede leer ni una fila: solo
-- entra la llave de servicio, desde el servidor. Ahi viven los tokens.
--
-- ads_profiles SI se lee desde la pantalla —son nombres de cuenta, no
-- credenciales— pero solo admin, y solo lectura. Escribirlos es cosa del
-- servidor cuando los trae de Amazon.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ads_profiles' AND policyname = 'ads_profiles_lectura_admin'
  ) THEN
    CREATE POLICY ads_profiles_lectura_admin ON public.ads_profiles
      FOR SELECT USING (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

-- =====================================================
-- 5) COMPROBACION
-- =====================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_connections', 'ads_profiles', 'ads_oauth_states'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'No se ha creado public.%.', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'public.% se ha quedado SIN row level security, y ahi hay tokens.', t;
    END IF;
  END LOOP;

  -- Que nadie haya añadido una politica a las dos tablas con credenciales.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('ads_connections', 'ads_oauth_states')
  ) THEN
    RAISE EXCEPTION
      'ads_connections o ads_oauth_states tienen una politica RLS. Esas tablas guardan tokens y '
      'no deben ser accesibles con la clave anonima por ningun camino.';
  END IF;
END $$;
