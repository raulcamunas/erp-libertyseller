-- ==================================================================
-- 158 · LOS TRAMOS DE MARGEN QUE HA PEDIDO EL CLIENTE
-- ==================================================================
--
-- Entrais ha mandado su tabla nueva. Siete tramos pasan a ser cinco:
--
--     lo que habia                    lo que pide
--     ------------------------        --------------------------
--     0 – 30 €          10 %          0 – 50 €            9 %
--     30 – 90 €          7 %          50,01 – 100 €       8 %
--     90 – 300 €         7 %          100,01 – 300 €      7 %
--     300 – 500 €        5 %          300,01 – 1000 €     6 %
--     500 – 1000 €       5 %          desde 1000,01 €     5 %
--     1000 – 2000 €      5 %
--     desde 2000 €       5 %
--
-- El tramo se decide por el COSTE (proveedor + canon + porte, sin IVA), que es
-- como estaba y como lo entiende el cliente.
--
--
-- POR QUE LOS CORTES SON 50,01 Y NO 50
-- ------------------------------------
-- Porque el cliente lo ha escrito asi y en un borde importa. El motor coge el
-- ultimo tramo cuyo «desde» no supera el valor, o sea `valor >= desde`. Con
-- «desde 50» un coste de 50,00 € caeria en el 8 %, y el cliente dice que de 0 a
-- 50 se gana el 9 %.
--
-- Con 50,01 cuadra exacto para cualquier importe de dos decimales: 50,00 va al
-- 9 % y 50,01 al 8 %. Y para los que tienen mas decimales —el porte de los
-- televisores es 35 € con IVA, o sea 28,925619... sin IVA— un coste que caiga
-- entre 50,00 y 50,01 se queda en el tramo de mas margen. Es el lado seguro:
-- pasarse de margen vende menos, quedarse corto vende con perdida.
--
-- Hoy hay DOS productos con el coste justo en un corte, asi que esto no es
-- teorico del todo.
--
--
-- QUE MUEVE EL CAMBIO (2.324 productos calculados a 25 ago 2026)
-- --------------------------------------------------------------
--
--     10 % -> 9 %    1.190    bajan   (coste por debajo de 30 €)
--      7 % -> 9 %      240    suben
--      7 % -> 8 %      304    suben
--      7 % -> 7 %      404    igual
--      5 % -> 6 %      157    suben   (coste de 300 a 1.000 €)
--      5 % -> 5 %       29    igual
--
-- O sea: NO es una bajada general. Baja el margen de los mil doscientos
-- articulos baratos —que son la mitad del catalogo— y sube el de los setecientos
-- de precio medio y alto. Merece la pena mirar los que suben antes de publicar:
-- son los que se pueden quedar por encima de la competencia.
--
-- Ninguno tiene margen propio, asi que el cambio les alcanza a todos.
--
--
-- POR QUE ESTO ES UNA MIGRACION Y NO UN CLIC
-- ------------------------------------------
-- La pantalla deja cambiar el PORCENTAJE de cada tramo, pero no los cortes ni
-- cuantos tramos hay. Aqui cambian las dos cosas. Que esto tenga que pasar por
-- SQL es una limitacion real de la pantalla, y esta anotada aqui para que la
-- proxima vez que el cliente mueva la tabla no haya que redescubrirla.

UPDATE public.entrais_config
SET
  tramos = '[
    {"desde": 0,       "margen": 0.09},
    {"desde": 50.01,   "margen": 0.08},
    {"desde": 100.01,  "margen": 0.07},
    {"desde": 300.01,  "margen": 0.06},
    {"desde": 1000.01, "margen": 0.05}
  ]'::jsonb,
  -- Se dejan encendidos y por coste explicitamente: si alguien los habia
  -- apagado para probar algo, una tabla nueva del cliente que no se aplica es
  -- justo el fallo silencioso que cuesta encontrar.
  usar_tramos = true,
  decidir_tramo_por = 'coste',
  updated_at = now()
WHERE unica;

-- ---------- Comprobacion ----------
DO $$
DECLARE
  n INTEGER;
  primero NUMERIC;
BEGIN
  SELECT jsonb_array_length(tramos) INTO n FROM public.entrais_config WHERE unica;
  IF n IS NULL THEN
    RAISE EXCEPTION 'No hay fila de configuracion de Entrais. Aplica antes la migracion 154.';
  END IF;
  IF n <> 5 THEN
    RAISE EXCEPTION 'Deberian quedar 5 tramos y hay %.', n;
  END IF;

  -- El primero TIENE que empezar en 0. El motor cae al margen global cuando un
  -- valor queda por debajo del primer tramo, y eso seria un margen distinto del
  -- que se ve en pantalla, aplicado sin que nada lo diga.
  SELECT (tramos -> 0 ->> 'desde')::numeric INTO primero FROM public.entrais_config WHERE unica;
  IF primero <> 0 THEN
    RAISE EXCEPTION 'El primer tramo empieza en % y tiene que empezar en 0.', primero;
  END IF;

  RAISE NOTICE 'Entrais: tramos actualizados a 9/8/7/6/5 %% con cortes en 50,01 · 100,01 · 300,01 · 1000,01.';
END $$;
