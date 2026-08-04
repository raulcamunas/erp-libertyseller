-- =====================================================
-- TESORERÍA: marcar la factura como enviada
-- =====================================================
-- Cobrar tiene dos pasos y hasta ahora solo se registraba el segundo: si
-- un cliente no había pagado, no se sabía si era porque se le debe el
-- correo o porque se le mandó y no ha pagado todavía. Son dos gestiones
-- distintas y a personas distintas.

ALTER TABLE public.treasury_client_months
  ADD COLUMN IF NOT EXISTS invoice_sent BOOLEAN NOT NULL DEFAULT false;

-- Lo ya cobrado se dio por enviado en su día: no tendría sentido que un
-- mes cerrado apareciera con la factura pendiente de mandar.
UPDATE public.treasury_client_months
SET invoice_sent = true
WHERE paid = true AND invoice_sent = false;
