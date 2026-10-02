-- ============================================================================
-- 214 · EN LA CITA, SI EL LEAD VENDE YA EN AMAZON O NO
-- ============================================================================
--
-- Es la primera pregunta de la llamada y la que decide el discurso entero, igual
-- que en Cold Calling. Un seller que ya está en Amazon y una tienda que vende por
-- su web son dos conversaciones distintas, dos propuestas distintas y dos precios
-- distintos: saberlo DESPUÉS de agendar no sirve de nada.
--
-- Por eso la columna va en `appointments` y no en las notas: se filtra, se cuenta
-- y decide qué campos se piden más abajo en la propia ficha.
--
--
-- ============ EL MISMO VOCABULARIO QUE COLD CALLING, LETRA POR LETRA ============
--
-- 'sin_comprobar' | 'no_vende' | 'vende', exactamente como
-- cold_leads.vende_en_amazon (migración 204). No es una coincidencia bonita: los
-- leads de Cold Calling acaban en una cita, y si cada tabla tuviera su propia
-- palabra para lo mismo habría que traducir en cada consulta que cruce las dos.
-- Un 'no' aquí y un 'no_vende' allí es la clase de diferencia que nadie recuerda
-- a los seis meses.
--
-- 'sin_comprobar' es el valor de partida A PROPÓSITO, y no 'no_vende': las citas
-- que ya existen hoy no se han preguntado, y marcarlas como que no venden sería
-- inventarse un dato. La diferencia entre «lo hemos mirado y no vende» y «nadie
-- lo ha mirado» es justo la que hace que la pantalla pueda pedir que se mire.
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS vende_en_amazon TEXT NOT NULL DEFAULT 'sin_comprobar'
    CHECK (vende_en_amazon IN ('sin_comprobar', 'no_vende', 'vende'));

COMMENT ON COLUMN public.appointments.vende_en_amazon IS
  'Si el lead ya vende en Amazon. Mismo vocabulario que cold_leads.vende_en_amazon (204) '
  'para que las dos tablas se puedan cruzar sin traducir. Decide el discurso de la llamada '
  'y qué campos pide la ficha: con «no_vende» se piden los datos de su tienda, que es lo '
  'único que hay para preparar la propuesta.';


-- ============================================================================
-- LOS DATOS DE SU TIENDA, QUE SOLO EXISTEN SI NO VENDE EN AMAZON
-- ============================================================================
--
-- Cuando el lead YA vende en Amazon, lo que hay que mirar es su escaparate allí y
-- para eso ya está `amazon_link`. Cuando NO vende, no hay escaparate que mirar: la
-- propuesta se prepara con lo que tenga montado por su cuenta —qué plataforma usa,
-- cuántas referencias tiene, cuánto lleva abierto— y eso hoy no cabía en ningún
-- sitio de la cita y acababa escrito a mano en las notas, donde no se puede ni
-- filtrar ni contar.
--
-- SON LOS MISMOS NOMBRES QUE EN cold_leads (204), por lo mismo que arriba: estos
-- datos vienen muchas veces de un lead importado y tienen que poder copiarse de
-- una tabla a otra sin un mapa de nombres por medio.
--
-- NO SE REPITE `ventas_estimadas_usd`: la cita ya tiene `revenue_amount` desde la
-- 075 y es el mismo dato. Dos columnas para la facturación acabarían con una
-- rellena y la otra vacía, y nadie sabría cuál mirar.
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS razon_social TEXT,
  ADD COLUMN IF NOT EXISTS cif TEXT,
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS ciudad TEXT,
  ADD COLUMN IF NOT EXISTS plataforma TEXT,
  ADD COLUMN IF NOT EXISTS n_productos INTEGER CHECK (n_productos IS NULL OR n_productos >= 0),
  ADD COLUMN IF NOT EXISTS anos_tienda NUMERIC(4,1) CHECK (anos_tienda IS NULL OR anos_tienda >= 0),
  ADD COLUMN IF NOT EXISTS web TEXT;

COMMENT ON COLUMN public.appointments.plataforma IS
  'Con qué tiene montada la tienda: PrestaShop, Shopify, WooCommerce… Es el dato que más '
  'dice de cuánto trabajo es migrarle el catálogo a Amazon.';
COMMENT ON COLUMN public.appointments.n_productos IS
  'Cuántas referencias tiene en su tienda. Decide si la propuesta es de catálogo entero o '
  'de una selección.';
COMMENT ON COLUMN public.appointments.anos_tienda IS
  'Años que lleva abierta la tienda. Una de tres meses y una de ocho años no se tratan igual.';
COMMENT ON COLUMN public.appointments.web IS
  'La web de su tienda. Es el equivalente de amazon_link para quien todavía no vende en Amazon.';


-- ============================================================================
-- COMPROBACIÓN · en filas, porque el editor de Supabase no enseña los NOTICE
-- ============================================================================
SELECT
  vende_en_amazon                                     AS que_dice_la_cita,
  count(*)                                            AS citas,
  CASE vende_en_amazon
    WHEN 'sin_comprobar' THEN 'nadie lo ha preguntado todavía — es lo normal recién lanzada'
    WHEN 'no_vende'      THEN 'se le piden los datos de su tienda'
    ELSE                      'se le pide el enlace de su escaparate en Amazon'
  END                                                 AS que_pide_la_ficha
FROM public.appointments
GROUP BY 1
ORDER BY 2 DESC;
