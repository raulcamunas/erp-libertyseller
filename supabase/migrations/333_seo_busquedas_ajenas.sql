-- ============================================================================
-- 333 · SEO TEST: LISTA FIJA DE BÚSQUEDAS AJENAS POR CUENTA Y PAÍS
-- ============================================================================
--
-- La heurística «¿Ajena?» (lib/seo/embudo.ts) saca de las tareas y de la IA las búsquedas de otro producto («lego», «murdoku», «hitster»…), pero se
-- recalcula cada vez y puede equivocarse. Aquí se guarda lo que decide el SEO en «Búsquedas», como las negativas de PPC:
--
--   · decision = 'ajena'    «No es nuestro producto»: veredicto 'ajena', impacto 0, fuera de las palabras, la oportunidad, el embudo y la propuesta.
--   · decision = 'nuestra'  «Sí es nuestro»: la heurística ya no la marca como posible ajena.
--
-- Es por cuenta (conexión) y país, no por producto: una búsqueda de otro producto lo es para todos los de la cuenta. `consulta` va normalizada
-- (minúsculas, sin tildes ni signos: claveDeBusqueda en lib/seo/embudo.ts) y `texto` guarda cómo se vio.
--
-- NO TOCA NI BORRA NADA QUE YA EXISTA. Tabla cerrada al navegador salvo lectura de administradores: todo pasa por el servidor.
-- Sin esta migración la pantalla sigue funcionando con la heurística y el botón avisa de que falta lanzarla.
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.seo_consultas') IS NULL THEN
    RAISE EXCEPTION 'Falta public.seo_consultas: lanza antes 296_seo_test.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.seo_busquedas_decididas (
  connection_id  UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  consulta       TEXT NOT NULL CHECK (length(consulta) BETWEEN 1 AND 300),
  texto          TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('ajena', 'nuestra')),
  -- El producto desde el que se marcó (solo para saber de dónde salió; la decisión vale para toda la cuenta y país)
  asin           TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, consulta)
);

ALTER TABLE public.seo_busquedas_decididas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seo_busquedas_decididas_lectura_admin ON public.seo_busquedas_decididas;
CREATE POLICY seo_busquedas_decididas_lectura_admin ON public.seo_busquedas_decididas FOR SELECT USING (public.is_erp_admin(auth.uid()));

-- ============================================================================
-- COMPROBACIÓN · tiene que salir UNA fila con todo en «true»
-- ============================================================================
SELECT
  (to_regclass('public.seo_busquedas_decididas') IS NOT NULL) AS tabla_creada,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'seo_busquedas_decididas') AS con_rls,
  EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'seo_busquedas_decididas_lectura_admin') AS politica_de_lectura;
