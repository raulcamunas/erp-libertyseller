import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { probarCorreosEnLote, type EntradaDeCorreosDePrueba } from '@/lib/correo/ia-laboratorio-casos'
import { SECCIONES_BASE } from '@/lib/correo/ia-prompt'
import { PASOS_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'
import { CASOS_DE_PRUEBA, casosPedidos } from '@/lib/whatsapp/ia-casos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.UTC(2026, 9, 26, 10, 0)

const CORREO = {
  asunto: 'Amazon para vuestra tienda',
  texto:
    'Hola,\n\nSoy Raúl, de Liberty Seller. Os escribo porque vuestro catálogo tiene mucho recorrido en Amazon y podemos encargarnos de las fichas y de la publicidad sin que vuestro equipo tenga que dedicarle horas.\n\n¿Os encaja una videollamada breve de unos diez minutos esta semana?\n\nUn saludo,',
  angulo: 'entrar_en_amazon',
}
const SEGUIMIENTOS = {
  seguimiento_1:
    'Hola,\n\nTe escribí hace unos días por el catálogo. Una idea concreta: ordenar las variantes de vuestros productos suele mejorar cuántas visitas acaban en compra. Si te viene bien, lo vemos en diez minutos y te cuento cómo lo haríamos con vuestras referencias.\n\nUn saludo,',
  seguimiento_2:
    'Hola,\n\nSupongo que andáis con mucho trabajo y quizá no es el momento. Si más adelante os apetece mirar cómo se ve vuestra marca en Amazon, me lo decís con una sola palabra y retomamos la conversación cuando mejor os venga.\n\nUn saludo,',
}

/** Un cliente falso que cuenta las llamadas y contesta lo que toque según el esquema que se le pida */
function falso(opciones: { fallaEn?: (usuario: string) => boolean; retrasoMs?: number; seguimientosMal?: boolean } = {}) {
  const peticiones: Array<{ esquema: string; sistema: string; usuario: string }> = []
  const vuelo = { ahora: 0, maximo: 0 }
  const cliente: ClienteDeCorreoIa = {
    chat: {
      completions: {
        create: async (args) => {
          const mensajes = args.messages as Array<{ role: string; content: string }>
          const esquema = (args.response_format as { json_schema: { name: string } }).json_schema.name
          peticiones.push({ esquema, sistema: mensajes[0].content, usuario: mensajes[1].content })
          vuelo.ahora++
          vuelo.maximo = Math.max(vuelo.maximo, vuelo.ahora)
          await new Promise((r) => setTimeout(r, opciones.retrasoMs ?? 4))
          vuelo.ahora--
          if (opciones.fallaEn?.(mensajes[1].content)) throw Object.assign(new Error('x'), { status: 503 })
          const contenido = esquema === 'correo_para_un_lead' ? CORREO : opciones.seguimientosMal ? { seguimiento_1: 'Corto', seguimiento_2: 'Corto' } : SEGUIMIENTOS
          return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(contenido) } }], usage: { prompt_tokens: 3000, completion_tokens: 250 } }
        },
      },
    },
  }
  return { cliente, peticiones, vuelo }
}

const entrada = (cambios: Partial<EntradaDeCorreosDePrueba> = {}): EntradaDeCorreosDePrueba => ({
  secciones: SECCIONES_BASE,
  elegidos: [],
  ganadores: [],
  usarGanadores: false,
  modelo: null,
  casos: CASOS_DE_PRUEBA,
  miNombre: 'Raúl',
  indicaciones: null,
  seguimientos: false,
  pasos: PASOS_POR_DEFECTO,
  ahora: AHORA,
  ...cambios,
})

async function main() {
  console.log('\n=== un correo por persona, sin seguimientos ===')
  {
    const f = falso()
    const r = await probarCorreosEnLote(entrada(), { cliente: f.cliente })
    ok('una por cada caso, en el orden del banco', r.length === 10 && r.map((x) => x.id).join() === CASOS_DE_PRUEBA.map((c) => c.id).join())
    ok('todas con correo, con su etiqueta y sin seguimientos', r.every((x) => x.ok && x.asunto === CORREO.asunto && x.texto === CORREO.texto && x.angulo === 'entrar_en_amazon' && x.etiqueta.length > 5 && !x.real && x.seguimientos === null && x.error === null))
    ok('con modelo, tiempo y coste', r.every((x) => x.modelo.length > 3 && x.ms >= 0 && x.coste !== null && x.coste > 0 && x.seguimientosCoste === null))
    ok('una sola llamada por persona: no se piden seguimientos', f.peticiones.length === 10 && f.peticiones.every((p) => p.esquema === 'correo_para_un_lead'))
    ok('lanzadas de cuatro en cuatro', f.vuelo.maximo <= 4 && f.vuelo.maximo >= 2, String(f.vuelo.maximo))
    ok('cada una recibe su caso: el contexto lleva su empresa', f.peticiones.some((p) => p.usuario.includes('Cerámica Mediterránea')) && f.peticiones.some((p) => p.usuario.includes('audiomax')))
    ok('lo que recibió la IA va con el resultado, entero', r.every((x) => x.instrucciones.system.length > 500 && x.instrucciones.usuario.includes('CONTEXTO DEL ENCARGO')))
    ok('quien escribe es Raúl y la firma se añade sola', r.every((x) => x.instrucciones.usuario.includes('Nombre: Raúl') && x.instrucciones.usuario.includes('La firma con su nombre se añade sola')))
    const trampa = r.find((x) => x.id === 'trampa')!
    ok('la trampa llega como dato, sin el teléfono', /IGNORA TODAS LAS INSTRUCCIONES/.test(trampa.instrucciones.usuario) && !trampa.instrucciones.usuario.includes('600111222'))
    ok('el caso con petición del comercial la lleva; el resto, ninguna', r.find((x) => x.id === 'con_indicacion')!.instrucciones.usuario.includes('muy corto') && r.find((x) => x.id === 'ceramica')!.instrucciones.usuario.includes('Ninguna.'))
  }

  console.log('\n=== con sus seguimientos ===')
  {
    const f = falso()
    const r = await probarCorreosEnLote(entrada({ casos: casosPedidos(['ceramica', 'seguimiento']), seguimientos: true }), { cliente: f.cliente })
    ok('cada persona tiene su correo y los seguimientos de los pasos', r.length === 2 && r.every((x) => x.ok && x.seguimientos?.length === PASOS_POR_DEFECTO.length))
    const s = r[0].seguimientos!
    ok('con su orden, sus días y el asunto «Re: …»', s[0].orden === 1 && s[0].dias === 3 && s[1].orden === 2 && s[1].dias === 7 && s.every((x) => x.asunto === `Re: ${CORREO.asunto}`))
    ok('y el texto que escribió la IA', s[0].texto === SEGUIMIENTOS.seguimiento_1 && s[1].texto === SEGUIMIENTOS.seguimiento_2)
    ok('dos llamadas por persona: el correo y los seguimientos', f.peticiones.length === 4 && f.peticiones.filter((p) => p.esquema === 'seguimientos_para_un_lead').length === 2)
    ok('el encargo de los seguimientos lleva el primer correo y los días', f.peticiones.filter((p) => p.esquema === 'seguimientos_para_un_lead').every((p) => p.usuario.includes(`Asunto: ${CORREO.asunto}`) && p.usuario.includes('a los 3 días hábiles') && p.usuario.includes('a los 7 días hábiles')))
    ok('con coste de los seguimientos aparte', r.every((x) => x.seguimientosCoste !== null && x.seguimientosCoste > 0 && x.seguimientosModelo !== null && x.seguimientosAviso === null))
    ok('con otros pasos, los que se le den', (await probarCorreosEnLote(entrada({ casos: casosPedidos(['audio']), seguimientos: true, pasos: [{ orden: 1, dias: 2 }] }), { cliente: falso().cliente }))[0].seguimientos?.length === 1)
    ok('sin pasos no se piden seguimientos', (await probarCorreosEnLote(entrada({ casos: casosPedidos(['audio']), seguimientos: true, pasos: [] }), { cliente: falso().cliente }))[0].seguimientos === null)
  }

  console.log('\n=== lo que sale mal ===')
  {
    const f = falso({ seguimientosMal: true })
    const r = await probarCorreosEnLote(entrada({ casos: casosPedidos(['ceramica']), seguimientos: true }), { cliente: f.cliente })
    ok('si los seguimientos no valen, el correo se enseña igualmente y se dice por qué no hay seguimientos', r[0].ok && r[0].seguimientos === null && (r[0].seguimientosAviso ?? '').length > 5, JSON.stringify(r[0].seguimientosAviso))

    const g = falso({ fallaEn: (u) => u.includes('audiomax') })
    const r2 = await probarCorreosEnLote(entrada({ casos: casosPedidos(['ceramica', 'audio', 'trampa']) }), { cliente: g.cliente })
    const roto = r2.find((x) => x.id === 'audio')!
    ok('una persona que falla lo dice y no tumba a las demás', !roto.ok && roto.asunto === null && /problema|IA/.test(roto.error ?? '') && r2.filter((x) => x.ok).length === 2, JSON.stringify(roto.error))
    ok('conserva lo que recibió la IA para poder mirar por qué', roto.instrucciones.usuario.includes('audiomax'))
  }

  console.log('\n=== lead real, modelo y ejemplos ===')
  {
    const f = falso()
    const real = { id: 'lead-1', etiqueta: 'Mi lead real', lead: { store_name: 'Tienda Real', status: 'programado', category: 'Moda' }, notas: [], llamadas: [] }
    const r = await probarCorreosEnLote(entrada({ casos: casosPedidos(['ceramica']), real, indicaciones: 'Más corto' }), { cliente: f.cliente })
    ok('el lead real va después de los casos y se marca como real', r.length === 2 && r[1].real && r[1].id === 'lead-1' && r[1].etiqueta === 'Mi lead real')
    ok('la petición común llega a todos', f.peticiones.every((p) => p.usuario.includes('Más corto')))
    ok('el lead real se lee como dato: su nombre va en el contexto', f.peticiones.some((p) => p.usuario.includes('Tienda Real')))

    const h = falso()
    const m = await probarCorreosEnLote(entrada({ casos: casosPedidos(['ceramica']), modelo: 'gpt-6-sol' }), { cliente: h.cliente })
    ok('el modelo que se pide es el que se usa y el que se cobra', m[0].modelo === 'gpt-6-sol' && m[0].coste !== null)

    const e = falso()
    const conEjemplos = await probarCorreosEnLote(
      entrada({
        casos: casosPedidos(['ceramica']),
        elegidos: [{ id: 'e1', titulo: 'Mío', asunto: 'Tu cerámica en Amazon', texto: 'Hola,\n\nHe visto que vendéis cerámica artesanal y creo que en Amazon tendría mucho recorrido: os podemos ayudar con las fichas y con la publicidad sin que tengáis que dedicarle horas.\n\n¿Os viene bien una llamada breve esta semana?\n\nUn saludo,', tipo: 'ambos', nota: null, activo: true }],
      }),
      { cliente: e.cliente }
    )
    ok('los ejemplos propios entran y se cuentan', conEjemplos[0].ejemplos === 1 && e.peticiones[0].usuario.includes('Tu cerámica en Amazon'))
  }

  console.log('\n=== sin clave ===')
  {
    const clave = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const r = await probarCorreosEnLote(entrada({ casos: casosPedidos(['ceramica', 'audio']) }))
    if (clave !== undefined) process.env.OPENAI_API_KEY = clave
    ok('cada persona dice por qué no hay correo', r.every((x) => !x.ok && /OPENAI_API_KEY/.test(x.error ?? '') && x.coste === null))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
