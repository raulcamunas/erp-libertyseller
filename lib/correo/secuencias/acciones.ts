import type { AlmacenDeSecuencias } from './almacen'
import { diaCorto, diaDeMadrid, esDiaHabil, horaDeMadrid, instanteDeMadrid, partesDeMadrid, siguienteDiaHabil } from './fechas'
import { cerrarSiHaTerminado, planificarPendientes } from './motor'
import type { AjustesDelMotor } from './reglas'
import { revisarSeguimiento } from './seguimientos'
import type { InscripcionDelMotor, PasoDelMotor } from './tipos'

/**
 * LO QUE UNA PERSONA PUEDE HACER CON UNA SECUENCIA: PAUSAR, REANUDAR, CANCELAR, SALTAR, EDITAR, REINTENTAR Y ADELANTAR.
 * =====================================================================================================================
 * SOLO SERVIDOR. Se comprueba con acciones.prueba.ts, con una base en memoria. Quién puede hacer cada cosa (el dueño del buzón, o un
 * administrador, o nadie) lo decide la ruta con lib/correo/acceso.ts ANTES de llamar aquí; esto solo comprueba que la acción tiene sentido
 * en el estado en que está la secuencia, y la deja apuntada en su rastro.
 *
 * Todas devuelven `{ ok, mensaje }` con una frase lista para enseñar. Ninguna lanza por un estado que no admite la acción: lo explican.
 */

export type ResultadoDeAccion = { ok: true; mensaje: string } | { ok: false; mensaje: string }

const bien = (mensaje: string): ResultadoDeAccion => ({ ok: true, mensaje })
const mal = (mensaje: string): ResultadoDeAccion => ({ ok: false, mensaje })

type Deps = { almacen: AlmacenDeSecuencias; ahora?: () => number }
const reloj = (d: Deps): number => (d.ahora ?? Date.now)()

/** Los motivos por los que una secuencia se pausa sola y que, al resolverlos, se pueden dar por resueltos con «Reanudar» o «Reintentar» */
const PAUSAS_QUE_SE_RESUELVEN_A_MANO = new Set(['envio_fallido', 'envio_dudoso', 'pausada_por_revision', 'revision_sin_ia', 'pausada_por_persona', 'buzon_inexistente'])

/* ------------------------------------------------------------------ */
/* Pausar y reanudar                                                   */
/* ------------------------------------------------------------------ */

export async function pausarSecuencia(d: Deps, ins: InscripcionDelMotor): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (ins.estado === 'pausada') return mal('Esta secuencia ya está en pausa.')
  if (ins.estado !== 'activa') return mal('Esta secuencia ya ha terminado: no se puede pausar.')
  await d.almacen.cambiarInscripcion(ins.id, { estado: 'pausada', motivo: 'Pausada a mano.', codigo: 'pausada_por_persona' }, ahora)
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, buzonId: ins.buzonId, tipo: 'pausado', detalle: 'Pausada a mano. No saldrá ningún seguimiento hasta que se reanude.' }, ahora)
  return bien('Secuencia en pausa. No saldrá ningún seguimiento hasta que la reanudes.')
}

export async function reanudarSecuencia(d: Deps, ins: InscripcionDelMotor, ajustes: AjustesDelMotor): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (ins.estado !== 'pausada') return mal(ins.estado === 'activa' ? 'Esta secuencia ya está en marcha.' : 'Esta secuencia ya ha terminado: no se puede reanudar.')
  // Los correos que la pausa había detenido vuelven a la cola SIN hora, para repartirse de nuevo desde hoy
  const pasos = await d.almacen.pasosDe(ins.id)
  let devueltos = 0
  for (const p of pasos.filter((x) => x.orden > 0 && x.estado === 'pausado')) {
    if (await d.almacen.moverPaso(p.id, ['pausado'], { estado: 'pendiente', motivo: null, programadoAt: null, siguienteIntentoAt: null, intentos: 0, messageId: null, objetivoDia: diaDeMadrid(ahora) }, ahora)) devueltos++
  }
  await d.almacen.cambiarInscripcion(ins.id, { estado: 'activa', motivo: null, codigo: null }, ahora)
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, buzonId: ins.buzonId, tipo: 'reanudado', detalle: 'Secuencia reanudada.' }, ahora)
  const buzones = await d.almacen.buzones()
  await planificarPendientes({ almacen: d.almacen }, ajustes, buzones, ahora)
  return bien(devueltos > 0 ? 'Secuencia reanudada: el seguimiento detenido vuelve a la cola con una hora nueva.' : 'Secuencia reanudada.')
}

/* ------------------------------------------------------------------ */
/* Cancelar y saltar                                                   */
/* ------------------------------------------------------------------ */

export async function cancelarSecuencia(d: Deps, ins: InscripcionDelMotor): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (ins.estado !== 'activa' && ins.estado !== 'pausada') return mal('Esta secuencia ya ha terminado.')
  await d.almacen.cambiarInscripcion(ins.id, { estado: 'cancelada', motivo: 'Cancelada a mano.', codigo: 'cancelada_por_persona', paradaAt: ahora, noInteresaEn: null }, ahora)
  const n = await d.almacen.cerrarPasosAbiertos(ins.id, 'cancelado', 'Cancelada a mano.', ahora)
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, buzonId: ins.buzonId, tipo: 'cancelada', detalle: `Cancelada a mano${n > 0 ? `: ${n === 1 ? 'un seguimiento no saldrá' : `${n} seguimientos no saldrán`}` : ''}.` }, ahora)
  return bien('Secuencia cancelada. No saldrá ningún seguimiento más.')
}

export async function saltarPaso(d: Deps, ins: InscripcionDelMotor, paso: PasoDelMotor, ajustes: AjustesDelMotor): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (paso.orden === 0) return mal('El primer correo ya salió: no se puede saltar.')
  if (!['pendiente', 'pausado'].includes(paso.estado)) return mal(paso.estado === 'enviando' ? 'Este seguimiento está saliendo ahora mismo.' : 'Este seguimiento ya no está pendiente.')
  const hecho = await d.almacen.moverPaso(paso.id, ['pendiente', 'pausado'], { estado: 'saltado', motivo: 'Saltado a mano.' }, ahora)
  if (!hecho) return mal('Este seguimiento ya ha cambiado: actualiza la pantalla.')
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'saltado', detalle: `Seguimiento ${paso.orden} saltado a mano.` }, ahora)
  await cerrarSiHaTerminado({ almacen: d.almacen, ahora: d.ahora }, ajustes, ins.id)
  return bien(`Seguimiento ${paso.orden} saltado.`)
}

/* ------------------------------------------------------------------ */
/* Editar                                                              */
/* ------------------------------------------------------------------ */

export async function editarPaso(d: Deps, ins: InscripcionDelMotor, paso: PasoDelMotor, cambios: { asunto?: string; texto?: string }): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (paso.orden === 0) return mal('El primer correo ya salió: no se puede editar.')
  if (!['pendiente', 'pausado'].includes(paso.estado)) return mal('Este seguimiento ya no se puede editar.')
  const nuevo: { asunto?: string; texto?: string } = {}
  if (cambios.asunto !== undefined) {
    const a = cambios.asunto.replace(/\s+/g, ' ').trim()
    if (a === '' || a.length > 300) return mal('El asunto tiene que tener entre 1 y 300 caracteres.')
    nuevo.asunto = a
  }
  if (cambios.texto !== undefined) {
    const t = cambios.texto.replace(/\r\n?/g, '\n').trim()
    const pasos = await d.almacen.pasosDe(ins.id)
    // Las mismas reglas fijas que el primer correo: nada de dinero, nada de huecos por rellenar
    const problemas = revisarSeguimiento(t, pasos.filter((p) => p.orden < paso.orden && p.orden >= 0).map((p) => p.texto))
    if (problemas.includes('dinero')) return mal('El texto habla de dinero o de facturación: quítalo para poder guardarlo.')
    if (problemas.includes('hueco')) return mal('El texto deja un hueco por rellenar ([…], {{…}} o <…>): complétalo para poder guardarlo.')
    if (problemas.includes('corto')) return mal('El texto es demasiado corto.')
    if (t.length > 6000) return mal('El texto es demasiado largo.')
    nuevo.texto = t
  }
  if (nuevo.asunto === undefined && nuevo.texto === undefined) return mal('No hay nada que cambiar.')
  const hecho = await d.almacen.editarPaso(paso.id, nuevo, ahora)
  if (!hecho) return mal('Este seguimiento ya ha cambiado: actualiza la pantalla.')
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'editado', detalle: `Seguimiento ${paso.orden} editado${nuevo.texto !== undefined ? ' (texto)' : ''}${nuevo.asunto !== undefined ? ' (asunto)' : ''}.` }, ahora)
  return bien('Cambios guardados.')
}

/* ------------------------------------------------------------------ */
/* Reintentar y adelantar                                              */
/* ------------------------------------------------------------------ */

export async function reintentarPaso(d: Deps, ins: InscripcionDelMotor, paso: PasoDelMotor, ajustes: AjustesDelMotor): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (paso.estado !== 'fallido') return mal('Solo se pueden reintentar los seguimientos que han fallado.')
  if (ins.estado !== 'activa' && ins.estado !== 'pausada') return mal('Esta secuencia ya ha terminado.')
  const hecho = await d.almacen.moverPaso(paso.id, ['fallido'], { estado: 'pendiente', motivo: null, programadoAt: null, siguienteIntentoAt: null, intentos: 0, messageId: null, objetivoDia: diaDeMadrid(ahora) }, ahora)
  if (!hecho) return mal('Este seguimiento ya ha cambiado: actualiza la pantalla.')
  // Si la secuencia estaba parada por este fallo, vuelve a marcha
  if (ins.estado === 'pausada' && ins.codigo && PAUSAS_QUE_SE_RESUELVEN_A_MANO.has(ins.codigo)) {
    await d.almacen.cambiarInscripcion(ins.id, { estado: 'activa', motivo: null, codigo: null }, ahora)
  }
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'reanudado', detalle: `Seguimiento ${paso.orden} devuelto a la cola para reintentarlo.` }, ahora)
  await planificarPendientes({ almacen: d.almacen }, ajustes, await d.almacen.buzones(), ahora)
  return bien('Seguimiento devuelto a la cola con una hora nueva.')
}

/** Cuándo es lo antes que puede salir algo: dentro de unos segundos si estamos en horario, o al abrir la ventana del siguiente día hábil */
export function antesPosible(ahora: number, ajustes: Pick<AjustesDelMotor, 'ventanaDesdeMin' | 'ventanaHastaMin' | 'festivos'>): number {
  const margen = 20_000
  const candidato = ahora + margen
  const p = partesDeMadrid(candidato)
  const festivos = new Set(ajustes.festivos)
  if (esDiaHabil(p.dia, festivos)) {
    if (p.minutos >= ajustes.ventanaDesdeMin && p.minutos < ajustes.ventanaHastaMin) return candidato
    if (p.minutos < ajustes.ventanaDesdeMin) return instanteDeMadrid(p.dia, ajustes.ventanaDesdeMin)
  }
  return instanteDeMadrid(siguienteDiaHabil(p.dia, festivos), ajustes.ventanaDesdeMin)
}

/** «Enviar ya»: lo adelanta al primer momento en que puede salir. Los controles de siempre (huecos, topes, respuestas) siguen valiendo */
export async function adelantarPaso(d: Deps, ins: InscripcionDelMotor, paso: PasoDelMotor, ajustes: AjustesDelMotor): Promise<ResultadoDeAccion> {
  const ahora = reloj(d)
  if (ins.estado !== 'activa') return mal(ins.estado === 'pausada' ? 'La secuencia está en pausa: reanúdala primero.' : 'Esta secuencia ya ha terminado.')
  if (paso.orden === 0 || paso.estado !== 'pendiente') return mal('Este seguimiento ya no está pendiente.')
  const cuando = antesPosible(ahora, ajustes)
  const hecho = await d.almacen.moverPaso(paso.id, ['pendiente'], { estado: 'pendiente', programadoAt: cuando, siguienteIntentoAt: null, objetivoDia: diaDeMadrid(cuando) }, ahora)
  if (!hecho) return mal('Este seguimiento ya ha cambiado: actualiza la pantalla.')
  await d.almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'reprogramado', detalle: `Seguimiento ${paso.orden} adelantado a mano: sale ${diaCorto(diaDeMadrid(cuando))} a las ${horaDeMadrid(cuando)}.` }, ahora)
  return bien(cuando - ahora <= 60_000 ? 'Saldrá en cuanto el motor lo recoja (en menos de un minuto), si todo está en orden.' : `Saldrá ${diaCorto(diaDeMadrid(cuando))} a las ${horaDeMadrid(cuando)}, cuando se abra el horario de envío.`)
}
