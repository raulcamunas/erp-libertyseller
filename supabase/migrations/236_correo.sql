-- ============================================================================
-- 236 · CORREO: EL WEBMAIL DENTRO DEL ERP
-- ============================================================================
--
-- Los comerciales trabajan con buzones de Hostinger. Con esto cada uno conecta el SUYO al ERP pegando su
-- contraseña —igual que la clave de Rinkel en «Mi rendimiento»— y desde aquí lee, contesta y envía correos,
-- con sus hilos, su búsqueda y sus adjuntos. Quien supervisa al equipo puede mirar los buzones de los
-- comerciales, en solo lectura y dejando rastro de cada vez que lo hace.
--
--   · `correo_buzones`      Un buzón conectado: de quién es, a qué servidores se conecta y cómo va la lectura.
--   · `correo_credenciales` LA CONTRASEÑA de cada buzón, CIFRADA (AES-256-GCM, con la clave del servidor).
--                           Cerrada al navegador y nunca devuelta a nadie.
--   · `correo_carpetas`     Las dos carpetas que se leen de cada buzón (Entrada y Enviados) y su UIDVALIDITY.
--   · `correo_hilos`        Una conversación: los mensajes que cuelgan del mismo hilo, con sus contadores.
--   · `correo_mensajes`     Cada correo, con el texto ya limpio. Los ADJUNTOS no se copian: se piden al
--                           servidor de correo en el momento de descargarlos (aquí solo queda su ficha).
--   · `correo_accesos`      Quién ha mirado el buzón de otra persona, qué y cuándo. Lo ve el dueño del buzón.
--
--
-- ============ POR QUÉ TODO ESTÁ CERRADO AL NAVEGADOR ============
--
-- A diferencia de `rinkel_llamadas` (que se lee con una política «cada uno ve lo suyo y quien supervisa lo de
-- todos»), aquí NINGUNA tabla tiene políticas: el navegador no lee nada directamente. Un correo es lo más
-- sensible que guarda el ERP y la regla de quién puede abrirlo no cabe en una política:
--
--   · el administrador abre cualquier buzón;
--   · quien tenga la casilla «Supervisión del equipo comercial» abre solo los de los COMERCIALES (no el de un
--     administrador ni el de nadie que no sea del equipo comercial). Un partner no abre ninguno: es una figura
--     externa y no entra en esta pantalla;
--   · escribir solo puede el dueño;
--   · cada vez que alguien mira un buzón que no es el suyo queda una fila en `correo_accesos`.
--
-- Todo eso lo hace el servidor (app/api/correo/*), con la clave de servicio. Aquí solo se cierra la puerta.
--
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- El código funciona sin esta migración: la pantalla de Correo avisa de que falta lanzarla y nada más se rompe.
-- ============================================================================


-- ---------- Cada buzón conectado ----------
CREATE TABLE IF NOT EXISTS public.correo_buzones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- La dirección, siempre en minúsculas. UNIQUE: el mismo buzón conectado por dos personas se leería dos
  -- veces y cada correo saldría duplicado en el recuento del equipo
  direccion TEXT NOT NULL,
  -- Cómo firma el remitente («Ana López»)
  nombre TEXT,
  -- Con qué usuario se entra a IMAP y SMTP. En Hostinger y Titan es la propia dirección
  usuario TEXT NOT NULL,

  -- 'hostinger', 'titan' o 'personalizado'. Sin CHECK a propósito: solo sirve para escoger la ayuda en pantalla
  proveedor TEXT NOT NULL DEFAULT 'personalizado',
  imap_host TEXT NOT NULL,
  imap_puerto INTEGER NOT NULL DEFAULT 993 CHECK (imap_puerto BETWEEN 1 AND 65535),
  -- true = TLS directo (993); false = STARTTLS obligatorio (143). Nunca sin cifrar
  imap_seguro BOOLEAN NOT NULL DEFAULT true,
  smtp_host TEXT NOT NULL,
  smtp_puerto INTEGER NOT NULL DEFAULT 465 CHECK (smtp_puerto BETWEEN 1 AND 65535),
  smtp_seguro BOOLEAN NOT NULL DEFAULT true,

  -- Hasta qué fecha atrás se importa. Lo anterior se queda en el servidor y no entra al ERP
  desde_fecha TIMESTAMPTZ NOT NULL,
  -- Texto que se pone debajo de los correos nuevos (el comercial lo ve y lo puede cambiar al escribir)
  firma TEXT,

  vinculado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_sync_at TIMESTAMPTZ,
  ultimo_intento_at TIMESTAMPTZ,
  -- Una frase nuestra (nunca la respuesta del servidor). NULL = la última lectura salió bien
  ultimo_error TEXT,
  fallos_seguidos INTEGER NOT NULL DEFAULT 0 CHECK (fallos_seguidos >= 0),
  -- true cuando el servidor rechazó la contraseña. Se deja de intentar hasta que la persona la vuelva a poner:
  -- seguir probando con una contraseña mala acaba bloqueando la cuenta en el proveedor
  credenciales_invalidas BOOLEAN NOT NULL DEFAULT false,
  -- true cuando ya se ha leído todo lo que cabe en `desde_fecha`
  historico_completo BOOLEAN NOT NULL DEFAULT false,
  -- Reserva de la lectura: mientras sea futura, nadie más lee este buzón (una lectura que muere a mitad
  -- libera la reserva sola al caducar)
  lectura_hasta TIMESTAMPTZ,

  CONSTRAINT correo_buzones_direccion_minusculas CHECK (direccion = lower(direccion)),
  CONSTRAINT correo_buzones_una_por_direccion UNIQUE (direccion)
);

CREATE INDEX IF NOT EXISTS correo_buzones_usuario_idx ON public.correo_buzones (user_id);

COMMENT ON TABLE public.correo_buzones IS
  'Buzones de correo conectados al ERP (IMAP/SMTP). Cerrada al navegador: se lee solo desde el servidor, que decide quien puede abrir cada buzon (el dueno, el admin, y quien supervisa a los comerciales).';

ALTER TABLE public.correo_buzones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_buzones FROM anon, authenticated;


-- ---------- La contraseña de cada buzón, cifrada ----------
CREATE TABLE IF NOT EXISTS public.correo_credenciales (
  buzon_id UUID PRIMARY KEY REFERENCES public.correo_buzones(id) ON DELETE CASCADE,

  -- Cifrada en el servidor antes de llegar aquí (lib/amazon/crypto.ts). Sin la clave de cifrado, que vive en el
  -- entorno del contenedor y no en la base, no sirve de nada. No se guarda ninguna huella de la contraseña
  secreto_cifrado TEXT NOT NULL,

  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.correo_credenciales IS
  'Contrasena de cada buzon, CIFRADA. Cerrada al navegador (RLS sin politicas, permisos quitados): solo la lee el servidor, con la clave de servicio, para entrar al buzon. Sin fila aqui el buzon figura como desconectado.';

ALTER TABLE public.correo_credenciales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_credenciales FROM anon, authenticated;


-- ---------- Las carpetas que se leen ----------
CREATE TABLE IF NOT EXISTS public.correo_carpetas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,

  -- El nombre tal y como lo da el servidor («INBOX», «INBOX.Sent», «Enviados»…)
  ruta TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('entrada', 'enviados')),

  -- Si el servidor cambia este número, los UID que teníamos ya no valen y la carpeta se vuelve a emparejar
  uidvalidity BIGINT,
  ultimo_sync_at TIMESTAMPTZ,

  CONSTRAINT correo_carpetas_una_por_ruta UNIQUE (buzon_id, ruta),
  CONSTRAINT correo_carpetas_un_rol_por_buzon UNIQUE (buzon_id, rol)
);

COMMENT ON TABLE public.correo_carpetas IS
  'Carpetas de cada buzon que se leen (entrada y enviados) y su UIDVALIDITY. Cerrada al navegador.';

ALTER TABLE public.correo_carpetas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_carpetas FROM anon, authenticated;


-- ---------- Los hilos ----------
CREATE TABLE IF NOT EXISTS public.correo_hilos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,

  -- El asunto del primer correo del hilo, y ese mismo asunto sin «Re:», «Fwd:» ni mayúsculas, para
  -- emparejar respuestas de clientes de correo que no ponen las cabeceras de hilo
  asunto TEXT NOT NULL DEFAULT '',
  clave_asunto TEXT NOT NULL DEFAULT '',

  -- Las direcciones (en minúsculas, sin la del propio buzón) que han escrito o recibido algo en el hilo
  participantes TEXT[] NOT NULL DEFAULT '{}',

  primer_mensaje_at TIMESTAMPTZ NOT NULL,
  ultimo_mensaje_at TIMESTAMPTZ NOT NULL,

  mensajes INTEGER NOT NULL DEFAULT 0,
  entrantes INTEGER NOT NULL DEFAULT 0,
  salientes INTEGER NOT NULL DEFAULT 0,
  no_leidos INTEGER NOT NULL DEFAULT 0,
  tiene_adjuntos BOOLEAN NOT NULL DEFAULT false,

  -- Lo que se enseña en la lista: un trozo del último mensaje y con quién se habla
  vista_previa TEXT NOT NULL DEFAULT '',
  contraparte TEXT NOT NULL DEFAULT '',
  contraparte_direccion TEXT NOT NULL DEFAULT '',
  -- true = el último mensaje lo escribió una PERSONA del otro lado: el hilo está esperando respuesta nuestra.
  -- Un aviso automático (Amazon, una factura, un «no-reply») no cuenta: nadie espera que se le conteste
  ultimo_es_entrante BOOLEAN NOT NULL DEFAULT false,
  -- true = todo lo que ha llegado en este hilo es automático (avisos, boletines, notificaciones)
  automatico BOOLEAN NOT NULL DEFAULT false,

  destacado BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS correo_hilos_lista_idx
  ON public.correo_hilos (buzon_id, ultimo_mensaje_at DESC);

CREATE INDEX IF NOT EXISTS correo_hilos_sin_leer_idx
  ON public.correo_hilos (buzon_id, ultimo_mensaje_at DESC)
  WHERE no_leidos > 0;

CREATE INDEX IF NOT EXISTS correo_hilos_asunto_idx
  ON public.correo_hilos (buzon_id, clave_asunto)
  WHERE clave_asunto <> '';

CREATE INDEX IF NOT EXISTS correo_hilos_participantes_idx
  ON public.correo_hilos USING GIN (participantes);

COMMENT ON TABLE public.correo_hilos IS
  'Conversaciones de cada buzon, con los contadores que pinta la lista (mensajes, no leidos, adjuntos, vista previa). Se recalculan con correo_actualizar_hilo. Cerrada al navegador.';

ALTER TABLE public.correo_hilos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_hilos FROM anon, authenticated;


-- ---------- Los mensajes ----------
CREATE TABLE IF NOT EXISTS public.correo_mensajes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,
  hilo_id UUID NOT NULL REFERENCES public.correo_hilos(id) ON DELETE CASCADE,
  carpeta_id UUID NOT NULL REFERENCES public.correo_carpetas(id) ON DELETE CASCADE,

  -- El UID del mensaje en su carpeta del servidor. NULL = un correo enviado desde aquí que el servidor aún no
  -- nos ha confirmado (se empareja por Message-ID en la siguiente lectura de Enviados)
  uid BIGINT,

  -- Las cabeceras que dicen de qué conversación es, sin los < > y en minúsculas
  message_id TEXT,
  en_respuesta_a TEXT,
  referencias TEXT[] NOT NULL DEFAULT '{}',

  -- Desde el punto de vista del buzón: lo que llega o lo que sale
  direccion TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  de_nombre TEXT,
  de_direccion TEXT NOT NULL DEFAULT '',
  -- [{"nombre": "Ana", "direccion": "ana@cliente.es"}, …]
  para JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Las mismas personas en una sola línea de texto, para poder buscar por ellas
  destinatarios TEXT NOT NULL DEFAULT '',
  -- A quién hay que contestar si no es a quien lo envía (la cabecera Reply-To). Los avisos de un formulario
  -- web llegan «de» la web y se contestan al cliente que lo rellenó: [{"nombre": "…", "direccion": "…"}]
  responder_a JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- true = lo ha enviado una máquina (Auto-Submitted, Precedence: bulk, List-Id, «no-reply»…)
  automatico BOOLEAN NOT NULL DEFAULT false,

  asunto TEXT NOT NULL DEFAULT '',
  fecha TIMESTAMPTZ NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  -- El HTML YA LIMPIO (sin scripts, sin formularios, sin estilos que se salgan de su sitio). NULL = solo texto
  html TEXT,
  vista_previa TEXT NOT NULL DEFAULT '',

  leido BOOLEAN NOT NULL DEFAULT false,
  -- [{"nombre": "oferta.pdf", "tipo": "application/pdf", "tamano": 48213, "n": 0}, …]
  -- El fichero NO está aquí: se vuelve a pedir el correo al servidor de correo y se saca el adjunto número `n`
  adjuntos JSONB NOT NULL DEFAULT '[]'::jsonb,
  tamano INTEGER,

  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Para buscar. Se recorta el texto: un tsvector no puede pasar de 1 MB y un correo largo lo rompería
  buscar TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'spanish',
      left(coalesce(asunto, ''), 500) || ' ' ||
      coalesce(de_nombre, '') || ' ' ||
      coalesce(de_direccion, '') || ' ' ||
      left(coalesce(destinatarios, ''), 500) || ' ' ||
      left(coalesce(texto, ''), 20000)
    )
  ) STORED,

  CONSTRAINT correo_mensajes_uid_por_carpeta UNIQUE (carpeta_id, uid)
);

CREATE INDEX IF NOT EXISTS correo_mensajes_hilo_idx
  ON public.correo_mensajes (hilo_id, fecha, creado_at);

CREATE INDEX IF NOT EXISTS correo_mensajes_message_id_idx
  ON public.correo_mensajes (buzon_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS correo_mensajes_respuesta_idx
  ON public.correo_mensajes (buzon_id, en_respuesta_a)
  WHERE en_respuesta_a IS NOT NULL;

CREATE INDEX IF NOT EXISTS correo_mensajes_referencias_idx
  ON public.correo_mensajes USING GIN (referencias);

CREATE INDEX IF NOT EXISTS correo_mensajes_buscar_idx
  ON public.correo_mensajes USING GIN (buscar);

COMMENT ON TABLE public.correo_mensajes IS
  'Cada correo de cada buzon, con el texto y el HTML ya limpios. Los adjuntos no se copian: solo su ficha, y se piden al servidor de correo al descargarlos. Cerrada al navegador.';

ALTER TABLE public.correo_mensajes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_mensajes FROM anon, authenticated;


-- ---------- Quién ha mirado el buzón de otra persona ----------
CREATE TABLE IF NOT EXISTS public.correo_accesos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,

  -- Quien miró. SET NULL y no CASCADE: si esa persona se borra, el rastro de lo que miró no debe irse con ella
  usuario_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  usuario_nombre TEXT NOT NULL,

  -- 'lista', 'hilo', 'busqueda' o 'adjunto'
  accion TEXT NOT NULL,
  hilo_id UUID REFERENCES public.correo_hilos(id) ON DELETE SET NULL,
  -- El asunto en el momento de mirar, para que el rastro siga diciendo qué fue aunque el hilo desaparezca
  asunto TEXT,

  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS correo_accesos_buzon_idx
  ON public.correo_accesos (buzon_id, creado_at DESC);

COMMENT ON TABLE public.correo_accesos IS
  'Rastro de cada vez que alguien (admin o supervisor del equipo comercial) ha mirado un buzon que no es suyo. Solo lo escribe el servidor; el dueno del buzon puede consultarlo desde Correo. Cerrada al navegador.';

ALTER TABLE public.correo_accesos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_accesos FROM anon, authenticated;


-- ============================================================================
-- FUNCIONES · solo las llama el servidor (clave de servicio)
-- ============================================================================

-- ---------- ¿A qué hilos pertenece un correo? ----------
--
-- Recibe los Message-ID que le importan a un correo nuevo (el suyo, aquel al que responde y los de su cadena
-- de References) y devuelve los hilos del buzón donde ya hay algo emparejado, EN LOS DOS SENTIDOS:
--
--   · un mensaje que YA tenemos y que es ancestro del nuevo (el nuevo lo cita);
--   · un mensaje que YA tenemos y que cita al nuevo (la respuesta llegó antes que el original). Esto pasa
--     siempre en la primera importación, que empieza por lo más reciente.
--
-- Puede devolver varios hilos: es el caso en que el nuevo correo une dos conversaciones que se creían distintas,
-- y el servidor las fusiona.
CREATE OR REPLACE FUNCTION public.correo_buscar_hilos(p_buzon UUID, p_ids TEXT[])
RETURNS TABLE (hilo_id UUID)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT m.hilo_id
  FROM public.correo_mensajes m
  WHERE m.buzon_id = p_buzon
    AND p_ids IS NOT NULL
    AND cardinality(p_ids) > 0
    AND (
      m.message_id = ANY (p_ids)
      OR m.en_respuesta_a = ANY (p_ids)
      OR m.referencias && p_ids
    );
$$;

COMMENT ON FUNCTION public.correo_buscar_hilos(UUID, TEXT[]) IS
  'Hilos de un buzon donde ya hay un mensaje emparejado con alguno de estos Message-ID, en los dos sentidos (el que cita y el citado).';


-- ---------- Recalcular los contadores de un hilo ----------
--
-- Se llama después de añadir, mover o marcar mensajes. El hilo se vuelve a calcular entero desde sus
-- mensajes: no se llevan cuentas incrementales que acaben descuadradas.
CREATE OR REPLACE FUNCTION public.correo_actualizar_hilo(p_hilo UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_propia TEXT;
  v_participantes TEXT[];
BEGIN
  SELECT b.direccion INTO v_propia
  FROM public.correo_hilos h
  JOIN public.correo_buzones b ON b.id = h.buzon_id
  WHERE h.id = p_hilo;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x.a ORDER BY x.a), '{}')
    INTO v_participantes
  FROM (
    SELECT lower(m.de_direccion) AS a
    FROM public.correo_mensajes m
    WHERE m.hilo_id = p_hilo
    UNION
    SELECT lower(e ->> 'direccion')
    FROM public.correo_mensajes m, LATERAL jsonb_array_elements(m.para || m.cc) e
    WHERE m.hilo_id = p_hilo
  ) x
  WHERE x.a IS NOT NULL AND x.a <> '' AND x.a <> v_propia;

  UPDATE public.correo_hilos h SET
    asunto = COALESCE(NULLIF(agg.asunto, ''), h.asunto),
    participantes = v_participantes,
    primer_mensaje_at = agg.primero,
    ultimo_mensaje_at = agg.ultimo,
    mensajes = agg.mensajes,
    entrantes = agg.entrantes,
    salientes = agg.salientes,
    no_leidos = agg.no_leidos,
    tiene_adjuntos = agg.con_adjuntos,
    vista_previa = ult.vista_previa,
    ultimo_es_entrante = (ult.direccion = 'entrante' AND NOT ult.automatico),
    automatico = agg.todo_automatico,
    contraparte = CASE
      WHEN ult.direccion = 'entrante'
        THEN COALESCE(NULLIF(ult.de_nombre, ''), ult.de_direccion, '')
      ELSE COALESCE(NULLIF(ult.para -> 0 ->> 'nombre', ''), ult.para -> 0 ->> 'direccion', '')
    END,
    contraparte_direccion = CASE
      WHEN ult.direccion = 'entrante' THEN COALESCE(ult.de_direccion, '')
      ELSE COALESCE(ult.para -> 0 ->> 'direccion', '')
    END
  FROM (
    SELECT
      (array_agg(m.asunto ORDER BY m.fecha ASC, m.creado_at ASC))[1] AS asunto,
      min(m.fecha) AS primero,
      max(m.fecha) AS ultimo,
      count(*)::INTEGER AS mensajes,
      (count(*) FILTER (WHERE m.direccion = 'entrante'))::INTEGER AS entrantes,
      (count(*) FILTER (WHERE m.direccion = 'saliente'))::INTEGER AS salientes,
      (count(*) FILTER (WHERE NOT m.leido))::INTEGER AS no_leidos,
      COALESCE(bool_or(jsonb_array_length(m.adjuntos) > 0), false) AS con_adjuntos,
      -- Solo cuenta lo que llega: lo que enviamos nosotros no hace «automático» un hilo. Sin nada que llegue, no lo es
      COALESCE(bool_and(m.automatico) FILTER (WHERE m.direccion = 'entrante'), false) AS todo_automatico
    FROM public.correo_mensajes m
    WHERE m.hilo_id = p_hilo
  ) agg,
  LATERAL (
    SELECT m.vista_previa, m.direccion, m.automatico, m.de_nombre, m.de_direccion, m.para
    FROM public.correo_mensajes m
    WHERE m.hilo_id = p_hilo
    ORDER BY m.fecha DESC, m.creado_at DESC
    LIMIT 1
  ) ult
  WHERE h.id = p_hilo AND agg.mensajes > 0;
END;
$$;

COMMENT ON FUNCTION public.correo_actualizar_hilo(UUID) IS
  'Recalcula desde sus mensajes los contadores y datos de lista de un hilo (asunto, participantes, fechas, no leidos, adjuntos, vista previa, con quien se habla y si espera respuesta).';


-- ---------- Unir hilos ----------
--
-- Cuando un correo demuestra que dos conversaciones eran la misma, todo se pasa al hilo `p_destino`
-- (el más antiguo, que lo escoge el servidor) y los otros desaparecen.
CREATE OR REPLACE FUNCTION public.correo_fusionar_hilos(p_destino UUID, p_origenes UUID[])
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_destacado BOOLEAN;
BEGIN
  IF p_origenes IS NULL OR cardinality(p_origenes) = 0 THEN
    RETURN;
  END IF;

  -- Solo se fusiona dentro del mismo buzón: un id de otro buzón se ignora
  SELECT bool_or(h.destacado) INTO v_destacado
  FROM public.correo_hilos h
  WHERE h.id = ANY (p_origenes)
    AND h.id <> p_destino
    AND h.buzon_id = (SELECT d.buzon_id FROM public.correo_hilos d WHERE d.id = p_destino);

  UPDATE public.correo_mensajes m
  SET hilo_id = p_destino
  WHERE m.hilo_id = ANY (p_origenes)
    AND m.hilo_id <> p_destino
    AND m.buzon_id = (SELECT d.buzon_id FROM public.correo_hilos d WHERE d.id = p_destino);

  DELETE FROM public.correo_hilos h
  WHERE h.id = ANY (p_origenes)
    AND h.id <> p_destino
    AND h.buzon_id = (SELECT d.buzon_id FROM public.correo_hilos d WHERE d.id = p_destino)
    AND NOT EXISTS (SELECT 1 FROM public.correo_mensajes m WHERE m.hilo_id = h.id);

  IF v_destacado IS TRUE THEN
    UPDATE public.correo_hilos SET destacado = true WHERE id = p_destino;
  END IF;

  PERFORM public.correo_actualizar_hilo(p_destino);
END;
$$;

COMMENT ON FUNCTION public.correo_fusionar_hilos(UUID, UUID[]) IS
  'Pasa todos los mensajes de los hilos de origen al hilo destino (del mismo buzon), borra los origenes que quedan vacios y recalcula el destino.';


-- ---------- Buscar ----------
--
-- Devuelve los hilos del buzón con algún mensaje que case con lo escrito: por palabras (asunto, remitente,
-- destinatarios y texto) o por un trozo de dirección o de asunto.
CREATE OR REPLACE FUNCTION public.correo_buscar(p_buzon UUID, p_q TEXT, p_limite INTEGER DEFAULT 50)
RETURNS TABLE (hilo_id UUID, ultimo_mensaje_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH q AS (
    SELECT
      websearch_to_tsquery('spanish', COALESCE(p_q, '')) AS consulta,
      '%' || replace(replace(replace(lower(COALESCE(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS patron
  )
  SELECT h.id, h.ultimo_mensaje_at
  FROM public.correo_hilos h, q
  WHERE h.buzon_id = p_buzon
    AND length(trim(COALESCE(p_q, ''))) > 0
    AND EXISTS (
      SELECT 1
      FROM public.correo_mensajes m
      WHERE m.hilo_id = h.id
        AND (
          m.buscar @@ q.consulta
          OR lower(m.asunto) LIKE q.patron
          OR lower(m.de_direccion) LIKE q.patron
          OR lower(m.destinatarios) LIKE q.patron
        )
    )
  ORDER BY h.ultimo_mensaje_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
$$;

COMMENT ON FUNCTION public.correo_buscar(UUID, TEXT, INTEGER) IS
  'Hilos de un buzon con algun mensaje que case con el texto buscado (palabras en espanol o trozo de direccion/asunto), del mas reciente al mas antiguo.';


-- ---------- Las cifras de cada buzón, de una vez ----------
CREATE OR REPLACE FUNCTION public.correo_resumen_buzones(p_buzones UUID[])
RETURNS TABLE (
  buzon_id UUID,
  hilos BIGINT,
  hilos_sin_leer BIGINT,
  sin_leer BIGINT,
  esperando_respuesta BIGINT,
  ultimo_mensaje_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    h.buzon_id,
    count(*),
    count(*) FILTER (WHERE h.no_leidos > 0),
    COALESCE(sum(h.no_leidos), 0)::BIGINT,
    count(*) FILTER (WHERE h.ultimo_es_entrante),
    max(h.ultimo_mensaje_at)
  FROM public.correo_hilos h
  -- Un hilo sin mensajes es uno recién creado cuyo mensaje aún no ha entrado (o no ha llegado a entrar): no cuenta
  WHERE h.buzon_id = ANY (p_buzones) AND h.mensajes > 0
  GROUP BY h.buzon_id;
$$;

COMMENT ON FUNCTION public.correo_resumen_buzones(UUID[]) IS
  'Para cada buzon: hilos, hilos con algo sin leer, mensajes sin leer, hilos que esperan respuesta y la fecha del ultimo mensaje.';


-- ---------- Los UID que ya tenemos de una carpeta ----------
--
-- La lectura pide al servidor los UID de lo que cae dentro de la fecha elegida y se queda con los que aún no
-- están aquí. Se devuelven de una vez, como un solo valor: una carpeta de veinte mil correos no cabe en las
-- 1.000 filas por respuesta que da la API, y paginarlo es justo donde se pierden filas sin avisar.
CREATE OR REPLACE FUNCTION public.correo_uids(p_carpeta UUID)
RETURNS BIGINT[]
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(m.uid), '{}')
  FROM public.correo_mensajes m
  WHERE m.carpeta_id = p_carpeta AND m.uid IS NOT NULL;
$$;

COMMENT ON FUNCTION public.correo_uids(UUID) IS
  'UID de los mensajes ya importados de una carpeta, en un solo array (sin el limite de filas de la API).';


-- Solo el servidor (clave de servicio) las ejecuta: el navegador no tiene nada que hacer con ellas
REVOKE ALL ON FUNCTION public.correo_buscar_hilos(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correo_actualizar_hilo(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correo_fusionar_hilos(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correo_buscar(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correo_resumen_buzones(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correo_uids(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.correo_buscar_hilos(UUID, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.correo_actualizar_hilo(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.correo_fusionar_hilos(UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.correo_buscar(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.correo_resumen_buzones(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.correo_uids(UUID) TO service_role;


-- ---------- La app «Correo» para los comerciales y para quien supervisa ----------
--
-- El menú solo enseña a un employee las apps que tenga en user_app_permissions (mismo caso que «Mi
-- rendimiento», migración 234). Un administrador no necesita fila.
INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
SELECT p.id, 'correo', true
FROM public.profiles p
WHERE p.is_comercial = true
   OR EXISTS (
        SELECT 1 FROM public.user_app_permissions up
        WHERE up.user_id = p.id AND up.app_id = 'equipo-comercial' AND up.can_access = true
      )
ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE (en la 212 un reparto se dio por bueno porque el único rastro
-- de que había fallado era uno). Lo que falle revienta con un error; lo que salga bien se lee en la fila de
-- abajo: `cerradas_al_navegador` tiene que decir «sí».
DO $$
DECLARE
  tablas INTEGER;
  funciones INTEGER;
BEGIN
  SELECT count(*) INTO tablas
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('correo_buzones', 'correo_credenciales', 'correo_carpetas', 'correo_hilos', 'correo_mensajes', 'correo_accesos');
  IF tablas <> 6 THEN
    RAISE EXCEPTION 'Faltan tablas del correo: hay % de 6.', tablas;
  END IF;

  SELECT count(*) INTO funciones
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('correo_buscar_hilos', 'correo_actualizar_hilo', 'correo_fusionar_hilos', 'correo_buscar', 'correo_resumen_buzones', 'correo_uids');
  IF funciones <> 6 THEN
    RAISE EXCEPTION 'Faltan funciones del correo: hay % de 6.', funciones;
  END IF;

  -- Lo que no puede pasar: que un correo o una contraseña se puedan leer desde el navegador
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name LIKE 'correo\_%'
      AND (has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT')
        OR has_table_privilege('anon', format('public.%I', t.table_name), 'SELECT'))
  ) THEN
    RAISE EXCEPTION 'Una tabla del correo se puede leer desde el navegador: NO se deja así.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'correo_mensajes' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'correo_mensajes no tiene activada la seguridad por filas.';
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'correo\_%')                         AS tablas_del_correo,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name LIKE 'correo\_%'
      AND (has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT')
        OR has_table_privilege('anon', format('public.%I', t.table_name), 'SELECT'))
  ) THEN 'NO' ELSE 'sí' END                                                                AS cerradas_al_navegador,
  (SELECT count(*) FROM public.user_app_permissions
    WHERE app_id = 'correo' AND can_access = true)                                         AS personas_con_la_app;
