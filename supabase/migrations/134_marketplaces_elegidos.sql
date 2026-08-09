-- ==================================================================
-- 134 · ELEGIR EN QUÉ MERCADOS SE TRABAJA
-- ==================================================================
--
-- Para qué es
-- -----------
-- Hoy el ERP trabaja en TODOS los marketplaces que Amazon dice que un vendedor
-- tiene, y eso no es lo que queremos. En la cuenta piloto salen OCHO:
--
--     México · A1MQXOICRS2Z7M · Canadá · Brasil · A2ZV50J4W1RKNI
--     A3H6HPSLHAK3XG · AHRY1CZE9ZY4H · Estados Unidos
--
-- Los cuatro que aparecen con el código en crudo son de SANDBOX: el ERP no sabe
-- nombrarlos porque no son tiendas de verdad. `getMarketplaceParticipations`
-- los devuelve con `isParticipating: true` igualmente, así que el filtro de
-- participación —que sí se aplica— no los quita.
--
-- Resultado: la mitad de los trabajos que se encolaban eran contra sitios donde
-- el cliente no vende nada. Con un catálogo de 13.700 referencias eso es cupo
-- de Amazon quemado cada noche.
--
-- Pero el problema de fondo no es el sandbox: es que un cliente puede vender en
-- España, Francia, Italia y Alemania y a nosotros interesarnos solo España.
-- Hasta ahora no había forma de decirlo.
--
--
-- Por qué vacío significa TODOS y no NINGUNO
-- ------------------------------------------
-- Porque es lo que hay hoy, y esta migración NO puede cambiar el comportamiento
-- de las conexiones que ya funcionan. Con la lista vacía se sigue trabajando en
-- todos los que el ERP sabe nombrar, exactamente igual que antes de pegar este
-- fichero. En cuanto alguien elige, manda su elección.
--
-- Es además el mismo criterio que ya usa `amazon_tracking_rules.marketplace_ids`
-- («Vacío = a todos los de ese cliente»), así que no hay dos reglas distintas
-- para la misma idea.
--
--
-- Por qué en la conexión y no en el cliente
-- -----------------------------------------
-- Porque un cliente puede tener dos cuentas —una en Europa y otra en Estados
-- Unidos— y la elección es distinta en cada una. La conexión es donde viven los
-- marketplaces, así que es donde vive el filtro.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'amazon_connections'
  ) THEN
    RAISE EXCEPTION 'No existe amazon_connections. Lanza antes 118_amazon_api.sql.';
  END IF;
END $$;

ALTER TABLE public.amazon_connections
  ADD COLUMN IF NOT EXISTS marketplaces_activos TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.amazon_connections.marketplaces_activos IS
  'En qué mercados de esta cuenta se trabaja. VACÍO = en todos los que el ERP '
  'sepa nombrar, que es como se comportaba antes de existir esta columna. '
  'Se elige desde Amazon API · Cuentas.';

-- Comprobación final: un rollback silencioso del editor de Supabase es
-- indistinguible de «no he pegado el fichero», así que se dice por su nombre.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_connections'
      AND column_name = 'marketplaces_activos'
  ) THEN
    RAISE EXCEPTION 'Falta amazon_connections.marketplaces_activos.';
  END IF;
END $$;
