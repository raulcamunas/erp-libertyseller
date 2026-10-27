import { NOTAS_DEL_AVISO, SEGUNDOS_ENTRE_SONIDOS, VOLUMEN_DEL_AVISO, crearSonido, type ContextoDeAudio, type DepsDeSonido } from '@/lib/avisos/sonido'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Un audio de mentira: apunta qué osciladores se crean y cuándo, y se puede decir si el navegador deja arrancar o no */
function mundo(opciones: { deja?: boolean; yaHuboGesto?: boolean; sinAudio?: boolean; preferencia?: boolean } = {}) {
  const reg = { osciladores: [] as Array<{ hz: number[]; start: number | null; stop: number | null }>, ganancias: [] as Array<{ valores: Array<[string, number, number]> }>, contextos: 0, resumes: 0, guardado: [] as boolean[] }
  let reloj = 1_000_000
  const gestos: Array<() => void> = []
  let preferencia = opciones.preferencia ?? true
  const contexto: ContextoDeAudio = {
    state: 'suspended',
    currentTime: 5,
    destination: 'destino',
    async resume() {
      reg.resumes++
      if (opciones.deja !== false) (contexto as { state: string }).state = 'running'
    },
    createOscillator() {
      const o = { hz: [] as number[], start: null as number | null, stop: null as number | null }
      reg.osciladores.push(o)
      return {
        type: '',
        frequency: { value: 0, setValueAtTime: (v: number) => o.hz.push(v), linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: () => undefined,
        start: (t?: number) => {
          o.start = t ?? 0
        },
        stop: (t?: number) => {
          o.stop = t ?? 0
        },
      }
    },
    createGain() {
      const g = { valores: [] as Array<[string, number, number]> }
      reg.ganancias.push(g)
      return {
        gain: {
          value: 1,
          setValueAtTime: (v: number, t: number) => g.valores.push(['set', v, t]),
          linearRampToValueAtTime: (v: number, t: number) => g.valores.push(['lineal', v, t]),
          exponentialRampToValueAtTime: (v: number, t: number) => g.valores.push(['exp', v, t]),
        },
        connect: () => undefined,
      }
    },
  }
  const deps: DepsDeSonido = {
    crearContexto: () => {
      if (opciones.sinAudio) return null
      reg.contextos++
      return contexto
    },
    ahora: () => reloj,
    yaHuboGesto: () => opciones.yaHuboGesto === true,
    alPrimerGesto: (m) => {
      gestos.push(m)
      return () => {
        const i = gestos.indexOf(m)
        if (i >= 0) gestos.splice(i, 1)
      }
    },
    leerPreferencia: () => preferencia,
    guardarPreferencia: (v) => {
      preferencia = v
      reg.guardado.push(v)
    },
  }
  return { reg, deps, contexto, avanzar: (s: number) => (reloj += s * 1000), gestos, sonido: crearSonido(deps) }
}

async function main() {
  console.log('\n=== suena un din-don suave ===')
  {
    const m = mundo({ yaHuboGesto: true })
    m.sonido.preparar()
    const r = await m.sonido.sonarCorreo('a')
    ok('suena', r === 'sono', r)
    const tonos = m.reg.osciladores.map((o) => o.hz[0])
    ok('dos notas, cada una con su octava floja', m.reg.osciladores.length === 4 && tonos.filter((h) => h === NOTAS_DEL_AVISO[0].hz).length === 1 && tonos.filter((h) => h === NOTAS_DEL_AVISO[1].hz).length === 1 && tonos.includes(NOTAS_DEL_AVISO[0].hz * 2), JSON.stringify(tonos))
    ok('la segunda nota entra un poco después de la primera', m.reg.osciladores[2].start! > m.reg.osciladores[0].start!)
    ok('todo se para por sí solo (cada oscilador tiene su stop)', m.reg.osciladores.every((o) => o.stop !== null && o.start !== null && o.stop > o.start))
    const volumenes = m.reg.ganancias.map((g) => g.valores.find((v) => v[0] === 'lineal')?.[1]).filter((v): v is number => v !== undefined)
    ok('el volumen es bajo (por debajo de 0,15) y cada nota termina casi en silencio', volumenes.length === 2 && volumenes.every((v) => v === VOLUMEN_DEL_AVISO && v < 0.15) && m.reg.ganancias.filter((g) => g.valores.some((v) => v[0] === 'exp' && v[1] < 0.001)).length === 2)
    ok('un solo contexto de audio', m.reg.contextos === 1)
  }

  console.log('\n=== una vez por correo y no más de una cada doce segundos ===')
  {
    const m = mundo({ yaHuboGesto: true })
    m.sonido.preparar()
    ok('el primero suena', (await m.sonido.sonarCorreo('a')) === 'sono')
    ok('otro correo enseguida, no: lo paran los doce segundos', (m.avanzar(1), await m.sonido.sonarCorreo('b')) === 'repetido')
    ok('el mismo correo por el otro camino, no (aunque haya pasado un rato)', (m.avanzar(60), await m.sonido.sonarCorreo('a')) === 'repetido')
    ok('otro correo pasados los doce segundos, sí', (m.avanzar(SEGUNDOS_ENTRE_SONIDOS), await m.sonido.sonarCorreo('c')) === 'sono')
    ok('sin id solo vale la regla de los doce segundos', (m.avanzar(2), await m.sonido.sonarCorreo()) === 'repetido' && (m.avanzar(20), await m.sonido.sonarCorreo()) === 'sono')
  }

  console.log('\n=== apagado ===')
  {
    const m = mundo({ yaHuboGesto: true, preferencia: false })
    m.sonido.preparar()
    ok('apagado desde antes: no suena', (await m.sonido.sonarCorreo('a')) === 'silenciado' && m.reg.osciladores.length === 0)
    let avisos = 0
    m.sonido.suscribir(() => avisos++)
    m.sonido.poner(true)
    ok('al encenderlo se guarda y se avisa a quien mira', m.reg.guardado.join() === 'true' && avisos === 1 && m.sonido.activo())
    ok('y ya suena', (await m.sonido.sonarCorreo('b')) === 'sono')
    m.sonido.poner(false)
    m.avanzar(100)
    ok('apagarlo lo guarda y vuelve a callar', m.reg.guardado.join() === 'true,false' && (await m.sonido.sonarCorreo('c')) === 'silenciado')
    m.sonido.adoptar(true)
    ok('lo que cambia otra pestaña se adopta', m.sonido.activo() && avisos === 3)
    const p = mundo({ yaHuboGesto: true, preferencia: false })
    ok('«Probar» suena aunque esté apagado y aunque haya sonado hace un momento', (await p.sonido.probar()) === 'sono' && (await p.sonido.probar()) === 'sono')
  }

  console.log('\n=== el navegador no deja sonar hasta el primer gesto ===')
  {
    const m = mundo({ yaHuboGesto: false })
    m.sonido.preparar()
    ok('antes del gesto no se crea el audio (los navegadores se quejan) y se queda esperando', m.reg.contextos === 0 && m.gestos.length === 1)
    m.gestos[0]()
    ok('con el primer gesto se crea y se arranca', m.reg.contextos === 1 && m.reg.resumes === 1 && m.contexto.state === 'running')
    ok('y suena', (await m.sonido.sonarCorreo('a')) === 'sono')
    const otra = mundo({ yaHuboGesto: true })
    otra.sonido.preparar()
    ok('si la página ya ha tenido un gesto, se prepara al momento', otra.reg.contextos === 1 && otra.gestos.length === 0)
    const doble = mundo({ yaHuboGesto: false })
    doble.sonido.preparar()
    doble.sonido.preparar()
    ok('preparar dos veces no apunta dos gestos', doble.gestos.length === 1)
  }

  console.log('\n=== el navegador lo bloquea o no hay audio ===')
  {
    const m = mundo({ deja: false, yaHuboGesto: false })
    m.sonido.preparar()
    ok('sin ningún gesto, intentarlo da «bloqueado» y no revienta', (await m.sonido.sonarCorreo('a')) === 'bloqueado' && m.reg.osciladores.length === 0)
    ok('y un bloqueo no cuenta como haber sonado: el siguiente correo lo vuelve a intentar', (await m.sonido.sonarCorreo()) === 'bloqueado')
    const s = mundo({ sinAudio: true })
    ok('un navegador sin audio no falla', (await s.sonido.sonarCorreo('a')) === 'sin_audio' && (await s.sonido.probar()) === 'sin_audio')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
void main()
