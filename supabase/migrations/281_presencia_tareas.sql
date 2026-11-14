-- ============================================================================
-- 281 · PRESENCIA EN TAREAS DE CLIENTES: QUIÉN ESTÁ DÓNDE, EN VIVO
-- ============================================================================
--
-- Cada persona con Tareas de clientes abierto cuenta, por un canal de tiempo real, en qué cliente está, qué tarea tiene abierta y si está escribiendo en ella. Es «Presence» de Supabase
-- Realtime: los mensajes viajan por memoria y NO pasan por el disco de la base (nada que ver con lo que quitó la 265), y al cerrar la pestaña la persona desaparece sola.
--
-- El canal es PRIVADO: solo entra (y solo lee lo que pasa) quien tiene acceso al módulo (`puede_ver_tareas_clientes()`: administradores y la casilla «Tareas de clientes»). Sin esta
-- política, Supabase no deja abrir un canal privado: la pantalla sigue funcionando igual, sin presencia.
--
-- NO CREA TABLAS NI TOCA DATOS: solo dos políticas sobre `realtime.messages`. IDEMPOTENTE: se puede volver a pegar.
-- Hace falta la 275 (`puede_ver_tareas_clientes`). Se lanza A MANO en el editor SQL de Supabase.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'No existe realtime.messages: este proyecto de Supabase no tiene los canales privados de Realtime (Project Settings → Realtime). Avísame y lo miramos.';
  END IF;
  IF to_regprocedure('public.puede_ver_tareas_clientes()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.puede_ver_tareas_clientes(): lanza antes la migración 275_tareas_de_clientes.sql.';
  END IF;
END $$;

DROP POLICY IF EXISTS tc_presencia_leer ON realtime.messages;
CREATE POLICY tc_presencia_leer ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'tareas-presencia' AND public.puede_ver_tareas_clientes());

DROP POLICY IF EXISTS tc_presencia_escribir ON realtime.messages;
CREATE POLICY tc_presencia_escribir ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (realtime.topic() = 'tareas-presencia' AND public.puede_ver_tareas_clientes());


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las dos columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname IN ('tc_presencia_leer', 'tc_presencia_escribir'))
    AS tiene_las_dos_politicas,
  (SELECT bool_and(qual LIKE '%tareas-presencia%' OR with_check LIKE '%tareas-presencia%') FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname IN ('tc_presencia_leer', 'tc_presencia_escribir'))
    AS y_son_solo_del_canal_de_tareas;
