-- ==================================================================
-- 151 · UN SOLO CLIENTE, CON TODAS SUS CONEXIONES COLGANDO
-- ==================================================================
--
-- El ERP tenia DOS listas de clientes que no se solapaban:
--
--   amazon_clients     -> los de SP-API:     Lenobotics, Liberty UpGrowth, Shoplamp
--   marketing_clients  -> los de publicidad: Creative Toys, Yo By Yolanda,
--                         Bodegas Valhalla, Jamones Tapas Party
--
-- Siete clientes, ninguno repetido. Y eso hacia imposible lo que se pide: dar de
-- alta un cliente UNA VEZ y conectarle despues lo que haga falta —SP-API, Ads, o
-- las dos—. «Añadir cliente» en Amazon API no servia para Creative Toys porque
-- lo habria creado en la lista de SP-API, mientras sus campañas cuelgan de la
-- otra.
--
--
-- POR QUE UNA TABLA NUEVA Y NO MOVER UNA DENTRO DE LA OTRA
-- --------------------------------------------------------
-- Porque las dos tienen datos vivos colgando: amazon_connections, amazon_listings
-- y todo el sincronismo de una; marketing_campaigns, marketing_weeks y
-- marketing_keywords de la otra. Meter una dentro de la otra obliga a reapuntar
-- esas claves ajenas y a rezar.
--
-- Aqui las dos tablas SE QUEDAN COMO ESTAN y solo ganan una columna que dice a
-- que cliente pertenecen. Nada de lo que ya funciona se entera. La tabla nueva es
-- el paraguas, no el sustituto: el dia que se quiera, se van moviendo las cosas
-- una a una, y mientras tanto el ERP sigue en pie.
--
--
-- EL EMPAREJADO ES POR NOMBRE NORMALIZADO
-- ----------------------------------------
-- Sin tildes, sin mayusculas y sin espacios de sobra. Hoy los siete nombres son
-- distintos y cada uno se convierte en un cliente, que es lo correcto. Si mañana
-- el mismo cliente estuviera en las dos con el nombre escrito igual, se unen
-- solos en vez de duplicarse — que es el fallo que tendria un emparejado por
-- igualdad exacta.
--
-- Lo que NO hace es adivinar: «Creative Toys» y «Creative Toys España» son dos
-- clientes distintos para esta migracion. Unirlos es una decision de una persona
-- que conoce el negocio, y se hace desde la pantalla.

DO $$
BEGIN
  IF to_regclass('public.amazon_clients') IS NULL THEN
    RAISE EXCEPTION 'Falta public.amazon_clients: lanza antes 118_amazon_api.sql.';
  END IF;
  IF to_regclass('public.marketing_clients') IS NULL THEN
    RAISE EXCEPTION 'Falta public.marketing_clients: lanza antes 103_marketing.sql.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION 'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql.';
  END IF;
END $$;

-- =====================================================
-- 1) EL CLIENTE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  nombre TEXT NOT NULL,

  /**
   * El nombre para comparar: sin tildes, en minusculas y sin espacios de sobra.
   *
   * GENERADA por la base y UNICA. Es lo que impide dar de alta dos veces al
   * mismo cliente escrito distinto —«Shoplamp» y «shoplamp »— sin que nadie se
   * entere hasta que aparecen dos filas en la pantalla.
   *
   * unaccent no esta disponible sin extension, asi que se hace con translate:
   * cubre las cinco vocales acentuadas y la ñ, que es todo lo que aparece en un
   * nombre comercial español.
   */
  nombre_norm TEXT GENERATED ALWAYS AS (
    lower(trim(translate(nombre, 'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
                                 'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU')))
  ) STORED,

  /** Con el que se distingue en toda la interfaz. El de marketing_clients */
  color TEXT NOT NULL DEFAULT '#FF6600',
  activo BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT clientes_nombre_norm_unico UNIQUE (nombre_norm)
);

COMMENT ON TABLE public.clientes IS
  'EL cliente de la agencia. Las conexiones —SP-API, Ads— y los modulos cuelgan '
  'de aqui. amazon_clients y marketing_clients siguen existiendo con sus datos y '
  'apuntan a esta tabla con cliente_id.';

-- =====================================================
-- 2) LAS DOS TABLAS VIEJAS APUNTAN AQUI
-- =====================================================
ALTER TABLE public.amazon_clients
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE public.marketing_clients
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_clients_cliente
  ON public.amazon_clients(cliente_id);
CREATE INDEX IF NOT EXISTS idx_marketing_clients_cliente
  ON public.marketing_clients(cliente_id);

-- =====================================================
-- 3) DAR DE ALTA LOS QUE YA EXISTEN
-- =====================================================
-- ON CONFLICT DO NOTHING contra el nombre normalizado: relanzar el fichero no
-- duplica nada, y si un cliente estuviera en las dos tablas con el mismo nombre
-- se crea UNA sola vez y las dos filas acaban apuntando a ella.
INSERT INTO public.clientes (nombre)
SELECT name FROM public.amazon_clients
ON CONFLICT (nombre_norm) DO NOTHING;

INSERT INTO public.clientes (nombre, color)
SELECT name, COALESCE(color, '#FF6600') FROM public.marketing_clients
ON CONFLICT (nombre_norm) DO NOTHING;

-- El enlace, por el nombre normalizado y en los dos sentidos.
UPDATE public.amazon_clients a
   SET cliente_id = c.id
  FROM public.clientes c
 WHERE a.cliente_id IS NULL
   AND c.nombre_norm = lower(trim(translate(a.name,
         'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
         'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU')));

UPDATE public.marketing_clients m
   SET cliente_id = c.id
  FROM public.clientes c
 WHERE m.cliente_id IS NULL
   AND c.nombre_norm = lower(trim(translate(m.name,
         'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
         'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU')));

-- =====================================================
-- 3 bis) LAS CUENTAS DE ANUNCIANTE, AL CLIENTE DE VERDAD
-- =====================================================
--
-- La 150 colgo cada perfil de Ads de `marketing_clients`, que era lo unico que
-- habia. Ahora hay un cliente de verdad y es ahi donde tiene que colgar: es lo
-- que permite que la cuenta de Ads y la de vendedor de un mismo cliente esten
-- enlazadas entre si.
--
-- La columna vieja NO SE BORRA. Si algo siguiera leyendola, quitarla lo romperia
-- en silencio; y mientras las dos existan, la de abajo manda. Se limpia el dia
-- que se compruebe que nadie la usa, que es una decision aparte.
DO $$
BEGIN
  IF to_regclass('public.ads_profiles') IS NULL THEN
    RAISE NOTICE 'ads_profiles todavia no existe: lanza 148 y 149 antes si quieres la parte de Ads.';
    RETURN;
  END IF;

  ALTER TABLE public.ads_profiles
    ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL;

  CREATE INDEX IF NOT EXISTS idx_ads_profiles_cliente_id
    ON public.ads_profiles(cliente_id);

  -- Arrastrar lo que ya estuviera asignado con la 150, si esa columna existe.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ads_profiles'
      AND column_name = 'marketing_client_id'
  ) THEN
    EXECUTE '
      UPDATE public.ads_profiles p
         SET cliente_id = m.cliente_id
        FROM public.marketing_clients m
       WHERE p.cliente_id IS NULL
         AND p.marketing_client_id = m.id
         AND m.cliente_id IS NOT NULL';
  END IF;
END $$;

-- =====================================================
-- 4) PERMISOS
-- =====================================================
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clientes' AND policyname = 'clientes_admin'
  ) THEN
    -- Solo admin, igual que amazon_clients: desde aqui se decide de quien es
    -- cada conexion, y por tanto donde acaban los datos de cada vendedor.
    CREATE POLICY clientes_admin ON public.clientes
      FOR ALL USING (public.is_erp_admin(auth.uid()))
      WITH CHECK (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

-- =====================================================
-- 5) COMPROBACION, Y QUE DIGA QUE HA HECHO
-- =====================================================
DO $$
DECLARE
  total INTEGER;
  sueltos_amazon INTEGER;
  sueltos_marketing INTEGER;
BEGIN
  IF to_regclass('public.clientes') IS NULL THEN
    RAISE EXCEPTION 'No se ha creado public.clientes.';
  END IF;

  SELECT count(*) INTO total FROM public.clientes;
  SELECT count(*) INTO sueltos_amazon
    FROM public.amazon_clients WHERE cliente_id IS NULL;
  SELECT count(*) INTO sueltos_marketing
    FROM public.marketing_clients WHERE cliente_id IS NULL;

  -- Un huerfano aqui significa que el enlace por nombre no ha encajado, y eso
  -- deja a ese cliente fuera de la lista unica sin que nada lo diga. Se corta.
  IF sueltos_amazon > 0 OR sueltos_marketing > 0 THEN
    RAISE EXCEPTION
      'Han quedado % clientes de SP-API y % de marketing sin enlazar. El emparejado es por nombre '
      'normalizado, asi que revisa si alguno tiene un nombre raro.', sueltos_amazon, sueltos_marketing;
  END IF;

  RAISE NOTICE 'public.clientes creada con % clientes, y las dos tablas viejas enlazadas.', total;
END $$;
