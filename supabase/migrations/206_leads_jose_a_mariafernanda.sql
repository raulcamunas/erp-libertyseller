-- ============================================================================
-- 206 · LOS «SIN CONTACTAR» DE JOSÉ PASAN A MARÍA FERNANDA
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase.
-- VA DESPUÉS DE LA 203 (María Fernanda tiene que existir) y normalmente después
-- de la 205, aunque el orden entre esas dos da igual: tocan leads distintos.
--
-- IDEMPOTENTE: solo mueve lo que siga siendo de José y en `pendiente`. Una
-- segunda pasada no encuentra nada.
--
--
-- ============ QUÉ SE MUEVE ============
--
-- Los 420 leads de José en estado `pendiente` (Sin contactar). TODOS, sin
-- repartir: es lo que se pidió.
--
-- No se toca nada más suyo. Los 758 que ya ha trabajado —no contesta, rellamada,
-- info enviada, seguimiento, citas— se quedan con él: llevan su conversación
-- detrás y cambiarles el dueño borra quién habló con esa tienda.
--
--
-- ============ UNA COSA QUE VA A VERSE RARA EN LA PANTALLA ============
--
-- `source_list` NO se cambia aquí, a propósito: es de dónde salió el lead, no de
-- quién es. Pero la pantalla pinta las pestañas de lista con ese campo, así que
-- María Fernanda vería dos pestañas llamadas «José V2» y «José» con leads suyos
-- dentro. Eso lo arregla la 208, que renombra las listas por comercial y guarda
-- el origen en `source_list_anterior`.
-- ============================================================================

DO $$
DECLARE
  id_jose   UUID;
  id_mafer  UUID;
  n_mueve   INTEGER;
BEGIN
  SELECT id INTO id_jose  FROM public.profiles WHERE email = 'jose@libertyseller.com';
  SELECT id INTO id_mafer FROM public.profiles WHERE email = 'mariafernanda@libertyseller.es';

  IF id_jose IS NULL THEN
    RAISE EXCEPTION '206 · No encuentro a José por su email. Míralo antes de seguir.';
  END IF;
  IF id_mafer IS NULL THEN
    RAISE EXCEPTION '206 · María Fernanda todavía no existe. Créala en Gestión de Usuarios, lanza la 203, y vuelve aquí.';
  END IF;

  SELECT COUNT(*) INTO n_mueve
    FROM public.cold_leads
   WHERE assigned_to = id_jose AND status = 'pendiente';

  RAISE NOTICE '206 · De José hay % sin contactar. Se mueven todos.', n_mueve;

  UPDATE public.cold_leads
     SET assigned_to = id_mafer,
         updated_at  = NOW()
   WHERE assigned_to = id_jose
     AND status = 'pendiente';

  RAISE NOTICE '206 · Hecho. A José le quedan % leads, todos trabajados: %',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_jose),
    (SELECT COALESCE(string_agg(DISTINCT status, ', '), 'ninguno')
       FROM public.cold_leads WHERE assigned_to = id_jose);

  RAISE NOTICE '206 · María Fernanda se queda con % leads en total.',
    (SELECT COUNT(*) FROM public.cold_leads WHERE assigned_to = id_mafer);
END $$;
