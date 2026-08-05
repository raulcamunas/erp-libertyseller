-- =====================================================
-- MARKETING: los tipos de campaña reales de Liberty Seller
-- =====================================================
-- La 103 se creó con una clasificación genérica de Amazon Ads (SP auto,
-- exacta, frase, amplia, SB, SD). La que se usa de verdad es la del
-- documento de estrategia, que no clasifica por producto publicitario sino
-- por el papel que juega la campaña en el embudo:
--
--   auto          fábrica de keywords (campaña automática)
--   frase_h10     fábrica de keywords extraídas de Helium 10
--   asin_h10      fábrica de ASINs extraídos de Helium 10
--   exacta        exactas ya cosechadas y rentables
--   asin_exacta   ASINs ya cosechados y rentables
--   brand_defend  defensa de marca
--
-- Esta migración solo hace falta si ya se ejecutó la 103; en una base
-- nueva, la 103 ya trae los valores buenos.

ALTER TABLE public.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_campaign_type_check;

-- Se traduce lo que hubiera al equivalente más cercano antes de volver a
-- poner la restricción, o el ALTER fallaría con las filas existentes.
UPDATE public.marketing_campaigns SET campaign_type = CASE campaign_type
  WHEN 'sp_auto'           THEN 'auto'
  WHEN 'sp_manual_exacta'  THEN 'exacta'
  WHEN 'sp_manual_frase'   THEN 'frase_h10'
  WHEN 'sp_manual_amplia'  THEN 'frase_h10'
  WHEN 'sb'                THEN 'brand_defend'
  WHEN 'sd'                THEN 'asin_h10'
  ELSE campaign_type
END
WHERE campaign_type IN (
  'sp_auto', 'sp_manual_exacta', 'sp_manual_frase', 'sp_manual_amplia', 'sb', 'sd'
);

ALTER TABLE public.marketing_campaigns
  ALTER COLUMN campaign_type SET DEFAULT 'auto';

ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_campaign_type_check
  CHECK (campaign_type IN (
    'auto', 'frase_h10', 'asin_h10', 'exacta', 'asin_exacta', 'brand_defend'
  ));
