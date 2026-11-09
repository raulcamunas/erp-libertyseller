-- ============================================================================
-- 289 · AGENDA: QUIEN TIENE LA CASILLA «AGENDA» VE TODAS LAS CITAS Y LOS HUECOS, AUNQUE SEA AUTÓNOMO
-- ============================================================================
--
-- La 261 recortó las citas del COMERCIAL AUTÓNOMO (permiso suelto `crm-propios`): solo lee las citas en las que es el comercial o el closer. Está pensado para quien
-- vende por su cuenta y no debe leer los datos de contacto de las citas de toda la agencia. Pero Naomi y Yarima (nov 2026) son autónomos que además LLAMAN y AGENDAN: tienen la
-- casilla «Agenda» y, con la regla de la 261, su calendario sale VACÍO: ni las citas de los demás ni los huecos de Google (`is_external`, sin comercial) ni lo que ocupa el
-- closer, así que ni siquiera saben qué horas están libres para agendar.
--
-- Esta migración añade UNA salida a esa regla: quien tiene la casilla «Agenda» ('agenda' en user_app_permissions) ve todas las citas, como cualquier comercial. Quien es autónomo
-- SIN la casilla «Agenda» sigue viendo solo las suyas. Nada más cambia: el resto de tablas del CRM siguen recortadas al autónomo (es_solo_crm_propio no se toca).
--
-- El id 'agenda' tiene que coincidir LETRA POR LETRA con el de la app en lib/config/apps.ts.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada. Para deshacerla basta con volver a lanzar el
-- bloque «Team can view all appointments» de la 261 (apartado 5).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.es_solo_crm_propio(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta public.es_solo_crm_propio(uuid): lanza antes la migración 261_crm_managers_y_autonomos.sql.';
  END IF;
END $$;

-- ¿Tiene la casilla «Agenda»? SECURITY DEFINER y STABLE como las demás de la 261: lee user_app_permissions sin depender de lo que la persona pueda leer
CREATE OR REPLACE FUNCTION public.tiene_casilla_agenda(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_app_permissions up
     WHERE up.user_id = uid AND up.app_id = 'agenda' AND up.can_access = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.tiene_casilla_agenda(UUID) IS
  'Tiene la casilla de la app Agenda. Con ella un comercial autonomo (crm-propios) ve todas las citas y los huecos, no solo las suyas (migracion 289).';

DROP POLICY IF EXISTS "Team can view all appointments" ON public.appointments;
CREATE POLICY "Team can view all appointments"
  ON public.appointments FOR SELECT
  TO authenticated
  USING (
    (SELECT NOT public.es_solo_crm_propio((SELECT auth.uid())))
    OR (SELECT public.tiene_casilla_agenda((SELECT auth.uid())))
    OR comercial_id = (SELECT auth.uid())
    OR assigned_closer_id = (SELECT auth.uid())
  );

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  to_regprocedure('public.tiene_casilla_agenda(uuid)') IS NOT NULL AS funcion_creada,
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'Team can view all appointments' AND qual LIKE '%tiene_casilla_agenda%'
  ) AS politica_con_la_salida;
