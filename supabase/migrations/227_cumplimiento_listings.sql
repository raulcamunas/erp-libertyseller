-- ============================================================================
-- 227 · CUMPLIMIENTO DE LISTINGS: LO QUE AMAZON DICE QUE HAY QUE ARREGLAR
-- ============================================================================
--
-- Para cada listing de un cliente, lo que Amazon dice que tiene mal: atributos
-- que faltan (los de seguridad de producto y mercancías peligrosas incluidos),
-- imágenes, códigos de barras, marcas que piden aprobación... y, sobre todo, qué
-- ha hecho por ello: ocultarlo de las búsquedas, impedir que se compre, quitarlo
-- del catálogo.
--
-- De dónde sale: de la API de listados (searchListingsItems con includedData=issues),
-- veinte SKU por llamada, EN DIRECTO. NO sale del panel «Gestionar su cumplimiento»
-- de Seller Central, que no tiene API.
--
--
-- POR QUÉ UNA TABLA PROPIA Y NO COLUMNAS EN amazon_listings
-- ---------------------------------------------------------
-- amazon_listings es el espejo del catálogo: lo escribe el ciclo de quince minutos
-- y lo leen el sincronismo, el motor de precios y el auditor. Meterle aquí las
-- incidencias obligaría a tocar una tabla caliente desde un proceso que corre a su
-- aire, y un fallo de este módulo podría acabar pisando un precio o un stock. Con
-- tabla propia, lo peor que puede pasar es que esta pantalla se quede vacía.
--
-- UNA FILA POR LISTING REVISADO, también los limpios: sin ellos no se puede decir
-- «se han revisado 12.400 de 43.800» ni elegir qué revisar la próxima vez (el que
-- lleva más tiempo sin mirarse). Las incidencias van dentro, en JSONB, ya limpias
-- y con su tema; las columnas de al lado (errores, avisos, suprimido, tema) son el
-- resumen para filtrar y ordenar sin abrir el JSON.
--
-- `desde` es desde cuándo está abierto el problema MÁS ANTIGUO del listing. Cada
-- incidencia lleva además el suyo dentro del JSON: se conserva entre revisiones
-- mientras la incidencia siga ahí.
--
-- `con_stock` es el del espejo EN EL MOMENTO DE LA REVISIÓN. Envejece, y no pasa
-- nada: sirve para ordenar («primero lo que tiene stock») y no para facturar.
--
-- `en_amazon = false` es un SKU que está en nuestro catálogo y que Amazon NO ha
-- devuelto al preguntar por él. No cuenta como limpio ni como con problemas: no
-- cuenta.
--
-- Solo lo lee un admin (y desde el servidor), y solo escribe el servidor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.listing_cumplimiento (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id  TEXT NOT NULL,
  sku             TEXT NOT NULL,

  asin            TEXT,
  titulo          TEXT,
  -- BUYABLE / DISCOVERABLE del resumen de ESTE marketplace. Vacío = Amazon no lo muestra
  estado          TEXT[] NOT NULL DEFAULT '{}',
  en_amazon       BOOLEAN NOT NULL DEFAULT true,
  es_padre        BOOLEAN NOT NULL DEFAULT false,
  con_stock       BOOLEAN NOT NULL DEFAULT false,

  -- El resumen, para filtrar y ordenar sin abrir el JSON
  errores         INTEGER NOT NULL DEFAULT 0 CHECK (errores >= 0),
  avisos          INTEGER NOT NULL DEFAULT 0 CHECK (avisos >= 0),
  -- Alguna incidencia lo oculta de verdad (sin plazo de gracia vigente)
  suprimido       BOOLEAN NOT NULL DEFAULT false,
  -- El tema de la incidencia más grave, y todos los que hay
  tema            TEXT CHECK (tema IS NULL OR tema IN (
                    'normativa', 'peligrosas', 'aprobacion', 'marca', 'identificadores',
                    'imagenes', 'precio', 'duplicado', 'datos', 'otros')),
  temas           TEXT[] NOT NULL DEFAULT '{}',
  desde           TIMESTAMPTZ,

  -- Las incidencias, ya limpias: [{codigo, gravedad, mensaje, atributos, categorias,
  -- acciones, exencion, tema, desde}]
  incidencias     JSONB NOT NULL DEFAULT '[]'::jsonb,

  revisado_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (connection_id, marketplace_id, sku)
);

COMMENT ON TABLE public.listing_cumplimiento IS
  'Cumplimiento de listings: una fila por listing revisado con las incidencias que Amazon le pone. Lo escribe la tarea «cumplimiento».';

-- La lista de la pantalla: lo que necesita atención, de un cliente y un país
CREATE INDEX IF NOT EXISTS listing_cumplimiento_atencion_idx
  ON public.listing_cumplimiento (connection_id, marketplace_id)
  WHERE errores > 0 OR suprimido OR avisos > 0;

-- Para elegir qué revisar y para contar lo revisado
CREATE INDEX IF NOT EXISTS listing_cumplimiento_revision_idx
  ON public.listing_cumplimiento (connection_id, marketplace_id, revisado_at);

-- ---------- Seguridad: solo lo ve un admin, y solo escribe el servidor ----------
ALTER TABLE public.listing_cumplimiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_cumplimiento_admin_lee ON public.listing_cumplimiento;
CREATE POLICY listing_cumplimiento_admin_lee
  ON public.listing_cumplimiento
  FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.listing_cumplimiento FROM authenticated, anon;

-- ---------- El horario: cada hora, se cambia desde Sistema ----------
-- Cada pasada revisa unos miles de listings (los más urgentes primero) y los demás
-- esperan a la siguiente. Una vuelta completa a ShoesF (43.800 listings en cuatro
-- países) tarda unas 15 horas la primera vez; después solo se repiten los que
-- vencen: cada 6 h los que tienen problemas, cada 24 h los que tienen stock y cada
-- 72 h el resto.
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('cumplimiento', 60, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listing_cumplimiento'
  ) THEN
    RAISE EXCEPTION 'La tabla listing_cumplimiento no se ha creado.';
  END IF;
  RAISE NOTICE 'Listo. La primera revisión sale en la próxima hora, o al pulsar «Revisar ahora» en Growth Partner · Cumplimiento.';
END $$;
