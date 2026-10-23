import { cargarGanadores, direccionesDeLead, guardarBorrador, marcarBorradorEnviado, olvidarGanadores, redaccionesRecientes } from '@/lib/correo/ia-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Respuesta = { data?: unknown; error?: unknown; count?: number | null }

/**
 * Un cliente de Supabase falso: cualquier cadena de métodos (`.select().eq().order()…`) termina en lo que se haya preparado para esa
 * tabla. Apunta cuántas veces se ha pedido cada tabla. No comprueba qué filtros se pusieron: eso lo prueba la base real.
 */
function falso(tablas: Record<string, Respuesta | (() => Respuesta)>) {
  const peticiones: Record<string, number> = {}
  const cliente = {
    from(tabla: string) {
      peticiones[tabla] = (peticiones[tabla] ?? 0) + 1
      const preparada = tablas[tabla]
      const r: Respuesta = (typeof preparada === 'function' ? preparada() : preparada) ?? { data: [], error: null }
      const cadena: unknown = new Proxy(function () {}, {
        get: (_t, p) => (p === 'then' ? (res: (v: Respuesta) => unknown) => res({ error: null, ...r }) : () => cadena),
      })
      return cadena
    },
  }
  return { cliente: cliente as never, peticiones }
}

const PARRAFO =
  'Hemos revisado vuestra tienda y vemos una oportunidad clara para trabajar mejor las fichas de producto, el posicionamiento orgánico y la publicidad, sin cargar trabajo extra a vuestro equipo. Si os encaja, lo vemos en una videollamada breve de diez minutos y os cuento cómo lo haríamos.'
const MENSAJES = [
  { hilo_id: 'h1', buzon_id: 'b1', direccion: 'saliente', de_direccion: 'ana@agencia.es', fecha: '2026-10-01T10:00:00Z', automatico: false, asunto: 'Una propuesta', texto: `Hola, Ana\n\n${PARRAFO}` },
  { hilo_id: 'h1', buzon_id: 'b1', direccion: 'entrante', de_direccion: 'cliente@tienda.com', fecha: '2026-10-02T10:00:00Z', automatico: false, asunto: 'Re: Una propuesta', texto: 'Vale, hablamos el jueves.' },
]
const BUENAS = {
  correo_buzones: { data: [{ direccion: 'ana@agencia.es', nombre: 'Ana López' }] },
  correo_hilos: { data: [{ id: 'h1' }] },
  correo_mensajes: { data: MENSAJES },
}

async function main() {
  console.log('\n=== direccionesDeLead ===')
  ok('junta email y emails_extra, en minúsculas y sin repetir', JSON.stringify(direccionesDeLead({ email: 'Info@Tienda.es', emails_extra: 'ventas@tienda.es; INFO@tienda.es' })) === JSON.stringify(['info@tienda.es', 'ventas@tienda.es']))
  ok('varios separados por espacio, coma, barra o punto y coma', direccionesDeLead({ email: 'a@x.es / b@x.es, c@x.es' }).length === 3)
  ok('lo que no es un correo se ignora', direccionesDeLead({ email: 'sin correo', emails_extra: null }).length === 0)
  ok('sin nada', direccionesDeLead({}).length === 0)

  console.log('\n=== cargarGanadores ===')
  {
    olvidarGanadores()
    const a = falso(BUENAS)
    const g = await cargarGanadores(a.cliente)
    ok('encuentra el correo con respuesta', g.length === 1 && g[0].hiloId === 'h1' && g[0].asunto === 'Una propuesta', JSON.stringify(g.map((x) => x.hiloId)))
    ok('el ejemplo no lleva el nombre al que se saludaba ni el del comercial', g[0].texto.startsWith('Hola,') && !g[0].texto.includes('Ana'))
    ok('lee buzones, hilos y mensajes', a.peticiones.correo_buzones === 1 && a.peticiones.correo_hilos === 1 && a.peticiones.correo_mensajes === 1)
    await cargarGanadores(a.cliente)
    ok('la segunda vez sale de la memoria: no vuelve a leer', a.peticiones.correo_hilos === 1)
    await cargarGanadores(a.cliente, Date.now() + 11 * 60_000)
    ok('pasados 10 minutos se vuelve a leer', a.peticiones.correo_hilos === 2)

    // Varias peticiones a la vez comparten una sola lectura
    olvidarGanadores()
    const b = falso(BUENAS)
    await Promise.all([cargarGanadores(b.cliente), cargarGanadores(b.cliente), cargarGanadores(b.cliente)])
    ok('tres peticiones a la vez hacen una sola lectura', b.peticiones.correo_hilos === 1, JSON.stringify(b.peticiones))

    // Un fallo no tumba nada: devuelve lo último que hubo o nada
    olvidarGanadores()
    const c = falso({ ...BUENAS, correo_hilos: { data: null, error: { code: '57014', message: 'timeout' } } })
    ok('si la base falla, sin ejemplos pero sin lanzar', (await cargarGanadores(c.cliente)).length === 0)
    const d = falso({ ...BUENAS, correo_buzones: { data: null, error: { code: '42P01', message: 'no existe' } } })
    olvidarGanadores()
    ok('si faltan las tablas de correo, sin ejemplos pero sin lanzar', (await cargarGanadores(d.cliente)).length === 0)

    olvidarGanadores()
    const e = falso(BUENAS)
    await cargarGanadores(e.cliente)
    const rota = falso({ ...BUENAS, correo_hilos: { data: null, error: { code: 'XX000', message: 'caída' } } })
    const ultimo = await cargarGanadores(rota.cliente, Date.now() + 11 * 60_000)
    ok('si falla al refrescar, se queda con lo último que había', ultimo.length === 1)
    olvidarGanadores()
  }

  console.log('\n=== redaccionesRecientes ===')
  {
    const a = falso({ correo_ia_borradores: { data: null, count: 7 } })
    const r = await redaccionesRecientes(a.cliente, 'u1')
    ok('cuenta la hora y el día', r?.hora === 7 && r?.dia === 7)
    const b = falso({ correo_ia_borradores: { data: null, error: { code: '42P01' } } })
    ok('sin la tabla (migración 242) no se limita: devuelve null', (await redaccionesRecientes(b.cliente, 'u1')) === null)
  }

  console.log('\n=== guardarBorrador y marcarBorradorEnviado ===')
  {
    const fila = { user_id: 'u1', lead_id: 'l1', buzon_id: 'b1', modelo: 'gpt-5.5', angulo: 'seguimiento', asunto: 'A', texto: 'B', indicaciones: null, ejemplos: 2 }
    const a = falso({ correo_ia_borradores: { data: { id: 'abc' } } })
    ok('devuelve el id', (await guardarBorrador(a.cliente, fila)) === 'abc')
    const b = falso({ correo_ia_borradores: { data: null, error: { code: '42P01' } } })
    ok('sin la tabla devuelve null y no lanza', (await guardarBorrador(b.cliente, fila)) === null)
    let lanzo = false
    try {
      await marcarBorradorEnviado(b.cliente, { id: 'abc', userId: 'u1', hiloId: 'h1', asunto: 'A', texto: 'B' })
      await marcarBorradorEnviado(a.cliente, { id: 'abc', userId: 'u1', hiloId: 'h1', asunto: 'A', texto: 'B' })
    } catch {
      lanzo = true
    }
    ok('marcar como enviado nunca lanza, falle o no', !lanzo)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
