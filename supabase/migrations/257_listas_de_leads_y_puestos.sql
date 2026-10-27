-- ============================================================================
-- 257 · LISTAS DE LEADS (VER, MOVER, ASIGNAR, AÑADIR) Y PUESTOS DEL EQUIPO
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo guardado.
-- NO borra ni reescribe ningún lead, ninguna nota, ninguna llamada: los 6.978 leads de hoy siguen exactamente igual después de pegar esto.
-- Hace falta haber lanzado antes la 204 (normalizar_web y tipo_lead), la 208 y la 212.
--
--
-- ============ QUÉ SE QUERÍA ============
--
--   · Ver las listas de Cold Calling y lo usadas y llamadas que están, mover leads de una lista a otra, ver los que venden y los que no venden en Amazon,
--     crear listas nuevas, asignarlas a una persona y meter más tiendas en ellas.
--   · Que cada persona del equipo tenga un PUESTO (Comercial, Manager Comercial, Gestión Administrativa) y que un comercial nuevo salga solo como comercial
--     en Cold Calling y en la Agenda, sin pegar SQL (hasta hoy `is_comercial` solo se ponía por migración: ver la 203).
--
--
-- ============ CÓMO ESTÁ HECHO Y POR QUÉ ASÍ ============
--
-- 1) UNA LISTA SIGUE SIENDO EL TEXTO `cold_leads.source_list`. Nada del código que ya funciona cambia. Lo que se añade es un REGISTRO (`cold_lead_lists`) para que una
--    lista exista aunque todavía no tenga leads, tenga un nombre único (sin «Jose V2» y «José V2» a la vez por un descuido), un responsable y se pueda archivar.
--    Se rellena solo con las listas que ya hay.
--
-- 2) LOS PUESTOS NO SON VALORES NUEVOS DE `profiles.role`. Hay muchísimo código con `role === 'employee'` (el layout, el registro de actividad, las apps que se
--    quedan abiertas, la barra lateral…) y un cuarto, quinto y sexto rol lo rompería sin dar error. El puesto es una columna aparte, `profiles.puesto`, que solo
--    sirve para nombrar a cada uno y para pre-marcar casillas al crear o editar a alguien. Lo que da acceso a algo sigue siendo el rol y las casillas.
--
-- 3) MOVER LEADS Y CAMBIAR SU DUEÑO NO SE HACE DESDE EL NAVEGADOR. La 212 deja a un supervisor trabajar leads ajenos pero un TRIGGER le prohíbe cambiar
--    `assigned_to` (reasignar es de dirección), e INSERT/DELETE de cold_leads son de admin. Así que todo pasa por funciones SQL que ejecuta el servidor con la
--    clave de servicio DESPUÉS de comprobar el permiso (admin, partner, o la casilla nueva «Gestión de listas de leads»). Con la clave de servicio `auth.uid()` es
--    NULL y el trigger de la 212 deja pasar, como con las migraciones de reparto 205 a 207. Cada función vuelve a comprobar por dentro que quien actúa puede.
--
-- 4) TODO QUEDA APUNTADO Y SE PUEDE DESHACER. Cada movimiento guarda quién lo hizo, cuántos leads y cómo estaban antes (`cold_lead_movimientos`). Deshacer
--    devuelve cada lead a su lista y su dueño de antes SOLO si no se ha vuelto a tocar desde entonces; una tanda de tiendas añadidas se deshace borrando las que
--    siguen sin tocar (sin una sola llamada ni nota) y se queda con las que ya se han trabajado.
--
-- 5) EL BANCO (`cold_lead_banco`) son las tiendas del Excel «Tienda no Amazon.xlsx» que todavía no se han repartido. Sale de ahí lo que se añade a una lista; cada
--    tienda guarda en `lead_id` el lead en que se convirtió, así que se sabe cuántas quedan y no se reparte dos veces. La carga de las 23.320 tiendas de los niveles
--    1 a 3 se hace con un script, no con esta migración. Una tienda cuya web ya está en cold_leads NO se duplica: se enlaza (el índice único de la 204 lo exige).
--
--    EL TRAMO IMPORTA TANTO COMO EL NIVEL. Dentro de los niveles 1 a 3 hay tiendas de tramo A (llamar primero: 996), B (llamar en segunda ronda: 13.782), C (solo
--    correo, para Instantly: 6.143), G (grandes cuentas de Alejandro: 1.975) y D (descartadas: 424, retailers y grandes marcas fuera de perfil). Las D NO se pueden
--    repartir nunca (igual que el nivel 4) y se esconden de las búsquedas salvo que se pida el tramo D a propósito; y «las primeras N» sin tramo cogería antes que
--    nada las G y las C, que son las que más venden, así que la pantalla propone por defecto el tramo A y B juntos (`tramo = 'AB'` en el filtro).
--
-- LAS TRES TABLAS NUEVAS ESTÁN CERRADAS AL NAVEGADOR (RLS sin políticas y sin permisos para anon ni authenticated), y las funciones solo las puede ejecutar el
-- servidor (`service_role`).
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) LOS PUESTOS                                                      */
/* ------------------------------------------------------------------ */

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS puesto TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_puesto_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_puesto_check
      CHECK (puesto IS NULL OR puesto IN ('comercial', 'manager_comercial', 'gestion_administrativa'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.puesto IS
  'El puesto de la persona en el equipo: comercial, manager_comercial o gestion_administrativa (NULL = sin puesto). Solo sirve para nombrar a cada uno y para pre-marcar casillas al crear o editar; lo que da acceso sigue siendo `role` y user_app_permissions. NO es un rol nuevo: mucho código compara role = employee.';

-- Los que ya existen, a partir de lo que ya se sabe de ellos (se puede cambiar a mano en Gestión de usuarios). Solo si todavía no tienen puesto.
UPDATE public.profiles p
   SET puesto = 'manager_comercial'
 WHERE p.puesto IS NULL
   AND p.role = 'employee'
   AND EXISTS (
     SELECT 1 FROM public.user_app_permissions u
      WHERE u.user_id = p.id AND u.app_id = 'equipo-comercial' AND u.can_access
   );

UPDATE public.profiles p
   SET puesto = 'comercial'
 WHERE p.puesto IS NULL
   AND p.role = 'employee'
   AND p.is_comercial;


/* ------------------------------------------------------------------ */
/* 2) QUIÉN PUEDE GESTIONAR LISTAS                                     */
/* ------------------------------------------------------------------ */
--
-- Calcada de puede_ver_equipo_comercial (212): admin y partner siempre, y el resto solo con la casilla suelta `gestion-listas`.
-- El id tiene que coincidir LETRA POR LETRA con PERMISO_GESTION_LISTAS de lib/config/apps.ts y con la lectura de lib/cold-calling/listas-acceso.ts.

CREATE OR REPLACE FUNCTION public.puede_gestionar_listas(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.role IN ('admin', 'partner'))
    OR EXISTS (
      SELECT 1 FROM public.user_app_permissions up
       WHERE up.user_id = uid AND up.app_id = 'gestion-listas' AND up.can_access = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.puede_gestionar_listas(UUID) IS
  'Admin y partner siempre; el resto solo con la casilla suelta gestion-listas. Es lo que permite crear listas, mover leads entre listas, cambiarles el dueño y añadir tiendas del banco.';


/* ------------------------------------------------------------------ */
/* 3) EL REGISTRO DE LISTAS                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.cold_lead_lists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- El mismo texto que cold_leads.source_list. Único sin mirar mayúsculas ni espacios de los lados
  nombre       TEXT NOT NULL CHECK (nombre = btrim(nombre) AND length(nombre) BETWEEN 1 AND 80),
  descripcion  TEXT CHECK (descripcion IS NULL OR length(descripcion) <= 300),
  -- A quién está asignada la lista: los leads que se meten en ella pasan a ser suyos. NULL = repartida entre varios o sin asignar
  responsable  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  archivada    BOOLEAN NOT NULL DEFAULT false,
  creada_por   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cold_lead_lists_nombre_uk ON public.cold_lead_lists (lower(btrim(nombre)));

COMMENT ON TABLE public.cold_lead_lists IS
  'Registro de las listas de Cold Calling. Una lista sigue siendo el texto cold_leads.source_list; esto añade que exista vacía, un nombre único, un responsable y poder archivarla. Cerrada al navegador.';

-- Las listas que ya hay (los leads con source_list), una vez cada una. El responsable es la persona dueña de todos sus leads, si es una sola
INSERT INTO public.cold_lead_lists (nombre)
SELECT DISTINCT ON (lower(btrim(l.source_list))) regexp_replace(btrim(l.source_list), '\s+', ' ', 'g')
  FROM public.cold_leads l
 WHERE l.source_list IS NOT NULL AND btrim(l.source_list) <> '' AND length(btrim(l.source_list)) <= 80
 ORDER BY lower(btrim(l.source_list)), l.source_list
ON CONFLICT DO NOTHING;

UPDATE public.cold_lead_lists r
   SET responsable = x.dueno
  FROM (
    SELECT lower(btrim(source_list)) AS clave, (array_agg(DISTINCT assigned_to))[1] AS dueno
      FROM public.cold_leads
     WHERE source_list IS NOT NULL AND btrim(source_list) <> ''
     GROUP BY lower(btrim(source_list))
    HAVING count(*) = count(assigned_to) AND count(DISTINCT assigned_to) = 1
  ) x
 WHERE lower(btrim(r.nombre)) = x.clave AND r.responsable IS NULL;


/* ------------------------------------------------------------------ */
/* 4) EL REGISTRO DE MOVIMIENTOS                                       */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.cold_lead_movimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  accion        TEXT NOT NULL CHECK (accion IN (
                  'crear_lista', 'renombrar_lista', 'archivar_lista', 'desarchivar_lista', 'responsable_lista',
                  'mover', 'asignar', 'mover_asignar', 'asignar_lista', 'anadir_del_banco', 'deshacer'
                )),
  n             INTEGER NOT NULL DEFAULT 0,
  lista_origen  TEXT,
  lista_destino TEXT,
  cambia_lista  BOOLEAN NOT NULL DEFAULT false,
  cambia_dueno  BOOLEAN NOT NULL DEFAULT false,
  dueno_destino UUID,
  -- Cómo estaban antes (para deshacer) o qué leads entraron del banco. Sin clave foránea a propósito: es un histórico
  detalle       JSONB,
  deshecho_at   TIMESTAMPTZ,
  deshecho_por  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cold_lead_movimientos_fecha_idx ON public.cold_lead_movimientos (created_at DESC);

COMMENT ON TABLE public.cold_lead_movimientos IS
  'Quién movió, asignó o añadió qué leads, cuántos y cómo estaban antes (para poder deshacerlo). Cerrada al navegador.';


/* ------------------------------------------------------------------ */
/* 5) EL BANCO DE TIENDAS POR REPARTIR                                 */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.cold_lead_banco (
  dominio            TEXT PRIMARY KEY CHECK (dominio = lower(btrim(dominio)) AND dominio <> ''),
  tienda             TEXT NOT NULL,
  url                TEXT,
  -- Para no duplicar: la misma normalización que usa el índice único de cold_leads (204)
  web_norm           TEXT GENERATED ALWAYS AS (public.normalizar_web(url)) STORED,
  nivel              SMALLINT CHECK (nivel IS NULL OR nivel BETWEEN 1 AND 4),
  tramo              TEXT,
  puntos             NUMERIC,
  plataforma         TEXT,
  ciudad             TEXT,
  categoria_grupo    TEXT,
  ventas_mes_usd     NUMERIC,
  visitas_mes        NUMERIC,
  n_productos        INTEGER,
  anios              NUMERIC,
  ya_en_amazon       TEXT,
  email              TEXT,
  emails_extra       TEXT,
  telefono           TEXT,
  telefonos_extra    TEXT,
  instagram          TEXT,
  linkedin           TEXT,
  razon_social       TEXT,
  cif                TEXT,
  tipo_empresa       TEXT CHECK (tipo_empresa IS NULL OR tipo_empresa IN ('sociedad', 'autonomo')),
  domicilio_social   TEXT,
  registro_mercantil TEXT,
  decisor            TEXT,
  decisor_cargo      TEXT,
  decisores_activos  INTEGER,
  motivo_descarte    TEXT,
  -- El lead en que se convirtió. NULL = todavía sin repartir. Si el lead se borra, la tienda vuelve a estar libre
  lead_id            UUID REFERENCES public.cold_leads(id) ON DELETE SET NULL,
  anadido_a          TEXT,
  anadido_at         TIMESTAMPTZ,
  anadido_por        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cargado_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cold_lead_banco_libres_idx ON public.cold_lead_banco (nivel, ventas_mes_usd DESC) WHERE lead_id IS NULL;
CREATE INDEX IF NOT EXISTS cold_lead_banco_web_idx ON public.cold_lead_banco (web_norm);
CREATE INDEX IF NOT EXISTS cold_lead_banco_lead_idx ON public.cold_lead_banco (lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON TABLE public.cold_lead_banco IS
  'Las tiendas online del Excel «Tienda no Amazon» (Store Leads cruzado con el BORME) que se pueden repartir a los comerciales. lead_id dice si ya se repartió. Se carga con un script; cerrada al navegador.';

-- Índice para comparar con las webs de cold_leads sin recorrerlas todas (el de la 204 es parcial y solo vale para tiendas online)
CREATE INDEX IF NOT EXISTS idx_cold_leads_web_norm ON public.cold_leads (public.normalizar_web(web)) WHERE web IS NOT NULL;


/* ------------------------------------------------------------------ */
/* 6) CERRADAS AL NAVEGADOR                                            */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_lead_lists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_lead_movimientos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_lead_banco        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cold_lead_lists       FROM anon, authenticated;
REVOKE ALL ON TABLE public.cold_lead_movimientos FROM anon, authenticated;
REVOKE ALL ON TABLE public.cold_lead_banco       FROM anon, authenticated;


/* ------------------------------------------------------------------ */
/* 7) PEQUEÑOS AYUDANTES                                               */
/* ------------------------------------------------------------------ */

-- El nombre de una lista como se guarda: sin espacios de los lados y con los dobles reducidos. NULL si queda vacío
CREATE OR REPLACE FUNCTION public._cold_nombre_de_lista(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '');
$$;

-- Corta si quien actúa no puede gestionar listas. Cada función pública empieza por aquí aunque el servidor ya lo haya comprobado
CREATE OR REPLACE FUNCTION public._cold_exigir_gestor(p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_actor IS NULL OR NOT public.puede_gestionar_listas(p_actor) THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar las listas de leads.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Esa persona existe (para poder asignarle una lista o unos leads)
CREATE OR REPLACE FUNCTION public._cold_exigir_persona(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_id) THEN
    RAISE EXCEPTION 'Esa persona no existe.' USING ERRCODE = '22023';
  END IF;
END $$;


/* ------------------------------------------------------------------ */
/* 8) CREAR, RENOMBRAR Y ARCHIVAR LISTAS                               */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.cold_lista_crear(p_actor UUID, p_nombre TEXT, p_descripcion TEXT DEFAULT NULL, p_responsable UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre TEXT;
  v_id UUID;
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  PERFORM public._cold_exigir_persona(p_responsable);
  v_nombre := public._cold_nombre_de_lista(p_nombre);
  IF v_nombre IS NULL OR length(v_nombre) > 80 THEN
    RAISE EXCEPTION 'El nombre de la lista tiene que tener entre 1 y 80 caracteres.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.cold_lead_lists (nombre, descripcion, responsable, creada_por)
    VALUES (v_nombre, left(NULLIF(btrim(coalesce(p_descripcion, '')), ''), 300), p_responsable, p_actor)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe una lista que se llama «%».', v_nombre USING ERRCODE = '23505';
  END;
  INSERT INTO public.cold_lead_movimientos (usuario, accion, lista_destino, dueno_destino, n)
  VALUES (p_actor, 'crear_lista', v_nombre, p_responsable, 0);
  RETURN jsonb_build_object('id', v_id, 'nombre', v_nombre);
END $$;

CREATE OR REPLACE FUNCTION public.cold_lista_renombrar(p_actor UUID, p_id UUID, p_nombre TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_viejo TEXT;
  v_nuevo TEXT;
  v_leads INTEGER;
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  SELECT nombre INTO v_viejo FROM public.cold_lead_lists WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa lista no existe.' USING ERRCODE = '22023';
  END IF;
  v_nuevo := public._cold_nombre_de_lista(p_nombre);
  IF v_nuevo IS NULL OR length(v_nuevo) > 80 THEN
    RAISE EXCEPTION 'El nombre de la lista tiene que tener entre 1 y 80 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF v_nuevo = v_viejo THEN
    RETURN jsonb_build_object('id', p_id, 'nombre', v_nuevo, 'leads', 0);
  END IF;
  IF EXISTS (SELECT 1 FROM public.cold_lead_lists WHERE id <> p_id AND lower(btrim(nombre)) = lower(v_nuevo)) THEN
    RAISE EXCEPTION 'Ya existe una lista que se llama «%».', v_nuevo USING ERRCODE = '23505';
  END IF;
  UPDATE public.cold_lead_lists SET nombre = v_nuevo, updated_at = now() WHERE id = p_id;
  UPDATE public.cold_leads SET source_list = v_nuevo WHERE lower(btrim(source_list)) = lower(btrim(v_viejo));
  GET DIAGNOSTICS v_leads = ROW_COUNT;
  INSERT INTO public.cold_lead_movimientos (usuario, accion, n, lista_origen, lista_destino)
  VALUES (p_actor, 'renombrar_lista', v_leads, v_viejo, v_nuevo);
  RETURN jsonb_build_object('id', p_id, 'nombre', v_nuevo, 'leads', v_leads);
END $$;

CREATE OR REPLACE FUNCTION public.cold_lista_archivar(p_actor UUID, p_id UUID, p_archivada BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre TEXT;
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  UPDATE public.cold_lead_lists SET archivada = coalesce(p_archivada, true), updated_at = now() WHERE id = p_id RETURNING nombre INTO v_nombre;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa lista no existe.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cold_lead_movimientos (usuario, accion, lista_origen)
  VALUES (p_actor, CASE WHEN coalesce(p_archivada, true) THEN 'archivar_lista' ELSE 'desarchivar_lista' END, v_nombre);
  RETURN jsonb_build_object('id', p_id, 'nombre', v_nombre, 'archivada', coalesce(p_archivada, true));
END $$;


/* ------------------------------------------------------------------ */
/* 9) MOVER LEADS DE LISTA Y/O CAMBIARLES EL DUEÑO                     */
/* ------------------------------------------------------------------ */
--
-- La pieza que hace el trabajo: cambia la lista y/o el dueño de unos leads, de golpe, guardando cómo estaban. Solo toca los que de verdad cambian.
-- Es interna: las públicas de abajo la llaman después de comprobar quién actúa y que la lista y la persona existen.

CREATE OR REPLACE FUNCTION public._cold_aplicar(
  p_actor UUID, p_ids UUID[], p_cambia_lista BOOLEAN, p_lista TEXT, p_cambia_dueno BOOLEAN, p_dueno UUID, p_accion TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cambiados INTEGER := 0;
  v_antes JSONB;
  v_origen TEXT;
  v_mov UUID;
BEGIN
  WITH previos AS (
    SELECT l.id, l.source_list, l.assigned_to
      FROM public.cold_leads l
     WHERE l.id = ANY(p_ids)
       AND ((p_cambia_lista AND l.source_list IS DISTINCT FROM p_lista) OR (p_cambia_dueno AND l.assigned_to IS DISTINCT FROM p_dueno))
       FOR UPDATE
  ), cambios AS (
    UPDATE public.cold_leads l
       SET source_list = CASE WHEN p_cambia_lista THEN p_lista ELSE l.source_list END,
           assigned_to = CASE WHEN p_cambia_dueno THEN p_dueno ELSE l.assigned_to END
      FROM previos p
     WHERE l.id = p.id
    RETURNING p.id AS id, p.source_list AS lista_antes, p.assigned_to AS dueno_antes
  )
  SELECT count(*)::int,
         jsonb_agg(jsonb_build_array(id, lista_antes, dueno_antes)),
         CASE WHEN count(DISTINCT lista_antes) = 1 THEN min(lista_antes) END
    INTO v_cambiados, v_antes, v_origen
    FROM cambios;

  IF v_cambiados = 0 THEN
    RETURN jsonb_build_object('movimiento', NULL, 'cambiados', 0);
  END IF;

  INSERT INTO public.cold_lead_movimientos (usuario, accion, n, lista_origen, lista_destino, cambia_lista, cambia_dueno, dueno_destino, detalle)
  VALUES (p_actor, p_accion, v_cambiados, v_origen, CASE WHEN p_cambia_lista THEN p_lista END, p_cambia_lista, p_cambia_dueno,
          CASE WHEN p_cambia_dueno THEN p_dueno END, jsonb_build_object('antes', v_antes))
  RETURNING id INTO v_mov;

  RETURN jsonb_build_object('movimiento', v_mov, 'cambiados', v_cambiados);
END $$;

CREATE OR REPLACE FUNCTION public.cold_leads_mover(
  p_actor UUID, p_ids UUID[], p_cambia_lista BOOLEAN, p_lista TEXT, p_cambia_dueno BOOLEAN, p_dueno UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lista TEXT := NULL;
  v_accion TEXT;
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'No hay ningún lead elegido.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_ids) > 10000 THEN
    RAISE EXCEPTION 'Son demasiados leads de una vez (el máximo son 10.000).' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(p_cambia_lista, false) AND NOT coalesce(p_cambia_dueno, false) THEN
    RAISE EXCEPTION 'No hay nada que cambiar.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_cambia_lista, false) AND p_lista IS NOT NULL THEN
    SELECT nombre INTO v_lista FROM public.cold_lead_lists WHERE lower(btrim(nombre)) = lower(btrim(p_lista)) AND NOT archivada;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa lista no existe o está archivada.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF coalesce(p_cambia_dueno, false) THEN
    PERFORM public._cold_exigir_persona(p_dueno);
  END IF;
  v_accion := CASE WHEN coalesce(p_cambia_lista, false) AND coalesce(p_cambia_dueno, false) THEN 'mover_asignar'
                   WHEN coalesce(p_cambia_lista, false) THEN 'mover' ELSE 'asignar' END;
  RETURN public._cold_aplicar(p_actor, p_ids, coalesce(p_cambia_lista, false), v_lista, coalesce(p_cambia_dueno, false), p_dueno, v_accion);
END $$;

-- Asigna una LISTA a una persona: queda como su responsable y, según el alcance, se le pasan los leads de la lista.
--   ninguno    solo se apunta el responsable (los leads nuevos que entren serán suyos)
--   sin_dueno  los leads de la lista que no tienen dueño
--   pendientes los que todavía no se han tocado (Sin contactar), tengan el dueño que tengan
--   todos      todos los de la lista, incluidos los que ya trabaja otra persona
CREATE OR REPLACE FUNCTION public.cold_lista_responsable(p_actor UUID, p_id UUID, p_dueno UUID, p_alcance TEXT DEFAULT 'ninguno')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre TEXT;
  v_ids UUID[];
  v_res JSONB := jsonb_build_object('movimiento', NULL, 'cambiados', 0);
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  PERFORM public._cold_exigir_persona(p_dueno);
  IF p_alcance NOT IN ('ninguno', 'sin_dueno', 'pendientes', 'todos') THEN
    RAISE EXCEPTION 'Ese alcance no existe.' USING ERRCODE = '22023';
  END IF;
  IF p_alcance <> 'ninguno' AND p_dueno IS NULL THEN
    RAISE EXCEPTION 'Para pasar los leads de la lista hay que elegir a quién.' USING ERRCODE = '22023';
  END IF;
  SELECT nombre INTO v_nombre FROM public.cold_lead_lists WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa lista no existe.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cold_lead_lists SET responsable = p_dueno, updated_at = now() WHERE id = p_id;

  IF p_alcance <> 'ninguno' THEN
    SELECT array_agg(l.id) INTO v_ids
      FROM public.cold_leads l
     WHERE lower(btrim(l.source_list)) = lower(btrim(v_nombre))
       AND CASE p_alcance WHEN 'sin_dueno' THEN l.assigned_to IS NULL WHEN 'pendientes' THEN l.status = 'pendiente' ELSE true END;
    IF v_ids IS NOT NULL THEN
      IF cardinality(v_ids) > 10000 THEN
        RAISE EXCEPTION 'La lista tiene demasiados leads para pasarlos de una vez (el máximo son 10.000).' USING ERRCODE = '22023';
      END IF;
      v_res := public._cold_aplicar(p_actor, v_ids, false, NULL, true, p_dueno, 'asignar_lista');
    END IF;
  END IF;

  INSERT INTO public.cold_lead_movimientos (usuario, accion, lista_origen, dueno_destino, n)
  VALUES (p_actor, 'responsable_lista', v_nombre, p_dueno, coalesce((v_res->>'cambiados')::int, 0));
  RETURN jsonb_build_object('id', p_id, 'nombre', v_nombre, 'responsable', p_dueno) || v_res;
END $$;


/* ------------------------------------------------------------------ */
/* 10) DESHACER                                                        */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.cold_leads_deshacer(p_actor UUID, p_movimiento UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.cold_lead_movimientos%ROWTYPE;
  v_ids UUID[];
  v_hechos INTEGER := 0;
  v_total INTEGER := 0;
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  SELECT * INTO m FROM public.cold_lead_movimientos WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese movimiento no existe.' USING ERRCODE = '22023';
  END IF;
  IF m.deshecho_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese movimiento ya se había deshecho.' USING ERRCODE = '22023';
  END IF;
  IF m.accion NOT IN ('mover', 'asignar', 'mover_asignar', 'asignar_lista', 'anadir_del_banco') THEN
    RAISE EXCEPTION 'Ese movimiento no se puede deshacer.' USING ERRCODE = '22023';
  END IF;
  IF m.created_at < now() - interval '14 days' THEN
    RAISE EXCEPTION 'Solo se pueden deshacer los movimientos de las últimas dos semanas.' USING ERRCODE = '22023';
  END IF;

  IF m.accion = 'anadir_del_banco' THEN
    SELECT array_agg((e)::uuid) INTO v_ids FROM jsonb_array_elements_text(coalesce(m.detalle->'leads', '[]'::jsonb)) e;
    v_total := coalesce(cardinality(v_ids), 0);
    -- Se borran solo las que siguen sin tocar: ni una llamada, ni un correo, ni una nota. Las trabajadas se quedan
    WITH borradas AS (
      DELETE FROM public.cold_leads l
       WHERE l.id = ANY(coalesce(v_ids, '{}'::uuid[]))
         AND l.status = 'pendiente' AND l.call_attempts = 0 AND l.last_contacted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.cold_lead_notes n WHERE n.lead_id = l.id)
      RETURNING l.id
    )
    SELECT count(*)::int INTO v_hechos FROM borradas;
    UPDATE public.cold_lead_banco
       SET anadido_a = NULL, anadido_at = NULL, anadido_por = NULL
     WHERE lead_id IS NULL AND anadido_a IS NOT NULL AND (anadido_at >= m.created_at - interval '1 minute');
  ELSE
    -- Cada lead vuelve a su lista y su dueño de antes, pero SOLO si sigue como lo dejó este movimiento: si alguien lo ha vuelto a mover, se respeta
    WITH antes AS (
      SELECT (e->>0)::uuid AS id, e->>1 AS lista_antes, (e->>2)::uuid AS dueno_antes
        FROM jsonb_array_elements(coalesce(m.detalle->'antes', '[]'::jsonb)) e
    ), vueltos AS (
      UPDATE public.cold_leads l
         SET source_list = CASE WHEN m.cambia_lista AND l.source_list IS NOT DISTINCT FROM m.lista_destino THEN a.lista_antes ELSE l.source_list END,
             assigned_to = CASE WHEN m.cambia_dueno AND l.assigned_to IS NOT DISTINCT FROM m.dueno_destino THEN a.dueno_antes ELSE l.assigned_to END
        FROM antes a
       WHERE l.id = a.id
         AND ((m.cambia_lista AND l.source_list IS NOT DISTINCT FROM m.lista_destino) OR (m.cambia_dueno AND l.assigned_to IS NOT DISTINCT FROM m.dueno_destino))
      RETURNING l.id
    )
    SELECT (SELECT count(*)::int FROM vueltos), (SELECT count(*)::int FROM antes) INTO v_hechos, v_total;
  END IF;

  UPDATE public.cold_lead_movimientos SET deshecho_at = now(), deshecho_por = p_actor WHERE id = m.id;
  INSERT INTO public.cold_lead_movimientos (usuario, accion, n, lista_origen, lista_destino, detalle)
  VALUES (p_actor, 'deshacer', v_hechos, m.lista_destino, m.lista_origen, jsonb_build_object('movimiento', m.id, 'accion', m.accion, 'conservados', v_total - v_hechos));
  RETURN jsonb_build_object('deshechos', v_hechos, 'conservados', v_total - v_hechos, 'accion', m.accion);
END $$;


/* ------------------------------------------------------------------ */
/* 11) AÑADIR TIENDAS DEL BANCO A UNA LISTA                            */
/* ------------------------------------------------------------------ */
--
-- Convierte las tiendas elegidas (por su dominio) en leads de la lista, con el dueño que se diga. Con las mismas columnas y el mismo significado que la importación
-- de la 204: vende_en_amazon = sin_comprobar, estado pendiente, tipo tienda_online. Una tienda cuya web YA está en cold_leads no se duplica: se enlaza.
-- Como mucho 3.000 de una vez (la consulta tiene que acabar en pocos segundos).

CREATE OR REPLACE FUNCTION public.cold_banco_anadir(p_actor UUID, p_dominios TEXT[], p_lista TEXT, p_dueno UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lista TEXT;
  v_ya INTEGER := 0;
  v_ids UUID[];
  v_anadidos INTEGER := 0;
  v_pedidas INTEGER;
  v_mov UUID;
BEGIN
  PERFORM public._cold_exigir_gestor(p_actor);
  PERFORM public._cold_exigir_persona(p_dueno);
  IF p_dominios IS NULL OR cardinality(p_dominios) = 0 THEN
    RAISE EXCEPTION 'No hay ninguna tienda elegida.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_dominios) > 3000 THEN
    RAISE EXCEPTION 'Son demasiadas tiendas de una vez (el máximo son 3.000).' USING ERRCODE = '22023';
  END IF;
  SELECT nombre INTO v_lista FROM public.cold_lead_lists WHERE lower(btrim(nombre)) = lower(btrim(coalesce(p_lista, ''))) AND NOT archivada;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa lista no existe o está archivada.' USING ERRCODE = '22023';
  END IF;
  v_pedidas := cardinality(p_dominios);

  -- Las que ya estaban en el ERP (misma web): se enlazan y no se vuelven a meter
  WITH enlazadas AS (
    UPDATE public.cold_lead_banco b
       SET lead_id = l.id
      FROM public.cold_leads l
     WHERE b.dominio = ANY(p_dominios) AND b.lead_id IS NULL AND b.web_norm IS NOT NULL
       AND l.web IS NOT NULL AND public.normalizar_web(l.web) = b.web_norm
    RETURNING b.dominio
  )
  SELECT count(*)::int INTO v_ya FROM enlazadas;

  -- Las demás, a la lista y al dueño. Del nivel 1 al 3 (el 4 son las descartadas y cold_leads no admite ese nivel) y nunca las de tramo D (descartada)
  WITH nuevas AS (
    SELECT DISTINCT ON (b.web_norm) b.*
      FROM public.cold_lead_banco b
     WHERE b.dominio = ANY(p_dominios) AND b.lead_id IS NULL AND b.web_norm IS NOT NULL AND (b.nivel IS NULL OR b.nivel BETWEEN 1 AND 3)
       AND upper(left(coalesce(b.tramo, ''), 1)) <> 'D'
     ORDER BY b.web_norm, b.nivel NULLS LAST
  ), ins AS (
    INSERT INTO public.cold_leads (
      store_name, company, phone, email, category, tipo_lead, source_list, assigned_to, status, vende_en_amazon,
      decisor, cargo_decisor, ciudad, nivel, ventas_estimadas_usd, n_productos, anos_tienda, plataforma, web, instagram,
      cif, tipo_empresa, n_administradores, telefonos_extra, emails_extra, business_address, mercantile_registry
    )
    SELECT n.tienda, n.razon_social, n.telefono, n.email, n.categoria_grupo, 'tienda_online', v_lista, p_dueno, 'pendiente', 'sin_comprobar',
           n.decisor, n.decisor_cargo, n.ciudad, n.nivel, n.ventas_mes_usd, n.n_productos, n.anios, n.plataforma, n.url, n.instagram,
           n.cif, n.tipo_empresa, n.decisores_activos, n.telefonos_extra, n.emails_extra, n.domicilio_social, n.registro_mercantil
      FROM nuevas n
    RETURNING id, web
  )
  SELECT array_agg(id) INTO v_ids FROM ins;

  IF v_ids IS NOT NULL THEN
    v_anadidos := cardinality(v_ids);
    UPDATE public.cold_lead_banco b
       SET lead_id = l.id, anadido_a = v_lista, anadido_at = now(), anadido_por = p_actor
      FROM public.cold_leads l
     WHERE l.id = ANY(v_ids) AND b.lead_id IS NULL AND b.dominio = ANY(p_dominios) AND public.normalizar_web(l.web) = b.web_norm;
  END IF;

  INSERT INTO public.cold_lead_movimientos (usuario, accion, n, lista_destino, cambia_lista, cambia_dueno, dueno_destino, detalle)
  VALUES (p_actor, 'anadir_del_banco', v_anadidos, v_lista, true, p_dueno IS NOT NULL, p_dueno,
          jsonb_build_object('leads', coalesce(to_jsonb(v_ids), '[]'::jsonb), 'ya_estaban', v_ya, 'pedidas', v_pedidas))
  RETURNING id INTO v_mov;

  RETURN jsonb_build_object('movimiento', v_mov, 'anadidos', v_anadidos, 'ya_estaban', v_ya, 'no_disponibles', GREATEST(v_pedidas - v_anadidos - v_ya, 0), 'lista', v_lista);
END $$;


-- Enlaza con su lead las tiendas del banco cuya web YA está entre los leads (se repartieron antes de existir esta pantalla): así «por repartir» cuenta solo las que
-- quedan de verdad. Idempotente. La llama el script que carga el banco, justo después de cargarlo; añadir tiendas a una lista hace lo mismo con las que pide.
CREATE OR REPLACE FUNCTION public.cold_banco_enlazar()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n INTEGER;
BEGIN
  WITH enlazadas AS (
    UPDATE public.cold_lead_banco b
       SET lead_id = l.id
      FROM (
        SELECT DISTINCT ON (public.normalizar_web(web)) id, public.normalizar_web(web) AS web_norm
          FROM public.cold_leads
         WHERE web IS NOT NULL
         ORDER BY public.normalizar_web(web), created_at
      ) l
     WHERE b.lead_id IS NULL AND b.web_norm IS NOT NULL AND b.web_norm = l.web_norm
    RETURNING b.dominio
  )
  SELECT count(*)::int INTO v_n FROM enlazadas;
  RETURN jsonb_build_object('enlazadas', v_n);
END $$;


/* ------------------------------------------------------------------ */
/* 12) LEER: RESÚMENES Y BÚSQUEDAS                                     */
/* ------------------------------------------------------------------ */
--
-- Todo por funciones y no por consultas sueltas desde el navegador: la pantalla agrupa y filtra en la base (las listas, y los leads de una lista con sus
-- filtros) sin bajarse los casi 7.000 leads —y menos los 30.000 de cuando se reparta el banco—.

-- Una fila por lista, dueño y tipo, con lo usada y llamada que está
CREATE OR REPLACE FUNCTION public.cold_listas_resumen()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    FROM (
      SELECT NULLIF(btrim(l.source_list), '') AS lista,
             l.assigned_to AS dueno,
             l.tipo_lead,
             count(*)::int AS total,
             count(*) FILTER (WHERE l.status = 'pendiente')::int AS pendiente,
             count(*) FILTER (WHERE l.status = 'no_contesta')::int AS no_contesta,
             count(*) FILTER (WHERE l.status = 'programado')::int AS programado,
             count(*) FILTER (WHERE l.status = 'email_enviado')::int AS email_enviado,
             count(*) FILTER (WHERE l.status = 'seguimiento')::int AS seguimiento,
             count(*) FILTER (WHERE l.status = 'cita_cualificada')::int AS cita_cualificada,
             count(*) FILTER (WHERE l.status = 'no_interesa')::int AS no_interesa,
             count(*) FILTER (WHERE l.vende_en_amazon = 'vende')::int AS vende,
             count(*) FILTER (WHERE l.vende_en_amazon = 'no_vende')::int AS no_vende,
             count(*) FILTER (WHERE l.vende_en_amazon = 'sin_comprobar')::int AS sin_comprobar,
             count(*) FILTER (WHERE l.call_attempts > 0)::int AS llamados,
             coalesce(sum(l.call_attempts), 0)::int AS intentos,
             max(l.last_contacted_at) AS ultimo_contacto
        FROM public.cold_leads l
       GROUP BY NULLIF(btrim(l.source_list), ''), l.assigned_to, l.tipo_lead
    ) x
$$;

-- Los leads, con filtros, de página en página. Con p_solo_ids devuelve solo los id (para «seleccionar todos los que cumplen el filtro»)
--   lista     el nombre, o __sin_lista__            dueno   el id de la persona, o __sin_dueno__
--   estado    un estado                              vende   sin_comprobar | no_vende | vende
--   tipo      seller_amazon | tienda_online          nivel   1, 2 o 3
--   empresa   sociedad | autonomo | sin_tipo         q       texto libre (tienda, empresa, teléfono, correo, web o ciudad)
--   orden     prioridad | nombre | reciente | nuevos
CREATE OR REPLACE FUNCTION public.cold_leads_buscar(p_filtro JSONB DEFAULT '{}'::jsonb, p_limite INTEGER DEFAULT 100, p_desde INTEGER DEFAULT 0, p_solo_ids BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := coalesce(p_filtro, '{}'::jsonb);
  v_lista TEXT := NULLIF(f->>'lista', '');
  v_dueno TEXT := NULLIF(f->>'dueno', '');
  v_estado TEXT := NULLIF(f->>'estado', '');
  v_vende TEXT := NULLIF(f->>'vende', '');
  v_tipo TEXT := NULLIF(f->>'tipo', '');
  v_nivel INTEGER := NULLIF(f->>'nivel', '')::int;
  v_empresa TEXT := NULLIF(f->>'empresa', '');
  v_q TEXT := NULLIF(btrim(coalesce(f->>'q', '')), '');
  v_orden TEXT := coalesce(NULLIF(f->>'orden', ''), 'prioridad');
  v_patron TEXT;
  v_limite INTEGER := least(greatest(coalesce(p_limite, 100), 1), CASE WHEN p_solo_ids THEN 10000 ELSE 500 END);
  v_total INTEGER;
  v_salida JSONB;
BEGIN
  v_patron := CASE WHEN v_q IS NULL THEN NULL ELSE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' END;

  SELECT count(*)::int INTO v_total
    FROM public.cold_leads l
   WHERE (v_lista IS NULL OR (v_lista = '__sin_lista__' AND NULLIF(btrim(l.source_list), '') IS NULL) OR (v_lista <> '__sin_lista__' AND lower(btrim(l.source_list)) = lower(btrim(v_lista))))
     AND (v_dueno IS NULL OR (v_dueno = '__sin_dueno__' AND l.assigned_to IS NULL) OR (v_dueno <> '__sin_dueno__' AND l.assigned_to::text = v_dueno))
     AND (v_estado IS NULL OR l.status = v_estado)
     AND (v_vende IS NULL OR l.vende_en_amazon = v_vende)
     AND (v_tipo IS NULL OR l.tipo_lead = v_tipo)
     AND (v_nivel IS NULL OR l.nivel = v_nivel)
     AND (v_empresa IS NULL OR (v_empresa = 'sin_tipo' AND l.tipo_empresa IS NULL) OR l.tipo_empresa = v_empresa)
     AND (v_patron IS NULL OR l.store_name ILIKE v_patron OR l.company ILIKE v_patron OR l.phone ILIKE v_patron OR l.email ILIKE v_patron OR l.web ILIKE v_patron OR l.ciudad ILIKE v_patron);

  WITH sel AS (
    SELECT l.*
      FROM public.cold_leads l
     WHERE (v_lista IS NULL OR (v_lista = '__sin_lista__' AND NULLIF(btrim(l.source_list), '') IS NULL) OR (v_lista <> '__sin_lista__' AND lower(btrim(l.source_list)) = lower(btrim(v_lista))))
       AND (v_dueno IS NULL OR (v_dueno = '__sin_dueno__' AND l.assigned_to IS NULL) OR (v_dueno <> '__sin_dueno__' AND l.assigned_to::text = v_dueno))
       AND (v_estado IS NULL OR l.status = v_estado)
       AND (v_vende IS NULL OR l.vende_en_amazon = v_vende)
       AND (v_tipo IS NULL OR l.tipo_lead = v_tipo)
       AND (v_nivel IS NULL OR l.nivel = v_nivel)
       AND (v_empresa IS NULL OR (v_empresa = 'sin_tipo' AND l.tipo_empresa IS NULL) OR l.tipo_empresa = v_empresa)
       AND (v_patron IS NULL OR l.store_name ILIKE v_patron OR l.company ILIKE v_patron OR l.phone ILIKE v_patron OR l.email ILIKE v_patron OR l.web ILIKE v_patron OR l.ciudad ILIKE v_patron)
     ORDER BY
       CASE WHEN v_orden = 'prioridad' THEN l.nivel END ASC NULLS LAST,
       CASE WHEN v_orden = 'prioridad' THEN coalesce(l.ventas_estimadas_usd, l.revenue_monthly) END DESC NULLS LAST,
       CASE WHEN v_orden = 'reciente' THEN l.last_contacted_at END DESC NULLS LAST,
       CASE WHEN v_orden = 'nuevos' THEN l.created_at END DESC,
       lower(l.store_name), l.id
     LIMIT v_limite OFFSET greatest(coalesce(p_desde, 0), 0)
  )
  SELECT CASE WHEN p_solo_ids
              THEN jsonb_build_object('total', v_total, 'ids', coalesce((SELECT jsonb_agg(id) FROM sel), '[]'::jsonb))
              ELSE jsonb_build_object('total', v_total, 'filas', coalesce((
                     SELECT jsonb_agg(jsonb_build_object(
                       'id', s.id, 'store_name', s.store_name, 'company', s.company, 'phone', s.phone, 'email', s.email, 'ciudad', s.ciudad,
                       'category', s.category, 'status', s.status, 'assigned_to', s.assigned_to, 'source_list', s.source_list, 'tipo_lead', s.tipo_lead,
                       'vende_en_amazon', s.vende_en_amazon, 'nivel', s.nivel, 'tipo_empresa', s.tipo_empresa, 'call_attempts', s.call_attempts,
                       'last_contacted_at', s.last_contacted_at, 'next_call_date', s.next_call_date, 'ventas_estimadas_usd', s.ventas_estimadas_usd,
                       'revenue_monthly', s.revenue_monthly, 'web', s.web, 'decisor', s.decisor
                     )) FROM sel s), '[]'::jsonb))
         END
    INTO v_salida;
  RETURN v_salida;
END $$;

-- El banco: cuántas hay en total, cuántas se pueden repartir, cuántas están descartadas (nivel 4 o tramo D: no se reparten nunca) y de las que se pueden repartir,
-- cuántas hay por nivel, tramo, tipo de empresa, categoría y plataforma
CREATE OR REPLACE FUNCTION public.cold_banco_resumen()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH libres AS (
    SELECT * FROM public.cold_lead_banco b
     WHERE b.lead_id IS NULL AND coalesce(b.nivel, 0) <> 4 AND upper(left(coalesce(b.tramo, ''), 1)) <> 'D'
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.cold_lead_banco),
    'libres', (SELECT count(*) FROM libres),
    'descartadas', (SELECT count(*) FROM public.cold_lead_banco b WHERE b.lead_id IS NULL AND (b.nivel = 4 OR upper(left(coalesce(b.tramo, ''), 1)) = 'D')),
    'por_nivel', coalesce((SELECT jsonb_object_agg(coalesce(nivel::text, 'sin'), n) FROM (SELECT nivel, count(*)::int AS n FROM libres GROUP BY nivel) a), '{}'::jsonb),
    'por_tramo', coalesce((SELECT jsonb_object_agg(coalesce(tramo, 'sin'), n) FROM (SELECT tramo, count(*)::int AS n FROM libres GROUP BY tramo) a), '{}'::jsonb),
    'por_tipo', coalesce((SELECT jsonb_object_agg(coalesce(tipo_empresa, 'sin_tipo'), n) FROM (SELECT tipo_empresa, count(*)::int AS n FROM libres GROUP BY tipo_empresa) a), '{}'::jsonb),
    'categorias', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', coalesce(categoria_grupo, 'Sin categoría'), 'n', n) ORDER BY n DESC) FROM (SELECT categoria_grupo, count(*)::int AS n FROM libres GROUP BY categoria_grupo) a), '[]'::jsonb),
    'plataformas', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', coalesce(plataforma, 'Sin plataforma'), 'n', n) ORDER BY n DESC) FROM (SELECT plataforma, count(*)::int AS n FROM libres GROUP BY plataforma) a), '[]'::jsonb)
  )
$$;

-- Las tiendas del banco, con filtros, de página en página. Con p_solo_dominios devuelve solo los dominios (para «añadir las N primeras»)
--   nivel 1-3 · tramo (la letra: A, B, C, D, G; o AB = A y B juntas, las de llamar) · empresa sociedad|autonomo|sin_tipo · categoria · plataforma · ciudad (texto)
--   Las descartadas (nivel 4 o tramo D) NO salen salvo que se pida el tramo D a propósito: no se pueden repartir
--   con_telefono / con_email / con_decisor (true) · ventas_min · q (tienda, empresa, dominio o ciudad) · incluir_repartidas (true)
CREATE OR REPLACE FUNCTION public.cold_banco_buscar(p_filtro JSONB DEFAULT '{}'::jsonb, p_limite INTEGER DEFAULT 50, p_desde INTEGER DEFAULT 0, p_solo_dominios BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f JSONB := coalesce(p_filtro, '{}'::jsonb);
  v_nivel INTEGER := NULLIF(f->>'nivel', '')::int;
  v_tramo TEXT := NULLIF(upper(btrim(coalesce(f->>'tramo', ''))), '');
  v_empresa TEXT := NULLIF(f->>'empresa', '');
  v_categoria TEXT := NULLIF(f->>'categoria', '');
  v_plataforma TEXT := NULLIF(f->>'plataforma', '');
  v_ciudad TEXT := NULLIF(btrim(coalesce(f->>'ciudad', '')), '');
  v_tel BOOLEAN := coalesce((f->>'con_telefono')::boolean, false);
  v_mail BOOLEAN := coalesce((f->>'con_email')::boolean, false);
  v_dec BOOLEAN := coalesce((f->>'con_decisor')::boolean, false);
  v_ventas NUMERIC := NULLIF(f->>'ventas_min', '')::numeric;
  v_q TEXT := NULLIF(btrim(coalesce(f->>'q', '')), '');
  v_todas BOOLEAN := coalesce((f->>'incluir_repartidas')::boolean, false);
  v_patron TEXT;
  v_patron_ciudad TEXT;
  v_limite INTEGER := least(greatest(coalesce(p_limite, 50), 1), CASE WHEN p_solo_dominios THEN 3000 ELSE 200 END);
  v_total INTEGER;
  v_salida JSONB;
BEGIN
  v_patron := CASE WHEN v_q IS NULL THEN NULL ELSE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  v_patron_ciudad := CASE WHEN v_ciudad IS NULL THEN NULL ELSE '%' || replace(replace(replace(v_ciudad, '\', '\\'), '%', '\%'), '_', '\_') || '%' END;

  SELECT count(*)::int INTO v_total
    FROM public.cold_lead_banco b
   WHERE (v_todas OR b.lead_id IS NULL)
     AND (v_tramo = 'D' OR (coalesce(b.nivel, 0) <> 4 AND upper(left(coalesce(b.tramo, ''), 1)) <> 'D'))
     AND (v_nivel IS NULL OR b.nivel = v_nivel)
     AND (v_tramo IS NULL OR upper(left(coalesce(b.tramo, ''), 1)) = v_tramo OR (v_tramo = 'AB' AND upper(left(coalesce(b.tramo, ''), 1)) IN ('A', 'B')))
     AND (v_empresa IS NULL OR (v_empresa = 'sin_tipo' AND b.tipo_empresa IS NULL) OR b.tipo_empresa = v_empresa)
     AND (v_categoria IS NULL OR coalesce(b.categoria_grupo, 'Sin categoría') = v_categoria)
     AND (v_plataforma IS NULL OR coalesce(b.plataforma, 'Sin plataforma') = v_plataforma)
     AND (v_patron_ciudad IS NULL OR b.ciudad ILIKE v_patron_ciudad)
     AND (NOT v_tel OR NULLIF(btrim(coalesce(b.telefono, '')), '') IS NOT NULL)
     AND (NOT v_mail OR NULLIF(btrim(coalesce(b.email, '')), '') IS NOT NULL)
     AND (NOT v_dec OR NULLIF(btrim(coalesce(b.decisor, '')), '') IS NOT NULL)
     AND (v_ventas IS NULL OR b.ventas_mes_usd >= v_ventas)
     AND (v_patron IS NULL OR b.tienda ILIKE v_patron OR b.razon_social ILIKE v_patron OR b.dominio ILIKE v_patron OR b.ciudad ILIKE v_patron);

  WITH sel AS (
    SELECT b.*
      FROM public.cold_lead_banco b
     WHERE (v_todas OR b.lead_id IS NULL)
       AND (v_tramo = 'D' OR (coalesce(b.nivel, 0) <> 4 AND upper(left(coalesce(b.tramo, ''), 1)) <> 'D'))
       AND (v_nivel IS NULL OR b.nivel = v_nivel)
       AND (v_tramo IS NULL OR upper(left(coalesce(b.tramo, ''), 1)) = v_tramo OR (v_tramo = 'AB' AND upper(left(coalesce(b.tramo, ''), 1)) IN ('A', 'B')))
       AND (v_empresa IS NULL OR (v_empresa = 'sin_tipo' AND b.tipo_empresa IS NULL) OR b.tipo_empresa = v_empresa)
       AND (v_categoria IS NULL OR coalesce(b.categoria_grupo, 'Sin categoría') = v_categoria)
       AND (v_plataforma IS NULL OR coalesce(b.plataforma, 'Sin plataforma') = v_plataforma)
       AND (v_patron_ciudad IS NULL OR b.ciudad ILIKE v_patron_ciudad)
       AND (NOT v_tel OR NULLIF(btrim(coalesce(b.telefono, '')), '') IS NOT NULL)
       AND (NOT v_mail OR NULLIF(btrim(coalesce(b.email, '')), '') IS NOT NULL)
       AND (NOT v_dec OR NULLIF(btrim(coalesce(b.decisor, '')), '') IS NOT NULL)
       AND (v_ventas IS NULL OR b.ventas_mes_usd >= v_ventas)
       AND (v_patron IS NULL OR b.tienda ILIKE v_patron OR b.razon_social ILIKE v_patron OR b.dominio ILIKE v_patron OR b.ciudad ILIKE v_patron)
     ORDER BY b.nivel ASC NULLS LAST, b.ventas_mes_usd DESC NULLS LAST, b.dominio
     LIMIT v_limite OFFSET greatest(coalesce(p_desde, 0), 0)
  )
  SELECT CASE WHEN p_solo_dominios
              THEN jsonb_build_object('total', v_total, 'dominios', coalesce((SELECT jsonb_agg(dominio) FROM sel), '[]'::jsonb))
              ELSE jsonb_build_object('total', v_total, 'filas', coalesce((
                     SELECT jsonb_agg(jsonb_build_object(
                       'dominio', s.dominio, 'tienda', s.tienda, 'ciudad', s.ciudad, 'categoria', coalesce(s.categoria_grupo, 'Sin categoría'), 'nivel', s.nivel,
                       'tramo', s.tramo, 'ventas', s.ventas_mes_usd, 'productos', s.n_productos, 'anios', s.anios, 'plataforma', s.plataforma,
                       'tipo_empresa', s.tipo_empresa, 'razon_social', s.razon_social, 'decisor', s.decisor,
                       'telefono', NULLIF(btrim(coalesce(s.telefono, '')), '') IS NOT NULL, 'email', NULLIF(btrim(coalesce(s.email, '')), '') IS NOT NULL,
                       'repartida', s.lead_id IS NOT NULL, 'lista', s.anadido_a
                     )) FROM sel s), '[]'::jsonb))
         END
    INTO v_salida;
  RETURN v_salida;
END $$;

-- Los últimos movimientos, para el historial
CREATE OR REPLACE FUNCTION public.cold_movimientos_recientes(p_limite INTEGER DEFAULT 40)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT m.id, m.usuario, m.accion, m.n, m.lista_origen, m.lista_destino, m.cambia_lista, m.cambia_dueno, m.dueno_destino, m.deshecho_at, m.created_at,
             (m.accion IN ('mover', 'asignar', 'mover_asignar', 'asignar_lista', 'anadir_del_banco') AND m.deshecho_at IS NULL AND m.n > 0
                AND m.created_at >= now() - interval '14 days') AS se_puede_deshacer
        FROM public.cold_lead_movimientos m
       ORDER BY m.created_at DESC
       LIMIT least(greatest(coalesce(p_limite, 40), 1), 200)
    ) x
$$;


/* ------------------------------------------------------------------ */
/* 13) SOLO EL SERVIDOR PUEDE EJECUTARLAS                              */
/* ------------------------------------------------------------------ */

DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'puede_gestionar_listas', '_cold_nombre_de_lista', '_cold_exigir_gestor', '_cold_exigir_persona', '_cold_aplicar',
         'cold_lista_crear', 'cold_lista_renombrar', 'cold_lista_archivar', 'cold_leads_mover', 'cold_lista_responsable',
         'cold_leads_deshacer', 'cold_banco_anadir', 'cold_banco_enlazar', 'cold_listas_resumen', 'cold_leads_buscar', 'cold_banco_resumen',
         'cold_banco_buscar', 'cold_movimientos_recientes'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.firma);
  END LOOP;
END $$;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO enseña los NOTICE: lo que hay que leer sale en filas. Tienen que salir las tres tablas, las 14 funciones y las listas de hoy.
-- Si falta algo, la fila lo dice y el resto de columnas no importan.

SELECT 'tablas nuevas' AS comprobacion,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('cold_lead_lists', 'cold_lead_movimientos', 'cold_lead_banco'))::text || ' de 3' AS resultado
UNION ALL
SELECT 'funciones nuevas',
       (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN ('puede_gestionar_listas', 'cold_lista_crear', 'cold_lista_renombrar', 'cold_lista_archivar', 'cold_leads_mover',
               'cold_lista_responsable', 'cold_leads_deshacer', 'cold_banco_anadir', 'cold_banco_enlazar', 'cold_listas_resumen', 'cold_leads_buscar', 'cold_banco_resumen',
               'cold_banco_buscar', 'cold_movimientos_recientes'))::text || ' de 14'
UNION ALL
SELECT 'listas registradas', (SELECT count(*) FROM public.cold_lead_lists)::text
UNION ALL
SELECT 'leads sin lista', (SELECT count(*) FROM public.cold_leads WHERE NULLIF(btrim(source_list), '') IS NULL)::text
UNION ALL
SELECT 'puesto · ' || coalesce(p.puesto, 'sin puesto'),
       string_agg(coalesce(p.full_name, p.email), ', ' ORDER BY coalesce(p.full_name, p.email))
  FROM public.profiles p
 WHERE p.role = 'employee'
 GROUP BY p.puesto;
