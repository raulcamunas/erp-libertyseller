import { instanteDeMadrid } from '@/lib/correo/secuencias/fechas'
import { RAMPA_POR_DEFECTO } from '@/lib/correo/secuencias/reglas'
import {
  armarSalud,
  alarmasDe,
  duracionTexto,
  gravedadDeRebotes,
  porcentajeTexto,
  type BuzonParaLaSalud,
  type ConexionDeBuzon,
  type EntradaDeSalud,
  type VentanaDeRebotes,
} from '@/lib/correo/secuencias/salud'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const MIN = 60_000
const AHORA = instanteDeMadrid('2026-11-03', 12 * 60 + 20) // martes 3 de noviembre, 12:20

const buzon = (o: Partial<BuzonParaLaSalud> & { id: string; nombre: string }): BuzonParaLaSalud => ({
  direccion: `${o.nombre.toLowerCase()}@libertyseller.es`,
  propietario: { id: `u-${o.id}`, nombre: o.nombre },
  esMio: false,
  participa: true,
  conectado: true,
  credencialesInvalidas: false,
  ultimoSyncAt: AHORA - 4 * MIN,
  pausadoHasta: null,
  motivoPausa: null,
  topeDiario: null,
  rampaInicio: '2026-10-19',
  hoy: { tope: 100, enviados: 12, manual: 10, automaticos: 2, programados: 5 },
  vivas: 7,
  ...o,
})

const conexion = (o: Partial<ConexionDeBuzon> = {}): ConexionDeBuzon => ({ ultimoError: null, fallosSeguidos: 0, ultimoIntentoAt: AHORA - 3 * MIN, ...o })

function entrada(o: Partial<EntradaDeSalud> & { buzones?: BuzonParaLaSalud[] } = {}): EntradaDeSalud {
  const buzones = o.buzones ?? [buzon({ id: 'b1', nombre: 'Ana' })]
  return {
    ahora: AHORA,
    ajustes: { activa: true, modoEnsayo: false, frenoRebotesPct: 4, frenoMinimoEnvios: 20, festivos: [], rampa: RAMPA_POR_DEFECTO },
    buzones,
    conexion: new Map(buzones.map((b) => [b.id, conexion()])),
    rebotes24h: new Map(),
    rebotes7d: new Map(),
    pasadas: { ultima: { en: AHORA - 30_000, ok: true, error: null, duracionMs: 900 }, enLaUltimaHora: 59, fallosEnLaUltimaHora: 0 },
    cola: { atrasados: 0, fallidos: 0, iaFallidas: 0, iaPendientes: 0, ultimoEnvioAt: AHORA - 6 * MIN },
    conMotor: true,
    ...o,
  }
}

const v = (enviados: number, rebotes: number): VentanaDeRebotes => ({ enviados, rebotes })
const codigos = (e: EntradaDeSalud) => alarmasDe(e).map((a) => a.codigo).join()

console.log('\n=== cómo se dicen las cosas ===')
{
  const g = (rebotes: number, enviados: number, limite = 4, minimo = 20) => gravedadDeRebotes({ rebotes, enviados, pct: enviados > 0 ? (rebotes / enviados) * 100 : null }, limite, minimo)
  ok('diez rebotes de 40 (25 %): rojo, es seguro que se pasa del 4 %', g(10, 40) === 'roja')
  ok('cinco de 20 (25 %): rojo', g(5, 20) === 'roja')
  ok('uno de 23 (4,3 %): ámbar, no rojo: puede ser una sola dirección', g(1, 23) === 'ambar')
  ok('cero de 56: nada que mirar', g(0, 56) === null)
  ok('uno de 7 (14,3 %): pocos envíos, no se colorea', g(1, 7) === null)
  ok('sin envíos o sin porcentaje, nada', g(0, 0) === null && gravedadDeRebotes({ enviados: 30, rebotes: 0, pct: null }, 4, 20) === null)
  ok('la mitad del límite avisa en ámbar (2 de 60 = 3,3 %: no; 3 de 60 = 5 %: ámbar)', g(1, 60) === null && g(3, 60) === 'ambar', `${g(1, 60)} ${g(3, 60)}`)
  ok('cuantos más envíos, antes se confirma: 6 de 100 (6 %) ya es rojo? no, 12 de 100 sí', g(6, 100) === 'ambar' && g(12, 100) === 'roja', `${g(6, 100)} ${g(12, 100)}`)
  ok('con un límite más alto (10 %), 5 de 20 (25 %) sigue siendo rojo y 1 de 23 no se colorea', g(5, 20, 10) === 'roja' && g(1, 23, 10) === null)
  ok('porcentajes con coma y un decimal solo si hace falta', porcentajeTexto(6.5) === '6,5 %' && porcentajeTexto(4) === '4 %' && porcentajeTexto(12.04) === '12 %' && porcentajeTexto(0) === '0 %' && porcentajeTexto(2.26) === '2,3 %')
  ok('duraciones', duracionTexto(10_000) === 'menos de un minuto' && duracionTexto(4 * MIN) === '4 min' && duracionTexto(65 * MIN) === '1 h 5 min' && duracionTexto(120 * MIN) === '2 h' && duracionTexto(2 * 24 * 60 * MIN) === '2 días' && duracionTexto(24 * 60 * MIN) === '1 día')
}

console.log('\n=== cuando todo está bien ===')
{
  const s = armarSalud(entrada())
  ok('sin alarmas: todo en orden', s.nivel === 'ok' && s.alarmas.length === 0 && s.resumen === 'Todo en orden')
  ok('el buzón está bien: conectado y leído hace 4 min', s.buzones[0].nivel === 'ok' && s.buzones[0].conexion.estado === 'ok' && s.buzones[0].conexion.texto === 'Conectado · leído hace 4 min', s.buzones[0].conexion.texto)
  ok('la rampa: desde el lunes 19 de octubre, el martes 3 de noviembre es el día hábil 12 (tope 100)', s.buzones[0].rampa.diaHabil === 12 && s.buzones[0].rampa.tope === 100 && !s.buzones[0].rampa.fija, JSON.stringify(s.buzones[0].rampa))
  ok('el motor en marcha, con su última pasada', s.motor?.modo === 'real' && !s.motor.parado && s.motor.pasadasEnLaUltimaHora === 59 && s.motor.registroDisponible && s.motor.ultimaPasada?.ok === true)
  const fijo = armarSalud(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', topeDiario: 60 })] }))
  ok('con tope fijo no hay día de rampa', fijo.buzones[0].rampa.fija && fijo.buzones[0].rampa.diaHabil === null && fijo.buzones[0].rampa.tope === 60)
  const sinInicio = armarSalud(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', rampaInicio: null })] }))
  ok('sin fecha de inicio, empieza hoy: día 1, tope 40', sinInicio.buzones[0].rampa.diaHabil === 1 && sinInicio.buzones[0].rampa.tope === 40)
}

console.log('\n=== la conexión de cada buzón ===')
{
  const roja = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Lucía', credencialesInvalidas: true })] }))
  ok('contraseña rechazada: roja, se avisa y el dueño se entera', roja.length === 1 && roja[0].codigo === 'contrasena' && roja[0].gravedad === 'roja' && roja[0].avisar && roja[0].duenoId === 'u-b1' && roja[0].titulo === 'El buzón de Lucía no se puede conectar', JSON.stringify(roja))
  ok('y la frase dice quién tiene que ponerla', roja[0].detalle.includes('Lucía tiene que ponerla de nuevo en Correo'))
  ok('a su dueña se le dice en segunda persona', roja[0].paraElDueno?.titulo === 'Tu buzón no se puede conectar' && roja[0].paraElDueno.detalle.includes('Ponla de nuevo en Correo') && !roja[0].paraElDueno.detalle.includes('Lucía'), JSON.stringify(roja[0].paraElDueno))
  const mia = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Lucía', credencialesInvalidas: true, esMio: true })] }))
  ok('si es tu buzón, se dice «tu buzón» y «ponla»', mia[0].titulo === 'Tu buzón no se puede conectar' && mia[0].detalle.includes('Ponla de nuevo en Correo'))
  ok('y no hace falta otra versión para el dueño: ya se lo dice a él', mia[0].paraElDueno === undefined)
  const fuera = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Lucía', credencialesInvalidas: true, participa: false })] }))
  ok('si el buzón no participa en las secuencias, es ámbar y no va a la campana', fuera[0].gravedad === 'ambar' && !fuera[0].avisar)
  const sin = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Lucía', conectado: false })] }))
  ok('sin contraseña guardada: ámbar', sin.length === 1 && sin[0].codigo === 'sin_conectar' && sin[0].gravedad === 'ambar')

  const b = buzon({ id: 'b1', nombre: 'Ana' })
  const tres = alarmasDe(entrada({ buzones: [b], conexion: new Map([['b1', conexion({ fallosSeguidos: 3, ultimoError: 'ETIMEDOUT conectando con imap.hostinger.com' })]]) }))
  ok('tres fallos seguidos: ámbar, con el error, sin campana', tres.length === 1 && tres[0].codigo === 'fallando' && tres[0].gravedad === 'ambar' && !tres[0].avisar && tres[0].detalle.includes('3 fallos seguidos') && tres[0].detalle.includes('ETIMEDOUT'), JSON.stringify(tres))
  const seis = alarmasDe(entrada({ buzones: [b], conexion: new Map([['b1', conexion({ fallosSeguidos: 6 })]]) }))
  ok('seis: roja y a la campana', seis[0].gravedad === 'roja' && seis[0].avisar)
  const dos = alarmasDe(entrada({ buzones: [b], conexion: new Map([['b1', conexion({ fallosSeguidos: 2 })]]) }))
  ok('dos fallos todavía no es nada', dos.length === 0)

  const viejo = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', ultimoSyncAt: AHORA - 45 * MIN })] }))
  ok('sin leerse hace 45 min: ámbar y lo dice', viejo.length === 1 && viejo[0].codigo === 'sin_sincronizar' && viejo[0].detalle === 'Hace 45 min que no se lee su correo.' && !viejo[0].avisar, JSON.stringify(viejo))
  const justo = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', ultimoSyncAt: AHORA - 29 * MIN })] }))
  ok('a los 29 min todavía no', justo.length === 0)
  const nunca = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', ultimoSyncAt: null })], conexion: new Map([['b1', conexion({ ultimoIntentoAt: null })]]) }))
  ok('un buzón recién conectado, que no se ha intentado leer nunca, no es una alarma', nunca.length === 0)
  const nuncaLeido = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', ultimoSyncAt: null })] }))
  ok('pero uno que se ha intentado y nunca se ha leído, sí', nuncaLeido.length === 1 && nuncaLeido[0].detalle === 'Todavía no se ha leído nunca su correo.')
  const sinFilaDeConexion = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', ultimoSyncAt: AHORA - 90 * MIN })], conexion: new Map() }))
  ok('sin datos de su conexión no se inventa nada', sinFilaDeConexion.length === 0)
  const tuyaConError = armarSalud(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', credencialesInvalidas: true })] }))
  ok('en la tarjeta del buzón, la conexión lo dice con palabras', tuyaConError.buzones[0].conexion.estado === 'contrasena' && tuyaConError.buzones[0].conexion.texto === 'Contraseña rechazada' && tuyaConError.buzones[0].nivel === 'problema')
}

console.log('\n=== los rebotes ===')
{
  const b = buzon({ id: 'b1', nombre: 'Ana' })
  const entra = (e: VentanaDeRebotes) => entrada({ buzones: [b], rebotes24h: new Map([['b1', e]]) })
  const alto = alarmasDe(entra(v(100, 6)))
  ok('6 de 100 (6 %): roja, a la campana, con las cifras y el límite', alto.length === 1 && alto[0].codigo === 'rebotes_altos' && alto[0].gravedad === 'roja' && alto[0].avisar && alto[0].detalle.includes('6 rebotes en 100 correos en 24 h (6 %; el límite es 4 %)'), JSON.stringify(alto))
  ok('con el buzón sin pausar dice que el motor lo pausará', alto[0].detalle.includes('El motor lo pausará.'))
  const pausado = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: AHORA + 20 * 60 * MIN, motivoPausa: 'Rebota demasiado' })], rebotes24h: new Map([['b1', v(100, 6)]]) }))
  ok('y si ya lo ha pausado, que lo ha pausado (y sale también la pausa, ámbar)', pausado.map((a) => a.codigo).join() === 'rebotes_altos,en_pausa' && pausado[0].detalle.includes('El motor lo ha pausado.'), pausado.map((a) => a.codigo).join())
  const terminada = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: AHORA - 2 * 60 * MIN })], rebotes24h: new Map([['b1', v(100, 6)]]) }))
  ok('si la pausa que provocaron esos rebotes ya terminó, baja a ámbar y no va a la campana', terminada.length === 1 && terminada[0].codigo === 'rebotes_altos' && terminada[0].gravedad === 'ambar' && !terminada[0].avisar && terminada[0].detalle.includes('La pausa ya ha terminado'), JSON.stringify(terminada))
  const hace2dias = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: AHORA - 30 * 60 * MIN })], rebotes24h: new Map([['b1', v(100, 6)]]) }))
  ok('pero una pausa de hace más de un día no explica nada: vuelve a ser roja', hace2dias[0].gravedad === 'roja' && hace2dias[0].avisar)
  const subiendo = alarmasDe(entra(v(100, 3)))
  ok('3 %: ámbar, sin campana', subiendo.length === 1 && subiendo[0].codigo === 'rebotes_subiendo' && subiendo[0].gravedad === 'ambar' && !subiendo[0].avisar)
  ok('1 %: nada', alarmasDe(entra(v(100, 1))).length === 0)
  ok('con menos de 20 envíos no se mide (un rebote suelto no es una tasa)', alarmasDe(entra(v(10, 5))).length === 0)
  ok('justo en el límite (4 de 100) ya es roja', alarmasDe(entra(v(100, 4)))[0]?.codigo === 'rebotes_altos')
  const s = armarSalud(entrada({ buzones: [b], rebotes24h: new Map([['b1', v(80, 2)]]), rebotes7d: new Map([['b1', v(400, 8)]]) }))
  ok('las cifras de 24 h y de 7 días llegan a la tarjeta, con su porcentaje', s.buzones[0].rebotes24h.pct === 2.5 && s.buzones[0].rebotes7d.pct === 2 && s.buzones[0].rebotes7d.enviados === 400 && s.buzones[0].limiteDeRebotesPct === 4 && s.buzones[0].minimoDeEnvios === 20)
  const sinEnvios = armarSalud(entrada({ buzones: [b], rebotes24h: new Map([['b1', v(0, 0)]]) }))
  ok('sin envíos no hay porcentaje (no se divide por cero)', sinEnvios.buzones[0].rebotes24h.pct === null)
}

console.log('\n=== las pausas ===')
{
  const hasta = instanteDeMadrid('2026-11-04', 9 * 60)
  const p = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: hasta, motivoPausa: 'Pausado a mano por un administrador.' })] }))
  ok('una pausa es ámbar, no va a la campana y dice hasta cuándo y por qué', p.length === 1 && p[0].codigo === 'en_pausa' && !p[0].avisar && p[0].detalle === 'Hasta mié 4 nov 09:00: Pausado a mano por un administrador.', JSON.stringify(p))
  const hoy = alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: instanteDeMadrid('2026-11-03', 15 * 60) })] }))
  ok('si es hoy, «hoy»', hoy[0].detalle === 'Hasta hoy 15:00.', hoy[0].detalle)
  ok('una pausa que ya pasó no es nada', alarmasDe(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: AHORA - MIN })] })).length === 0)
  const s = armarSalud(entrada({ buzones: [buzon({ id: 'b1', nombre: 'Ana', pausadoHasta: hasta, motivoPausa: 'x' })] }))
  ok('la tarjeta lleva la pausa', s.buzones[0].pausa?.hasta === hasta && s.buzones[0].pausa?.motivo === 'x')
}

console.log('\n=== el motor ===')
{
  const parado = alarmasDe(entrada({ pasadas: { ultima: { en: AHORA - 15 * MIN, ok: true, error: null, duracionMs: 800 }, enLaUltimaHora: 0, fallosEnLaUltimaHora: 0 } }))
  ok('encendido y sin pasar en 15 min: roja, a la campana, con el tiempo', parado.length === 1 && parado[0].codigo === 'motor_parado' && parado[0].gravedad === 'roja' && parado[0].avisar && parado[0].detalle.startsWith('Lleva 15 min sin ejecutarse'), JSON.stringify(parado))
  ok('a los 9 min todavía no (un despliegue tarda unos 5)', alarmasDe(entrada({ pasadas: { ultima: { en: AHORA - 9 * MIN, ok: true, error: null, duracionMs: 800 }, enLaUltimaHora: 50, fallosEnLaUltimaHora: 0 } })).length === 0)
  const ninguna = alarmasDe(entrada({ pasadas: { ultima: null, enLaUltimaHora: 0, fallosEnLaUltimaHora: 0 } }))
  ok('sin ninguna pasada registrada, también', ninguna[0]?.codigo === 'motor_parado' && ninguna[0].detalle.startsWith('No hay ninguna pasada registrada'))
  ok('con el motor apagado, que no pase nada es lo normal', alarmasDe(entrada({ ajustes: { activa: false, modoEnsayo: true, frenoRebotesPct: 4, frenoMinimoEnvios: 20, festivos: [], rampa: RAMPA_POR_DEFECTO }, pasadas: { ultima: null, enLaUltimaHora: 0, fallosEnLaUltimaHora: 0 } })).length === 0)
  const sinRegistro = armarSalud(entrada({ pasadas: null }))
  ok('si el registro de procesos no se puede leer, no se acusa al motor y se dice que no se sabe', sinRegistro.alarmas.length === 0 && sinRegistro.motor?.registroDisponible === false && sinRegistro.motor.ultimaPasada === null)

  const antiguoError = alarmasDe(entrada({ pasadas: { ultima: { en: AHORA - 30_000, ok: true, error: null, duracionMs: 900 }, enLaUltimaHora: 58, fallosEnLaUltimaHora: 6, ultimoErrorDeLaHora: 'connect ETIMEDOUT 10.0.0.1:5432' } }))
  ok('el último error es el de la última pasada que falló, aunque la más reciente haya ido bien', antiguoError[0]?.detalle.includes('Último error: connect ETIMEDOUT'), JSON.stringify(antiguoError))
  const algunos = alarmasDe(entrada({ pasadas: { ultima: { en: AHORA - 30_000, ok: false, error: 'connect ETIMEDOUT 10.0.0.1:5432', duracionMs: 5000 }, enLaUltimaHora: 58, fallosEnLaUltimaHora: 6 } }))
  ok('6 pasadas malas de 58: ámbar (no es la mayoría) y con el último error', algunos.length === 1 && algunos[0].codigo === 'motor_con_errores' && algunos[0].gravedad === 'ambar' && !algunos[0].avisar && algunos[0].detalle.includes('6 de las últimas 58 pasadas') && algunos[0].detalle.includes('ETIMEDOUT'), JSON.stringify(algunos))
  const muchos = alarmasDe(entrada({ pasadas: { ultima: { en: AHORA - 30_000, ok: false, error: null, duracionMs: 5000 }, enLaUltimaHora: 58, fallosEnLaUltimaHora: 40 } }))
  ok('40 de 58: roja y a la campana', muchos[0].gravedad === 'roja' && muchos[0].avisar)
  ok('4 pasadas malas no es nada todavía', alarmasDe(entrada({ pasadas: { ultima: { en: AHORA - 30_000, ok: true, error: null, duracionMs: 900 }, enLaUltimaHora: 58, fallosEnLaUltimaHora: 4 } })).length === 0)

  const atrasados = alarmasDe(entrada({ cola: { atrasados: 7, fallidos: 0, iaFallidas: 0, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('7 seguimientos atrasados: ámbar', atrasados.length === 1 && atrasados[0].codigo === 'cola_atrasada' && !atrasados[0].avisar && atrasados[0].detalle.startsWith('7 seguimientos llevan más de 30 min'))
  ok('4 no es nada', alarmasDe(entrada({ cola: { atrasados: 4, fallidos: 0, iaFallidas: 0, iaPendientes: 0, ultimoEnvioAt: null } })).length === 0)
  ok('y en ensayo no se miran: nada sale', alarmasDe(entrada({ ajustes: { activa: true, modoEnsayo: true, frenoRebotesPct: 4, frenoMinimoEnvios: 20, festivos: [], rampa: RAMPA_POR_DEFECTO }, cola: { atrasados: 50, fallidos: 0, iaFallidas: 0, iaPendientes: 0, ultimoEnvioAt: null } })).length === 0)

  const uno = alarmasDe(entrada({ cola: { atrasados: 0, fallidos: 1, iaFallidas: 0, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('un envío fallado: roja, a la campana y en singular', uno.length === 1 && uno[0].codigo === 'envios_fallidos' && uno[0].avisar && uno[0].detalle.startsWith('1 envío ha fallado'), JSON.stringify(uno))
  const varios = alarmasDe(entrada({ cola: { atrasados: 0, fallidos: 3, iaFallidas: 0, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('varios, en plural', varios[0].detalle.startsWith('3 envíos han fallado'))
  const ia = alarmasDe(entrada({ cola: { atrasados: 0, fallidos: 0, iaFallidas: 1, iaPendientes: 2, ultimoEnvioAt: null } }))
  ok('una respuesta sin leer por la IA: ámbar y en singular', ia.length === 1 && ia[0].codigo === 'ia_sin_leer' && !ia[0].avisar && ia[0].detalle.startsWith('1 respuesta se ha quedado sin leer'))
  const iaVarias = alarmasDe(entrada({ cola: { atrasados: 0, fallidos: 0, iaFallidas: 4, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('varias, en plural', iaVarias[0].detalle.startsWith('4 respuestas se han quedado sin leer'))
}

console.log('\n=== quién ve qué ===')
{
  const s = armarSalud(entrada({ conMotor: false, pasadas: { ultima: null, enLaUltimaHora: 0, fallosEnLaUltimaHora: 0 }, cola: { atrasados: 20, fallidos: 3, iaFallidas: 2, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('quien no administra no ve nada del motor, ni sus alarmas', s.motor === null && s.alarmas.length === 0 && s.nivel === 'ok')
  const suyo = armarSalud(entrada({ conMotor: false, buzones: [buzon({ id: 'b1', nombre: 'Ana', esMio: true, credencialesInvalidas: true })] }))
  ok('pero sí lo de su buzón', suyo.alarmas.length === 1 && suyo.alarmas[0].titulo === 'Tu buzón no se puede conectar')
}

console.log('\n=== el conjunto ===')
{
  const lucia = buzon({ id: 'b2', nombre: 'Lucía', credencialesInvalidas: true })
  const ana = buzon({ id: 'b1', nombre: 'Ana' })
  const dani = buzon({ id: 'b3', nombre: 'Daniela', pausadoHasta: AHORA + 30 * MIN, motivoPausa: 'x' })
  const s = armarSalud(entrada({ buzones: [ana, dani, lucia], cola: { atrasados: 0, fallidos: 2, iaFallidas: 1, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('las rojas, antes que las ámbar', s.alarmas.map((a) => `${a.gravedad[0]}:${a.codigo}`).join() === 'r:envios_fallidos,r:contrasena,a:ia_sin_leer,a:en_pausa', s.alarmas.map((a) => `${a.gravedad[0]}:${a.codigo}`).join())
  ok('el resumen cuenta las dos clases', s.nivel === 'problema' && s.resumen === '2 cosas que atender y 2 a las que estar atento', s.resumen)
  ok('los buzones con problemas, primero; los sanos, al final', s.buzones.map((b) => b.propietario).join() === 'Lucía,Daniela,Ana' && s.buzones.map((b) => b.nivel).join() === 'problema,atencion,ok', s.buzones.map((b) => `${b.propietario}:${b.nivel}`).join())
  const solo = armarSalud(entrada({ buzones: [dani] }))
  ok('con solo cosas ámbar es «atención»', solo.nivel === 'atencion' && solo.resumen === '1 cosa a la que estar atento', solo.resumen)
  const una = armarSalud(entrada({ buzones: [lucia] }))
  ok('una sola roja, en singular', una.resumen === '1 cosa que atender', una.resumen)
  const otra = armarSalud(entrada({ buzones: [ana, dani, lucia], cola: { atrasados: 0, fallidos: 2, iaFallidas: 1, iaPendientes: 0, ultimoEnvioAt: null } }))
  ok('lo mismo medido dos veces da las mismas claves y los mismos títulos (es lo que impide avisar dos veces)', JSON.stringify(otra.alarmas.map((a) => [a.clave, a.titulo])) === JSON.stringify(s.alarmas.map((a) => [a.clave, a.titulo])))
  ok('los títulos no llevan cifras que cambien', s.alarmas.every((a) => !/\d/.test(a.titulo)))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
