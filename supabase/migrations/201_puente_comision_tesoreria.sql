-- ============================================================================
-- 201 · EL PUENTE ENTRE EL CLIENTE DE COMISIONES Y EL CLIENTE DE TESORERÍA
-- ============================================================================
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a
-- pegar entera sin romper nada ni perder ningún enlace ya hecho.
--
--
-- ============ EL AGUJERO QUE TAPA ============
--
-- En este ERP hay DOS listas de clientes que hablan del mismo negocio:
--
--   · public.clients           — 11 filas. La de COMISIONES. De aquí sale el
--                                cálculo de app/api/commissions/process.
--   · public.treasury_clients  — 20 filas (17 activas). La de TESORERÍA. Aquí
--                                viven `fee` y `commission` de cada mes, y de
--                                aquí salen las facturas (migración 176).
--
-- NO ESTÁN UNIDAS POR NINGUNA COLUMNA. Hoy las cuadra una persona mirando los
-- dos nombres, y los nombres no se parecen: de los once clientes de comisiones,
-- SOLO CINCO coinciden por nombre con su fila de Tesorería (Bodegas Valhalla,
-- Creative Toys, DIRU, Keslem y SHOPLAMP/Shoplamp, este último solo ignorando
-- mayúsculas). Los otros seis no se parecen en nada:
--
--     Farmacia Garrachon  ->  Eduardo Gómez
--     Lenobotics          ->  Ocio Global Import S.L
--     ShoesF              ->  Zapaterias Basoco S.L
--     Ham Master          ->  GFY Logis tic S.L
--     HamMaster Cuenta secundaria -> GFY Logis tic S.L
--     SAUSI               ->  ASAUSIN  (probable, sin importes que lo confirmen)
--
-- Mientras ese enlace no exista, el cálculo de la comisión no sabe EN QUÉ FILA
-- de Tesorería escribir, y por eso el número se copia a mano de una pantalla a
-- otra. Esta columna es lo único que falta para que deje de copiarse.
--
--
-- ============ POR QUÉ LA COLUMNA VA EN `clients` Y NO EN `treasury_clients` ==
--
-- Tres motivos, y el tercero es el que decide:
--
--   1. Es la dirección que ya usa todo lo demás: `tax_report_clientes.client_id
--      -> clients` (migración 200) e `invoices.treasury_client_id ->
--      treasury_clients` (migración 176). Una cuarta relación en sentido
--      contrario obligaría a leerse las cuatro para saber hacia dónde apunta
--      cada una.
--   2. Hay 20 clientes de Tesorería y 11 de comisiones: puesta en
--      `treasury_clients`, la mayoría de las filas nunca tendría valor.
--   3. Quien necesita el enlace es el que calcula la comisión, y el que calcula
--      la comisión parte SIEMPRE de `clients`. La consulta que hace falta es
--      «este cliente de comisiones, ¿en qué cliente de Tesorería escribe?», y
--      así se contesta sin ningún JOIN de vuelta.
--
--
-- ============ EL ÍNDICE ÚNICO PARCIAL, Y EL CASO HAM MASTER ============
--
-- El índice es UNIQUE sobre `treasury_client_id` WHERE NOT NULL. O sea: DOS
-- clientes de comisiones no pueden apuntar al mismo cliente de Tesorería.
--
-- Y hay que decirlo claro, porque HOY ESO YA PASA: `Ham Master` y `HamMaster
-- Cuenta secundaria` son dos cuentas de Amazon distintas, con dos cálculos
-- distintos, que se facturan a UNA SOLA sociedad — GFY Logis tic S.L. Como
-- `treasury_client_months` tiene UNIQUE (client_id, period), en ese mes solo
-- cabe una fila, y el apaño que hay montado es meter la comisión de la cuenta
-- principal en la columna `fee` y la de la secundaria en `commission`.
--
-- Comprobado contra la base, septiembre de 2026:
--     Ham Master                   134,02  ->  escrito en `fee`
--     HamMaster Cuenta secundaria  147,39  ->  escrito en `commission`
--
-- SIN ESTE ÍNDICE, las dos cuentas podrían enlazarse a GFY y la segunda que se
-- guardara BORRARÍA la comisión de la primera, sin avisar, en la misma celda, y
-- el error solo se vería en el importe de la factura. Con el índice, la segunda
-- no se puede enlazar: la pantalla dice en voz alta que esa fila de Tesorería ya
-- la tiene otro cliente, y esa cuenta se sigue escribiendo a mano como hasta
-- hoy. Se prefiere un enlace que falta —que se ve— a un importe pisado —que no—.
--
-- LO QUE QUEDA POR DECIDIR, Y NO LO DECIDE ESTA MIGRACIÓN: qué se hace con Ham
-- Master. Las dos salidas razonables son sumar las dos comisiones en la misma
-- celda, o darle a `treasury_client_months` una segunda columna de comisión.
-- Las dos cambian lo que factura `app/api/facturacion/emitir`, así que es una
-- decisión de Raúl y no del ERP, y mientras no esté tomada el apaño de las dos
-- columnas sigue funcionando exactamente igual que hoy.
--
--
-- ============ AQUÍ NO SE SIEMBRA NI UN ENLACE ============
--
-- La tentación es obvia: normalizar los dos nombres y casar los que coincidan.
-- NO SE HACE, y no es prudencia de adorno: acierta 5 de 11, y el precio de las
-- otras 6 es escribir la comisión de un cliente en la factura de otro. Un enlace
-- que falta lo ve quien abre la pantalla; un enlace equivocado lo ve el cliente
-- que recibe la factura.
--
-- Lo que sí hace esta migración es IMPRIMIR las parejas que se parecen, al final
-- y como aviso, para que quien la lanza sepa cuáles va a poder confirmar de un
-- vistazo. La pantalla de liquidación hace lo mismo: propone la más parecida en
-- un desplegable, con el fee y la comisión de los últimos meses al lado, y no
-- elige sola.
--
--
-- ============ LO QUE NO TOCA ============
--
-- Ni `treasury_client_months`, ni `invoices`, ni ninguna política RLS, ni el
-- cálculo. Lo que deja puesto es UNA columna y UN índice: la función auxiliar
-- del bloque 3 se borra en el bloque 5, y no se escribe ni una fila. El resto de
-- este encargo es código.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 0) GUARDARRAÍL: QUE LAS DOS TABLAS EXISTAN                          */
/* ------------------------------------------------------------------ */
--
-- Si se pega esto en un proyecto donde falta la 176, el ALTER daría un error de
-- «relation does not exist» que no le dice a nadie qué hay que lanzar antes.

DO $$
BEGIN
  IF to_regclass('public.clients') IS NULL THEN
    RAISE EXCEPTION '201 · no existe public.clients. Esta migración enlaza las dos listas de clientes: sin la de comisiones no hay nada que enlazar.';
  END IF;

  IF to_regclass('public.treasury_clients') IS NULL THEN
    RAISE EXCEPTION '201 · no existe public.treasury_clients. Falta lanzar antes la migración 176 (Tesorería y facturación).';
  END IF;
END $$;


/* ------------------------------------------------------------------ */
/* 1) LA COLUMNA                                                       */
/* ------------------------------------------------------------------ */
--
-- ON DELETE SET NULL y no CASCADE: si alguien borra una sociedad de Tesorería,
-- el cliente de comisiones TIENE que seguir existiendo —sus once informes
-- guardados cuelgan de él— y lo único que se pierde es el enlace, que se vuelve
-- a elegir en la pantalla. Con CASCADE, borrar una fila de Tesorería se llevaría
-- por delante el historial de comisiones de ese cliente.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS treasury_client_id UUID
    REFERENCES public.treasury_clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.clients.treasury_client_id IS
  'En qué cliente de Tesorería se escribe la comisión calculada para este cliente de comisiones. NULL = todavía no se ha emparejado, y entonces la pantalla de liquidación no deja guardar. Se elige a mano: los nombres de las dos listas solo coinciden en 5 de 11 casos. Único (índice parcial clients_treasury_client_id_uniq): dos clientes de comisiones apuntando a la misma fila de Tesorería se pisarían el mes, porque treasury_client_months tiene UNIQUE (client_id, period).';


/* ------------------------------------------------------------------ */
/* 2) UN CLIENTE DE TESORERÍA, UN CLIENTE DE COMISIONES                */
/* ------------------------------------------------------------------ */
--
-- Parcial (WHERE NOT NULL) porque los NULL no chocan entre sí en un índice
-- único de Postgres, pero se escribe explícito para que se lea lo que quiere
-- decir: los que faltan por enlazar no se estorban.
--
-- Va dentro de un bloque con captura de error a propósito. Si esta migración se
-- lanza sobre una base donde alguien ya rellenó la columna a mano y duplicó un
-- destino, `CREATE UNIQUE INDEX` fallaría y se llevaría por delante TODO lo de
-- abajo. Así el índice no se crea, se avisa con los nombres exactos, y el resto
-- de la migración termina.

DO $$
DECLARE
  duplicados TEXT;
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS clients_treasury_client_id_uniq
      ON public.clients (treasury_client_id)
      WHERE treasury_client_id IS NOT NULL;
  EXCEPTION WHEN unique_violation THEN
    SELECT string_agg(t.name || ' <- ' || c.nombres, E'\n     ')
      INTO duplicados
      FROM (
        SELECT treasury_client_id, string_agg(name, ' + ' ORDER BY name) AS nombres
          FROM public.clients
         WHERE treasury_client_id IS NOT NULL
         GROUP BY treasury_client_id
        HAVING COUNT(*) > 1
      ) c
      JOIN public.treasury_clients t ON t.id = c.treasury_client_id;

    RAISE WARNING
      '201 · el índice único NO se ha podido crear: hay filas de Tesorería con más de un cliente de comisiones apuntando a ellas: %. Deja una sola y vuelve a pegar esta migración. Mientras tanto, dos cálculos escriben en la misma celda y el segundo borra al primero.',
      COALESCE(duplicados, 'míralas con: SELECT treasury_client_id, count(*) FROM public.clients GROUP BY 1 HAVING count(*) > 1');
  END;
END $$;


/* ------------------------------------------------------------------ */
/* 3) LAS PAREJAS QUE SE PARECEN — SE IMPRIMEN, NO SE ESCRIBEN         */
/* ------------------------------------------------------------------ */
--
-- Mismo normalizado que `normalizarNombre()` de lib/facturacion/tipos.ts, que es
-- el que usa la pantalla de liquidación para marcar «se llama igual»: minúsculas,
-- sin tildes, y TODO lo que no sea letra o número convertido en un espacio. Nada
-- más: ni quitar «S.L», ni parecidos por letras. Un parecido flojo impreso aquí
-- invita a confirmarlo sin mirar, que es exactamente lo que no queremos.
--
-- Y TIENE QUE SER EL MISMO, AL PIE DE LA LETRA. Lo que se imprime aquí es lo que
-- quien lanza la migración da por bueno de un vistazo; lo que marca la pantalla
-- es lo que va a ver después al elegir la pareja. Si los dos criterios no
-- coinciden, la migración anuncia una pareja que luego la pantalla no propone
-- —o al revés—, y la reacción normal a eso es elegir a mano deprisa, que es el
-- único camino por el que la comisión de un cliente acaba en la factura de otro.
--
-- Antes aquí había un `lower(btrim(translate(...)))` a secas, sin quitar la
-- puntuación, y NO era el mismo criterio: con él «GFY Logis tic S.L» y
-- «GFY Logistic SL» son nombres distintos, y «Shoplamp.» no coincide con
-- «Shoplamp». El comentario decía que sí lo era. Ahora lo es de verdad.
--
-- La función se crea, se usa y se borra dentro de esta misma migración: es un
-- apaño para imprimir un aviso, no una herramienta que deba quedarse en el
-- esquema donde alguien la encuentre y la use para casar clientes de verdad.

CREATE OR REPLACE FUNCTION public.norm_nombre_201(valor TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT btrim(regexp_replace(
    lower(translate(COALESCE(valor, ''),
      'áàäâéèëêíìïîóòöôúùüûñçÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ',
      'aaaaeeeeiiiioooouuuuncAAAAEEEEIIIIOOOOUUUUNC')),
    '[^a-z0-9]+', ' ', 'g'))
$fn$;

DO $$
DECLARE
  fila RECORD;
  n_sug INTEGER := 0;
BEGIN
  FOR fila IN
    WITH comisiones AS (
      SELECT id, name, public.norm_nombre_201(name) AS norm
        FROM public.clients
       WHERE treasury_client_id IS NULL
         AND name IS NOT NULL AND btrim(name) <> ''
    ),
    tesoreria AS (
      SELECT id, name, public.norm_nombre_201(name) AS norm
        FROM public.treasury_clients
       WHERE name IS NOT NULL AND btrim(name) <> ''
    )
    SELECT c.name AS cliente, t.name AS destino
      FROM comisiones c
      JOIN tesoreria t ON t.norm = c.norm
     ORDER BY c.name
  LOOP
    n_sug := n_sug + 1;
    RAISE NOTICE '201 · sugerencia (NO escrita): «%» se llama igual que «%» en Tesorería.', fila.cliente, fila.destino;
  END LOOP;

  IF n_sug = 0 THEN
    RAISE NOTICE '201 · ninguna pareja coincide por nombre. Todas se eligen a mano en la pantalla de liquidación.';
  END IF;
END $$;


/* ------------------------------------------------------------------ */
/* 4) COMPROBACIÓN: QUIÉN SIGUE SIN ENLAZAR                            */
/* ------------------------------------------------------------------ */
--
-- Es el dato que importa después de pegar esto: la columna existe, pero no vale
-- para nada hasta que alguien elija las parejas. Si esto dice 11 de 11, la
-- pantalla de liquidación no va a poder guardar ni un importe todavía, y eso es
-- lo normal el primer día.

DO $$
DECLARE
  total        INTEGER;
  enlazados    INTEGER;
  sin_enlazar  INTEGER;
  nombres      TEXT;
  hay_indice   BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO total FROM public.clients;

  SELECT COUNT(*) INTO enlazados
    FROM public.clients WHERE treasury_client_id IS NOT NULL;

  SELECT COUNT(*), string_agg(name, ', ' ORDER BY name)
    INTO sin_enlazar, nombres
    FROM public.clients WHERE treasury_client_id IS NULL;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'clients_treasury_client_id_uniq'
  ) INTO hay_indice;

  RAISE NOTICE '201 · clientes de comisiones: % · con cliente de Tesorería: % · SIN ENLAZAR: %',
    total, enlazados, sin_enlazar;

  IF sin_enlazar > 0 THEN
    RAISE NOTICE '201 · faltan por emparejar: %', nombres;
    RAISE NOTICE '201 · se emparejan en Comisiones > Liquidación, eligiendo la fila de Tesorería en el desplegable. Hasta entonces, el cálculo de esos clientes se puede ver pero no guardar.';
  END IF;

  IF NOT hay_indice THEN
    RAISE WARNING '201 · falta el índice clients_treasury_client_id_uniq. Mira el aviso del bloque 2: hasta que exista, dos clientes de comisiones pueden apuntar al mismo mes de Tesorería y pisarse el importe.';
  END IF;
END $$;


/* ------------------------------------------------------------------ */
/* 5) RECOGER: FUERA LA FUNCIÓN DE APOYO                               */
/* ------------------------------------------------------------------ */
--
-- `norm_nombre_201` solo existía para imprimir el aviso del bloque 3. Se va.
--
-- No es manía de limpieza: una función que se queda en el esquema con pinta de
-- «normalizar nombres de cliente» es una invitación a escribir mañana un
-- `UPDATE clients SET treasury_client_id = ... WHERE norm_nombre_201(a) =
-- norm_nombre_201(b)`, que es EXACTAMENTE lo que esta migración se niega a
-- hacer: acierta 5 de 11, y las otras 6 son la comisión de un cliente en la
-- factura de otro. El parecido de nombre sirve para sugerir, no para decidir.
--
-- Va lo último para que se borre aunque el bloque 3 no haya encontrado ninguna
-- pareja, y con IF EXISTS para que relanzar la migración entera no falle aquí.

DROP FUNCTION IF EXISTS public.norm_nombre_201(TEXT);
