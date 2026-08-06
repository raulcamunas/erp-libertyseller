-- =====================================================
-- EMPLEADOS: alta de Betty y enlace de las tres cuentas nuevas
-- =====================================================
-- Se dan de alta en el ERP tres cuentas que antes no existían:
--
--   daniella@libertyseller.com  -> la ficha «Daniella»
--   yasury@libertyseller.com    -> la ficha «Yasury»
--   betty@libertyseller.com     -> ficha nueva, marketing de PPC
--
-- El enlace va como tabla explícita de nombre a correo y no derivando el
-- correo del nombre, que es lo que hacía la 112:
--
--     p.email = lower(e.name) || '@libertyseller.com'
--
-- Hoy las tres cuadrarían con esa regla, pero basta una ficha escrita con un
-- acento, un apellido o una abreviatura para que deje de cuadrar, y el fallo
-- no avisa: la ficha se queda con user_id a NULL —sin acceso a pedir sus
-- vacaciones y sin poder verse nada suyo— y la pantalla se muestra normal.
-- Escribir a mano las tres parejas cuesta menos que enterarse por las malas.
--
-- Idempotente: se puede lanzar las veces que haga falta.
-- Se lanza DESPUÉS de crear las tres cuentas en Gestión de Usuarios; si
-- alguna todavía no existe, esa se queda sin enlazar y la migración lo avisa
-- por consola en vez de fallar, para que las demás sí entren.

-- ---------- Betty ----------
-- Marketing de PPC, 4 h al día de lunes a viernes = 20 h a la semana.
--
-- Se queda SIN escalón de sueldo y SIN fecha de alta a propósito: ninguno de
-- los dos datos se ha dicho, y los dos mueven dinero. El sueldo sale en
-- Tesorería y la fecha de alta decide cuántos días de vacaciones genera, así
-- que inventarlos sería peor que dejarlos vacíos, donde se ven y se rellenan.
INSERT INTO public.employees (name, role_label, pay_model, contracted_hours, hours_unit, currency)
VALUES ('Betty', 'Marketing PPC', 'fijo', 20, 'semana', 'USD')
ON CONFLICT (name) DO UPDATE
  SET role_label       = EXCLUDED.role_label,
      contracted_hours = EXCLUDED.contracted_hours,
      hours_unit       = EXCLUDED.hours_unit;

-- ---------- Enlace de fichas con cuentas ----------
DO $$
DECLARE
  par    RECORD;
  uid    UUID;
  faltan TEXT := '';
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('Daniella', 'daniella@libertyseller.com'),
      ('Yasury',   'yasury@libertyseller.com'),
      ('Betty',    'betty@libertyseller.com')
    ) AS t(nombre, correo)
  LOOP
    SELECT id INTO uid FROM public.profiles WHERE lower(btrim(email)) = par.correo;

    IF uid IS NULL THEN
      faltan := faltan || ' ' || par.correo;
      CONTINUE;
    END IF;

    UPDATE public.employees
    SET user_id = uid
    WHERE lower(btrim(name)) = lower(par.nombre)
      -- No se pisa un enlace que ya esté puesto y sea otro: si alguien lo
      -- corrigió a mano, manda lo que hay en la base, no esta tabla.
      AND (user_id IS NULL OR user_id = uid);
  END LOOP;

  IF faltan <> '' THEN
    RAISE NOTICE 'Sin enlazar (esas cuentas todavía no existen en profiles):%', faltan;
    RAISE NOTICE 'Créalas en Gestión de Usuarios y vuelve a lanzar esta migración.';
  END IF;
END $$;

-- ---------- Vacaciones de Betty ----------
-- Va dentro de una guarda porque la columna la crea la migración de
-- vacaciones (116): si todavía no se ha lanzado, esto no puede tirar abajo el
-- alta de Betty ni los enlaces de arriba, que no dependen de ella.
--
-- 1,83 días al mes, los mismos que Yasury y Daniella. Trabajar 4 h al día no
-- da menos DÍAS de vacaciones, da días más cortos: el derecho se cuenta en
-- días naturales de descanso, no en horas. Si en su contrato se pactó otra
-- cosa, es un campo de su ficha.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND column_name = 'vacation_days_per_month'
  ) THEN
    UPDATE public.employees
    SET vacation_days_per_month = 1.83
    WHERE lower(btrim(name)) = 'betty'
      AND vacation_days_per_month IS NULL;
  ELSE
    RAISE NOTICE 'Sin la migración 116 no hay columna de vacaciones: lánzala y repite esta.';
  END IF;
END $$;
