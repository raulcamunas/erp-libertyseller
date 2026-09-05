-- ==================================================================
-- 176 · FACTURAR Y ENVIAR DESDE UN SOLO SITIO
-- ==================================================================
--
-- Hoy facturar un mes son seis pantallas y dos programas: bajar los ficheros
-- de Seller Central, subirlos a la calculadora, copiar el enlace del
-- desglose, ir a Wise a montar la factura, copiar el enlace de la factura,
-- abrir el correo y pegarlo todo en una plantilla. Por cliente. Once veces.
--
-- Lo que falta para hacerlo desde el ERP no es el cálculo —eso ya está— sino
-- los datos que lleva una factura de verdad y el rastro de lo que ya se ha
-- mandado. Eso es esta migración.
--
--
-- ============ POR QUÉ NO SE APOYA EN WISE ============
--
-- Wise se va este mes. La factura la emite el ERP y el enlace de pago
-- desaparece: en su lugar van los datos de transferencia del emisor, que es
-- como se cobrará a partir de ahora. Nada de lo que se añade aquí depende de
-- Wise, y las facturas viejas conservan su `wise_payment_link` intacto.

-- ---------- 1. Quién emite ----------
-- Una factura sin NIF ni domicilio del emisor no es una factura, es un correo
-- con números. Estos datos son SIEMPRE los mismos, así que van en una tabla de
-- una sola fila en vez de repetirse en cada factura: si mañana cambia el IBAN,
-- se cambia en un sitio.
--
-- No va en `app_settings` porque esa tabla tiene `value NUMERIC` y esto es todo
-- texto.
CREATE TABLE IF NOT EXISTS public.billing_issuer (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),  -- una sola fila, siempre
  legal_name TEXT NOT NULL DEFAULT '',
  tax_id TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT,
  /** Dónde se cobra desde que Wise se va */
  bank_name TEXT,
  iban TEXT,
  bic TEXT,
  /** Prefijo del número de factura: LS-2026-001 */
  invoice_prefix TEXT NOT NULL DEFAULT 'LS',
  /** Pie legal: recargo de equivalencia, exenciones, lo que toque */
  footer_note TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

INSERT INTO public.billing_issuer (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------- 2. Los datos fiscales del cliente ----------
-- `treasury_clients` ya guarda `tax_address` y `email`. Le falta el NIF, que en
-- una factura española es obligatorio, y el IVA que le corresponde.
ALTER TABLE public.treasury_clients
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

-- 21 % por defecto porque es lo normal, PERO se guarda por cliente y no como
-- constante: Naelpaa LLC es estadounidense y su factura no lleva IVA español.
-- Con un 21 % fijo en el código, a ese cliente se le facturaría de más y el
-- error solo se vería al presentar el trimestre.
ALTER TABLE public.treasury_clients
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC NOT NULL DEFAULT 0.21;

-- El concepto que aparece en la línea del fee. «Gestión Amazon» no vale para
-- todos: hay quien contrata mantenimiento y quien contrata PPC.
ALTER TABLE public.treasury_clients
  ADD COLUMN IF NOT EXISTS fee_concept TEXT;

-- ---------- 3. Atar la factura a su mes ----------
-- Sin esto no hay forma de saber si el mes de un cliente ya está facturado, y
-- la pantalla volvería a preguntárselo a quien la mira — que es justo el
-- trabajo que se viene a quitar.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS treasury_client_id UUID
    REFERENCES public.treasury_clients(id) ON DELETE SET NULL;

-- El mes al que corresponde, siempre día 1, igual que en treasury_client_months.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS period DATE;

-- El enlace público del desglose que se mandó con esta factura. Se guarda
-- porque el correo ya salió con él dentro: si mañana se regenera el reporte con
-- otro slug, hay que poder saber qué vio el cliente.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS report_url TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_treasury_period
  ON public.invoices(treasury_client_id, period);

-- Un cliente, un mes, una factura. Las anuladas no cuentan: si se cancela una y
-- hay que rehacerla, la nueva no puede chocar con la muerta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unica_por_mes
  ON public.invoices(treasury_client_id, period)
  WHERE treasury_client_id IS NOT NULL
    AND period IS NOT NULL
    AND status <> 'cancelled';

-- ---------- 4. RLS ----------
ALTER TABLE public.billing_issuer ENABLE ROW LEVEL SECURITY;

-- Los datos fiscales de la agencia y su IBAN. Solo admin y socios: es la cuenta
-- donde entra el dinero.
DROP POLICY IF EXISTS "billing_issuer_admin" ON public.billing_issuer;
CREATE POLICY "billing_issuer_admin" ON public.billing_issuer
  FOR ALL TO authenticated
  USING (public.get_user_role_safe(auth.uid()) IN ('admin', 'partner'))
  WITH CHECK (public.get_user_role_safe(auth.uid()) IN ('admin', 'partner'));

DO $$
BEGIN
  RAISE NOTICE 'Listo. Ahora hay que rellenar billing_issuer con el NIF, el domicilio y el IBAN: sin eso las facturas salen sin datos del emisor.';
END $$;
