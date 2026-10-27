import { hoyMadrid, indiceDeSemana, inicioDelDia, sumarDias } from '@/lib/rendimiento/dia'
import type { ContextoMcp } from '../contexto'
import { crearBaseFalsa, type BaseFalsa } from './base-falsa'

/**
 * UN EQUIPO COMERCIAL DE MENTIRA PARA LAS PRUEBAS DE LAS HERRAMIENTAS DEL CONECTOR — SOLO PARA LAS PRUEBAS.
 * No se importa desde la aplicación: solo desde los `.prueba.ts` de esta carpeta.
 *
 * Todo cae en fechas RELATIVAS a hoy (las herramientas preguntan por «hoy» al reloj de verdad), nunca en fechas fijas que dejarían de cumplirse.
 *
 *   · Raúl            administrador (el que pregunta por el conector).
 *   · Maoli           comercial con Rinkel al día. La que más trabaja.
 *   · María Fernanda  comercial SIN Rinkel vinculado.
 *   · Ana             comercial con Rinkel sin leer desde hace 6 horas y sin actividad.
 *   · Jhanna          supervisora, no comercial.
 *   · «un fantasma»   una persona que ya no está en perfiles.
 */

export const uuid = (letra: string, n: number): string => `00000000-0000-4000-8000-${letra}${String(n).padStart(11, '0')}`

export const RAUL = uuid('a', 1)
export const MAOLI = uuid('a', 2)
export const MFER = uuid('a', 3)
export const ANA = uuid('a', 4)
export const JHANNA = uuid('a', 5)
export const FANTASMA = uuid('a', 99)

export const L_SOL = uuid('b', 1)
export const L_ZAPATOS = uuid('b', 2)
export const L_BEBE = uuid('b', 3)
export const L_COCINA = uuid('b', 4)
export const L_MODA = uuid('b', 5)
export const L_PEND1 = uuid('b', 6)
export const L_PEND2 = uuid('b', 7)
export const L_JARDIN = uuid('b', 8)
export const L_SOL_OUTLET = uuid('b', 9)
export const L_FERRETERIA = uuid('b', 10)

export const LL_HABLADA = uuid('c', 1)
export const LL_CONTESTADOR = uuid('c', 2)
export const LL_SIN_CONTESTAR = uuid('c', 3)
export const LL_PERDIDA = uuid('c', 4)
export const LL_CORTA = uuid('c', 5)
export const LL_CADUCADA = uuid('c', 6)
export const LL_DE_ANA = uuid('c', 7)
export const LL_VIEJA = uuid('c', 8)

export const B_MAOLI = uuid('d', 1)
export const B_ANA = uuid('d', 2)
export const B_RAUL = uuid('d', 3)

export const H_PROPUESTA = uuid('e', 1)
export const H_ANA = uuid('e', 2)
export const H_RAUL = uuid('e', 3)

export const M_AUTO = uuid('f', 1)
export const M_RESPUESTA = uuid('f', 2)
export const M_A_MANO = uuid('f', 3)
export const M_ANA = uuid('f', 4)
export const M_RAUL = uuid('f', 5)
export const M_VIEJO = uuid('f', 6)

export const CITA_PROXIMA = uuid('9', 1)
export const CITA_HECHA = uuid('9', 2)
export const CITA_EXTERNA = uuid('9', 3)

type Fila = Record<string, unknown>

/** El último día entre semana que no pasa de `dia` (los periodos «dia» de Mi rendimiento cuentan días laborables) */
export function ultimoLaborable(dia: string): string {
  let d = dia
  while (indiceDeSemana(d) >= 5) d = sumarDias(d, -1)
  return d
}

/** Un instante ISO: las `hh:mm` de ese día en Madrid */
export function a(dia: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(inicioDelDia(dia).getTime() + (h * 60 + m) * 60_000).toISOString()
}

export interface Datos {
  base: BaseFalsa
  ctx: ContextoMcp
  hoy: string
  /** El día de trabajo de la prueba: hoy o el último día entre semana */
  dia: string
  ayer: string
  /** Un texto largo, para probar los recortes */
  largo: string
  /** El día anterior al `dia` con una semana de diferencia (la referencia de las comparaciones) */
  haceUnaSemana: string
}

export const TEXTO_LARGO = `Hablamos con el gerente. ${'Quiere saber cuánto cuesta llevar la cuenta de Amazon y si trabajamos con marcas de iluminación. '.repeat(14)}Fin.`

export function crearDatos(extra: { sinTablas?: string[]; tablas?: Record<string, Fila[] | null>; columnas?: Record<string, readonly string[]> } = {}): Datos {
  const hoy = hoyMadrid()
  const dia = ultimoLaborable(hoy)
  const ayer = sumarDias(hoy, -1)
  const haceUnaSemana = sumarDias(dia, -7)
  const ahora = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()

  const perfiles: Fila[] = [
    { id: RAUL, full_name: 'Raúl Camuñas', email: 'raul@libertyseller.com', role: 'admin', is_comercial: false },
    { id: MAOLI, full_name: 'Maoli Pérez', email: 'maoli@libertyseller.com', role: 'employee', is_comercial: true },
    { id: MFER, full_name: 'María Fernanda Ruiz', email: 'mariafernanda@libertyseller.com', role: 'employee', is_comercial: true },
    { id: ANA, full_name: 'Ana López', email: 'ana@libertyseller.com', role: 'employee', is_comercial: true },
    { id: JHANNA, full_name: 'Jhanna', email: 'jhanna@libertyseller.com', role: 'employee', is_comercial: false },
  ]

  const lead = (id: string, nombre: string, asignado: string | null, estado: string, extra: Fila = {}): Fila => ({
    id,
    store_name: nombre,
    company: null,
    status: estado,
    assigned_to: asignado,
    source_list: '1a lista',
    tipo_lead: 'seller_amazon',
    ciudad: null,
    province: null,
    nivel: null,
    revenue_monthly: null,
    ventas_estimadas_usd: null,
    call_attempts: 0,
    last_contacted_at: null,
    next_call_date: null,
    follow_up: null,
    phone: null,
    email: null,
    decisor: null,
    cargo_decisor: null,
    web: null,
    directors: null,
    seller_url: null,
    category: null,
    subcategory: null,
    business_address: null,
    mercantile_registry: null,
    amazon_start: null,
    vende_en_amazon: 'sin_comprobar',
    vende_en_amazon_comprobado_en: null,
    plataforma: null,
    n_productos: null,
    anos_tienda: null,
    instagram: null,
    telefonos_extra: null,
    emails_extra: null,
    cif: null,
    tipo_empresa: null,
    n_administradores: null,
    action_label: null,
    created_at: a(sumarDias(hoy, -60), '09:00'),
    updated_at: a(hoy, '08:00'),
    ...extra,
  })

  const leads: Fila[] = [
    lead(L_SOL, 'Lámparas Sol', MAOLI, 'seguimiento', {
      company: 'Lámparas Sol SL',
      revenue_monthly: 12000,
      call_attempts: 4,
      last_contacted_at: a(dia, '11:00'),
      next_call_date: sumarDias(hoy, -3),
      follow_up: 'Quiere ver una propuesta antes del viernes',
      phone: '600 11 22 33',
      email: 'info@lamparassol.es',
      decisor: 'Carlos Sol',
      cargo_decisor: 'Administrador',
      updated_at: a(dia, '11:05'),
    }),
    lead(L_ZAPATOS, 'Zapatos Norte', MAOLI, 'programado', { revenue_monthly: 8000, call_attempts: 2, last_contacted_at: a(dia, '12:00'), next_call_date: hoy, phone: '611 22 33 44', updated_at: a(dia, '12:05') }),
    lead(L_BEBE, 'Bebé Feliz', MFER, 'no_contesta', { source_list: 'No Amazon V1', tipo_lead: 'tienda_online', nivel: 2, ventas_estimadas_usd: 85000, ciudad: 'Valencia', call_attempts: 3, last_contacted_at: a(sumarDias(hoy, -2), '10:00'), next_call_date: sumarDias(hoy, 3), web: 'bebefeliz.es', email: 'hola@bebefeliz.es' }),
    lead(L_COCINA, 'Cocina Pro', MFER, 'cita_cualificada', { source_list: 'No Amazon V1', tipo_lead: 'tienda_online', nivel: 1, ventas_estimadas_usd: 240000, call_attempts: 5, last_contacted_at: a(sumarDias(hoy, -5), '16:00') }),
    lead(L_MODA, 'Moda Sur', ANA, 'no_interesa', { company: 'Moda Sur SL', next_call_date: sumarDias(hoy, -10), call_attempts: 6, last_contacted_at: a(sumarDias(hoy, -9), '10:00') }),
    lead(L_PEND1, 'Pendiente Uno', ANA, 'pendiente'),
    lead(L_PEND2, 'Pendiente Dos', ANA, 'pendiente', { source_list: null }),
    lead(L_JARDIN, 'Jardín Verde', null, 'pendiente'),
    lead(L_SOL_OUTLET, 'Lámparas Sol Outlet', MAOLI, 'email_enviado', { last_contacted_at: a(sumarDias(hoy, -4), '09:30') }),
    lead(L_FERRETERIA, 'Ferretería Uno', FANTASMA, 'no_contesta', { call_attempts: 1 }),
  ]

  const nota = (id: number, leadId: string, autor: string | null, tipo: string, cuerpo: string, cuando: string, respuesta = false): Fila => ({
    id: uuid('8', id),
    lead_id: leadId,
    author_id: autor,
    kind: tipo,
    es_respuesta: respuesta,
    body: cuerpo,
    occurred_at: cuando,
  })
  const notas: Fila[] = [
    nota(1, L_SOL, MAOLI, 'llamada', 'Habla con el gerente: le interesa una propuesta.', a(dia, '11:10')),
    nota(2, L_SOL, MAOLI, 'whatsapp', 'Le mando el catálogo por WhatsApp.', a(dia, '11:20')),
    nota(3, L_SOL, MAOLI, 'whatsapp', 'Gracias, lo miro esta semana.', a(dia, '18:40'), true),
    nota(4, L_SOL, MAOLI, 'email', TEXTO_LARGO, a(sumarDias(hoy, -3), '10:00')),
    nota(5, L_SOL, FANTASMA, 'nota', 'Nota de alguien que ya no está.', a(sumarDias(hoy, -20), '10:00')),
    nota(6, L_ZAPATOS, MAOLI, 'llamada', 'No coge.', a(dia, '12:10')),
    nota(7, L_BEBE, MFER, 'linkedin', 'Conexión enviada.', a(sumarDias(hoy, -2), '10:30')),
    nota(8, L_COCINA, MFER, 'nota', 'Cita cualificada para el jueves.', a(sumarDias(hoy, -5), '16:10')),
  ]

  const llamada = (id: string, usuario: string, cuando: string, direccion: string, estado: string, duracion: number, extra: Fila = {}): Fila => ({
    id,
    user_id: usuario,
    rinkel_id: `rk-${id.slice(-2)}`,
    fecha: cuando,
    direccion,
    estado,
    duracion_s: duracion,
    lead_id: null,
    numero: null,
    numero_anonimo: false,
    grabacion_id: null,
    grabacion_hasta: null,
    ...extra,
  })
  const llamadas: Fila[] = [
    llamada(LL_HABLADA, MAOLI, a(dia, '11:00'), 'outbound', 'ANSWERED', 120, { lead_id: L_SOL, numero: '+34600112233', grabacion_id: 'rec-1', grabacion_hasta: iso(ahora + 60 * 86_400_000) }),
    llamada(LL_CONTESTADOR, MAOLI, a(dia, '11:30'), 'outbound', 'ANSWERED', 4, { lead_id: L_BEBE, numero: '+34611000111' }),
    llamada(LL_SIN_CONTESTAR, MAOLI, a(dia, '12:00'), 'outbound', 'MISSED', 0, { lead_id: L_ZAPATOS, numero: '+34611223344' }),
    llamada(LL_PERDIDA, MAOLI, a(dia, '17:00'), 'inbound', 'MISSED', 0, { numero: '+34699888777' }),
    llamada(LL_CORTA, MAOLI, a(dia, '13:00'), 'outbound', 'ANSWERED', 45, { lead_id: L_SOL_OUTLET, numero: '+34622000111' }),
    llamada(LL_CADUCADA, MAOLI, a(sumarDias(hoy, -2), '10:00'), 'outbound', 'ANSWERED', 300, { lead_id: L_ZAPATOS, numero: '+34611223344', grabacion_id: 'rec-2', grabacion_hasta: iso(ahora - 86_400_000) }),
    llamada(LL_DE_ANA, ANA, a(dia, '15:00'), 'outbound', 'ANSWERED', 90, { numero: null, numero_anonimo: true }),
    llamada(LL_VIEJA, MAOLI, a(sumarDias(hoy, -20), '10:00'), 'outbound', 'ANSWERED', 200, { lead_id: L_SOL, numero: '+34600112233' }),
  ]

  const transcripciones: Fila[] = [
    {
      llamada_id: LL_HABLADA,
      user_id: MAOLI,
      estado: 'hecha',
      motivo: null,
      tipo: 'conversacion',
      resumen: 'Habla con el gerente: le interesa una propuesta para su catálogo de iluminación.',
      linea: [
        { quien: 'comercial', texto: 'Se presenta y explica el servicio.' },
        { quien: 'cliente', texto: 'Pide una propuesta por escrito.' },
      ],
      siguiente_paso: 'Enviar propuesta antes del viernes',
      interes: 'alto',
      transcripcion: 'Buenas tardes, ¿hablo con Lámparas Sol? Sí, dime. Te llamo de Liberty Seller.',
      idioma: 'es',
      segundos_audio: 118,
      turnos: [
        { quien: 'comercial', texto: 'Buenas tardes, ¿hablo con Lámparas Sol?' },
        { quien: 'cliente', texto: 'Sí, dime.' },
        { quien: 'comercial', texto: 'Te llamo de Liberty Seller.' },
      ],
    },
    { llamada_id: LL_CADUCADA, user_id: MAOLI, estado: 'fallida', motivo: 'La grabación ya no está disponible', tipo: null, resumen: null, linea: [], siguiente_paso: null, interes: null, transcripcion: null, idioma: null, segundos_audio: null, turnos: null },
  ]

  const citas: Fila[] = [
    { id: CITA_PROXIMA, comercial_id: MAOLI, assigned_closer_id: RAUL, lead_name: 'Carlos Sol', lead_email: 'info@lamparassol.es', lead_phone: '600 11 22 33', lead_company: 'Lámparas Sol SL', lead_ref_id: L_SOL, start_time: a(sumarDias(hoy, 2), '10:00'), end_time: a(sumarDias(hoy, 2), '11:00'), status: 'scheduled', title: 'Consultoría', notes: 'Primera reunión', created_at: a(dia, '11:30'), is_external: false, revenue_amount: 12000, google_meet_link: 'https://meet.example/abc', transcription_summary: null },
    { id: CITA_HECHA, comercial_id: MFER, assigned_closer_id: null, lead_name: 'Cocina Pro', lead_email: null, lead_phone: null, lead_company: null, lead_ref_id: null, start_time: a(sumarDias(hoy, -2), '16:00'), end_time: a(sumarDias(hoy, -2), '17:00'), status: 'qualified', title: null, notes: null, created_at: a(sumarDias(hoy, -5), '16:10'), is_external: false, revenue_amount: null, google_meet_link: null, transcription_summary: 'Reunión muy buena; quieren empezar en noviembre.' },
    { id: CITA_EXTERNA, comercial_id: RAUL, assigned_closer_id: null, lead_name: 'Evento de Google', lead_email: null, lead_phone: null, lead_company: null, lead_ref_id: null, start_time: a(hoy, '09:00'), end_time: a(hoy, '10:00'), status: 'scheduled', title: null, notes: null, created_at: a(hoy, '08:00'), is_external: true, revenue_amount: null, google_meet_link: null, transcription_summary: null },
  ]

  const vinculos: Fila[] = [
    { user_id: MAOLI, rinkel_usuario: 'maoli', ultimo_sync_at: iso(ahora - 10 * 60_000), ultimo_intento_at: iso(ahora - 10 * 60_000), ultimo_error: null, historico_completo: true },
    { user_id: ANA, rinkel_usuario: 'ana', ultimo_sync_at: iso(ahora - 6 * 3_600_000), ultimo_intento_at: iso(ahora - 6 * 3_600_000), ultimo_error: null, historico_completo: true },
  ]

  const buzones: Fila[] = [
    { id: B_MAOLI, user_id: MAOLI, direccion: 'maoli@libertyseller.es', nombre: 'Maoli Pérez' },
    { id: B_ANA, user_id: ANA, direccion: 'ana@libertyseller.es', nombre: 'Ana López' },
    { id: B_RAUL, user_id: RAUL, direccion: 'raul@libertyseller.es', nombre: 'Raúl' },
  ]
  const hilo = (id: string, buzon: string, asunto: string, e: Fila): Fila => ({
    id,
    buzon_id: buzon,
    asunto,
    contraparte: 'Carlos Sol',
    contraparte_direccion: 'info@lamparassol.es',
    mensajes: 1,
    entrantes: 0,
    salientes: 1,
    no_leidos: 0,
    tiene_adjuntos: false,
    vista_previa: '',
    primer_mensaje_at: a(dia, '10:00'),
    ultimo_mensaje_at: a(dia, '10:00'),
    ultimo_es_entrante: false,
    automatico: false,
    ...e,
  })
  const hilos: Fila[] = [
    hilo(H_PROPUESTA, B_MAOLI, 'Propuesta para Lámparas Sol', { mensajes: 3, entrantes: 1, salientes: 2, no_leidos: 1, vista_previa: 'Gracias por la propuesta, la miramos', ultimo_mensaje_at: a(dia, '16:00'), ultimo_es_entrante: true }),
    hilo(H_ANA, B_ANA, 'Catálogo de zapatos', { contraparte: 'Zapatos Norte', contraparte_direccion: 'hola@zapatosnorte.es', vista_previa: 'Hola, te escribo para presentarte…', ultimo_mensaje_at: a(dia, '12:00') }),
    hilo(H_RAUL, B_RAUL, 'Asunto propio', { contraparte: 'Proveedor', contraparte_direccion: 'p@proveedor.es', vista_previa: 'Mi correo' }),
  ]
  const mensaje = (id: string, hiloId: string, buzon: string, sentido: string, e: Fila): Fila => ({
    id,
    hilo_id: hiloId,
    buzon_id: buzon,
    direccion: sentido,
    message_id: `mid-${id.slice(-2)}`,
    de_nombre: null,
    de_direccion: sentido === 'saliente' ? 'maoli@libertyseller.es' : 'info@lamparassol.es',
    para: [{ nombre: 'Carlos Sol', direccion: 'info@lamparassol.es' }],
    cc: [],
    destinatarios: 'Carlos Sol <info@lamparassol.es>',
    asunto: 'Propuesta para Lámparas Sol',
    fecha: a(dia, '10:00'),
    texto: 'Hola Carlos,\n\nTe envío la propuesta.',
    vista_previa: 'Hola Carlos, te envío la propuesta.',
    automatico: false,
    adjuntos: [],
    ...e,
  })
  const mensajes: Fila[] = [
    mensaje(M_AUTO, H_PROPUESTA, B_MAOLI, 'saliente', { fecha: a(dia, '10:00') }),
    mensaje(M_RESPUESTA, H_PROPUESTA, B_MAOLI, 'entrante', { fecha: a(dia, '16:00'), de_nombre: 'Carlos Sol', texto: 'Gracias por la propuesta, la miramos y te decimos algo.', vista_previa: 'Gracias por la propuesta, la miramos', adjuntos: [{ nombre: 'tarifas.pdf', tipo: 'application/pdf', tamano: 20480 }] }),
    mensaje(M_A_MANO, H_PROPUESTA, B_MAOLI, 'saliente', { fecha: a(dia, '17:00'), asunto: 'RE: Propuesta para Lámparas Sol', texto: TEXTO_LARGO, vista_previa: 'Perfecto, quedo atenta' }),
    mensaje(M_ANA, H_ANA, B_ANA, 'saliente', { fecha: a(dia, '12:00'), de_direccion: 'ana@libertyseller.es', asunto: 'Catálogo de zapatos', para: [{ nombre: '', direccion: 'hola@zapatosnorte.es' }], destinatarios: 'hola@zapatosnorte.es' }),
    mensaje(M_RAUL, H_RAUL, B_RAUL, 'saliente', { fecha: a(dia, '09:00'), de_direccion: 'raul@libertyseller.es', asunto: 'Asunto propio' }),
    mensaje(M_VIEJO, H_PROPUESTA, B_MAOLI, 'saliente', { fecha: a(sumarDias(hoy, -40), '09:00'), asunto: 'Muy antiguo' }),
  ]
  // El primero de Maoli salió de una secuencia automática
  const pasos: Fila[] = [{ id: uuid('7', 1), message_id: `mid-${M_AUTO.slice(-2)}`, estado: 'enviado', enviado_at: a(dia, '10:00') }]

  // Las cifras de Mi rendimiento (lo que devuelve la función de la base) para el día de trabajo y su referencia de una semana antes
  const fila = (user: string, d: string, e: Fila): Fila => ({
    user_id: user,
    dia: d,
    realizadas: 0,
    intentos: 0,
    recibidas: 0,
    contestadas: 0,
    segundos: 0,
    conversaciones: 0,
    whatsapp: 0,
    whatsapp_apuntes: 0,
    correos: 0,
    correos_apuntes: 0,
    respuestas: 0,
    citas: 0,
    ...e,
  })
  const resumen: Fila[] = [
    fila(MAOLI, dia, { realizadas: 20, intentos: 26, recibidas: 1, contestadas: 8, segundos: 1500, conversaciones: 3, whatsapp: 4, whatsapp_apuntes: 6, correos: 5, correos_apuntes: 5, respuestas: 2, citas: 1 }),
    fila(MAOLI, haceUnaSemana, { realizadas: 10, intentos: 12, contestadas: 4, segundos: 600, conversaciones: 1, whatsapp: 2, whatsapp_apuntes: 2, correos: 2, correos_apuntes: 2, respuestas: 1 }),
    fila(MFER, dia, { realizadas: 5, intentos: 5, contestadas: 1, segundos: 100, whatsapp: 1, whatsapp_apuntes: 1 }),
  ]

  const tablas: Record<string, Fila[] | null> = {
    profiles: perfiles,
    cold_leads: leads,
    cold_lead_notes: notas,
    rinkel_llamadas: llamadas,
    rinkel_transcripciones: transcripciones,
    rinkel_vinculos: vinculos,
    appointments: citas,
    correo_buzones: buzones,
    correo_hilos: hilos,
    correo_mensajes: mensajes,
    correo_accesos: [],
    correo_secuencia_pasos: pasos,
    ...(extra.tablas ?? {}),
  }
  for (const t of extra.sinTablas ?? []) tablas[t] = null

  const base = crearBaseFalsa(tablas, {
    unicos: {},
    columnas: extra.columnas,
    rpc: {
      rendimiento_resumen_diario: (args) => resumen.filter((f) => String(f.dia) >= String(args.p_desde) && String(f.dia) <= String(args.p_hasta)),
    },
  })
  const ctx: ContextoMcp = { usuario: { id: RAUL, email: 'raul@libertyseller.com', rol: 'admin', clienteOAuth: 'prueba' }, servicio: base.servicio }
  return { base, ctx, hoy, dia, ayer, largo: TEXTO_LARGO, haceUnaSemana }
}

/** Llama a una herramienta y devuelve su JSON ya leído (o el texto, si no es JSON) */
export async function usar(herramienta: { ejecutar(args: Record<string, unknown>, ctx: ContextoMcp): Promise<{ texto: string }> }, ctx: ContextoMcp, args: Record<string, unknown> = {}): Promise<any> {
  const r = await herramienta.ejecutar(args, ctx)
  try {
    return JSON.parse(r.texto)
  } catch {
    return r.texto
  }
}

/** Lo que dice el error de una herramienta (o null si no falla) */
export async function fallaCon(herramienta: { ejecutar(args: Record<string, unknown>, ctx: ContextoMcp): Promise<unknown> }, ctx: ContextoMcp, args: Record<string, unknown> = {}): Promise<string | null> {
  try {
    await herramienta.ejecutar(args, ctx)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
