-- COSTO DE ENVÍO COMO SELLERBOARD: reglas por tabla (país × precio, unidades o peso del pedido), «sin gastos» y moneda
ALTER TABLE public.ventas_envio_perfiles DROP CONSTRAINT IF EXISTS ventas_envio_perfiles_regla_check;
ALTER TABLE public.ventas_envio_perfiles
  ADD CONSTRAINT ventas_envio_perfiles_regla_check CHECK (regla IN ('ninguno', 'cobrado', 'pedido', 'unidad', 'precio', 'unidades', 'peso'));

-- { topes: [30, 60, null], filas: [{ zona: 'ES', importes: [3.6, 4, 5] }, { zona: 'resto', importes: [...] }] } (null = sin límite / vacío)
ALTER TABLE public.ventas_envio_perfiles ADD COLUMN IF NOT EXISTS tabla JSONB;
ALTER TABLE public.ventas_envio_perfiles ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'EUR' CHECK (moneda IN ('EUR', 'USD'));
