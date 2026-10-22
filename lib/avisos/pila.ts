/**
 * LA PILA DE AVISOS DE ABAJO A LA DERECHA.
 * ========================================
 * Un aviso es algo que pasa mientras se trabaja en otra cosa y que se enseña un rato sin pedir nada: ha llegado un correo, un compañero ha
 * llegado a 40 llamadas, alguien ha agendado una cita. Lo publica quien lo sabe (el lector del correo, el canal en tiempo real del equipo) y
 * lo pinta components/avisos/PilaDeAvisos.tsx, que se suscribe aquí.
 *
 * Es un módulo del navegador, sin React: así lo puede publicar cualquier parte del ERP y se comprueba con pila.prueba.ts.
 */

export type TipoDeAviso = 'correo' | 'rebote' | 'hito' | 'cita'

export interface Aviso {
  /** Estable por lo que avisa (el id del correo, el del aviso del equipo): publicar dos veces lo mismo no lo enseña dos veces */
  id: string
  tipo: TipoDeAviso
  titulo: string
  /** Lo principal, bajo el título (el asunto de un correo) */
  detalle?: string
  /** Lo secundario, apagado (el principio de un correo) */
  texto?: string
  duracionMs: number
  accion?: { etiqueta: string; alPulsar: () => void }
}

/** Cuántos se ven a la vez: si llegan más, los más antiguos se retiran (no sirve de nada una torre de avisos que tapa la pantalla) */
export const MAX_VISIBLES = 4

let avisos: readonly Aviso[] = []
const oyentes = new Set<() => void>()

function avisar() {
  for (const oyente of [...oyentes]) oyente()
}

export function publicarAviso(aviso: Aviso): void {
  if (avisos.some((a) => a.id === aviso.id)) return
  avisos = [...avisos, aviso].slice(-MAX_VISIBLES)
  avisar()
}

export function cerrarAviso(id: string): void {
  if (!avisos.some((a) => a.id === id)) return
  avisos = avisos.filter((a) => a.id !== id)
  avisar()
}

/** Los avisos que hay ahora, del más antiguo al más nuevo. Es la MISMA referencia mientras no cambie nada (lo que pide useSyncExternalStore) */
export function leerAvisos(): readonly Aviso[] {
  return avisos
}

export function suscribirAvisos(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** Solo para las pruebas */
export function vaciarAvisos(): void {
  avisos = []
  avisar()
}
