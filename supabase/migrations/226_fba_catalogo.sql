-- ============================================================================
-- 226 · BASE DE DATOS DE REFERENCIAS POR CLIENTE (ShoesF)
-- ============================================================================
--
-- La hoja de cálculo con la que ShoesF monta sus envíos —REF, Nombre y color,
-- Talla, EAN, FNSKU, ASIN, FBASKU— pasada a una tabla que se puede ampliar desde
-- la pantalla y de la que las propuestas sacan sus líneas eligiendo en
-- desplegables (REF -> color -> talla), sin teclear ni copiar códigos.
--
-- UNA FILA ES UNA TALLA: lo que Amazon conoce como un SKU. Un modelo es el
-- conjunto de filas con la misma REF y el mismo color.
--
-- Está por cliente (client_id) y no es de ShoesF a propósito: hoy solo la usa
-- ShoesF —lo decide la pantalla—, pero el día que otro cliente tenga su hoja no
-- hace falta tocar la base.
--
--
-- ============ QUÉ SE GARANTIZA AQUÍ Y QUÉ NO ============
--
-- SE GARANTIZA que una talla no esté dos veces (misma REF + color + talla, sin
-- distinguir mayúsculas) y que un FBASKU no sea de dos tallas. Sin lo primero el
-- segundo desplegable enseñaría dos «CUERO» y el tercero dos «40»; sin lo
-- segundo, dos líneas distintas de una remesa acabarían con el mismo SKU.
--
-- NO SE GARANTIZA que EAN, FNSKU, ASIN y FBASKU estén rellenos. La hoja real trae
-- tallas a medio dar de alta (sin FNSKU porque el listing aún no se ha creado en
-- Amazon) y prohibirlas obligaría a rellenar con basura. Se guardan tal cual y la
-- pantalla las marca como «incompletas»: una sin FBASKU no se puede mandar, una
-- sin FNSKU no tiene etiquetas.
--
-- Y EL FBASKU SE GUARDA TAL COMO ESTÁ ESCRITO. Hay series enteras que acaban en
-- «-» o «--» (FBA366246-39--): son SKUs que existen así en Amazon, y quitarles
-- el guion haría que el manifiesto citase uno que no existe.
--
--
-- Esta migración es idempotente: se puede lanzar dos veces.
-- Los datos se cargan desde la pantalla (Remesas -> ShoesF -> Base de datos ->
-- Importar), con el CSV de la hoja: el importador limpia, cuenta y enseña lo que
-- va a hacer antes de escribir nada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_catalogo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /** El código del modelo (8412, F0047, 13451ST). Varios colores comparten REF */
  ref TEXT NOT NULL,
  /** «Nombre y color» en la hoja: CUERO, P.N. COÑAC, BLACK 000 */
  nombre TEXT NOT NULL,
  /** Texto y no número: hay «UNICA», «37/38» y letras */
  talla TEXT NOT NULL,

  ean TEXT,
  fnsku TEXT,
  asin TEXT,

  /** El SKU del vendedor (Merchant SKU). En las líneas de una remesa es `sku` */
  fbasku TEXT,

  /** El código de artículo del cliente. Solo informativo; de él sale la propuesta de FBASKU */
  cod_art TEXT,

  /** «No» = el modelo se descataloga. Sigue saliendo en los desplegables, atenuado */
  continuidad BOOLEAN NOT NULL DEFAULT TRUE,
  precio NUMERIC(10, 2) CHECK (precio IS NULL OR precio >= 0),
  nota TEXT,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT fba_catalogo_clave_no_vacia
    CHECK (btrim(ref) <> '' AND btrim(nombre) <> '' AND btrim(talla) <> '')
);

COMMENT ON TABLE public.fba_catalogo IS
  'Base de datos de referencias de un cliente: una fila por talla (REF, nombre y '
  'color, talla, EAN, FNSKU, ASIN, FBASKU). Alimenta los desplegables de las '
  'propuestas de remesa. Lo que se manda no se guarda aquí: las líneas de la '
  'remesa copian estos datos al crearse y no dependen de que esta tabla cambie.';

-- Una talla una sola vez: sin distinguir mayúsculas, que «Cuero» y «CUERO» son el mismo color
CREATE UNIQUE INDEX IF NOT EXISTS fba_catalogo_talla_uq
  ON public.fba_catalogo (client_id, lower(ref), lower(nombre), lower(talla));

-- Un FBASKU solo puede ser de una talla (y puede no haberse creado todavía)
CREATE UNIQUE INDEX IF NOT EXISTS fba_catalogo_fbasku_uq
  ON public.fba_catalogo (client_id, fbasku) WHERE fbasku IS NOT NULL;

-- Buscar por EAN, que es lo que se teclea o se escanea
CREATE INDEX IF NOT EXISTS fba_catalogo_ean_idx
  ON public.fba_catalogo (client_id, ean) WHERE ean IS NOT NULL;

-- La lectura de siempre: todo el cliente, ordenado por REF
CREATE INDEX IF NOT EXISTS fba_catalogo_cliente_ref_idx
  ON public.fba_catalogo (client_id, ref, nombre);


/* ------------------------------------------------------------------ */
/* updated_at                                                          */
/* ------------------------------------------------------------------ */
-- La función es la de la 118 (la del módulo Amazon), que ya está en la base.

DROP TRIGGER IF EXISTS trg_fba_catalogo_updated ON public.fba_catalogo;
CREATE TRIGGER trg_fba_catalogo_updated
  BEFORE UPDATE ON public.fba_catalogo
  FOR EACH ROW EXECUTE FUNCTION public.update_amazon_updated_at();


/* ------------------------------------------------------------------ */
/* RLS · el mismo patrón que el resto de fba_*                         */
/* ------------------------------------------------------------------ */
-- Solo LECTURA para admin y escrituras REVOCADAS para el navegador: todo lo que
-- escribe aquí son las rutas de /api/fba/catalogo, que comprueban el acceso al
-- cliente y usan la clave de servicio, que se salta RLS.

ALTER TABLE public.fba_catalogo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins leen el catalogo de referencias" ON public.fba_catalogo;
CREATE POLICY "Admins leen el catalogo de referencias"
  ON public.fba_catalogo FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_catalogo FROM authenticated, anon;
