-- ==================================================================
-- 161 · SE APAGA EL DIAGNOSTICO DE BUY BOX
-- ==================================================================
--
-- La fase 3 del trabajo «Precios y Buy Box» diagnostica POR QUE se pierde la
-- oferta destacada y llena `amazon_buybox_diagnostico`. Se apaga a peticion
-- expresa: «lo de buy box perdida me da igual, no la voy a usar con los
-- clientes».
--
-- Y ademas cuesta espacio de una forma que no se ve: para saber si un SKU lleva
-- N LECTURAS SEGUIDAS perdiendo la Buy Box hay que GUARDAR esas N lecturas. O
-- sea que ese diagnostico es la razon por la que `amazon_snapshots_precio`
-- tenia que conservar cinco dias de historico en vez de la ultima fila. Con el
-- apagado, el plazo baja a tres dias y la tabla deja de crecer.
--
--
-- LO QUE NO SE APAGA
-- ------------------
-- La fase 1, que es saber QUIEN tiene hoy la Buy Box. Es barata —media llamada
-- por segundo— y es la columna que enseña el motor de precios: hoy, 1.842
-- referencias donde la tiene otro. Eso sale de la ULTIMA lectura de cada SKU y
-- no necesita historico ninguno.

ALTER TABLE public.amazon_buybox_config
  ADD COLUMN IF NOT EXISTS diagnostico_activo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.amazon_buybox_config.diagnostico_activo IS
  'false = no se diagnostica por que se pierde la Buy Box. Se salta la fase 3 del trabajo. Saber QUIEN la tiene es la fase 1 y sigue encendida.';

-- Apagado en todos: no se usa con ningun cliente.
UPDATE public.amazon_buybox_config SET diagnostico_activo = false;

-- ---------- Comprobacion ----------
DO $$
DECLARE
  encendidos INTEGER;
BEGIN
  SELECT count(*) INTO encendidos FROM public.amazon_buybox_config WHERE diagnostico_activo;
  IF encendidos > 0 THEN
    RAISE EXCEPTION 'Han quedado % clientes con el diagnostico encendido.', encendidos;
  END IF;
  RAISE NOTICE 'Diagnostico de Buy Box apagado en todos los clientes.';
END $$;
