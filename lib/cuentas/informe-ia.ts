/**
 * EL INFORME AL CLIENTE · LA LECTURA DEL PERIODO, PROPUESTA POR LA IA. SOLO SERVIDOR.
 *
 * Es un BORRADOR: el administrativo la lee, la corrige y añade lo que sabe y la IA no (lo hablado con el cliente, lo hecho fuera del ERP). Si la IA
 * no contesta, o se salta las reglas, sale la lectura de respaldo (cifras en frases, sin interpretar).
 *
 * Reglas (skill «identidad-documentos-liberty-seller», sección 5): nada de promesas ni de planes futuros, nada de vocabulario interno, cada
 * afirmación con su cifra, tuteo, español de España. Modelo: el de por defecto del ERP (lib/ia/modelo.ts).
 */
import OpenAI from 'openai'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { lecturaDeRespaldo, resumenParaLaIa, vocabularioInterno, type DatosDelInforme } from './informe'

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lectura'],
  properties: { lectura: { type: 'string', description: 'La lectura del periodo: 2 o 3 párrafos cortos separados por una línea en blanco' } },
} as const

const PROMESA = /\b(conseguiremos|lograremos|vamos a (conseguir|lograr|aumentar|subir|mejorar)|garantiz|seguro que|el (mes|periodo|trimestre) que viene|la (semana|quincena) que viene|próxim[ao]s? (semana|mes|quincena))/i
const USTED = /\busted(es)?\b|\bvuestr[oa]s?\b|\bvosotr[oa]s\b/i

export async function lecturaConIa(d: DatosDelInforme): Promise<{ texto: string; deIa: boolean }> {
  const respaldo = { texto: lecturaDeRespaldo(d), deIa: false }
  const clave = process.env.OPENAI_API_KEY
  if (!clave) return respaldo
  const system = [
    'Eres gestor de cuentas de Liberty Seller, una agencia que lleva cuentas de vendedores en Amazon. Escribes la LECTURA del periodo de un informe para el cliente: qué ha pasado y por qué, con las cifras delante.',
    'Debajo de tu texto el informe ya enseña todas las tablas: no las repitas enteras. Elige lo importante: cómo ha ido la publicidad frente al periodo anterior, qué producto o país lo explica, qué dicen las búsquedas si las hay, y qué NO depende de la publicidad (precio, stock, competencia) si los datos lo apuntan.',
    'Reglas: trato de TÚ al cliente (tú, tu, te), nunca de usted ni de vosotros. Español de España, directo, sin frases de agencia. Sin exclamaciones ni emojis.',
    'PROHIBIDO: prometer resultados, hablar de lo que se hará en el futuro o poner fechas; usar palabras internas como S1, S2, SOP, bulk, log, negativizar, motor, propuestas, ficha de cuenta, aprobación o firma. Si hablas de búsquedas excluidas, di «excluidas porque gastaban sin vender».',
    'Cada afirmación con su cifra (los porcentajes y euros tal y como vienen). Si un dato falta, no lo menciones. Máximo 170 palabras. Sin saludo ni firma.',
  ].join('\n')
  try {
    const cliente = new OpenAI({ apiKey: clave, maxRetries: 1, timeout: 45_000 })
    const conversacion: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: resumenParaLaIa(d) },
    ]
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const r = await cliente.chat.completions.create({
        ...parametrosDeIa({ maxSalida: 3000, esfuerzo: 'low' }),
        response_format: { type: 'json_schema', json_schema: { name: 'lectura_informe', strict: true, schema: ESQUEMA } },
        messages: conversacion,
      })
      const contenido = r.choices?.[0]?.message?.content ?? '{}'
      const texto = String((JSON.parse(contenido) as { lectura?: string }).lectura ?? '').replace(/\r\n?/g, '\n').trim()
      if (!texto || texto.split(/\s+/).length > 260) return respaldo
      const fallos: string[] = []
      if (PROMESA.test(texto)) fallos.push('promete o habla del futuro')
      if (USTED.test(texto)) fallos.push('usa «usted» o «vosotros»')
      const internas = vocabularioInterno(texto)
      if (internas.length) fallos.push(`usa palabras internas (${internas.join(', ')})`)
      if (fallos.length === 0) return { texto, deIa: true }
      conversacion.push({ role: 'assistant', content: contenido }, { role: 'user', content: `Tu texto ${fallos.join(' y ')}. Reescríbelo entero sin eso, con las mismas cifras.` })
    }
    return respaldo
  } catch (e) {
    const x = e as { status?: number; code?: string }
    console.error('[informe] la IA no ha escrito la lectura', { estado: x?.status ?? null, codigo: x?.code ?? null })
    return respaldo
  }
}
