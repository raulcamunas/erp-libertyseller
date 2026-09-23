-- =====================================================
-- 199 · LOS INFORMES DE COMISIONES Y DE PPC SE LEÍAN ENTEROS SIN SESIÓN
-- =====================================================
-- Esta migración NO crea ni una tabla ni una columna. QUITA cuatro políticas de
-- lectura abiertas a todo el mundo y BORRA un dato que no debió guardarse.
--
-- Se lanza en el editor SQL de Supabase.
-- IDEMPOTENTE: se puede volver a pegar sin romper nada.
--
--
-- ============ EL ORDEN, Y NO ES NEGOCIABLE ============
--
-- EL CÓDIGO VA PRIMERO. Esta migración se lanza DESPUÉS de que esté desplegado
-- el cambio que hace que app/report/commissions/[slug] y app/report/ppc/[slug]
-- lean con la clave de servicio.
--
-- Al revés, los enlaces que ya están en manos de los clientes dejarían de abrir
-- hasta que entrara el despliegue. Es la misma nota que lleva la 136, y por el
-- mismo motivo.
--
--
-- ============ EL AGUJERO ============
--
-- La migración 011 creó esto:
--
--     CREATE POLICY "Public can read commission reports with slug"
--       ON public.commission_reports FOR SELECT TO anon, authenticated
--       USING (slug IS NOT NULL);
--
--     CREATE POLICY "Public can read clients for public reports"
--       ON public.clients FOR SELECT TO anon, authenticated
--       USING (true);
--
-- y la 019 hizo lo mismo con ppc_optimization_reports y ppc_clients.
--
-- `USING (slug IS NOT NULL)` NO acota a un slug. El `.eq('slug', …)` lo pone
-- quien consulta, y RLS no lo ve: la política concede TODAS las filas que
-- tengan slug. Y la de `clients` dice `true`, que es la tabla entera.
--
-- La NEXT_PUBLIC_SUPABASE_ANON_KEY viaja dentro del JavaScript de la web, o sea
-- que la tiene cualquiera que abra el ERP. Con ella bastaba una petición:
--
--     GET {SUPABASE_URL}/rest/v1/clients?select=*
--     GET {SUPABASE_URL}/rest/v1/commission_reports?select=*
--
-- para llevarse, sin adivinar ningún enlace:
--
--   · TODOS los clientes con su `base_commission_rate` y su
--     `tasa_marca_propia`. Las condiciones comerciales de la agencia, enteras.
--   · TODOS los informes de comisiones. Y dentro de `data` iba `originalCsv`:
--     el fichero de la Tax Document Library de Amazon TAL CUAL, que lleva fila
--     a fila la ciudad, el código postal y el país de entrega de cada pedido,
--     el Order ID y un enlace a la factura del comprador.
--   · Y lo mismo con los informes de PPC y sus clientes.
--
-- Lo de los compradores es lo que choca de frente con la spec firmada con
-- Amazon: «nada de PII de compradores». Lo de las tasas no choca con Amazon,
-- pero es peor de explicar.
--
-- NO ESTÁ REPRODUCIDO CONTRA PRODUCCIÓN a propósito: comprobarlo exigiría
-- pedirle a PostgREST datos personales de compradores para demostrar que se
-- pueden pedir. Lo que hay arriba es lo que dicen la 011 y la 019, que es
-- suficiente para saber qué conceden.
--
--
-- ============ POR QUÉ NO SE ROMPE NINGÚN ENLACE ============
--
-- Las dos páginas son COMPONENTES DE SERVIDOR: la consulta la hace el servidor y
-- el navegador nunca habla con PostgREST. Al pasarlas a la clave de servicio,
-- que se salta RLS, el `.eq('slug', …)` pasa a ser la única puerta: devuelve UN
-- informe, el de ese enlace.
--
-- MATIZ SOBRE PPC, porque «las dos páginas públicas» sería decirlo de más: hoy
-- /report/ppc/<slug> NO abre sin sesión. `middleware.ts` tiene en sus rutas
-- públicas '/report/commissions/' y '/audit/share/', pero no '/report/ppc/', así
-- que ese enlace redirige al login. Es anterior a esta migración y no lo arregla
-- —arreglarlo es una línea en el middleware, y hay que decidir antes si esos
-- enlaces se reparten—. Lo que sí hace la 199 es cerrar su tabla, que hasta hoy
-- se leía entera con la clave anónima aunque la página estuviera cerrada.
--
-- O sea que el cliente que tiene la URL la sigue abriendo igual, sin sesión, y
-- viendo lo mismo. Lo que desaparece es poder pedir la tabla entera.
--
-- La lectura desde dentro del ERP tampoco se toca: las políticas de
-- `authenticated` se quedan como están.
-- =====================================================


/* ------------------------------------------------------------------ */
/* 1) FUERA LAS CUATRO POLÍTICAS                                       */
/* ------------------------------------------------------------------ */

DO $$
DECLARE
  objetivo RECORD;
  quitadas INTEGER := 0;
BEGIN
  FOR objetivo IN
    SELECT * FROM (VALUES
      ('commission_reports',       'Public can read commission reports with slug'),
      ('clients',                  'Public can read clients for public reports'),
      ('ppc_optimization_reports', 'Public can read ppc optimization reports with slug'),
      ('ppc_clients',              'Public can read ppc clients for public reports')
    ) AS t(tabla, politica)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = objetivo.tabla
         AND policyname = objetivo.politica
    ) THEN
      EXECUTE format('DROP POLICY %I ON public.%I', objetivo.politica, objetivo.tabla);
      quitadas := quitadas + 1;
      RAISE NOTICE '199 · quitada «%» de %', objetivo.politica, objetivo.tabla;
    END IF;
  END LOOP;

  RAISE NOTICE '199 · politicas quitadas: %', quitadas;
END $$;


/* ------------------------------------------------------------------ */
/* 2) BORRAR EL CSV FISCAL QUE YA ESTÁ GUARDADO                        */
/* ------------------------------------------------------------------ */
--
-- Quitar la política cierra la puerta, pero el dato sigue dentro. Y sigue
-- viajando: la página pública manda `data` ENTERO al navegador para pintar el
-- informe, así que mientras `originalCsv` esté ahí, cualquiera con el enlace de
-- UN cliente se baja el fichero fiscal de ESE cliente mirando el HTML.
--
-- Se borra solo esa clave. El resto de `data` —los totales, las filas
-- calculadas, el desglose— es lo que el informe necesita para pintarse y no se
-- toca. `- 'originalCsv'` sobre un JSONB que no la tenga no da error, así que
-- esto se puede relanzar.

DO $$
DECLARE
  afectados INTEGER;
BEGIN
  UPDATE public.commission_reports
     SET data = data - 'originalCsv'
   WHERE data ? 'originalCsv';

  GET DIAGNOSTICS afectados = ROW_COUNT;
  RAISE NOTICE '199 · informes a los que se les ha quitado el CSV fiscal: %', afectados;
END $$;


/* ------------------------------------------------------------------ */
/* 3) COMPROBACIÓN                                                     */
/* ------------------------------------------------------------------ */
-- Si queda alguna política de SELECT para `anon` en estas cuatro tablas, es que
-- hay otra puerta que esta migración no conoce. Se avisa, no se falla: fallar
-- aquí desharía el borrado del bloque 2, que sí ha salido bien.

DO $$
DECLARE
  fila RECORD;
  restantes INTEGER := 0;
  quedanCsv INTEGER;
BEGIN
  /**
   * SE MIRAN TRES FORMAS, NO UNA. La comprobación obvia —cmd = 'SELECT' y
   * 'anon' = ANY(roles)— es CIEGA justo a las dos que más engañan:
   *
   *   · Una política creada SIN cláusula TO no sale con roles = {anon}: sale
   *     con roles = {public}. Y PUBLIC incluye a anon. Sobre estas mismas
   *     tablas ya hay dos así (007_create_commissions_tables.sql). Hoy no
   *     filtran nada porque su USING es auth.role() = 'authenticated', que para
   *     anon es falso, pero el día que alguien las toque, esta comprobación no
   *     se enteraría.
   *   · Una política FOR ALL sale con cmd = 'ALL', no 'SELECT', y concede el
   *     SELECT igualmente.
   *
   * Una comprobación que solo mira el caso fácil es peor que no comprobar: deja
   * un NOTICE diciendo que todo está cerrado.
   */
  FOR fila IN
    SELECT tablename, policyname, cmd, roles
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('commission_reports', 'clients', 'ppc_optimization_reports', 'ppc_clients')
       AND cmd IN ('SELECT', 'ALL')
       AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  LOOP
    restantes := restantes + 1;
    RAISE WARNING '199 · MIRA ESTA: «%» en % (cmd=%, roles=%). Comprueba su USING: si no acota a authenticated, la tabla se sigue leyendo sin sesion.', fila.policyname, fila.tablename, fila.cmd, fila.roles;
  END LOOP;

  SELECT COUNT(*) INTO quedanCsv
    FROM public.commission_reports WHERE data ? 'originalCsv';

  IF restantes = 0 AND quedanCsv = 0 THEN
    RAISE NOTICE '199 · listo: ni lectura anonima ni CSV fiscal guardado.';
  ELSE
    RAISE WARNING '199 · quedan % politicas anonimas y % informes con CSV fiscal dentro.',
      restantes, quedanCsv;
  END IF;
END $$;
