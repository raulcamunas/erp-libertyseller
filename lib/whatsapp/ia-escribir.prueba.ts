import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { casoPorId } from '@/lib/whatsapp/ia-casos'
import { escribirMensaje } from '@/lib/whatsapp/ia-escribir'
import { PERFIL_DE_SERIE, copiaDelPerfil } from '@/lib/whatsapp/ia-perfil'
import { cuerpoDelApunteDeWhatsapp } from '@/lib/whatsapp/mensajes'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.UTC(2026, 9, 26, 10, 0)
const BUENO = { mensaje: 'Hola, soy Raúl de Liberty Seller. Vuestra cerámica artesanal puede encontrar su sitio en Amazon sin cargar a vuestro equipo. ¿Cuándo te viene bien una llamada breve?', base: 'Que vende cerámica y no está en Amazon' }

interface Llamada {
  args: Record<string, unknown>
}
function falso(respuestas: Array<Record<string, unknown>>): { cliente: ClienteDeCorreoIa; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  let i = 0
  return {
    llamadas,
    cliente: {
      chat: {
        completions: {
          create: async (args) => {
            llamadas.push({ args })
            const r = respuestas[Math.min(i++, respuestas.length - 1)]
            return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 2500, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 2000 } } }
          },
        },
      },
    },
  }
}

const delCaso = (id: string) => {
  const c = casoPorId(id)!
  const d = c.datos(AHORA)
  return { ...d, indicaciones: c.indicaciones ?? null }
}

async function main() {
  console.log('\n=== escribir para un caso ===')
  {
    const f = falso([BUENO])
    const c = delCaso('ceramica')
    const s = await escribirMensaje({ perfil: PERFIL_DE_SERIE, lead: c.lead, notas: c.notas, llamadas: c.llamadas, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA, aleatorio: () => 0 }, { cliente: f.cliente, entorno: {} })
    ok('devuelve el mensaje, y lo ha pedido una sola vez', s.resultado.mensaje?.mensaje === BUENO.mensaje && s.resultado.llamadas === 1 && f.llamadas.length === 1)
    ok('el momento sale del estado del lead', s.situacion === 'primer_contacto')
    const mensajes = f.llamadas[0].args.messages as Array<{ role: string; content: string }>
    ok('manda el sistema y el encargo que se han compilado', mensajes[0].content === s.encargo.system && mensajes[1].content === s.encargo.usuario)
    ok('el encargo lleva los datos del lead, quién escribe y el nombre cómodo de la empresa', s.encargo.usuario.includes('Cerámica Mediterránea') && s.encargo.usuario.includes('se llama Raúl') && s.encargo.usuario.includes('«Cerámica Mediterránea»'))
    ok('con un perfil de serie, luna sin razonar', s.resultado.modelo === 'gpt-6-luna' && f.llamadas[0].args.reasoning_effort === 'none')
    ok('el coste sale de los tokens, con la caché', s.coste !== null && Math.abs(s.coste - (500 * 0.1 + 2000 * 0.01 + 100 * 0.5) / 1e6) < 1e-12)
    ok('y el techo, sin caché, es mayor', s.costeMaximo !== null && s.costeMaximo > (s.coste as number))
    ok('mide cuánto ha tardado', s.ms >= 0 && s.ms < 5000)
    ok('el tope de palabras es el del mando «Cuánto escribe»', s.maxPalabras === 90)
    ok('con «aleatorio» a cero lleva la primera forma de empezar y la primera de cerrar', s.encargo.bloques.some((b) => b.id === 'azar' && b.texto.includes('Abre con una pregunta corta sobre su negocio') && b.texto.includes('Cierra preguntando cuándo le viene bien que le llames')))
  }

  console.log('\n=== lo que cambia con el caso y con el perfil ===')
  {
    const c = delCaso('interes_alto')
    const f = falso([BUENO])
    const s = await escribirMensaje({ perfil: PERFIL_DE_SERIE, lead: c.lead, notas: c.notas, llamadas: c.llamadas, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: f.cliente, entorno: {} })
    ok('después de hablar: sin forma al azar, y con lo que se habló en la llamada', s.situacion === 'tras_hablar' && !s.encargo.bloques.some((b) => b.id === 'azar') && s.encargo.usuario.includes('Llamar el jueves por la tarde'))

    const sinVariar = copiaDelPerfil(PERFIL_DE_SERIE)
    sinVariar.ajustes.variar = false
    const k = delCaso('ceramica')
    const g = falso([BUENO])
    const s2 = await escribirMensaje({ perfil: sinVariar, lead: k.lead, notas: k.notas, llamadas: k.llamadas, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: g.cliente, entorno: {} })
    ok('con «Variar la forma» apagado no hay forma al azar', !s2.encargo.bloques.some((b) => b.id === 'azar'))

    const h = falso([BUENO])
    const s3 = await escribirMensaje({ perfil: PERFIL_DE_SERIE, lead: k.lead, notas: k.notas, llamadas: k.llamadas, miNombre: 'Raúl', indicaciones: 'Más corto', anterior: null, ahora: AHORA }, { cliente: h.cliente, entorno: {} })
    ok('si el comercial pide algo, no hay forma al azar y la petición va en el encargo', !s3.encargo.bloques.some((b) => b.id === 'azar') && s3.encargo.usuario.includes('Más corto'))

    const i = falso([BUENO])
    const s4 = await escribirMensaje({ perfil: PERFIL_DE_SERIE, lead: k.lead, notas: k.notas, llamadas: k.llamadas, situacion: 'tras_hablar', miNombre: null, indicaciones: null, anterior: null, ahora: AHORA }, { cliente: i.cliente, entorno: {} })
    ok('se puede fijar el momento y quien escribe puede no tener nombre', s4.situacion === 'tras_hablar' && s4.encargo.usuario.includes('EL MOMENTO: Después de hablar') && s4.encargo.usuario.includes('No consta el nombre de quien escribe'))

    const largo = copiaDelPerfil(PERFIL_DE_SERIE)
    largo.ajustes.longitud = 'medio'
    largo.modelo = 'gpt-6-sol'
    largo.esfuerzo = 'low'
    const j = falso([BUENO])
    const s5 = await escribirMensaje({ perfil: largo, lead: k.lead, notas: k.notas, llamadas: k.llamadas, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: j.cliente, entorno: {} })
    ok('el modelo, el razonamiento y el tope de palabras salen del perfil', s5.resultado.modelo === 'gpt-6-sol' && j.llamadas[0].args.reasoning_effort === 'low' && s5.maxPalabras === 130)
    ok('y el coste, del precio de ese modelo', s5.coste !== null && Math.abs(s5.coste - (500 * 2 + 2000 * 0.2 + 100 * 10) / 1e6) < 1e-12)
  }

  console.log('\n=== lo ya escrito ===')
  {
    const c = delCaso('seguimiento')
    const previo = c.notas.find((n) => n.kind === 'whatsapp')!
    const repetido = { mensaje: 'Hola, soy Raúl de Liberty Seller. Ayudamos a tiendas como Deportes Peña a vender más en Amazon sin cargar a vuestro equipo. ¿Tienes un minuto para que te lo cuente?', base: 'x' }
    const distinto = { mensaje: 'Hola, el otro día te escribí por aquí y hoy te he llamado sin suerte. Creo que vuestro catálogo de ciclismo puede ganar visibilidad en Amazon. ¿Cuándo te viene bien que te llame?', base: 'Seguimiento' }
    const f = falso([repetido, distinto])
    const s = await escribirMensaje({ perfil: PERFIL_DE_SERIE, lead: c.lead, notas: c.notas, llamadas: c.llamadas, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: f.cliente, entorno: {} })
    ok('si la IA repite el WhatsApp de hace tres días, se le pide otro y sale el distinto', s.resultado.llamadas === 2 && s.resultado.mensaje?.mensaje === distinto.mensaje, JSON.stringify(s.resultado.problemas))
    ok('el encargo le enseñó lo que ya se escribió', s.encargo.usuario.includes('LO QUE YA SE LE ESCRIBIÓ POR WHATSAPP') && previo.body.length > 10 && s.encargo.usuario.includes('Ayudamos a tiendas como Deportes Peña'))
    ok('y lo gastado suma las dos llamadas', s.resultado.tokens?.entrada === 5000 && s.resultado.tokens?.cache === 4000)
    void cuerpoDelApunteDeWhatsapp
  }

  console.log('\n=== si la IA no puede ===')
  {
    const clave = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const c = delCaso('ceramica')
    const s = await escribirMensaje({ perfil: PERFIL_DE_SERIE, lead: c.lead, notas: c.notas, llamadas: c.llamadas, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { entorno: {} })
    if (clave !== undefined) process.env.OPENAI_API_KEY = clave
    ok('sin clave: no hay mensaje, hay un aviso, y el coste es desconocido en vez de inventado', s.resultado.mensaje === null && /OPENAI_API_KEY/.test(s.resultado.aviso ?? '') && s.coste === null && s.costeMaximo === null)
    ok('aun así el encargo está compilado (se puede enseñar)', s.encargo.system.length > 1000 && s.encargo.bloques.length > 8)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
