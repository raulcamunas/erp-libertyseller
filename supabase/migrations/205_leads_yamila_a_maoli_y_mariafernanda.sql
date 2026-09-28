-- ============================================================================
-- 205 · LOS LEADS VIVOS DE YAMILA PASAN A MAOLI Y A MARÍA FERNANDA
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase.
-- VA DESPUÉS DE LA 203: María Fernanda tiene que existir como perfil. Si no
-- está, esto no mueve nada y avisa, en vez de repartirlo todo a Maoli.
--
-- IDEMPOTENTE POR CONSTRUCCIÓN: solo toca lo que siga asignado a Yamila. Una
-- segunda pasada no encuentra nada y no mueve nada.
--
--
-- ============ QUÉ SE MUEVE Y QUÉ NO ============
--
-- Solo los DOS estados que se pidieron: `pendiente` (Sin contactar, 402) y
-- `no_contesta` (No contesta, 52). Son 454.
--
-- Lo demás suyo NO se toca, y es a propósito: una `cita_cualificada` o un
-- `info_enviada` llevan una conversación detrás que es de quien la tuvo, y
-- cambiarle el dueño borra de un plumazo quién habló con esa tienda. Si hay que
-- moverlos, es otra decisión y se ve el historial antes.
--
--
-- ============ POR QUÉ MITAD DE CADA ESTADO Y NO MITAD DEL MONTÓN ============
--
-- 454 partidos por la mitad puede dejar a una con los 52 «no contesta» y a la
-- otra con ninguno. No es lo mismo: un «no contesta» ya se intentó una vez, así
-- que el siguiente toque parte de otro sitio. Repartiendo DENTRO de cada estado,
-- las dos empiezan con la misma mezcla: ~201 sin tocar y ~26 con un intento.
--
-- Y dentro de cada estado se intercalan ORDENADOS POR FACTURACIÓN, una para cada
-- una: si se partiera por la mitad de la lista, a una le caerían los 227 más
-- grandes y a la otra los 227 más pequeños. Es el mismo criterio que usa el
-- Excel de sectores al repartir José y Daniela: que sus números sean comparables.
-- ============================================================================

DO $$
DECLARE
  id_yamila  UUID;
  id_maoli   UUID;
  id_mafer   UUID;
  n_pend     INTEGER;
  n_nocon    INTEGER;
BEGIN
  SELECT id INTO id_yamila FROM public.profiles WHERE email = 'yamila@libertyseller.com';
  SELECT id INTO id_maoli  FROM public.profiles WHERE email = 'maoli@libertyseller.com';
  SELECT id INTO id_mafer  FROM public.profiles WHERE email = 'mariafernanda@libertyseller.es';

  IF id_yamila IS NULL THEN
    RAISE EXCEPTION '205 · No encuentro a Yamila por su email. Míralo antes de seguir.';
  END IF;
  IF id_maoli IS NULL THEN
    RAISE EXCEPTION '205 · No encuentro a Maoli por su email. Míralo antes de seguir.';
  END IF;
  IF id_mafer IS NULL THEN
    RAISE EXCEPTION '205 · María Fernanda todavía no existe. Créala en Gestión de Usuarios, lanza la 203, y vuelve aquí. No muevo nada: repartirlo todo a Maoli sería peor que no hacer nada.';
  END IF;

  SELECT COUNT(*) FILTER (WHERE status = 'pendiente'),
         COUNT(*) FILTER (WHERE status = 'no_contesta')
    INTO n_pend, n_nocon
    FROM public.cold_leads
   WHERE assigned_to = id_yamila AND status IN ('pendiente', 'no_contesta');

  RAISE NOTICE '205 · De Yamila hay % sin contactar y % que no contestan. Total a repartir: %.',
    n_pend, n_nocon, n_pend + n_nocon;

  -- El reparto. ROW_NUMBER por estado y ordenado por facturación: los pares a
  -- una, los impares a la otra. `id` desempata para que dos leads con la misma
  -- facturación no bailen si esto se relanzara.
  WITH numerados AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY status
             ORDER BY revenue_monthly DESC NULLS LAST, id
           ) AS n
      FROM public.cold_leads
     WHERE assigned_to = id_yamila
       AND status IN ('pendiente', 'no_contesta')
  )
  UPDATE public.cold_leads c
     SET assigned_to = CASE WHEN n.n % 2 = 1 THEN id_maoli ELSE id_mafer END,
         updated_at  = NOW()
    FROM numerados n
   WHERE c.id = n.id;

  RAISE NOTICE '205 · Repartidos. Maoli: % · María Fernanda: %',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_maoli),
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_mafer);

  RAISE NOTICE '205 · A Yamila le quedan % leads, todos en estados con conversación detrás: %',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_yamila),
    (SELECT COALESCE(string_agg(DISTINCT status, ', '), 'ninguno')
       FROM public.cold_leads WHERE assigned_to = id_yamila);
END $$;
