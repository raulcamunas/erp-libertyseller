/**
 * LO QUE ESCRIBE LA IA EN EL CORREO DEL ANÁLISIS: el asunto, el saludo y la entradilla. Lo demás (el adelanto del informe, el botón, el comercial,
 * la baja) sale de los datos y es igual para todos.
 *
 * NO TODOS IGUAL: la entradilla depende de en qué punto está el lead.
 *   primer_contacto  nunca se ha hablado con él: quiénes somos en media frase y por qué le escribimos
 *   sin_respuesta    se le ha llamado (ciclo Fase 2/3) sin hablar: sin reproches, el análisis como excusa para retomar
 *   hablado          ya se habló: se retoma lo que se habló (sale del historial) y el análisis es el paso siguiente
 *   no_interesa      dijo que no: se respeta, sin insistir; el análisis es un regalo sin compromiso
 * Y del análisis, lo que más pese de SU cuenta (no una lista genérica).
 *
 * Reglas fijas (si la IA se las salta, va el texto fijo): de TÚ (son españoles; desde el 13 nov 2026), nada de dinero ni promesas de
 * resultados, nada inventado, corto. Vale para los dos informes: el de una cuenta de Amazon y el de una tienda que no vende allí.
 */
import OpenAI from 'openai'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { esSinAmazon } from '@/lib/analisis-sin-amazon/construir'
import { depurar } from '@/lib/analisis-sin-amazon/calidad'
import { asuntoCorreoAnalisis, type InformeDelCorreo } from './correo'

export type Situacion = 'primer_contacto' | 'sin_respuesta' | 'hablado' | 'no_interesa'

export const ETIQUETA_DE_SITUACION: Record<Situacion, string> = {
  primer_contacto: 'Primer contacto',
  sin_respuesta: 'Se le ha llamado sin respuesta',
  hablado: 'Ya se habló con él',
  no_interesa: 'Dijo que no le interesaba',
}

export type LeadParaCorreo = {
  status: string | null
  ciclo_fase: string | null
  decisor: string | null
  last_contacted_at: string | null
}

export type NotaParaCorreo = { kind: string; body: string; occurred_at: string }

export function situacionDelLead(lead: LeadParaCorreo, notas: NotaParaCorreo[]): Situacion {
  if (lead.status === 'no_interesa') return 'no_interesa'
  const hablado =
    ['seguimiento', 'cita_cualificada', 'programado', 'email_enviado'].includes(lead.status ?? '') ||
    notas.some((n) => n.kind === 'llamada' && !/no contesta|sin respuesta|buz[oó]n|no responde/i.test(n.body))
  if (hablado) return 'hablado'
  if (lead.ciclo_fase || lead.status === 'no_contesta' || lead.last_contacted_at) return 'sin_respuesta'
  return 'primer_contacto'
}

/** El nombre de pila del decisor, si parece un nombre de persona */
export function nombreDePila(decisor: string | null): string | null {
  const d = (decisor ?? '').trim()
  if (!d || /@|\d|equipo|departamento|gerencia|administraci/i.test(d)) return null
  const primero = d.split(/\s+/)[0]
  return primero.length >= 2 && primero.length <= 20 ? primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase() : null
}

export type TextosDelCorreo = { asunto: string; saludo: string; entradilla: string; deIa: boolean }

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['asunto', 'entradilla'],
  properties: {
    asunto: { type: 'string', description: 'Asunto del correo, máximo 70 caracteres' },
    entradilla: { type: 'string', description: 'Dos o tres frases (máximo 70 palabras). Puede llevar un salto de párrafo (línea en blanco)' },
  },
} as const

const DINERO = /€|\$|\beur(?:o|os)?\b|\bfactura(?:r|ción)\b.*\d|\d+\s*%\s*m[aá]s\s+de\s+ventas/i
// De tú: lo que no vale es el usted ni el vosotros. Con lookarounds de letra Unicode: con \b, «años» o «dueños» darían «os» suelto
const USTED = /(?<!\p{L})(usted|ustedes|vuestr[oa]s?|vosotros|os)(?!\p{L})/iu
const PROMESA = /(?:le |te )?(?:garantiz|aseguramos|duplicar|triplicar|multiplicar)/i

function resumenDelInforme(original: InformeDelCorreo): string {
  const inf = esSinAmazon(original) ? depurar(original) : original
  if (esSinAmazon(inf)) {
    const m = inf.marca
    return [
      `Tienda online: ${inf.vendedor.nombre} (${inf.vendedor.web}). NO vende en Amazon.`,
      inf.caso === 'revendida'
        ? `Su marca ${m.nombre} ya tiene ${m.modelos} fichas en Amazon y la venden otras tiendas (${m.vendedores.map((v) => v.nombre).slice(0, 3).join(', ') || 'terceros'}), no él.${m.sinVendedor ? ` ${m.sinVendedor} de ${m.revisadas} fichas revisadas no tienen a nadie vendiéndolas: quien las busca no puede comprar.` : ''}`
        : `Su marca ${m.nombre} no está en Amazon: quien la busca allí compra otra.`,
      ...inf.mercados.map(
        (x) =>
          `- ${x.nombre}: ${x.modo === 'ventas' ? `los primeros venden ${x.ventasMes} uds/mes` : 'nicho, pocas ventas publicadas'}, precio mediano ${x.precioMediano ?? '?'} €, reseñas medianas ${x.resenasMediana ?? '?'}; marcas que mandan: ${x.marcas.map((y) => y.marca).slice(0, 3).join(', ') || '—'}`,
      ),
      `Lo que más pesa: ${inf.claves.map((c) => `${c.cifra} ${c.titulo}`).join('; ')}`,
    ].join('\n')
  }
  const lineas = [
    `Tienda: ${inf.vendedor.nombre}`,
    `Tipo de vendedor: ${inf.tipoTexto}`,
    `Productos activos en España: ${inf.cifras.productos}`,
    inf.cifras.buyBox !== null ? `Buy Box en sus ofertas: ${inf.cifras.buyBox} %` : null,
    `Lo que más pesa (de más a menos):`,
    ...inf.oportunidades.slice(0, 4).map((o) => `- ${o.cifra} ${o.titulo}${o.impacto ? ` (${o.impacto})` : ''}`),
    inf.fortalezas.length ? `Lo que hace bien: ${inf.fortalezas.slice(0, 2).map((f) => f.titulo).join('; ')}` : null,
  ]
  return lineas.filter(Boolean).join('\n')
}

const INSTRUCCIONES: Record<Situacion, string> = {
  primer_contacto:
    'Nunca hemos hablado con esta empresa. Preséntate en media frase como Liberty Seller, agencia que trabaja cuentas de Amazon, y di que hemos mirado con datos públicos lo que cuenta el análisis. Menciona UNO de los puntos que más pesan, en concreto.',
  sin_respuesta:
    'Le hemos llamado alguna vez y no hemos coincidido. Dilo con naturalidad y sin reproche ("no hemos coincidido por teléfono") y que, para no hacerle perder tiempo, le dejamos el análisis por escrito (en el correo, de tú: "te lo dejo por escrito"). Menciona UNO de los puntos que más pesan.',
  hablado:
    'Ya hemos hablado con esta empresa (mira el historial). Retoma la conversación con una referencia breve y verdadera a lo que se habló, si el historial lo dice; si no lo dice, solo "como te comentamos". El análisis es el paso siguiente. Menciona UNO de los puntos que más pesan.',
  no_interesa:
    'Nos dijo que ahora no le interesaba. Respétalo de verdad: reconócelo en una frase, sin insistir ni pedir una llamada, y di que aun así le dejamos el análisis por si le es útil, sin compromiso. Menciona UNO de los puntos que más pesan.',
}

export async function escribirTextos(
  inf: InformeDelCorreo,
  datos: { situacion: Situacion; nombre: string | null; comercial: string; notas: NotaParaCorreo[] },
): Promise<TextosDelCorreo & { tokens?: { entrada: number; salida: number } }> {
  const saludo = datos.nombre ? `Hola, ${datos.nombre}:` : `Hola, equipo de ${inf.vendedor.nombre}:`
  const fijo: TextosDelCorreo = {
    asunto: asuntoCorreoAnalisis(inf),
    saludo,
    entradilla: '',
    deIa: false,
  }
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) return fijo

  const historial = datos.notas
    .slice(0, 5)
    .map((n) => `[${n.occurred_at.slice(0, 10)} · ${n.kind}] ${n.body.replace(/\s+/g, ' ').slice(0, 280)}`)
    .join('\n')

  const system = [
    esSinAmazon(inf)
      ? `Eres ${datos.comercial}, del equipo comercial de Liberty Seller (agencia que gestiona cuentas de vendedores en Amazon). Escribes el principio de un correo que acompaña a un análisis de la oportunidad en Amazon de su tienda online, que hoy no vende en Amazon.`
      : `Eres ${datos.comercial}, del equipo comercial de Liberty Seller (agencia que gestiona cuentas de vendedores en Amazon). Escribes el principio de un correo que acompaña a un análisis de la cuenta de Amazon del destinatario.`,
    'Debajo de tu texto el correo ya enseña las cifras, los tres puntos clave y un botón para ver el análisis: NO los repitas todos ni pongas enlaces.',
    'Reglas: trato de TÚ (tu, tus, te, tienes, vendes), nunca de usted ni de vosotros. Español de España, natural, directo, sin frases de agencia ("potenciar", "llevar al siguiente nivel", "sinergias"). Sin exclamaciones. Sin emojis.',
    'Nunca hables de dinero, precios ni de cuánto ganaría. Nunca prometas resultados. No inventes nada que no esté en los datos o en el historial.',
    'Tú no explicas ni resuelves los puntos del análisis, ni propones hacerlo por teléfono: si ofreces seguir, es poner a la persona en contacto con nuestro equipo de estrategia, que se lo explica todo.',
    'No firmes ni te despidas (la firma va aparte). No empieces con el saludo (va aparte).',
    'El asunto: concreto, con el nombre de la tienda, sin mayúsculas de reclamo, sin "Re:" ni "Fwd:", máximo 70 caracteres.',
  ].join('\n')
  const usuario = [
    `SITUACIÓN: ${INSTRUCCIONES[datos.situacion]}`,
    '',
    'DATOS DEL ANÁLISIS:',
    resumenDelInforme(inf),
    '',
    historial ? `HISTORIAL RECIENTE CON ESTE LEAD (lo más nuevo primero):\n${historial}` : 'HISTORIAL: no hay nada apuntado.',
  ].join('\n')

  try {
    const cliente = new OpenAI({ apiKey: clave, maxRetries: 1, timeout: 45_000 })
    const conversacion: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: usuario },
    ]
    const gasto = { entrada: 0, salida: 0 }
    // Dos vueltas como mucho: la segunda solo si en la primera se le escapa el usted o el «vosotros»
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const r = await cliente.chat.completions.create({
        ...parametrosDeIa({ maxSalida: 4000, esfuerzo: 'low' }),
        response_format: { type: 'json_schema', json_schema: { name: 'correo_analisis', strict: true, schema: ESQUEMA } },
        messages: conversacion,
      })
      gasto.entrada += r.usage?.prompt_tokens ?? 0
      gasto.salida += r.usage?.completion_tokens ?? 0
      const contenido = r.choices?.[0]?.message?.content ?? '{}'
      const o = JSON.parse(contenido) as { asunto?: string; entradilla?: string }
      const asunto = (o.asunto ?? '').replace(/[\r\n]+/g, ' ').trim()
      const entradilla = (o.entradilla ?? '').replace(/\r\n?/g, '\n').trim()
      const mal = !asunto || !entradilla || asunto.length > 90 || entradilla.split(/\s+/).length > 110 || DINERO.test(entradilla + asunto) || PROMESA.test(entradilla)
      if (mal) return { ...fijo, tokens: gasto }
      if (!USTED.test(entradilla + ' ' + asunto)) return { asunto, saludo, entradilla, deIa: true, tokens: gasto }
      conversacion.push(
        { role: 'assistant', content: contenido },
        { role: 'user', content: 'Has usado «usted», «vuestro», «vosotros» u «os». Reescríbelo entero tuteando a una persona (tú, tu, te), sin cambiar nada más.' },
      )
    }
    return { ...fijo, tokens: gasto }
  } catch (e) {
    const x = e as { status?: number; code?: string }
    console.error('[analisis-correo] la IA no ha escrito el correo', { estado: x?.status ?? null, codigo: x?.code ?? null })
    return fijo
  }
}
