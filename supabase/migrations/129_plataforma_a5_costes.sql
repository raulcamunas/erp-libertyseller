-- =====================================================
-- 126 · MÓDULO A5 — GESTIÓN DE COSTES DE PRODUCTO
-- =====================================================
-- La especificación es tajante (§3.6): «Sin esto, A3 y A4 no funcionan». El
-- coste no está en Amazon —Amazon sabe lo que se vende, no lo que costó— así
-- que lo tiene el cliente y llega en un fichero distinto por cada uno.
--
-- La 123 ya creó `amazon_costes_producto` con lo mínimo: SKU, coste, divisa y
-- `valido_desde`. Esta migración hace cuatro cosas y ninguna toca lo que ya
-- había:
--
--   1. LE AÑADE LOS COSTES QUE FALTABAN. Ver el bloque 1: son los que el
--      estudio de la SP-API señala como el agujero por el que se escapa el
--      margen.
--   2. Añade el PERFIL DE IMPORTACIÓN por cliente, con la misma forma que los
--      perfiles de lectura de stock (migración 120) porque el lector es EL
--      MISMO. No se ha escrito un segundo lector: ver lib/stock-sync/lector.ts.
--   3. Añade el RASTRO: una fila por importación y una por cada coste que se
--      da de alta o se corrige, con quién y cuándo.
--   4. Añade la POLÍTICA por cliente, que es donde vive lo único que no se
--      puede inventar: a partir de cuántos días un coste está caducado.
--
--
-- ============ POR QUÉ HACEN FALTA MÁS CIFRAS QUE EL PRECIO DE COMPRA ============
--
-- Porque con solo el precio de compra el margen sale INFLADO, y encima sesgado:
--
--   · El FOEP de Amazon es PRECIO DE LISTING, SIN ENVÍO. En un SKU que enviamos
--     nosotros (FBM o Seller Fulfilled Prime), el porte sale de nuestro bolsillo
--     y no aparece en ninguna respuesta de la API. Sin `coste_envio`, el margen
--     de todo el catálogo FBM se calcula como si mandar un paquete fuera gratis
--     — y el cliente de 13.700 referencias es justo el que más FBM tiene.
--
--   · Las tarifas que devuelve Product Fees NO INCLUYEN ni el almacenamiento
--     mensual ni el flete de entrada al centro logístico. Sin
--     `coste_almacen_fba` y `coste_flete_fba`, la comparación «¿me conviene
--     pasar este SKU a FBA?» de A4 sale sistemáticamente a favor de FBA: se le
--     descuenta al canal FBM un coste real y al canal FBA no.
--
-- Los tres son OPCIONALES en la tabla y OBLIGATORIOS para el veredicto: cuando
-- faltan, el coste se marca INCOMPLETO y el margen no se calcula. NUNCA se
-- rellenan con cero. Un cero aquí es una cifra que acaba en una presentación
-- para el cliente diciendo que gana dinero donde lo pierde.
-- La regla vive en lib/plataforma/costes/completitud.ts, en una función pura.
--
--
-- ============ SIGUE SIN HABER `valido_hasta`, Y ES A PROPÓSITO ============
--
-- El coste vigente en una fecha es el de la fila con el `valido_desde` más alto
-- que no la supere. Un `valido_hasta` sería un dato derivado que hay que
-- mantener a mano y que se desincroniza el primer día que alguien meta un tramo
-- intermedio. La consulta está escrita una sola vez, en costeVigente()
-- (lib/plataforma/costes.ts), y la misma lógica está aquí abajo en la función
-- de cobertura con un LATERAL.
--
-- Se lanza en el editor SQL de Supabase, después de la 123.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: reventar
-- aquí deja la base intacta en vez de a medias.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_costes_producto'
  ) THEN
    RAISE EXCEPTION
      'No existe public.amazon_costes_producto. Lanza antes 123_plataforma_a1.sql.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stock_clients'
  ) THEN
    RAISE EXCEPTION
      'No existe public.stock_clients. Lanza antes 106_stock_sync.sql: el perfil de costes se apoya en el mapeo referencia -> SKU de la sincronización de stock.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían estas tablas abiertas a cualquiera, y aquí están los costes de compra de tiendas ajenas.';
  END IF;
END $$;

-- =====================================================
-- 1) LO QUE LE FALTABA A amazon_costes_producto
-- =====================================================
ALTER TABLE public.amazon_costes_producto
  /**
   * Coste de envío real POR UNIDAD cuando enviamos nosotros (FBM y SFP).
   * NULL = no se sabe, y entonces el coste está incompleto. Cero solo si de
   * verdad el porte es cero (lo paga el cliente final y no nos cuesta nada).
   */
  ADD COLUMN IF NOT EXISTS coste_envio NUMERIC,
  /** Almacenamiento en el centro logístico de Amazon, por unidad. Product Fees
      NO lo devuelve: es una estimación del cliente o nuestra */
  ADD COLUMN IF NOT EXISTS coste_almacen_fba NUMERIC,
  /** Flete de entrada hasta el centro logístico, por unidad. Tampoco lo
      devuelve Product Fees */
  ADD COLUMN IF NOT EXISTS coste_flete_fba NUMERIC,
  /**
   * ¿El importe de `coste` viene CON IVA?
   *
   * Casi siempre no —una factura de compra se contabiliza por la base— pero hay
   * clientes que exportan el PVP de compra con impuestos incluidos, y tomar eso
   * por base infla el coste un 21 % y hunde el margen calculado. Cuando es true
   * hace falta ADEMÁS el tipo: sin él no se puede llevar a base imponible y el
   * coste se marca incompleto. NO se deduce ningún tipo por país: no hay ningún
   * endpoint de la SP-API que lo dé con los roles que tenemos.
   */
  ADD COLUMN IF NOT EXISTS iva_incluido BOOLEAN NOT NULL DEFAULT false,
  /** Tipo de IVA del importe, en tanto por ciento. Solo tiene sentido con
      iva_incluido = true */
  ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC,
  /** Quién lo tocó por última vez. `created_by` dice quién lo dio de alta, y
      son dos preguntas distintas cuando alguien corrige el coste de otro */
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** De qué importación salió. Referencia BLANDA a propósito: el histórico de
      importaciones se puede purgar y el coste tiene que sobrevivir */
  ADD COLUMN IF NOT EXISTS import_id UUID;

COMMENT ON COLUMN public.amazon_costes_producto.coste IS
  'Precio de compra por unidad. NO es el coste total: para saber si un SKU gana dinero hacen falta también coste_envio (FBM/SFP) o coste_almacen_fba + coste_flete_fba (FBA). Ver completitud.ts.';
COMMENT ON COLUMN public.amazon_costes_producto.coste_envio IS
  'Porte real por unidad cuando enviamos nosotros. El FOEP de Amazon es precio de listing SIN envío: sin esta cifra el margen de un catálogo FBM sale inflado.';
COMMENT ON COLUMN public.amazon_costes_producto.coste_almacen_fba IS
  'Almacenamiento por unidad en Amazon. Product Fees no lo incluye; sin él, la comparación FBM vs FBA de A4 sesga a favor de FBA.';
COMMENT ON COLUMN public.amazon_costes_producto.coste_flete_fba IS
  'Flete de entrada por unidad hasta el centro logístico. Product Fees tampoco lo incluye.';

-- Los cuatro importes, nunca negativos. Un coste negativo es siempre un fallo de
-- lectura (una celda con un guion, un signo mal puesto), no un ingreso.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'amazon_costes_producto_extras_ok'
  ) THEN
    ALTER TABLE public.amazon_costes_producto
      ADD CONSTRAINT amazon_costes_producto_extras_ok CHECK (
        (coste_envio IS NULL OR coste_envio >= 0) AND
        (coste_almacen_fba IS NULL OR coste_almacen_fba >= 0) AND
        (coste_flete_fba IS NULL OR coste_flete_fba >= 0) AND
        (iva_porcentaje IS NULL OR (iva_porcentaje >= 0 AND iva_porcentaje < 100))
      );
  END IF;
END $$;

/**
 * UN COSTE A CERO SOLO PUEDE ENTRARLO UNA PERSONA.
 *
 * Es la regla E del encargo llevada a la base: «sin coste» es la AUSENCIA de la
 * fila, nunca un cero. Un cero que llega por un fichero es, con muchísima más
 * probabilidad que un regalo del proveedor, una celda vacía leída como número —y
 * un margen calculado sobre coste cero es fantástico, falso y creíble.
 *
 * Se deja pasar cuando `origen = 'manual'` porque ahí hay alguien delante que ha
 * escrito el cero a conciencia (muestras, promociones, material cedido).
 *
 * Se añade con guardia: si algún día hubiera filas que lo violan, la migración
 * lo dice en vez de reventar entera.
 */
DO $$
DECLARE
  violan INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amazon_costes_producto_cero_ok') THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO violan
  FROM public.amazon_costes_producto
  WHERE coste = 0 AND origen <> 'manual';

  IF violan > 0 THEN
    RAISE NOTICE
      'NO se ha puesto el CHECK amazon_costes_producto_cero_ok: hay % filas con coste 0 que no son manuales. Míralas antes (probablemente son celdas vacías leídas como número) y vuelve a lanzar esta migración.',
      violan;
  ELSE
    ALTER TABLE public.amazon_costes_producto
      ADD CONSTRAINT amazon_costes_producto_cero_ok
      CHECK (coste > 0 OR origen = 'manual');
  END IF;
END $$;

-- =====================================================
-- 2) EL PERFIL DE IMPORTACIÓN
-- =====================================================
-- Mismo modelo que `stock_read_profiles` (migración 120) y por el mismo motivo:
-- lo único que cambia de un cliente a otro es el FICHERO y CÓMO SE INTERPRETA.
-- Las columnas `col_*` son LISTAS de nombres aceptados, en orden de preferencia,
-- que se comparan sin tildes, sin mayúsculas y sin puntuación.
--
-- POR QUÉ ES UNA TABLA APARTE Y NO UN `tipo = 'coste'` EN stock_read_profiles:
--   a) aquel `client_id` apunta a `stock_clients` y este a `amazon_clients`, que
--      son dos censos distintos (no todos los clientes de Amazon mandan stock);
--   b) meter perfiles de coste allí los haría aparecer en la pantalla de
--      sincronización de stock y en su ciclo automático, que es producción y
--      publica unidades en Amazon.
-- Lo que SÍ se comparte —el lector del fichero y el cruce referencia -> SKU— se
-- comparte de verdad, en código, sin duplicar una línea.
CREATE TABLE IF NOT EXISTS public.amazon_costes_perfiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  /** Identificador estable en minúsculas, para la URL y las semillas */
  slug TEXT NOT NULL,

  /**
   * DE QUÉ CLIENTE DE LA SINCRONIZACIÓN DE STOCK SE TOMA EL MAPEO
   * referencia del ERP -> SKU de Amazon.
   *
   * NULL = no se usa ninguno, y el cruce se hace solo contra el espejo del
   * catálogo (la referencia del fichero tiene que ser el SKU, o su EAN).
   *
   * Se elige A MANO y nunca se adivina: `stock_mappings` son los códigos del
   * almacén de UN cliente, y cruzar el fichero de un cliente contra el mapeo de
   * otro sería exactamente lo que prohíbe el compromiso firmado ante Amazon
   * (§2.1: los datos de un vendedor se usan solo para ese vendedor).
   */
  stock_client_id UUID REFERENCES public.stock_clients(id) ON DELETE SET NULL,

  /* ---------- Cómo se abre el fichero ---------- */
  hoja TEXT,
  /** 1-based. Último recurso; si hay nombre de hoja, manda el nombre */
  hoja_indice INTEGER,
  /** 1-based, como la ve Excel. NULL = búscala sola en las primeras 20 */
  fila_cabecera INTEGER,
  fila_datos INTEGER,
  csv_separador TEXT,
  csv_codificacion TEXT,

  /* ---------- Qué columna es cada cosa ---------- */
  /** La referencia del artículo en el ERP del cliente */
  col_referencia TEXT[] NOT NULL DEFAULT '{}',
  /** El SKU de Amazon, cuando el fichero ya lo trae. Es el camino corto: sin
      cruce que pueda equivocarse */
  col_sku TEXT[] NOT NULL DEFAULT '{}',
  col_ean TEXT[] NOT NULL DEFAULT '{}',
  col_descripcion TEXT[] NOT NULL DEFAULT '{}',
  col_coste TEXT[] NOT NULL DEFAULT '{}',
  col_envio TEXT[] NOT NULL DEFAULT '{}',
  col_almacen TEXT[] NOT NULL DEFAULT '{}',
  col_flete TEXT[] NOT NULL DEFAULT '{}',
  col_moneda TEXT[] NOT NULL DEFAULT '{}',
  /** Desde cuándo rige el coste de esa fila. Sin ella, rige la fecha que se
      elija al importar */
  col_valido_desde TEXT[] NOT NULL DEFAULT '{}',

  /**
   * Divisa del fichero. NULL = el fichero TIENE que traer la columna de divisa.
   *
   * No hay valor por defecto y no es un olvido: un cliente que compra en dólares
   * y vende en euros con la divisa dada por supuesta produce márgenes
   * inventados, y ningún fichero de proveedor lleva escrito «esto son euros».
   * Si no hay ni columna ni divisa del perfil, la importación PARA.
   */
  moneda TEXT,

  iva_incluido BOOLEAN NOT NULL DEFAULT false,
  iva_porcentaje NUMERIC,

  /* ---------- Rastro del último intento ---------- */
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,

  is_active BOOLEAN DEFAULT true NOT NULL,
  position INTEGER,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE (client_id, slug),

  /** Sin identidad no hay a quién asignarle el coste */
  CONSTRAINT amazon_costes_perfiles_identidad_ok
    CHECK (cardinality(col_referencia) > 0 OR cardinality(col_sku) > 0),
  /** Y sin columna de coste no hay nada que importar */
  CONSTRAINT amazon_costes_perfiles_coste_ok
    CHECK (cardinality(col_coste) > 0),
  CONSTRAINT amazon_costes_perfiles_iva_ok
    CHECK (iva_porcentaje IS NULL OR (iva_porcentaje >= 0 AND iva_porcentaje < 100))
);

COMMENT ON TABLE public.amazon_costes_perfiles IS
  'Cómo se lee el fichero de costes de UN cliente. Lo consume el mismo lector configurable que la sincronización de stock (lib/stock-sync/lector.ts): aquí no hay un segundo lector.';

CREATE INDEX IF NOT EXISTS idx_amazon_costes_perfiles_cliente
  ON public.amazon_costes_perfiles(client_id, position, name);

-- =====================================================
-- 3) LA POLÍTICA DE COSTES DE CADA CLIENTE
-- =====================================================
-- UNA fila por cliente, y solo lo que NO se puede deducir de ningún dato.
--
-- `dias_caducidad` nace en NULL A PROPÓSITO: cuántos días vale un coste es una
-- regla de negocio y las pone el usuario, no el código. Mientras esté vacío, la
-- pantalla enseña la ANTIGÜEDAD de cada coste (que es un hecho) y dice que no
-- hay política de caducidad (que también lo es), en vez de inventarse un umbral
-- y pintar de rojo costes que a lo mejor están perfectamente vigentes.
CREATE TABLE IF NOT EXISTS public.amazon_costes_politica (
  client_id UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /** A partir de cuántos días un coste se considera caducado. NULL = sin decidir */
  dias_caducidad INTEGER,
  /** Divisa que se propone al crear un coste a mano. NULL = sin decidir */
  moneda_defecto TEXT,

  /**
   * ¿Un SKU que enviamos nosotros necesita coste de envío para dar el coste por
   * completo? Por defecto sí, que es lo estricto. Se apaga en el cliente cuyo
   * porte lo paga íntegro el comprador y a nosotros no nos cuesta nada.
   */
  exigir_envio_propio BOOLEAN NOT NULL DEFAULT true,
  /** Lo mismo para almacenamiento y flete en los SKU que están en FBA */
  exigir_costes_fba BOOLEAN NOT NULL DEFAULT true,

  notes TEXT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_costes_politica_dias_ok
    CHECK (dias_caducidad IS NULL OR dias_caducidad > 0)
);

COMMENT ON TABLE public.amazon_costes_politica IS
  'Lo único de A5 que es una decisión de negocio y no un dato: cuándo caduca un coste y qué cifras se exigen para darlo por completo. Nace sin decidir.';

-- =====================================================
-- 4) EL RASTRO: IMPORTACIONES Y AUDITORÍA
-- =====================================================
-- Las dos son de SOLO INSERCIÓN. Un registro de auditoría que se puede editar no
-- es un registro de auditoría.

CREATE TABLE IF NOT EXISTS public.amazon_costes_importaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  /** Referencia blanda: el perfil se puede borrar y esta fila tiene que quedar */
  profile_id UUID,
  /** Congelado, para que la fila siga siendo legible sin el perfil */
  perfil_nombre TEXT,

  fichero TEXT,
  /** SHA-256 del contenido. Es lo que delata «han vuelto a subir el de la
      semana pasada» sin tener que guardar el fichero */
  huella TEXT,
  bytes INTEGER,

  /** 'simulacro' NO escribe ni una fila de coste. Es el modo por defecto */
  modo TEXT NOT NULL CHECK (modo IN ('simulacro', 'aplicado')),
  /** La fecha de entrada en vigor con la que se importó */
  valido_desde DATE NOT NULL,

  filas_leidas INTEGER DEFAULT 0 NOT NULL,
  /** Filas del fichero sin coste legible: NO se importan, y se cuentan aparte
      para que no se confundan con «coste cero» */
  filas_sin_coste INTEGER DEFAULT 0 NOT NULL,
  filas_sin_referencia INTEGER DEFAULT 0 NOT NULL,
  casados INTEGER DEFAULT 0 NOT NULL,
  sin_casar INTEGER DEFAULT 0 NOT NULL,
  altas INTEGER DEFAULT 0 NOT NULL,
  correcciones INTEGER DEFAULT 0 NOT NULL,
  sin_cambio INTEGER DEFAULT 0 NOT NULL,

  /** Los avisos en español, tal cual se enseñaron */
  avisos JSONB,
  /** Muestra de lo que no casó y por qué. NUNCA el fichero entero */
  detalle JSONB,

  estado TEXT NOT NULL DEFAULT 'ok' CHECK (estado IN ('ok', 'error')),
  error_message TEXT,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_costes_importaciones_error_ok
    CHECK (estado = 'ok' OR btrim(COALESCE(error_message, '')) <> '')
);

CREATE INDEX IF NOT EXISTS idx_amazon_costes_importaciones_cliente
  ON public.amazon_costes_importaciones(client_id, created_at DESC);

/**
 * UNA FILA POR CADA COSTE QUE SE DA DE ALTA, SE CORRIGE O SE BORRA.
 *
 * Es lo que contesta «¿quién cambió el coste de este SKU y cuándo?», que es la
 * pregunta que aparece el día que un margen no cuadra. La tabla de costes tiene
 * `created_by` y `updated_by`, pero eso solo conserva el ÚLTIMO que tocó cada
 * fila: la corrección de hace tres meses la borró la de hace tres días.
 *
 * `antes` y `despues` van en JSONB con la fila entera. Ocupa más y da igual:
 * son unos pocos cientos de bytes por corrección, y sin el «antes» la auditoría
 * dice que algo cambió sin decir desde qué.
 */
CREATE TABLE IF NOT EXISTS public.amazon_costes_auditoria (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  valido_desde DATE NOT NULL,
  /** Referencia blanda a la fila de coste */
  coste_id UUID,
  import_id UUID,

  accion TEXT NOT NULL CHECK (accion IN ('alta', 'correccion', 'borrado')),
  origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'fichero', 'erp')),

  antes JSONB,
  despues JSONB,
  /** Obligatorio cuando lo hace una persona a mano: un cambio de coste sin
      explicación es imposible de auditar tres meses después */
  motivo TEXT,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT amazon_costes_auditoria_manual_ok
    CHECK (origen <> 'manual' OR btrim(COALESCE(motivo, '')) <> '')
);

CREATE INDEX IF NOT EXISTS idx_amazon_costes_auditoria_sku
  ON public.amazon_costes_auditoria(client_id, sku, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_costes_auditoria_cliente
  ON public.amazon_costes_auditoria(client_id, created_at DESC);

-- ---------- El candado de solo inserción ----------
-- Los REVOKE de abajo protegen del navegador. Esto protege de NOSOTROS: las dos
-- tablas las escribe service_role, que se salta RLS y los GRANT.
--
-- Función propia y no la de las series (amazon_serie_solo_insercion) porque el
-- mensaje tiene que explicar ESTE caso: aquí no se trata de que Amazon no pueda
-- volver a darnos el dato, sino de que un registro de auditoría corregible no
-- sirve para auditar nada.
CREATE OR REPLACE FUNCTION public.amazon_costes_solo_insercion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% es un registro de AUDITORÍA de solo inserción: lo que pasó no se corrige, se añade la corrección como una fila más. Si de verdad hay que purgar histórico antiguo, quita este trigger a propósito y vuelve a ponerlo.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_costes_importaciones',
    'amazon_costes_auditoria'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_solo_insercion ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_solo_insercion BEFORE UPDATE OR DELETE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_costes_solo_insercion()', t, t);

    -- TRUNCATE va aparte porque no se puede combinar con eventos de fila, y va
    -- porque entra en el GRANT ALL de Supabase y NI RLS NI LOS CHECK SE APLICAN
    -- A TRUNCATE: sin esto, la instrucción más destructiva es la única sin
    -- candado.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sin_truncate ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_sin_truncate BEFORE TRUNCATE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_costes_solo_insercion()', t, t);
  END LOOP;
END $$;

-- =====================================================
-- 5) updated_at
-- =====================================================
-- Reutiliza public.update_amazon_updated_at(), que crea la 118.
DROP TRIGGER IF EXISTS trg_amazon_costes_perfiles_updated ON public.amazon_costes_perfiles;
CREATE TRIGGER trg_amazon_costes_perfiles_updated
  BEFORE UPDATE ON public.amazon_costes_perfiles
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

DROP TRIGGER IF EXISTS trg_amazon_costes_politica_updated ON public.amazon_costes_politica;
CREATE TRIGGER trg_amazon_costes_politica_updated
  BEFORE UPDATE ON public.amazon_costes_politica
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();

-- =====================================================
-- 6) RLS
-- =====================================================
-- Solo admin y NADIE ESCRIBE DESDE EL NAVEGADOR, igual que la 123. Dos candados
-- en el mismo sentido: sin GRANT `authenticated` ni lo intenta, y sin política
-- permisiva RLS seguiría diciendo que no si alguien restaurara el GRANT.
-- TRUNCATE va en el REVOKE porque entra en el GRANT ALL de Supabase y RLS NO SE
-- APLICA A TRUNCATE.
DO $$
DECLARE
  t TEXT;
  politica TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_costes_perfiles',
    'amazon_costes_politica',
    'amazon_costes_importaciones',
    'amazon_costes_auditoria'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    politica := format('Admins read %s', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', politica, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_erp_admin(auth.uid()))',
      politica, t);

    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated, anon', t);
  END LOOP;
END $$;

-- =====================================================
-- 7) LA COBERTURA DE COSTES
-- =====================================================
-- «¿De qué porcentaje del catálogo de este cliente conozco el coste?» es LA
-- pregunta de §3.6: sin ella nadie sabe si el margen que está mirando vale algo.
--
-- POR QUÉ EN POSTGRES Y NO EN NODE: para contestarla hay que resolver, SKU a
-- SKU, cuál es el tramo de coste vigente hoy. En ShoesF son 13.700 referencias
-- contra un histórico que crece cada vez que el proveedor cambia tarifa.
-- Traerse las dos tablas enteras al servidor para contar cuatro números es la
-- clase de consulta que funciona el primer mes.
--
-- LO QUE DEVUELVE SON HECHOS, NO VEREDICTOS, Y ESO ES DELIBERADO. Aquí no se
-- decide qué es «incompleto»: se cuentan predicados concretos (cuántos SKU que
-- enviamos nosotros no tienen coste de envío, cuántos que están en FBA no tienen
-- almacenamiento…). Quién los compone en un veredicto es una función pura de
-- TypeScript, `clasificarCobertura()` en lib/plataforma/costes/completitud.ts,
-- que es la MISMA que juzga un coste suelto. Si la regla viviera también aquí
-- habría dos, y el día que cambie una sola de las dos la pantalla diría una cosa
-- y la ficha del SKU otra.
--
-- CUMPLIMIENTO: `p_client_id` es OBLIGATORIO. No hay forma de pedir la cobertura
-- de todos los clientes a la vez, ni de ordenar unos contra otros.
--
-- Una consecuencia que hay que saber al leer las cifras: se cuenta por unidad de
-- trabajo (conexión × marketplace), así que un SKU que está a la venta en España
-- y en Francia cuenta dos veces, mientras que su coste es UNO —el coste de
-- compra no depende del país donde se venda—. Es lo mismo que hace la cobertura
-- de A1 y es lo correcto: lo que se mide es «cuántas fichas de venta tengo
-- respaldadas por un coste».
CREATE OR REPLACE FUNCTION public.plataforma_cobertura_costes(
  p_client_id UUID,
  p_fecha DATE DEFAULT CURRENT_DATE,
  p_solo_seguimiento BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  connection_id UUID,
  marketplace_id TEXT,
  skus BIGINT,
  en_seguimiento BIGINT,
  con_coste BIGINT,
  sin_coste BIGINT,
  propio_sin_envio BIGINT,
  fba_sin_almacen BIGINT,
  fba_sin_flete BIGINT,
  con_iva_sin_tipo BIGINT,
  monedas TEXT[],
  coste_mas_antiguo DATE,
  coste_mas_nuevo DATE,
  dias_mediana INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH catalogo AS (
    SELECT
      l.connection_id,
      l.marketplace_id,
      l.sku,
      l.is_fba,
      COALESCE(l.activo_manual, l.activo_calculado) AS en_seguimiento
    FROM public.amazon_listings l
    JOIN public.amazon_connections c ON c.id = l.connection_id
    WHERE c.client_id = p_client_id
  ),
  con_coste AS (
    SELECT
      cat.*,
      co.coste,
      co.coste_envio,
      co.coste_almacen_fba,
      co.coste_flete_fba,
      co.moneda,
      co.iva_incluido,
      co.iva_porcentaje,
      co.valido_desde
    FROM catalogo cat
    -- El tramo vigente: el `valido_desde` más alto que no supere la fecha. Es la
    -- misma regla que costeVigente() en TypeScript, y el índice
    -- (client_id, sku, valido_desde DESC) que creó la 123 la resuelve con un
    -- salto por SKU en vez de con un recorrido.
    LEFT JOIN LATERAL (
      SELECT *
      FROM public.amazon_costes_producto x
      WHERE x.client_id = p_client_id
        AND x.sku = cat.sku
        AND x.valido_desde <= p_fecha
      ORDER BY x.valido_desde DESC
      LIMIT 1
    ) co ON TRUE
    WHERE (NOT p_solo_seguimiento OR cat.en_seguimiento)
  )
  SELECT
    connection_id,
    marketplace_id,
    COUNT(*)::BIGINT AS skus,
    COUNT(*) FILTER (WHERE en_seguimiento)::BIGINT AS en_seguimiento,
    COUNT(*) FILTER (WHERE coste IS NOT NULL)::BIGINT AS con_coste,
    COUNT(*) FILTER (WHERE coste IS NULL)::BIGINT AS sin_coste,
    -- «Propio» es todo lo que NO está en FBA: FBM y también Seller Fulfilled
    -- Prime, que Amazon no distingue del FBM en ninguna respuesta. Los dos
    -- pagan el porte de su bolsillo, así que para el coste son el mismo caso.
    COUNT(*) FILTER (WHERE coste IS NOT NULL AND NOT is_fba AND coste_envio IS NULL)::BIGINT
      AS propio_sin_envio,
    COUNT(*) FILTER (WHERE coste IS NOT NULL AND is_fba AND coste_almacen_fba IS NULL)::BIGINT
      AS fba_sin_almacen,
    COUNT(*) FILTER (WHERE coste IS NOT NULL AND is_fba AND coste_flete_fba IS NULL)::BIGINT
      AS fba_sin_flete,
    COUNT(*) FILTER (WHERE coste IS NOT NULL AND iva_incluido AND iva_porcentaje IS NULL)::BIGINT
      AS con_iva_sin_tipo,
    -- Las divisas que aparecen. Más de una en el mismo cliente no es un error
    -- —se compra en dólares y se vende en euros— pero sí es algo que hay que
    -- ver, porque Amazon NO da tipos de cambio y nada se consolida solo.
    COALESCE(ARRAY_AGG(DISTINCT moneda) FILTER (WHERE moneda IS NOT NULL), '{}') AS monedas,
    MIN(valido_desde) AS coste_mas_antiguo,
    MAX(valido_desde) AS coste_mas_nuevo,
    -- La mediana de antigüedad en días. La media la desplaza un solo coste de
    -- 2019 olvidado; la mediana dice cómo está el grueso del catálogo.
    (PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY (p_fecha - valido_desde)
    ) FILTER (WHERE valido_desde IS NOT NULL))::INTEGER AS dias_mediana
  FROM con_coste
  GROUP BY connection_id, marketplace_id
  ORDER BY connection_id, marketplace_id;
$$;

COMMENT ON FUNCTION public.plataforma_cobertura_costes(UUID, DATE, BOOLEAN) IS
  'Cobertura de costes de UN cliente, por conexión y marketplace. Devuelve HECHOS (cuántos sin coste, cuántos sin envío…), nunca veredictos: el veredicto lo compone clasificarCobertura() en TypeScript, que es la misma función que juzga un coste suelto.';

-- Nadie con sesión de navegador la ejecuta: solo el servidor con service_role.
REVOKE ALL ON FUNCTION public.plataforma_cobertura_costes(UUID, DATE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plataforma_cobertura_costes(UUID, DATE, BOOLEAN) FROM anon, authenticated;

-- =====================================================
-- 8) Comprobación final
-- =====================================================
DO $$
DECLARE
  faltan TEXT[] := '{}';
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_costes_perfiles',
    'amazon_costes_politica',
    'amazon_costes_importaciones',
    'amazon_costes_auditoria'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      faltan := faltan || t;
    END IF;
  END LOOP;

  IF cardinality(faltan) > 0 THEN
    RAISE EXCEPTION 'La migración 126 no ha creado: %', array_to_string(faltan, ', ');
  END IF;

  RAISE NOTICE '126 aplicada: A5 (costes de producto) tiene esquema.';
END $$;
