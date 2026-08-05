-- =====================================================
-- MARKETING (Amazon Ads)
-- =====================================================
-- Sustituye el Notion de «Revisión semanal de campañas»: allí había una
-- página por cliente con una base de datos suelta, así que las métricas de
-- una semana no se podían comparar con las de la anterior ni había rastro
-- de qué se tocó.
--
-- El modelo aquí es una jerarquía cliente > semana > campaña > keyword, más
-- un diario de cambios aparte. La semana es la unidad de trabajo (el
-- especialista revisa cliente por cliente cada lunes) y también la unidad
-- del informe que se manda al cliente.

-- ---------- Clientes con campañas activas ----------
-- Deliberadamente independiente de treasury_clients: allí está quien
-- factura, aquí quien tiene publicidad. Se solapan pero no son lo mismo (hay
-- clientes que solo llevan gestión de cuenta), y atarlos con una FK obligaría
-- a dar de alta en tesorería a cualquiera que entre en una prueba de ads.
CREATE TABLE IF NOT EXISTS public.marketing_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  /** Único para que la semilla de abajo se pueda reejecutar sin duplicar */
  name TEXT NOT NULL UNIQUE,
  /** Hex con almohadilla; es el color con el que se distingue al cliente en toda la UI */
  color TEXT NOT NULL DEFAULT '#FF6600',
  /** Enlace directo a su Seller Central / Campaign Manager */
  amazon_seller_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_clients_active
  ON public.marketing_clients(is_active, position);

-- ---------- Semanas de revisión ----------
-- week_end se guarda en vez de calcularse porque alguna revisión puntual
-- abarca un tramo distinto de siete días (arranques de cuenta a mitad de
-- semana), y el informe tiene que enseñar el periodo real.
CREATE TABLE IF NOT EXISTS public.marketing_weeks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.marketing_clients(id) ON DELETE CASCADE,
  /** Lunes de la semana */
  week_start DATE NOT NULL,
  /** Domingo de la semana */
  week_end DATE NOT NULL,
  /** Texto ya formateado para la UI, ej «Semana 27 jul – 2 ago» */
  label TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'en_curso', 'hecho')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (week_end >= week_start),
  UNIQUE (client_id, week_start)
);

-- El UNIQUE de arriba ya deja un índice con client_id a la izquierda, así que
-- solo hace falta el de fecha para la vista «todas las semanas de este lunes».
CREATE INDEX IF NOT EXISTS idx_marketing_weeks_start
  ON public.marketing_weeks(week_start DESC);

-- ---------- Campañas ----------
-- Una fila = la foto de una campaña en una semana concreta, no la campaña en
-- sí. El nombre se repite semana tras semana a propósito: es lo que permite
-- comparar la misma campaña contra su semana anterior sin mantener un
-- catálogo aparte que habría que sincronizar a mano con Amazon.
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_id UUID NOT NULL REFERENCES public.marketing_weeks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 'sp_auto'
    CHECK (campaign_type IN ('sp_auto', 'sp_manual_exacta', 'sp_manual_frase', 'sp_manual_amplia', 'sb', 'sd')),
  status TEXT NOT NULL DEFAULT 'activa'
    CHECK (status IN ('activa', 'pausada', 'archivada')),
  daily_budget NUMERIC,
  -- Las métricas van sin DEFAULT 0: NULL significa «aún no volcado desde
  -- Amazon» y cero significa cero. En una revisión semanal esa diferencia
  -- importa, porque un cero real es motivo de pausar la campaña.
  impressions INTEGER,
  clicks INTEGER,
  orders INTEGER,
  spend NUMERIC,
  sales NUMERIC,
  -- Derivables de las anteriores, pero se guardan para poder pegar tal cual
  -- lo que reporta Amazon: sus porcentajes salen de un rango de atribución
  -- que no coincide con el de esta tabla y el cliente ve los suyos.
  ctr NUMERIC,
  cvr NUMERIC,
  acos NUMERIC,
  /** TACoS de la semana: gasto en ads sobre la facturación total, no solo la atribuida */
  tacos NUMERIC,
  review_status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (review_status IN ('pendiente', 'hecho')),
  notes TEXT,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_week
  ON public.marketing_campaigns(week_id, position);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_review
  ON public.marketing_campaigns(review_status);

-- Para cruzar la misma campaña entre semanas al pintar la evolución
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_name
  ON public.marketing_campaigns(name);

-- ---------- Palabras clave y pujas ----------
-- El trabajo real de la revisión: qué puja tiene cada término y a cuánto hay
-- que dejarla. `applied` separa lo decidido de lo ya tocado en Amazon, que es
-- lo que hoy se pierde en Notion.
CREATE TABLE IF NOT EXISTS public.marketing_keywords (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exacta'
    CHECK (match_type IN ('exacta', 'frase', 'amplia', 'auto', 'asin')),
  current_bid NUMERIC,
  /** La puja a la que se quiere llegar; mientras applied sea false es solo una propuesta */
  suggested_bid NUMERIC,
  action TEXT NOT NULL DEFAULT 'mantener'
    CHECK (action IN ('mantener', 'subir', 'bajar', 'pausar', 'negativizar', 'nueva')),
  /** Ya ejecutado en Seller Central */
  applied BOOLEAN NOT NULL DEFAULT false,
  impressions INTEGER,
  clicks INTEGER,
  orders INTEGER,
  spend NUMERIC,
  sales NUMERIC,
  acos NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_keywords_campaign
  ON public.marketing_keywords(campaign_id);

-- Índice parcial: la consulta que más se repite es «qué pujas quedan por
-- aplicar», y las aplicadas son la inmensa mayoría de la tabla con el tiempo.
CREATE INDEX IF NOT EXISTS idx_marketing_keywords_pending
  ON public.marketing_keywords(campaign_id)
  WHERE applied = false;

-- ---------- Diario de cambios ----------
-- Append-only: alimenta el informe de avance que se manda al cliente, así que
-- una fila no se edita nunca (por eso no lleva updated_at).
--
-- campaign_id y keyword_id se quedan en NULL si se borra a lo que apuntan, en
-- vez de arrastrar la fila: el informe tiene que seguir diciendo qué se hizo
-- aunque la campaña ya no exista. La semana sí cascadea porque es la unidad
-- del propio informe.
CREATE TABLE IF NOT EXISTS public.marketing_changes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_id UUID NOT NULL REFERENCES public.marketing_weeks(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  keyword_id UUID REFERENCES public.marketing_keywords(id) ON DELETE SET NULL,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  /** Sin CHECK a propósito: los tipos de cambio se amplían cada temporada y no compensa una migración por cada uno */
  change_type TEXT NOT NULL,
  description TEXT,
  before_value TEXT,
  after_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_changes_week
  ON public.marketing_changes(week_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_changes_campaign
  ON public.marketing_changes(campaign_id);

CREATE INDEX IF NOT EXISTS idx_marketing_changes_author
  ON public.marketing_changes(author_id);

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.update_marketing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_clients_updated ON public.marketing_clients;
CREATE TRIGGER trg_marketing_clients_updated
  BEFORE UPDATE ON public.marketing_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_marketing_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_weeks_updated ON public.marketing_weeks;
CREATE TRIGGER trg_marketing_weeks_updated
  BEFORE UPDATE ON public.marketing_weeks
  FOR EACH ROW EXECUTE FUNCTION public.update_marketing_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_campaigns_updated ON public.marketing_campaigns;
CREATE TRIGGER trg_marketing_campaigns_updated
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_marketing_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_keywords_updated ON public.marketing_keywords;
CREATE TRIGGER trg_marketing_keywords_updated
  BEFORE UPDATE ON public.marketing_keywords
  FOR EACH ROW EXECUTE FUNCTION public.update_marketing_updated_at();

-- ---------- RLS ----------
-- Aquí no vale is_admin_or_partner, que es lo que usan tesorería y nóminas:
-- quien hace la revisión semanal es el especialista de PPC y su rol es
-- 'employee'. Si se le deja fuera, el módulo no lo puede usar nadie que
-- trabaje en él.
--
-- Tampoco vale un USING (true): eso daría acceso a cualquier fila a cualquier
-- sesión autenticada, incluidos los roles que se añadan más adelante (un
-- portal de cliente, por ejemplo). Se enumeran los tres roles que hoy son
-- equipo interno y el resto entra sin permiso.
CREATE OR REPLACE FUNCTION public.is_marketing_team(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND role IN ('admin', 'partner', 'employee')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE public.marketing_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team manages marketing clients" ON public.marketing_clients;
CREATE POLICY "Team manages marketing clients"
  ON public.marketing_clients FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

DROP POLICY IF EXISTS "Team manages marketing weeks" ON public.marketing_weeks;
CREATE POLICY "Team manages marketing weeks"
  ON public.marketing_weeks FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

DROP POLICY IF EXISTS "Team manages marketing campaigns" ON public.marketing_campaigns;
CREATE POLICY "Team manages marketing campaigns"
  ON public.marketing_campaigns FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

DROP POLICY IF EXISTS "Team manages marketing keywords" ON public.marketing_keywords;
CREATE POLICY "Team manages marketing keywords"
  ON public.marketing_keywords FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

DROP POLICY IF EXISTS "Team manages marketing changes" ON public.marketing_changes;
CREATE POLICY "Team manages marketing changes"
  ON public.marketing_changes FOR ALL TO authenticated
  USING (public.is_marketing_team(auth.uid()))
  WITH CHECK (public.is_marketing_team(auth.uid()));

-- Realtime en las dos tablas que se editan a la vez desde varias pestañas
-- durante la revisión. Con guardia: añadir una tabla que ya está en la
-- publicación da error, y en el editor SQL de Supabase eso deshace la
-- migración entera.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_campaigns', 'marketing_keywords'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Los cuatro clientes que hoy están en Notion, con el color que ya usaban
-- allí para identificarlos. ON CONFLICT contra el UNIQUE del nombre para que
-- reejecutar la migración no los duplique ni pise un color cambiado a mano.
INSERT INTO public.marketing_clients (name, color, is_active, position)
VALUES
  ('Yo By Yolanda', '#EC4899', true, 1),
  ('Bodegas Valhalla', '#92400E', true, 2),
  ('Jamones Tapas Party', '#F97316', true, 3),
  ('Creative Toys', '#EF4444', true, 4)
ON CONFLICT (name) DO NOTHING;
