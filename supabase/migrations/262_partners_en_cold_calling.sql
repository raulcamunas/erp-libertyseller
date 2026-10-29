-- ============================================================================
-- 262 · UN TERCER TIPO DE LEAD EN COLD CALLING: LOS PARTNERS
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- NO borra, NO renombra y NO reescribe ninguna fila: los leads que ya hay (vendedores de
-- Amazon y tiendas online) siguen exactamente igual después de pegar esto.
--
-- Abre la línea de captación de PARTNERS: posibles socios que nos deriven clientes —agencias
-- de desarrollo ecommerce, empresas de fulfillment, registradores de marcas y gestorías—,
-- sacados de Google Maps (carpeta «Scraping Google Maps») y puntuados. El Excel de origen es
-- «Partners-ERP-4-segmentos.xlsx»: cuatro hojas con las MISMAS 16 columnas y 8.120 filas en total.
--
-- Un partner no es un cliente potencial, pero se trabaja igual que uno —se llama, se escribe,
-- se rellama, se apunta lo que se habló—, así que vive en `cold_leads` y tiene GRATIS todo el
-- seguimiento de siempre (estado, rellamada, historial, llamadas de Rinkel, correo, WhatsApp,
-- la vista de listas). Lo único que cambia es qué datos tiene y cómo se enseñan.
--
--
-- ============ QUÉ COLUMNAS DEL EXCEL SE REUTILIZAN Y CUÁLES SON NUEVAS ======
--
-- Se reutilizan las que significan LO MISMO (el comentario de la 204 explica por qué no se
-- recicla una columna que solo «suena» parecida; aquí no se ha hecho):
--
--   Empresa            -> store_name         (cómo se le conoce)
--   Razón social       -> company            (el nombre legal; vacío en 36–50 % de las filas)
--   Tipo               -> tipo_empresa       (Sociedad = 'sociedad'; «Persona física (no llamar
--                                             en frío)» = 'autonomo'; «Sin verificar» = NULL.
--                                             La Leyenda ya dice que un autónomo NO se llama en
--                                             frío, y es exactamente el mismo criterio)
--   Categoría Maps     -> category
--   Ciudad             -> ciudad
--   Teléfono           -> phone
--   Email              -> email
--   Web                -> web
--
-- Y son NUEVAS (ocho):
--
--   prioridad          1 «Llamar primero» · 2 «Segunda ronda» · 3 «Solo email» · 4 «Revisar
--                      (posible competencia)». Se guarda el NÚMERO y no la etiqueta, como `nivel`:
--                      con el texto entero no se ordena ni se filtra. NO se reutiliza `nivel`
--                      (1 a 3, de ventas estimadas de una tienda): son criterios distintos y la
--                      pantalla rotula cada uno a su manera.
--   puntos             La puntuación de la captación (16 a 90 en el Excel). Desempata dentro de
--                      una prioridad.
--   resenas, rating    Lo que dice Google Maps de ellos. `rating` NUMERIC(2,1): 4.8, 5.0.
--   menciona_amazon    Su web habla de Amazon. NO es `vende_en_amazon`: aquella columna dice si
--                      el LEAD vende en Amazon y decide el discurso de la llamada; ésta es una
--                      señal buena de un partner (ya conoce el canal) y a un partner no se le
--                      pregunta si vende.
--   linkedin           Su LinkedIn. (La 204 tiene `instagram`, no esto.)
--   google_maps_url    Su ficha en Google Maps. ES LA CLAVE DE DEDUPLICACIÓN (índice de abajo):
--                      cada negocio de Maps tiene una dirección distinta y las 8.120 del Excel
--                      son únicas. La web no sirve de clave: trae parámetros de seguimiento
--                      (utm_source…) y a veces falta.
--   busquedas_origen   Con qué búsquedas de Maps se encontró («agencia Shopify, diseño tiendas
--                      online»). Sirve para entender por qué está en la lista.
--
-- La hoja del Excel (el SEGMENTO) NO tiene columna: es la LISTA (`source_list`), una por hoja:
--   «Partners - Agencias ecommerce» · «Partners - Fulfillment» · «Partners - Registro de marcas» ·
--   «Partners - Gestorías». Así la pantalla de Listas ya los reparte y asigna como cualquier otra.
--
--
-- ============ POR QUÉ EL CHECK DE `tipo_lead` SE VUELVE A ESCRIBIR ============
--
-- La 204 lo creó en línea (`ADD COLUMN ... CHECK (...)`), así que Postgres le puso el nombre
-- que quiso. Se buscan por su definición todos los CHECK de la tabla que hablen de `tipo_lead`
-- y se sustituyen por uno con nombre, que admite 'partner'. Añadir un cuarto tipo mañana será
-- cambiar ese CHECK y no buscar un nombre automático.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) EL TIPO                                                          */
/* ------------------------------------------------------------------ */

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.cold_leads'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%tipo_lead%'
  LOOP
    EXECUTE format('ALTER TABLE public.cold_leads DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.cold_leads
    ADD CONSTRAINT cold_leads_tipo_lead_check
    CHECK (tipo_lead IN ('seller_amazon', 'tienda_online', 'partner'));
END $$;

COMMENT ON COLUMN public.cold_leads.tipo_lead IS
  'Qué clase de lead es, y de ello depende qué bloques pinta la ficha. seller_amazon: ya vende en Amazon. tienda_online: tienda que todavía NO vende en Amazon (Excel «Tiendas por sectores»). partner: posible socio que nos derive clientes —agencia de desarrollo ecommerce, fulfillment, registro de marcas, gestoría— del Excel «Partners» (migración 262); no vende ni deja de vender en Amazon y no tiene facturación. NO usar source_list para esto: es texto libre.';


/* ------------------------------------------------------------------ */
/* 2) LOS DATOS DE UN PARTNER                                          */
/* ------------------------------------------------------------------ */

ALTER TABLE public.cold_leads
  ADD COLUMN IF NOT EXISTS prioridad SMALLINT CHECK (prioridad IS NULL OR prioridad BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS puntos SMALLINT CHECK (puntos IS NULL OR puntos BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS resenas INTEGER CHECK (resenas IS NULL OR resenas >= 0),
  ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS menciona_amazon BOOLEAN,
  ADD COLUMN IF NOT EXISTS linkedin TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT,
  ADD COLUMN IF NOT EXISTS busquedas_origen TEXT;

COMMENT ON COLUMN public.cold_leads.prioridad IS
  'Solo partners. Columna «Prioridad» del Excel, solo el número: 1 llamar primero (con teléfono y correo), 2 segunda ronda, 3 solo email (sin teléfono o persona física: no se llama en frío), 4 revisar (posible competencia). Es el orden de trabajo de la lista. NO es `nivel`, que es de las tiendas online.';
COMMENT ON COLUMN public.cold_leads.puntos IS
  'Solo partners. Puntuación de la captación (16 a 90 en el Excel). Dentro de una prioridad, más puntos va antes. NUNCA se ordena por los puntos solos: hay prioridades 3 y 4 con más puntos que algunas 2.';
COMMENT ON COLUMN public.cold_leads.resenas IS
  'Solo partners. Número de reseñas en Google Maps.';
COMMENT ON COLUMN public.cold_leads.rating IS
  'Solo partners. Valoración media en Google Maps (1 a 5, un decimal). Vacía en una quinta parte: los negocios sin reseñas no tienen valoración.';
COMMENT ON COLUMN public.cold_leads.menciona_amazon IS
  'Solo partners. Su web menciona Amazon: un partner que ya conoce el canal. NO es `vende_en_amazon` (si el lead vende en Amazon): a un partner no se le hace esa pregunta.';
COMMENT ON COLUMN public.cold_leads.linkedin IS
  'Solo partners. Dirección de su LinkedIn (vacía en más de la mitad). Se enseña como enlace solo si es http o https.';
COMMENT ON COLUMN public.cold_leads.google_maps_url IS
  'Solo partners. Su ficha en Google Maps. Es la clave de deduplicación de esta línea (ux_cold_leads_partner_maps): cada negocio tiene una distinta, y la web no sirve de clave porque trae parámetros de seguimiento.';
COMMENT ON COLUMN public.cold_leads.busquedas_origen IS
  'Solo partners. Las búsquedas de Google Maps con las que se encontró, separadas por comas. Explica por qué está en su lista.';


/* ------------------------------------------------------------------ */
/* 3) DEDUPLICACIÓN Y ORDEN                                            */
/* ------------------------------------------------------------------ */
--
-- Parcial a tipo_lead='partner' para no imponer nada a los demás leads. Una subida que se
-- quede a medias y se repita FALLA en vez de duplicar (el script de carga ya salta los que
-- existen; esto es la red de seguridad).

CREATE UNIQUE INDEX IF NOT EXISTS ux_cold_leads_partner_maps
  ON public.cold_leads (google_maps_url)
  WHERE tipo_lead = 'partner' AND google_maps_url IS NOT NULL;

-- El orden de trabajo: primero la prioridad y, dentro de ella, los que más puntos tienen.
CREATE INDEX IF NOT EXISTS idx_cold_leads_partner_prioridad
  ON public.cold_leads (prioridad, puntos DESC)
  WHERE tipo_lead = 'partner';


/* ------------------------------------------------------------------ */
/* 4) CÓMO SE DESHACE UNA CARGA                                        */
/* ------------------------------------------------------------------ */
--
-- Queda escrito aquí y COMENTADO a propósito (es lo que alguien busca con prisa cuando una
-- subida sale mal). Descomentar solo la lista que haya que rehacer:
--
--   DELETE FROM public.cold_leads
--    WHERE tipo_lead = 'partner'
--      AND source_list = 'Partners - Gestorías';
--
-- El DELETE arrastra en cascada las notas de ESOS leads (cold_lead_notes.lead_id es ON DELETE
-- CASCADE). Antes de lanzarlo, mirar si alguien ya había apuntado algo:
--
--   SELECT count(*) FROM public.cold_lead_notes n
--     JOIN public.cold_leads l ON l.id = n.lead_id
--    WHERE l.tipo_lead = 'partner';


/* ------------------------------------------------------------------ */
/* 5) QUÉ HA PASADO DE VERDAD                                          */
/* ------------------------------------------------------------------ */

DO $$
DECLARE
  faltan   TEXT := '';
  col      TEXT;
  nuevas   TEXT[] := ARRAY['prioridad', 'puntos', 'resenas', 'rating', 'menciona_amazon', 'linkedin', 'google_maps_url', 'busquedas_origen'];
  vendedores INTEGER;
  tiendas    INTEGER;
  partners   INTEGER;
BEGIN
  FOREACH col IN ARRAY nuevas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cold_leads' AND column_name = col
    ) THEN
      faltan := faltan || col || ' ';
    END IF;
  END LOOP;

  IF faltan <> '' THEN
    RAISE EXCEPTION '262 · faltan columnas por crear: %. Revisa el error de arriba.', faltan;
  END IF;

  -- El CHECK nuevo tiene que admitir 'partner' de verdad
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cold_leads'::regclass AND contype = 'c'
       AND conname = 'cold_leads_tipo_lead_check'
       AND pg_get_constraintdef(oid) ILIKE '%partner%'
  ) THEN
    RAISE EXCEPTION '262 · el CHECK de tipo_lead no admite ''partner''. Revisa el error de arriba.';
  END IF;

  SELECT count(*) FILTER (WHERE tipo_lead = 'seller_amazon'),
         count(*) FILTER (WHERE tipo_lead = 'tienda_online'),
         count(*) FILTER (WHERE tipo_lead = 'partner')
    INTO vendedores, tiendas, partners
    FROM public.cold_leads;

  RAISE NOTICE '262 · 8 columnas nuevas listas y ''partner'' admitido como tipo. Ni una fila tocada.';
  RAISE NOTICE '262 · leads por tipo: % vendedores de Amazon, % tiendas online, % partners (hasta que se cargue el Excel, 0).', vendedores, tiendas, partners;
  RAISE NOTICE '262 · siguiente paso: python3 scripts/cargar-partners.py --comprobar y luego --si (carga las cuatro listas del Excel y se las asigna a quien se diga).';
END $$;
