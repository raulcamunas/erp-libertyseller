-- =====================================================
-- CONTROL DE EMPLEADOS
-- =====================================================
-- Hasta hoy los sueldos del equipo eran siete filas de texto libre al mes
-- en treasury_expenses, categoría «equipo»: una por persona, escritas a
-- mano cada mes. Se ve en la propia base de datos que eso no se sostiene —
-- a septiembre le faltan tres personas y una está a cero, no porque no
-- cobren, sino porque nadie llegó a teclearlo—.
--
-- Este módulo sustituye ese apunte manual. La idea central es una sola:
--
--   EL SUELDO NO ES UN NÚMERO, ES UNA SERIE DE ESCALONES.
--
-- Guardar «Carla cobra 690 $» obliga a editar esa celda cada vez que sube y
-- deja el mes pasado mintiendo o borrado. Guardar «Carla: 599 desde abril,
-- 630 desde mayo, 660 desde julio, 690 desde agosto» responde solo a las
-- tres preguntas que se hacen de verdad: cuánto cobra hoy, cuánto cobraba
-- en mayo y cuánto va a cobrar en noviembre. Programar una subida futura
-- deja de ser un recordatorio en la cabeza de alguien y pasa a ser una fila
-- más con fecha de efecto.
--
-- El importe de un mes cualquiera es el ÚLTIMO escalón cuya fecha de efecto
-- sea menor o igual a ese mes. De ahí que effective_from sea siempre día 1:
-- el escalón entra en un mes entero, no a mitad.
--
-- Ojo con la consecuencia del modelo: un escalón se arrastra hacia adelante
-- para siempre. Lo único que corta la serie es la fecha de baja (ended_on).
-- Sin ella, alguien que se fue en marzo seguiría costando dinero en el
-- presupuesto de diciembre.

-- ---------- Quién está en nómina ----------
-- user_id es NULLABLE a propósito y no es un descuido: Carla, Daniella y
-- Yasury cobran todos los meses y no tienen cuenta en el ERP. Atarlo con
-- NOT NULL obligaría a inventarles un usuario solo para poder pagarlas.
-- Y va con ON DELETE SET NULL, no CASCADE: dar de baja el usuario de
-- alguien que se marcha no puede llevarse por delante su histórico de
-- sueldos, que es contabilidad.
CREATE TABLE IF NOT EXISTS public.employees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** Perfil del ERP, si lo tiene. Es lo que enlaza con «Mis Horas» */
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** UNIQUE porque es la clave por la que importa la migración 112: las
      filas viejas de tesorería solo traían el nombre en texto libre */
  name TEXT NOT NULL UNIQUE,
  /** Puesto, en lenguaje de la agencia: «Comercial», «Asistente»... */
  role_label TEXT,
  /** Cómo se le paga:
        'fijo'  -> manda su escalón de sueldo (Carla, Daniella, Yasury)
        'horas' -> el coste sale de «Mis Horas»: horas x tarifa + comisiones
                   por cita cualificada (los cuatro comerciales) */
  pay_model TEXT NOT NULL DEFAULT 'fijo' CHECK (pay_model IN ('fijo', 'horas')),
  /** Horas contratadas. Este dato no existía en ninguna parte del ERP: se
      crea vacío y lo rellena dirección. Para los de 'horas' sirve para
      comparar contra las horas REALES que aparecen en «Mis Horas». */
  contracted_hours NUMERIC CHECK (contracted_hours IS NULL OR contracted_hours >= 0),
  /** Si esas horas son al mes o a la semana. Sin esto, un «20» no dice nada */
  hours_unit TEXT NOT NULL DEFAULT 'mes' CHECK (hours_unit IN ('mes', 'semana')),
  /** Divisa por defecto de la persona. El equipo cobra en dólares */
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('EUR', 'USD')),
  started_on DATE,
  /** Fecha de baja. Es lo ÚNICO que corta la serie de escalones: a partir
      del mes siguiente deja de sumar en Tesorería */
  ended_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  /** Notas rápidas de una línea. Lo que se quiera dejar fechado y firmado
      va a employee_notes, no aquí */
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT employees_dates_ok
    CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);

CREATE INDEX IF NOT EXISTS idx_employees_active
  ON public.employees(is_active, position);

-- Un perfil del ERP no puede estar dado de alta dos veces. Es la red contra
-- el error más caro de este módulo: dos fichas apuntando al mismo user_id
-- harían que el coste calculado desde «Mis Horas» de esa persona se contara
-- dos veces en Tesorería, y cuadraría lo suficiente como para no notarlo.
-- Parcial porque los NULL no chocan entre sí y aquí hay tres.
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user
  ON public.employees(user_id) WHERE user_id IS NOT NULL;

-- Y la misma red para el NOMBRE, que es la otra forma de duplicar a una
-- persona. El UNIQUE de la columna compara texto exacto, así que con «Carla»
-- ya dada de alta, insertar «carla» (o « Carla ») pasa sin rechistar y quedan
-- dos fichas de la misma persona; en cuanto la segunda tenga un escalón, ese
-- sueldo se cuenta dos veces en el total del mes de Tesorería. El índice
-- parcial de arriba no cubre este caso: protege a quien tiene user_id, que es
-- justo quien NO son Carla, Daniella y Yasury.
--
-- Es además la clave con la que la migración 112 casa las filas viejas
-- (lower(btrim(nombre)) = lower(btrim(concepto))), así que la base pasa a
-- garantizar lo que la importación ya daba por supuesto.
--
-- El UNIQUE de la columna se queda: `ON CONFLICT (name)` de la 112 necesita
-- una restricción sobre la columna tal cual, y un índice sobre una expresión
-- no le sirve.
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_name_norm
  ON public.employees(lower(btrim(name)));

-- ---------- Los escalones de sueldo ----------
-- Una fila por subida, no una columna por mes. Doce meses de sueldo de una
-- persona que no cambia son UNA fila, no doce; y una subida pactada para
-- enero es una fila que se mete hoy y ya está.
CREATE TABLE IF NOT EXISTS public.employee_salary_steps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  /** Primer mes en que se cobra este importe. Siempre día 1: el escalón
      entra en un mes completo, no a mitad de mes */
  effective_from DATE NOT NULL,
  /** Bruto mensual. Sin DEFAULT: un escalón sin importe no significa nada */
  gross_amount NUMERIC NOT NULL CHECK (gross_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('EUR', 'USD')),
  /** Por qué subió. Dentro de seis meses nadie se acuerda */
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (employee_id, effective_from),
  CONSTRAINT employee_salary_steps_period_is_first_day
    CHECK (EXTRACT(DAY FROM effective_from) = 1)
);

-- El UNIQUE de arriba ya deja employee_id a la izquierda, pero la consulta
-- real es «el último escalón hasta este mes», que va hacia atrás.
CREATE INDEX IF NOT EXISTS idx_employee_salary_steps_lookup
  ON public.employee_salary_steps(employee_id, effective_from DESC);

-- ---------- Lo que se registró de verdad, mes a mes ----------
-- Esto NO es lo mismo que los escalones y la diferencia es lo que impide
-- que el módulo reescriba la contabilidad.
--
--   escalones -> lo pactado: cuánto le toca cobrar a partir de tal mes.
--   registros -> lo que se apuntó en su día en aquel mes concreto.
--
-- Un mes cerrado vale lo que dice su registro, aunque el escalón diga otra
-- cosa: es la cifra con la que ya se calculó el beneficio de aquel mes y el
-- reparto entre socios. Los escalones mandan del mes en curso en adelante.
-- Cuando las dos cifras existen y no coinciden, la interfaz enseña la
-- diferencia en vez de elegir en silencio: es dinero real.
--
-- La migración 112 llena esta tabla con las filas de tesorería, y por eso
-- el histórico de marzo a septiembre de 2026 no se mueve ni un céntimo.
CREATE TABLE IF NOT EXISTS public.employee_month_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  /** Siempre el día 1 del mes al que corresponde ('yyyy-MM-01'), igual que
      treasury_client_months */
  period DATE NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('EUR', 'USD')),
  /** De dónde salió la cifra. 'tesoreria' = la importó la 112 desde las
      filas viejas de treasury_expenses */
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'tesoreria')),
  paid BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (employee_id, period),
  CONSTRAINT employee_month_records_period_is_first_day
    CHECK (EXTRACT(DAY FROM period) = 1)
);

CREATE INDEX IF NOT EXISTS idx_employee_month_records_period
  ON public.employee_month_records(period);

-- ---------- Notas fechadas ----------
-- Mismo patrón que crm_interactions: una nota es un hecho con fecha y
-- autor, no un campo de texto que el siguiente que entra pisa sin querer.
-- Append-only, así que no lleva updated_at: si una nota está mal se borra y
-- se escribe otra.
CREATE TABLE IF NOT EXISTS public.employee_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  /** SET NULL: si el que la escribió se va del ERP, la nota se queda */
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** Si se añade un tipo aquí hay que añadirlo también a EmployeeNoteKind
      en lib/types/employees.ts, o la interfaz no sabrá pintarlo */
  kind TEXT NOT NULL DEFAULT 'nota'
    CHECK (kind IN ('nota', 'subida', 'revision', 'ausencia', 'aviso')),
  body TEXT NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_notes_employee
  ON public.employee_notes(employee_id, occurred_at DESC);

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.update_employees_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_updated ON public.employees;
CREATE TRIGGER trg_employees_updated
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_employees_updated_at();

DROP TRIGGER IF EXISTS trg_employee_salary_steps_updated ON public.employee_salary_steps;
CREATE TRIGGER trg_employee_salary_steps_updated
  BEFORE UPDATE ON public.employee_salary_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_employees_updated_at();

DROP TRIGGER IF EXISTS trg_employee_month_records_updated ON public.employee_month_records;
CREATE TRIGGER trg_employee_month_records_updated
  BEFORE UPDATE ON public.employee_month_records
  FOR EACH ROW EXECUTE FUNCTION public.update_employees_updated_at();

-- ---------- Quién es admin ----------
-- El resto del ERP usa public.is_admin_or_partner() (migración 071), pero
-- aquí NO vale: un partner puede ver Tesorería, y aun así el desglose de
-- lo que cobra cada persona del equipo no es asunto suyo. Hace falta un
-- filtro de solo-admin.
--
-- Se declara con el mismo mecanismo que la del 071 —consulta profiles.role,
-- SECURITY DEFINER y STABLE— por dos razones concretas:
--   - SECURITY DEFINER: la política tiene que poder leer profiles aunque
--     las políticas de profiles no dejen al usuario leer esa fila. Sin
--     esto, la comprobación de rol devolvería falso y nadie entraría.
--   - STABLE: el planificador la evalúa una vez por consulta y no una vez
--     por fila.
-- No se llama is_admin() para no chocar con nada que ya exista con ese
-- nombre en la base y romper la migración entera por un CREATE OR REPLACE
-- con otro tipo de retorno.
CREATE OR REPLACE FUNCTION public.is_erp_admin(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---------- RLS: solo admin, en las cuatro tablas ----------
-- Son los sueldos de todo el equipo. Un employee no puede leerlos ni
-- aunque alguien le diera por error el permiso de la app: el filtro de
-- verdad está aquí, no en el middleware.
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_salary_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_month_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage employees" ON public.employees;
CREATE POLICY "Admins manage employees"
  ON public.employees FOR ALL TO authenticated
  USING (public.is_erp_admin(auth.uid()))
  WITH CHECK (public.is_erp_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage employee salary steps" ON public.employee_salary_steps;
CREATE POLICY "Admins manage employee salary steps"
  ON public.employee_salary_steps FOR ALL TO authenticated
  USING (public.is_erp_admin(auth.uid()))
  WITH CHECK (public.is_erp_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage employee month records" ON public.employee_month_records;
CREATE POLICY "Admins manage employee month records"
  ON public.employee_month_records FOR ALL TO authenticated
  USING (public.is_erp_admin(auth.uid()))
  WITH CHECK (public.is_erp_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage employee notes" ON public.employee_notes;
CREATE POLICY "Admins manage employee notes"
  ON public.employee_notes FOR ALL TO authenticated
  USING (public.is_erp_admin(auth.uid()))
  WITH CHECK (public.is_erp_admin(auth.uid()));

-- Realtime. Con guardia: añadir una tabla que ya está en la publicación da
-- error, y como el editor SQL de Supabase corre el script entero en una
-- transacción, ese error de la última línea desharía los CREATE TABLE de
-- arriba. La migración parecería aplicada sin haber creado nada.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees',
    'employee_salary_steps',
    'employee_month_records',
    'employee_notes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
