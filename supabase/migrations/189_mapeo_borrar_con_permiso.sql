-- ============================================================================
-- 189 · QUIEN TIENE EL PERMISO DE STOCK PUEDE BORRAR LÍNEAS DEL MAPEO
-- ============================================================================
--
-- La 106 dejó al equipo interno leer, crear y editar el mapeo, pero NO borrar:
-- el DELETE se quedó solo para admin y partner. Fue deliberado y está escrito
-- allí («Lectura y escritura (sin DELETE) para el equipo interno»).
--
-- Se abre ahora porque el trabajo de corregir un mapeo a mano incluye quitar
-- líneas que sobran, y sin DELETE esa persona se queda a medias: puede meter un
-- SKU equivocado y no puede retirarlo.
--
--
-- ============ POR QUÉ NO SE REUTILIZA is_stock_team ============
--
-- Porque is_stock_team() es CUALQUIER empleado. Con eso, un usuario que no ha
-- visto el módulo en su vida podría borrar líneas llamando a la API a mano: no
-- vería el botón, pero la base le dejaría.
--
-- El corte correcto es el mismo que abre la puerta: el permiso suelto
-- 'stock-sync'. Quien lo tiene entra al módulo y trabaja el mapeo; quien no, ni
-- lo ve ni lo toca. Y admin y partner siguen entrando por la política de la 106,
-- que es FOR ALL y no se toca.
--
--
-- ============ SIGUE SIN PODER BORRAR CLIENTES NI EJECUCIONES ============
--
-- Solo se abre stock_mappings. stock_clients y stock_runs se quedan como
-- estaban: borrar un cliente se lleva por delante su mapeo entero (ON DELETE
-- CASCADE) y borrar una ejecución es tirar el histórico de lo que se le mandó a
-- Amazon. Eso no es corregir un mapeo, es otra cosa, y sigue siendo de admin.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.puede_borrar_mapeo(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = uid AND p.role IN ('admin', 'partner')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_app_permissions up
      WHERE up.user_id = uid
        AND up.app_id = 'stock-sync'
        AND up.can_access = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.puede_borrar_mapeo(UUID) IS
  'Admin y partner siempre; el resto solo con el permiso suelto stock-sync, que '
  'es el mismo que abre el módulo. No vale el rol de empleado a secas.';

-- Las políticas permisivas se SUMAN, así que esta no le quita nada a nadie:
-- solo añade el caso del empleado con permiso.
DROP POLICY IF EXISTS "Permiso stock borra mapeo" ON public.stock_mappings;
CREATE POLICY "Permiso stock borra mapeo"
  ON public.stock_mappings FOR DELETE TO authenticated
  USING (public.puede_borrar_mapeo(auth.uid()));
