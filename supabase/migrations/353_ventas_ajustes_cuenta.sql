-- VENTAS · LOS AJUSTES DE CADA CUENTA (27 nov 2026): la página «Configuración» del Sellerboard propio (IVA de ventas y tarifas con fecha, IVA en
-- publicidad, FBM Pick & Pack, margen sobre ventas netas, desde cuándo cuentan los pagos en el flujo de caja). Lo que no esté, el valor de siempre.
ALTER TABLE public.ventas_cuentas ADD COLUMN IF NOT EXISTS ajustes JSONB NOT NULL DEFAULT '{}'::jsonb;
