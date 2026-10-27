import type { SupabaseClient } from '@supabase/supabase-js'
import { crearListaParaPersona } from '@/lib/cold-calling/listas-servidor'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { llevaListaPropia, type CambioDePuesto } from './puestos'

/**
 * GUARDAR EL PUESTO DE UNA PERSONA Y, SI LLAMA, DARLE SU LISTA DE LEADS — SOLO SERVIDOR.
 * ======================================================================================
 * Lo llaman las rutas de crear y editar usuarios (app/api/users) DESPUÉS de guardar el rol y las casillas. Nada de esto hace fallar el alta o la edición: la persona ya está
 * creada en el sistema de acceso, y un puesto que no se guarda o una lista que no se crea se avisa y se arregla después, sin perder lo demás.
 *
 * SIN LA MIGRACIÓN 257 no existe la columna `profiles.puesto`. Se guarda entonces solo lo que sí existe (`is_comercial`, de la migración 203) y se avisa de que el puesto no
 * ha quedado guardado: así la pantalla de usuarios sigue funcionando mientras la migración no esté lanzada.
 */

type Servicio = Pick<SupabaseClient, 'from' | 'rpc'>

export const AVISO_SIN_LA_257 = 'El puesto no se ha guardado porque falta lanzar la migración 257 (el rol y las casillas sí se han guardado).'
export const AVISO_PUESTO_FALLIDO = 'No se ha podido guardar el puesto. El rol y las casillas sí se han guardado; vuelve a intentarlo desde editar el usuario.'
export const AVISO_LISTA_FALLIDA = 'No se ha podido crear su lista de leads (puede que falte la migración 257). Se puede crear desde Cold Calling → Listas.'

export interface ResultadoDelPuesto {
  avisos: string[]
}

type Cambio = Extract<CambioDePuesto, { ok: true }>

export async function guardarPuesto(service: Servicio, userId: string, cambio: Cambio): Promise<ResultadoDelPuesto> {
  const datos: { puesto?: string | null; is_comercial?: boolean } = {}
  if (cambio.puesto !== undefined) datos.puesto = cambio.puesto
  if (cambio.is_comercial !== undefined) datos.is_comercial = cambio.is_comercial
  if (Object.keys(datos).length === 0) return { avisos: [] }

  const { error } = await service.from('profiles').update(datos).eq('id', userId)
  if (!error) return { avisos: [] }

  if (isMissingSchema(error) && 'puesto' in datos) {
    const { puesto: _puesto, ...resto } = datos
    if (Object.keys(resto).length > 0) {
      const { error: error2 } = await service.from('profiles').update(resto).eq('id', userId)
      if (error2) {
        console.error('Usuarios · no se ha podido guardar is_comercial', { codigo: error2.code ?? null })
        return { avisos: [AVISO_PUESTO_FALLIDO] }
      }
    }
    // Quitar un puesto que todavía no puede existir no pierde nada: no hace falta avisar
    return { avisos: datos.puesto === null ? [] : [AVISO_SIN_LA_257] }
  }
  console.error('Usuarios · no se ha podido guardar el puesto', { codigo: error.code ?? null })
  return { avisos: [AVISO_PUESTO_FALLIDO] }
}

/**
 * Al dar de alta a alguien que llama, su lista de leads propia («Ana V1»), asignada a él y vacía, lista para repartirle leads. Devuelve el nombre de la lista creada, o
 * null si no tocaba o no se pudo (en ese caso `avisos` lo dice). `actor` es quien da el alta: tiene que poder gestionar listas, y un administrador siempre puede.
 */
export async function crearSuListaSiLlama(
  service: Servicio,
  actor: string,
  persona: { id: string; nombre: string | null; correo: string | null },
  cambio: Cambio,
  pedida: boolean
): Promise<{ lista: string | null; avisos: string[] }> {
  if (!pedida || !llevaListaPropia(cambio.puesto ?? null, cambio.is_comercial === true)) return { lista: null, avisos: [] }
  const lista = await crearListaParaPersona(service, actor, persona)
  return lista ? { lista, avisos: [] } : { lista: null, avisos: [AVISO_LISTA_FALLIDA] }
}
