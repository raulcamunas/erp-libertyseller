-- ============================================================================
-- 232 · EL ENLACE PÚBLICO PARA QUE EL CLIENTE ENCAJE SIN ENTRAR AL ERP
-- ============================================================================
--
-- Encajar es el paso que depende del cliente: él tiene la mercancía, el metro y la báscula. Pero
-- obligarle a entrar al ERP, con su usuario y su contraseña, para repartir unas unidades en unas
-- cajas es lo que hace que el envío se quede esperando. Con esto, la agencia copia un enlace y el
-- cliente abre una página con la marca de Liberty Seller donde reparte las unidades, pone medidas y
-- pesos y pulsa «He terminado de encajar». Sin cuenta ni contraseña.
--
-- Esta tabla guarda esos enlaces. Cada uno da paso a UN envío y sirve SOLO para tres cosas: ver qué
-- referencias hay que encajar, guardar las cajas de ese envío y terminar de encajar (el mismo paso
-- de «Encajando» a «Lista para enviar», con las mismas comprobaciones que en el ERP).
--
--   · `token`    256 bits de azar en base64url (43 caracteres). El token ES la credencial.
--   · `caduca_at` a los 30 días de crearlo. Se puede alargar volviendo a copiar el enlace.
--   · `revocado_at` la agencia puede desactivarlo cuando quiera; crear otro desactiva el anterior.
--   · Solo hay UN enlace sin desactivar por envío (índice único parcial).
--   · El resto de columnas es para la agencia: cuántas veces se ha abierto, cuándo fue la última, cuándo
--     tocó las cajas por última vez y cuándo terminó.
--
-- LA TABLA NO SE PUEDE LEER NI ESCRIBIR DESDE EL NAVEGADOR: sin políticas y con los permisos quitados.
-- Todo pasa por las rutas del servidor, con la clave de servicio, después de comprobar el token.
--
-- Se lanza en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- El código funciona sin esta migración: el enlace simplemente no se puede crear, y la pantalla de
-- la agencia avisa de que falta lanzarla.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_enlaces_encaje (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  remesa_id UUID NOT NULL REFERENCES public.fba_remesas(id) ON DELETE CASCADE,

  token TEXT NOT NULL UNIQUE,
  creado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  caduca_at TIMESTAMPTZ NOT NULL,
  revocado_at TIMESTAMPTZ,

  abierto_veces INTEGER NOT NULL DEFAULT 0,
  ultimo_uso_at TIMESTAMPTZ,
  ultima_edicion_at TIMESTAMPTZ,
  terminado_at TIMESTAMPTZ,

  -- Un token corto se adivina: el código genera 43 caracteres, y esto impide que alguien meta uno flojo a mano
  CONSTRAINT fba_enlaces_encaje_token_largo CHECK (char_length(token) >= 32)
);

-- UN enlace sin desactivar por envío. Crear otro desactiva primero el anterior
CREATE UNIQUE INDEX IF NOT EXISTS fba_enlaces_encaje_uno_vivo_idx
  ON public.fba_enlaces_encaje (remesa_id)
  WHERE revocado_at IS NULL;

CREATE INDEX IF NOT EXISTS fba_enlaces_encaje_remesa_idx
  ON public.fba_enlaces_encaje (remesa_id, creado_at DESC);

COMMENT ON TABLE public.fba_enlaces_encaje IS
  'Enlaces publicos para que el cliente encaje un envio sin entrar al ERP. El token es la credencial: 256 bits, caduca a los 30 dias y se puede desactivar. Solo el servidor la lee y la escribe.';

-- Cerrada al navegador: RLS activada, SIN politicas y con los permisos quitados
ALTER TABLE public.fba_enlaces_encaje ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fba_enlaces_encaje FROM anon, authenticated;
