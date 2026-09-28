import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'

/**
 * QUIÉN SUPERVISA AL EQUIPO COMERCIAL.
 *
 * ============ EL PROBLEMA QUE RESUELVE ============
 *
 * Un manager de captación tiene que ver las llamadas, la agenda, el CRM y las
 * horas fichadas de TODOS los comerciales. Hasta ahora lo único que abría eso
 * era `role IN ('admin','partner')`, y ese rol arrastra por detrás Tesorería,
 * Facturación, la liquidación de comisiones, Teléfonos, el coste mensual de cada
 * empleado, Amazon/Growth Partner y las rutas de Google Calendar. Es decir: para
 * que alguien pueda supervisar llamadas había que enseñarle los márgenes de la
 * agencia y las nóminas de la propia gente a la que supervisa.
 *
 * Así que se usa el patrón del PERMISO SUELTO —el mismo de 'stock-sync' y de
 * 'tax-reports'—: una fila en user_app_permissions que se da y se quita persona a
 * persona desde Gestión de Usuarios, sin tocarle el rol a nadie.
 *
 *
 * ============ ESTO NO ES EL FILTRO DE VERDAD ============
 *
 * Igual que el resto de comprobaciones de pantalla del ERP, esto solo evita el
 * viaje y la pantalla vacía. Quien manda son las políticas RLS de la migración
 * 212 sobre cold_leads, cold_lead_notes, work_hours y las tres tablas del CRM, y
 * es importante en este caso más que en otros: no existe NINGUNA ruta /api de
 * cold_leads, cold_lead_notes ni work_hours —el board y la ficha escriben directo
 * con supabase-js desde el navegador—, así que todo el listón real de este
 * permiso está en la base de datos.
 *
 *
 * ============ LO QUE SIGUE CERRADO ============
 *
 * Tesorería, Facturación, Comisiones y su liquidación, el coste y el sueldo de
 * los empleados, y Amazon API. Nada de eso mira este permiso: siguen pidiendo el
 * rol. Y reasignar un lead de un comercial a otro tampoco entra: lo impide el
 * trigger `trg_cold_leads_bloquea_reasignacion` de la 212, porque la pantalla no
 * tener el botón no es suficiente cuando el navegador escribe directo.
 */

/**
 * ¿Puede esta persona ver el trabajo de todo el equipo comercial?
 *
 * Mismo criterio que la función SQL `puede_ver_equipo_comercial` de la 212, y
 * tienen que seguir siendo el mismo: si la pantalla abre y la RLS no —o al
 * revés— el síntoma NO es un error, es una pantalla vacía, y eso cuesta horas de
 * encontrar.
 *
 * Admin y partner entran siempre sin pasar por la consulta: son quienes reparten
 * los permisos, y dejarlos fuera por una fila que falte en una tabla sería peor
 * que el problema que se está tapando.
 *
 * Va envuelto en `cache()` —como getUserProfile— porque en una misma petición lo
 * llaman la página y, si hiciera falta, el layout: sin esto serían dos consultas
 * idénticas a PostgREST por carga.
 */
export const puedeVerEquipoComercial = cache(
  async (rol: string | null | undefined, userId: string): Promise<boolean> => {
    if (rol === 'admin' || rol === 'partner') return true

    const supabase = await createClient()
    const { data: permiso } = await supabase
      .from('user_app_permissions')
      .select('can_access')
      .eq('user_id', userId)
      .eq('app_id', PERMISO_EQUIPO_COMERCIAL)
      .maybeSingle()

    return permiso?.can_access === true
  }
)
