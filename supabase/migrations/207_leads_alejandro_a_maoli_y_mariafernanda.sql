-- ============================================================================
-- 207 · LOS «SIN CONTACTAR» DE ALEJANDRO SE PARTEN ENTRE MAOLI Y MARÍA FERNANDA
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase.
-- VA DESPUÉS DE LA 203 (María Fernanda tiene que existir). El orden respecto a
-- la 205 y la 206 da igual: cada una toca los leads de un comercial distinto.
--
-- IDEMPOTENTE: solo mueve lo que siga siendo de Alejandro y en `pendiente`.
--
--
-- ============ QUÉ SE MUEVE ============
--
-- Los 230 leads de Alejandro en `pendiente` (Sin contactar), a medias.
--
-- Sus otros 1.656 no se tocan: llevan conversación detrás y cambiarles el dueño
-- borra quién habló con cada tienda.
--
--
-- ============ POR QUÉ INTERCALADOS Y NO PARTIDOS POR LA MITAD ============
--
-- Mismo criterio que la 205. Si se cortara la lista por la mitad ordenada por
-- facturación, a una le caerían los 115 más grandes y a la otra los 115 más
-- pequeños, y sus números dejarían de ser comparables desde el primer día.
-- Intercalando —una para cada una, de mayor a menor— las dos se llevan la misma
-- mezcla. `id` desempata para que dos leads con la misma facturación no bailen.
-- ============================================================================

DO $$
DECLARE
  id_alejandro UUID;
  id_maoli     UUID;
  id_mafer     UUID;
  n_mueve      INTEGER;
BEGIN
  SELECT id INTO id_alejandro FROM public.profiles WHERE email = 'alejandro@libertyseller.com';
  SELECT id INTO id_maoli     FROM public.profiles WHERE email = 'maoli@libertyseller.com';
  SELECT id INTO id_mafer     FROM public.profiles WHERE email = 'mariafernanda@libertyseller.es';

  IF id_alejandro IS NULL THEN
    RAISE EXCEPTION '207 · No encuentro a Alejandro por su email. Míralo antes de seguir.';
  END IF;
  IF id_maoli IS NULL THEN
    RAISE EXCEPTION '207 · No encuentro a Maoli por su email. Míralo antes de seguir.';
  END IF;
  IF id_mafer IS NULL THEN
    RAISE EXCEPTION '207 · María Fernanda todavía no existe. Créala en Gestión de Usuarios, lanza la 203, y vuelve aquí. No muevo nada: repartirlo todo a Maoli sería peor que no hacer nada.';
  END IF;

  SELECT COUNT(*) INTO n_mueve
    FROM public.cold_leads
   WHERE assigned_to = id_alejandro AND status = 'pendiente';

  RAISE NOTICE '207 · De Alejandro hay % sin contactar. Se parten a medias.', n_mueve;

  WITH numerados AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY revenue_monthly DESC NULLS LAST, id) AS n
      FROM public.cold_leads
     WHERE assigned_to = id_alejandro
       AND status = 'pendiente'
  )
  UPDATE public.cold_leads c
     SET assigned_to = CASE WHEN n.n % 2 = 1 THEN id_maoli ELSE id_mafer END,
         updated_at  = NOW()
    FROM numerados n
   WHERE c.id = n.id;

  RAISE NOTICE '207 · Hecho. A Alejandro le quedan % leads, todos trabajados: %',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_alejandro),
    (SELECT COALESCE(string_agg(DISTINCT status, ', '), 'ninguno')
       FROM public.cold_leads WHERE assigned_to = id_alejandro);

  RAISE NOTICE '207 · Cartera ahora — Maoli: % · María Fernanda: %',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_maoli),
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_mafer);
END $$;
