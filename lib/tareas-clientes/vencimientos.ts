/**
 * LOS RECORDATORIOS DE FECHA DE LAS TAREAS DE CADA PERSONA. Puro: recibe las tareas sin terminar de una persona y el día de hoy, y dice qué avisos le tocan.
 *
 *   · «Vence hoy» y «Vence mañana»: uno por tarea (no se repite: la clave lleva el día de la fecha límite).
 *   · «Vencidas»: UN solo aviso resumen al día (con 9 tareas vencidas, nueve avisos seguidos serían ruido y se terminaría por no mirarlos).
 *
 * La `clave` es única por persona (restricción de la tabla de notificaciones): volver a pedir los recordatorios el mismo día no duplica nada.
 */

export interface TareaConFecha {
  id: string
  cliente_id: string
  titulo: string
  fecha_inicio: string | null
  fecha_fin: string | null
}

export interface AvisoDeFecha {
  tipo: 'tarea_vence' | 'tarea_vencidas'
  clave: string
  clienteId: string
  tareaId: string | null
  titulo: string
  mensaje: string
}

const dia = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null)

function sumarDias(aaaammdd: string, n: number): string {
  const [a, m, d] = aaaammdd.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

const nombreTarea = (t: TareaConFecha) => t.titulo.trim() || 'Tarea sin título'

export function avisosDeFecha(tareas: readonly TareaConFecha[], hoy: string): AvisoDeFecha[] {
  const manana = sumarDias(hoy, 1)
  const salida: AvisoDeFecha[] = []
  const vencidas: TareaConFecha[] = []
  for (const t of tareas) {
    const limite = dia(t.fecha_fin) ?? dia(t.fecha_inicio)
    if (!limite) continue
    if (limite < hoy) vencidas.push(t)
    else if (limite === hoy) salida.push({ tipo: 'tarea_vence', clave: `tc-vence:${t.id}:${limite}:hoy`, clienteId: t.cliente_id, tareaId: t.id, titulo: 'Vence hoy', mensaje: nombreTarea(t) })
    else if (limite === manana) salida.push({ tipo: 'tarea_vence', clave: `tc-vence:${t.id}:${limite}:manana`, clienteId: t.cliente_id, tareaId: t.id, titulo: 'Vence mañana', mensaje: nombreTarea(t) })
  }
  if (vencidas.length > 0) {
    const primera = [...vencidas].sort((a, b) => (dia(a.fecha_fin) ?? dia(a.fecha_inicio) ?? '').localeCompare(dia(b.fecha_fin) ?? dia(b.fecha_inicio) ?? ''))[0]
    salida.push({
      tipo: 'tarea_vencidas',
      clave: `tc-vencidas:${hoy}`,
      clienteId: primera.cliente_id,
      tareaId: null,
      titulo: vencidas.length === 1 ? 'Tienes 1 tarea vencida' : `Tienes ${vencidas.length} tareas vencidas`,
      mensaje: vencidas.length === 1 ? nombreTarea(primera) : `La más antigua: ${nombreTarea(primera)}`,
    })
  }
  return salida
}
