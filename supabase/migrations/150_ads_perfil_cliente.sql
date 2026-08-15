-- ==================================================================
-- 150 · DE QUE CLIENTE ES CADA CUENTA DE ANUNCIANTE
-- ==================================================================
--
-- El modelo estaba torcido, y se vio en cuanto entro el primer dato real.
--
--   como estaba:  cliente del ERP -> conexion -> perfiles
--   como es:      NUESTRA cuenta de agencia -> conexion -> perfiles de VARIOS
--                 clientes
--
-- La autorizacion es de la agencia, no del cliente: Creative Toys nos dio acceso
-- a SU perfil de Ads desde nuestra cuenta de libertyupgrowth. Se autoriza UNA
-- vez y ahi van apareciendo los perfiles de cada cliente que nos de acceso.
--
-- Con el modelo anterior, esos tres perfiles de Creative Toys quedaban
-- archivados bajo el cliente donde se pulso «Conectar». Y eso no es cosmetico:
-- al montar los informes, el gasto de un anunciante quedaria contabilizado en
-- otro. Es justo lo que el acuerdo firmado con Amazon prohibe — los datos de un
-- vendedor se usan exclusivamente para operar SU cuenta, sin cruzarlos ni
-- mezclarlos con los de otro.
--
--
-- POR QUE marketing_clients Y NO amazon_clients
-- ---------------------------------------------
-- Son dos listas distintas y no se solapan: amazon_clients son las cuentas de
-- vendedor conectadas por SP-API (Lenobotics, Shoplamp...), y marketing_clients
-- son los clientes de PUBLICIDAD (Creative Toys, Yo By Yolanda...). Un anunciante
-- puede no vender por nuestra SP-API, y un vendedor puede no llevar publicidad
-- con nosotros. Un perfil de Ads pertenece a lo segundo.
--
--
-- NULLABLE, Y ESA ES LA PIEZA DE SEGURIDAD
-- ----------------------------------------
-- Un perfil recien traido de Amazon no tiene cliente: nadie se lo ha asignado
-- todavia. Y la regla que va encima es que SIN CLIENTE NO SE TRABAJA, aunque
-- este marcado como en uso — porque no habria donde guardar sus datos sin
-- mezclarlos con los de otro. Poner un cliente por omision seria inventarse esa
-- respuesta.

DO $$
BEGIN
  IF to_regclass('public.ads_profiles') IS NULL THEN
    RAISE EXCEPTION 'Falta public.ads_profiles: lanza antes 148_ads_api.sql.';
  END IF;
  IF to_regclass('public.marketing_clients') IS NULL THEN
    RAISE EXCEPTION 'Falta public.marketing_clients: lanza antes 103_marketing.sql.';
  END IF;
END $$;

ALTER TABLE public.ads_profiles
  ADD COLUMN IF NOT EXISTS marketing_client_id UUID
    REFERENCES public.marketing_clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ads_profiles_cliente
  ON public.ads_profiles(marketing_client_id);

COMMENT ON COLUMN public.ads_profiles.marketing_client_id IS
  'De que cliente de PUBLICIDAD es esta cuenta de anunciante. NULL = sin asignar, '
  'y entonces no se trabaja aunque en_uso sea true: no habria donde guardar sus '
  'datos sin mezclarlos con los de otro cliente.';

-- ON DELETE SET NULL y no CASCADE: si se borra un cliente de marketing, el perfil
-- se queda sin asignar —y por tanto sin trabajarse— pero NO desaparece. Borrarlo
-- haria que volviera a salir como nuevo en el siguiente refresco, y nadie
-- recordaria por que estaba descartado.

-- ---------- Comprobacion ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ads_profiles'
      AND column_name = 'marketing_client_id' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION
      'ads_profiles.marketing_client_id no existe o no admite NULL. NULL significa «sin asignar», '
      'que es el estado en el que nace todo perfil recien traido de Amazon.';
  END IF;
END $$;
