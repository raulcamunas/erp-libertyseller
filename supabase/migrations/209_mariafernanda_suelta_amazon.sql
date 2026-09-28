-- ============================================================================
-- 209 · MARÍA FERNANDA SUELTA SUS LEADS DE AMAZON: 400 A ALEJANDRO, RESTO A MAOLI
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase.
-- VA DESPUÉS de la 205, 206, 207 y 208: reparte lo que esas dejaron en su
-- cartera, y respeta los nombres de lista que puso la 208.
--
-- IDEMPOTENTE: solo toca lo que siga siendo suyo Y sea de tipo seller_amazon.
-- Una segunda pasada no encuentra nada.
--
--
-- ============ POR QUÉ SE VACÍA Y NO SE LE QUITA UN TROZO ============
--
-- María Fernanda pasa a la línea nueva: tiendas que todavía NO venden en
-- Amazon. Los ~762 vendedores de Amazon que había heredado de Yamila, José y
-- Alejandro vuelven al equipo que trabaja esa cartera.
--
-- Por eso el WHERE lleva `tipo_lead = 'seller_amazon'`: cuando tenga sus 1.000
-- tiendas online asignadas y alguien relance esto, no se las lleva por delante.
--
--
-- ============ CÓMO SE PARTEN 400 Y EL RESTO ============
--
-- No se corta la lista por el lead 400: eso le daría a Alejandro los 400 de más
-- facturación y a Maoli los ~362 más pequeños, y sus números dejarían de ser
-- comparables desde el primer día.
--
-- Se reparte PROPORCIONALMENTE a lo largo del orden por facturación, con
-- división entera: de cada tramo, la parte que toca a Alejandro. Salen 400
-- exactos y los dos se llevan la misma mezcla de grandes y pequeños.
-- ============================================================================

DO $$
DECLARE
  id_mafer     UUID;
  id_alejandro UUID;
  id_maoli     UUID;
  n_total      INTEGER;
  n_alejandro  INTEGER;
  n_maoli      INTEGER;
BEGIN
  SELECT id INTO id_mafer     FROM public.profiles WHERE email = 'mariafernanda@libertyseller.es';
  SELECT id INTO id_alejandro FROM public.profiles WHERE email = 'alejandro@libertyseller.com';
  SELECT id INTO id_maoli     FROM public.profiles WHERE email = 'maoli@libertyseller.com';

  IF id_mafer IS NULL OR id_alejandro IS NULL OR id_maoli IS NULL THEN
    RAISE EXCEPTION '209 · Falta alguno de los tres perfiles. No reparto nada a medias.';
  END IF;

  SELECT COUNT(*) INTO n_total
    FROM public.cold_leads
   WHERE assigned_to = id_mafer AND tipo_lead = 'seller_amazon';

  IF n_total = 0 THEN
    RAISE NOTICE '209 · María Fernanda no tiene leads de Amazon. Nada que repartir.';
    RETURN;
  END IF;

  IF n_total < 400 THEN
    RAISE EXCEPTION '209 · Solo tiene % leads y se piden 400 para Alejandro. Míralo antes de seguir.', n_total;
  END IF;

  RAISE NOTICE '209 · Reparte % leads: 400 a Alejandro y % a Maoli.', n_total, n_total - 400;

  WITH numerados AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY revenue_monthly DESC NULLS LAST, id) AS n
      FROM public.cold_leads
     WHERE assigned_to = id_mafer AND tipo_lead = 'seller_amazon'
  )
  UPDATE public.cold_leads c
     SET assigned_to = CASE
           -- División entera: en los tramos donde el cociente avanza, el lead
           -- va a Alejandro. Salen 400 exactos, repartidos por toda la lista.
           WHEN ((n.n - 1) * 400) / n_total <> (n.n * 400) / n_total
             THEN id_alejandro
           ELSE id_maoli
         END,
         source_list = CASE
           WHEN ((n.n - 1) * 400) / n_total <> (n.n * 400) / n_total
             THEN 'Alejandro V3'
           ELSE 'Maoli V2'
         END,
         updated_at = NOW()
    FROM numerados n
   WHERE c.id = n.id;

  SELECT COUNT(*) FILTER (WHERE source_list = 'Alejandro V3'),
         COUNT(*) FILTER (WHERE source_list = 'Maoli V2')
    INTO n_alejandro, n_maoli
    FROM public.cold_leads
   WHERE assigned_to IN (id_alejandro, id_maoli);

  RAISE NOTICE '209 · Alejandro V3: % · Maoli V2 (total): %', n_alejandro, n_maoli;
  RAISE NOTICE '209 · A María Fernanda le quedan % leads de Amazon y % tiendas online.',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_mafer AND tipo_lead = 'seller_amazon'),
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_mafer AND tipo_lead = 'tienda_online');
END $$;
