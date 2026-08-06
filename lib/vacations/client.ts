import type { VacationsServerData } from '@/lib/employees/vacations'
import type { VacationRequest } from '@/lib/types/vacations'

/**
 * LO QUE HABLA LA PANTALLA CON /api/vacations.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. Solo `fetch`. Es la diferencia con
 * lib/vacations/api.ts, que es su gemelo de servidor y NO se puede tocar desde
 * el navegador.
 *
 * POR QUÉ LAS ESCRITURAS VAN POR RUTA DE API Y NO CONTRA SUPABASE
 * --------------------------------------------------------------
 * El resto del módulo de empleados escribe directamente desde el navegador y
 * deja que RLS haga de guardia. Aquí no vale, por dos motivos:
 *
 *   1) «Hoy» decide si una petición entra FUERA DE PLAZO. Calculado en el
 *      navegador, bastaría con mover el reloj del ordenador para que una
 *      petición para mañana no saliera marcada. Lo pone el servidor.
 *   2) Un admin registra peticiones EN NOMBRE de personas que pueden no tener
 *      cuenta en el ERP —que son justo las dos para las que se pidió esto—, y
 *      la política «es mía» no las alcanza. Eso solo lo puede hacer una ruta
 *      que compruebe el rol contra la sesión antes de escribir.
 *
 * El tipo de la vista se toma prestado del módulo de servidor con `import
 * type`, que TypeScript borra al compilar: no queda ni un require en el
 * paquete del navegador, y a cambio la pantalla no puede desviarse de lo que
 * la ruta devuelve de verdad. Copiar la interfaz aquí era la otra opción, y el
 * día que alguien añadiera un campo allí esto seguiría compilando con un tipo
 * mentiroso.
 */
export type VacationsView = VacationsServerData

/** Lo que devuelve cualquier escritura: la fila tocada y la vista ya recargada */
export interface VacationsMutation extends VacationsView {
  request?: VacationRequest
  message?: string
  /** Cosas que hay que decir pero que no impidieron guardar (fuera de plazo, se pasa del saldo) */
  warnings?: string[]
  /** La registró un admin por otra persona */
  onBehalf?: boolean
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Una escritura del módulo, con el error ya convertido en una frase que se
 * puede enseñar.
 *
 * Nunca lanza: quien llama pinta `error` en un toast y sigue. Un throw aquí
 * dejaría el botón girando para siempre, que es exactamente lo que pasa cuando
 * el servidor contesta con HTML —un 502 del proxy— y alguien hace `.json()`
 * sin red de seguridad.
 */
export async function postVacations<T = VacationsMutation>(
  url: string,
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })

    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: string })
      | null

    if (!res.ok) {
      return {
        ok: false,
        error:
          payload?.error ??
          'No se ha podido completar la operación. Vuelve a intentarlo y avisa si sigue fallando.',
      }
    }
    return { ok: true, data: payload as T }
  } catch {
    // Sin conexión, o la pestaña se cerró a medias. El mensaje dice qué hacer.
    return { ok: false, error: 'No hay conexión con el servidor. Inténtalo otra vez.' }
  }
}
