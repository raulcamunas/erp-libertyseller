-- =====================================================
-- «ESTE CLIENTE NO HACE SINCRONIZACIÓN DE STOCK»
-- =====================================================
-- Petición literal: «que este módulo de amazon api nos deje seleccionar el
-- archivo del cliente o cómo vamos a hacer sincronización de stock O SI NO LO
-- VAMOS A HACER (porque algunos no hace falta)».
--
-- EL PROBLEMA QUE RESUELVE, Y NO ES DE COMODIDAD.
--
-- Hasta hoy la única forma de decir «a este cliente no le sincronizamos el
-- stock» era no crearle el perfil de lectura. Y eso es EXACTAMENTE LO MISMO que
-- se ve cuando alguien empezó a configurarlo un jueves y lo dejó a medias. Dos
-- situaciones opuestas —una decisión tomada y un trabajo sin terminar— con la
-- misma pinta en pantalla: cero filas. El resultado es que la lista de «clientes
-- sin perfil» deja de leerse, porque nunca se sabe si lo que hay ahí es tarea
-- pendiente o clientes que no la tienen.
--
-- Así que «no sincroniza» pasa a ser UN ESTADO DE PRIMERA, con las tres cosas
-- que hacen falta para poder fiarse de él dentro de seis meses: CUÁNDO se
-- decidió, QUIÉN lo decidió y POR QUÉ.
--
--
-- ---------- POR QUÉ UNA FECHA Y NO UN BOOLEANO ----------
--
-- `no_sincroniza BOOLEAN NOT NULL DEFAULT false` tiene dos estados y hacen falta
-- TRES:
--
--   · no_sincroniza_desde IS NULL  -> nadie lo ha decidido todavía. Si además no
--     tiene perfil, está PENDIENTE DE CONFIGURAR, que es trabajo por hacer.
--   · no_sincroniza_desde NOT NULL -> alguien decidió que no, ese día. Deja de
--     ser tarea pendiente.
--   · Y el tercero no es una columna: tener perfil activo de stock. Eso ya se
--     sabe mirando stock_read_profiles.
--
-- Con un booleano, `false` significaría a la vez «hemos decidido que sí» y
-- «nadie ha mirado esto nunca», que es la misma confusión de la que venimos y es
-- la regla del proyecto: SIN DATO NO ES UN CERO, ni un false. Columna anulable
-- más estado.
--
-- Y la fecha, además, contesta la pregunta que se hace de verdad cuando un
-- cliente reclama seis meses después: «¿desde cuándo no le mandamos stock?».
--
--
-- ---------- LO QUE ESTA MIGRACIÓN NO HACE ----------
--
-- NO borra ni desactiva los perfiles del cliente que se marca. Un cliente puede
-- dejar de sincronizar tres meses y volver, y tirar su configuración de columnas
-- —que costó una tarde con el fichero delante— para ahorrar una fila es un mal
-- negocio. Quien lea el ciclo se salta esos perfiles; la configuración se queda
-- donde está y el día que se reactive vuelve a funcionar sin tocar nada.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.
-- El editor SQL de Supabase corre el script ENTERO en una transacción, así que
-- todo lo frágil va detrás de una guarda DO.

-- ---------- Guardas previas ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stock_clients'
  ) THEN
    RAISE EXCEPTION
      'No existe public.stock_clients. Lanza antes 106_stock_sync.sql: la decisión de no sincronizar cuelga del cliente de sincronismo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION
      'No existe public.profiles. Sin ella no se puede registrar QUIÉN tomó la decisión, que es la mitad de para qué sirve esto.';
  END IF;
END $$;

-- =====================================================
-- 1) LAS TRES COLUMNAS
-- =====================================================
ALTER TABLE public.stock_clients
  ADD COLUMN IF NOT EXISTS no_sincroniza_desde  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_sincroniza_motivo TEXT,
  ADD COLUMN IF NOT EXISTS no_sincroniza_por    UUID;

COMMENT ON COLUMN public.stock_clients.no_sincroniza_desde IS
  'Cuándo se decidió que a este cliente NO se le sincroniza el stock. NULL = nadie lo ha decidido (si además no tiene perfil, está pendiente de configurar). Nunca se usa false ni 0 para esto: sin dato no es un cero.';

COMMENT ON COLUMN public.stock_clients.no_sincroniza_motivo IS
  'Por qué no se le sincroniza, en una frase. Opcional a propósito: obligarlo llevaría a que se rellenara con un punto.';

COMMENT ON COLUMN public.stock_clients.no_sincroniza_por IS
  'Quién lo decidió (public.profiles.id). Se conserva aunque esa persona salga del ERP: la pantalla enseña su nombre si lo encuentra y lo dice si no.';

-- ---------- La clave ajena, con guarda ----------
-- ADD CONSTRAINT no admite IF NOT EXISTS, así que se comprueba a mano. ON DELETE
-- SET NULL y no CASCADE: que alguien deje la agencia no puede hacer que un
-- cliente vuelva a aparecer como pendiente de configurar. Se pierde el nombre,
-- se conservan la fecha y el motivo, que es lo que de verdad se consulta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_clients_no_sincroniza_por_fkey'
      AND conrelid = 'public.stock_clients'::regclass
  ) THEN
    ALTER TABLE public.stock_clients
      ADD CONSTRAINT stock_clients_no_sincroniza_por_fkey
      FOREIGN KEY (no_sincroniza_por) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------- Coherencia ----------
-- Motivo y autor SOLO tienen sentido si hay decisión. Sin este CHECK, reactivar
-- un cliente poniendo la fecha a NULL y olvidando el resto deja un motivo
-- huérfano —«no tiene ERP»— colgado de un cliente que sí sincroniza, y ese texto
-- se lee meses después como si siguiera vigente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_clients_no_sincroniza_coherente'
      AND conrelid = 'public.stock_clients'::regclass
  ) THEN
    -- Antes de poner el CHECK hay que dejar la tabla cumpliéndolo, o la
    -- migración revienta en una base que ya tuviera datos raros.
    UPDATE public.stock_clients
       SET no_sincroniza_motivo = NULL,
           no_sincroniza_por = NULL
     WHERE no_sincroniza_desde IS NULL
       AND (no_sincroniza_motivo IS NOT NULL OR no_sincroniza_por IS NOT NULL);

    ALTER TABLE public.stock_clients
      ADD CONSTRAINT stock_clients_no_sincroniza_coherente
      CHECK (
        no_sincroniza_desde IS NOT NULL
        OR (no_sincroniza_motivo IS NULL AND no_sincroniza_por IS NULL)
      );
  END IF;
END $$;

-- ---------- Índice ----------
-- Parcial, y con dieciséis clientes no es por rendimiento: es para que la
-- consulta del ciclo automático —«qué clientes están excluidos»— tenga una forma
-- declarada y evidente. Un índice parcial sobre esta condición ocupa lo que
-- ocupan las filas excluidas, o sea nada.
CREATE INDEX IF NOT EXISTS idx_stock_clients_no_sincroniza
  ON public.stock_clients(no_sincroniza_desde)
  WHERE no_sincroniza_desde IS NOT NULL;

-- =====================================================
-- 2) RLS
-- =====================================================
-- No se toca. stock_clients ya tiene sus políticas desde la 106 (admin y partner
-- escriben, el equipo de stock lee) y estas columnas viven dentro de la misma
-- fila: heredan exactamente el mismo permiso. Añadir una política aquí solo
-- podría abrir de más.
--
-- Y la escritura de verdad no pasa por `authenticated` de todas formas: va por
-- /api/stock-sync/clientes/[id], que llama a requireAmazonAdmin() y escribe con
-- service_role. Solo admin: decidir que a un cliente se le deja de mandar stock
-- es una decisión comercial, no un ajuste de pantalla.
