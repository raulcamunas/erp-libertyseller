-- ==================================================================
-- 272 · FACTURAR DESDE EL ERP CONTRA ZOHO BOOKS
-- ==================================================================
--
-- Zoho es donde vive la factura de verdad. Aquí solo se guarda lo que Zoho no
-- sabe: qué cliente de Tesorería es cada contacto, y quién hizo qué y cuándo.

-- ---------- 1. La pareja Tesorería ↔ Zoho ----------
ALTER TABLE public.treasury_clients
  ADD COLUMN IF NOT EXISTS zoho_contact_id TEXT;

-- ---------- 2. El reflejo de la factura ----------
-- `invoices` sigue siendo lo que mira Comisiones para no tocar un mes facturado
-- (índice único de la 176). Sin este reflejo, una factura hecha en Zoho no
-- frenaría ese guardado.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zoho_invoice_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_zoho
  ON public.invoices(zoho_invoice_id);

-- ---------- 3. El registro ----------
-- Una sola tabla para todo lo que se hace desde la pantalla: borradores, envíos
-- (con el correo tal como salió), cobros, gastos y cambios de plantilla.
CREATE TABLE IF NOT EXISTS public.facturacion_registro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL
    CHECK (tipo IN ('borrador', 'borrador_editado', 'borrador_borrado', 'envio', 'cobro', 'gasto', 'plantilla', 'contacto')),
  zoho_id TEXT,
  numero TEXT,
  cliente TEXT,
  treasury_client_id UUID REFERENCES public.treasury_clients(id) ON DELETE SET NULL,
  period DATE,
  importe NUMERIC,
  moneda TEXT,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  hecho_por UUID,
  hecho_por_nombre TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturacion_registro_fecha
  ON public.facturacion_registro(creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_facturacion_registro_cliente
  ON public.facturacion_registro(treasury_client_id, tipo, creado_en DESC);

-- Se escribe solo desde el servidor. Leerlo, los mismos que facturan.
ALTER TABLE public.facturacion_registro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facturacion_registro_lectura" ON public.facturacion_registro;
CREATE POLICY "facturacion_registro_lectura" ON public.facturacion_registro
  FOR SELECT TO authenticated
  USING (public.get_user_role_safe(auth.uid()) IN ('admin', 'partner'));
