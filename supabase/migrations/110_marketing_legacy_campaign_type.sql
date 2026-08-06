-- =====================================================
-- MARKETING: traducir los tipos de campaña antiguos al vuelo
-- =====================================================
-- La 105 cambió la taxonomía de campañas a la real de Liberty Seller, pero
-- en el código quedó un literal suelto: al crear una campaña se mandaba
-- 'sp_auto', que el nuevo CHECK ya no acepta. Resultado: cada campaña
-- nueva fallaba con «No se pudo crear la campaña».
--
-- El arreglo está hecho en el código, pero mientras no se despliegue esto
-- desatasca la aplicación sin ampliar la restricción — que dejaría entrar
-- valores que la interfaz no sabe pintar. En vez de eso, se traducen los
-- nombres antiguos al equivalente nuevo antes de guardar.
--
-- Queda como red de seguridad: una vez desplegado el código correcto, el
-- trigger no hace nada, y protege de que otro literal olvidado vuelva a
-- romper la creación de campañas.

CREATE OR REPLACE FUNCTION public.translate_legacy_campaign_type()
RETURNS TRIGGER AS $$
BEGIN
  NEW.campaign_type := CASE NEW.campaign_type
    WHEN 'sp_auto'          THEN 'auto'
    WHEN 'sp_manual_exacta' THEN 'exacta'
    WHEN 'sp_manual_frase'  THEN 'frase_h10'
    WHEN 'sp_manual_amplia' THEN 'frase_h10'
    WHEN 'sb'               THEN 'brand_defend'
    WHEN 'sd'               THEN 'asin_h10'
    ELSE NEW.campaign_type
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_legacy_campaign_type ON public.marketing_campaigns;
CREATE TRIGGER trg_marketing_legacy_campaign_type
  BEFORE INSERT OR UPDATE OF campaign_type ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.translate_legacy_campaign_type();
