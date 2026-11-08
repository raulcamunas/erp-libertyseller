-- =============================================================================
-- 277 · Tareas de clientes: ACCESO POR CLIENTE y BUSCADOR
-- =============================================================================
-- ACCESO POR CLIENTE. Hasta ahora quien tenía la casilla «Tareas de clientes» veía TODOS los clientes. Ahora un administrador puede limitar a una persona a unos cuantos:
-- cada fila de `tc_acceso_clientes` dice «esta persona ve este cliente». REGLA: quien NO tiene ninguna fila ve todos (así nadie pierde nada al lanzar esto); quien tiene
-- alguna, solo esos. Los administradores ven siempre todos. El servidor lo aplica en cada ruta; esto lo aplica también la base de datos a lo que se lee desde el navegador.
--
-- BUSCADOR. `tc_buscar` busca en títulos, cuerpos y comentarios sin distinguir mayúsculas ni acentos («accion» encuentra «acción»).
--
-- Idempotente: se puede lanzar más de una vez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tc_acceso_clientes (
  usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, cliente_id)
);
CREATE INDEX IF NOT EXISTS idx_tc_acceso_cliente ON public.tc_acceso_clientes (cliente_id);

-- Cerrada al navegador: la lee y la escribe solo el servidor (sin ninguna política)
ALTER TABLE public.tc_acceso_clientes ENABLE ROW LEVEL SECURITY;

-- ¿Puede la persona de la sesión ver ESTE cliente?
CREATE OR REPLACE FUNCTION public.puede_ver_cliente_tc(p_cliente UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.puede_ver_tareas_clientes()
     AND (
       EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
       OR NOT EXISTS (SELECT 1 FROM public.tc_acceso_clientes a WHERE a.usuario_id = auth.uid())
       OR EXISTS (SELECT 1 FROM public.tc_acceso_clientes a WHERE a.usuario_id = auth.uid() AND a.cliente_id = p_cliente)
     );
$$;

-- Lo que se lee desde el navegador, ahora también por cliente
DROP POLICY IF EXISTS tc_clientes_leer ON public.tc_clientes;
CREATE POLICY tc_clientes_leer ON public.tc_clientes FOR SELECT TO authenticated USING (public.puede_ver_cliente_tc(id));

DROP POLICY IF EXISTS tc_tareas_leer ON public.tc_tareas;
CREATE POLICY tc_tareas_leer ON public.tc_tareas FOR SELECT TO authenticated USING (public.puede_ver_cliente_tc(cliente_id));

DROP POLICY IF EXISTS tc_comentarios_leer ON public.tc_comentarios;
CREATE POLICY tc_comentarios_leer ON public.tc_comentarios FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tc_tareas t WHERE t.id = tc_comentarios.tarea_id AND public.puede_ver_cliente_tc(t.cliente_id)));

DROP POLICY IF EXISTS tc_actividad_leer ON public.tc_actividad;
CREATE POLICY tc_actividad_leer ON public.tc_actividad FOR SELECT TO authenticated
  USING (CASE WHEN cliente_id IS NULL THEN public.puede_ver_tareas_clientes() ELSE public.puede_ver_cliente_tc(cliente_id) END);

DROP POLICY IF EXISTS tc_vistas_leer ON public.tc_vistas;
CREATE POLICY tc_vistas_leer ON public.tc_vistas FOR SELECT TO authenticated
  USING ((cliente_id IS NULL OR public.puede_ver_cliente_tc(cliente_id)) AND public.puede_ver_tareas_clientes() AND (usuario_id IS NULL OR usuario_id = auth.uid()));

DO $$
BEGIN
  -- tc_plantillas existe si se lanzó la 276; si no, no pasa nada
  IF to_regclass('public.tc_plantillas') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS tc_plantillas_leer ON public.tc_plantillas';
    EXECUTE 'CREATE POLICY tc_plantillas_leer ON public.tc_plantillas FOR SELECT TO authenticated USING (CASE WHEN cliente_id IS NULL THEN public.puede_ver_tareas_clientes() ELSE public.puede_ver_cliente_tc(cliente_id) END)';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- El buscador
-- ---------------------------------------------------------------------------
-- Minúsculas y sin acentos (cada letra con acento se cambia por UNA letra, así las posiciones del texto no se mueven)
CREATE OR REPLACE FUNCTION public.tc_sin_acentos(t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT lower(translate(coalesce(t, ''), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')) $$;

-- Busca `p_q` en títulos, cuerpos y comentarios de las tareas SIN archivar. `p_clientes`: los clientes donde buscar (vacío = todos). Devuelve una fila por coincidencia con un
-- fragmento alrededor. Se llama desde el servidor con la clave de servicio, que ya filtra por los clientes de quien busca.
CREATE OR REPLACE FUNCTION public.tc_buscar(p_q TEXT, p_clientes UUID[] DEFAULT NULL, p_limite INTEGER DEFAULT 40)
RETURNS TABLE (donde TEXT, tarea_id UUID, cliente_id UUID, titulo TEXT, estado TEXT, fragmento TEXT, fecha TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT replace(replace(replace(public.tc_sin_acentos(trim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') AS patron,
           public.tc_sin_acentos(trim(p_q)) AS llano
  ),
  en_titulo AS (
    SELECT 'titulo'::TEXT AS donde, t.id AS tarea_id, t.cliente_id, t.titulo, t.estado, ''::TEXT AS fragmento, t.actualizado_en AS fecha, 1 AS orden
    FROM public.tc_tareas t, q
    WHERE NOT t.archivada AND (p_clientes IS NULL OR t.cliente_id = ANY (p_clientes))
      AND length(q.llano) > 0 AND public.tc_sin_acentos(t.titulo) LIKE '%' || q.patron || '%'
  ),
  en_cuerpo AS (
    SELECT 'cuerpo'::TEXT, t.id, t.cliente_id, t.titulo, t.estado,
           substr(t.contenido_texto, greatest(position(q.llano IN public.tc_sin_acentos(t.contenido_texto)) - 50, 1), 160), t.actualizado_en, 2
    FROM public.tc_tareas t, q
    WHERE NOT t.archivada AND (p_clientes IS NULL OR t.cliente_id = ANY (p_clientes))
      AND length(q.llano) > 0 AND public.tc_sin_acentos(t.contenido_texto) LIKE '%' || q.patron || '%'
  ),
  en_comentario AS (
    SELECT 'comentario'::TEXT, t.id, t.cliente_id, t.titulo, t.estado,
           substr(c.cuerpo, greatest(position(q.llano IN public.tc_sin_acentos(c.cuerpo)) - 50, 1), 160), c.creado_en, 3
    FROM public.tc_comentarios c
    JOIN public.tc_tareas t ON t.id = c.tarea_id, q
    WHERE NOT c.borrado AND NOT t.archivada AND (p_clientes IS NULL OR t.cliente_id = ANY (p_clientes))
      AND length(q.llano) > 0 AND public.tc_sin_acentos(c.cuerpo) LIKE '%' || q.patron || '%'
  )
  SELECT u.donde, u.tarea_id, u.cliente_id, u.titulo, u.estado, u.fragmento, u.fecha
  FROM (SELECT * FROM en_titulo UNION ALL SELECT * FROM en_cuerpo UNION ALL SELECT * FROM en_comentario) u
  ORDER BY u.orden, u.fecha DESC
  LIMIT greatest(p_limite, 1);
$$;

-- Comprobación: una fila con todo en true
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tc_acceso_clientes') AS tabla_de_accesos,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'puede_ver_cliente_tc') AS funcion_de_acceso,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tc_buscar') AS buscador,
  public.tc_sin_acentos('Acción Éxito Niño') = 'accion exito nino' AS sin_acentos_ok;
