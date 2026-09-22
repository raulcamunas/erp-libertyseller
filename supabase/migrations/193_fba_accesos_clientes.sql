-- ============================================================================
-- 193 · REMESAS A FBA: APP PROPIA Y ACCESO PARA LOS CLIENTES
-- ============================================================================
--
-- Es la primera vez que alguien de FUERA de la agencia entra en el ERP. Eso
-- cambia el listón: hasta hoy bastaba con «admin o no admin»; ahora hay que
-- garantizar que un cliente ve SUS remesas y ni una fila de las de otro. Y
-- eso no lo puede garantizar la pantalla: lo tienen que garantizar la base y
-- las rutas, que es donde se decide de verdad.
--
--
-- ============ EL ROL 'cliente' ============
--
-- Un cuarto rol, aparte de admin, employee y partner. Un usuario 'cliente':
--
--   · entra SOLO en /dashboard/remesas. Cualquier otra ruta del ERP le rebota
--     ahí (middleware.ts). No ve el menú de la agencia.
--   · ve únicamente los clientes de amazon_clients que tenga en fba_accesos.
--   · puede crear y corregir remesas de esos clientes si `puede_editar`;
--     borrar, nunca. Borrar una remesa es tirar la contabilidad de un envío y
--     eso se queda en la agencia.
--
-- Las cuentas las crea el admin desde Gestión de usuarios, igual que las de
-- los empleados. No hay registro público y no se abre ninguno.
--
--
-- ============ POR QUÉ LAS RLS DE LECTURA SE REESCRIBEN ============
--
-- La 190 dejó las cuatro tablas de FBA en «solo admin lee». Ahora un cliente
-- también tiene que leer, pero SOLO lo suyo. La función que lo decide es una y
-- se usa en las cuatro políticas, para que no haya cuatro sitios donde
-- equivocarse.
--
-- Las escrituras siguen REVOCADAS desde el navegador: todo pasa por las rutas
-- de /api/fba, que comprueban el acceso Y filtran por cliente aunque usen la
-- clave de servicio. Ver lib/fba/acceso.ts.
-- ============================================================================


/* ------------------------------------------------------------------ */
/* 1) A qué clientes puede entrar cada usuario                          */
/* ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS public.fba_accesos (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,

  /** false = solo mira. true = además crea y corrige remesas. Borrar, nunca */
  puede_editar BOOLEAN NOT NULL DEFAULT false,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  PRIMARY KEY (user_id, client_id)
);

COMMENT ON TABLE public.fba_accesos IS
  'Qué clientes de amazon_clients puede ver cada usuario en Remesas a FBA. Un '
  'admin no necesita fila: ve todos. Un cliente sin fila no ve nada.';

CREATE INDEX IF NOT EXISTS fba_accesos_cliente_idx ON public.fba_accesos (client_id);


/* ------------------------------------------------------------------ */
/* 2) La función que decide, UNA para las cuatro tablas                 */
/* ------------------------------------------------------------------ */

/**
 * ¿Puede este usuario ver las remesas de este cliente?
 *
 * Admin: siempre. Cualquier otro: si tiene fila en fba_accesos. Un employee o
 * un partner de la agencia sin fila tampoco entra — Remesas a FBA es una app
 * con acceso explícito, no «todo el equipo la ve».
 *
 * SECURITY DEFINER para poder leer profiles y fba_accesos desde una política
 * sin que esas tablas tengan que estar abiertas al que consulta. STABLE porque
 * dentro de una misma consulta la respuesta no cambia.
 */
CREATE OR REPLACE FUNCTION public.puede_ver_remesas_de(uid UUID, cliente UUID)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.fba_accesos a
      WHERE a.user_id = uid AND a.client_id = cliente
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


/* ------------------------------------------------------------------ */
/* 3) Las políticas, reescritas                                          */
/* ------------------------------------------------------------------ */

DROP POLICY IF EXISTS "Admins leen remesas" ON public.fba_remesas;
DROP POLICY IF EXISTS "Con acceso leen remesas" ON public.fba_remesas;
CREATE POLICY "Con acceso leen remesas"
  ON public.fba_remesas FOR SELECT TO authenticated
  USING (public.puede_ver_remesas_de(auth.uid(), client_id));

-- Las líneas no llevan client_id: se mira el de su remesa.
DROP POLICY IF EXISTS "Admins leen lineas de remesa" ON public.fba_remesa_lineas;
DROP POLICY IF EXISTS "Con acceso leen lineas de remesa" ON public.fba_remesa_lineas;
CREATE POLICY "Con acceso leen lineas de remesa"
  ON public.fba_remesa_lineas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fba_remesas r
    WHERE r.id = remesa_id AND public.puede_ver_remesas_de(auth.uid(), r.client_id)
  ));

-- Los movimientos y las lecturas cuelgan de la CONEXIÓN, no del cliente: se
-- pasa por amazon_connections para llegar al client_id.
DROP POLICY IF EXISTS "Admins leen movimientos" ON public.fba_movimientos;
DROP POLICY IF EXISTS "Con acceso leen movimientos" ON public.fba_movimientos;
CREATE POLICY "Con acceso leen movimientos"
  ON public.fba_movimientos FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.amazon_connections c
    WHERE c.id = connection_id AND public.puede_ver_remesas_de(auth.uid(), c.client_id)
  ));

DROP POLICY IF EXISTS "Admins leen lecturas" ON public.fba_lecturas;
DROP POLICY IF EXISTS "Con acceso leen lecturas" ON public.fba_lecturas;
CREATE POLICY "Con acceso leen lecturas"
  ON public.fba_lecturas FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.amazon_connections c
    WHERE c.id = connection_id AND public.puede_ver_remesas_de(auth.uid(), c.client_id)
  ));

-- fba_accesos: cada uno ve sus propias filas (para saber a qué clientes puede
-- entrar) y el admin las ve todas. Escribir, solo desde el servidor.
ALTER TABLE public.fba_accesos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cada uno ve sus accesos" ON public.fba_accesos;
CREATE POLICY "Cada uno ve sus accesos"
  ON public.fba_accesos FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_accesos FROM authenticated, anon;


/* ------------------------------------------------------------------ */
/* 4) Un cliente tiene que poder leer el NOMBRE de su cliente            */
/* ------------------------------------------------------------------ */
--
-- amazon_clients estaba en «solo admin lee» (118). Un usuario 'cliente' tiene
-- que ver al menos la ficha de los suyos, o la pantalla no sabría ni cómo se
-- llama. Se abre SOLO a las filas de fba_accesos, y solo lectura: las políticas
-- permisivas se suman, así que el admin sigue viéndolas todas por la suya.

DROP POLICY IF EXISTS "Con acceso leen su ficha de cliente" ON public.amazon_clients;
CREATE POLICY "Con acceso leen su ficha de cliente"
  ON public.amazon_clients FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.fba_accesos a WHERE a.user_id = auth.uid() AND a.client_id = id
  ));
