-- ============================================================================
-- 221 · CONEXIÓN CON LA TIENDA PRESTASHOP DE UN CLIENTE
-- ============================================================================
--
-- Guarda la dirección de la tienda y la clave del Webservice de PrestaShop de un
-- cliente, para poder LEER su stock y contrastarlo con el de Amazon. Hoy solo la
-- usa ShoesF, en el auditor de stock. SOLO LECTURA: la clave que se guarda aquí
-- tiene que ser una de permiso GET, y el ERP no escribe nunca en la tienda.
--
-- LA CLAVE VA CIFRADA Y NO SALE NUNCA
-- -----------------------------------
-- `clave_cifrada` lleva AES-256-GCM (lib/amazon/crypto.ts, la misma que los tokens
-- de Amazon). Y la TABLA ENTERA está cerrada: RLS activado, SIN NINGUNA política y
-- sin permisos para `authenticated` ni `anon`. Solo la lee el servidor con la
-- clave de servicio. Es el mismo criterio que stock_origen_credenciales (124): una
-- columna secreta en una tabla que el navegador puede consultar nace, por
-- omisión, dentro de cada `select('*')`.
--
-- UNA TIENDA POR CLIENTE (client_id UNIQUE). Si un día un cliente tiene dos, se
-- cambia esta restricción; hoy habría que decidir cuál manda y no hay motivo.
--
-- `ultimo_test_*` guarda cómo salió la última prueba de conexión, para poder
-- enseñar «conectada» o «falla desde el martes» sin volver a llamar a la tienda
-- cada vez que se abre la pantalla.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.prestashop_conexiones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL UNIQUE
                          REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  -- Siempre https y sin barra final ni «/api». Se valida en el código; el CHECK es
  -- la red de seguridad por si alguien escribe directamente en la tabla.
  url_base              TEXT NOT NULL CHECK (url_base ~ '^https://[^/\s]+'),
  clave_cifrada         TEXT NOT NULL CHECK (btrim(clave_cifrada) <> ''),

  ultimo_test_at        TIMESTAMPTZ,
  ultimo_test_ok        BOOLEAN,
  ultimo_test_mensaje   TEXT,
  version_prestashop    TEXT,

  creada_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.prestashop_conexiones IS
  'Dirección y clave (cifrada) del Webservice de PrestaShop de un cliente. Solo la lee el servidor.';

-- ---------- Cerrada del todo: solo el servidor ----------
ALTER TABLE public.prestashop_conexiones ENABLE ROW LEVEL SECURITY;

-- Sin ninguna política. Por si ya hubiera alguna de un intento anterior:
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'prestashop_conexiones'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.prestashop_conexiones', pol.policyname);
  END LOOP;
END $$;

REVOKE ALL ON public.prestashop_conexiones FROM authenticated, anon;
