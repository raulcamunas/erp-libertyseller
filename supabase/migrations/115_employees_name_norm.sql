-- =====================================================
-- CONTROL DE EMPLEADOS: que dos fichas no sean la misma persona
-- =====================================================
-- Va suelta y no dentro de la 111 porque la 111 ya está lanzada: editarla
-- allí no cambiaría nada en una base que ya la tiene aplicada. En la 111
-- está añadido igualmente, para que una base nueva nazca ya con el índice.
-- La 111 dejó el nombre como `TEXT NOT NULL UNIQUE`, que compara texto
-- EXACTO. Con la ficha de «Carla» ya creada, esto pasa sin dar error:
--
--     INSERT INTO employees (name, pay_model, currency)
--     VALUES ('carla', 'fijo', 'USD');   -- INSERT 0 1
--
-- Y quedan dos fichas de la misma persona. El índice único de user_id no
-- lo evita: solo alcanza a quien tiene perfil del ERP, que es justo quien NO
-- son Carla, Daniella y Yasury —las tres de sueldo fijo y sin cuenta—. En
-- cuanto la ficha duplicada tenga un escalón, employeesMonthTotal() recorre
-- TODAS las filas de employees y ese sueldo entra dos veces en el total del
-- mes de Tesorería, con el beneficio y el reparto entre socios movidos en la
-- misma cantidad. Y por pantalla no se ve: la lista enseña dos nombres que
-- se parecen mucho.
--
-- Esta migración añade el índice sobre el nombre NORMALIZADO. Es la misma
-- clave con la que la 112 casa las filas viejas de Tesorería
-- (lower(btrim(e.name)) = lower(btrim(x.concept))), así que la base pasa a
-- garantizar lo que la importación ya daba por supuesto.
--
-- El UNIQUE de la columna se queda donde está: `ON CONFLICT (name)` de la 112
-- necesita una restricción sobre la columna tal cual y un índice sobre una
-- expresión no le vale.
--
-- IDEMPOTENTE: se puede lanzar dos veces sin efecto.

DO $$
DECLARE
  v_dupes TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) THEN
    RAISE EXCEPTION 'No existe public.employees. Lanza antes la migración 111_employees.sql';
  END IF;

  -- Si YA hay duplicados, el CREATE UNIQUE INDEX fallaría con un mensaje que
  -- no dice a quién mirar. Se comprueba antes y se nombra a los implicados:
  -- juntarlos a mano es decisión de dirección (hay que decidir con qué ficha
  -- se queda el histórico), no algo que pueda hacer una migración sola.
  SELECT string_agg(DISTINCT lower(btrim(name)), ', ')
  INTO v_dupes
  FROM public.employees
  GROUP BY lower(btrim(name))
  HAVING COUNT(*) > 1;

  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay fichas repetidas de la misma persona (%). Su sueldo se está contando dos veces en Tesorería: junta el histórico en una sola ficha, borra la otra y vuelve a lanzar esta migración.',
      v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_name_norm
  ON public.employees(lower(btrim(name)));
