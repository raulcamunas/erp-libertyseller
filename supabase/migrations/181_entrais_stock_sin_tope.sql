-- ==================================================================
-- 181 · EL STOCK DE ENTRAIS: CADA 15 MINUTOS Y SIN TOPE DE VOLUMEN
-- ==================================================================
--
-- Lo pedido, literal: «que se actualice el stock cada 15 minutos» y «aunque
-- haya 5000 productos y cambien 4000, envía TODOS los cambios».
--
-- Hoy el perfil de Entrais no hace ni una cosa ni la otra:
--
--     cadencia_minutos   = 30      -> se lee cada media hora, no cada cuarto
--     freno_max_cambios  = 3.500   -> con 4.000 cambios NO manda 3.500: manda CERO
--
-- Lo segundo es lo importante y no es evidente. Los frenos son de TODO O NADA
-- (lib/stock-sync/frenos.ts: `puedeEnviar = saltaron.length === 0`): si uno
-- salta, el lote entero se queda en 'frenado' y no sale ni un solo cambio. Con
-- 4.000 SKU cambiando, el freno de volumen saltaba y el stock no se actualizaba
-- en absoluto.
--
--
-- ============ POR QUÉ 10.000 Y NO NULL ============
--
-- Vaciar la casilla NO apaga el freno: lo convierte en un HUECO, y con el envío
-- automático encendido un hueco bloquea igual que un freno saltado —es
-- deliberado, para que vaciar casillas no sea la forma rápida de desactivar
-- todo esto—. Así que para que no estorbe hay que ponerle un número por encima
-- del catálogo. Son 7.000 referencias: 10.000 no lo alcanza nunca.
UPDATE public.stock_read_profiles
SET cadencia_minutos = 15,
    freno_max_cambios = 10000
WHERE slug = 'volcado-api-stock';

-- ---------- Lo que NO se toca, y conviene saberlo ----------
--
-- Se quedan como están los frenos que detectan un fichero ROTO, que es distinto
-- de un fichero con muchos cambios:
--
--   freno_pct_a_cero (90 %)          · que casi todo el catálogo se vaya a cero
--   freno_caida_unidades_pct (40 %)  · que el total de unidades se desplome
--   freno_caida_lineas_pct (90 %)    · que el fichero venga medio vacío
--
-- Son la única red que impide que un volcado defectuoso del proveedor deje al
-- cliente sin stock en toda su tienda. Quitarlos también es posible desde la
-- pantalla del perfil, pero es una decisión distinta de la que se pidió aquí.

DO $$
DECLARE
  v_cad INTEGER;
  v_max INTEGER;
BEGIN
  SELECT cadencia_minutos, freno_max_cambios INTO v_cad, v_max
  FROM public.stock_read_profiles WHERE slug = 'volcado-api-stock';

  IF v_cad IS NULL THEN
    RAISE NOTICE 'No existe el perfil «volcado-api-stock»: no se ha cambiado nada.';
  ELSE
    RAISE NOTICE 'Entrais stock: cada % minutos, tope de cambios %.', v_cad, v_max;
  END IF;
END $$;
