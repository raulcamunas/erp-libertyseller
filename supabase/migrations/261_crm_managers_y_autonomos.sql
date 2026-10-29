-- ============================================================================
-- 261 · CRM DE CLIENTES: LOS MANAGERS MUEVEN LOS CLIENTES Y EL COMERCIAL AUTÓNOMO VE Y TRABAJA SOLO LOS SUYOS
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada. No borra ni reescribe ningún cliente, ninguna interacción ni ninguna nota.
-- Hace falta haber lanzado antes la 080 (CRM), la 153, la 212 (supervisor comercial), la 257 (puestos) y la 258 (historial de fases y notas de reunión).
-- EL CÓDIGO FUNCIONA SIN ESTA MIGRACIÓN: la pantalla nueva se ve igual, pero un manager seguirá sin poder guardar cambios y un comercial autónomo no tendrá clientes que ver.
--
--
-- ============ QUÉ SE PIDIÓ ============
--
--   1. Los MANAGERS (quien tiene el permiso suelto `equipo-comercial`) ven todos los clientes y los MUEVEN: pasarlos de fase, descartarlos, cerrarlos, apuntar la próxima acción,
--      las notas y las respuestas del guion. Hasta hoy solo leían (212: «cambiarlos es cerrar un presupuesto, y eso es dirección»). Los IMPORTES (set up y mantenimiento), el
--      responsable y el % variable siguen siendo solo de dirección.
--   2. Un puesto nuevo, el COMERCIAL AUTÓNOMO: ve SOLO LOS CLIENTES QUE LLEVA ÉL (`crm_clients.owner_id` = él) y los trabaja igual que un manager, y además da de alta los suyos.
--      Tampoco toca importes. Se le da con un permiso suelto nuevo, `crm-propios`, que marca solo el puesto.
--
--
-- ============ CÓMO ESTÁ HECHO Y POR QUÉ ASÍ ============
--
-- A) LA PANTALLA NO ES EL FILTRO: ES LA RLS. El navegador escribe y lee crm_* directo con supabase-js (no hay rutas /api), así que lo que no esté escrito aquí no está escrito
--    en ningún sitio. lib/crm/acceso.ts dice lo mismo que esto, y si dejan de coincidir el síntoma no es un error sino una pantalla vacía o un «No se pudo guardar».
--
-- B) UNA POLÍTICA NO PUEDE DECIR «ESTE CAMPO NO SE PUEDE CAMBIAR»: el WITH CHECK de un UPDATE solo ve la fila nueva. Por eso, igual que con `cold_leads.assigned_to` en la 212, lo
--    que no se puede tocar (importes, responsable, la cita de origen, el % variable de la propuesta y la fecha de cierre a mano) lo impide un TRIGGER que mira OLD y NEW.
--    Dirección y el servidor (auth.uid() vacío, la clave de servicio) pasan sin tocar: es el camino de las migraciones, de la sincronización de Gemini y de los avisos.
--
-- C) EL AUTÓNOMO SOLO VE LO SUYO TAMBIÉN EN LAS CITAS. `appointments` es legible por todo el equipo («Team can view all appointments», 071): con eso, un autónomo leería los datos
--    de contacto de TODAS las citas de la agencia desde la consola del navegador, que es justo lo que se le quiere negar. Se sustituye por la misma regla con una excepción:
--    quien tiene `crm-propios` y NO supervisa al equipo solo lee las citas en las que es el comercial o el closer. Para todos los demás (sin `crm-propios`) la regla es
--    exactamente la de antes: ven todas.
--
-- D) LO QUE NO SE ABRE: los PDFs de propuestas y contratos (crm_documents y su bucket público), la bandeja de notas de Gemini sin cliente, el coste del equipo y el cambio de
--    responsable de un cliente siguen siendo de dirección. Un autónomo tampoco ve los importes en pantalla (la base se los deja leer en su propia ficha, porque son cifras de
--    SU cliente, pero la pantalla no se los enseña).
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 0) REQUISITOS: se avisa con el nombre del fichero, no con un error  */
/* ------------------------------------------------------------------ */

DO $$
BEGIN
  IF to_regclass('public.crm_clients') IS NULL OR to_regclass('public.crm_interactions') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas del CRM: hay que lanzar antes la migración 080_crm_clients.sql.';
  END IF;
  IF to_regprocedure('public.puede_ver_equipo_comercial(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 212_supervisor_comercial.sql (el permiso equipo-comercial).';
  END IF;
  IF to_regclass('public.crm_etapas_historial') IS NULL OR to_regclass('public.crm_notas_reunion') IS NULL THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 258_crm_hub_fases_y_notas_de_reunion.sql (historial de fases y notas de reunión).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'puesto') THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 257_listas_de_leads_y_puestos.sql (la columna profiles.puesto).';
  END IF;
END $$;


/* ------------------------------------------------------------------ */
/* 1) EL PUESTO NUEVO                                                  */
/* ------------------------------------------------------------------ */

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_puesto_check') THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_puesto_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_puesto_check
    CHECK (puesto IS NULL OR puesto IN ('comercial', 'manager_comercial', 'comercial_autonomo', 'gestion_administrativa'));
END $$;

COMMENT ON COLUMN public.profiles.puesto IS
  'El puesto de la persona en el equipo: comercial, manager_comercial, comercial_autonomo o gestion_administrativa (NULL = sin puesto). Solo sirve para nombrar a cada uno y para pre-marcar casillas al crear o editar; lo que da acceso sigue siendo `role` y user_app_permissions. NO es un rol nuevo: mucho código compara role = employee.';


/* ------------------------------------------------------------------ */
/* 2) LAS FUNCIONES: quién es quién para las políticas                 */
/* ------------------------------------------------------------------ */

-- ¿Tiene el permiso suelto `crm-propios` (y es un empleado)? El id va LETRA POR LETRA igual que PERMISO_CRM_PROPIOS en lib/config/apps.ts. SECURITY DEFINER y STABLE como
-- puede_ver_equipo_comercial (212): lee user_app_permissions y profiles sin depender de lo que la persona pueda leer, y en una consulta el resultado no cambia.
CREATE OR REPLACE FUNCTION public.puede_ver_crm_propio(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.role = 'employee')
    AND EXISTS (
      SELECT 1 FROM public.user_app_permissions up
       WHERE up.user_id = uid
         AND up.app_id = 'crm-propios'
         AND up.can_access = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.puede_ver_crm_propio(UUID) IS
  'Un empleado con el permiso suelto crm-propios (comercial autonomo): ve y trabaja en el CRM solo los clientes que lleva el, y nada mas. Lo usan las politicas de crm_* y de appointments (migracion 261).';

-- ¿Es solo-propios? Tiene crm-propios y NO supervisa al equipo (ni es dirección): a quien sí supervisa, ver los suyos le sale de ver todos.
CREATE OR REPLACE FUNCTION public.es_solo_crm_propio(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT public.puede_ver_crm_propio(uid) AND NOT public.puede_ver_equipo_comercial(uid);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.es_solo_crm_propio(UUID) IS
  'Tiene crm-propios y no supervisa al equipo comercial ni es admin o partner. Es a quien se le recortan las citas a las suyas (migracion 261).';

-- ¿Es un cliente del CRM de quien pregunta (él es el responsable)? SECURITY DEFINER para que las políticas de las tablas hijas (interacciones, historial, notas) no dependan de
-- que la persona pueda leer crm_clients por otra vía, ni recursen.
CREATE OR REPLACE FUNCTION public.es_cliente_crm_mio(cid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM public.crm_clients c WHERE c.id = cid AND c.owner_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- Puede trabajar el cliente `cid` como autónomo: tiene el permiso Y el cliente es suyo
CREATE OR REPLACE FUNCTION public.puede_trabajar_cliente_crm(cid UUID)
RETURNS BOOLEAN AS $$
  SELECT public.puede_ver_crm_propio(auth.uid()) AND public.es_cliente_crm_mio(cid);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.puede_trabajar_cliente_crm(UUID) IS
  'Comercial autonomo con crm-propios y cliente cuyo responsable (owner_id) es el. Lo usan las politicas de crm_interactions, crm_etapas_historial y crm_notas_reunion (migracion 261).';


/* ------------------------------------------------------------------ */
/* 3) crm_clients: lo que se puede hacer y lo que no                   */
/* ------------------------------------------------------------------ */

-- MANAGER: mover los clientes (UPDATE). El SELECT lo tiene desde la 212; INSERT y DELETE siguen siendo de dirección.
DROP POLICY IF EXISTS "Supervisor comercial mueve el crm" ON public.crm_clients;
CREATE POLICY "Supervisor comercial mueve el crm"
  ON public.crm_clients FOR UPDATE
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()))
  WITH CHECK (public.puede_ver_equipo_comercial(auth.uid()));

-- AUTÓNOMO: ver los suyos, darlos de alta (solo a su nombre) y moverlos. El WITH CHECK exige que el responsable siga siendo él: no puede regalar un cliente ni dejarlo sin dueño.
DROP POLICY IF EXISTS "Comercial autonomo ve sus clientes del crm" ON public.crm_clients;
CREATE POLICY "Comercial autonomo ve sus clientes del crm"
  ON public.crm_clients FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid() AND public.puede_ver_crm_propio(auth.uid()));

DROP POLICY IF EXISTS "Comercial autonomo da de alta clientes suyos" ON public.crm_clients;
CREATE POLICY "Comercial autonomo da de alta clientes suyos"
  ON public.crm_clients FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.puede_ver_crm_propio(auth.uid()));

DROP POLICY IF EXISTS "Comercial autonomo mueve sus clientes" ON public.crm_clients;
CREATE POLICY "Comercial autonomo mueve sus clientes"
  ON public.crm_clients FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid() AND public.puede_ver_crm_propio(auth.uid()))
  WITH CHECK (owner_id = auth.uid() AND public.puede_ver_crm_propio(auth.uid()));

-- EL TRIGGER (ver B): lo que ni un manager ni un autónomo pueden tocar. Con auth.uid() vacío (la clave de servicio) y para dirección, nada se mira.
--   · setup_budget y maintenance_budget: es cerrar un presupuesto.
--   · owner_id y appointment_id: a quién pertenece el cliente y de qué cita nace.
--   · el % variable del plan de propuesta (propuesta_plan -> 'variable_pct'): también es dinero. El resto del plan sí se puede escribir.
--   · closed_at A MANO: lo sella solo el disparador de la 082 al pasar a «ganado»; cambiarlo sin mover de fase movería a otro mes lo que se factura. Si cambia a la vez que
--     la fase, es ese disparador y se deja pasar.
-- En el INSERT de un autónomo, igual: un cliente nuevo no puede nacer con importes.
CREATE OR REPLACE FUNCTION public.crm_clients_protege_importes()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_or_partner(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.setup_budget IS NOT NULL OR NEW.maintenance_budget IS NOT NULL THEN
      RAISE EXCEPTION 'Los importes de un cliente (set up y mantenimiento) solo los pone direccion' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.setup_budget IS DISTINCT FROM OLD.setup_budget
     OR NEW.maintenance_budget IS DISTINCT FROM OLD.maintenance_budget
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
     OR (NEW.propuesta_plan -> 'variable_pct') IS DISTINCT FROM (OLD.propuesta_plan -> 'variable_pct')
     OR (NEW.closed_at IS DISTINCT FROM OLD.closed_at AND NEW.stage IS NOT DISTINCT FROM OLD.stage) THEN
    RAISE EXCEPTION 'Los importes, el responsable, el %% variable y la fecha de cierre de un cliente solo los cambia direccion' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.crm_clients_protege_importes() IS
  'Un manager o un comercial autonomo mueven la ficha pero no tocan importes, responsable, cita de origen, % variable ni la fecha de cierre a mano (migracion 261). Direccion y el servidor pasan sin mirar.';

DROP TRIGGER IF EXISTS trg_crm_protege_importes ON public.crm_clients;
CREATE TRIGGER trg_crm_protege_importes
  BEFORE INSERT OR UPDATE ON public.crm_clients
  FOR EACH ROW EXECUTE FUNCTION public.crm_clients_protege_importes();


/* ------------------------------------------------------------------ */
/* 4) Las tablas hijas, para el autónomo                               */
/* ------------------------------------------------------------------ */

-- Tomas de contacto: ver las de sus clientes, apuntar y corregir las que ha apuntado él. Borrar sigue siendo de dirección. (Los managers ya tienen las suyas desde la 212.)
DROP POLICY IF EXISTS "Comercial autonomo ve las interacciones de sus clientes" ON public.crm_interactions;
CREATE POLICY "Comercial autonomo ve las interacciones de sus clientes"
  ON public.crm_interactions FOR SELECT
  TO authenticated
  USING (public.puede_trabajar_cliente_crm(client_id));

DROP POLICY IF EXISTS "Comercial autonomo apunta interacciones de sus clientes" ON public.crm_interactions;
CREATE POLICY "Comercial autonomo apunta interacciones de sus clientes"
  ON public.crm_interactions FOR INSERT
  TO authenticated
  WITH CHECK (public.puede_trabajar_cliente_crm(client_id) AND (author_id IS NULL OR author_id = auth.uid()));

DROP POLICY IF EXISTS "Comercial autonomo corrige sus interacciones" ON public.crm_interactions;
CREATE POLICY "Comercial autonomo corrige sus interacciones"
  ON public.crm_interactions FOR UPDATE
  TO authenticated
  USING (public.puede_trabajar_cliente_crm(client_id) AND author_id = auth.uid())
  WITH CHECK (public.puede_trabajar_cliente_crm(client_id) AND author_id = auth.uid());

-- Historial de fases y notas de las reuniones (solo lectura): las de sus clientes
DROP POLICY IF EXISTS "Comercial autonomo ve el historial de fases de sus clientes" ON public.crm_etapas_historial;
CREATE POLICY "Comercial autonomo ve el historial de fases de sus clientes"
  ON public.crm_etapas_historial FOR SELECT
  TO authenticated
  USING (public.puede_trabajar_cliente_crm(client_id));

DROP POLICY IF EXISTS "Comercial autonomo ve las notas de reunion de sus clientes" ON public.crm_notas_reunion;
CREATE POLICY "Comercial autonomo ve las notas de reunion de sus clientes"
  ON public.crm_notas_reunion FOR SELECT
  TO authenticated
  USING (public.puede_trabajar_cliente_crm(client_id));


/* ------------------------------------------------------------------ */
/* 5) appointments: el autónomo solo lee las citas suyas (ver C)       */
/* ------------------------------------------------------------------ */

-- Misma política de la 071 con UNA excepción. Para todo el que NO es «solo crm-propios» la condición es verdadera y se ve todo, igual que antes. Las subconsultas con SELECT
-- hacen que Postgres evalúe la función UNA vez por consulta y no una por fila.
DROP POLICY IF EXISTS "Team can view all appointments" ON public.appointments;
CREATE POLICY "Team can view all appointments"
  ON public.appointments FOR SELECT
  TO authenticated
  USING (
    (SELECT NOT public.es_solo_crm_propio((SELECT auth.uid())))
    OR comercial_id = (SELECT auth.uid())
    OR assigned_closer_id = (SELECT auth.uid())
  );


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE (el editor de Supabase no enseña los NOTICE)
-- ============================================================================
-- Tiene que salir UNA fila con todo en `true`.
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_puesto_check' AND pg_get_constraintdef(oid) LIKE '%comercial_autonomo%') AS puesto_nuevo,
  to_regprocedure('public.puede_ver_crm_propio(uuid)') IS NOT NULL                                                                                                        AS funcion_crm_propio,
  to_regprocedure('public.puede_trabajar_cliente_crm(uuid)') IS NOT NULL                                                                                                  AS funcion_cliente_mio,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_protege_importes' AND NOT tgisinternal)                                                                        AS disparador_de_importes,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'crm_clients' AND policyname IN ('Supervisor comercial mueve el crm', 'Comercial autonomo ve sus clientes del crm', 'Comercial autonomo da de alta clientes suyos', 'Comercial autonomo mueve sus clientes')) = 4 AS politicas_de_crm_clients,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('crm_interactions', 'crm_etapas_historial', 'crm_notas_reunion') AND policyname LIKE 'Comercial autonomo%') = 5 AS politicas_de_las_hijas,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'Team can view all appointments' AND qual LIKE '%es_solo_crm_propio%')       AS citas_recortadas_al_autonomo;
