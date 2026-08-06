-- =====================================================
-- VACACIONES
-- =====================================================
-- Hasta hoy las vacaciones del equipo se pedían por WhatsApp y se apuntaban
-- en la cabeza de alguien. Eso falla de las dos maneras: nadie sabe cuántos
-- días le quedan a cada uno, y una petición que no se contesta no deja
-- rastro de que existió.
--
-- La idea central es una sola:
--
--   EL DERECHO A VACACIONES ES UN CAMPO DE LA FICHA, NO UNA LISTA DE NOMBRES.
--
-- Hoy generan vacaciones dos personas —Yasury y Daniella, a 1,83 días por
-- mes trabajado— y la tentación es escribir eso en el código: un
-- `if (nombre === 'Yasury')` o una constante con dos nombres. Sería una bomba
-- de relojería. El día que entre una tercera persona, o que a una de estas
-- dos le cambie el convenio, hay que tocar código, desplegar y acordarse de
-- los tres sitios donde estaba escrito el nombre. Con una columna, dar de
-- alta a alguien en vacaciones es teclear un número en su ficha.
--
-- NULL en esa columna significa «esta persona no genera vacaciones aquí», que
-- es distinto de cero: cero sería «genera 0 días al mes», y la pantalla
-- enseñaría un saldo a cero como si fuera un dato. NULL la deja fuera del
-- módulo entero.
--
-- LA OTRA DECISIÓN QUE NO ES OBVIA: LAS PETICIONES PENDIENTES RESTAN DEL
-- SALDO. Un saldo que solo descuenta lo aprobado deja pedir los mismos cinco
-- días dos veces, y las dos peticiones parecen caber. Cuando el admin
-- aprueba la segunda ya es tarde: el saldo se ha ido a negativo sin que nada
-- lo dijera. Mientras una petición espera respuesta, esos días están
-- comprometidos, así que se descuentan; si se rechaza o se cancela, vuelven.
--
-- Y UNA TERCERA: LOS DÍAS SE CUENTAN DE LUNES A VIERNES. Del viernes al lunes
-- son dos días de vacaciones, no cuatro. El cálculo vive en
-- lib/types/vacations.ts —aquí solo se guarda el resultado en working_days—
-- porque es la misma cuenta que tiene que hacer la pantalla mientras la
-- persona arrastra el ratón por el calendario, antes de que exista fila.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- Sin la 111 no hay public.employees a la que añadir la columna ni a la que
-- apuntar la clave ajena. Se corta con EXCEPCIÓN y no con un aviso porque el
-- editor SQL de Supabase corre el script entero en una transacción: reventar
-- aquí deja la base intacta en vez de a medias, con una tabla de peticiones
-- huérfana que nadie sabría de dónde salió.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) THEN
    RAISE EXCEPTION
      'No existe public.employees. Lanza antes 111_employees.sql (y 112, 113, 115, 117).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella las políticas RLS de abajo dejarían la tabla abierta a cualquiera.';
  END IF;
END $$;

-- ---------- Cuántos días genera cada persona al mes ----------
-- NUMERIC y no INTEGER: 1,83 no es un número redondo, y redondearlo a 2
-- costaría dos días de vacaciones al año a cada una.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS vacation_days_per_month NUMERIC;

COMMENT ON COLUMN public.employees.vacation_days_per_month IS
  'Días de vacaciones que genera por cada mes completo trabajado. NULL = esta persona no genera vacaciones (distinto de 0, que sería generar cero). Se edita desde la ficha: añadir a alguien al módulo NO debe requerir tocar código.';

-- ADD CONSTRAINT no admite IF NOT EXISTS, así que la guardia es explícita.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_vacation_rate_ok'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_vacation_rate_ok
      CHECK (vacation_days_per_month IS NULL OR vacation_days_per_month >= 0);
  END IF;
END $$;

-- ---------- Quién genera vacaciones hoy ----------
-- Se busca por NOMBRE NORMALIZADO (lower + btrim), que es la misma clave con
-- la que casan la 112, la 115 y la 117. Por id a pelo no: los UUID de
-- employees no se conocen al escribir la migración y uno copiado de otra base
-- apuntaría a la persona equivocada, o a nadie.
--
-- Solo se rellena si está a NULL: si alguien ya ajustó la tarifa a mano desde
-- la ficha, manda lo que hay en la base, no esta migración.
DO $$
DECLARE
  v_tocadas INT;
  v_faltan  TEXT;
BEGIN
  UPDATE public.employees
  SET vacation_days_per_month = 1.83
  WHERE lower(btrim(name)) IN ('yasury', 'daniella')
    AND vacation_days_per_month IS NULL;

  GET DIAGNOSTICS v_tocadas = ROW_COUNT;
  RAISE NOTICE 'Vacaciones activadas en % ficha(s) a 1,83 días/mes.', v_tocadas;

  -- Si alguna de las dos no aparece, el módulo arranca sin la persona para la
  -- que se pidió y por pantalla no se ve: su saldo simplemente no existe. Se
  -- avisa por consola en vez de fallar, porque el resto de la migración sí
  -- vale y una ficha que se llame distinto se arregla en dos segundos desde
  -- la pantalla.
  SELECT string_agg(x.nombre, ', ')
  INTO v_faltan
  FROM (VALUES ('yasury'), ('daniella')) AS x(nombre)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE lower(btrim(e.name)) = x.nombre
  );

  IF v_faltan IS NOT NULL THEN
    RAISE NOTICE 'Sin ficha en employees (%): esas personas NO generan vacaciones hasta que se les ponga la tarifa desde su ficha.', v_faltan;
  END IF;
END $$;

-- ---------- Las peticiones ----------
CREATE TABLE IF NOT EXISTS public.vacation_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** CASCADE: borrar una ficha se lleva sus peticiones. No son contabilidad
      como los sueldos —no las paga nadie—, y dejarlas huérfanas apuntando a
      un employee_id que ya no existe solo produce filas que no se pueden
      pintar */
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  /** DATE puro, no TIMESTAMPTZ, y esto es importante: media plantilla está en
      Latinoamérica. «El 12 de agosto» guardado como instante se lee como el
      11 en México y como el 12 en España, y el día de vacaciones se
      desplazaría según quién mire la pantalla. Un día natural no tiene hora */
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  /** Días LABORABLES que consume (lunes a viernes), congelados al pedirla.
      Se guardan en vez de recalcularse siempre porque son lo que se descontó
      del saldo el día que se aprobó: si mañana se añade un calendario de
      festivos, el pasado no puede cambiar de valor solo.
      NUMERIC y no INTEGER para dejar sitio a los medios días del futuro */
  working_days NUMERIC NOT NULL CHECK (working_days >= 0),
  /** pendiente -> aprobada | rechazada, y cancelada cuando la retira quien la
      pidió antes de que se resuelva */
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  /** Por qué las pide. Opcional: obligar a justificar unas vacaciones sobra */
  reason TEXT,
  /** Quién tecleó la petición. NO es lo mismo que de quién son las vacaciones:
      Yasury y Daniella pueden no tener cuenta en el ERP, así que un admin las
      registra POR ELLAS y tiene que quedar dicho quién lo hizo.
      SET NULL: si esa persona se va del ERP, la petición se queda */
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** Quién la aprobó o rechazó, y cuándo */
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  /** El motivo del rechazo. Existe para que «me lo denegaron y no sé por qué»
      no pueda pasar */
  rejection_reason TEXT,
  /** Quién la retiró y cuándo. Columnas PROPIAS y no reutilizar
      resolved_by/resolved_at: anular unas vacaciones YA APROBADAS pisando esos
      dos campos borra quién las había concedido y cuándo, que es justo el
      «quede constancia» por el que existe este módulo. Si Mario las aprueba el
      10 de agosto y Raúl las anula el 2 de septiembre, tienen que verse las
      dos firmas, no la última */
  cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  /** Se pidió con menos de 30 días de antelación.
      NO bloquea: se guarda igual y se marca, bien visible para quien aprueba.
      La regla existe para poder planificar, no para que alguien con una
      urgencia familiar no pueda ni pedirlo; y como las aprueba un admin una a
      una, la decisión ya pasa por una persona. Bloquear el envío solo
      conseguiría que se pidiera por WhatsApp y no quedara registrado.

      Se CONGELA al crear la petición, no se recalcula al leerla: «fuera de
      plazo» es un hecho sobre el momento en que se pidió. Recalculándolo,
      cualquier petición vieja y aprobada aparecería como fuera de plazo en
      cuanto su fecha de inicio quedara atrás */
  late_notice BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT vacation_requests_dates_ok CHECK (end_date >= start_date),
  /** Una petición que ya no está pendiente tiene que decir cuándo dejó de
      estarlo. Sin esto, un UPDATE que solo tocara `status` dejaría
      aprobaciones anónimas y sin fecha, que es justo lo que este módulo viene
      a evitar.
      `cancelled_at` cuenta igual que `resolved_at` porque una petición que se
      retira estando PENDIENTE nunca llega a resolverse: no la aprobó ni la
      rechazó nadie, y aun así tiene fecha y firma */
  CONSTRAINT vacation_requests_resuelta_ok
    CHECK (status = 'pendiente' OR resolved_at IS NOT NULL OR cancelled_at IS NOT NULL),
  /** Y un rechazo tiene que decir por qué */
  CONSTRAINT vacation_requests_rechazo_motivado
    CHECK (status <> 'rechazada' OR btrim(COALESCE(rejection_reason, '')) <> '')
);

-- Las dos columnas de la anulación y el CHECK relajado, para una base en la
-- que esta migración ya se hubiera lanzado antes de que existieran: el
-- CREATE TABLE de arriba lleva IF NOT EXISTS y ahí no entra ninguna de las dos
-- cosas.
ALTER TABLE public.vacation_requests
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.vacation_requests
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.vacation_requests
  DROP CONSTRAINT IF EXISTS vacation_requests_resuelta_ok;
ALTER TABLE public.vacation_requests
  ADD CONSTRAINT vacation_requests_resuelta_ok
  CHECK (status = 'pendiente' OR resolved_at IS NOT NULL OR cancelled_at IS NOT NULL);

-- La consulta real es «las peticiones de esta persona, las últimas primero».
CREATE INDEX IF NOT EXISTS idx_vacation_requests_employee
  ON public.vacation_requests(employee_id, start_date DESC);

-- Índice parcial para la cola de aprobación: son cuatro filas dentro de una
-- tabla que crecerá para siempre, y es la consulta que se lanza en cada carga
-- de la pantalla de Control empleados.
CREATE INDEX IF NOT EXISTS idx_vacation_requests_pendientes
  ON public.vacation_requests(start_date)
  WHERE status = 'pendiente';

-- Para el calendario: «qué hay entre estas dos fechas» de todo el equipo.
CREATE INDEX IF NOT EXISTS idx_vacation_requests_rango
  ON public.vacation_requests(start_date, end_date)
  WHERE status IN ('pendiente', 'aprobada');

-- ---------- Que no se pisen dos peticiones de la misma persona ----------
-- Dos peticiones de la misma persona sobre los mismos días son un error se
-- avise o no: descuentan el doble del saldo y en el calendario se pintan una
-- encima de otra. La aplicación ya lo comprueba al crear Y al aprobar (entre
-- una cosa y la otra puede colarse otra petición), pero entre esas dos
-- comprobaciones y la escritura hay una carrera que solo la base puede cerrar.
--
-- Va dentro de una guarda con manejador de excepciones porque depende de la
-- extensión btree_gist (el `employee_id WITH =` de un EXCLUDE necesita un
-- operador gist para UUID). Si la base no deja crearla, el módulo funciona
-- igual con las comprobaciones de la aplicación: preferible eso a que la
-- migración entera se caiga por una extensión.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vacation_requests_sin_solape'
  ) THEN
    ALTER TABLE public.vacation_requests
      ADD CONSTRAINT vacation_requests_sin_solape
      EXCLUDE USING gist (
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      )
      -- Solo entre las que están vivas: una rechazada o cancelada no reserva
      -- ningún día, así que puede solaparse con la que la sustituye.
      WHERE (status IN ('pendiente', 'aprobada'));
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'No se ha podido crear la restricción de solapes (%). El módulo funciona: los solapes se siguen detectando al crear y al aprobar desde la aplicación.',
      SQLERRM;
END $$;

-- ---------- updated_at ----------
-- Función propia y no la de empleados: que el módulo de vacaciones no dependa
-- de que nadie renombre la de la 111.
CREATE OR REPLACE FUNCTION public.update_vacations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vacation_requests_updated ON public.vacation_requests;
CREATE TRIGGER trg_vacation_requests_updated
  BEFORE UPDATE ON public.vacation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_vacations_updated_at();

-- ---------- «¿Esta ficha es la mía?» ----------
-- SECURITY DEFINER, y aquí no es una preferencia de estilo: es la diferencia
-- entre que el módulo funcione y que devuelva cero filas en silencio.
--
-- public.employees tiene RLS de SOLO ADMIN (migración 111: son los sueldos de
-- todo el equipo). Una política escrita como
--
--   EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_id AND e.user_id = auth.uid())
--
-- se evalúa con los permisos de quien consulta, así que a una empleada esa
-- subconsulta le devuelve SIEMPRE falso —no porque la ficha no sea suya, sino
-- porque no puede ver la tabla— y no vería ni una sola de sus peticiones. Sin
-- error, sin aviso: la pantalla en blanco. Es el fallo silencioso más
-- probable de toda esta migración.
--
-- STABLE para que el planificador la evalúe una vez por consulta y no una vez
-- por fila.
--
-- Y NO abre nada de más: contesta sí o no a «¿esta ficha concreta es de este
-- usuario?». No devuelve el sueldo de nadie.
CREATE OR REPLACE FUNCTION public.owns_employee(p_employee_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.user_id IS NOT NULL
      AND e.user_id = uid
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---------- RLS ----------
-- LA TABLA SE LEE DESDE EL NAVEGADOR; ESCRIBIRLA, NO. Toda escritura pasa por
-- las rutas de app/api/vacations/**, que van con service_role después de haber
-- comprobado el rol contra la sesión.
--
-- Lo que hay que impedir por encima de todo: QUE ALGUIEN SE APRUEBE SUS
-- PROPIAS VACACIONES. Si eso se puede, todo lo demás sobra. El navegador
-- habla con PostgREST directamente y con la clave anónima, así que una
-- comprobación que solo esté en la interfaz —o solo en la ruta de API— se
-- salta con una llamada a mano. El guardia de verdad está aquí abajo.
ALTER TABLE public.vacation_requests ENABLE ROW LEVEL SECURITY;

-- 1) El admin, todo lo que le deje el GRANT (ver el punto 3: en la práctica,
--    leer). Es quien aprueba, quien rechaza y quien registra peticiones en
--    nombre de quien no tiene cuenta en el ERP, pero eso lo hace por las rutas
--    de API, no contra la tabla.
DROP POLICY IF EXISTS "Admins manage vacation requests" ON public.vacation_requests;
CREATE POLICY "Admins manage vacation requests"
  ON public.vacation_requests FOR ALL TO authenticated
  USING (public.is_erp_admin(auth.uid()))
  WITH CHECK (public.is_erp_admin(auth.uid()));

-- 2) Cada uno ve las suyas. Solo las suyas: cuándo se va de vacaciones un
--    compañero no es asunto de nadie más que de quien organiza el trabajo.
DROP POLICY IF EXISTS "Own vacation requests can view" ON public.vacation_requests;
CREATE POLICY "Own vacation requests can view"
  ON public.vacation_requests FOR SELECT TO authenticated
  USING (public.owns_employee(employee_id, auth.uid()));

-- 3) DESDE EL NAVEGADOR NO SE ESCRIBE. NI PARA PEDIR LAS PROPIAS.
--
--    Aquí hubo dos políticas más —«cada uno inserta las suyas» y «cada uno
--    retira las suyas»— y estaban rotas de una forma que no se ve leyéndolas:
--    comprobaban DE QUIÉN es la fila y EN QUÉ ESTADO nace, pero no decían nada
--    de `working_days`, `late_notice`, `start_date`, `end_date` ni
--    `created_by`. Y Supabase le da a `authenticated` INSERT y UPDATE sobre
--    TODAS las columnas por defecto, así que esas cuatro cosas las dictaba
--    quien pedía las vacaciones. Desde la consola del navegador:
--
--      INSERT INTO vacation_requests
--        (employee_id, start_date, end_date, working_days, status, late_notice, created_by)
--      VALUES ('<mi ficha>','2026-08-09','2026-12-31', 0.1, 'pendiente', false, '<uid de un admin>');
--
--    Son 104 días laborables de verdad. La cola del admin pintaría «0,1
--    laborables», escondería el aviso de FUERA DE PLAZO —depende de
--    `late_notice`, que la fila trae a false— y firmaría la petición como
--    «Registrada por» otra persona. Cinco meses de vacaciones aprobados
--    gastando una décima de día, y el rastro de autoría falsificado.
--
--    El fallo de fondo: esos campos son DERIVADOS —salen de las fechas y del
--    reloj del servidor— y quien escribe no puede ser quien los dicte. La
--    política podría reescribirse para forzarlos, pero eso significaría
--    repetir en SQL la cuenta de lunes a viernes que ya vive en
--    lib/types/vacations.ts, y dos copias de esa cuenta acaban discrepando.
--
--    Así que se cierra la puerta entera: NADA del navegador escribe en esta
--    tabla. Comprobado a mano —las únicas referencias vivas son
--    lib/vacations/api.ts, lib/employees/vacations.ts y las cuatro rutas de
--    app/api/vacations/**, todas con service_role, que se salta RLS—, así que
--    el permiso de escritura no lo estaba usando nadie: era superficie de
--    ataque con cero uso legítimo.
--
--    Dos candados, y en el mismo sentido:
--      a) sin GRANT: `authenticated` y `anon` no pueden ni intentarlo.
--      b) sin política permisiva de INSERT/UPDATE/DELETE para quien no es
--         admin: si alguien restaurara el GRANT algún día (un
--         `GRANT ALL ON ALL TABLES IN SCHEMA public` de los que se escriben
--         sin pensar), RLS seguiría diciendo que no.
--
--    TRUNCATE va en la lista y no es por gusto: entra en el `GRANT ALL` de
--    Supabase igual que los otros tres, y RLS NO SE APLICA A TRUNCATE —
--    comprobado: como `authenticated`, `TRUNCATE public.vacation_requests`
--    deja la tabla a cero sin que ninguna política diga nada—. Hoy no se
--    alcanza desde el navegador porque PostgREST no lo expone, pero es una
--    palabra y quita de en medio «borrar las vacaciones de toda la empresa».
--
--    Se deja el SELECT y su política: la pantalla de cada uno se sirve desde
--    el servidor, pero la publicación de realtime necesita poder leer.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vacation_requests FROM authenticated, anon;

--    Y se retiran las dos políticas de escritura por si esta migración ya se
--    lanzó con ellas puestas: un DROP no basta con no volver a crearlas.
DROP POLICY IF EXISTS "Own vacation requests can insert" ON public.vacation_requests;
DROP POLICY IF EXISTS "Own pending vacation requests can update" ON public.vacation_requests;

-- 4) BORRAR no lo hace nadie desde el navegador, tampoco un admin. Una
--    petición rechazada es el registro de que se pidió y se dijo que no; si
--    quien la pidió pudiera borrarla, el histórico serviría de poco. Para
--    retirarla ya está 'cancelada', que deja rastro.

-- Realtime. Con guardia: añadir una tabla que ya está en la publicación da
-- error, y como el editor SQL de Supabase corre el script entero en una
-- transacción, ese error de la última línea desharía el CREATE TABLE de
-- arriba. La migración parecería aplicada sin haber creado nada.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vacation_requests'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------- Permiso de la app ----------
-- Al contrario que 'empleados', que se retira a todo el que no sea admin
-- porque enseña sueldos, la pantalla de vacaciones (/dashboard/vacaciones) es
-- justo para el equipo: cada uno ve SU calendario y SU saldo, y ni un solo
-- dato salarial. Por eso el permiso se da a admins y a employees.
--
-- El id 'vacaciones' tiene que coincidir letra por letra en tres sitios:
-- aquí, en lib/config/apps.ts y en el mapa de middleware.ts. Si baila en uno
-- de los tres, el módulo queda invisible sin dar ningún error.
--
-- Guarda doble por si la base todavía no tiene esas tablas: un INSERT contra
-- una tabla inexistente tumbaría la transacción y con ella todo lo de arriba.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_app_permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN

    INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
    SELECT p.id, 'vacaciones', true
    FROM public.profiles p
    WHERE p.role IN ('admin', 'employee')
    ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

  END IF;
END $$;
