-- =====================================================
-- CONTROL DE EMPLEADOS: importar los sueldos de Tesorería
-- =====================================================
-- Trae al modelo nuevo las filas de treasury_expenses con categoría
-- «equipo» —los sueldos del equipo de marzo a septiembre de 2026, siete
-- personas— y deja UNA sola fuente de verdad.
--
--
-- POR QUÉ HAY QUE SACARLAS DE treasury_expenses, Y NO SOLO ESCONDERLAS
-- -------------------------------------------------------------------
-- El bloque «Empleados al mes» de Tesorería es CALCULADO a partir de estas
-- tablas nuevas, no una copia de filas. Si las filas viejas siguieran vivas,
-- los mismos sueldos estarían dos veces: una en el bloque calculado y otra
-- en la categoría «equipo». Unos 2.337 € de más en agosto de 2026, con el
-- beneficio y el reparto entre socios falseados en la misma cantidad.
--
-- Y no basta con esconderlas ni con moverlas de categoría, porque una fila
-- que la interfaz no pinta sigue siendo dinero escrito en la base. Hoy
-- TreasuryBoard.tsx sí filtra el total por las categorías que sabe pintar
-- —y lo que queda fuera lo enseña como un aviso aparte, con su importe, en
-- vez de sumarlo a ciegas o tirarlo en silencio—, así que el orden entre
-- desplegar y lanzar esta migración ya no puede doblar el gasto del mes. Pero
-- mientras las filas existan, Tesorería seguirá avisando de que hay sueldos
-- apuntados dos veces, que es exactamente lo que pasa.
--
-- Y el bloque se calcula en vez de copiarse justo por lo que enseña esta
-- misma importación: la copia se desfasa. A septiembre le faltan tres
-- personas y una está a cero, no porque no cobren, sino porque copiar a
-- mano siete filas cada mes falla. Un bloque calculado no se puede olvidar
-- de nadie.
--
--
-- LA RED: NADA SE BORRA SIN COPIA
-- -------------------------------
-- Antes de borrar nada, las filas se copian TAL CUAL —con su id original—
-- a public.treasury_expenses_equipo_backup.
--
-- PARA DESHACER LA IMPORTACIÓN ENTERA, esto se pega tal cual en el editor
-- SQL de Supabase y funciona. Los tres pasos van EN ESTE ORDEN: el paso 7
-- de esta migración deja el CHECK sin 'equipo', así que devolver las filas
-- sin volver a permitir la categoría falla y no restaura nada.
--
--     -- 0) ANTES DE NADA: volver atrás el código, no solo la base.
--     --    La interfaz ya no conoce la categoría 'equipo' y pinta el bloque
--     --    «Empleados al mes» calculado. Si se devuelven las filas sin
--     --    revertir el despliegue, Tesorería enseña un aviso de «gastos con
--     --    una categoría retirada» con su importe aparte —no los suma, para
--     --    no contar los sueldos dos veces—, así que el total del mes se
--     --    queda corto hasta que el código vuelva atrás.
--
--     -- 1) volver a admitir la categoría
--     ALTER TABLE public.treasury_expenses
--       DROP CONSTRAINT IF EXISTS treasury_expenses_category_check;
--     ALTER TABLE public.treasury_expenses
--       ADD CONSTRAINT treasury_expenses_category_check
--       CHECK (category IN ('equipo', 'marketing', 'software', 'otros'));
--
--     -- 2) devolver las filas, con su id, su importe y su mes originales
--     INSERT INTO public.treasury_expenses
--       (id, period, category, concept, amount, currency, is_recurring,
--        notes, created_at, updated_at)
--     SELECT id, period, category, concept, amount, currency, is_recurring,
--            notes, created_at, updated_at
--     FROM public.treasury_expenses_equipo_backup
--     ON CONFLICT (id) DO NOTHING;
--
--     -- 3) vaciar el modelo nuevo, o los sueldos contarán DOS VECES
--     --    (borrar el empleado se lleva por delante sus escalones, sus
--     --     registros y sus notas: van con ON DELETE CASCADE)
--     DELETE FROM public.employees;
--
-- Ojo con el paso 3: si alguien ya ha metido a mano escalones o notas en el
-- módulo nuevo, eso también se pierde. Merece la pena mirarlo antes.
--
--
-- EL DESFASE QUE HAY HOY EN LOS DATOS, PARA QUE CONSTE
-- ---------------------------------------------------
-- A fecha de esta migración, en treasury_expenses:
--   - Alejandro, Yasury y Yamila NO tienen fila de septiembre de 2026.
--   - Maoli tiene la de septiembre a 0.
-- Eso no significa que no cobren: significa que nadie las tecleó. Esta
-- importación NO INVENTA esos meses —solo trae lo que hay escrito—, así
-- que el histórico queda exactamente igual que ahora, hasta el céntimo.
-- Los huecos los tapa el modelo de escalones a partir del mes en curso:
-- el último escalón de cada persona sigue vigente hasta que se cambie, y
-- ahí es donde aparece el sueldo de septiembre de quien hoy falta.
--
-- IDEMPOTENTE: se puede lanzar dos veces. Todos los INSERT llevan
-- ON CONFLICT DO NOTHING y los borrados solo alcanzan a filas que en la
-- segunda pasada ya no existen.
--
-- Con un matiz que conviene saber: los escalones se vuelven a deducir de
-- employee_month_records en cada pasada. Si alguien BORRA a mano un escalón
-- de los importados y luego se relanza esta migración, el escalón vuelve.
-- Los que se añadan nuevos no se tocan.

DO $$
DECLARE
  v_mixed TEXT;
BEGIN
  -- Guardia general. Aquí sí se corta con EXCEPCIÓN y no con un aviso: esta
  -- migración mueve dinero de una tabla a otra y las dos mitades tienen que
  -- pasar o no pasar juntas. Un RETURN solo saldría de este bloque, el
  -- resto del script seguiría corriendo y podría borrar de Tesorería sin
  -- haber importado nada. Al reventar aquí, el editor SQL de Supabase
  -- —que corre el script entero en una transacción— lo deshace todo y deja
  -- la base como estaba, que es exactamente lo que se quiere.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'treasury_expenses'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION
      'Faltan tablas (treasury_expenses / employees / profiles). Lanza antes la migración 111_employees.sql';
  END IF;

  -- ---------- 1. La copia de seguridad, antes que nada ----------
  -- Misma forma que la tabla original para poder devolver las filas con un
  -- INSERT ... SELECT sin traducir columnas. La PK sobre el id original es
  -- lo que hace que relanzar la migración no duplique el respaldo.
  CREATE TABLE IF NOT EXISTS public.treasury_expenses_equipo_backup (
    LIKE public.treasury_expenses INCLUDING DEFAULTS
  );

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.treasury_expenses_equipo_backup'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.treasury_expenses_equipo_backup
      ADD PRIMARY KEY (id);
  END IF;

  ALTER TABLE public.treasury_expenses_equipo_backup
    ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ DEFAULT NOW();

  -- Solo la lee un admin, igual que la tabla de la que sale.
  ALTER TABLE public.treasury_expenses_equipo_backup ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "Admins read equipo backup" ON public.treasury_expenses_equipo_backup;
  CREATE POLICY "Admins read equipo backup"
    ON public.treasury_expenses_equipo_backup FOR ALL TO authenticated
    USING (public.is_erp_admin(auth.uid()))
    WITH CHECK (public.is_erp_admin(auth.uid()));

  INSERT INTO public.treasury_expenses_equipo_backup
    (id, period, category, concept, amount, currency, is_recurring, notes,
     created_at, updated_at)
  SELECT id, period, category, concept, amount, currency, is_recurring, notes,
         created_at, updated_at
  FROM public.treasury_expenses
  WHERE category = 'equipo'
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 2. Nada de divisas mezcladas ----------
  -- Un empleado solo puede tener un importe por mes, y ese importe solo
  -- tiene sentido en una divisa. Si alguna persona tuviera en el mismo mes
  -- una fila en dólares y otra en euros, sumarlas daría un número que no
  -- significa nada. Antes que inventarse una conversión aquí, se para: la
  -- copia de seguridad ya está hecha y no se ha borrado nada todavía.
  SELECT string_agg(t.label, ', ')
  INTO v_mixed
  FROM (
    SELECT btrim(concept) || ' / ' || to_char(period, 'YYYY-MM') AS label
    FROM public.treasury_expenses
    WHERE category = 'equipo'
    GROUP BY btrim(concept), period
    HAVING COUNT(DISTINCT currency) > 1
  ) t;

  IF v_mixed IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay sueldos del mismo mes en dos divisas (%). Únifícalos en treasury_expenses y vuelve a lanzar la migración.',
      v_mixed;
  END IF;
END $$;

-- ---------- 3. Las personas ----------
-- Los siete nombres van escritos aquí porque son los que hay: la categoría
-- «equipo» es texto libre y no hay forma de saber por SQL si «Carla» es una
-- persona o un concepto de gasto. Lo que NO va escrito a mano son los
-- importes: esos salen de las filas reales de la base, más abajo. Así la
-- migración vale igual en producción que en una base sembrada con la 096,
-- que ya no coinciden.
--
-- La forma de cobro es la diferencia de fondo entre los dos grupos:
--   'horas' -> los cuatro comerciales. Su coste no es un sueldo pactado,
--              es horas x tarifa + comisiones por cita, y eso ya vive en
--              «Mis Horas». Aquí no se duplica: se calcula desde allí.
--   'fijo'  -> Carla, Daniella y Yasury. Cobran un importe mensual y no
--              tienen ni cuenta en el ERP ni horas apuntadas, así que su
--              único origen posible es el escalón de sueldo.
DO $$
DECLARE
  v_sueltos TEXT;
BEGIN
  INSERT INTO public.employees (name, role_label, pay_model, currency, position, is_active)
  VALUES
    ('Carla',     NULL,        'fijo',  'USD', 1, true),
    ('Daniella',  NULL,        'fijo',  'USD', 2, true),
    ('Yasury',    NULL,        'fijo',  'USD', 3, true),
    ('Alejandro', 'Comercial', 'horas', 'USD', 4, true),
    ('Jose',      'Comercial', 'horas', 'USD', 5, true),
    ('Maoli',     'Comercial', 'horas', 'USD', 6, true),
    ('Yamila',    'Comercial', 'horas', 'USD', 7, true)
  ON CONFLICT (name) DO NOTHING;

  -- El enlace con el ERP se hace por CORREO, nunca con un UUID copiado a
  -- mano: los identificadores de profiles no se conocen al escribir la
  -- migración y uno copiado de otra base apuntaría a la persona equivocada.
  -- Carla, Daniella y Yasury se quedan sin user_id porque no tienen cuenta.
  UPDATE public.employees e
  SET user_id = p.id
  FROM public.profiles p
  WHERE e.user_id IS NULL
    AND p.email = lower(e.name) || '@libertyseller.com';

  -- ---------- Y comprobar que el enlace ha cuajado ----------
  -- Guardia simétrica a la de las divisas, y por el mismo motivo: aquí se
  -- está decidiendo dinero. El correo se deduce del nombre, así que basta con
  -- que uno no encaje letra por letra —una tilde en «José», un apellido en el
  -- local-part, otro dominio— para que ese comercial se quede con user_id
  -- NULL. A partir de ahí lib/employees/data.ts lo excluye del cálculo por
  -- horas y su coste sale 0 en Tesorería en el mes en curso y en todos los
  -- futuros, en silencio y para siempre: exactamente el cero que este módulo
  -- venía a matar.
  --
  -- Se corta con EXCEPCIÓN y no con un aviso porque el editor SQL de Supabase
  -- corre el script entero en una transacción: reventar aquí deja la base
  -- intacta, con las filas de sueldos todavía en Tesorería, en vez de a
  -- medias. Se arregla el correo en profiles (o se pone el user_id a mano, o
  -- se enlaza desde la ficha en Control empleados) y se vuelve a lanzar.
  SELECT string_agg(name, ', ' ORDER BY name)
  INTO v_sueltos
  FROM public.employees
  WHERE pay_model = 'horas' AND user_id IS NULL;

  IF v_sueltos IS NOT NULL THEN
    RAISE EXCEPTION
      'Sin perfil del ERP enlazado (%): cobran por horas, así que su coste saldría 0 € en Tesorería todos los meses. Corrige el correo en profiles —se busca como nombre@libertyseller.com en minúsculas— o enlaza el perfil a mano, y vuelve a lanzar la migración.',
      v_sueltos;
  END IF;
END $$;

-- ---------- 4. Lo registrado mes a mes ----------
-- Copia literal de lo que había en Tesorería, una fila por persona y mes.
-- Es lo que garantiza que los meses ya cerrados sigan valiendo lo mismo que
-- valían: el beneficio de mayo de 2026 y el reparto entre socios de aquel
-- mes no se pueden mover porque ahora exista un modelo mejor.
--
-- El SUM() es por si una persona tuviera dos apuntes en el mismo mes (una
-- paga extra apuntada aparte, por ejemplo): el mes vale la suma.
INSERT INTO public.employee_month_records (employee_id, period, amount, currency, source, notes)
SELECT
  e.id,
  x.period,
  SUM(x.amount),
  -- MIN() y no una conversión: el paso 2 ya ha comprobado que en un mismo
  -- mes no hay dos divisas, así que aquí solo puede haber una y MIN()
  -- devuelve esa. Si algún día dejara de cumplirse, salta antes la excepción.
  MIN(x.currency),
  'tesoreria',
  'Importado de Tesorería (categoría equipo)'
FROM public.treasury_expenses x
JOIN public.employees e ON lower(btrim(e.name)) = lower(btrim(x.concept))
WHERE x.category = 'equipo'
GROUP BY e.id, x.period
ON CONFLICT (employee_id, period) DO NOTHING;

-- La fecha de alta que se conoce es la primera vez que aparece en los
-- papeles. No es necesariamente el día que entró —solo el primer mes que
-- alguien apuntó—, pero sirve para lo que hace falta: que los meses
-- anteriores no cuenten como sueldo suyo. Se puede corregir a mano.
UPDATE public.employees e
SET started_on = m.first_period
FROM (
  SELECT employee_id, MIN(period) AS first_period
  FROM public.employee_month_records
  GROUP BY employee_id
) m
WHERE m.employee_id = e.id AND e.started_on IS NULL;

-- ---------- 5. De importes mensuales a ESCALONES ----------
-- Aquí está la conversión que da sentido al módulo. Seis importes seguidos
-- no son seis datos: son las subidas y los tramos entre subidas.
--
--   Carla, tal y como está hoy en Tesorería:
--     abr 599 · may 630 · jun 630 · jul 660 · ago 690 · sep 690
--   se convierte en CUATRO escalones, no seis:
--     599 desde abril · 630 desde mayo · 660 desde julio · 690 desde agosto
--
-- Junio y septiembre no son escalones porque no cambia nada: ya lo dice el
-- escalón anterior. Solo se crea uno cuando el importe (o la divisa) es
-- distinto del mes anterior REGISTRADO —LAG sobre la serie ordenada—.
--
-- Solo para los de sueldo fijo. A los comerciales no se les crea ningún
-- escalón a propósito: lo que cobran no es un importe pactado al mes sino
-- el resultado de sus horas y sus citas, y ponerles aquí un número que el
-- módulo va a ignorar es justo lo que dentro de seis meses alguien
-- «arreglaría» pasándolos a fijo y descuadrando la nómina. Su histórico
-- está entero en employee_month_records, que es donde tiene que estar.
INSERT INTO public.employee_salary_steps (employee_id, effective_from, gross_amount, currency, reason)
SELECT employee_id, period, amount, currency,
       'Importado del histórico de Tesorería'
FROM (
  SELECT
    r.employee_id,
    r.period,
    r.amount,
    r.currency,
    LAG(r.amount)   OVER (PARTITION BY r.employee_id ORDER BY r.period) AS prev_amount,
    LAG(r.currency) OVER (PARTITION BY r.employee_id ORDER BY r.period) AS prev_currency
  FROM public.employee_month_records r
  JOIN public.employees e ON e.id = r.employee_id
  WHERE e.pay_model = 'fijo'
) s
WHERE prev_amount IS NULL
   OR s.amount IS DISTINCT FROM prev_amount
   OR s.currency IS DISTINCT FROM prev_currency
ON CONFLICT (employee_id, effective_from) DO NOTHING;

-- ---------- 6. Fuera de treasury_expenses ----------
DO $$
DECLARE
  v_borradas INTEGER;
  v_movidas INTEGER;
BEGIN
  -- Primero lo que NO es una persona. Si en «equipo» hubiera un gasto que
  -- no cuadra con ningún empleado (un extra, un finiquito apuntado con otro
  -- nombre), borrarlo haría desaparecer dinero del mes. Sigue el precedente
  -- de la migración 100: se cambia de categoría conservando el concepto y
  -- el importe, y se deja dicho de dónde viene.
  UPDATE public.treasury_expenses x
  SET category = 'otros',
      notes = COALESCE(x.notes || ' · ', '') ||
              'Estaba en «equipo» pero no cuadra con ningún empleado de Control empleados (migración 112)'
  WHERE x.category = 'equipo'
    AND NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE lower(btrim(e.name)) = lower(btrim(x.concept))
    );
  GET DIAGNOSTICS v_movidas = ROW_COUNT;

  -- Y ahora sí, fuera las que ya están importadas. La condición se apoya en
  -- employee_month_records, no en la tabla de respaldo: solo se borra lo
  -- que se puede demostrar que ha llegado al modelo nuevo.
  DELETE FROM public.treasury_expenses x
  USING public.employees e, public.employee_month_records r
  WHERE x.category = 'equipo'
    AND lower(btrim(e.name)) = lower(btrim(x.concept))
    AND r.employee_id = e.id
    AND r.period = x.period;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;

  RAISE NOTICE 'Sueldos importados y retirados de Tesorería: % filas borradas, % movidas a «otros»',
    v_borradas, v_movidas;
END $$;

-- ---------- 7. Que no puedan volver ----------
-- Con las filas fuera, el botón «Traer del mes anterior» de Tesorería ya no
-- tiene ningún sueldo recurrente que arrastrar. Lo que queda por tapar es
-- que alguien vuelva a dar de alta un gasto de «equipo» a mano y el mes se
-- cuente dos veces sin que salte nada. Se cierra en la base: la categoría
-- deja de existir.
--
-- De paso se arregla un desajuste que venía de antes: la migración 100
-- retiró «mentoría» de la interfaz pero dejó el CHECK aceptándola, así que
-- la base admitía una categoría que el ERP ya no sabía pintar.
--
-- LO QUE HACE LA INTERFAZ, que va con esto y ya está escrito:
--   - 'equipo' no existe en EXPENSE_CATEGORIES (lib/types/treasury.ts),
--   - en su lugar se pinta el bloque «Empleados al mes» CALCULADO,
--   - ese total se suma en expenseTotal Y TAMBIÉN en evolution, que vuelve a
--     sumar los gastos por su cuenta para la gráfica de doce meses y es el
--     sitio que siempre se olvida,
--   - y los dos filtran por las categorías que la pantalla sabe pintar, así
--     que una fila de sueldo que sobreviviera aquí no puede colarse en el
--     total: sale como aviso, con su importe, en el panel de gastos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'treasury_expenses'
  ) THEN
    -- Red de seguridad: nada puede quedar fuera de la lista nueva, o el
    -- ALTER de abajo fallaría y desharía el script entero.
    UPDATE public.treasury_expenses
    SET category = 'otros'
    WHERE category NOT IN ('marketing', 'software', 'otros');

    ALTER TABLE public.treasury_expenses
      DROP CONSTRAINT IF EXISTS treasury_expenses_category_check;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.treasury_expenses'::regclass
        AND conname = 'treasury_expenses_category_check'
    ) THEN
      ALTER TABLE public.treasury_expenses
        ADD CONSTRAINT treasury_expenses_category_check
        CHECK (category IN ('marketing', 'software', 'otros'));
    END IF;
  END IF;
END $$;
