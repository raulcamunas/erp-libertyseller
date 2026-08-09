-- ==================================================================
-- 135 · QUE SE PUEDA BORRAR UN USUARIO OTRA VEZ
-- ==================================================================
--
-- El fallo
-- --------
-- Desde la 129 NO SE PUEDE BORRAR NINGÚN USUARIO DEL ERP. Ni uno. Reproducido
-- en producción al intentar borrar dos cuentas de prueba:
--
--     ERROR 23001: amazon_costes_importaciones es un registro de AUDITORÍA de
--     solo inserción...
--     CONTEXT: SQL statement "UPDATE ONLY public.amazon_costes_importaciones
--              SET created_by = NULL WHERE $1 = created_by"
--
-- La cadena es esta:
--   1. `created_by` de esas dos tablas apunta a profiles con ON DELETE SET NULL.
--   2. Al borrar un usuario, Postgres lanza ese UPDATE para dejarlo a NULL.
--   3. El candado de solo inserción de la 129 se creó FOR EACH STATEMENT.
--
-- Y ahí está el problema: un trigger de instrucción SALTA AUNQUE NO HAYA NI UNA
-- FILA QUE ACTUALIZAR. Los usuarios de prueba no habían importado ningún coste
-- —cero filas en esa tabla— y aun así el borrado moría.
--
-- O sea que el candado no estaba protegiendo la auditoría de nadie: estaba
-- impidiendo dar de baja a cualquiera que se fuera de la empresa.
--
--
-- El arreglo, y por qué no se afloja el candado
-- ---------------------------------------------
-- Se pasa a FOR EACH ROW. Con eso:
--   * Un UPDATE o un DELETE sobre filas de verdad sigue fallando igual. La
--     auditoría sigue siendo inmutable, que es para lo que existe.
--   * Un UPDATE que no toca ninguna fila deja de fallar, porque un trigger de
--     fila no se ejecuta si no hay filas. Es exactamente el caso del borrado de
--     un usuario que nunca importó costes.
--
-- Y se añade UNA excepción, solo una: dejar pasar el UPDATE cuando lo único que
-- cambia es `created_by` pasando a NULL. Eso no es corregir la auditoría —lo
-- que se importó, cuándo y qué salió sigue intacto—, es soltar el puntero a una
-- cuenta que ya no existe. Sin esa excepción, un empleado que SÍ haya importado
-- costes seguiría siendo imborrable para siempre.
--
-- El TRUNCATE se queda como está: ese sí tiene que ser de instrucción, porque
-- no existe a nivel de fila. Y es el que más falta hace, porque ni RLS ni los
-- CHECK se aplican a TRUNCATE.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'amazon_costes_solo_insercion'
  ) THEN
    RAISE EXCEPTION
      'No existe amazon_costes_solo_insercion(). Lanza antes 129_plataforma_a5_costes.sql.';
  END IF;
END $$;


-- ---------- El candado, ahora por fila ----------
CREATE OR REPLACE FUNCTION public.amazon_costes_solo_insercion()
RETURNS TRIGGER AS $$
BEGIN
  -- LA ÚNICA PUERTA: soltar el puntero de un usuario borrado.
  --
  -- Se comprueba que TODO lo demás sigue igual comparando la fila entera con
  -- `created_by` forzado al valor viejo. Si algo más ha cambiado, no coincide y
  -- se bloquea. Es la forma de admitir este caso sin abrir la mano a un UPDATE
  -- que aproveche el viaje para tocar un importe.
  IF TG_OP = 'UPDATE'
     AND NEW.created_by IS NULL
     AND OLD.created_by IS NOT NULL
     AND to_jsonb(NEW) = jsonb_set(to_jsonb(OLD), '{created_by}', 'null'::jsonb)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% es un registro de AUDITORÍA de solo inserción: lo que pasó no se corrige, se añade la corrección como una fila más. Si de verdad hay que purgar histórico antiguo, quita este trigger a propósito y vuelve a ponerlo.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;


-- ---------- Volver a colgarlo, ya por fila ----------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'amazon_costes_importaciones',
    'amazon_costes_auditoria'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_solo_insercion ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_solo_insercion BEFORE UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.amazon_costes_solo_insercion()', t, t);
    -- El de TRUNCATE NO se toca: sigue siendo de instrucción porque TRUNCATE no
    -- tiene versión por fila.
  END LOOP;
END $$;


-- ---------- Comprobación ----------
DO $$
DECLARE nivel TEXT;
BEGIN
  SELECT CASE WHEN tgtype & 1 = 1 THEN 'fila' ELSE 'instruccion' END INTO nivel
  FROM pg_trigger
  WHERE tgname = 'trg_amazon_costes_importaciones_solo_insercion'
    AND tgrelid = 'public.amazon_costes_importaciones'::regclass;

  IF nivel IS DISTINCT FROM 'fila' THEN
    RAISE EXCEPTION
      'El candado de amazon_costes_importaciones sigue siendo de instruccion (%). Sin esto no se puede borrar ningun usuario.',
      COALESCE(nivel, 'no existe');
  END IF;
END $$;
