-- ==================================================================
-- 157 · LOS QUE NO SE PUEDEN VENDER EN AMAZON
-- ==================================================================
--
-- El proveedor marca algunos articulos con ENVIO_DIRECTO = SI: no pasan por su
-- almacen, los manda el fabricante. Esos no se pueden vender en Amazon, y el
-- motivo no es de logistica sino de que no hay forma de cumplir el plazo ni de
-- responder por el envio.
--
-- Son 51 de 6.716 y no son cualquier cosa: precio medio 961 €, veintiseis
-- portatiles, nueve equipos y ONCE GARANTIAS —extensiones de garantia, que ni
-- siquiera son un producto fisico y vienen con «stock 100» inventado—.
--
--
-- ============ EL DATO NO ESTA EN LA API. SOLO EN SU FICHERO DE TARIFA ============
--
-- Esto es lo unico importante de esta migracion, asi que va antes que la tabla.
--
-- Su propio Swagger declara el objeto Product asi, entero:
--
--     code · description · family · brand · subfamily · ean · partNumber
--     digital · price · digitalCanon · stock · entries · pricesPerQuantity
--
-- ENVIO_DIRECTO no esta. (Hay un «dropshipping», pero cuelga de ShippingAddress
-- y es a donde se manda un pedido, no una marca del articulo.) Y el ciclo de
-- stock de Entrais lee LA API — o sea que por ese camino el dato no llega nunca.
--
-- De ahi esta tabla: es el unico sitio donde el ERP sabe cuales son. Se llena
-- desde el CSV de tarifa que el proveedor manda por correo, y hay que volver a
-- cargarlo cuando llegue uno nuevo. Mientras no se haga, esta lista es la del
-- fichero del 5 de agosto de 2026 y no sabe de los articulos dados de alta
-- despues.
--
--
-- ============ HOY NO HAY NINGUNO EXPUESTO, Y AUN ASI SE MONTA ============
--
-- Comprobado los 51 contra la cuenta del cliente y contra su propia API:
--
--     en Amazon ahora mismo ............. 0 de 51
--     en la respuesta de la API ......... 0 de 51
--     en los ficheros de carga masiva ... 0 de 51
--
-- El segundo numero dice mucho: de los otros 6.665 articulos de la tarifa, solo
-- un 1,5 % falta en la API. De los de envio directo falta el 100 %. El proveedor
-- ya los excluye de su feed.
--
-- Podria parecer que entonces esto sobra. No: es UNA foto, de UN dia, y la
-- tarifa que la sostiene es veinte dias mas vieja que la respuesta de la API con
-- la que se comparo. El dia que el proveedor cambie el feed —o que se de de alta
-- un articulo de envio directo nuevo— nadie se va a enterar, porque no hay nada
-- que avise. Un freno que no salta nunca no cuesta nada; el que falta se paga
-- vendiendo un portatil de 961 € que no se puede enviar.

CREATE TABLE IF NOT EXISTS public.entrais_bloqueados (
  -- El COD_INTERNO del proveedor, que es tambien el SKU en Amazon.
  sku TEXT PRIMARY KEY,

  motivo TEXT NOT NULL DEFAULT 'envio_directo'
    CHECK (motivo IN ('envio_directo', 'a_mano')),

  -- Copiados de la tarifa para poder mirar la lista y entenderla sin cruzarla
  -- con nada. Un SKU pelado no dice si lo que se esta bloqueando es una
  -- garantia de 33 € o un portatil de 2.000.
  nombre TEXT,
  familia TEXT,
  precio_proveedor NUMERIC,

  -- De que fichero de tarifa salio. Sin esto no hay forma de saber si la lista
  -- es de hace una semana o de hace ocho meses.
  tarifa_fecha DATE,
  nota TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.entrais_bloqueados IS
  'Articulos de Entrais que NO se pueden vender en Amazon. Salen con stock 0 y sin precio propuesto. El dato de envio directo solo existe en el CSV de tarifa del proveedor, no en su API.';
COMMENT ON COLUMN public.entrais_bloqueados.motivo IS
  'envio_directo = lo manda el fabricante y viene marcado en la tarifa. a_mano = lo hemos bloqueado nosotros por otra razon, y entonces la nota lo explica.';

ALTER TABLE public.entrais_bloqueados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entrais_bloqueados_admin ON public.entrais_bloqueados;
CREATE POLICY entrais_bloqueados_admin ON public.entrais_bloqueados
  FOR ALL USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- ---------- «bloqueado» pasa a ser un origen de precio valido ----------
-- El CHECK de 154 solo admitia 'margen' y 'buybox'. Un producto bloqueado no
-- tiene precio, y hace falta poder decir POR QUE no lo tiene: sin esto seria
-- indistinguible de uno cuyo margen es inalcanzable.
ALTER TABLE public.entrais_precios DROP CONSTRAINT IF EXISTS entrais_precios_origen_check;
ALTER TABLE public.entrais_precios
  ADD CONSTRAINT entrais_precios_origen_check
  CHECK (origen IN ('margen', 'buybox', 'bloqueado'));

-- ---------- Los 51 del fichero del 5 de agosto de 2026 ----------
INSERT INTO public.entrais_bloqueados (sku, nombre, familia, precio_proveedor, motivo, tarifa_fecha)
SELECT v.sku, v.nombre, v.familia, v.precio, 'envio_directo', DATE '2026-08-05'
FROM (VALUES
  ('23630', 'GARANTIA 3 AÑOS ELECTRONIC HP PACK HARDWARE SUP UK703E', 'GARANTIAS', 67.09),
  ('23936', 'GARANTIA 1 AÑO ''''in situ'''' HP 840 G2 650 G1 Z1 Z1 G2 Z220', 'GARANTIAS', 33.84),
  ('24455', 'GARANTIA 2 AÑOS HP RECOGIDA Y ENTREGA HP 470 G7/PROBOOK 450r G6/44X G7/450 G7', 'GARANTIAS', 28.68),
  ('25300', 'GARANTIA 3 AÑOS ELECTRONIC HP PACK HARDWARE SUP U4391E', 'GARANTIAS', 133.22),
  ('25878', 'FUNDA THINKPAD 12'''' LENOVO', 'MALETINES-FUNDAS', 17.71),
  ('27280', 'GARANTIA 3 AÑOS ''''in situ'''' HP G2/G4/G5', 'GARANTIAS', 33.15),
  ('29199', 'GARANTIA 3 AÑOS HP RECOGIDA Y ENTREGA HP 14/15/17/CHROMEBOOK 14/15/X2/X360', 'GARANTIAS', 19.73),
  ('29732', 'GARANTIA 3 AÑOS HP RECOGIDA Y ENTREGA HP 240 G7/245 G4/24X G6/25X(G5-G6-G7)/340S', 'GARANTIAS', 25.26),
  ('30092', 'GARANTIA 3 AÑOS HP RECOGIDA Y ENTREGA HP 245 G7/470 G7/PROBOOK 430 G7/44X G7', 'GARANTIAS', 45.13),
  ('31434', 'LENOVO THINKCENTRE M720q 10T700A8SP', 'EQUIPOS', 407.34),
  ('31449', 'HP PRODESK 400 G6 1C6Z0EA', 'EQUIPOS', 513.61),
  ('31493', 'HUB ESTACION DE ACOPLAMIENTO/ALTAVOZ DE ESCRITORIO VOIP-USB-C', 'CONECTIVIDAD', 38.72),
  ('32926', 'NOTEBOOK LENOVO THINKPAD L14 G1 20U50008SP', 'PORTATILES', 815.75),
  ('34434', 'NOTEBOOK LENOVO THINKPAD L13 G2 21AB000PSP', 'PORTATILES', 795.51),
  ('34457', 'NOTEBOOK LENOVO THINKPAD L13 G2 21AB004GSP', 'PORTATILES', 695.74),
  ('34480', 'LENOVO THINKSTATION P520c 30BX00BUSP', 'EQUIPOS', 1335.28),
  ('35337', 'GARANTIA 3 AÑOS ''''in situ'''' HP 20X G8,PRO400 G9,MINI 260 G9', 'GARANTIAS', 31.38),
  ('38469', 'HP ELITE TORRE 800 G9 5V9G1EA', 'EQUIPOS', 1682.29),
  ('38470', 'HP ELITE SFF 800 G9 5V9F8EA', 'EQUIPOS', 1198.50),
  ('38471', 'HP ELITE SFF 800 G9 5V9G0EA', 'EQUIPOS', 1401.13),
  ('40252', 'GARANTIA 3 AÑOS HP RECOGIDA Y ENTREGA HP EliteBook 630 G10, 64X G10, 65X G10', 'GARANTIAS', 68.95),
  ('40525', 'MOCHILA LENOVO THINKPAD PROFESSIONAL G2 4X41M69794', 'MALETAS-MOCHILAS', 70.73),
  ('42903', 'GARANTIA 5 AÑOS ''''in situ'''' HP ELITEX360/ELITEBOOK 8xx G11', 'GARANTIAS', 223.46),
  ('46527', 'NOTEBOOK HP ELITEBOOK 6 G1i AD2Z8ET', 'PORTATILES', 945.82),
  ('46528', 'NOTEBOOK HP ELITEBOOK 6 G1i AD3A0ET', 'PORTATILES', 1088.28),
  ('46531', 'NOTEBOOK HP ELITEBOOK 6 G1i AD2Z9ET', 'PORTATILES', 993.06),
  ('46533', 'NOTEBOOK HP ELITEBOOK 8 FLIP G1i AD2Z6ET', 'PORTATIL 2en1', 1277.19),
  ('46534', 'NOTEBOOK HP ELITEBOOK 8 FLIP G1i AD2Z7ET', 'PORTATIL 2en1', 1751.11),
  ('46732', 'NOTEBOOK LENOVO THINKBOOK 14 G8 21SJ007XSP', 'PORTATILES', 1492.60),
  ('46733', 'NOTEBOOK LENOVO THINKBOOK 14 G9 21UY000LSP', 'PORTATILES', 1094.64),
  ('46734', 'LENOVO THINKCENTRE M70q G5 12TD000KSP', 'EQUIPOS', 477.24),
  ('46736', 'LENOVO THINKCENTRE NEO 50a 24 G5 12SD006SSP', 'EQUIPOS', 756.07),
  ('46743', 'NOTEBOOK LENOVO THINKPAD E14 G7 21U20025SP', 'PORTATILES', 1293.85),
  ('46744', 'NOTEBOOK LENOVO THINKPAD E16 G3 21ST004JSP', 'PORTATILES', 975.22),
  ('46745', 'NOTEBOOK LENOVO THINKPAD L14 G6 21S6002LSP', 'PORTATILES', 1045.16),
  ('46748', 'NOTEBOOK LENOVO THINKPAD L16 G2 21SA001USP', 'PORTATILES', 1045.16),
  ('46749', 'NOTEBOOK LENOVO THINKPAD T14 G6 21QG001QSP', 'PORTATILES', 1592.66),
  ('46750', 'NOTEBOOK LENOVO THINKPAD T14S 2in1 G1 21R30057SP', 'PORTATILES', 2289.42),
  ('46752', 'NOTEBOOK LENOVO THINKPAD T14S G6 21QX00KLSP', 'PORTATILES', 1592.66),
  ('46755', 'NOTEBOOK LENOVO THINKPAD T1g G8 21TD0001SP', 'PORTATILES', 3113.97),
  ('46759', 'NOTEBOOK LENOVO THINKPAD X9-14 G1 AURA EDITION 21QA002DSP', 'PORTATILES', 1692.61),
  ('46760', 'NOTEBOOK LENOVO THINKPAD X9-14 G1 AURA EDITION 21QA0025SP', 'PORTATILES', 1991.68),
  ('46761', 'LENOVO THINKSTATION P3 G2 30HT005TSP', 'EQUIPOS', 1607.37),
  ('47196', 'NOTEBOOK LENOVO THINKPAD L13 G6 21R5000WSP', 'PORTATILES', 1045.06),
  ('47197', 'NOTEBOOK LENOVO THINKPAD X9-15 G1 AURA EDITION 21Q6001VSP', 'PORTATILES', 1792.23),
  ('47206', 'NOTEBOOK LENOVO THINKPAD L13 G6 21R70016SP', 'PORTATILES', 1393.46),
  ('47209', 'NOTEBOOK LENOVO THINKPAD X13 G6 21RK008BSP', 'PORTATILES', 1891.47),
  ('47210', 'NOTEBOOK LENOVO THINKPAD L14 G6 21S6002USP', 'PORTATILES', 1194.61),
  ('47211', 'NOTEBOOK LENOVO THINKPAD E16 G3 22AY001SSP', 'PORTATILES', 1055.12),
  ('47212', 'NOTEBOOK LENOVO THINKPAD T14 G6 21QG006GSP', 'PORTATILES', 1344.06),
  ('47214', 'NOTEBOOK LENOVO THINKPAD T14 G6 21QG000KSP', 'PORTATILES', 1493.20)
) AS v(sku, nombre, familia, precio)
ON CONFLICT (sku) DO NOTHING;

-- ---------- Comprobacion ----------
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM public.entrais_bloqueados;
  IF n = 0 THEN
    RAISE EXCEPTION 'La lista de bloqueados esta vacia. Un bloqueo que no bloquea nada es peor que no tenerlo: parece puesto.';
  END IF;
  RAISE NOTICE 'Entrais: % articulos bloqueados (envio directo).', n;
END $$;

-- ---------- La ejecucion cuenta cuantos se saltó ----------
-- Sin esta columna, «6.921 productos, 6.870 con precio» invita a buscar un fallo
-- en los 51 que faltan. Con ella la resta cuadra sola.
ALTER TABLE public.entrais_ejecuciones
  ADD COLUMN IF NOT EXISTS bloqueados INTEGER;

COMMENT ON COLUMN public.entrais_ejecuciones.bloqueados IS
  'Articulos que no se pueden vender (envio directo) y salieron sin precio en esta pasada.';
