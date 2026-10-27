import { UUID, type QuienPide } from '@/lib/correo/acceso'
import { almacenDeSecuencias, type AlmacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { FALTA_LA_MIGRACION_245, buzonesVisibles, colaDeSecuencias, detalleDeSecuencia, tablero, type TableroDeSecuencias } from '@/lib/correo/secuencias/servidor'
import { ETIQUETA_DE_CODIGO, ETIQUETA_DE_ESTADO, armarItemDeCola, type ItemDeCola, type PasoDeCola } from '@/lib/correo/secuencias/vistas'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { aTexto, entero, opcion, texto } from '../argumentos'
import type { ContextoMcp } from '../contexto'
import { ErrorDeHerramienta, type Herramienta } from '../protocolo'
import { ajustarAlTamano, fechaHora, normalizar, paginaArg, recortar, servicioDe } from './comun'

/**
 * EL ENVÍO AUTOMÁTICO DE SEGUIMIENTOS, PARA CLAUDE: LO QUE SE ESTÁ ENVIANDO, LA COLA Y CADA SECUENCIA.
 * SOLO SERVIDOR. Lo puro (`armar…`, `compacto`) se prueba en secuencias.prueba.ts con el mundo de pruebas del motor (lib/correo/secuencias/mundo-de-pruebas.ts).
 *
 * NO SE VUELVE A CALCULAR NADA: las tres herramientas llaman a las MISMAS funciones que la pestaña «Secuencias» de Correo (`tablero`, `colaDeSecuencias`,
 * `detalleDeSecuencia`), así que lo que dice Claude y lo que ve el equipo en pantalla no se pueden contradecir. La persona que pregunta es siempre
 * un administrador (lib/mcp/auth.ts lo comprueba en cada petición), que ve los buzones de todos.
 */

/** La regla de quién ve qué buzón, como administrador. Un rol distinto de admin vería menos: ante la duda, lo que diga acceso.ts */
export const quienDelConector = (ctx: ContextoMcp): QuienPide => ({ userId: ctx.usuario.id, role: ctx.usuario.rol, tienePermisoEquipo: false, tienePermisoCorreo: false })

const almacenDe = (ctx: ContextoMcp): AlmacenDeSecuencias => almacenDeSecuencias(servicioDe(ctx))

const ahoraDe = (ctx: ContextoMcp): number => ctx.ahora ?? Date.now()

const aFecha = (ms: number | null | undefined): string | null => (typeof ms === 'number' && Number.isFinite(ms) ? fechaHora(new Date(ms).toISOString()) : null)

/** «10:00» desde los minutos de la medianoche */
export const horaDeMinutos = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Un fallo de «falta la migración 245» (en la tabla que sea) es un aviso, no un error: el resto del ERP no se ve afectado */
const faltaLa245 = (e: unknown): boolean => isMissingSchema(e) || isMissingSchema((e as { cause?: unknown } | null)?.cause)

/* ------------------------------------------------------------------ */
/* Elegir un buzón                                                     */
/* ------------------------------------------------------------------ */

/** Lo que hace falta de un buzón para elegirlo por lo que escribe quien pregunta */
export interface BuzonElegible {
  id: string
  direccion: string
  nombre: string | null
  propietario: { nombre: string }
}

/** El buzón al que se refiere el texto: su id, su dirección, o el nombre de su dueño (entero o parte). Si hay varios o ninguno, el error los lista */
export function elegirBuzon<T extends BuzonElegible>(buzones: readonly T[], consulta: string): T {
  const q = normalizar(consulta)
  const porId = buzones.find((b) => b.id === consulta.trim().toLowerCase())
  if (porId) return porId
  const palabras = q.split(' ').filter(Boolean)
  const coinciden = buzones.filter((b) => {
    const nombre = normalizar(`${b.propietario.nombre} ${b.nombre ?? ''}`)
    const direccion = normalizar(b.direccion)
    return palabras.length > 0 && palabras.every((w) => nombre.includes(w) || direccion.includes(w))
  })
  if (coinciden.length === 1) return coinciden[0]
  const exactas = coinciden.filter((b) => normalizar(b.direccion) === q || normalizar(b.propietario.nombre) === q)
  if (exactas.length === 1) return exactas[0]
  const lista = (coinciden.length > 1 ? coinciden : buzones).map((b) => `${b.propietario.nombre} (${b.direccion})`).join(', ')
  if (coinciden.length > 1) throw new ErrorDeHerramienta(`«${consulta}» puede ser varios buzones: ${lista}. Escribe la dirección completa.`)
  throw new ErrorDeHerramienta(`No hay ningún buzón de «${consulta}». Los que hay: ${lista || '(ninguno)'}.`)
}

/* ------------------------------------------------------------------ */
/* correo_envios: lo que se está enviando                              */
/* ------------------------------------------------------------------ */

type TableroDisponible = Extract<TableroDeSecuencias, { disponible: true }>

export function armarEnvios(t: TableroDisponible, dias: number): Record<string, unknown> {
  const nombre = new Map(t.buzones.map((b) => [b.id, `${b.propietario.nombre} (${b.direccion})`]))
  const carriles = new Map(t.hoy.carriles.map((c) => [c.buzonId, c]))
  const modo = !t.ajustes.activa ? 'apagado (no envía nada)' : t.ajustes.modoEnsayo ? 'ENSAYO: decide y apunta lo que haría, pero no envía de verdad' : 'real (envía)'

  const buzones = t.buzones.map((b) => {
    const proximo = (carriles.get(b.id)?.puntos ?? []).filter((p) => p.estado !== 'enviado' && p.estado !== 'fallido').sort((a, c) => a.en - c.en)[0]
    return {
      buzon: nombre.get(b.id),
      conectado: b.conectado && !b.credencialesInvalidas,
      participa_en_secuencias: b.participa,
      pausado_hasta: aFecha(b.pausadoHasta),
      motivo_de_la_pausa: b.motivoPausa,
      tope_del_dia: b.topeHoy,
      enviados_hoy: b.enviadosHoy,
      de_ellos_a_mano: b.manualHoy,
      de_ellos_automaticos: b.automaticosHoy,
      programados_aun_hoy: b.programadosHoy,
      secuencias_vivas: b.vivas,
      proximo_envio: proximo ? { cuando: aFecha(proximo.en), a: proximo.lead, correo: `seguimiento ${proximo.orden} de ${proximo.de}`, estado: proximo.estado } : null,
    }
  })

  const alarmas = t.salud.alarmas.map((a) => ({ gravedad: a.gravedad === 'roja' ? 'roja (atender ya)' : 'ámbar (vigilar)', titulo: a.titulo, detalle: recortar(a.detalle, 400), buzon: a.buzonId ? (nombre.get(a.buzonId) ?? null) : null }))

  return {
    ahora: aFecha(t.ahora),
    motor: {
      modo,
      ventana_de_envio: `${horaDeMinutos(t.ajustes.ventanaDesdeMin)}–${horaDeMinutos(t.ajustes.ventanaHastaMin)} (hora de Madrid)`,
      dias_hasta_pasar_a_no_contesta: t.ajustes.diasHastaNoInteresa,
      freno_por_rebotes: `${t.ajustes.frenoRebotesPct} % con al menos ${t.ajustes.frenoMinimoEnvios} envíos`,
      lee_con_ia_las_respuestas: t.ajustes.respuestasDisponible ? t.ajustes.respuestasIa : 'falta la migración 246',
      escribe_cada_seguimiento_al_enviarlo: t.ajustes.redactarAlEnviarDisponible ? t.ajustes.redactarAlEnviar : 'falta la migración 249',
    },
    hoy: {
      dia: t.hoy.dia,
      enviados: buzones.reduce((s, b) => s + b.enviados_hoy, 0),
      programados_aun: buzones.reduce((s, b) => s + b.programados_aun_hoy, 0),
      por_buzon: buzones,
    },
    proximos_dias: t.proximos.slice(0, dias).map((d) => ({
      dia: d.etiqueta,
      programados: d.total,
      por_buzon: d.porBuzon.filter((b) => b.n > 0 || b.libre < b.tope).map((b) => ({ buzon: nombre.get(b.buzonId), programados: b.n, tope: b.tope, hueco_libre: b.libre })),
    })),
    secuencias_por_estado: Object.fromEntries(Object.entries(t.conteos).map(([estado, n]) => [ETIQUETA_DE_ESTADO[estado as keyof typeof ETIQUETA_DE_ESTADO]?.texto ?? estado, n])),
    ultimos_30_dias: {
      secuencias: t.flujo.total,
      vivas: t.flujo.vivas,
      respondidas: t.flujo.respondidas,
      tasa_de_respuesta_pct: t.flujo.tasaDeRespuesta === null ? null : Math.round(t.flujo.tasaDeRespuesta * 100),
      por_que_se_cortaron: t.flujo.motivosDeCorte.slice(0, 8).map((m) => ({ motivo: m.etiqueta, secuencias: m.n })),
    },
    respuestas_de_los_leads_30_dias: {
      leidas_por_la_ia: t.respuestas.total,
      por_clase: t.respuestas.porClase.map((c) => ({ clase: c.etiqueta, n: c.n })),
      pendientes_de_leer: t.respuestas.pendientes,
      que_la_ia_no_pudo_leer: t.respuestas.fallidas,
    },
    salud: { nivel: t.salud.nivel, resumen: t.salud.resumen, alarmas },
    actividad_reciente: t.actividad.slice(0, 15).map((a) => ({ cuando: aFecha(a.en), tipo: a.tipo, detalle: recortar(a.detalle, 200), lead: a.lead })),
  }
}

export const correoEnvios: Herramienta<ContextoMcp> = {
  nombre: 'correo_envios',
  titulo: 'Correo: lo que se está enviando',
  descripcion:
    'El estado del envío automático de correos de seguimiento a los leads (la pestaña «Secuencias» de Correo): si el motor está apagado, en ensayo o enviando de verdad; por cada buzón, cuántos correos ha enviado hoy ' +
    '(a mano y automáticos), cuántos le quedan programados, su tope diario, si está conectado o pausado y cuándo sale el próximo; cuántos saldrán los próximos días; cuántas secuencias hay en cada estado; cómo han ido ' +
    'los últimos 30 días (respuestas, motivos por los que se cortaron); qué han contestado los leads según la IA; y las alarmas de salud (rebotes, buzón sin conectar, motor parado). Es la herramienta para ' +
    '«cuántos correos se están enviando» y «qué hay en cola». Para ver las secuencias una a una usa correo_cola.',
  esquema: {
    type: 'object',
    properties: {
      buzon: { type: 'string', description: 'Solo un buzón: la dirección, el nombre de su dueño (o parte) o su id. Por defecto, todos.' },
      dias: { type: 'integer', description: 'Cuántos próximos días hábiles enseñar. Por defecto 5, hasta 10.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const almacen = almacenDe(ctx)
    const quien = quienDelConector(ctx)
    const dias = entero(args, 'dias', { min: 1, max: 10, defecto: 5 })
    const consulta = texto(args, 'buzon', { max: 120 })
    try {
      const buzon = consulta ? elegirBuzon(await buzonesVisibles(almacen, quien), consulta) : null
      const t = await tablero(almacen, quien, { ahora: ahoraDe(ctx), buzonId: buzon?.id ?? null, dias: Math.max(dias, 5) })
      if (!t.disponible) return { texto: aTexto({ disponible: false, aviso: t.mensaje }) }
      return { texto: aTexto(armarEnvios(t, dias), 30_000) }
    } catch (e) {
      if (e instanceof ErrorDeHerramienta) throw e
      if (faltaLa245(e)) return { texto: aTexto({ disponible: false, aviso: FALTA_LA_MIGRACION_245 }) }
      throw e
    }
  },
}

/* ------------------------------------------------------------------ */
/* correo_cola: las secuencias una a una                               */
/* ------------------------------------------------------------------ */

/** El número 0 es el primer correo, el que escribió la persona a mano antes de que la secuencia empezara; los siguientes son los seguimientos del motor */
export const nombreDelCorreo = (orden: number): string => (orden === 0 ? 'primero (lo envió la persona)' : `seguimiento ${orden}`)

const PASO_PARA_CLAUDE = (p: PasoDeCola): Record<string, unknown> => ({
  correo: nombreDelCorreo(p.orden),
  estado: p.etiqueta,
  programado: aFecha(p.programadoAt),
  enviado: aFecha(p.enviadoAt),
  asunto: recortar(p.asunto, 120),
  nota: p.esperando ? `espera: ${p.esperando}` : p.motivo ? recortar(p.motivo, 160) : p.adaptado ? 'texto adaptado antes de enviar' : null,
})

/** Una secuencia en pocas líneas: qué lead, quién la lleva, en qué punto va y cómo van sus correos */
export function compacto(i: ItemDeCola): Record<string, unknown> {
  const salieron = i.pasos.filter((p) => p.estado === 'enviado').length
  return {
    secuencia_id: i.id,
    lead: i.lead.nombre,
    lead_id: i.leadId,
    empresa: i.lead.empresa,
    destinatario: i.destinatario,
    comercial: i.propietario,
    estado: i.etiquetaDeEstado,
    por_que: i.codigo ? (ETIQUETA_DE_CODIGO[i.codigo] ?? i.codigo) : null,
    motivo: recortar(i.motivo, 200),
    creada: aFecha(i.creadaAt),
    primer_correo: aFecha(i.primerEnvioAt),
    parada: aFecha(i.paradaAt),
    correos_enviados: `${salieron} de ${i.pasos.length} (contando el primero, que escribió la persona)`,
    siguiente: i.siguiente ? { correo: nombreDelCorreo(i.siguiente.orden), cuando: aFecha(i.siguiente.en) } : null,
    si_nadie_contesta_pasa_a_no_contesta: aFecha(i.cierre),
    correos: i.pasos.map(PASO_PARA_CLAUDE),
  }
}

const GRUPOS = ['vivas', 'terminadas', 'todas'] as const

export const correoCola: Herramienta<ContextoMcp> = {
  nombre: 'correo_cola',
  titulo: 'Correo: la cola de seguimientos, secuencia a secuencia',
  descripcion:
    'Las secuencias de correos de seguimiento a leads, una a una: qué lead, qué comercial y buzón, en qué punto va, qué correos han salido y cuáles están programados (con su día y hora), y por qué se cortó si se ' +
    'cortó. «vivas» son las que siguen en marcha o pausadas (por lo que sale antes); «terminadas», las que ya acabaron (contestó, rebotó, sin respuesta…). Filtra por buzón o busca por el nombre del lead o su ' +
    'dirección. Con `secuencia` (un id de los de la lista) devuelve esa secuencia entera: el texto de cada correo, lo que decidió el control antes de enviarlo, la historia de lo que ha pasado y qué contestó ' +
    'el lead según la IA. Para las cifras globales y la salud usa correo_envios.',
  esquema: {
    type: 'object',
    properties: {
      secuencia: { type: 'string', description: 'El id de UNA secuencia (sale en cada elemento de la lista): devuelve su detalle entero con los textos.' },
      grupo: { type: 'string', enum: [...GRUPOS], description: 'vivas (por defecto) · terminadas · todas.' },
      buzon: { type: 'string', description: 'Solo un buzón: la dirección, el nombre de su dueño (o parte) o su id.' },
      texto: { type: 'string', description: 'Busca por el nombre del lead o por la dirección a la que se escribe (mínimo 2 letras).' },
      limite: { type: 'integer', description: 'Secuencias por página. Por defecto 15, hasta 40.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const almacen = almacenDe(ctx)
    const quien = quienDelConector(ctx)
    const id = texto(args, 'secuencia', { max: 60 })
    try {
      if (id) {
        if (!UUID.test(id)) throw new ErrorDeHerramienta('«secuencia» tiene que ser el id de una secuencia (sale en cada elemento de la lista de correo_cola), con el formato 00000000-0000-0000-0000-000000000000.')
        const d = await detalleDeSecuencia(almacen, quien, id.toLowerCase())
        if (!d) throw new ErrorDeHerramienta('No existe ninguna secuencia con ese id.')
        return { texto: aTexto(armarDetalleParaClaude(d), 30_000) }
      }
      const grupo = opcion<(typeof GRUPOS)[number]>(args, 'grupo', GRUPOS, 'vivas')
      const p = paginaArg(args, { limite: 15, max: 40 })
      const consulta = texto(args, 'buzon', { max: 120 })
      const buzon = consulta ? elegirBuzon(await buzonesVisibles(almacen, quien), consulta) : null
      const busqueda = texto(args, 'texto', { max: 80 })
      const r = await colaDeSecuencias(almacen, quien, { grupo, buzonId: buzon?.id ?? null, q: busqueda ?? '', pagina: p.pagina, limite: p.limite })
      const hayMas = (r.pagina + 1) * r.limite < r.total
      return {
        texto: aTexto(
          ajustarAlTamano(
          {
            grupo,
            buzon: buzon ? `${buzon.propietario.nombre} (${buzon.direccion})` : 'todos',
            total: r.total,
            pagina: r.pagina,
            limite: r.limite,
            devueltas: r.items.length,
            hay_mas: hayMas,
            siguiente_pagina: hayMas ? r.pagina + 1 : null,
            secuencias: r.items.map(compacto),
          },
          'secuencias',
          27_000
          ),
          30_000
        ),
      }
    } catch (e) {
      if (e instanceof ErrorDeHerramienta) throw e
      if (faltaLa245(e)) return { texto: aTexto({ disponible: false, aviso: FALTA_LA_MIGRACION_245 }) }
      throw e
    }
  },
}

type Detalle = NonNullable<Awaited<ReturnType<typeof detalleDeSecuencia>>>

export function armarDetalleParaClaude(d: Detalle): Record<string, unknown> {
  return {
    ...compacto(d.secuencia),
    correos: d.pasos.map((p) => ({
      correo: nombreDelCorreo(p.orden),
      estado: p.etiqueta,
      programado: aFecha(p.programadoAt),
      enviado: aFecha(p.enviadoAt),
      asunto: recortar(p.asunto, 200),
      texto_programado: recortar(p.texto, 1800),
      texto_enviado: p.textoEnviado && p.textoEnviado !== p.texto ? recortar(p.textoEnviado, 1800) : null,
      intentos_de_envio: p.intentos,
      lo_que_decidio_la_revision: p.revision ? `${p.revision.decision}: ${recortar(p.revision.motivo, 240)}` : null,
      texto_de_ensayo: p.textoDeEnsayo ? recortar(p.textoDeEnsayo, 1200) : null,
      nota: p.esperando ? `espera: ${p.esperando}` : p.motivo ? recortar(p.motivo, 200) : null,
    })),
    historia: d.eventos.slice(-40).map((e) => ({ cuando: aFecha(e.en), tipo: e.tipo, detalle: recortar(e.detalle, 220) })),
    respuesta_del_lead: d.respuesta
      ? {
          cuando: aFecha(d.respuesta.en),
          clase: d.respuesta.etiqueta,
          resumen: recortar(d.respuesta.resumen, 300),
          evidencia: recortar(d.respuesta.evidencia, 300),
          confianza: d.respuesta.confianza,
          accion: d.respuesta.aplicada ? 'aplicada en la ficha' : d.respuesta.modo === 'ensayo' ? 'solo en ensayo (no se aplicó)' : 'no aplicada',
          rellamada_pedida: d.respuesta.fechaPedida,
        }
      : null,
  }
}

/* ------------------------------------------------------------------ */
/* Las secuencias de un lead (para su ficha)                           */
/* ------------------------------------------------------------------ */

/** Las secuencias de seguimiento de UN lead, con sus correos. Si falta la migración 245 no es un error: se dice y la ficha sigue */
export async function secuenciasDeUnLead(s: ReturnType<typeof servicioDe>, ctx: ContextoMcp, leadId: string): Promise<unknown> {
  const almacen = almacenDeSecuencias(s)
  const quien = quienDelConector(ctx)
  try {
    const visibles = await buzonesVisibles(almacen, quien)
    const ids = visibles.map((b) => b.id)
    if (ids.length === 0) return []
    const encontradas = await almacen.listarInscripciones({ buzonIds: ids, estados: null, leadIds: [leadId] }, { desde: 0, limite: 10 })
    if (encontradas.filas.length === 0) return []
    const [pasos, leads] = await Promise.all([almacen.pasosDeInscripciones(encontradas.filas.map((i) => i.id)), almacen.leadsBasicos([leadId])])
    const duenos = new Map(visibles.map((b) => [b.id, b]))
    return encontradas.filas.map((ins) =>
      compacto(armarItemDeCola({ ins, pasos: pasos.filter((p) => p.inscripcionId === ins.id), lead: leads.get(leadId), propietario: duenos.get(ins.buzonId)?.propietario.nombre ?? 'Sin nombre', propio: duenos.get(ins.buzonId)?.esMio ?? false }))
    )
  } catch (e) {
    if (faltaLa245(e)) return { disponible: false, aviso: FALTA_LA_MIGRACION_245 }
    throw e
  }
}

export const HERRAMIENTAS_DE_SECUENCIAS: readonly Herramienta<ContextoMcp>[] = [correoEnvios, correoCola]
