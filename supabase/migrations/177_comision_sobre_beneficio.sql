-- ==================================================================
-- 177 · CREATIVE TOYS COBRA SOBRE EL BENEFICIO, NO SOBRE LA FACTURACIÓN
-- ==================================================================
--
-- Creative Toys tenía en el ERP un 5 % sobre la facturación sin IVA. El trato
-- real es un 7,5 % SOBRE EL BENEFICIO NETO, y no se parecen en nada: con el
-- informe de noviembre de 2025 el ERP calculaba 816,79 € donde la cuenta buena
-- da del orden de 300 €. Casi el triple.
--
-- Por eso nadie lo usaba. Los dos únicos meses con comisión —julio y agosto de
-- 2026— se calcularon a mano en un Excel aparte, y el reporte que sí se guardó
-- en el ERP (noviembre 2025) nunca llegó a facturarse: en Tesorería ese mes
-- tiene la comisión vacía.
--
--
-- ============ POR QUÉ UNA COLUMNA Y NO OTRO `if` CON EL NOMBRE ============
--
-- El cálculo ya sabe cobrar sobre beneficio: es lo que hacen DIRU y SAUSI. Pero
-- se decide comparando el NOMBRE del cliente con una cadena escrita en el
-- código (`client.name === 'DIRU'`), y hay ocho clientes decididos así.
--
-- Con eso, dar de alta un cliente nuevo con este trato obliga a tocar código y
-- desplegar, y renombrar a uno en la pantalla de clientes le cambia el cálculo
-- en silencio. Aquí el modo pasa a ser un dato de la fila, que es lo que es.
-- Los nombres que ya están escritos siguen funcionando: esto se suma a ellos,
-- no los sustituye.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS modo_calculo TEXT NOT NULL DEFAULT 'facturacion'
    CHECK (modo_calculo IN ('facturacion', 'beneficio'));

COMMENT ON COLUMN public.clients.modo_calculo IS
  'facturacion = la comisión se calcula sobre las ventas sin IVA. '
  'beneficio = se calcula sobre la suma de «Net profit» del informe de Sellerboard.';

-- ---------- Creative Toys: 7,5 % sobre beneficio ----------
--
-- El 7,5 % está comprobado contra el Excel con el que se facturó julio de 2026:
--
--   Ganancias del mes (panel de Sellerboard)    3.959,12
--   menos gasto de Vine                           969,52
--   base                                        2.989,60   x 7,5 %  =  224,22
--
-- Y el informe de productos de Sellerboard llega solo al mismo sitio: su
-- columna «Net profit» suma 2.975,64, que da 223,17 —un 0,47 % de diferencia—.
-- No es casualidad: el gasto de Vine es de CUENTA, no de producto, así que el
-- informe de productos ya viene sin él. Por eso se puede calcular con el
-- fichero, sin tener que copiar a mano ninguna cifra del panel.
UPDATE public.clients
SET modo_calculo = 'beneficio',
    base_commission_rate = 0.075,
    updated_at = NOW()
WHERE name = 'Creative Toys';

DO $$
DECLARE
  v_tasa NUMERIC;
  v_modo TEXT;
BEGIN
  SELECT base_commission_rate, modo_calculo INTO v_tasa, v_modo
  FROM public.clients WHERE name = 'Creative Toys';

  IF v_tasa IS NULL THEN
    RAISE NOTICE 'No hay ningun cliente llamado «Creative Toys»: no se ha cambiado nada.';
  ELSE
    RAISE NOTICE 'Creative Toys: modo=% tasa=%', v_modo, v_tasa;
  END IF;
END $$;
