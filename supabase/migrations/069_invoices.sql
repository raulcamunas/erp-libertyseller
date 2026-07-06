-- =====================================================
-- SISTEMA DE FACTURACIÓN
-- invoices + invoice_items con RLS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  client_email TEXT,
  invoice_number TEXT UNIQUE NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  wise_payment_link TEXT,
  commission_report_id UUID,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  vat_rate DECIMAL(5,4) NOT NULL DEFAULT 0,
  vat_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  notes TEXT,
  paid_at TIMESTAMPTZ,
  paid_amount DECIMAL(10,2),
  bank_reference TEXT,
  email_sent_at TIMESTAMPTZ,
  last_wise_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sequence for invoice numbers
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1;

-- RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='invoices' AND policyname='Admins manage invoices'
  ) THEN
    CREATE POLICY "Admins manage invoices" ON public.invoices
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role IN ('admin', 'manager')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='invoice_items' AND policyname='Admins manage invoice items'
  ) THEN
    CREATE POLICY "Admins manage invoice items" ON public.invoice_items
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role IN ('admin', 'manager')
        )
      );
  END IF;
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_invoice_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_updated_at ON public.invoices;
CREATE TRIGGER trg_invoice_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_invoice_updated_at();
