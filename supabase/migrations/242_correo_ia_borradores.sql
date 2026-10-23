-- ============================================================================
-- 242 · CORREO CON IA: EL REGISTRO DE LOS BORRADORES
-- ============================================================================
--
-- Desde un lead de Cold Calling, el botón «Redactar con IA» del cuadro de correo escribe un borrador con los datos de la empresa y el
-- historial del lead (sin nada de facturación). El comercial lo edita y lo envía. Esta tabla apunta cada borrador que la IA ha
-- escrito y, cuando el correo sale, lo que salió DE VERDAD (editado):
--
--   · para poner un límite de uso por persona (cada redacción cuesta unos céntimos de IA);
--   · para medir después si los correos que empiezan con IA obtienen más respuestas que los escritos a mano (`hilo_id` es la
--     conversación en la que quedó el correo: si en ese hilo hay una respuesta de fuera, contestaron);
--   · para ver cuánto edita cada comercial lo que escribe la IA (`texto` frente a `texto_final`).
--
-- Los correos que ENSEÑAN a la IA (los fríos del equipo que obtuvieron respuesta) salen de `correo_mensajes`, no de aquí: esta tabla no es
-- necesaria para que la IA aprenda, solo para medir.
--
-- CERRADA al navegador, como todas las de correo: sin políticas y con los permisos quitados. La lee y la escribe solo el servidor.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- El código funciona SIN esta migración: la IA redacta igual, solo que no se apunta nada ni hay límite de uso.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.correo_ia_borradores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Quién lo pidió y para qué lead. SET NULL y no CASCADE: si el lead se borra, el registro de lo que se escribió no tiene por qué irse
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.cold_leads(id) ON DELETE SET NULL,
  buzon_id UUID REFERENCES public.correo_buzones(id) ON DELETE SET NULL,

  modelo TEXT NOT NULL,
  -- El enfoque que la IA dijo haber usado: entrar_en_amazon, mejorar_cuenta, seguimiento, tras_llamada, responder o despedida
  angulo TEXT,
  -- Lo que escribió la IA
  asunto TEXT NOT NULL,
  texto TEXT NOT NULL,
  -- Lo que el comercial pidió para ese correo («más corto», «menciona la llamada»…), si pidió algo
  indicaciones TEXT,
  -- Cuántos correos del equipo con respuesta se le enseñaron como ejemplo
  ejemplos INTEGER NOT NULL DEFAULT 0 CHECK (ejemplos >= 0),
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Cuando el correo sale: la conversación en la que quedó y lo que salió de verdad
  enviado_at TIMESTAMPTZ,
  hilo_id UUID REFERENCES public.correo_hilos(id) ON DELETE SET NULL,
  asunto_final TEXT,
  texto_final TEXT
);

-- El límite de uso por persona cuenta las de la última hora y el último día
CREATE INDEX IF NOT EXISTS correo_ia_borradores_usuario_idx
  ON public.correo_ia_borradores (user_id, creado_at DESC);

CREATE INDEX IF NOT EXISTS correo_ia_borradores_lead_idx
  ON public.correo_ia_borradores (lead_id)
  WHERE lead_id IS NOT NULL;

-- Medir respuestas: de los borradores enviados, a su conversación
CREATE INDEX IF NOT EXISTS correo_ia_borradores_hilo_idx
  ON public.correo_ia_borradores (hilo_id)
  WHERE hilo_id IS NOT NULL;

COMMENT ON TABLE public.correo_ia_borradores IS
  'Borradores de correo que ha escrito la IA para un lead de Cold Calling, y lo que salio de verdad cuando el comercial los edito y envio. Sirve para limitar el uso por persona y para medir si los correos con IA obtienen respuesta. Cerrada al navegador: la lee y la escribe solo el servidor.';

ALTER TABLE public.correo_ia_borradores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_ia_borradores FROM anon, authenticated;
