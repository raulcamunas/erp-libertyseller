-- 345 · VENTAS: EL HISTORIAL DE 2 AÑOS
-- Raúl (26 nov 2026): «a veces comparamos con otros años y otras fechas». Una lectura aparte que va hacia atrás de 30 en 30 días hasta 2 años:
-- pide el informe de pedidos de ese tramo, lee el dinero de esas fechas, y escribe directamente el resumen por día (ventas_dia), sin guardar detalle.
-- La publicidad de antes de ~3 meses no la da Amazon Ads: se toma de las facturas de publicidad que Amazon cobra (por día de factura, sin producto).

ALTER TABLE public.ventas_cuentas
  ADD COLUMN IF NOT EXISTS historico_objetivo DATE,
  ADD COLUMN IF NOT EXISTS historico_hasta DATE,
  ADD COLUMN IF NOT EXISTS historico_informe_id TEXT,
  ADD COLUMN IF NOT EXISTS historico_informe_desde DATE,
  ADD COLUMN IF NOT EXISTS historico_informe_hasta DATE,
  ADD COLUMN IF NOT EXISTS historico_pedido_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS historico_at TIMESTAMPTZ;
