/**
 * Pruebas de las piezas PURAS de agente-cron.ts (sin red ni base de datos).
 *   npx tsx lib/ads/agente/agente-cron.prueba.ts
 */
import { camposDeVigilarFallido, cambiosDistintosDelEnsayo, horaDeMinuto, ordenarPorUrgencia, pendientesDeResultados, seguirTrasPasoFallido, vigilarHizoAlgo } from './agente-cron'
import { AdsError } from '../oauth'
import { AGENTE } from './tipos'
import { falloDeUsoEsPasajero, lecturaDeCampana } from './uso-servidor'
import { fusionarDiaDeUso } from './uso-calculo'
import { propuestaBloqueaPresupuesto, saltarApiDeUso, siguienteUsoError, textoDeUsoPasajero, usoDisponible, usoErrorBloquea } from './vigilar-servidor'
import { firmaDeReserva } from './estado-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== hora de un minuto ===')
ok('13:40', horaDeMinuto(820) === '13:40')
ok('00:05', horaDeMinuto(5) === '00:05')
ok('fuera de rango se acota', horaDeMinuto(-3) === '00:00' && horaDeMinuto(5000) === '23:59')

console.log('\n=== cambios DISTINTOS del ensayo ===')
{
  const f = (x: Partial<Parameters<typeof cambiosDistintosDelEnsayo>[0][number]>) => ({ tipo: 'negativizar', campaign_id: 'c1', objetivo_id: null, termino: 'gratis', valor_actual: null, valor_nuevo: null, metricas: { pedidos: 0 }, ...x })
  const r = cambiosDistintosDelEnsayo([
    f({}),
    f({ termino: 'Gratis ' }), // la misma negativa ensayada otro día: una
    f({ termino: 'segunda mano' }),
    f({ tipo: 'puja', objetivo_id: 'k1', termino: 'jamon', valor_actual: '1', valor_nuevo: '0.8', metricas: { pedidos: 3 } }),
    f({ tipo: 'puja', objetivo_id: 'k1', termino: 'jamon', valor_actual: 1, valor_nuevo: 0.7, metricas: { pedidos: 3 } }), // misma segmentación y tipo
    f({ tipo: 'puja', objetivo_id: 'k2', termino: 'paleta', valor_actual: 1, valor_nuevo: 1.2, metricas: { pedidos: 5 } }),
    f({ tipo: 'presupuesto', campaign_id: 'c2', termino: 'B0X | S | R | MANUAL AMPLIA', valor_actual: 20, valor_nuevo: 24 }),
    f({ tipo: 'pausar-campana', campaign_id: 'c3', termino: 'B0Y | S | R | AUTO RADAR' }),
  ])
  ok('2 negativas distintas', r.negativizar === 2, JSON.stringify(r))
  ok('1 bajada de puja (aunque se ensayara dos veces)', r.puja_bajar === 1, JSON.stringify(r))
  ok('1 subida de puja', r.puja_subir === 1)
  ok('1 subida de presupuesto', r.presupuesto_subir === 1)
  ok('1 pausa de campaña', r.pausar_campana === 1)
}

console.log('\n=== ¿abre fila el vigilar? ===')
{
  const nada = { insertadas: 0, frenado: false, deshechas: 0, activado: false, eventos: 0, reactivadas: 0 }
  ok('un vigilar rutinario NO abre fila', !vigilarHizoAlgo(nada))
  ok('con propuestas nuevas, sí', vigilarHizoAlgo({ ...nada, insertadas: 1 }))
  ok('con freno, sí', vigilarHizoAlgo({ ...nada, frenado: true }))
  ok('al pasar a activo, sí', vigilarHizoAlgo({ ...nada, activado: true }))
  ok('con reactivaciones, sí', vigilarHizoAlgo({ ...nada, reactivadas: 2 }))
}

console.log('\n=== vigilar fallido: cierra el paso ===')
{
  const c = camposDeVigilarFallido(1)
  ok('suma el fallo', c.vigilar_fallos === 2)
  ok('anula el sello del último vigilar bueno (aplicar no escribe)', 'vigilar_ok_at' in c && c.vigilar_ok_at === null)
  ok('fallos raros cuentan desde 0', camposDeVigilarFallido(Number.NaN).vigilar_fallos === 1)
  ok('tras un vigilar fallido no se da otro paso (ni aplicar)', seguirTrasPasoFallido('vigilar') === false)
  ok('tras otro paso fallido se sigue', seguirTrasPasoFallido('cerebro') === true)
}

console.log('\n=== vigilar fallido: reintento pronto (A15) ===')
{
  const T = Date.parse('2026-11-20T10:00:00Z')
  // reservarPaso deja pasar el vigilar cuando vigilar_at < ahora − 30 min: el reintento llega a los (30 − (ahora − sello)) min
  const reintentoEn = (fallosAntes: number) => {
    const c = camposDeVigilarFallido(fallosAntes, T)
    return AGENTE.MIN_ENTRE_VIGILAR - (T - Date.parse(c.vigilar_at as string)) / 60_000
  }
  ok('1.er fallo → reintento a los 5 min', reintentoEn(0) === 5, String(reintentoEn(0)))
  ok('2.º → 10 min', reintentoEn(1) === 10, String(reintentoEn(1)))
  ok('3.º → 20 min', reintentoEn(2) === 20, String(reintentoEn(2)))
  ok('4.º y siguientes → 30 min (lo normal)', reintentoEn(3) === 30 && reintentoEn(9) === 30, `${reintentoEn(3)} ${reintentoEn(9)}`)
  ok('sigue anulando el vigilar bueno', camposDeVigilarFallido(0, T).vigilar_ok_at === null)
}

console.log('\n=== API de uso: fallos pasajeros y persistentes (A2) ===')
{
  const T = Date.parse('2026-11-20T10:00:00Z')
  const hace = (min: number) => new Date(T - min * 60_000).toISOString()
  ok('AdsError 429 → pasajero', falloDeUsoEsPasajero(new AdsError('Amazon Ads ha contestado 429 a /sp/campaigns/budget/usage: x', { estado: 429 })))
  ok('AdsError 503 → pasajero', falloDeUsoEsPasajero(new AdsError('Amazon Ads ha contestado 503 a …', { estado: 503 })))
  const abort = new Error('This operation was aborted')
  abort.name = 'AbortError'
  ok('AbortError (tiempo agotado) → pasajero', falloDeUsoEsPasajero(abort))
  ok('fetch failed (red) → pasajero', falloDeUsoEsPasajero(new TypeError('fetch failed')))
  ok('AdsError 403 → persistente', !falloDeUsoEsPasajero(new AdsError('Amazon Ads ha contestado 403 a …', { estado: 403, esDeAutorizacion: true })))
  ok('AdsError 400 → persistente', !falloDeUsoEsPasajero(new AdsError('Amazon Ads ha contestado 400 a …', { estado: 400 })))
  ok('conexión revocada (sin código) → persistente', !falloDeUsoEsPasajero(new AdsError('Este cliente ha revocado la autorización de Amazon Ads.', { esDeAutorizacion: true })))

  const pasajero = (n: number, minutos: number) => textoDeUsoPasajero(n, hace(minutos), 'Uso de presupuesto: Amazon ha pedido esperar (429)')
  ok('un error pasajero de hace 10 min → se reintenta entero (no se salta)', !saltarApiDeUso(pasajero(1, 10), hace(10), T))
  ok('2 fallos, el último hace 40 min → retroceso de 1 h (prueba)', saltarApiDeUso(pasajero(2, 40), hace(70), T))
  ok('… a la hora, entero', !saltarApiDeUso(pasajero(2, 60), hace(90), T))
  ok('el retroceso se mide desde el ÚLTIMO intento, no desde el primero (6 fallos, último hace 5 h, primero hace 10 h → aún espera)', saltarApiDeUso(pasajero(6, 300), hace(600), T))
  ok('… y nunca pasa de 6 h', !saltarApiDeUso(pasajero(9, 360), hace(900), T))
  ok('un error de autorización de hace 10 min → se salta (6 h)', saltarApiDeUso('Uso de presupuesto: Amazon Ads ha contestado 403 a …', hace(10), T))

  ok('1 y 2 fallos pasajeros no cuentan como «no sé cuánto se gasta»', !usoErrorBloquea(pasajero(1, 0)) && !usoErrorBloquea(pasajero(2, 0)))
  ok('al 3.º, sí', usoErrorBloquea(pasajero(3, 0)))
  ok('uno persistente, desde el primero', usoErrorBloquea('Uso de presupuesto: la API de uso no ha dado ninguna lectura (INVALID_ARGUMENT)'))
  ok('un texto de antes de la marca con 429 → pasajero ya caído (bloquea)', usoErrorBloquea('Uso de presupuesto: Amazon ha pedido esperar (429): no se reintenta en esta pasada'))
  ok('pasajero que aún no cuenta → R1–R4 siguen aunque el primer fallo sea de hace 13 h', usoDisponible(pasajero(2, 0), hace(13 * 60), T))
  ok('persistente de hace 13 h → sin R1–R4', !usoDisponible('Uso de presupuesto: 403', hace(13 * 60), T))

  const iso = new Date(T).toISOString()
  const s1 = siguienteUsoError({ usoError: null, usoErrorAt: null }, { error: 'Uso de presupuesto: 429', transitorio: true, seLlamo: true }, iso)
  ok('1.er 429 → se apunta como pasajero 1, sin aviso', /^\[pasajero 1 · /.test(s1.usoError ?? '') && !s1.nuevo && s1.usoErrorAt === iso, JSON.stringify(s1))
  const s2 = siguienteUsoError({ usoError: s1.usoError, usoErrorAt: s1.usoErrorAt }, { error: 'Uso de presupuesto: 503', transitorio: true, seLlamo: true }, hace(-30))
  const s3 = siguienteUsoError({ usoError: s2.usoError, usoErrorAt: s2.usoErrorAt }, { error: 'Uso de presupuesto: 503', transitorio: true, seLlamo: true }, hace(-90))
  ok('al 3.º seguido pasa a contar (aviso una vez) y conserva la hora del PRIMER fallo', s3.nuevo && usoErrorBloquea(s3.usoError) && s3.usoErrorAt === iso, JSON.stringify(s3))
  const ok1 = siguienteUsoError({ usoError: s2.usoError, usoErrorAt: s2.usoErrorAt }, { error: null, transitorio: false, seLlamo: true }, hace(-60))
  ok('una lectura buena (o el lote de prueba) lo borra', ok1.usoError === null && ok1.usoErrorAt === null && ok1.cambia)
  const p403 = siguienteUsoError({ usoError: null, usoErrorAt: null }, { error: 'Uso de presupuesto: 403', transitorio: false, seLlamo: true }, iso)
  ok('un 403 cuenta desde el primero (aviso)', p403.nuevo && p403.usoError === 'Uso de presupuesto: 403')
}

console.log('\n=== presupuesto base y regla de presupuesto de Amazon (A6) ===')
{
  const c = { campaignId: 'c1', presupuesto: 50, servicio: 'CAMPAIGN_STATUS_ENABLED', estado: 'ENABLED' }
  const l = lecturaDeCampana(c, { usoPct: 40, presupuesto: 75, actualizadoAt: null })
  ok('con una regla activa (API de uso 75, base 50): presupuesto = 50 (el base)', l.presupuesto === 50 && l.presupuestoEfectivo === 75, JSON.stringify(l))
  const d = fusionarDiaDeUso(null, l, Date.parse('2026-11-20T10:00:00Z'), 'Europe/Madrid')
  ok('… la fila guarda 50 y el gasto estimado sale del efectivo (40 % de 75 = 30)', d.presupuesto === 50 && d.gastoEstimado === 30, JSON.stringify(d))
  ok('sin base conocido, el de la API', lecturaDeCampana({ ...c, presupuesto: null }, { usoPct: 40, presupuesto: 75, actualizadoAt: null }).presupuesto === 75)
  ok('sin lectura de la API, el base y sin efectivo', lecturaDeCampana(c, undefined).presupuesto === 50 && lecturaDeCampana(c, undefined).presupuestoEfectivo === null)
}

console.log('\n=== cuarentena de presupuestos (A6, A27) ===')
{
  const inicio = Date.parse('2026-11-20T00:00:00+01:00')
  const sube = { valorActual: 20, valorNuevo: 24 }
  ok('una obsoleta del agente no bloquea (no se escribió nada en Amazon)', !propuestaBloqueaPresupuesto({ estado: 'obsoleta', origen: 'agente', ...sube }, inicio))
  ok('una obsoleta de una persona sí', propuestaBloqueaPresupuesto({ estado: 'obsoleta', origen: 'motor', ...sube }, inicio))
  ok('una caducada no bloquea', !propuestaBloqueaPresupuesto({ estado: 'caducada', origen: 'agente', ...sube }, inicio))
  ok('una R1 pendiente de AYER no bloquea (aplicar la caduca)', !propuestaBloqueaPresupuesto({ estado: 'pendiente', origen: 'agente', creadaAt: '2026-11-19T15:00:00Z', ...sube }, inicio))
  ok('una R1 pendiente de hoy sí', propuestaBloqueaPresupuesto({ estado: 'pendiente', origen: 'agente', creadaAt: '2026-11-20T09:00:00Z', ...sube }, inicio))
  ok('una bajada pendiente de ayer sí (no caduca por el día)', propuestaBloqueaPresupuesto({ estado: 'pendiente', origen: 'agente', creadaAt: '2026-11-19T15:00:00Z', valorActual: 20, valorNuevo: 15 }, inicio))
  ok('una aplicada sí', propuestaBloqueaPresupuesto({ estado: 'aplicada', origen: 'agente', ...sube }, inicio))
}

console.log('\n=== pendientes por cuenta (dos consultas de límite 1 por cuenta, sin el corte de 1.000 filas) ===')
{
  const m = pendientesDeResultados(['a', 'b', 'c', 'd'], [
    { hay: 1, revisar: 0 },
    { hay: 0, revisar: 0 },
    { hay: 1, revisar: 1 },
    // Un REVISAR libre es también una pendiente libre aunque la primera consulta no la trajera
    { hay: 0, revisar: 1 },
  ])
  ok('con una libre: hay, sin REVISAR', m.get('a')?.hay === true && m.get('a')?.revisar === false)
  ok('sin ninguna: no sale', !m.has('b'))
  ok('con REVISAR: hay y revisar', m.get('c')?.hay === true && m.get('c')?.revisar === true)
  ok('solo el REVISAR: hay = true', m.get('d')?.hay === true && m.get('d')?.revisar === true)
  // Cada cuenta se mira por separado: que otra cuenta tenga miles de pendientes no deja a esta sin ellas
  const muchas = pendientesDeResultados(['grande', 'pequena'], [{ hay: 1, revisar: 1 }, { hay: 1, revisar: 0 }])
  ok('una cuenta con pocas pendientes sigue con hay = true junto a una con muchas', muchas.get('pequena')?.hay === true)
}

console.log('\n=== orden de las cuentas: la más urgente primero ===')
{
  const c = (id: string, vigilarOkAt: string | null, aplicarAt: string | null = null) => ({ id, config: { vigilarOkAt, marcas: { aplicarAt } } })
  const orden = ordenarPorUrgencia([
    c('reciente', '2026-12-10T11:55:00Z', '2026-12-10T11:50:00Z'),
    c('vieja', '2026-12-10T10:00:00Z'),
    c('nunca', null),
    c('igual-aplico-antes', '2026-12-10T11:55:00Z', '2026-12-10T08:00:00Z'),
    c('igual-sin-aplicar', '2026-12-10T11:55:00Z', null),
  ]).map((x) => x.id)
  ok('sin vigilar bueno primero', orden[0] === 'nunca', orden.join(','))
  ok('después el vigilar más viejo', orden[1] === 'vieja', orden.join(','))
  ok('a igualdad de vigilar, la que nunca aplicó y luego la que aplicó hace más', orden.slice(2).join(',') === 'igual-sin-aplicar,igual-aplico-antes,reciente', orden.join(','))
  ok('no cambia la lista de entrada', ordenarPorUrgencia([c('x', null)]).length === 1)
}

console.log('\n=== firma de la reserva de la cuenta ===')
{
  const ms = Date.parse('2026-12-10T12:00:00.123Z')
  const f = firmaDeReserva(ms, 0.4567)
  ok('lleva microsegundos: 6 decimales', f === '2026-12-10T12:00:00.123456Z', f)
  ok('el instante es el mismo (al milisegundo)', Date.parse(f) === ms)
  ok('dos reservas del mismo milisegundo con distinto azar no se confunden (soltar con una firma ajena no toca la reserva)', firmaDeReserva(ms, 0.1) !== firmaDeReserva(ms, 0.2))
  ok('azar fuera de rango se acota', firmaDeReserva(ms, 1) === '2026-12-10T12:00:00.123999Z' && firmaDeReserva(ms, -1) === '2026-12-10T12:00:00.123000Z')
}

if (fallos) {
  console.log(`\n${fallos} FALLO(S)`)
  process.exit(1)
}
console.log('\nTODO BIEN')
