-- ============================================================================
-- 292 · AMAZON ADS: FICHA DE CUENTA, PRODUCTOS, ESTRUCTURA DE CAMPAÑAS Y LOG DE CAMBIOS
-- ============================================================================
--
-- Cuatro tablas para el submódulo «Amazon Ads» de Growth Partner. Todas cuelgan de UNA cuenta de anunciante (`ads_profiles`, que es «un cliente en un país»):
--
--   · ads_fichas       la FICHA DE CUENTA del SOP (sección 05): los parámetros que se firman una vez por cuenta antes de tocar ninguna campaña.
--   · ads_productos    los productos de la cuenta a los que se les hace marketing, con su coste (de ahí sale el ACoS de equilibrio) y el RESUMEN que va en el nombre de las campañas.
--   · ads_estructuras  las campañas que ha creado el ERP para cada producto, con su rol (AUTO RADAR, MANUAL AMPLIA…) y los identificadores de Amazon.
--   · ads_cambios_log  el LOG: cada cosa que se crea o se cambia en la cuenta, con valor anterior, valor nuevo, motivo y si lo hizo una persona o el sistema solo.
--
-- Nada de esto lo lee el navegador: RLS encendida y SIN políticas de escritura. Solo entra el servidor con la llave de servicio (como `ads_connections`), y la lectura es solo para administradores.
--
-- El código funciona SIN esta migración: la pantalla dice que falta lanzarla en vez de romperse. Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Hace falta la 148 (`ads_profiles`).

DO $$
BEGIN
  IF to_regclass('public.ads_profiles') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_profiles: lanza antes 148_ads_api.sql.';
  END IF;
END $$;

-- ============================================================================
-- 1) LA FICHA DE CUENTA — una por cuenta de anunciante
-- ============================================================================
-- Los valores por defecto son los «VALOR DE ARRANQUE PROPUESTO» del SOP v5. Se convierten en doctrina cuando alguien los FIRMA (`firmada_at`). Cambiar cualquier número de una ficha firmada
-- le quita la firma: hay que volver a firmarla, para que nadie opere con unos umbrales que nadie ha visto.
CREATE TABLE IF NOT EXISTS public.ads_fichas (
  perfil_id UUID PRIMARY KEY REFERENCES public.ads_profiles(id) ON DELETE CASCADE,

  -- Fase de la cuenta: cambia el ACoS objetivo (lanzamiento = hasta 1,5× el de equilibrio; madurez = 0,7×)
  fase TEXT NOT NULL DEFAULT 'lanzamiento' CHECK (fase IN ('lanzamiento', 'crecimiento', 'madurez')),
  acos_lanzamiento_x NUMERIC(4,2) NOT NULL DEFAULT 1.50 CHECK (acos_lanzamiento_x > 0 AND acos_lanzamiento_x <= 5),
  acos_maduro_x      NUMERIC(4,2) NOT NULL DEFAULT 0.70 CHECK (acos_maduro_x > 0 AND acos_maduro_x <= 5),
  tacos_objetivo_pct NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (tacos_objetivo_pct > 0 AND tacos_objetivo_pct <= 100),

  -- Cuánto y con qué frecuencia se puede mover presupuesto y pujas
  subida_presupuesto_pct   NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (subida_presupuesto_pct > 0 AND subida_presupuesto_pct <= 100),
  horas_entre_subidas      INTEGER NOT NULL DEFAULT 72 CHECK (horas_entre_subidas BETWEEN 1 AND 720),
  cambio_puja_pct          NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (cambio_puja_pct > 0 AND cambio_puja_pct <= 100),
  dias_entre_cambios_puja  INTEGER NOT NULL DEFAULT 7 CHECK (dias_entre_cambios_puja BETWEEN 1 AND 90),

  -- Cuándo una keyword pasa a Exacta y cuándo se negativiza un término
  compras_para_exacta      INTEGER NOT NULL DEFAULT 2 CHECK (compras_para_exacta BETWEEN 1 AND 50),
  ventana_exacta_dias      INTEGER NOT NULL DEFAULT 14 CHECK (ventana_exacta_dias BETWEEN 1 AND 90),
  gasto_sin_venta_x        NUMERIC(4,2) NOT NULL DEFAULT 2 CHECK (gasto_sin_venta_x > 0 AND gasto_sin_venta_x <= 20),
  clics_minimos_negativizar INTEGER NOT NULL DEFAULT 15 CHECK (clics_minimos_negativizar BETWEEN 1 AND 500),
  muestra_minima_clics     INTEGER NOT NULL DEFAULT 12 CHECK (muestra_minima_clics BETWEEN 1 AND 500),

  -- Del contrato, en la moneda de la cuenta
  presupuesto_mensual NUMERIC(12,2) CHECK (presupuesto_mensual IS NULL OR presupuesto_mensual >= 0),
  notas TEXT,

  -- La firma. NULL = sin firmar, y sin firmar el sistema no ejecuta nada por su cuenta
  firmada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  firmada_at  TIMESTAMPTZ,

  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2) LOS PRODUCTOS A LOS QUE SE LES HACE MARKETING
-- ============================================================================
-- El coste es lo que permite calcular el ACoS de equilibrio (= margen antes de publicidad ÷ precio). Se guarda lo que se TECLEA (precio, coste, comisión, FBA, otros, IVA); el margen y el ACoS de
-- equilibrio se calculan siempre al leer, nunca se guardan: así no se quedan viejos al cambiar un coste.
CREATE TABLE IF NOT EXISTS public.ads_productos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,

  asin   TEXT NOT NULL CHECK (length(trim(asin)) > 0),
  sku    TEXT NOT NULL CHECK (length(trim(sku)) > 0),
  titulo TEXT,
  -- El RESUMEN TÍTULO del nombre de las campañas («ASIN | SKU | RESUMEN | ESTRATEGIA»): corto, en mayúsculas, idéntico en todas las campañas del producto
  resumen TEXT NOT NULL CHECK (length(trim(resumen)) > 0),

  precio          NUMERIC(12,2) CHECK (precio IS NULL OR precio >= 0),         -- precio de venta en Amazon (con IVA si el país lo incluye)
  iva_pct         NUMERIC(5,2) NOT NULL DEFAULT 21 CHECK (iva_pct BETWEEN 0 AND 40),
  coste_producto  NUMERIC(12,2) CHECK (coste_producto IS NULL OR coste_producto >= 0),
  comision_pct    NUMERIC(5,2) NOT NULL DEFAULT 15 CHECK (comision_pct BETWEEN 0 AND 60),
  tarifa_fba      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tarifa_fba >= 0),
  otros_costes    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (otros_costes >= 0),

  activo BOOLEAN NOT NULL DEFAULT TRUE,
  notas  TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (perfil_id, asin)
);

CREATE INDEX IF NOT EXISTS idx_ads_productos_perfil ON public.ads_productos(perfil_id);

-- ============================================================================
-- 3) LA ESTRUCTURA QUE HA CREADO EL ERP
-- ============================================================================
-- Una fila por campaña creada, con su rol. Es lo que luego permite saber «esta campaña es la AMPLIA de este producto» sin fiarse del nombre. UNIQUE (producto, rol): un producto no tiene dos AMPLIAS
-- creadas por el ERP (si se quiere otra, se diferencia por el RESUMEN, como dice el SOP).
CREATE TABLE IF NOT EXISTS public.ads_estructuras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id   UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.ads_productos(id) ON DELETE CASCADE,

  rol TEXT NOT NULL CHECK (rol IN ('AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN')),
  campaign_id TEXT NOT NULL,
  ad_group_id TEXT,
  nombre TEXT NOT NULL,
  presupuesto_diario NUMERIC(12,2),
  puja_base NUMERIC(12,2),

  creada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (producto_id, rol)
);

CREATE INDEX IF NOT EXISTS idx_ads_estructuras_perfil ON public.ads_estructuras(perfil_id);

-- ============================================================================
-- 4) EL LOG DE CAMBIOS
-- ============================================================================
-- «Registra cambios, no análisis» (principio 06 del SOP): qué se tocó, cuándo y desde qué valor. El MOTIVO es una línea. `origen` separa lo que hace una persona desde el ERP, lo que monta el botón de
-- estructura y lo que hace el sistema por su cuenta cuando tenga permiso. Si una llamada a Amazon falla, TAMBIÉN se anota (`ok = false`, con el error): un intento fallido es información.
CREATE TABLE IF NOT EXISTS public.ads_cambios_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id   UUID NOT NULL REFERENCES public.ads_profiles(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES public.ads_productos(id) ON DELETE SET NULL,

  campaign_id     TEXT,
  nombre_campana  TEXT,
  -- Qué tipo de cosa: campaña | grupo | anuncio | keyword | target | negativa
  entidad TEXT NOT NULL,
  -- Qué se hizo: crear | cambiar | pausar | activar | archivar | negativizar | promover
  accion  TEXT NOT NULL,
  campo          TEXT,
  valor_anterior TEXT,
  valor_nuevo    TEXT,
  motivo TEXT,

  -- estructura = el botón de «Crear campañas»; automatico = el sistema solo; manual = una persona desde el ERP
  origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('estructura', 'automatico', 'manual')),
  ok     BOOLEAN NOT NULL DEFAULT TRUE,
  error  TEXT,

  usuario_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ads_log_perfil_fecha ON public.ads_cambios_log(perfil_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_log_producto ON public.ads_cambios_log(producto_id) WHERE producto_id IS NOT NULL;

-- ============================================================================
-- 5) PERMISOS: LEE EL ADMINISTRADOR, ESCRIBE EL SERVIDOR
-- ============================================================================
ALTER TABLE public.ads_fichas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_productos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_estructuras  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_cambios_log  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ads_fichas', 'ads_productos', 'ads_estructuras', 'ads_cambios_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_lectura_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_erp_admin(auth.uid()))', t || '_lectura_admin', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- COMPROBACIÓN: tiene que salir UNA fila con todo en `true`
-- ============================================================================
SELECT
  (SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('ads_fichas', 'ads_productos', 'ads_estructuras', 'ads_cambios_log') AND c.relrowsecurity) AS cuatro_tablas_con_rls,
  (SELECT count(*) = 4 FROM pg_policies WHERE policyname IN ('ads_fichas_lectura_admin', 'ads_productos_lectura_admin', 'ads_estructuras_lectura_admin', 'ads_cambios_log_lectura_admin')) AS cuatro_politicas_de_lectura;
