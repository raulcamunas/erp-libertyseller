-- ============================================================================
-- 302 · CASOS DE CUMPLIMIENTO NORMATIVO (Tareas de clientes → pestaña «Cumplimiento»)
-- ============================================================================
-- Un caso es uno abierto con Ayuda al vendedor de Amazon por un cliente. Quien lo da de alta escribe a mano el ID del caso de Amazon:
-- con ese número el ERP reconoce los correos de Amazon que llegan al buzón vigilado (de momento, business@) y los cuelga del caso, con
-- su vista previa, y avisa en el canal #cumplimiento-normativo.
--
--   tc_casos          el caso: cliente, ID de Amazon (único), título, estado, responsable, notas.
--   tc_casos_correos  qué correo (de la app Correo) es de qué caso. `avisado` = ya se publicó en el canal (cada correo, una vez).
--   tc_casos_ajustes  los buzones que se vigilan (una sola fila). Vacío = los que empiezan por «business@».
--
-- Cerradas al navegador (sin políticas): llevan correos. Solo el servidor entra, con la clave de servicio, y comprueba antes quién
-- puede ver cada cliente (lib/tareas-clientes/acceso.ts).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tc_casos (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id      UUID NOT NULL REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  caso_amazon     TEXT NOT NULL,
  titulo          TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 300),
  estado          TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'esperando_amazon', 'esperando_cliente', 'resuelto')),
  responsable     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notas           TEXT NOT NULL DEFAULT '' CHECK (length(notas) <= 5000),
  creado_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_correo_en TIMESTAMPTZ,
  CONSTRAINT tc_casos_caso_amazon_unico UNIQUE (caso_amazon)
);
CREATE INDEX IF NOT EXISTS tc_casos_cliente_idx ON public.tc_casos (cliente_id, estado);

CREATE TABLE IF NOT EXISTS public.tc_casos_correos (
  caso_id     UUID NOT NULL REFERENCES public.tc_casos(id) ON DELETE CASCADE,
  mensaje_id  UUID NOT NULL REFERENCES public.correo_mensajes(id) ON DELETE CASCADE,
  avisado     BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (caso_id, mensaje_id)
);
CREATE INDEX IF NOT EXISTS tc_casos_correos_mensaje_idx ON public.tc_casos_correos (mensaje_id);

CREATE TABLE IF NOT EXISTS public.tc_casos_ajustes (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  buzones         UUID[] NOT NULL DEFAULT '{}',
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.tc_casos_ajustes (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tc_casos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_casos_correos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_casos_ajustes ENABLE ROW LEVEL SECURITY;
-- Sin ninguna política: cerradas al navegador (el servidor entra con la clave de servicio)


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT. Las dos columnas tienen que decir «true».
-- ============================================================================
SELECT
  (SELECT count(*) = 3 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('tc_casos', 'tc_casos_correos', 'tc_casos_ajustes'))
    AS tiene_las_tres_tablas,
  EXISTS (SELECT 1 FROM public.tc_casos_ajustes WHERE id = 1)
    AS tiene_los_ajustes;
