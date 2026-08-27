-- ==================================================================
-- 162 · EL CANDADO DE LAS SERIES DEJA PASAR LA PURGA
-- ==================================================================
--
-- Las cinco series temporales del ERP tienen desde la 123 un trigger que corta
-- cualquier UPDATE o DELETE:
--
--     amazon_snapshots_precio · amazon_snapshots_bsr
--     amazon_snapshots_inventario · amazon_fees_estimados
--     amazon_buybox_diagnostico
--
-- Y esta bien que exista. Protege de NOSOTROS, no del navegador: service_role se
-- salta RLS y los GRANT, asi que lo unico que le queda delante a un UPDATE
-- escrito con buena intencion es ese trigger. Un snapshot es lo que se observo
-- en un instante; no se corrige, se añade otro.
--
--
-- PERO TAMBIEN CORTABA LA RETENCION, Y ESO NO ESTABA PREVISTO
-- ----------------------------------------------------------
-- «No corrijas el pasado» y «no puedas retirar lo que ya nadie va a leer» son
-- dos cosas distintas, y el trigger de la 123 las trataba igual. El resultado
-- fue el que se vio el 27 de agosto de 2026: sesenta mil filas al dia, ninguna
-- purga posible, y la base al 177 % del plan.
--
-- El propio mensaje del trigger mandaba a quitarlo y volver a ponerlo. Eso vale
-- para una vez a mano; no vale para una purga que corre cada minuto — dejaria
-- las series sin candado en el hueco entre quitarlo y reponerlo, que es
-- justamente cuando algo puede salir mal.
--
--
-- LA REGLA QUE SE PONE
-- --------------------
-- Solo se puede borrar lo que YA TIENE MAS DE UN DIA. Lo demas sigue prohibido:
--
--     UPDATE      cortado, como antes. El pasado no se corrige.
--     TRUNCATE    cortado, como antes. Es la instruccion mas destructiva y
--                 encima se salta RLS y los CHECK.
--     DELETE      permitido SOLO en filas de hace mas de 24 h.
--
-- El dia de margen es lo que separa «retirar historico» de «borrar lo que se
-- acaba de medir». Un DELETE que se lleve la lectura de hoy sigue siendo un
-- error, y sigue cortando.
--
-- Va a nivel de FILA y no de sentencia porque hay que mirar la fecha de cada
-- una, y eso una sentencia no lo sabe.

CREATE OR REPLACE FUNCTION public.amazon_serie_purga_solo_vieja()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.fecha >= now() - interval '1 day' THEN
    RAISE EXCEPTION
      '% es una serie temporal: solo se pueden retirar filas de hace mas de un dia, y esta es de %. Un snapshot no se corrige ni se borra recien hecho; si sobra, se retira cuando ya nadie lo lee.',
      TG_TABLE_NAME, OLD.fecha
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.amazon_serie_purga_solo_vieja() IS
  'Deja retirar filas de mas de un dia y corta el resto. Sustituye al DELETE del candado de solo insercion (123): «no corrijas el pasado» y «no puedas purgar» no son lo mismo.';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_snapshots_precio',
    'amazon_snapshots_bsr',
    'amazon_snapshots_inventario',
    'amazon_fees_estimados',
    'amazon_buybox_diagnostico'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    -- Fuera el que cortaba UPDATE y DELETE juntos.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_solo_insercion ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_amazon_buybox_diagnostico_solo_insercion ON public.%I', t);

    -- El UPDATE sigue prohibido, con el mismo mensaje de siempre.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sin_update ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_sin_update BEFORE UPDATE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_serie_solo_insercion()', t, t);

    -- El DELETE pasa a mirarse fila a fila.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_purga ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_purga BEFORE DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.amazon_serie_purga_solo_vieja()', t, t);

    -- TRUNCATE sigue cortado. Va aparte porque no se puede combinar con
    -- eventos de fila, y va porque entra en el GRANT ALL de Supabase y ni RLS
    -- ni los CHECK se aplican a TRUNCATE.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_sin_truncate ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_sin_truncate BEFORE TRUNCATE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION public.amazon_serie_solo_insercion()', t, t);
  END LOOP;
END $$;

-- ---------- Comprobacion ----------
-- Se comprueba lo que TIENE que seguir cortado, no lo que ahora pasa: un
-- candado que se ha quedado abierto sin querer no da ningun sintoma hasta que
-- alguien pisa un historico entero.
DO $$
DECLARE
  falla BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.amazon_snapshots_bsr SET rank = rank WHERE false;
    falla := true;
  EXCEPTION WHEN restrict_violation THEN
    NULL;  -- lo esperado
  END;

  IF falla THEN
    RAISE EXCEPTION 'El candado del UPDATE se ha quedado abierto en amazon_snapshots_bsr.';
  END IF;

  RAISE NOTICE 'Series: UPDATE y TRUNCATE siguen cortados; el DELETE deja retirar lo de hace mas de un dia.';
END $$;
