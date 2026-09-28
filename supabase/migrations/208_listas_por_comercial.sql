-- ============================================================================
-- 208 · LAS LISTAS DE MAOLI Y MARÍA FERNANDA PASAN A LLAMARSE COMO ELLAS
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- VA DESPUÉS de la 205, la 206 y la 207: primero se reparten los leads, después
-- se renombran las listas. Al revés, los que llegaran luego se quedarían con el
-- nombre viejo.
--
--
-- ============ QUÉ SE VE HOY Y QUÉ SE QUIERE VER ============
--
-- `source_list` es lo que pinta las pestañas de lista en la pantalla. Después
-- del reparto, Maoli ve cinco pestañas que hablan de otros:
--
--     Maoli (457) · Yamila (227) · Alejandro V2 (109) · 1a lista (5) · 2a lista (1)
--
-- Y queda así:
--
--     Maoli V1  -> sus 457 de siempre
--     Maoli V2  -> los 342 que le acaban de llegar
--     María Fernanda V1 -> todo lo suyo junto
--
--
-- ============ ESTO PISA UN DATO, Y POR ESO SE GUARDA ANTES ============
--
-- `source_list` decía de qué tanda salió el lead. Al renombrarlo por comercial,
-- ese rastro desaparece: mañana no habría forma de saber que una tienda venía
-- de la cartera de Yamila o de la segunda lista de Alejandro.
--
-- Es una decisión tomada a sabiendas —lo que se quiere en pantalla es de quién
-- es la lista, no de dónde salió— pero el dato viejo se copia a
-- `source_list_anterior` antes de pisarlo. Es una columna que no pinta nadie y
-- que no cuesta nada: solo está ahí para el día que alguien pregunte de dónde
-- salió una tienda.
--
-- Solo se rellena la PRIMERA vez (si ya tiene valor no se toca), para que
-- relanzar esto no acabe guardando «Maoli V2» como si fuera el origen.
-- ============================================================================

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS source_list_anterior TEXT;

COMMENT ON COLUMN public.cold_leads.source_list_anterior IS
  'De qué tanda salió el lead antes de que las listas se renombraran por comercial (migración 208). No se pinta en ninguna pantalla: está para poder reconstruir el origen.';

DO $$
DECLARE
  id_maoli UUID;
  id_mafer UUID;
  n_v1 INTEGER; n_v2 INTEGER; n_mf INTEGER;
BEGIN
  SELECT id INTO id_maoli FROM public.profiles WHERE email = 'maoli@libertyseller.com';
  SELECT id INTO id_mafer FROM public.profiles WHERE email = 'mariafernanda@libertyseller.es';

  IF id_maoli IS NULL OR id_mafer IS NULL THEN
    RAISE EXCEPTION '208 · Falta Maoli o María Fernanda. No renombro nada a medias.';
  END IF;

  -- Se guarda el origen antes de pisarlo, y solo si no estaba ya guardado.
  UPDATE public.cold_leads
     SET source_list_anterior = source_list
   WHERE assigned_to IN (id_maoli, id_mafer)
     AND source_list_anterior IS NULL
     AND source_list IS NOT NULL;

  -- MAOLI V1: los suyos de siempre. MAOLI V2: todo lo demás que tenga ahora,
  -- que es lo que le acaba de llegar de Yamila y de Alejandro.
  UPDATE public.cold_leads
     SET source_list = 'Maoli V1', updated_at = NOW()
   WHERE assigned_to = id_maoli AND source_list = 'Maoli';

  UPDATE public.cold_leads
     SET source_list = 'Maoli V2', updated_at = NOW()
   WHERE assigned_to = id_maoli
     AND (source_list IS DISTINCT FROM 'Maoli V1')
     AND (source_list IS DISTINCT FROM 'Maoli V2');

  -- MARÍA FERNANDA V1: todo junto, que es lo pedido. Empieza de cero, así que
  -- no hay nada suyo «de antes» que distinguir.
  UPDATE public.cold_leads
     SET source_list = 'María Fernanda V1', updated_at = NOW()
   WHERE assigned_to = id_mafer
     AND source_list IS DISTINCT FROM 'María Fernanda V1';

  SELECT COUNT(*) FILTER (WHERE source_list = 'Maoli V1'),
         COUNT(*) FILTER (WHERE source_list = 'Maoli V2')
    INTO n_v1, n_v2
    FROM public.cold_leads WHERE assigned_to = id_maoli;

  SELECT COUNT(*) INTO n_mf
    FROM public.cold_leads WHERE assigned_to = id_mafer;

  RAISE NOTICE '208 · Maoli V1: % · Maoli V2: % · María Fernanda V1: %', n_v1, n_v2, n_mf;

  RAISE NOTICE '208 · De dónde venían los de Maoli V2: %',
    (SELECT COALESCE(string_agg(DISTINCT source_list_anterior, ', '), 'sin rastro')
       FROM public.cold_leads
      WHERE assigned_to = id_maoli AND source_list = 'Maoli V2');
END $$;
