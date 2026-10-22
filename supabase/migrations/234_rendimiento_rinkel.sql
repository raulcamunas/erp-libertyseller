-- ============================================================================
-- 234 · RENDIMIENTO COMERCIAL: LAS LLAMADAS DE RINKEL Y SU PANEL
-- ============================================================================
--
-- Cada comercial llama con su propia cuenta de Rinkel. Hasta ahora lo contaba a mano en un recap de Notion
-- (llamadas, WhatsApp, correos, respuestas, citas) o exportaba un Excel de la centralita y lo pasaba a otro
-- sitio. Con esto cada uno vincula SU clave de la API de Rinkel en su panel «Mi rendimiento», y el ERP lee
-- todas sus llamadas —las de todos los días— con su grabación, en un calendario por días.
--
--   · `rinkel_claves`    LA CLAVE de cada comercial, CIFRADA (AES-256-GCM, con la clave del servidor). Cerrada al
--                        navegador: RLS sin políticas y permisos quitados. Solo la lee el servidor, para pedir
--                        a Rinkel, y nunca se le devuelve a nadie.
--   · `rinkel_vinculos`  Lo que SÍ se puede enseñar de esa cuenta: de quién es, cuándo se leyó por última vez,
--                        si falló algo y por dónde va la importación del histórico.
--   · `rinkel_llamadas`  Una fila por llamada. Cada comercial ve las suyas; quien supervisa al equipo
--                        (admin, partner o el permiso 'equipo-comercial'), las de todos.
--
-- Las GRABACIONES no se copian: se reproducen desde Rinkel con una URL temporal que el servidor pide en el
-- momento y solo a quien puede ver esa llamada. Rinkel las guarda 90 días (`grabacion_hasta`).
--
-- Además:
--   · `cold_lead_notes.es_respuesta`: marca una nota como «respuesta del cliente» (un correo o un WhatsApp
--     que ha escrito él), para que «respuestas de hoy» se pueda contar. Hasta ahora una nota solo decía el
--     canal, no quién había hablado.
--   · Se concede la app «Mi rendimiento» ('rendimiento') a los comerciales y a quien tenga la supervisión.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- El código funciona sin esta migración: el panel avisa de que falta lanzarla y nada más se rompe.
-- ============================================================================


-- ---------- La clave de Rinkel de cada comercial, cifrada ----------
CREATE TABLE IF NOT EXISTS public.rinkel_claves (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Cifrada en el servidor antes de llegar aquí (lib/amazon/crypto.ts). Lo que se guarda no sirve de nada
  -- sin la clave de cifrado, que vive en el entorno del contenedor y no en la base
  clave_cifrada TEXT NOT NULL,

  -- Huella de la clave: impide que DOS personas vinculen la MISMA cuenta de Rinkel, que contaría cada
  -- llamada dos veces en los totales del equipo. Un SHA-256 de 64 cifras al azar no se puede revertir
  huella TEXT NOT NULL UNIQUE,

  -- Los cuatro últimos caracteres, para reconocerla en pantalla («…8f90») sin enseñarla
  final_clave TEXT NOT NULL,

  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rinkel_claves IS
  'Clave de la API de Rinkel de cada comercial, CIFRADA. Cerrada al navegador (RLS sin politicas, permisos quitados): solo la lee el servidor, con la clave de servicio, para pedirle las llamadas a Rinkel.';

ALTER TABLE public.rinkel_claves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rinkel_claves FROM anon, authenticated;


-- ---------- Lo que se puede enseñar de cada cuenta vinculada ----------
CREATE TABLE IF NOT EXISTS public.rinkel_vinculos (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Los datos de la cuenta, tal y como los dio Rinkel al vincular: para que la persona vea que es la suya
  rinkel_usuario TEXT,
  rinkel_numero TEXT,

  vinculado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- «Al día» desde cuándo: lo reciente se relee desde aquí menos unos días de solape
  ultimo_sync_at TIMESTAMPTZ,
  ultimo_intento_at TIMESTAMPTZ,
  -- Lo que dijo Rinkel si el último intento falló (una frase nuestra, nunca el cuerpo de su respuesta). NULL = bien
  ultimo_error TEXT,
  -- true cuando ya se ha leído el histórico entero. Hasta entonces `siguiente_pagina` dice por dónde se va
  historico_completo BOOLEAN NOT NULL DEFAULT false,
  siguiente_pagina INTEGER NOT NULL DEFAULT 1 CHECK (siguiente_pagina >= 1),
  -- Cuántas llamadas tiene la cuenta en Rinkel, para el «importando 840 de 2.096»
  rinkel_total INTEGER
);

COMMENT ON TABLE public.rinkel_vinculos IS
  'Estado de la cuenta de Rinkel vinculada por cada comercial: de quien es, cuando se leyo por ultima vez y por donde va la importacion del historico. Sin secretos: cada uno ve la suya y quien supervisa, la de todos.';

ALTER TABLE public.rinkel_vinculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cada uno ve su vinculo y quien supervisa el de todos" ON public.rinkel_vinculos;
CREATE POLICY "Cada uno ve su vinculo y quien supervisa el de todos"
  ON public.rinkel_vinculos FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.puede_ver_equipo_comercial(auth.uid()));

-- Solo el servidor escribe: el estado de una lectura no lo toca nadie desde el navegador
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rinkel_vinculos FROM anon, authenticated;


-- ---------- Las llamadas ----------
CREATE TABLE IF NOT EXISTS public.rinkel_llamadas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- El id del registro en Rinkel. Con el usuario, es lo que impide guardar dos veces la misma llamada
  rinkel_id TEXT NOT NULL,
  call_id TEXT,

  fecha TIMESTAMPTZ NOT NULL,
  -- 'outbound' (la hace el comercial) o 'inbound' (la recibe). Sin CHECK a propósito: si Rinkel inventa
  -- otra, se guarda igual y no se pierde la llamada
  direccion TEXT NOT NULL,
  duracion_s INTEGER NOT NULL DEFAULT 0 CHECK (duracion_s >= 0),
  -- 'ANSWERED' = se descolgó; cualquier otra cosa («MISSED») es que no
  estado TEXT NOT NULL,
  motivo_perdida TEXT,

  -- El número del OTRO lado, en formato E.164 («+34600112233»). NULL si lo ocultó
  numero TEXT,
  numero_anonimo BOOLEAN NOT NULL DEFAULT false,
  -- La línea de Rinkel desde la que se llamó o a la que llamaron
  numero_propio TEXT,

  -- El lead de Cold Calling DE ESTE COMERCIAL al que se llamó, si el número es de uno suyo. No es de nadie
  -- más: enseñar el nombre de la tienda de la cartera de otro no hace falta
  lead_id UUID REFERENCES public.cold_leads(id) ON DELETE SET NULL,

  -- La grabación. NULL = no se grabó. Se reproduce desde Rinkel hasta `grabacion_hasta` (90 días)
  grabacion_id TEXT,
  grabacion_hasta TIMESTAMPTZ,

  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT rinkel_llamadas_una_por_usuario UNIQUE (user_id, rinkel_id)
);

-- El calendario pide «las llamadas de esta persona entre estas fechas»
CREATE INDEX IF NOT EXISTS rinkel_llamadas_usuario_fecha_idx
  ON public.rinkel_llamadas (user_id, fecha DESC);

CREATE INDEX IF NOT EXISTS rinkel_llamadas_lead_idx
  ON public.rinkel_llamadas (lead_id)
  WHERE lead_id IS NOT NULL;

COMMENT ON TABLE public.rinkel_llamadas IS
  'Llamadas de Rinkel de cada comercial, leidas de su cuenta con su clave de la API. Cada uno ve las suyas; quien supervisa al equipo (puede_ver_equipo_comercial), las de todos. Las grabaciones no se copian: se reproducen desde Rinkel.';

ALTER TABLE public.rinkel_llamadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cada uno ve sus llamadas y quien supervisa las de todos" ON public.rinkel_llamadas;
CREATE POLICY "Cada uno ve sus llamadas y quien supervisa las de todos"
  ON public.rinkel_llamadas FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.puede_ver_equipo_comercial(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rinkel_llamadas FROM anon, authenticated;


-- ---------- Una nota puede ser la RESPUESTA de un cliente ----------
--
-- `kind` dice el canal (llamada, email, whatsapp…) pero no quién habló. Para contar «respuestas de hoy»
-- hace falta saber qué notas recogen lo que ha escrito o dicho el cliente. Es un booleano aparte y no un
-- tipo más: una respuesta puede llegar por correo, por WhatsApp o por teléfono, y el canal se sigue
-- queriendo saber.
ALTER TABLE public.cold_lead_notes
  ADD COLUMN IF NOT EXISTS es_respuesta BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cold_lead_notes.es_respuesta IS
  'true = la nota recoge una respuesta del cliente (un correo o un WhatsApp que ha escrito el, o lo que dijo al telefono), no algo que haya enviado el comercial. Cuenta como «respuesta de cliente» en el panel de rendimiento y NO como correo o WhatsApp enviado.';

-- El panel pregunta «las notas de esta persona entre estas fechas»
CREATE INDEX IF NOT EXISTS cold_lead_notes_autor_fecha_idx
  ON public.cold_lead_notes (author_id, occurred_at DESC);


-- ---------- La app «Mi rendimiento» para los comerciales y para quien supervisa ----------
--
-- El menú solo enseña a un employee las apps que tenga en user_app_permissions (mismo caso que «Mis horas»,
-- migración 085). Admin y partner no necesitan fila.
INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
SELECT p.id, 'rendimiento', true
FROM public.profiles p
WHERE p.is_comercial = true
   OR EXISTS (
        SELECT 1 FROM public.user_app_permissions up
        WHERE up.user_id = p.id AND up.app_id = 'equipo-comercial' AND up.can_access = true
      )
ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;


-- ---------- Comprobación ----------
DO $$
DECLARE
  tablas INTEGER;
  con_permiso INTEGER;
  abierta_al_navegador BOOLEAN;
BEGIN
  SELECT count(*) INTO tablas
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('rinkel_claves', 'rinkel_vinculos', 'rinkel_llamadas');
  IF tablas <> 3 THEN
    RAISE EXCEPTION 'Faltan tablas del panel de rendimiento: hay % de 3.', tablas;
  END IF;

  -- Lo que no puede pasar: que la clave se pueda leer desde el navegador
  SELECT has_table_privilege('authenticated', 'public.rinkel_claves', 'SELECT')
      OR has_table_privilege('anon', 'public.rinkel_claves', 'SELECT')
    INTO abierta_al_navegador;
  IF abierta_al_navegador THEN
    RAISE EXCEPTION 'rinkel_claves se puede leer desde el navegador: NO se deja así.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cold_lead_notes' AND column_name = 'es_respuesta'
  ) THEN
    RAISE EXCEPTION 'No se ha creado cold_lead_notes.es_respuesta.';
  END IF;

  SELECT count(*) INTO con_permiso
  FROM public.user_app_permissions WHERE app_id = 'rendimiento' AND can_access = true;

  RAISE NOTICE 'Panel de rendimiento listo: 3 tablas, la clave cerrada al navegador y la app concedida a % personas.', con_permiso;
END $$;
