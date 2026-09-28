-- ============================================================================
-- 212 · SUPERVISAR AL EQUIPO COMERCIAL SIN VER LO QUE COBRA NADIE
-- ============================================================================
--
-- Alejandro pasa a ser manager de captación y tiene que supervisar al equipo:
-- las llamadas de todos, la agenda de todos y las horas que ficha cada uno.
--
--
-- ============ POR QUÉ NO SE LE DA EL ROL 'partner' ============
--
-- Porque en Cold Calling «el que cuenta como admin» es hoy is_admin_or_partner()
-- y ese mismo corte —`role IN ('admin','partner')`— es el que abre, uno por uno:
--
--   · Tesorería            (app/dashboard/tesoreria/page.tsx)
--   · Facturación          (app/dashboard/facturacion/page.tsx)
--   · Liquidación de comisiones (app/dashboard/commissions/liquidacion/page.tsx)
--   · Teléfonos            (app/dashboard/telefonos/page.tsx)
--   · El coste mensual de cada empleado (app/api/employees/monthly-cost)
--   · Amazon / Growth Partner (lib/amazon/api.ts)
--   · Las tres rutas de Google Calendar (/api/appointments/resync, google-watch,
--     google-status)
--
-- Y además is_admin_or_partner() gobierna las RLS de crm_clients, payroll_rates
-- y media docena más de tablas. O sea: darle 'partner' a quien tiene que
-- supervisar llamadas le entrega los MÁRGENES DE LA AGENCIA y las NÓMINAS de
-- todo el equipo, incluida la de la gente a la que supervisa. Eso no es lo que
-- se ha pedido y no hay forma de recortarlo después: el rol es uno y arrastra
-- todo lo que cuelga de él.
--
-- El corte correcto es el PERMISO SUELTO, el patrón de la 189: una fila en
-- user_app_permissions con un app_id propio, que se da y se quita persona a
-- persona desde la pantalla de Usuarios.
--
--
-- ============ QUÉ ABRE EXACTAMENTE ESTE PERMISO ============
--
--   SÍ  · cold_leads       · leer y trabajar la cartera de CUALQUIER comercial:
--                            estado, fecha de rellamada, nota, vende_en_amazon.
--   SÍ  · cold_lead_notes  · leer el historial de llamadas de esos leads. Sin
--                            esto la ficha de un lead ajeno se abre con el
--                            historial VACÍO y sin dar ningún error, que es
--                            justo lo que el comercial lee antes de llamar.
--   SÍ  · work_hours       · VER las horas fichadas del equipo. Solo SELECT.
--   SÍ  · crm_clients,     · VER el CRM de la agenda de todos, y apuntar en
--         crm_interactions   crm_interactions lo que se ha hablado. Editar el
--                            cliente (etapa, presupuesto, importe) sigue siendo
--                            de dirección.
--
--   NO  · crm_documents. El bucket 'crm-documents' es PÚBLICO desde la 080, o
--         sea que la URL que guarda esa tabla abre el fichero sin pedir nada:
--         conceder la tabla es entregar los contratos de los clientes. Fuera.
--   NO  · reasignar leads. Cambiar el dueño de un lead sigue siendo de
--         dirección, y NO basta con que la pantalla no tenga el control: el
--         board escribe directo contra Supabase desde el navegador, sin pasar
--         por ninguna ruta /api. El WITH CHECK de una política no puede
--         comparar con OLD, así que lo cumple un TRIGGER (más abajo).
--   NO  · apuntar ni corregir horas de otro (INSERT/UPDATE/DELETE de
--         work_hours no se tocan).
--   NO  · payroll_rates. Ya era legible por todo el equipo desde la 083 —cada
--         uno necesita saber a cuánto le pagan—, pero «Admins manage rates» no
--         se toca. Ojo: es por eso que la pantalla de Horas tiene que esconder
--         el panel de dinero cuando se mira a otra persona; eso se resuelve en
--         components/payroll/HoursTracker.tsx, no aquí.
--   NO  · appointments: no hacía falta abrir nada. «Team can view all
--         appointments» y la de profiles ya son USING (true) desde la 071, o
--         sea que la mitad de «la agenda de todos» estaba concedida ya. Mover o
--         borrar la cita de otro NO se ha pedido y se queda como está.
--   NO  · Tesorería, Facturación, Comisiones, costes de empleados, Amazon API.
--         Ni una línea. Este permiso no las roza.
--
--
-- ============ LAS POLÍTICAS PERMISIVAS SE SUMAN ============
--
-- Cada política de abajo se AÑADE a la que ya había; no sustituye a ninguna y
-- no le quita el acceso a NADIE. Un comercial sigue viendo sus leads por «Own
-- leads or admin can view», y admin y partner siguen entrando por
-- is_admin_or_partner(). Lo único que ocurre es que aparece un caso más: el de
-- quien tenga el permiso suelto.
--
-- Todo es idempotente (DROP POLICY IF EXISTS + CREATE, CREATE OR REPLACE): se
-- puede volver a lanzar entero sin romper nada.
--
--
-- ============ ESTA MIGRACIÓN NO SE LO CONCEDE A NADIE ============
--
-- Deliberadamente NO hay un INSERT en user_app_permissions. El permiso se da
-- marcando la casilla «Supervisión del equipo comercial» en Gestión de
-- Usuarios, que es donde Raúl tiene que poder QUITÁRSELO el día que haga falta
-- sin escribir otra migración. Aquí solo se construye la cerradura.
--
-- El id 'equipo-comercial' tiene que coincidir LETRA POR LETRA con
-- PERMISO_EQUIPO_COMERCIAL de lib/config/apps.ts y con la lectura de
-- user_app_permissions de lib/equipo-comercial/acceso.ts. Si baila en uno, la
-- casilla se marca, no da ningún error y no pasa nada: es el fallo que ya
-- ocurrió con 'stock-sync' y con 'growth'.
-- ============================================================================


-- ---------- La función de permiso ----------
-- Calcada de puede_borrar_mapeo (189): admin y partner siempre —son quienes
-- reparten los permisos, y dejarlos fuera por una fila que falte sería peor que
-- el problema que se tapa—, y el resto solo con la fila del permiso suelto.
--
-- SECURITY DEFINER porque tiene que leer profiles y user_app_permissions de
-- alguien que quizá no puede leerlas él; STABLE porque dentro de la misma
-- consulta el resultado no cambia y así el planificador la llama una vez en vez
-- de una por fila.
CREATE OR REPLACE FUNCTION public.puede_ver_equipo_comercial(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = uid AND p.role IN ('admin', 'partner')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_app_permissions up
      WHERE up.user_id = uid
        AND up.app_id = 'equipo-comercial'
        AND up.can_access = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.puede_ver_equipo_comercial(UUID) IS
  'Admin y partner siempre; el resto solo con el permiso suelto equipo-comercial, '
  'que es el que convierte a alguien en supervisor del equipo comercial. Abre la '
  'cartera de leads, el historial de llamadas, las horas fichadas y el CRM de '
  'todos los comerciales. NO abre Tesorería, Facturación, Comisiones, los costes '
  'de empleados ni Amazon API: para eso hace falta el rol, y por eso este permiso '
  'existe en vez de dar partner.';


-- ---------- cold_leads: ver y trabajar la cartera de todos ----------
-- SELECT. Sin esto no ve un solo lead ajeno: la consulta de la pantalla no
-- filtra por comercial, la recorta la RLS.
DROP POLICY IF EXISTS "Supervisor comercial ve todos los leads" ON public.cold_leads;
CREATE POLICY "Supervisor comercial ve todos los leads"
  ON public.cold_leads FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));

-- UPDATE: estado, fecha de rellamada, nota y vende_en_amazon en leads de
-- cualquiera. El WITH CHECK es el mismo predicado que el USING a propósito: lo
-- que NO se puede cambiar —el dueño— lo impide el trigger de abajo, porque una
-- política no puede mirar OLD.
DROP POLICY IF EXISTS "Supervisor comercial trabaja todos los leads" ON public.cold_leads;
CREATE POLICY "Supervisor comercial trabaja todos los leads"
  ON public.cold_leads FOR UPDATE
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()))
  WITH CHECK (public.puede_ver_equipo_comercial(auth.uid()));

-- INSERT («Admins manage leads») y DELETE («Admins delete leads») NO SE TOCAN:
-- crear leads a mano y borrarlos siguen siendo de dirección.


-- ---------- EL TRIGGER: reasignar leads sigue siendo de dirección ----------
--
-- QUÉ PROBLEMA RESUELVE, y es el agujero de verdad de todo este cambio:
--
-- La ficha del lead no tiene ningún control de `assigned_to` —se comprobó campo
-- por campo— y en todo el código de cliente no hay ni una escritura de esa
-- columna: las reasignaciones se han hecho siempre por migración (205, 206,
-- 207). Pero el board de Cold Calling escribe DIRECTO con supabase-js desde el
-- navegador, sin pasar por ninguna ruta /api, así que el único listón real es la
-- RLS. Y el WITH CHECK de una política de UPDATE solo ve la fila NUEVA: no
-- puede decir «este campo no se puede cambiar», solo «la fila resultante tiene
-- que cumplir X».
--
-- O sea: con la política de arriba y nada más, un
-- `.from('cold_leads').update({ assigned_to: otro })` escrito a mano en la
-- consola del navegador SÍ funcionaría. «Reasignar leads: NO» estaría escrito en
-- el encargo y no en el código.
--
-- POR QUÉ auth.uid() IS NULL PASA SIN MÁS, que no es un descuido: cuando esto se
-- ejecuta desde una migración o desde el editor SQL de Supabase no hay sesión de
-- navegador y auth.uid() es NULL. Sin esta salida, las migraciones de reparto
-- —que son la forma en que SE REASIGNAN los leads en este repo, ver 205 a 207—
-- reventarían todas a partir de hoy. El trigger está para el navegador, que es
-- de donde viene el riesgo.
CREATE OR REPLACE FUNCTION public.cold_leads_bloquea_reasignacion()
RETURNS TRIGGER AS $$
BEGIN
  -- Sin sesión de navegador (migración, editor SQL, service_role): pasa.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NOT public.is_admin_or_partner(auth.uid())
  THEN
    RAISE EXCEPTION
      'Cambiar el dueño de un lead es cosa de dirección. Puedes trabajar el lead '
      '(estado, rellamada, notas) pero no reasignarlo.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cold_leads_bloquea_reasignacion() IS
  'Impide que quien tiene el permiso equipo-comercial cambie cold_leads.assigned_to. '
  'Hace falta un trigger y no basta una política porque el WITH CHECK de una RLS no '
  'puede comparar con OLD, y el board escribe directo contra Supabase desde el '
  'navegador. auth.uid() NULL (migración o editor SQL) pasa: así es como se reparten '
  'los leads en este repo.';

DROP TRIGGER IF EXISTS trg_cold_leads_bloquea_reasignacion ON public.cold_leads;
CREATE TRIGGER trg_cold_leads_bloquea_reasignacion
  BEFORE UPDATE ON public.cold_leads
  FOR EACH ROW EXECUTE FUNCTION public.cold_leads_bloquea_reasignacion();


-- ---------- cold_lead_notes: el historial de llamadas ----------
-- ESTA ES LA QUE MÁS FÁCIL SE OLVIDA Y PEOR SÍNTOMA DA. Si se abre el lead
-- ajeno y no sus notas, la ficha se abre perfectamente y el historial sale sin
-- una sola llamada, sin error y sin nada que indique que falta un permiso. Es
-- además lo primero que se lee antes de marcar un número.
--
-- El INSERT («Team can add notes», WITH CHECK author_id = auth.uid()) NO se
-- toca: ya dejaba apuntar en cualquier lead.
DROP POLICY IF EXISTS "Supervisor comercial ve el historial de llamadas" ON public.cold_lead_notes;
CREATE POLICY "Supervisor comercial ve el historial de llamadas"
  ON public.cold_lead_notes FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));


-- ---------- work_hours: VER las horas del equipo, y solo ver ----------
-- Solo SELECT. El INSERT, UPDATE y DELETE de la 083 se quedan como están: el
-- encargo dice ver las horas fichadas del equipo, no apuntarlas ni corregirlas
-- por otro. Y payroll_rates no se toca (ya era USING (true) para todos).
DROP POLICY IF EXISTS "Supervisor comercial ve las horas del equipo" ON public.work_hours;
CREATE POLICY "Supervisor comercial ve las horas del equipo"
  ON public.work_hours FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));


-- ---------- El CRM de la agenda ----------
-- Las tres tablas eran FOR ALL con is_admin_or_partner (080), así que abrir solo
-- la pantalla la dejaría VACÍA. Se le da:
--
--   · SELECT en las tres          -> mirar el pipeline de todos los comerciales
--   · INSERT y UPDATE en          -> apuntar lo que se ha hablado, que es
--     crm_interactions               «trabajar el CRM»
--
-- Y NO se le da el UPDATE de crm_clients: ahí viven setup_budget y
-- maintenance_budget, o sea lo que paga cada cliente. Mirarlos entra en
-- «supervisar el CRM»; cambiarlos es cerrar un presupuesto, y eso es dirección.
-- Consecuencia práctica, para que no se diagnostique como un fallo: si intenta
-- mover una etapa o tocar un importe en la ficha del CRM, la pantalla le dará un
-- error de guardado. Es lo correcto, no un bug.
DROP POLICY IF EXISTS "Supervisor comercial ve el crm" ON public.crm_clients;
CREATE POLICY "Supervisor comercial ve el crm"
  ON public.crm_clients FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));

DROP POLICY IF EXISTS "Supervisor comercial ve las interacciones" ON public.crm_interactions;
CREATE POLICY "Supervisor comercial ve las interacciones"
  ON public.crm_interactions FOR SELECT
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()));

DROP POLICY IF EXISTS "Supervisor comercial apunta interacciones" ON public.crm_interactions;
CREATE POLICY "Supervisor comercial apunta interacciones"
  ON public.crm_interactions FOR INSERT
  TO authenticated
  WITH CHECK (public.puede_ver_equipo_comercial(auth.uid()));

DROP POLICY IF EXISTS "Supervisor comercial corrige interacciones" ON public.crm_interactions;
CREATE POLICY "Supervisor comercial corrige interacciones"
  ON public.crm_interactions FOR UPDATE
  TO authenticated
  USING (public.puede_ver_equipo_comercial(auth.uid()))
  WITH CHECK (public.puede_ver_equipo_comercial(auth.uid()));

-- ============ LOS DOCUMENTOS DEL CRM SE QUEDAN FUERA, Y NO ES UN OLVIDO ======
--
-- Aquí había una política de SELECT sobre `crm_documents`. Se ha quitado antes
-- de aplicar nada, al ver a dónde lleva:
--
-- `crm_documents` guarda `file_url`, y el bucket 'crm-documents' se creó en la
-- migración 080 con `public = true`. O sea que la URL que hay en esa columna
-- abre el fichero SIN PEDIR NADA: leer la tabla no es «ver una lista de
-- documentos», es tener los contratos y los presupuestos de los clientes.
--
-- Supervisar al equipo comercial no requiere eso. Y si algún día hace falta, lo
-- que hay que arreglar primero es el bucket —que hoy está abierto a cualquiera
-- con la URL, no solo a quien tenga esta política— y no añadir aquí una línea.
--
-- La pantalla del CRM no se rompe: los documentos salían ya de una consulta
-- propia que devuelve vacío sin dar error.


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Un reparto de leads se dio por
-- bueno esta semana porque el único rastro de que había fallado era un NOTICE
-- que nadie llegó a ver. Así que lo que hay que leer sale en filas.
--
-- ACABANDO DE APLICAR ESTO, la lista de abajo son SOLO admins y partners: esta
-- migración no le concede el permiso a nadie. Raúl marca la casilla
-- «Supervisión del equipo comercial» a Alejandro en Gestión de Usuarios y
-- VUELVE A LANZAR ESTE SELECT: si Alejandro no aparece con «por la casilla»,
-- el id 'equipo-comercial' no coincide entre apps.ts, la función y la pantalla.
SELECT
  COALESCE(p.full_name, p.email)          AS quien,
  p.role                                  AS rol,
  CASE
    WHEN p.role IN ('admin', 'partner')
      THEN 'por el rol — ya lo tenía, esta migración no le da nada nuevo'
    ELSE 'por la casilla «Supervisión del equipo comercial» de Usuarios'
  END                                     AS de_donde_le_viene,
  public.puede_ver_equipo_comercial(p.id) AS pasa_la_funcion
FROM public.profiles p
WHERE public.puede_ver_equipo_comercial(p.id)
ORDER BY (p.role IN ('admin', 'partner')) DESC, 1;
