import { decidirAcceso, type QuienPide } from '../acceso'
import { adelantarPaso, cancelarSecuencia, editarPaso, pausarSecuencia, reanudarSecuencia, reintentarPaso, saltarPaso, type ResultadoDeAccion } from './acciones'
import { validarAjustes, validarAjustesDeBuzon } from './ajustes'
import type { AlmacenDeSecuencias } from './almacen'
import { constructorDeCapacidad } from './capacidad'
import { diaDeMadrid, instanteDeMadrid, sumarDiasHabiles } from './fechas'
import { ejecutarPasada, planificarPendientes, type DependenciasDelMotor, type ResumenDePasada } from './motor'
import { topeDelBuzonEnElDia, type AjustesDelMotor } from './reglas'
import type { BuzonDelMotor, EstadoDeInscripcion } from './tipos'
import {
  armarActividad,
  armarDetalle,
  armarFlujo,
  armarHoy,
  armarItemDeCola,
  armarProximos,
  armarRespuestas,
  respuestaParaLaPantalla,
  type ActividadReciente,
  type BuzonParaVista,
  type DetalleDeSecuencia,
  type DiaProximo,
  type Flujo,
  type GrupoDeColaCliente,
  type ItemDeCola,
  type ResumenDeRespuestas,
  type TableroDeHoy,
} from './vistas'

/**
 * LO QUE LA PANTALLA DE SECUENCIAS PIDE AL SERVIDOR — SOLO SERVIDOR. Se comprueba con servidor.prueba.ts, con una base en memoria.
 * ================================================================================================================================
 * Cada función recibe el almacén y QUIÉN PIDE (`QuienPide`, el mismo que usa todo Correo: lib/correo/acceso.ts) y decide qué se ve:
 *
 *   · cada comercial ve SOLO lo de su buzón;
 *   · quien tiene «Supervisión del correo» o «Supervisión del equipo comercial» ve lo de las personas que ya puede supervisar en Correo, y un
 *     administrador lo ve todo, pero NINGUNO de ellos escribe ni toca los textos de otro;
 *   · pausar, reanudar, cancelar, saltar, reintentar, adelantar y simular: el dueño del buzón o un administrador; editar el texto: solo el dueño
 *     (un correo sale con el nombre de esa persona); los ajustes del motor y de los buzones: solo un administrador.
 *
 * Lo que no se puede ver se contesta como si no existiera, igual que en Correo.
 */

type Almacen = AlmacenDeSecuencias

export interface BuzonVisibleParaSecuencias extends BuzonParaVista {
  participa: boolean
  conectado: boolean
  credencialesInvalidas: boolean
  ultimoSyncAt: number | null
  pausadoHasta: number | null
  motivoPausa: string | null
  topeDiario: number | null
  rampaInicio: string | null
  llamadasDesdeMin: number
  llamadasHastaMin: number
}

/* ------------------------------------------------------------------ */
/* Quién ve qué                                                        */
/* ------------------------------------------------------------------ */

/** Los buzones que esta persona puede ver, con el nombre de su dueño. La regla es la de Correo (decidirAcceso), no una nueva */
export async function buzonesVisibles(almacen: Almacen, quien: QuienPide): Promise<BuzonVisibleParaSecuencias[]> {
  const todos = await almacen.buzones()
  if (todos.length === 0) return []
  const perfiles = await almacen.perfilesDe([...new Set(todos.map((b) => b.userId))])
  return todos
    .filter((b) => {
      const dueno = perfiles.get(b.userId)
      return decidirAcceso(quien, { user_id: b.userId }, { is_comercial: dueno?.isComercial ?? null, role: dueno?.role ?? null }, 'leer').ok
    })
    .map((b) => ({
      id: b.id,
      direccion: b.direccion,
      nombre: b.nombre,
      propietario: { id: b.userId, nombre: perfiles.get(b.userId)?.nombre ?? 'Sin nombre' },
      esMio: b.userId === quien.userId,
      participa: b.participa,
      conectado: b.conectado,
      credencialesInvalidas: b.credencialesInvalidas,
      ultimoSyncAt: b.ultimoSyncAt,
      pausadoHasta: b.pausadoHasta,
      motivoPausa: b.motivoPausa,
      topeDiario: b.topeDiario,
      rampaInicio: b.rampaInicio,
      llamadasDesdeMin: b.llamadasDesdeMin,
      llamadasHastaMin: b.llamadasHastaMin,
    }))
}

export const esAdministrador = (quien: QuienPide): boolean => quien.role === 'admin'

/* ------------------------------------------------------------------ */
/* El tablero                                                          */
/* ------------------------------------------------------------------ */

export interface BuzonDeTablero extends BuzonVisibleParaSecuencias {
  topeHoy: number
  enviadosHoy: number
  manualHoy: number
  automaticosHoy: number
  programadosHoy: number
  vivas: number
}

export type TableroDeSecuencias =
  | { disponible: false; mensaje: string }
  | {
      disponible: true
      ahora: number
      ajustes: AjustesDelMotor
      puedeAdministrar: boolean
      buzones: BuzonDeTablero[]
      hoy: TableroDeHoy
      proximos: DiaProximo[]
      flujo: Flujo
      actividad: ActividadReciente[]
      conteos: Record<EstadoDeInscripcion, number>
      /** Lo que la IA ha entendido de las respuestas de los leads (últimos 30 días) */
      respuestas: ResumenDeRespuestas
    }

export const FALTA_LA_MIGRACION_245 = 'Falta lanzar la migración 245_correo_secuencias.sql en el editor SQL de Supabase: hasta entonces las secuencias no pueden funcionar. El resto de Correo no se ve afectado.'

export async function tablero(almacen: Almacen, quien: QuienPide, opciones: { ahora?: number; buzonId?: string | null; dias?: number } = {}): Promise<TableroDeSecuencias> {
  const ahora = opciones.ahora ?? Date.now()
  const lectura = await almacen.leerAjustes()
  if (!lectura) return { disponible: false, mensaje: FALTA_LA_MIGRACION_245 }
  const { ajustes } = lectura

  let visibles = await buzonesVisibles(almacen, quien)
  if (opciones.buzonId) visibles = visibles.filter((b) => b.id === opciones.buzonId)
  const ids = visibles.map((b) => b.id)
  const hoy = diaDeMadrid(ahora)
  const inicioDeHoy = instanteDeMadrid(hoy, 0)

  const [pasosDeHoy, salientes, conteos, vivas, resumen, eventos, pasosFuturos, respuestasRecientes, conteoDeRespuestas] = await Promise.all([
    almacen.pasosEnElRango(ids, inicioDeHoy, inicioDeHoy + 86_400_000),
    almacen.salientesPorHora(ahora - 14 * 86_400_000, ids),
    almacen.contarPorEstado(ids),
    almacen.vivasPorBuzon(ids),
    almacen.resumen(ahora - 30 * 86_400_000, ids),
    almacen.eventosRecientes(ids, 40),
    almacen.pasosEnElRango(ids, inicioDeHoy, inicioDeHoy + 45 * 86_400_000),
    almacen.respuestasRecientes(ids, ahora - 30 * 86_400_000, 12),
    almacen.contarRespuestas(ids, ahora - 30 * 86_400_000),
  ])

  // Los nombres de los leads y las secuencias de lo que se va a enseñar
  const insIds = [...new Set([...pasosDeHoy.map((p) => p.inscripcionId), ...eventos.map((e) => e.inscripcionId).filter((x): x is string => !!x)])]
  const inscripciones = new Map((await almacen.inscripcionesPorIds(insIds)).map((i) => [i.id, i]))
  const leads = await almacen.leadsBasicos([...inscripciones.values()].map((i) => i.leadId))
  const leadsDeRespuestas = await almacen.leadsBasicos([...new Set(respuestasRecientes.map((r) => r.leadId))])
  const todosLosPasos = await almacen.pasosDeInscripciones(insIds)
  const totales = new Map<string, number>()
  for (const p of todosLosPasos) if (p.orden > 0) totales.set(p.inscripcionId, (totales.get(p.inscripcionId) ?? 0) + 1)

  const buzonesDelMotor: BuzonDelMotor[] = (await almacen.buzones()).filter((b) => ids.includes(b.id))
  const configuracion = new Map(buzonesDelMotor.map((b) => [b.id, { rampaInicio: b.rampaInicio, topeFijo: b.topeDiario }]))
  const topeEnElDia = (buzonId: string, dia: string): number => {
    const c = configuracion.get(buzonId)
    return topeDelBuzonEnElDia({ rampa: ajustes.rampa, rampaInicio: c?.rampaInicio ?? null, topeFijo: c?.topeFijo ?? null, dia, festivos: ajustes.festivos })
  }
  const capacidad = constructorDeCapacidad({
    buzones: configuracion,
    rampa: ajustes.rampa,
    festivos: ajustes.festivos,
    salientes,
    programados: pasosFuturos.filter((p) => ['pendiente', 'enviando'].includes(p.estado) && p.programadoAt !== null).map((p) => ({ buzonId: p.buzonId, en: p.programadoAt as number })),
    ahora,
  })

  const hoyVista = armarHoy({
    dia: hoy,
    ventana: { desdeMin: ajustes.ventanaDesdeMin, hastaMin: ajustes.ventanaHastaMin },
    buzones: visibles,
    pasos: pasosDeHoy,
    inscripciones,
    totalDeSeguimientos: totales,
    leads,
    salientes: salientes.filter((s) => s.dia === hoy),
    topes: new Map(ids.map((id) => [id, topeEnElDia(id, hoy)])),
  })

  const buzones: BuzonDeTablero[] = visibles.map((b) => {
    const carril = hoyVista.carriles.find((c) => c.buzonId === b.id)
    return {
      ...b,
      topeHoy: topeEnElDia(b.id, hoy),
      enviadosHoy: (carril?.manualHoy ?? 0) + (carril?.enviadosHoy ?? 0),
      manualHoy: carril?.manualHoy ?? 0,
      automaticosHoy: carril?.enviadosHoy ?? 0,
      programadosHoy: carril?.programadosHoy ?? 0,
      vivas: vivas.get(b.id) ?? 0,
    }
  })

  return {
    disponible: true,
    ahora,
    ajustes,
    puedeAdministrar: esAdministrador(quien),
    buzones,
    hoy: hoyVista,
    proximos: armarProximos({ ahora, dias: opciones.dias ?? 8, festivos: ajustes.festivos, buzonIds: ids, pasos: pasosFuturos, tope: topeEnElDia, libre: capacidad }),
    flujo: armarFlujo(resumen, 30),
    actividad: armarActividad(eventos, inscripciones, leads),
    conteos,
    respuestas: armarRespuestas({ dias: 30, recientes: respuestasRecientes, conteo: conteoDeRespuestas, leads: leadsDeRespuestas, propietarios: new Map(visibles.map((b) => [b.id, b.propietario.nombre])) }),
  }
}

/* ------------------------------------------------------------------ */
/* La cola                                                             */
/* ------------------------------------------------------------------ */

export type GrupoDeCola = GrupoDeColaCliente
const ESTADOS_VIVOS: EstadoDeInscripcion[] = ['activa', 'pausada']
const ESTADOS_TERMINADOS: EstadoDeInscripcion[] = ['respondida', 'parada', 'completada', 'sin_respuesta', 'cancelada']

export interface FiltroDeColaPantalla {
  grupo: GrupoDeCola
  buzonId?: string | null
  q?: string
  pagina?: number
  limite?: number
}

export async function colaDeSecuencias(almacen: Almacen, quien: QuienPide, f: FiltroDeColaPantalla): Promise<{ items: ItemDeCola[]; total: number; pagina: number; limite: number }> {
  const limite = Math.min(Math.max(f.limite ?? 40, 1), 100)
  const pagina = Math.max(f.pagina ?? 0, 0)
  let visibles = await buzonesVisibles(almacen, quien)
  if (f.buzonId) visibles = visibles.filter((b) => b.id === f.buzonId)
  const ids = visibles.map((b) => b.id)
  const estados = f.grupo === 'vivas' ? ESTADOS_VIVOS : f.grupo === 'terminadas' ? ESTADOS_TERMINADOS : null

  // Buscar: por dirección, o por el nombre del lead
  const q = (f.q ?? '').trim()
  let encontradas: { filas: Awaited<ReturnType<Almacen['listarInscripciones']>>['filas']; total: number }
  if (q.length >= 2) {
    const porLead = await almacen.buscarLeadsPorNombre(q)
    const [a, b] = await Promise.all([
      almacen.listarInscripciones({ buzonIds: ids, estados, destinatario: q }, { desde: 0, limite: 100 }),
      porLead.length > 0 ? almacen.listarInscripciones({ buzonIds: ids, estados, leadIds: porLead }, { desde: 0, limite: 100 }) : Promise.resolve({ filas: [], total: 0 }),
    ])
    const unicas = new Map([...a.filas, ...b.filas].map((i) => [i.id, i]))
    const todas = [...unicas.values()].sort((x, y) => y.creadaAt - x.creadaAt)
    encontradas = { filas: todas.slice(pagina * limite, pagina * limite + limite), total: todas.length }
  } else {
    encontradas = await almacen.listarInscripciones({ buzonIds: ids, estados }, { desde: pagina * limite, limite })
  }

  const insIds = encontradas.filas.map((i) => i.id)
  const [pasos, leads] = await Promise.all([almacen.pasosDeInscripciones(insIds), almacen.leadsBasicos(encontradas.filas.map((i) => i.leadId))])
  const duenos = new Map(visibles.map((b) => [b.id, b]))
  const items = encontradas.filas.map((ins) =>
    armarItemDeCola({
      ins,
      pasos: pasos.filter((p) => p.inscripcionId === ins.id),
      lead: leads.get(ins.leadId),
      propietario: duenos.get(ins.buzonId)?.propietario.nombre ?? 'Sin nombre',
      propio: duenos.get(ins.buzonId)?.esMio ?? false,
    })
  )
  // Lo vivo, por lo próximo que va a salir; lo demás, por fecha de alta (ya viene así)
  if (f.grupo === 'vivas') items.sort((x, y) => (x.siguiente?.en ?? Infinity) - (y.siguiente?.en ?? Infinity))
  return { items, total: encontradas.total, pagina, limite }
}

/* ------------------------------------------------------------------ */
/* El detalle de una secuencia y las acciones                          */
/* ------------------------------------------------------------------ */

/** La secuencia y el permiso de quien pregunta sobre su buzón, o null si no existe o no la puede ver */
async function cargarConAcceso(almacen: Almacen, quien: QuienPide, id: string) {
  const ins = (await almacen.inscripcionesPorIds([id]))[0]
  if (!ins) return null
  const visibles = await buzonesVisibles(almacen, quien)
  const buzon = visibles.find((b) => b.id === ins.buzonId)
  if (!buzon) return null
  return { ins, buzon, esDueno: buzon.esMio, puedeAdministrar: buzon.esMio || esAdministrador(quien) }
}

export async function detalleDeSecuencia(almacen: Almacen, quien: QuienPide, id: string): Promise<DetalleDeSecuencia | null> {
  const c = await cargarConAcceso(almacen, quien, id)
  if (!c) return null
  const [pasos, eventos, leads, respuesta] = await Promise.all([almacen.pasosDe(id), almacen.eventosDe(id), almacen.leadsBasicos([c.ins.leadId]), almacen.respuestaDeInscripcion(id)])
  const item = armarItemDeCola({ ins: c.ins, pasos, lead: leads.get(c.ins.leadId), propietario: c.buzon.propietario.nombre, propio: c.esDueno })
  return armarDetalle({
    item,
    pasos,
    eventos,
    permisos: { puedeAdministrar: c.puedeAdministrar, puedeEditar: c.esDueno },
    respuesta: respuesta ? respuestaParaLaPantalla(respuesta, leads, new Map([[c.buzon.id, c.buzon.propietario.nombre]])) : null,
  })
}

export type AccionSobreSecuencia =
  | { accion: 'pausar' }
  | { accion: 'reanudar' }
  | { accion: 'cancelar' }
  | { accion: 'saltar'; pasoId: string }
  | { accion: 'reintentar'; pasoId: string }
  | { accion: 'adelantar'; pasoId: string }
  | { accion: 'editar'; pasoId: string; asunto?: string; texto?: string }

const NO_EXISTE: ResultadoDeAccion & { estado: number } = { ok: false, mensaje: 'No existe esa secuencia.', estado: 404 }

export async function accionSobreSecuencia(almacen: Almacen, quien: QuienPide, id: string, a: AccionSobreSecuencia, ahora: () => number = Date.now): Promise<ResultadoDeAccion & { estado: number }> {
  const c = await cargarConAcceso(almacen, quien, id)
  if (!c) return NO_EXISTE
  const deps = { almacen, ahora }
  const lectura = await almacen.leerAjustes()
  if (!lectura) return { ok: false, mensaje: FALTA_LA_MIGRACION_245, estado: 503 }

  // Editar el texto es solo del dueño: ese correo saldrá con su nombre. El resto, del dueño o de un administrador
  if (a.accion === 'editar' ? !c.esDueno : !c.puedeAdministrar) {
    return { ok: false, mensaje: a.accion === 'editar' ? 'Solo la persona dueña del buzón puede cambiar el texto de sus correos.' : 'Solo la persona dueña del buzón o un administrador puede hacer esto.', estado: 403 }
  }

  let r: ResultadoDeAccion
  switch (a.accion) {
    case 'pausar':
      r = await pausarSecuencia(deps, c.ins)
      break
    case 'reanudar':
      r = await reanudarSecuencia(deps, c.ins, lectura.ajustes)
      break
    case 'cancelar':
      r = await cancelarSecuencia(deps, c.ins)
      break
    default: {
      const paso = (await almacen.pasosDe(id)).find((p) => p.id === a.pasoId)
      if (!paso) return { ok: false, mensaje: 'No existe ese correo en la secuencia.', estado: 404 }
      if (a.accion === 'saltar') r = await saltarPaso(deps, c.ins, paso, lectura.ajustes)
      else if (a.accion === 'reintentar') r = await reintentarPaso(deps, c.ins, paso, lectura.ajustes)
      else if (a.accion === 'adelantar') r = await adelantarPaso(deps, c.ins, paso, lectura.ajustes)
      else r = await editarPaso(deps, c.ins, paso, { asunto: a.asunto, texto: a.texto })
    }
  }
  return { ...r, estado: r.ok ? 200 : 409 }
}

/* ------------------------------------------------------------------ */
/* Ajustes                                                             */
/* ------------------------------------------------------------------ */

export async function guardarAjustesDelMotor(
  almacen: Almacen,
  quien: QuienPide,
  entrada: unknown,
  ahora: () => number = Date.now
): Promise<{ ok: true; ajustes: AjustesDelMotor; avisos: string[] } | { ok: false; mensaje: string; estado: number }> {
  if (!esAdministrador(quien)) return { ok: false, mensaje: 'Solo un administrador puede cambiar los ajustes.', estado: 403 }
  const lectura = await almacen.leerAjustes()
  if (!lectura) return { ok: false, mensaje: FALTA_LA_MIGRACION_245, estado: 503 }
  const v = validarAjustes(entrada, lectura.ajustes)
  if (!v.ok) return { ok: false, mensaje: v.error, estado: 400 }
  const t = ahora()
  await almacen.guardarAjustes(v.cambios.columnas, quien.userId, t)
  // Si se acaba de pasar de ensayo a envío real, lo aparcado por el ensayo vuelve a la cola en la próxima pasada del motor (mantener() lo hace)
  return { ok: true, ajustes: v.cambios.resultado, avisos: v.avisos }
}

export async function guardarAjustesDeBuzon(
  almacen: Almacen,
  quien: QuienPide,
  buzonId: string,
  entrada: unknown,
  ahora: () => number = Date.now
): Promise<{ ok: true; avisos: string[] } | { ok: false; mensaje: string; estado: number }> {
  if (!esAdministrador(quien)) return { ok: false, mensaje: 'Solo un administrador puede cambiar los ajustes.', estado: 403 }
  const lectura = await almacen.leerAjustes()
  if (!lectura) return { ok: false, mensaje: FALTA_LA_MIGRACION_245, estado: 503 }
  const buzon = (await almacen.buzones()).find((b) => b.id === buzonId)
  if (!buzon) return { ok: false, mensaje: 'No existe ese buzón.', estado: 404 }
  const v = validarAjustesDeBuzon(entrada)
  if (!v.ok) return { ok: false, mensaje: v.error, estado: 400 }
  const t = ahora()
  const { quitarPausa, pausarHastaMañana, ...cambios } = v.cambios
  if (quitarPausa) {
    cambios.pausadoHasta = null
    cambios.motivoPausa = null
  }
  if (pausarHastaMañana) {
    cambios.pausadoHasta = instanteDeMadrid(sumarDiasHabiles(diaDeMadrid(t), 1, lectura.ajustes.festivos), lectura.ajustes.ventanaDesdeMin)
    cambios.motivoPausa = 'Pausado a mano por un administrador.'
  }
  await almacen.ajustarBuzon(buzonId, cambios, t)
  if (quitarPausa || pausarHastaMañana) {
    await almacen.apuntarEvento({ buzonId, tipo: 'freno', detalle: quitarPausa ? 'Un administrador ha quitado la pausa del buzón.' : 'Un administrador ha pausado el buzón hasta el siguiente día hábil.' }, t)
  }
  // Un buzón que vuelve a participar recoge los seguimientos que se habían quedado sin hora
  if (v.cambios.participa === true) await planificarPendientes({ almacen }, lectura.ajustes, await almacen.buzones(), t)
  return { ok: true, avisos: v.avisos }
}

/* ------------------------------------------------------------------ */
/* Para el cuadro de Correo                                            */
/* ------------------------------------------------------------------ */

export interface EstadoParaElCuadro {
  /** Se puede ofrecer programar seguimientos desde este buzón */
  disponible: boolean
  /** Por qué no, o un aviso (modo ensayo…) */
  mensaje: string | null
  activa: boolean
  ensayo: boolean
  pasos: Array<{ orden: number; dias: number; diaAprox: string }>
  /** Cuántos días hábiles después del último correo, sin respuesta, el lead pasa solo a «No interesa» */
  diasHastaNoInteresa: number
  topeHoy: number
  enviadosHoy: number
}

/**
 * ¿Se ofrece el botón «Secuencias» en Correo? Un administrador siempre (es quien enciende el motor y quien ve el aviso si falta la migración); el resto,
 * solo mientras el motor está en marcha (en ensayo o de verdad): con el motor apagado la función es invisible para el equipo.
 */
export async function pantallaVisible(almacen: Almacen, quien: QuienPide): Promise<boolean> {
  if (esAdministrador(quien)) return true
  const lectura = await almacen.leerAjustes()
  return lectura !== null && lectura.ajustes.activa
}

/** Lo que necesita el cuadro de Correo para enseñar (o no) el bloque de seguimientos de un buzón que es de quien pregunta */
export async function estadoParaElCuadro(almacen: Almacen, quien: QuienPide, buzonId: string, ahora: number = Date.now()): Promise<EstadoParaElCuadro> {
  const apagado = (mensaje: string | null): EstadoParaElCuadro => ({ disponible: false, mensaje, activa: false, ensayo: false, pasos: [], diasHastaNoInteresa: 0, topeHoy: 0, enviadosHoy: 0 })
  const lectura = await almacen.leerAjustes()
  if (!lectura) return apagado(null)
  const [base, buzones] = await Promise.all([almacen.secuenciaBase(), almacen.buzones()])
  const buzon = buzones.find((b) => b.id === buzonId)
  if (!base || !buzon || buzon.userId !== quien.userId) return apagado(null)
  const { ajustes } = lectura
  // Con el motor apagado la función es INVISIBLE para el equipo: solo un administrador la ve (para probar)
  if (!ajustes.activa && !esAdministrador(quien)) return apagado(null)
  if (!buzon.participa) return { ...apagado('Este buzón no participa en los seguimientos automáticos.'), activa: ajustes.activa, ensayo: ajustes.modoEnsayo }
  const hoy = diaDeMadrid(ahora)
  const carga = await almacen.cargaDelBuzon(buzon.id, ahora)
  return {
    disponible: true,
    mensaje: !ajustes.activa ? 'El envío automático está apagado: los seguimientos se programan pero no saldrán hasta que se encienda.' : ajustes.modoEnsayo ? 'El envío automático está en pruebas: los seguimientos se programan pero todavía no salen.' : null,
    activa: ajustes.activa,
    ensayo: ajustes.modoEnsayo,
    pasos: base.pasos.map((p) => ({ orden: p.orden, dias: p.dias, diaAprox: sumarDiasHabiles(hoy, p.dias, ajustes.festivos) })),
    diasHastaNoInteresa: ajustes.diasHastaNoInteresa,
    topeHoy: topeDelBuzonEnElDia({ rampa: ajustes.rampa, rampaInicio: buzon.rampaInicio, topeFijo: buzon.topeDiario, dia: hoy, festivos: ajustes.festivos }),
    enviadosHoy: carga.enviadosHoy,
  }
}

/* ------------------------------------------------------------------ */
/* ¿Qué haría el motor ahora?                                          */
/* ------------------------------------------------------------------ */

/**
 * Una pasada del motor para probar: la misma que hace el cron. Solo un administrador. Lo devuelve ya resumido; no manda nada más de lo que mandaría
 * el cron en ese momento (si está en ensayo, nada).
 */
export async function lanzarPasada(deps: DependenciasDelMotor, quien: QuienPide): Promise<{ ok: true; resumen: ResumenDePasada } | { ok: false; mensaje: string; estado: number }> {
  if (!esAdministrador(quien)) return { ok: false, mensaje: 'Solo un administrador puede lanzar una pasada a mano.', estado: 403 }
  return { ok: true, resumen: await ejecutarPasada(deps) }
}
