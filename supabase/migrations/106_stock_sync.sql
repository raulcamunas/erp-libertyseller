-- =====================================================
-- SINCRONIZACIÓN DE STOCK (ERP del cliente -> Amazon)
-- =====================================================
-- Cada lunes y jueves el cliente manda un volcado de su ERP con el stock
-- real y hay que devolverle a Amazon un fichero de tres columnas
-- (sku, asin, stock). Los dos mundos no comparten ninguna clave: el ERP
-- habla de «artículos» y Amazon de SKU/ASIN, así que el puente es esta
-- tabla de mapeo, que hoy vive en un Excel («Base de datos.xlsx») que se
-- edita a mano y del que solo hay una copia.
--
-- Traerlo a la base de datos resuelve tres cosas que el Excel no puede:
--   1. el mapeo deja de ser un fichero que alguien puede sobrescribir,
--   2. queda registrado POR QUÉ vía casó cada línea (metodo_match), que es
--      lo único que permite auditar un stock mal subido a Amazon, y
--   3. stock_runs guarda qué fichero se procesó y qué se subió cada día.
--
-- Ojo con los códigos: en el volcado del ERP vienen con ceros a la
-- izquierda («0004000342») y en el mapeo sin ellos («4000342»), y Excel
-- convierte muchos en número, así que llegan como «4000342.0». Todo lo que
-- se guarde aquí va normalizado; para comparar se usa
-- public.stock_normalize_code(), gemela exacta de normalizeCode() de
-- lib/types/stock-sync.ts.

-- ---------- Clientes cuyo stock sincronizamos ----------
-- Independiente de treasury_clients y de marketing_clients por lo mismo que
-- aquellas dos son independientes entre sí: aquí está quien nos manda un
-- volcado de su ERP, que es un puñado muy pequeño de los que facturamos, y
-- atarlo con una FK obligaría a dar de alta en tesorería a cualquier cuenta
-- con la que se haga una prueba de sincronización.
CREATE TABLE IF NOT EXISTS public.stock_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** Único para que la semilla de abajo se pueda reejecutar sin duplicar */
  name TEXT NOT NULL UNIQUE,
  /**
   * Identificador estable y legible. Es lo que usan las semillas de mapeos
   * (la 107) para resolver el client_id sin tener que conocer el UUID, y lo
   * que llevará la URL del módulo. Se restringe la forma para que no acabe
   * habiendo «Shoplamp» y «shop lamp» apuntando al mismo cliente.
   */
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_clients_active
  ON public.stock_clients(is_active, position);

-- ---------- Normalización de códigos ----------
-- Gemela de normalizeCode() de lib/types/stock-sync.ts. Se necesita en SQL
-- para poder indexar la referencia ya normalizada y que el cruce contra el
-- volcado del ERP no tenga que traerse la tabla entera al cliente.
--
-- El orden de los pasos importa: primero se quita el «.0» que mete Excel al
-- leer el código como número y solo después se tiran los caracteres que no
-- son alfanuméricos. Al revés, «50119247.0» se convertiría en «501192470»
-- y el cruce fallaría en silencio, que es justo el fallo que hace que un
-- producto suba a Amazon con el stock de otro.
--
-- IMMUTABLE porque hay un índice montado encima: si algún día cambia la
-- lógica hay que hacer REINDEX de idx_stock_mappings_ref_norm, o el índice
-- seguirá contestando con los valores viejos.
CREATE OR REPLACE FUNCTION public.stock_normalize_code(v TEXT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN v IS NULL THEN ''
    ELSE ltrim(
      regexp_replace(
        upper(regexp_replace(btrim(v), '\.0+$', '')),
        '[^0-9A-Z]', '', 'g'
      ),
      '0'
    )
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---------- Tabla de mapeo ----------
-- Una fila = un listing de Amazon. La clave del negocio es el SKU (es lo que
-- identifica el listing en el fichero que se sube), de ahí el UNIQUE por
-- cliente; el ASIN no vale como clave porque dos SKU pueden apuntar al mismo
-- ASIN y la referencia del ERP tampoco, porque hay listings que todavía no
-- han casado con ninguna.
--
-- Casi todo es TEXT y nullable a propósito: esto es el reflejo de un Excel
-- rellenado a mano, con filas a medio casar que hay que poder guardar tal
-- cual para verlas en pantalla y arreglarlas. Los campos de diagnóstico
-- (origen_ean, metodo_match, sku_coincide, ean_coincide) se quedan como
-- texto libre y no como enum por lo mismo: hoy traen frases del Excel
-- («SI (codigo secundario)», «NO — el EAN es de otra ref») que aún no están
-- cerradas y un CHECK las rechazaría al importar.
CREATE TABLE IF NOT EXISTS public.stock_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.stock_clients(id) ON DELETE CASCADE,

  /** Referencia del artículo en el ERP del cliente, ya sin ceros a la izquierda */
  ref_erp TEXT,
  /** SKU del listing en Amazon; es la clave del fichero que se sube */
  sku_amazon TEXT NOT NULL,
  asin TEXT,

  /** EAN que publica Amazon en el listing */
  ean_amazon TEXT,
  /** EAN habitual del artículo en el ERP */
  ean_erp TEXT,
  /** El que se da por bueno de los dos anteriores; es el que se usa al cruzar */
  ean_final TEXT,
  /** De dónde salió ean_final: «ERP», «Helium 10», «SIN DATO» */
  origen_ean TEXT,
  /** Por qué vía casó la fila: «SKU = ref ERP», «Cruce por EAN», «SKU con ceros», «SIN MATCH» */
  metodo_match TEXT,
  /** SI / NO / SOLO POR EAN / REVISAR (SKU y EAN discrepan) */
  sku_coincide TEXT,
  /** Diagnóstico del EAN en texto libre */
  ean_coincide TEXT,
  /**
   * Todos los códigos de barras que el ERP tiene para el artículo, separados
   * por coma. Se guarda la lista entera porque es el último recurso del
   * cruce: un artículo puede tener varios EAN y el que Amazon publica no
   * siempre es el habitual.
   */
  todos_ean_erp TEXT,

  /** «Normal» / «Preferente» / «Obsoleto» en el ERP; un obsoleto que sigue en Amazon es un aviso */
  situacion_erp TEXT,
  /** Título del listing, solo para reconocer la fila en pantalla */
  titulo_amazon TEXT,

  /** Un listing retirado se desactiva en vez de borrarse, para no perder el histórico del cruce */
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE (client_id, sku_amazon)
);

-- El UNIQUE de arriba ya deja un índice con client_id a la izquierda, así que
-- los de abajo solo cubren las tres entradas del cruce.
CREATE INDEX IF NOT EXISTS idx_stock_mappings_ref_erp
  ON public.stock_mappings(client_id, ref_erp)
  WHERE ref_erp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_mappings_asin
  ON public.stock_mappings(asin)
  WHERE asin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_mappings_ean_final
  ON public.stock_mappings(ean_final)
  WHERE ean_final IS NOT NULL;

-- La vía 1 del cruce (ref del ERP == artículo del volcado) es la que se
-- ejecuta ~21.000 veces por proceso, y siempre sobre la ref normalizada
-- porque el volcado trae ceros a la izquierda. Sin este índice funcional
-- cada comparación obliga a un seq scan; con él, la consulta tiene que usar
-- LITERALMENTE stock_normalize_code(ref_erp) o no lo aprovechará.
CREATE INDEX IF NOT EXISTS idx_stock_mappings_ref_norm
  ON public.stock_mappings(client_id, public.stock_normalize_code(ref_erp));

-- ---------- Historial de procesos ----------
-- Sin esto, cuando un cliente pregunta «¿por qué Amazon dice que tengo 0 de
-- esto?» no hay forma de saber qué fichero se procesó ni cuántas líneas
-- casaron ese día. rows_unmatched es el número que hay que vigilar: si sube
-- de golpe es que el cliente cambió el formato del volcado.
--
-- No lleva updated_at a propósito: una ejecución es un hecho pasado, si algo
-- sale mal se lanza otra, no se edita la anterior.
CREATE TABLE IF NOT EXISTS public.stock_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.stock_clients(id) ON DELETE CASCADE,
  /** Quién lo lanzó. SET NULL para que dar de baja a un empleado no borre el historial */
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  /** Nombre del fichero de stock que mandó el cliente, tal cual */
  source_filename TEXT,
  /** Nombre del fichero de EANs del ERP, si se usó en ese proceso */
  ean_filename TEXT,

  -- Métricas sin DEFAULT 0: NULL es «no se calculó» y 0 es «cero de verdad».
  /** Líneas leídas del volcado del cliente */
  rows_input INTEGER,
  /** SKU de Amazon que casaron y se subieron */
  rows_matched INTEGER,
  /** SKU que se quedaron fuera; es el indicador de salud del mapeo */
  rows_unmatched INTEGER,
  /** Suma de unidades enviadas a Amazon, para detectar un volcado vacío */
  total_units INTEGER,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_runs_client_date
  ON public.stock_runs(client_id, created_at DESC);

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.update_stock_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_clients_updated ON public.stock_clients;
CREATE TRIGGER trg_stock_clients_updated
  BEFORE UPDATE ON public.stock_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_updated_at();

DROP TRIGGER IF EXISTS trg_stock_mappings_updated ON public.stock_mappings;
CREATE TRIGGER trg_stock_mappings_updated
  BEFORE UPDATE ON public.stock_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_updated_at();

-- ---------- RLS ----------
-- Quien sube el stock a Amazon dos veces por semana es la persona de
-- operaciones, y su rol es 'employee': si esto se cerrara con
-- is_admin_or_partner (lo que usan tesorería y nóminas) el módulo no lo
-- podría usar nadie que trabaje en él.
--
-- Pero tampoco se le da acceso total. El employee necesita leer el mapeo,
-- corregir una línea mal casada y dejar registrada la ejecución del día;
-- borrar un mapeo o un run es otra cosa: se carga la trazabilidad de lo que
-- se subió a Amazon y no hay forma de recuperarlo. Por eso el DELETE se
-- queda solo en la política de admin/partner y para retirar un listing está
-- is_active. Un USING (true) tampoco vale: daría acceso a cualquier sesión
-- autenticada, incluidos los roles que se añadan más adelante.
CREATE OR REPLACE FUNCTION public.is_stock_team(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND role IN ('admin', 'partner', 'employee')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE public.stock_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_runs ENABLE ROW LEVEL SECURITY;

-- Acceso total (incluido DELETE) para admin y partner.
DROP POLICY IF EXISTS "Admins manage stock clients" ON public.stock_clients;
CREATE POLICY "Admins manage stock clients"
  ON public.stock_clients FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage stock mappings" ON public.stock_mappings;
CREATE POLICY "Admins manage stock mappings"
  ON public.stock_mappings FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage stock runs" ON public.stock_runs;
CREATE POLICY "Admins manage stock runs"
  ON public.stock_runs FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- Lectura y escritura (sin DELETE) para el equipo interno. Las políticas
-- permisivas se suman entre sí, así que admin y partner siguen entrando por
-- la de arriba.
DROP POLICY IF EXISTS "Team reads stock clients" ON public.stock_clients;
CREATE POLICY "Team reads stock clients"
  ON public.stock_clients FOR SELECT TO authenticated
  USING (public.is_stock_team(auth.uid()));

DROP POLICY IF EXISTS "Team reads stock mappings" ON public.stock_mappings;
CREATE POLICY "Team reads stock mappings"
  ON public.stock_mappings FOR SELECT TO authenticated
  USING (public.is_stock_team(auth.uid()));

DROP POLICY IF EXISTS "Team creates stock mappings" ON public.stock_mappings;
CREATE POLICY "Team creates stock mappings"
  ON public.stock_mappings FOR INSERT TO authenticated
  WITH CHECK (public.is_stock_team(auth.uid()));

DROP POLICY IF EXISTS "Team edits stock mappings" ON public.stock_mappings;
CREATE POLICY "Team edits stock mappings"
  ON public.stock_mappings FOR UPDATE TO authenticated
  USING (public.is_stock_team(auth.uid()))
  WITH CHECK (public.is_stock_team(auth.uid()));

DROP POLICY IF EXISTS "Team reads stock runs" ON public.stock_runs;
CREATE POLICY "Team reads stock runs"
  ON public.stock_runs FOR SELECT TO authenticated
  USING (public.is_stock_team(auth.uid()));

DROP POLICY IF EXISTS "Team creates stock runs" ON public.stock_runs;
CREATE POLICY "Team creates stock runs"
  ON public.stock_runs FOR INSERT TO authenticated
  WITH CHECK (public.is_stock_team(auth.uid()));

DROP POLICY IF EXISTS "Team edits stock runs" ON public.stock_runs;
CREATE POLICY "Team edits stock runs"
  ON public.stock_runs FOR UPDATE TO authenticated
  USING (public.is_stock_team(auth.uid()))
  WITH CHECK (public.is_stock_team(auth.uid()));

-- Realtime solo en el mapeo: es la tabla que se corrige a mano, a veces
-- entre dos personas a la vez mientras se revisa por qué una línea no casó.
-- Con guardia: añadir una tabla que ya está en la publicación da error, y en
-- el editor SQL de Supabase eso deshace la migración entera.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_mappings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- El único cliente que hoy manda volcados de su ERP. ON CONFLICT contra el
-- UNIQUE del slug para que reejecutar la migración no lo duplique ni pise un
-- nombre cambiado a mano.
INSERT INTO public.stock_clients (name, slug, is_active, position, notes)
VALUES ('Shoplamp', 'shoplamp', true, 1, 'Manda el volcado del ERP los lunes y los jueves')
ON CONFLICT (slug) DO NOTHING;
