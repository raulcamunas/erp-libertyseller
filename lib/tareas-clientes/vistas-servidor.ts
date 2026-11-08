import { createServiceClient } from '@/lib/supabase/service'
import { ErrorDeTareas, esUuid } from './servidor'
import { configDeFiltros, filtrosDeConfig, nombreDeVista, vistaDeConfig, type VistaGuardada } from './vistas-guardadas'

/**
 * LAS VISTAS GUARDADAS DEL EQUIPO (tabla `tc_vistas`, migración 275). SOLO SERVIDOR.
 *
 * Cada persona ve las suyas y las compartidas. Crear una compartida es cosa de un administrador (llega a todo el equipo); borrar una compartida, también. Lo que se
 * guarda pasa siempre por `filtrosDeConfig`/`configDeFiltros`: la base admite JSON libre y esto es lo que impide que entre basura.
 */

interface Fila {
  id: string
  nombre: string
  usuario_id: string | null
  tipo: string
  config: unknown
}

const aVista = (f: Fila, miId: string): VistaGuardada => {
  const vista = vistaDeConfig(f.config)
  return { id: f.id, nombre: f.nombre, compartida: f.usuario_id === null, propia: f.usuario_id === miId, config: configDeFiltros(filtrosDeConfig(f.config), vista) }
}

export async function listarVistas(miId: string): Promise<VistaGuardada[]> {
  const { data, error } = await createServiceClient()
    .from('tc_vistas')
    .select('id, nombre, usuario_id, tipo, config')
    .is('cliente_id', null)
    .or(`usuario_id.is.null,usuario_id.eq.${miId}`)
    .order('orden')
    .order('creado_en')
  if (error) throw new ErrorDeTareas(`No se han podido leer las vistas: ${error.message}`, 500)
  return ((data ?? []) as Fila[]).map((f) => aVista(f, miId))
}

export async function crearVista(actor: { userId: string; esAdmin: boolean }, entrada: Record<string, unknown>): Promise<VistaGuardada> {
  const nombre = nombreDeVista(entrada.nombre)
  if (!nombre) throw new ErrorDeTareas('Ponle un nombre a la vista (hasta 60 letras).')
  const compartida = entrada.compartida === true
  if (compartida && !actor.esAdmin) throw new ErrorDeTareas('Solo un administrador puede compartir una vista con todo el equipo.', 403)
  const config = configDeFiltros(filtrosDeConfig(entrada.config), vistaDeConfig(entrada.config))
  const service = createServiceClient()
  // Una persona no guarda dos vistas con el mismo nombre: la nueva sustituye a la vieja (guardar «Mis vencidas» otra vez la actualiza)
  const { data: iguales } = await service.from('tc_vistas').select('id, nombre, usuario_id').is('cliente_id', null).eq(compartida ? 'tipo' : 'usuario_id', compartida ? 'tablero' : actor.userId)
  const repetida = ((iguales ?? []) as Array<{ id: string; nombre: string; usuario_id: string | null }>).find((v) => v.nombre.toLowerCase() === nombre.toLowerCase() && (compartida ? v.usuario_id === null : v.usuario_id === actor.userId))
  const fila = { nombre, usuario_id: compartida ? null : actor.userId, cliente_id: null, tipo: config.vista ?? 'tablero', config }
  const { data, error } = repetida
    ? await service.from('tc_vistas').update(fila).eq('id', repetida.id).select('id, nombre, usuario_id, tipo, config').single()
    : await service.from('tc_vistas').insert(fila).select('id, nombre, usuario_id, tipo, config').single()
  if (error || !data) throw new ErrorDeTareas(`No se ha podido guardar la vista: ${error?.message ?? 'sin respuesta'}`, 500)
  return aVista(data as Fila, actor.userId)
}

export async function borrarVista(actor: { userId: string; esAdmin: boolean }, id: string): Promise<void> {
  if (!esUuid(id)) throw new ErrorDeTareas('Esa vista no existe.', 404)
  const service = createServiceClient()
  const { data } = await service.from('tc_vistas').select('usuario_id').eq('id', id).maybeSingle()
  if (!data) throw new ErrorDeTareas('Esa vista no existe.', 404)
  const dueno = (data as { usuario_id: string | null }).usuario_id
  if (dueno === null ? !actor.esAdmin : dueno !== actor.userId) throw new ErrorDeTareas('Esa vista no es tuya.', 403)
  const { error } = await service.from('tc_vistas').delete().eq('id', id)
  if (error) throw new ErrorDeTareas(`No se ha podido borrar la vista: ${error.message}`, 500)
}
