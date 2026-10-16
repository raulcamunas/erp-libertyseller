-- ============================================================================
-- 228 · REGISTRO DE ACCESOS DEL CONECTOR MCP
-- ============================================================================
--
-- El ERP se puede añadir a Claude como conector (https://app.libertyseller.com/api/mcp)
-- para que el equipo le haga consultas: catálogo de un cliente, cumplimiento,
-- historial de cambios. Solo lo usan los administradores y, hoy, solo lee.
--
-- Cada llamada a una herramienta deja aquí UNA fila: quién, qué herramienta, sobre
-- qué cliente, si salió bien y cuánto tardó. NO se guardan los argumentos ni lo que
-- se contestó: un texto de búsqueda puede llevar un SKU o un título de un cliente.
--
-- Es un registro de ACCESO, no un diario. Sirve para el día en que haya que
-- contestar «¿quién miró esto?» y, cuando el conector pueda escribir, para
-- reconstruir qué se hizo y a nombre de quién.
--
-- Solo lo lee un admin, y solo escribe el servidor. Si esta tabla no está, el
-- conector funciona igual: lo único que se pierde es el rastro en la base.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mcp_llamadas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL: si alguien deja el equipo, su rastro se queda y deja de tener nombre
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  herramienta   TEXT NOT NULL CHECK (length(btrim(herramienta)) > 0),
  -- El slug del cliente sobre el que se preguntó. NULL en las que no son de un cliente
  cliente_slug  TEXT,
  es_error      BOOLEAN NOT NULL DEFAULT false,
  ms            INTEGER CHECK (ms IS NULL OR ms >= 0),
  creada_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mcp_llamadas IS
  'Registro de accesos del conector MCP del ERP: una fila por llamada a una herramienta, sin argumentos ni respuesta.';

CREATE INDEX IF NOT EXISTS mcp_llamadas_reciente_idx
  ON public.mcp_llamadas (creada_at DESC);

CREATE INDEX IF NOT EXISTS mcp_llamadas_cliente_idx
  ON public.mcp_llamadas (cliente_slug, creada_at DESC)
  WHERE cliente_slug IS NOT NULL;

-- ---------- Seguridad: solo lo ve un admin, y solo escribe el servidor ----------
ALTER TABLE public.mcp_llamadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_llamadas_admin_lee ON public.mcp_llamadas;
CREATE POLICY mcp_llamadas_admin_lee
  ON public.mcp_llamadas
  FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mcp_llamadas FROM authenticated, anon;

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mcp_llamadas'
  ) THEN
    RAISE EXCEPTION 'La tabla mcp_llamadas no se ha creado.';
  END IF;
  RAISE NOTICE 'Listo. Las llamadas del conector MCP quedarán registradas.';
END $$;
