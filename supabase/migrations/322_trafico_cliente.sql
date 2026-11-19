-- ============================================================================
-- 322 · TRÁFICO Y CONVERSIÓN PARA EL CLIENTE: UNA PÁGINA CON ENLACE Y CLAVE QUE SE ACTUALIZA SOLA
-- ============================================================================
--
-- Lo que se mandaba a mano en Excel («Tráfico y conversión por juego»), en una página que el cliente abre cuando quiere.
--
--   · trafico_enlaces   El enlace secreto y su clave (solo el hash) de cada cliente y país. Sin la clave, el enlace no enseña nada.
--   · trafico_diario    El informe de Ventas y tráfico de Seller Central, UN DÍA Y UN ASIN por fila (sesiones de navegador y app, visitas, Buy Box,
--                       unidades, pedidos y ventas). Lo rellena el proceso `trafico-cliente`, un informe por día.
--   · trafico_lecturas  Qué días se han pedido a Amazon y cuáles faltan (los tres últimos se vuelven a leer: Amazon tarda en consolidar las sesiones).
--   · trafico_juegos    Cómo se agrupan los ASIN en juegos (ediciones en otros idiomas y colores suman en el mismo juego) y su nombre de producto.
--   · trafico_agregado  Función que suma por día, por mes o en total, por ASIN, entre dos fechas: la página no tiene que bajar decenas de miles de filas.
--
-- NO TOCA NI BORRA NADA QUE YA EXISTA. Tablas cerradas al navegador (RLS sin políticas): todo pasa por el servidor.
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.trafico_enlaces (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  -- scrypt: «sal:hash» en hexadecimal. La clave en claro no se guarda nunca
  clave_hash      TEXT NOT NULL,
  client_id       UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  marketplace_id  TEXT NOT NULL,
  titulo          TEXT NOT NULL,
  -- Desde qué día se lee el histórico
  desde           DATE NOT NULL DEFAULT DATE '2025-08-01',
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accesos         INTEGER NOT NULL DEFAULT 0,
  ultimo_acceso   TIMESTAMPTZ,
  -- Contra quien prueba claves: tras 10 fallos seguidos, 15 minutos sin poder entrar
  fallos          INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS trafico_enlaces_cliente_idx ON public.trafico_enlaces (client_id, marketplace_id);

CREATE TABLE IF NOT EXISTS public.trafico_diario (
  client_id          UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  marketplace_id     TEXT NOT NULL,
  fecha              DATE NOT NULL,
  asin               TEXT NOT NULL,
  parent_asin        TEXT,
  sesiones           INTEGER NOT NULL DEFAULT 0,
  sesiones_navegador INTEGER NOT NULL DEFAULT 0,
  sesiones_app       INTEGER NOT NULL DEFAULT 0,
  visitas            INTEGER NOT NULL DEFAULT 0,
  -- Visitas × % de Buy Box: para el Buy Box medio ponderado por visitas
  visitas_buybox     NUMERIC NOT NULL DEFAULT 0,
  unidades           INTEGER NOT NULL DEFAULT 0,
  pedidos            INTEGER NOT NULL DEFAULT 0,
  ventas             NUMERIC NOT NULL DEFAULT 0,
  moneda             TEXT,
  leido_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, marketplace_id, fecha, asin)
);

CREATE TABLE IF NOT EXISTS public.trafico_lecturas (
  client_id      UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  fecha          DATE NOT NULL,
  -- pedido: Amazon lo está preparando · hecho: guardado · error: falló (se reintenta más tarde, hasta 4 veces)
  estado         TEXT NOT NULL CHECK (estado IN ('pedido', 'hecho', 'error')),
  report_id      TEXT,
  pedido_at      TIMESTAMPTZ,
  leido_at       TIMESTAMPTZ,
  intentos       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  PRIMARY KEY (client_id, marketplace_id, fecha)
);
CREATE INDEX IF NOT EXISTS trafico_lecturas_estado_idx ON public.trafico_lecturas (client_id, marketplace_id, estado);

CREATE TABLE IF NOT EXISTS public.trafico_juegos (
  client_id      UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  asin           TEXT NOT NULL,
  juego          TEXT NOT NULL,
  producto       TEXT,
  PRIMARY KEY (client_id, marketplace_id, asin)
);

ALTER TABLE public.trafico_enlaces  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trafico_diario   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trafico_lecturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trafico_juegos   ENABLE ROW LEVEL SECURITY;

-- Suma por ASIN y por día ('dia'), por mes ('mes') o en total ('total') entre dos fechas
CREATE OR REPLACE FUNCTION public.trafico_agregado(p_client UUID, p_mkt TEXT, p_desde DATE, p_hasta DATE, p_por TEXT)
RETURNS TABLE (clave TEXT, asin TEXT, sesiones BIGINT, sesiones_navegador BIGINT, sesiones_app BIGINT, visitas BIGINT, visitas_buybox NUMERIC, unidades BIGINT, pedidos BIGINT, ventas NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE p_por WHEN 'dia' THEN to_char(d.fecha, 'YYYY-MM-DD') WHEN 'mes' THEN to_char(d.fecha, 'YYYY-MM') ELSE 'total' END AS clave,
    d.asin,
    SUM(d.sesiones)::BIGINT, SUM(d.sesiones_navegador)::BIGINT, SUM(d.sesiones_app)::BIGINT, SUM(d.visitas)::BIGINT, SUM(d.visitas_buybox),
    SUM(d.unidades)::BIGINT, SUM(d.pedidos)::BIGINT, SUM(d.ventas)
  FROM public.trafico_diario d
  WHERE d.client_id = p_client AND d.marketplace_id = p_mkt AND d.fecha BETWEEN p_desde AND p_hasta
  GROUP BY 1, 2
$$;
REVOKE ALL ON FUNCTION public.trafico_agregado(UUID, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trafico_agregado(UUID, TEXT, DATE, DATE, TEXT) TO service_role;


-- ============================================================================
-- COMPROBACIÓN · TIENE QUE SALIR «true» EN LAS DOS COLUMNAS
-- ============================================================================
SELECT
  (SELECT count(*) = 4 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('trafico_enlaces', 'trafico_diario', 'trafico_lecturas', 'trafico_juegos')) AS tiene_las_cuatro_tablas,
  (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'trafico_agregado') AS tiene_la_funcion;
