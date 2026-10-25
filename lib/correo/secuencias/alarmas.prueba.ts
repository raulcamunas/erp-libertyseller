import { REPETIR_AVISO_CADA_MS, avisarDeAlarmas, claveDeAviso, mensajeDeAviso, tituloDeAviso, type Avisador, type AvisoParaEscribir } from '@/lib/correo/secuencias/alarmas'
import type { Alarma } from '@/lib/correo/secuencias/salud'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HORA = 3_600_000
const AHORA = Date.UTC(2026, 10, 3, 11, 20)
const ADMIN = 'u-admin'
const OTRO_ADMIN = 'u-admin-2'
const ANA = 'u-ana'

/** Un avisador en memoria: apunta a quién se ha avisado de qué y cuándo */
function avisadorEnMemoria(opciones: { faltaMigracion?: boolean } = {}) {
  const escritos: Array<AvisoParaEscribir & { en: number }> = []
  let ahora = AHORA
  let consultas = 0
  const avisador: Avisador = {
    async yaAvisados(desde) {
      consultas++
      return new Set(escritos.filter((e) => e.en >= desde).map((e) => claveDeAviso(e.userId, e.titulo)))
    },
    async escribir(avisos) {
      if (opciones.faltaMigracion) return { escritos: 0, faltaMigracion: true }
      for (const a of avisos) escritos.push({ ...a, en: ahora })
      return { escritos: avisos.length, faltaMigracion: false }
    },
  }
  return { avisador, escritos, consultas: () => consultas, alReloj: (t: number) => (ahora = t) }
}

const alarma = (o: Partial<Alarma> & { clave: string }): Alarma => ({
  codigo: 'contrasena',
  gravedad: 'roja',
  titulo: 'El buzón de Ana no se puede conectar',
  detalle: 'La contraseña ya no vale: no envía ni recibe correo. Ana tiene que ponerla de nuevo en Correo.',
  buzonId: 'b1',
  duenoId: ANA,
  avisar: true,
  paraElDueno: { titulo: 'Tu buzón no se puede conectar', detalle: 'La contraseña ya no vale: no envía ni recibe correo. Ponla de nuevo en Correo.' },
  ...o,
})

const motorParado = (): Alarma =>
  alarma({ clave: 'motor_parado', codigo: 'motor_parado', titulo: 'El motor de seguimientos se ha parado', detalle: 'Lleva 15 min sin ejecutarse.', buzonId: null, duenoId: null, paraElDueno: undefined })

async function main() {
  console.log('\n=== a quién se avisa y con qué palabras ===')
  {
    const w = avisadorEnMemoria()
    const r = await avisarDeAlarmas(w.avisador, [alarma({ clave: 'contrasena:b1' })], { administradores: [ADMIN, OTRO_ADMIN], ahora: AHORA })
    ok('el aviso de un buzón llega a los administradores y a su dueña', r.avisos === 3 && w.escritos.map((e) => e.userId).sort().join() === [ANA, ADMIN, OTRO_ADMIN].sort().join(), w.escritos.map((e) => e.userId).join())
    const deAdmin = w.escritos.find((e) => e.userId === ADMIN)
    const deAna = w.escritos.find((e) => e.userId === ANA)
    ok('a los administradores, en tercera persona y con «Correo · » delante', deAdmin?.titulo === 'Correo · El buzón de Ana no se puede conectar' && deAdmin.mensaje.includes('Ana tiene que ponerla'), JSON.stringify(deAdmin))
    ok('a la dueña, en segunda persona', deAna?.titulo === 'Correo · Tu buzón no se puede conectar' && deAna.mensaje.includes('Ponla de nuevo en Correo.') && !deAna.mensaje.includes('Ana'), JSON.stringify(deAna))
    ok('y todos los mensajes dicen dónde mirarlo', w.escritos.every((e) => e.mensaje.endsWith('Lo ves en Correo → Secuencias → Salud.')))
    ok('los títulos y mensajes son los de las funciones de siempre', tituloDeAviso('X') === 'Correo · X' && mensajeDeAviso('Algo pasa.') === 'Algo pasa. Lo ves en Correo → Secuencias → Salud.')
  }
  {
    const w = avisadorEnMemoria()
    const r = await avisarDeAlarmas(w.avisador, [motorParado()], { administradores: [ADMIN], ahora: AHORA })
    ok('lo del motor no tiene dueña: solo a los administradores', r.avisos === 1 && w.escritos[0].userId === ADMIN && w.escritos[0].titulo === 'Correo · El motor de seguimientos se ha parado')
  }
  {
    const w = avisadorEnMemoria()
    const r = await avisarDeAlarmas(w.avisador, [alarma({ clave: 'contrasena:b1', duenoId: ADMIN, paraElDueno: { titulo: 'Tu buzón no se puede conectar', detalle: 'Ponla de nuevo.' } })], { administradores: [ADMIN, OTRO_ADMIN], ahora: AHORA })
    const deAdmin = w.escritos.filter((e) => e.userId === ADMIN)
    ok('si la dueña es también administradora, recibe UN solo aviso, el suyo', r.avisos === 2 && deAdmin.length === 1 && deAdmin[0].titulo === 'Correo · Tu buzón no se puede conectar' && w.escritos.find((e) => e.userId === OTRO_ADMIN)?.titulo === 'Correo · El buzón de Ana no se puede conectar')
  }
  {
    const w = avisadorEnMemoria()
    const sinVersion = alarma({ clave: 'contrasena:b1', paraElDueno: undefined })
    await avisarDeAlarmas(w.avisador, [sinVersion], { administradores: [ADMIN], ahora: AHORA })
    ok('si una alarma no trae la versión para su dueña, ella recibe la misma frase', w.escritos.find((e) => e.userId === ANA)?.titulo === 'Correo · El buzón de Ana no se puede conectar')
  }

  console.log('\n=== qué avisos van a la campana ===')
  {
    const w = avisadorEnMemoria()
    const r = await avisarDeAlarmas(w.avisador, [alarma({ clave: 'en_pausa:b1', codigo: 'en_pausa', gravedad: 'ambar', avisar: false }), alarma({ clave: 'cola', codigo: 'cola_atrasada', gravedad: 'ambar', avisar: false, buzonId: null, duenoId: null })], { administradores: [ADMIN], ahora: AHORA })
    ok('lo que no pide aviso se queda en la pantalla, sin tocar la campana ni preguntar siquiera', r.avisos === 0 && w.escritos.length === 0 && w.consultas() === 0)
  }
  {
    const w = avisadorEnMemoria()
    const r = await avisarDeAlarmas(w.avisador, [], { administradores: [ADMIN], ahora: AHORA })
    ok('sin alarmas, nada', r.avisos === 0 && w.escritos.length === 0)
  }
  {
    const w = avisadorEnMemoria()
    const r = await avisarDeAlarmas(w.avisador, [motorParado()], { administradores: [], ahora: AHORA })
    ok('sin administradores a quienes avisar y sin dueño, no se escribe nada', r.avisos === 0 && w.escritos.length === 0)
  }

  console.log('\n=== no se repite ===')
  {
    const w = avisadorEnMemoria()
    const alarmas = [alarma({ clave: 'contrasena:b1' }), motorParado()]
    const primera = await avisarDeAlarmas(w.avisador, alarmas, { administradores: [ADMIN], ahora: AHORA })
    ok('la primera vez se avisa a todos (admin y dueña por la contraseña, admin por el motor)', primera.avisos === 3, String(primera.avisos))
    w.alReloj(AHORA + 3 * 60_000)
    const segunda = await avisarDeAlarmas(w.avisador, alarmas, { administradores: [ADMIN], ahora: AHORA + 3 * 60_000 })
    ok('tres minutos después, lo mismo no se vuelve a avisar', segunda.avisos === 0 && w.escritos.length === 3)
    const casiDoce = await avisarDeAlarmas(w.avisador, alarmas, { administradores: [ADMIN], ahora: AHORA + 11 * HORA })
    ok('a las 11 horas, tampoco', casiDoce.avisos === 0)
    w.alReloj(AHORA + 13 * HORA)
    const pasadas = await avisarDeAlarmas(w.avisador, alarmas, { administradores: [ADMIN], ahora: AHORA + 13 * HORA })
    ok('a las 13 horas, si sigue pasando, se recuerda otra vez', pasadas.avisos === 3 && w.escritos.length === 6)
    ok('el plazo es de doce horas', REPETIR_AVISO_CADA_MS === 12 * HORA)
  }
  {
    const w = avisadorEnMemoria()
    await avisarDeAlarmas(w.avisador, [alarma({ clave: 'contrasena:b1' })], { administradores: [ADMIN], ahora: AHORA })
    const otra = await avisarDeAlarmas(w.avisador, [alarma({ clave: 'contrasena:b2', titulo: 'El buzón de Alejandro no se puede conectar', duenoId: 'u-ale', paraElDueno: { titulo: 'Tu buzón no se puede conectar', detalle: 'x' } })], { administradores: [ADMIN], ahora: AHORA })
    ok('otra cosa distinta (otro buzón) sí se avisa aunque la primera siga ahí', otra.avisos === 2, String(otra.avisos))
    const lista = w.escritos.filter((e) => e.userId === ADMIN).map((e) => e.titulo)
    ok('y cada aviso tiene su propio título', new Set(lista).size === 2)
  }
  {
    const w = avisadorEnMemoria()
    await avisarDeAlarmas(w.avisador, [alarma({ clave: 'contrasena:b1' })], { administradores: [ADMIN], ahora: AHORA })
    w.alReloj(AHORA + 2 * HORA)
    const r = await avisarDeAlarmas(w.avisador, [alarma({ clave: 'contrasena:b1' })], { administradores: [ADMIN], ahora: AHORA + 2 * HORA, repetirCadaMs: HORA })
    ok('el plazo se puede cambiar', r.avisos === 2)
  }

  console.log('\n=== sin la migración 248 ===')
  {
    const w = avisadorEnMemoria({ faltaMigracion: true })
    const r = await avisarDeAlarmas(w.avisador, [motorParado()], { administradores: [ADMIN], ahora: AHORA })
    ok('se dice que falta, no se rompe y no se cuenta como aviso', r.faltaMigracion && r.avisos === 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
