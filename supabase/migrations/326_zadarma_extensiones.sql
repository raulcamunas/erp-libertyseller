-- ============================================================================
-- 326 · ZADARMA: QUÉ EXTENSIÓN DE LA CENTRALITA LLEVA CADA COMERCIAL (llamadas a México desde el ERP)
-- ============================================================================
-- Cada comercial que llama a México tiene una extensión de la centralita de Zadarma, que sale con su número de México. El ERP la usa para:
--   · darle su teléfono web (llamar y recibir desde el navegador),
--   · saber de quién es cada llamada que avisa Zadarma (el campo `internal` del aviso es la extensión).
-- Las llamadas van a la MISMA tabla que las de Rinkel (rinkel_llamadas), con el id «zadarma:<pbx_call_id>»: historial del lead, transcripción, Mi rendimiento y
-- los avisos funcionan igual.
-- NO TOCA NI BORRA NADA QUE YA EXISTA. IDEMPOTENTE. Cerrada al navegador (RLS sin políticas).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.zadarma_extensiones (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  extension  TEXT NOT NULL UNIQUE CHECK (extension ~ '^[0-9]{2,6}$'),
  -- El número con el que sale (CallerID), en internacional
  numero     TEXT,
  activa     BOOLEAN NOT NULL DEFAULT TRUE,
  creada_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.zadarma_extensiones ENABLE ROW LEVEL SECURITY;

-- Las tres de México (19 nov 2026): 100 Alejandro, 101 Jhanna, 102 Daniela
INSERT INTO public.zadarma_extensiones (user_id, extension, numero)
SELECT p.id, x.ext, x.num
  FROM (VALUES ('alejandro@libertyseller.com', '100', '+525571004541'),
               ('jhanna@libertyseller.es',     '101', '+525588967746'),
               ('daniela@libertyseller.es',    '102', '+525588693969')) AS x(email, ext, num)
  JOIN public.profiles p ON lower(p.email) = x.email
ON CONFLICT (user_id) DO NOTHING;

-- Tienen que salir las tres
SELECT z.extension, p.full_name, z.numero FROM public.zadarma_extensiones z JOIN public.profiles p ON p.id = z.user_id ORDER BY z.extension;
