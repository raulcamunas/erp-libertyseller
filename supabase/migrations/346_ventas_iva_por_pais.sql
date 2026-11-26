-- 346 · VENTAS: EL IVA DE CADA PAÍS (OSS)
-- Raúl (26 nov 2026): con el interruptor encendido, a cada venta se le quita el IVA de su país (España 21, Francia 20, Alemania 19, Italia 22…) en vez del
-- IVA único de la cuenta. Apagado (como Sellerboard con vuestra configuración: 21 % a todo), nada cambia. Las tarifas de Amazon siguen con el IVA de la cuenta.
ALTER TABLE public.ventas_cuentas ADD COLUMN IF NOT EXISTS iva_por_pais BOOLEAN NOT NULL DEFAULT false;
