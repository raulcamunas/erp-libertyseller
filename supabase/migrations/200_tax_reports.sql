-- ============================================================================
-- 200 · TAX REPORTS: LA REJILLA DE CLIENTES POR MES, Y UN BUCKET QUE NO ES
--       COMO LOS CINCO QUE YA HAY
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase.
-- IDEMPOTENTE: se puede volver a pegar entera sin duplicar ni pisar nada.
--
-- Cada dia 3, una persona de la agencia va cuenta por cuenta de Amazon,
-- descarga el informe fiscal del mes y lo cuelga aqui. Cuando estan todos,
-- salen los correos a los clientes. Esta migracion monta las TRES tablas que
-- sostienen esa pantalla —los clientes, el fichero de cada mes y lo que hay que
-- anotar sobre un mes— y el sitio donde se guarda el fichero de cada celda.
--
-- Las notas de mes van en tabla propia (bloque 2 bis) y no en una columna de
-- tax_report_ficheros: se escriben sobre todo en los meses que TODAVIA NO
-- tienen fichero, o sea justo donde esa fila no existe. El razonamiento entero
-- esta alli.
--
--
-- ============ LO QUE VA DENTRO DE ESOS FICHEROS ============
--
-- El tax report de Amazon lleva, FILA A FILA: la ciudad, el codigo postal y el
-- pais de entrega de cada pedido, el Order ID y un enlace a la factura del
-- comprador. O sea datos de COMPRADORES, que es justo lo que este proyecto
-- tiene firmado con Amazon que no guarda.
--
-- La decision de guardarlos seis meses esta TOMADA A SABIENDAS, y se deja
-- escrita aqui para que dentro de seis meses no parezca un descuido:
--
--   · El fichero de un cliente va A ESE MISMO CLIENTE, que ya lo tiene en su
--     Seller Central. No se cruza nada entre clientes.
--   · Existe para poder mandarlo ese mes. Pasados seis meses, el fichero se
--     retira del bucket (bloque 6). La fila se queda para poder decir «se
--     mando el 4 de marzo».
--
-- Lo que esa decision SI obliga, y es el resto de este fichero:
--
--   · BUCKET PRIVADO (public = false). NO como finance-attachments,
--     client-documents, crm-documents, call-recordings y
--     appointment-attachments, que hoy estan en publico.
--   · El navegador NO habla con Storage. Ni sube ni baja. Todo pasa por rutas
--     de servidor con la clave de servicio, y para descargar se firma un enlace
--     que caduca en 60 segundos. Nunca getPublicUrl.
--   · El CONTENIDO del fichero no se parsea ni se guarda en ninguna columna.
--     Se guarda el fichero, su nombre, su tamano, quien lo subio y cuando. Nada
--     mas. Eso es exactamente lo que la 199 tuvo que ir a borrar a mano de
--     `commission_reports.data->originalCsv`.
--   · Admin, partner, y el empleado A QUIEN SE LE HAYA CONCEDIDO ESTA APP. Ni
--     un empleado cualquiera: ver el bloque de RLS.
--
--
-- ============ AQUI NO HAY NINGUN «REVOKE» SOBRE storage.objects ============
--
-- Es la tentacion evidente y romperia el ERP entero, asi que queda dicho:
-- los GRANT de Postgres son POR TABLA, no por bucket. Un
--
--     REVOKE INSERT ON storage.objects FROM authenticated;
--
-- deja sin poder subir un fichero a CRM, a Finanzas, a Agenda y a Clientes a la
-- vez, y sin un solo error que mencione esta migracion.
--
-- LO QUE CIERRA UN BUCKET ES OTRA COSA, y es suficiente:
--
--   1. `public = false`: la ruta /storage/v1/object/public/tax-reports/... deja
--      de servir. getPublicUrl sigue DEVOLVIENDO una URL —es una concatenacion
--      de cadenas en el cliente, no le pregunta nada a nadie— pero esa URL ya
--      no abre. Por eso en la pantalla no se usa jamas.
--   2. storage.objects tiene RLS activada de serie y es DENEGAR POR OMISION.
--      Sin NINGUNA politica que case con bucket_id = 'tax-reports', ni anon ni
--      authenticated pueden leer, escribir, listar ni borrar ahi. LA AUSENCIA
--      DE POLITICA ES EL CIERRE.
--   3. service_role se salta la RLS. Esa es la unica llave, y vive en el
--      servidor (SUPABASE_SERVICE_ROLE_KEY, lib/supabase/service.ts).
--
-- El bloque 4 quita las politicas de storage que mencionen este bucket (por si
-- alguien creo una a mano desde el panel) y AVISA de las que no filtran por
-- bucket_id, que son las unicas que pueden dejar esto abierto sin que la cadena
-- 'tax-reports' aparezca por ningun sitio.
--
--
-- ============ POR QUE TABLA DE CLIENTES PROPIA Y NO UNA COLUMNA EN clients ===
--
-- Porque son dos preguntas distintas:
--
--   a) Raul pide poder anadir un cliente A MANO escribiendo solo un nombre.
--      public.clients exige base_commission_rate NOT NULL y alimenta
--      comisiones, facturacion y tarifas: una fila inventada ahi aparece en
--      pantallas que no tienen nada que ver con esto.
--   b) Un cliente al que no le cobramos comision puede necesitar igual su tax
--      report cada mes.
--
-- `client_id` guarda el vinculo con el cliente de comisiones para lo que si se
-- quiera cruzar, y es NULL en los que se den de alta a mano.
--
--
-- ============ QUE FICHERO TOCA: UNA COLUMNA DE TEXTO LIBRE ============
--
-- Lenobotics y Creative Toys van con el informe de Sellerboard; el resto, con
-- el tax report de Amazon. Eso NO se escribe a fuego en el codigo, porque esa
-- lista va a cambiar: es `tipo_fichero`, y se cambia desde la pantalla.
--
-- Y TAMPOCO ES UNA LISTA CERRADA, que es lo que era hasta hoy
-- —CHECK (tipo_fichero IN ('tax_report', 'sellerboard'))—. Raul ha pedido poder
-- denominarlo el: «Tax report», «Sellerboard», «Informe del proveedor», lo que
-- haga falta. Con la lista cerrada, el dia que un cliente llegue con un informe
-- de otro sitio hay que escribir una migracion, pegarla en el editor SQL de
-- Supabase y desplegar ANTES de poder dar de alta a ese cliente; y quien esta
-- dando de alta clientes el dia 3 no es quien lanza migraciones, asi que se
-- queda parado. Lo unico que se sigue impidiendo es el blanco.
--
-- LO QUE SE PIERDE A CAMBIO, Y SE ACEPTA: nadie garantiza ya que dos clientes
-- que llevan el mismo informe lo tengan escrito igual («Sellerboard» y
-- «sellerboard»). Se acepta porque este valor es UNA ETIQUETA QUE LEE UNA
-- PERSONA: no hay ni un `if` sobre el en todo el codigo, no decide validaciones
-- ni formatos ni destinatarios. El dia que decida algo, ese dia hace falta otra
-- cosa —una tabla de tipos— y no un CHECK.
--
-- Es el mismo argumento que dejo escrito la 177 para `clients.modo_calculo`:
-- dar de alta un cliente nuevo con este trato obligaria a tocar codigo y
-- desplegar, y renombrar a uno en la pantalla le cambiaria el fichero en
-- silencio.
--
-- OJO, QUE NO ES LA MISMA LISTA QUE LA DE COMISIONES. En
-- app/api/commissions/process/route.ts van con Sellerboard DIRU, SAUSI y
-- Creative Toys, mas Lenobotics por la logica antigua. Aqui Raul ha nombrado
-- DOS: Lenobotics y Creative Toys. Son preguntas distintas —«con que fichero
-- calculamos la comision» y «que fichero le mandamos al cliente»— y no se
-- igualan por nuestra cuenta. Se siembra lo que dijo.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 0) EL GUARDARRAIL                                                   */
/* ------------------------------------------------------------------ */
-- AQUI YA NO SE COMPRUEBA is_erp_admin(uuid), Y NO ES UN DESCUIDO: las
-- politicas de SELECT de mas abajo han dejado de usarla. Quien decide ahora es
-- public.puede_ver_tax_reports(uid), que se crea en este mismo fichero y mira
-- DOS TABLAS: public.profiles y public.user_app_permissions. Un guardarrail
-- sobre una funcion que ya no llama nadie es de las cosas que dentro de medio
-- ano hacen fallar una migracion por un motivo que no tiene nada que ver.
--
-- Se comprueban las dos tablas, y no se deja que lo diga Postgres solo, porque
-- lo que diria es «relation public.user_app_permissions does not exist» al
-- crear la funcion: cierto, pero sin decir que migracion la crea ni que se
-- queda a medias. Con esto se para aqui, antes de crear ni una tabla.
DO $$
DECLARE falta TEXT;
BEGIN
  FOREACH falta IN ARRAY ARRAY['public.profiles', 'public.user_app_permissions'] LOOP
    IF to_regclass(falta) IS NULL THEN
      RAISE EXCEPTION
        'Falta la tabla %, que es de la que sale quien puede ver Tax Reports (rol admin/partner o el permiso suelto de la app). Sin ella, la funcion puede_ver_tax_reports no se puede crear y las politicas de esta migracion se quedarian sin filtro.', falta;
    END IF;
  END LOOP;
END $$;


/* ------------------------------------------------------------------ */
/* 1) LOS CLIENTES DE LA REJILLA                                       */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.tax_report_clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /** Lo que se lee en la primera columna de la rejilla. UNIQUE porque dos
      filas con el mismo nombre son dos sitios donde colgar el fichero de
      agosto, y el dia 3 nadie sabria cual es la buena */
  nombre TEXT NOT NULL UNIQUE CHECK (btrim(nombre) <> ''),

  /**
   * COMO SE LLAMA EL FICHERO QUE LE TOCA A ESTE CLIENTE. Texto libre.
   *
   * Ver la cabecera: es una columna y no un `if` porque la lista de hoy
   * —Lenobotics y Creative Toys con Sellerboard— va a cambiar; y es texto libre
   * y no un CHECK IN (...) porque el informe que aparezca manana tendria que
   * esperar a que alguien escriba y pegue una migracion para poder dar de alta
   * al cliente que lo trae.
   *
   * EL CHECK QUE QUEDA IMPIDE EL BLANCO, que es lo unico que aqui no puede
   * pasar: una fila que no dice que fichero toca deja al que la mira el dia 3
   * sin saber que tiene que ir a descargar, y la rejilla existe justo para
   * decirle eso.
   *
   * La restriccion va CON NOMBRE PROPIO a proposito. La vieja se llamaba
   * `tax_report_clientes_tipo_fichero_check` —el nombre que Postgres pone solo—
   * y el bloque de compatibilidad de mas abajo la quita; si esta se llamara
   * igual, relanzar el fichero se llevaria por delante tambien la de ahora y la
   * columna se quedaria admitiendo cadenas vacias sin que nadie lo notara.
   */
  tipo_fichero TEXT NOT NULL DEFAULT 'Tax report'
    CONSTRAINT tax_report_clientes_tipo_fichero_no_vacio CHECK (btrim(tipo_fichero) <> ''),

  /**
   * Baja sin borrar. Un cliente que se va deja de salir en los meses nuevos y
   * sigue ensenando los que ya se le mandaron. Borrarlo de verdad se lleva por
   * delante ese historial, y por eso la ruta de DELETE contesta 409 cuando
   * tiene ficheros: lo que se quiere casi siempre es esto.
   */
  activo BOOLEAN NOT NULL DEFAULT true,

  /** «La cuenta de Alemania va aparte», «este lo manda su gestor». Texto libre
      para lo que la rejilla no puede decir con una casilla */
  notas TEXT,

  /**
   * En que orden salen las filas. Existe para poder juntar arriba los que se
   * suben primero: el dia 3 se recorre la rejilla de arriba abajo, y que el
   * orden lo decida el alfabeto es una decision tomada por nadie.
   */
  orden INTEGER NOT NULL DEFAULT 0,

  /**
   * DE DONDE SE SEMBRO. NULL = alta manual desde la pantalla, que es una de las
   * dos cosas que pedia el encargo.
   *
   * ON DELETE SET NULL y no CASCADE: dar de baja a un cliente en comisiones no
   * puede llevarse por delante el historial de lo que ya se le mando.
   */
  client_id UUID UNIQUE REFERENCES public.clients(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.tax_report_clientes IS
  'Las filas de la rejilla de Tax Reports. Tabla propia y no una columna en public.clients: aqui se puede dar de alta un cliente a mano con solo un nombre, y un cliente sin comision puede necesitar igual su informe. client_id enlaza con el cliente de comisiones cuando existe.';

COMMENT ON COLUMN public.tax_report_clientes.tipo_fichero IS
  'Como se llama el informe que le toca a este cliente, escrito por quien lleva la pantalla: «Tax report», «Sellerboard», «Informe del proveedor». Texto libre y NO una lista cerrada, porque un informe nuevo obligaria a pegar una migracion antes de poder dar de alta al cliente que lo trae. Es una etiqueta que lee una persona: no hay ni un if sobre este valor en todo el codigo.';


/* ---------- SI LA 200 SE PEGO ANTES DE QUE ESTO FUERA TEXTO LIBRE ---------- */
--
-- El CREATE TABLE de arriba es IF NOT EXISTS: sobre una base donde la version
-- vieja ya se lanzo, NO HACE NADA, y la columna se quedaria con la lista
-- cerrada CHECK (tipo_fichero IN ('tax_report', 'sellerboard')). Entonces la
-- siembra del bloque 5, que ahora escribe «Tax report», ABORTARIA LA MIGRACION
-- ENTERA con un 23514 que nombra una restriccion y nada mas. Estas cuatro
-- sentencias son lo que sostiene el «IDEMPOTENTE» de la cabecera.
--
-- Sobre una base limpia no hacen nada: la restriccion vieja no existe, el
-- DEFAULT ya es ese y los dos UPDATE no encuentran filas.

ALTER TABLE public.tax_report_clientes
  DROP CONSTRAINT IF EXISTS tax_report_clientes_tipo_fichero_check;

ALTER TABLE public.tax_report_clientes
  ALTER COLUMN tipo_fichero SET DEFAULT 'Tax report';

-- Y en una tabla que ya existia, la de no-blanco hay que anadirla: el
-- CONSTRAINT del CREATE TABLE no se ha llegado a ejecutar nunca alli.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tax_report_clientes'::regclass
       AND conname  = 'tax_report_clientes_tipo_fichero_no_vacio'
  ) THEN
    ALTER TABLE public.tax_report_clientes
      ADD CONSTRAINT tax_report_clientes_tipo_fichero_no_vacio CHECK (btrim(tipo_fichero) <> '');
  END IF;
END $$;

-- Los dos valores de la lista vieja pasan a leerse como se leen en la pantalla.
-- Se hace por el valor exacto y no con un upper(): lo que se esta traduciendo
-- son las DOS claves que escribia la version anterior, no lo que alguien haya
-- podido escribir a mano desde entonces, que es suyo y no se toca.
UPDATE public.tax_report_clientes SET tipo_fichero = 'Tax report'  WHERE tipo_fichero = 'tax_report';
UPDATE public.tax_report_clientes SET tipo_fichero = 'Sellerboard' WHERE tipo_fichero = 'sellerboard';


/* ------------------------------------------------------------------ */
/* 2) EL FICHERO DE CADA CELDA                                         */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.tax_report_ficheros (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  cliente_id UUID NOT NULL
    REFERENCES public.tax_report_clientes(id) ON DELETE CASCADE,

  anio INTEGER NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  mes  INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),

  /**
   * LA CLAVE DENTRO DEL BUCKET. No es una URL, y esa es la diferencia con
   * crm_documents o finance_attachments, que guardan el `publicUrl` que
   * devuelve getPublicUrl: una URL publica no caduca, no comprueba sesion y
   * quien la tenga la reparte. Esto no sirve de nada sin la clave de servicio.
   *
   * NULL = el fichero ya se retiro a los seis meses (ver el bloque 6). La fila
   * se queda, y por eso `purgado_at` esta al lado.
   */
  ruta TEXT,

  /**
   * Como se llamaba el fichero que descargo el empleado. Es lo unico legible de
   * todo esto, y es lo que se le devuelve al navegador al firmar la descarga
   * (`{ download: nombre_original }`), para que se guarde con el nombre de
   * siempre aunque dentro del bucket se llame como un UUID.
   */
  nombre_original TEXT NOT NULL CHECK (btrim(nombre_original) <> ''),

  tamano INTEGER NOT NULL CHECK (tamano > 0),
  tipo_mime TEXT,

  subido_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /** Cuando se retiro el fichero del bucket. La fila NO se borra: ver el 6 */
  purgado_at TIMESTAMPTZ,

  /**
   * AQUI NO HAY COLUMNA DE NOTAS, Y ES LA DECISION QUE MAS SE NOTA EN ESTE
   * FICHERO. Las notas de un mes viven en `tax_report_notas_mes`, que se crea
   * justo debajo.
   *
   * Estuvieron aqui —`notas TEXT` en esta misma tabla— y no podia funcionar:
   * esta fila solo existe cuando hay algo subido (nombre_original y tamano son
   * NOT NULL), asi que el unico ejemplo que se pidio poder escribir —«falta la
   * factura de enero», que habla de un mes QUE FALTA— era justo el que no se
   * podia guardar.
   *
   * Y no se arregla admitiendo NULL en esas dos columnas: «hay fila» es lo que
   * esta pantalla mira de un vistazo el dia 3 para saber que meses faltan, y
   * esta escrito asi en cuatro sitios de esta migracion. Una fila creada para
   * guardar una frase pintaria ese mes como hecho, que es exactamente el error
   * que la purga se cuida de no cometer dejando `purgado_at` puesto.
   */

  /**
   * UNA CELDA, UN FICHERO. Es lo que hace que la rejilla se pueda mirar de un
   * vistazo el dia 3: o hay fila o falta. Subir otra vez el mismo mes SUSTITUYE
   * —la ruta borra el objeto viejo del bucket antes de escribir el nuevo—, que
   * es lo que evita dejar huerfanos que nadie va a borrar nunca.
   */
  UNIQUE (cliente_id, anio, mes)
);

COMMENT ON TABLE public.tax_report_ficheros IS
  'Un fichero por cliente y mes. NO se guarda NADA del contenido: ni totales, ni numero de pedidos, ni el CSV. Ahi dentro van ciudad, codigo postal y Order ID de compradores, que es lo que la migracion 199 tuvo que borrar de commission_reports.data. Solo nombre, tamano, quien lo subio y cuando.';

COMMENT ON COLUMN public.tax_report_ficheros.ruta IS
  'Clave del objeto dentro del bucket privado tax-reports, con la forma <cliente_id>/<anio>/<mm>/<uuid>.<ext>. Nunca una URL. NULL = ya se retiro el fichero a los seis meses (purgado_at dice cuando).';

-- La rejilla se pinta por ano: esta es su consulta.
CREATE INDEX IF NOT EXISTS tax_report_ficheros_anio_idx
  ON public.tax_report_ficheros (anio, cliente_id, mes);

-- Y esta es la de la purga: solo mira los que todavia tienen fichero.
CREATE INDEX IF NOT EXISTS tax_report_ficheros_purga_idx
  ON public.tax_report_ficheros (subido_at) WHERE ruta IS NOT NULL;


/* ------------------------------------------------------------------ */
/* 2 bis) LO QUE PASA CON UN MES, TENGA FICHERO O NO                   */
/* ------------------------------------------------------------------ */
--
-- «Este mes lo mando tarde», «falta la factura de enero», «lo pidio en xlsx».
--
-- ============ POR QUE UNA TABLA Y NO UNA COLUMNA EN tax_report_ficheros =====
--
-- Porque la nota y el fichero NO NACEN A LA VEZ, y casi siempre la nota va
-- ANTES: se escribe el dia 3 justo sobre el mes que todavia no se ha podido
-- colgar, que es cuando hay algo que explicar. Con la nota dentro de la fila
-- del fichero, el unico mes que se queria anotar era el unico que no se podia.
--
-- La salida facil —dejar que `nombre_original` y `tamano` admitan NULL para
-- poder crear una fila sin fichero— es la que NO se toma, y conviene que quede
-- dicho para que nadie la reintente: en esta pantalla «hay fila en
-- tax_report_ficheros» significa «ese mes esta puesto», y de ahi salen el tic
-- verde, la cifra de meses que le faltan a cada cliente, el recuento de arriba
-- y la lista de pendientes de la purga. Una fila creada para guardar una frase
-- pintaria el mes como hecho y el dia 3 nadie iria a colgarlo.
--
-- Separadas, cada tabla contesta UNA pregunta y no se estorban: la de ficheros
-- dice si el mes esta puesto, esta dice que pasa con el. Y el borrado de un
-- informe ya no se lleva por delante lo que alguien escribio sobre ese mes,
-- que era otra perdida silenciosa de la version anterior.
--
-- NO HAY `cliente_id + anio + mes` CONTRA tax_report_ficheros: no hay clave
-- foranea hacia esa tabla A PROPOSITO, porque la fila de alli puede no existir
-- todavia. El vinculo es con el CLIENTE, que si existe siempre.

CREATE TABLE IF NOT EXISTS public.tax_report_notas_mes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  cliente_id UUID NOT NULL
    REFERENCES public.tax_report_clientes(id) ON DELETE CASCADE,

  anio INTEGER NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  mes  INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),

  /**
   * NOT NULL y sin blancos: una nota vacia es una nota que no existe, y se
   * borra la fila en vez de guardar la cadena vacia. Asi «hay fila» tambien
   * aqui significa una sola cosa, y la pantalla no tiene que distinguir entre
   * null, '' y '   ' para decidir si pinta el renglon ambar.
   */
  texto TEXT NOT NULL CHECK (btrim(texto) <> ''),

  escrita_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /** Una celda, una nota. Es lo que hace que guardar sea un upsert */
  UNIQUE (cliente_id, anio, mes)
);

COMMENT ON TABLE public.tax_report_notas_mes IS
  'Lo que pasa con UN mes de UN cliente: «lo mando tarde», «falta la factura de enero». Tabla aparte y no una columna en tax_report_ficheros porque la nota se escribe sobre todo en los meses que TODAVIA NO tienen fichero, que son los que hay que explicar. Las notas de la cuenta entera son tax_report_clientes.notas y son otra cosa.';

-- La pantalla las pide por ano, igual que los ficheros.
CREATE INDEX IF NOT EXISTS tax_report_notas_mes_anio_idx
  ON public.tax_report_notas_mes (anio, cliente_id, mes);

/* ---- SI LA 200 SE PEGO CUANDO LAS NOTAS ESTABAN EN LA OTRA TABLA ---- */
--
-- Mismo motivo que los dos bloques de compatibilidad de mas arriba: el CREATE
-- TABLE es IF NOT EXISTS y los ALTER no se han ejecutado nunca en una base
-- donde la version anterior ya se lanzo. Alli `tax_report_ficheros.notas`
-- existe y puede tener texto escrito.
--
-- SE COPIA ANTES DE TIRAR LA COLUMNA, y en este orden, por lo de siempre: al
-- reves se pierde lo que alguien escribio y no hay de donde sacarlo. Sobre una
-- base limpia el IF no entra y esto no hace nada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'tax_report_ficheros'
       AND column_name  = 'notas'
  ) THEN
    INSERT INTO public.tax_report_notas_mes (cliente_id, anio, mes, texto)
    SELECT f.cliente_id, f.anio, f.mes, btrim(f.notas)
      FROM public.tax_report_ficheros f
     WHERE f.notas IS NOT NULL
       AND btrim(f.notas) <> ''
    ON CONFLICT (cliente_id, anio, mes) DO NOTHING;

    ALTER TABLE public.tax_report_ficheros DROP COLUMN notas;

    RAISE NOTICE '200 · las notas de mes se han movido de tax_report_ficheros.notas a tax_report_notas_mes y la columna vieja se ha quitado.';
  END IF;
END $$;


/* ---------- updated_at, sin depender de ningun trigger de otro ---------- */
-- Se escribe uno propio en vez de reusar public.update_updated_at_column():
-- esta migracion se pega a mano y no puede fallar a mitad porque una funcion de
-- la 001 se haya renombrado en algun momento.

CREATE OR REPLACE FUNCTION public.tax_report_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
-- El search_path fijo en las tres funciones de este fichero: son INVOKER, asi
-- que heredan el del que llama, y un esquema colado delante de `public` en esa
-- lista puede hacer que `tax_report_ficheros` o `now()` signifiquen otra cosa.
-- Es ademas lo que pide el aviso «function_search_path_mutable» del linter de
-- Supabase, que hoy sale en rojo para todas las funciones del repo.
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tax_report_clientes_updated ON public.tax_report_clientes;
CREATE TRIGGER trg_tax_report_clientes_updated
  BEFORE UPDATE ON public.tax_report_clientes
  FOR EACH ROW EXECUTE FUNCTION public.tax_report_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tax_report_notas_mes_updated ON public.tax_report_notas_mes;
CREATE TRIGGER trg_tax_report_notas_mes_updated
  BEFORE UPDATE ON public.tax_report_notas_mes
  FOR EACH ROW EXECUTE FUNCTION public.tax_report_touch_updated_at();


/* ---- RLS: quien tiene la app, y las escrituras solo por el servidor ---- */
--
-- El SELECT se le deja a `authenticated` acotado con puede_ver_tax_reports(),
-- porque es lo que permite que la pantalla lea la rejilla sin inventar una ruta
-- mas. Lo que NUNCA se lee asi es el FICHERO: eso no esta en estas tablas.
--
-- Las escrituras se revocan enteras. TRUNCATE entra en la lista a proposito
-- —es el mismo motivo que dejo escrito la 118—: viene dentro del GRANT ALL que
-- Supabase reparte por omision, y ni la RLS ni los CHECK se le aplican.
--
-- public.clients tiene desde la 007 una politica «cualquier autenticado
-- gestiona». Estas tablas NO heredan ese criterio, y por eso se dice aqui: con
-- ese criterio, un employee —o desde la 193 un CLIENTE, que es gente de fuera
-- de la agencia— leeria la rejilla entera con la clave anonima aunque la
-- pantalla estuviera cerrada.

ALTER TABLE public.tax_report_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_report_ficheros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_report_notas_mes ENABLE ROW LEVEL SECURITY;

/**
 * QUIEN PUEDE LEER LA REJILLA.
 *
 * Mismo patron, letra por letra, que public.puede_borrar_mapeo(uid) en la 189,
 * y por el mismo motivo que quedo escrito alli: el corte NO es «ser empleado»,
 * es TENER CONCEDIDA ESTA APP.
 *
 * Con is_erp_admin() —que es lo que habia aqui— el dia 3 no lo puede hacer
 * nadie que no sea admin: la API contesta 403 y la base tampoco le deja leer la
 * rejilla. Y con un is_erp_team() o un `role = 'employee'` en su lugar, un
 * usuario que no ha visto este modulo en su vida se baja QUE CLIENTES TENEMOS y
 * de que meses guardamos su informe fiscal llamando a PostgREST con la clave
 * anonima, que viaja dentro del JavaScript del ERP. No veria el boton; la base
 * le dejaria.
 *
 * `app_id` = 'tax-reports', LETRA POR LETRA igual que en lib/config/apps.ts,
 * que el mapa routeToAppId de middleware.ts y que el
 * requireAppAccess('tax-reports') de las cinco rutas de /api/tax-reports. Si
 * bailan, la pantalla se abre y la API contesta 403, o al reves.
 *
 * SECURITY DEFINER, como la 189: la evalua la RLS por cada fila y consulta dos
 * tablas que tienen sus propias politicas, asi que tiene que correr como la
 * duena o no veria la fila del permiso.
 *
 * EL search_path FIJO NO ESTA EN LA 189 Y AQUI SI, a proposito: es una funcion
 * SECURITY DEFINER, o sea que corre con privilegios que no son los del que
 * llama, y sin fijarlo un esquema colado delante de `public` hace que
 * `profiles` o `user_app_permissions` signifiquen otra cosa. Es ademas lo que
 * ya hacen las otras tres funciones de este mismo fichero y lo que pide el
 * aviso «function_search_path_mutable» del linter de Supabase.
 */
CREATE OR REPLACE FUNCTION public.puede_ver_tax_reports(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = uid AND p.role IN ('admin', 'partner')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_app_permissions up
      WHERE up.user_id = uid
        AND up.app_id = 'tax-reports'
        AND up.can_access = true
    );
$$;

COMMENT ON FUNCTION public.puede_ver_tax_reports(UUID) IS
  'Admin y partner siempre; el resto solo con el permiso suelto tax-reports, que es el mismo que abre el modulo. No vale el rol de empleado a secas: dentro de estos ficheros van ciudad, codigo postal y Order ID de los compradores de cada cliente. Mismo patron que puede_borrar_mapeo en la 189.';

-- El nombre de las politicas cambia con el criterio: una que se llame «Admins
-- read» y deje entrar a un empleado con permiso es una trampa para el que la
-- lea dentro de un ano. El DROP del nombre viejo se queda para que relanzar
-- esto sobre una base donde ya se lanzo la version anterior no deje las dos.
DROP POLICY IF EXISTS "Admins read tax report clientes" ON public.tax_report_clientes;
DROP POLICY IF EXISTS "Quien tiene Tax Reports lee los clientes" ON public.tax_report_clientes;
CREATE POLICY "Quien tiene Tax Reports lee los clientes"
  ON public.tax_report_clientes FOR SELECT TO authenticated
  USING (public.puede_ver_tax_reports(auth.uid()));

DROP POLICY IF EXISTS "Admins read tax report ficheros" ON public.tax_report_ficheros;
DROP POLICY IF EXISTS "Quien tiene Tax Reports lee los meses" ON public.tax_report_ficheros;
CREATE POLICY "Quien tiene Tax Reports lee los meses"
  ON public.tax_report_ficheros FOR SELECT TO authenticated
  USING (public.puede_ver_tax_reports(auth.uid()));

-- Las notas de mes salen por el mismo sitio que la rejilla y con el mismo
-- criterio: se leen dentro de la misma respuesta, asi que una politica mas laxa
-- aqui abriria por la puerta de al lado lo que las otras dos cierran.
DROP POLICY IF EXISTS "Quien tiene Tax Reports lee las notas del mes" ON public.tax_report_notas_mes;
CREATE POLICY "Quien tiene Tax Reports lee las notas del mes"
  ON public.tax_report_notas_mes FOR SELECT TO authenticated
  USING (public.puede_ver_tax_reports(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tax_report_clientes  FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tax_report_ficheros  FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tax_report_notas_mes FROM authenticated, anon;


/* ------------------------------------------------------------------ */
/* 3) EL BUCKET, PRIVADO                                               */
/* ------------------------------------------------------------------ */
--
-- POR QUE `DO UPDATE` Y NO EL `DO NOTHING` QUE USAN LA 005, LA 045 Y LA 094:
-- si alguien creo antes este bucket a mano desde el panel de Supabase —que es
-- como se trabaja la mitad de las veces en este repo— DO NOTHING deja lo que
-- hubiera. Y lo que hubiera puede ser public = true, que es justo lo unico que
-- esta migracion existe para impedir. Con DO UPDATE, relanzar el fichero vuelve
-- a ponerlo privado, que es lo que aqui tiene que ser idempotente.
--
-- EL TOPE SON 10 MB y no los 50 o 100 de los otros buckets. Un tax report real
-- son ~170 KB; un tablero de Sellerboard en xlsx con un ano entero y muchas
-- referencias se va a 2-5 MB. 10 MB deja margen de sobra y sigue cortando a
-- quien intente aparcar ahi otra cosa.
--
-- LOS CUATRO TIPOS, Y NI UNO MAS:
--   text/csv                                       el caso normal
--   text/plain                                     el informe de Amazon baja a
--                                                  veces separado por tabuladores
--   application/vnd.ms-excel                       lo que manda Windows para un
--                                                  .csv cuando hay Excel instalado
--   application/vnd.openxmlformats-...spreadsheet  el .xlsx de Sellerboard
--
-- NADA DE PDF, a proposito: ni el tax report ni el informe de Sellerboard son
-- PDF, y admitirlo invita a aparcar facturas y contratos en un sitio que borra
-- a los seis meses. Nada de application/octet-stream ni de comodines: eso anula
-- la lista entera.
--
-- Y OJO CON LO QUE ESTA LISTA COMPRUEBA: la CABECERA Content-Type de la
-- peticion, no el fichero. El `file.type` que da el navegador para un .csv es
-- un cara o cruz (text/csv, application/vnd.ms-excel, text/plain o cadena
-- vacia), asi que la ruta de servidor NO se fia de el: valida la EXTENSION y
-- decide ella el contentType que le pasa a upload(). Esto es el segundo
-- cinturon, para el dia que alguien suba desde otro sitio.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tax-reports',
  'tax-reports',
  false,                 -- LA LINEA
  10485760,              -- 10 MB
  ARRAY[
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


/* ------------------------------------------------------------------ */
/* 4) QUE NO QUEDE NINGUNA PUERTA EN storage.objects                   */
/* ------------------------------------------------------------------ */
--
-- Aqui NO se crea ninguna politica. Las quince que ya hay en el repo estan
-- todas acotadas con `bucket_id = '...'`, asi que ninguna alcanza a esta; pero
-- lo creado desde el panel no esta en el repo, y por eso se mira en vivo.
--
-- AVISO PRACTICO: el DROP POLICY sobre storage.objects puede contestar «must be
-- owner of table objects» segun con que rol se pegue esto en el editor SQL —en
-- los proyectos nuevos la duena de esa tabla es supabase_storage_admin, no
-- postgres—. Si pasa, esas politicas se quitan desde Storage > Policies en el
-- panel.
--
-- Y POR ESO EL DROP VA DENTRO DE SU PROPIO BLOQUE CON `EXCEPTION`: sin eso, ese
-- error aborta la migracion ENTERA justo en el unico caso en que este bloque
-- hace algo —que alguien haya creado una politica a mano—, y ademas la deja sin
-- poder relanzarse, que es lo contrario de lo que promete la cabecera. Con el
-- handler, el fallo baja a WARNING, la migracion termina de montarlo todo y
-- queda dicho por pantalla que hay una politica que hay que quitar a mano.
--
-- Se captura `insufficient_privilege` Y `undefined_object`, este ultimo para la
-- carrera boba de que otro quite la politica entre el SELECT y el DROP.

DO $$
DECLARE
  p RECORD;
  quitadas INTEGER := 0;
  fallidas INTEGER := 0;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (COALESCE(qual, '') LIKE '%tax-reports%'
         OR COALESCE(with_check, '') LIKE '%tax-reports%')
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
      quitadas := quitadas + 1;
      RAISE NOTICE '200 · quitada la politica «%» de storage.objects', p.policyname;
    EXCEPTION
      WHEN insufficient_privilege OR undefined_object THEN
        fallidas := fallidas + 1;
        RAISE WARNING
          '200 · NO se ha podido quitar la politica «%» de storage.objects (%). Quitala a mano desde Storage > Policies: mientras siga ahi, el bucket tax-reports tiene una puerta que no es la clave de servicio.',
          p.policyname, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '200 · politicas de storage que mencionaban tax-reports: % quitadas, % que hay que quitar a mano.',
    quitadas, fallidas;
END $$;

DO $$
DECLARE
  fila RECORD;
  sueltas INTEGER := 0;
  es_publico BOOLEAN;
BEGIN
  SELECT b.public INTO es_publico FROM storage.buckets b WHERE b.id = 'tax-reports';

  IF es_publico IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      '200 · el bucket tax-reports NO ha quedado privado (public = %). Parar aqui: con public = true basta la ruta del fichero para bajarse los datos de comprador de un cliente sin ninguna sesion.', es_publico;
  END IF;

  /*
   * SE BUSCA LA POLITICA QUE NO FILTRA POR BUCKET, no la que nombra a esta.
   *
   * Una politica sobre storage.objects sin `bucket_id = ...` alcanza a TODOS
   * los buckets, el nuevo incluido, y es la unica forma de que esto quede
   * abierto sin que la cadena 'tax-reports' aparezca en ningun sitio. Una
   * comprobacion que solo mirara el caso facil seria peor que no comprobar:
   * dejaria un NOTICE diciendo que todo esta cerrado.
   */
  FOR fila IN
    SELECT policyname, cmd, roles FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND COALESCE(qual, '')       NOT LIKE '%bucket_id%'
       AND COALESCE(with_check, '') NOT LIKE '%bucket_id%'
  LOOP
    sueltas := sueltas + 1;
    RAISE WARNING
      '200 · MIRA ESTA: «%» sobre storage.objects no filtra por bucket_id (cmd = %, roles = %). Alcanza TAMBIEN a tax-reports.',
      fila.policyname, fila.cmd, fila.roles;
  END LOOP;

  IF sueltas = 0 THEN
    RAISE NOTICE '200 · bucket privado y sin ninguna politica que llegue a el: solo entra la clave de servicio.';
  END IF;
END $$;


/* ------------------------------------------------------------------ */
/* 5) LA SIEMBRA DESDE LOS CLIENTES DE COMISIONES                      */
/* ------------------------------------------------------------------ */
--
-- Con un SELECT sobre public.clients y no con una lista escrita a mano: en las
-- migraciones hay diez sembrados, pero puede haber mas dados de alta desde la
-- pantalla, y una lista escrita aqui nace desactualizada.
--
-- EL upper() NO ES ADORNO. En la base estan escritos 'Lenobotics' y
-- 'Creative Toys' (migraciones 007 y 027), y Raul los escribe «LENOBOTICS» y
-- «creative toys». Un IN ('LENOBOTICS', 'Creative Toys') a secas dejaria a
-- Lenobotics con tax_report, y eso no se ve hasta que el cliente recibe el
-- fichero que no era.
--
-- El NOT EXISTS mira las DOS cosas —el vinculo y el nombre— para que relanzar
-- esto despues de haber renombrado a alguien desde la pantalla no le cree un
-- duplicado con el nombre viejo.
--
-- Y no hay DO UPDATE de `tipo_fichero`, por el mismo criterio que la 138 con
-- cron_config: relanzar la migracion no puede pisar un tipo que ya se haya
-- cambiado a mano.

-- EL NOMBRE SE SIEMBRA RECORTADO Y SE SALTAN LOS VACIOS, y no es remilgo: la
-- columna `nombre` lleva CHECK (btrim(nombre) <> ''), asi que UNA sola fila de
-- public.clients con el nombre en blanco —o a NULL— hace saltar el CHECK y
-- ABORTA LA MIGRACION ENTERA, con las tablas ya creadas y sin sembrar. Un
-- cliente sin nombre no se puede poner en una rejilla de todas formas: se deja
-- fuera y se avisa abajo con el recuento.
--
-- Y el btrim al insertar, porque «DIRU » y «DIRU» son dos filas distintas para
-- el UNIQUE de la base y dos sitios donde colgar el informe de agosto.
--
-- EL `DISTINCT ON (upper(btrim(...)))` TAMPOCO ES ADORNO, y es el mismo fallo
-- que el upper() de arriba visto por el otro lado. El NOT EXISTS mira la tabla
-- TAL Y COMO ESTABA AL EMPEZAR LA SENTENCIA: no ve las filas que esta misma
-- sentencia esta metiendo. Asi que si en public.clients conviven «Creative Toys»
-- y «CREATIVE TOYS» —que ahi son dos filas legales, porque su UNIQUE distingue
-- mayusculas—, las dos pasan el filtro, las dos se insertan con nombres
-- distintos y el ON CONFLICT (nombre) no las ve chocar. Resultado: DOS FILAS
-- PARA EL MISMO CLIENTE en la rejilla, y el dia 3 el informe de agosto colgado
-- en una de las dos al azar.
INSERT INTO public.tax_report_clientes (nombre, client_id, tipo_fichero)
SELECT DISTINCT ON (upper(btrim(c.name)))
       btrim(c.name),
       c.id,
       -- Escrito como se lee en la pantalla, que es para lo unico que sirve
       -- este valor desde que dejo de ser una lista cerrada.
       CASE WHEN upper(btrim(c.name)) IN ('LENOBOTICS', 'CREATIVE TOYS')
            THEN 'Sellerboard' ELSE 'Tax report' END
  FROM public.clients c
 WHERE c.name IS NOT NULL
   AND btrim(c.name) <> ''
   AND NOT EXISTS (
         SELECT 1 FROM public.tax_report_clientes t
          WHERE t.client_id = c.id
             OR upper(btrim(t.nombre)) = upper(btrim(c.name))
       )
 ORDER BY upper(btrim(c.name)), c.id
ON CONFLICT (nombre) DO NOTHING;


/* ------------------------------------------------------------------ */
/* 6) EL BORRADO A LOS SEIS MESES                                      */
/* ------------------------------------------------------------------ */
--
-- ============ POR QUE ESTO NO ES UNA REGLA MAS DE limpieza.ts ============
--
-- lib/plataforma/limpieza.ts ya purga once tablas, y lo hace cada minuto. Pero
-- BORRA FILAS: no toca Storage ni sabe que existe. El propio fichero lo dice en
-- la regla de marketing_informes («aqui no se libera espacio de ficheros: lo
-- que se quita son filas»).
--
-- Meter tax_report_ficheros en esa lista tal cual seria EL PEOR DE LOS DOS
-- MUNDOS: desaparece la fila —o sea el unico indice de que ese fichero
-- existe— y el CSV con los datos de comprador se queda en el bucket PARA
-- SIEMPRE, sin que ninguna pantalla ni ninguna purga vuelva a mencionarlo.
--
-- Por eso la purga va en dos tiempos y en este orden, que no es negociable:
--
--   1. `tax_report_pendientes_de_purga()` dice que ficheros tocan.
--   2. El servidor los borra DEL BUCKET con la clave de servicio.
--   3. Solo si eso sale bien, `tax_report_marcar_purgados()` apaga la ruta.
--
-- AL REVES NO: si se marca primero y el borrado del objeto falla, la fila ya no
-- apunta a nada y el fichero se queda huerfano, sin que nadie lo vuelva a
-- encontrar. Con este orden, un fallo simplemente se reintenta en la pasada
-- siguiente.
--
-- Y LA FILA NO SE BORRA. Si se borrara, la celda de marzo volveria a verse
-- VACIA, que en esta pantalla significa «falta por subir», y el dia 3 alguien
-- colgaria otra vez un fichero que habiamos decidido no guardar. Con la fila,
-- la celda dice «se mando el 4 de marzo, retirado el 4 de septiembre».
--
-- EL RELOJ ES `subido_at`, NO EL MES DEL INFORME. Contar desde el mes al que se
-- refiere borraria a los pocos dias un informe viejo recien subido. El fichero
-- existe para poder mandarlo: seis meses desde que existe.

CREATE OR REPLACE FUNCTION public.tax_report_pendientes_de_purga(
  p_dias INTEGER DEFAULT 183,   -- seis meses
  p_tope INTEGER DEFAULT 200
)
RETURNS TABLE (id UUID, ruta TEXT)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT f.id, f.ruta
    FROM public.tax_report_ficheros f
   WHERE f.ruta IS NOT NULL
     AND f.subido_at < NOW() - make_interval(days => p_dias)
   ORDER BY f.subido_at
   LIMIT p_tope;
$$;

COMMENT ON FUNCTION public.tax_report_pendientes_de_purga(INTEGER, INTEGER) IS
  'Que ficheros del bucket tax-reports pasan de los seis meses. NO borra nada: solo los nombra. El objeto lo borra el servidor con la clave de servicio, y DESPUES se llama a tax_report_marcar_purgados. Al reves quedarian huerfanos que nadie volveria a encontrar.';

CREATE OR REPLACE FUNCTION public.tax_report_marcar_purgados(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE marcados INTEGER;
BEGIN
  UPDATE public.tax_report_ficheros
     SET ruta = NULL,
         purgado_at = NOW()
   WHERE id = ANY (p_ids)
     AND ruta IS NOT NULL;

  GET DIAGNOSTICS marcados = ROW_COUNT;
  RETURN marcados;
END $$;

COMMENT ON FUNCTION public.tax_report_marcar_purgados(UUID[]) IS
  'Apaga la ruta y apunta purgado_at. Se llama SOLO despues de haber borrado el objeto del bucket. La fila se queda: sin ella la celda volveria a verse vacia, que en esta pantalla significa «falta por subir», y el dia 3 se subiria otra vez lo que habiamos decidido no guardar.';

/**
 * SE REVOCA A `PUBLIC`, NO A `authenticated, anon`, Y ESA DIFERENCIA ES TODA LA
 * DIFERENCIA.
 *
 * Postgres concede EXECUTE a PUBLIC en toda funcion nueva, y PostgREST expone
 * como RPC lo que hay en el esquema `public`. Un
 *
 *     REVOKE ALL ON FUNCTION ... FROM authenticated, anon;
 *
 * —que es lo que se escribe de memoria copiando los REVOKE de tabla de la 118—
 * NO quita el permiso de PUBLIC, asi que la funcion seguiria llamandose con la
 * clave anonima, que viaja dentro del JavaScript del ERP:
 *
 *     POST {SUPABASE_URL}/rest/v1/rpc/tax_report_marcar_purgados
 *     {"p_ids": ["...", "..."]}
 *
 * y eso apaga la `ruta` de las filas que le digas. El fichero se queda en el
 * bucket y NINGUNA fila vuelve a nombrarlo: ni la pantalla, ni la purga. O sea,
 * la forma exacta de dejar ficheros con datos de compradores ahi para siempre.
 *
 * Con el REVOKE a PUBLIC solo queda service_role, que es quien las llama desde
 * el servidor, y el dueno de la base.
 */
REVOKE ALL ON FUNCTION public.tax_report_pendientes_de_purga(INTEGER, INTEGER) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.tax_report_marcar_purgados(UUID[]) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.tax_report_pendientes_de_purga(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.tax_report_marcar_purgados(UUID[]) TO service_role;


/* ------------------------------------------------------------------ */
/* 7) RECUENTO                                                         */
/* ------------------------------------------------------------------ */
-- Lo que sale por pantalla no es decorativo: si el numero de clientes con
-- Sellerboard no es 2, la siembra no ha casado los nombres y hay que mirarlo
-- ANTES de que salga el primer correo con el fichero equivocado.

DO $$
DECLARE
  n_clientes INTEGER;
  n_sb       INTEGER;
  nombres_sb TEXT;
  n_grants   INTEGER;
  n_sin_nombre INTEGER;
  abierta    TEXT := NULL;
  rol        TEXT;
  fn         TEXT;
BEGIN
  SELECT COUNT(*) INTO n_clientes FROM public.tax_report_clientes;

  -- Se cuenta con upper(btrim(...)) y no con el valor exacto: la columna es
  -- texto libre desde este cambio, asi que «Sellerboard» y «sellerboard» son
  -- el mismo trato escrito por dos personas distintas. Contar solo el exacto
  -- haria saltar el aviso de abajo por una mayuscula y acabaria en que nadie
  -- se lo cree el dia que avise de verdad.
  SELECT COUNT(*), string_agg(nombre, ', ' ORDER BY nombre)
    INTO n_sb, nombres_sb
    FROM public.tax_report_clientes
   WHERE upper(btrim(tipo_fichero)) = 'SELLERBOARD';

  SELECT COUNT(*) INTO n_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('tax_report_clientes', 'tax_report_ficheros', 'tax_report_notas_mes')
     AND grantee IN ('authenticated', 'anon')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  IF n_grants > 0 THEN
    RAISE WARNING
      '200 · han quedado % permisos de escritura para authenticated/anon en las tablas de Tax Reports. Todas las escrituras tienen que pasar por las rutas de servidor.', n_grants;
  END IF;

  /*
   * QUE NINGUNA DE LAS **DOS** FUNCIONES DE LA PURGA SE PUEDA LLAMAR POR RPC
   * DESDE EL NAVEGADOR. Ver el REVOKE a PUBLIC del bloque 6: es el fallo que no
   * se ve.
   *
   * Se recorren las dos y los dos roles en un bucle, y no con un IF escrito a
   * mano, por dos motivos que ya han mordido aqui:
   *
   *   · La version anterior solo miraba `marcar_purgados`. `pendientes_de_purga`
   *     es la que DEVUELVE las rutas de los objetos del bucket: llamable con la
   *     clave anonima, entrega la lista de claves de todos los ficheros con
   *     datos de comprador que quedan por retirar.
   *   · has_function_privilege LANZA si el rol o la funcion no existen, y este
   *     bloque es el ultimo de la migracion: un proyecto sin el rol `anon` —o el
   *     dia que a una de las dos funciones se le cambie la firma— haria fallar
   *     y revertir TODO lo de arriba por una comprobacion. De ahi el guardarrail
   *     con pg_roles y to_regprocedure antes de preguntar.
   */
  FOREACH fn IN ARRAY ARRAY[
    'public.tax_report_pendientes_de_purga(integer, integer)',
    'public.tax_report_marcar_purgados(uuid[])'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE WARNING '200 · no existe %, asi que la purga de los seis meses no se puede ejecutar. Repasa el bloque 6.', fn;
      CONTINUE;
    END IF;

    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol)
         AND has_function_privilege(rol, fn, 'EXECUTE') THEN
        abierta := COALESCE(abierta || ', ', '') || fn || ' (' || rol || ')';
      END IF;
    END LOOP;
  END LOOP;

  IF abierta IS NOT NULL THEN
    RAISE WARNING
      '200 · estas funciones de la purga siguen siendo llamables con la clave anonima: %. Con marcar_purgados se apagan las rutas de todas las filas y los ficheros se quedan en el bucket sin que nada los nombre; con pendientes_de_purga se saca la lista de claves de los que aun estan. Repasa el REVOKE ... FROM PUBLIC del bloque 6.',
      abierta;
  END IF;

  RAISE NOTICE '200 · clientes en Tax Reports: % (de ellos % con Sellerboard: %)',
    n_clientes, n_sb, COALESCE(nombres_sb, 'ninguno');

  -- Los que la siembra ha dejado fuera por no tener nombre. Sin esta linea
  -- desaparecerian en silencio y el dia 3 faltaria una fila que nadie echa de
  -- menos porque nunca estuvo.
  SELECT COUNT(*) INTO n_sin_nombre
    FROM public.clients c
   WHERE c.name IS NULL OR btrim(c.name) = '';

  IF n_sin_nombre > 0 THEN
    RAISE WARNING
      '200 · % cliente(s) de public.clients se han quedado fuera de la rejilla por no tener nombre. Ponles nombre alli y vuelve a pegar esta migracion, o dalos de alta a mano desde la pantalla.', n_sin_nombre;
  END IF;

  IF n_sb <> 2 THEN
    RAISE WARNING
      '200 · se esperaban DOS clientes con Sellerboard (Lenobotics y Creative Toys) y hay %. Repasa como estan escritos los nombres en public.clients antes de mandar ningun correo.', n_sb;
  END IF;
END $$;
