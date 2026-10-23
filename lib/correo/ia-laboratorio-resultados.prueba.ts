import { calcularResultados } from '@/lib/correo/ia-laboratorio-resultados'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una base de mentira en memoria con lo justo que usa calcularResultados */
type Fila = Record<string, unknown>
class Consulta implements PromiseLike<{ data: unknown; error: unknown }> {
  private filtros: Array<(f: Fila) => boolean> = []
  private orden: { col: string; asc: boolean } | null = null
  private tope: number | null = null
  constructor(
    private filas: Fila[],
    private rota: string | null
  ) {}
  select() {
    return this
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v)
    return this
  }
  in(c: string, vs: unknown[]) {
    this.filtros.push((f) => vs.includes(f[c]))
    return this
  }
  not(c: string, _is: string, v: unknown) {
    this.filtros.push((f) => f[c] !== v && f[c] !== undefined)
    return this
  }
  gte(c: string, v: string) {
    this.filtros.push((f) => String(f[c]) >= v)
    return this
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orden = { col, asc: o?.ascending !== false }
    return this
  }
  limit(n: number) {
    this.tope = n
    return this
  }
  then<T1, T2>(res?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null, rej?: ((r: unknown) => T2 | PromiseLike<T2>) | null) {
    if (this.rota) return Promise.resolve({ data: null, error: { code: this.rota } }).then(res, rej)
    let r = this.filas.filter((f) => this.filtros.every((fn) => fn(f)))
    if (this.orden) {
      const { col, asc } = this.orden
      r = [...r].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1))
    }
    if (this.tope !== null) r = r.slice(0, this.tope)
    return Promise.resolve({ data: r, error: null }).then(res, rej)
  }
}

const AHORA = Date.parse('2026-10-23T12:00:00Z')
const dia = (n: number) => new Date(AHORA - n * 86_400_000).toISOString()

interface Datos {
  versiones: Fila[]
  borradores: Fila[]
  mensajes: Fila[]
  rpc: unknown
  rpcRota?: boolean
}
function servicio(d: Datos) {
  const tablas: Record<string, Fila[]> = {
    correo_ia_versiones: d.versiones,
    correo_ia_borradores: d.borradores,
    correo_buzones: [{ direccion: 'ana@agencia.es' }, { direccion: 'luis@agencia.es' }],
    correo_mensajes: d.mensajes,
  }
  const llamadasRpc: unknown[] = []
  return {
    llamadasRpc,
    cliente: {
      from: (t: string) => new Consulta(tablas[t] ?? [], null),
      rpc: async (nombre: string, args: unknown) => {
        llamadasRpc.push({ nombre, args })
        return d.rpcRota ? { data: null, error: { code: 'PGRST202' } } : { data: d.rpc, error: null }
      },
    } as never,
  }
}

const version = (id: string, nombre: string, extra: Fila = {}): Fila => ({
  id,
  nombre,
  notas: null,
  secciones: {},
  ejemplos_ids: [],
  usar_ganadores: true,
  modelo: null,
  peso: 50,
  activa: true,
  es_base: false,
  archivada: false,
  creada_por: null,
  creada_at: '2026-10-01T00:00:00Z',
  actualizada_at: '2026-10-01T00:00:00Z',
  ...extra,
})
const borrador = (id: string, version_id: string | null, hilo_id: string | null, enviado: number, extra: Fila = {}): Fila => ({ id, version_id, hilo_id, enviado_at: dia(enviado), texto: 'Hola, te escribo por una cosa interesante de vuestra tienda', texto_final: null, asunto_final: 'Asunto', ...extra })
const entrante = (hilo: string, de: string, haceDias: number, texto: string, automatico = false): Fila => ({ hilo_id: hilo, direccion: 'entrante', fecha: dia(haceDias), de_direccion: de, automatico, texto })

async function main() {
  console.log('\n=== resultados por versión ===')
  {
    const s = servicio({
      versiones: [version('base', 'Versión original', { es_base: true, peso: 50 }), version('b', 'Usted')],
      borradores: [
        // original: 4 enviados (uno sin versión, de antes de las versiones): 2 contestan, una con interés y un «no»
        borrador('1', 'base', 'h1', 10),
        borrador('2', null, 'h2', 10),
        borrador('3', 'base', 'h3', 10),
        borrador('4', 'base', 'h4', 10),
        // Usted: 3 enviados: uno con interés editado
        borrador('5', 'b', 'h5', 10, { texto_final: 'Hola, te escribo por una cosa interesante de vuestra tienda y os propongo una llamada de diez minutos esta semana', asunto_final: 'Una llamada' }),
        borrador('6', 'b', 'h6', 10),
        borrador('7', 'b', null, 10),
      ],
      mensajes: [
        entrante('h1', 'cliente@a.com', 9, 'Buenas, nos viene bien el jueves.'),
        entrante('h2', 'cliente@b.com', 9, 'No estamos interesados, gracias.'),
        entrante('h3', 'luis@agencia.es', 9, 'prueba interna'),
        entrante('h5', 'cliente@c.com', 9, 'Me interesa, llamadme mañana.'),
        entrante('h6', 'no-reply@zendesk.com', 9, 'Recibido', true),
      ],
      rpc: { total: 10, con_entrantes: [{ hilo_id: 'm1', enviado_at: dia(12), entrantes: 1 }, { hilo_id: 'm2', enviado_at: dia(12), entrantes: 1 }] },
    })
    const r = await calcularResultados(s.cliente, 45, AHORA)
    const orig = r.versiones.find((v) => v.id === 'base')!
    const usted = r.versiones.find((v) => v.id === 'b')!
    ok('la original suma los suyos y los de antes de las versiones', orig.resumen.enviados === 4, JSON.stringify(orig.resumen))
    ok('cuenta quién contestó (de fuera) y con interés', orig.resumen.respondieron === 2 && orig.resumen.interesadas === 1, JSON.stringify(orig.resumen))
    ok('un compañero probándose no cuenta', orig.resumen.respondieron === 2)
    ok('«Usted»: 3 enviados, uno con interés (el no-reply y la conversación sin hilo no cuentan)', usted.resumen.enviados === 3 && usted.resumen.respondieron === 1 && usted.resumen.interesadas === 1, JSON.stringify(usted.resumen))
    ok('mide cuánto cambió el comercial lo que escribió la IA', (usted.resumen.cambiosMedios ?? 0) > 20 && orig.resumen.cambiosMedios === null, String(usted.resumen.cambiosMedios))
    ok('guarda el correo que consiguió respuesta, con el texto que salió de verdad', usted.conRespuesta.length === 1 && usted.conRespuesta[0].asunto === 'Una llamada' && usted.conRespuesta[0].texto.includes('llamada de diez minutos'))
    ok('«en marcha» según peso y estado', orig.enMarcha && usted.enMarcha)
    ok('con menos de 30 envíos por versión no hay veredicto', r.veredicto.tipo === 'sin-datos')
    ok('lleva los días y la fecha desde la que se mira', r.dias === 45 && r.desde === dia(45))

    ok('pide a la base los correos fríos SIN IA excluyendo los hilos de la IA', JSON.stringify((s.llamadasRpc[0] as { args: { p_excluir: string[] } }).args.p_excluir) === JSON.stringify(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']))
    ok('el «a mano»: 10 enviados y, sin los textos de sus respuestas, ninguno contestó de verdad', r.aMano !== null && r.aMano.enviados === 10 && r.aMano.respondieron === 0, JSON.stringify(r.aMano))
  }

  console.log('\n=== el «a mano» con respuestas ===')
  {
    const s = servicio({
      versiones: [version('base', 'Versión original', { es_base: true })],
      borradores: [],
      mensajes: [entrante('m1', 'cliente@a.com', 11, 'Cuéntame más, estoy interesado.'), entrante('m2', 'cliente@b.com', 11, 'No nos interesa, gracias.'), entrante('m3', 'luis@agencia.es', 11, 'prueba')],
      rpc: { total: 20, con_entrantes: [{ hilo_id: 'm1', enviado_at: dia(12), entrantes: 1 }, { hilo_id: 'm2', enviado_at: dia(12), entrantes: 1 }, { hilo_id: 'm3', enviado_at: dia(12), entrantes: 1 }] },
    })
    const r = await calcularResultados(s.cliente, 45, AHORA)
    ok('de 20 fríos: 2 contestan de fuera, 1 con interés (el interno no cuenta)', r.aMano !== null && r.aMano.enviados === 20 && r.aMano.respondieron === 2 && r.aMano.interesadas === 1, JSON.stringify(r.aMano))
    ok('la original sin envíos sale igualmente, con todo a cero', r.versiones[0].resumen.enviados === 0 && r.versiones[0].resumen.tasaInteres === null)
  }

  console.log('\n=== si falta algo ===')
  {
    const sinFuncion = servicio({ versiones: [version('base', 'Original', { es_base: true })], borradores: [], mensajes: [], rpc: null, rpcRota: true })
    const r = await calcularResultados(sinFuncion.cliente, 45, AHORA)
    ok('sin la función de la base, el «a mano» es null y lo demás sigue', r.aMano === null && r.versiones.length === 1)

    const sinTabla = {
      from: (t: string) => new Consulta([], t === 'correo_ia_versiones' ? '42P01' : null),
      rpc: async () => ({ data: null, error: null }),
    } as never
    let lanza = false
    try {
      await calcularResultados(sinTabla, 45, AHORA)
    } catch {
      lanza = true
    }
    ok('sin las tablas lanza (la ruta lo traduce a «lanza la migración 243»)', lanza)
  }

  console.log('\n=== un ganador claro ===')
  {
    const borradores: Fila[] = []
    const mensajes: Fila[] = []
    for (let i = 0; i < 100; i++) {
      borradores.push(borrador(`a${i}`, 'a', `ha${i}`, 5))
      borradores.push(borrador(`b${i}`, 'b', `hb${i}`, 5))
      if (i < 15) mensajes.push(entrante(`ha${i}`, `c${i}@x.com`, 4, 'Nos interesa, llamadnos.'))
      if (i < 2) mensajes.push(entrante(`hb${i}`, `d${i}@x.com`, 4, 'Nos interesa, llamadnos.'))
    }
    const s = servicio({ versiones: [version('a', 'Versión A', { es_base: true }), version('b', 'Versión B')], borradores, mensajes, rpc: { total: 0, con_entrantes: [] } })
    const r = await calcularResultados(s.cliente, 45, AHORA)
    ok('15 de 100 contra 2 de 100: gana A con claridad (con 12 contra 2 los intervalos aún se rozan y el veredicto espera)', r.veredicto.tipo === 'lider' && r.veredicto.id === 'a', JSON.stringify(r.veredicto))
    ok('guarda solo cinco correos con respuesta por versión', r.versiones.find((v) => v.id === 'a')!.conRespuesta.length === 5)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
