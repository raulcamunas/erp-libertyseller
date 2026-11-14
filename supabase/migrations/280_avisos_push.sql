-- ============================================================================
-- 280 · AVISOS PUSH: LAS NOTIFICACIONES DE LA CAMPANA TAMBIÉN AL MÓVIL Y AL ORDENADOR
-- ============================================================================
--
-- Cada aviso que sale en la campana del ERP puede llegar además como notificación del sistema, aunque la app esté cerrada (la app instalable en el móvil o Chrome/Edge/Safari).
--
--   · push_config          La pareja de claves (VAPID) con la que el servidor se identifica ante Apple/Google/Mozilla para poder mandar avisos. Se genera sola la primera vez
--                          que hace falta; no hay nada que configurar en Easypanel. Cerrada al navegador.
--   · push_suscripciones   Un dispositivo de una persona que ha activado los avisos: su dirección de entrega, qué quiere recibir («tareas» o «todo») y si va fallando.
--   · push_enviados        Qué avisos ya se mandaron (para no mandar dos veces el mismo, ni a quien lo leyó antes de que saliera).
--
-- NO TOCA NI BORRA NADA QUE YA EXISTA (no modifica la tabla de avisos). Todas las tablas están cerradas al navegador (RLS sin políticas): todo pasa por el servidor.
-- El código funciona SIN esta migración: el botón de activar los avisos dice que falta lanzarla y nada más se rompe.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_config (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  clave_publica TEXT NOT NULL,
  clave_privada TEXT NOT NULL,
  creada_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.push_suscripciones (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- La dirección a la que el servicio de Apple/Google entrega el aviso: única por dispositivo
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  -- «tareas» = solo lo de tareas de clientes · «todo» = todo lo que sale en la campana
  categoria    TEXT NOT NULL DEFAULT 'tareas' CHECK (categoria IN ('tareas', 'todo')),
  dispositivo  TEXT NOT NULL DEFAULT '',
  fallos       INTEGER NOT NULL DEFAULT 0,
  ultimo_envio TIMESTAMPTZ,
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_suscripciones_usuario_idx ON public.push_suscripciones (usuario_id);

CREATE TABLE IF NOT EXISTS public.push_enviados (
  aviso_id   UUID PRIMARY KEY,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_enviados_fecha_idx ON public.push_enviados (enviado_en);

ALTER TABLE public.push_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_suscripciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_enviados       ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las dos columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 3 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('push_config', 'push_suscripciones', 'push_enviados'))
    AS tiene_las_tres_tablas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('push_config', 'push_suscripciones', 'push_enviados'))
    AS y_estan_cerradas_al_navegador;
