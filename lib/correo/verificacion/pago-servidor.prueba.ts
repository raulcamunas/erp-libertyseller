import { randomBytes } from 'node:crypto'
import { crearCliente, nuevaBase, type BaseEnMemoria } from '@/lib/correo/secuencias/cliente-falso'
import type { createServiceClient } from '@/lib/supabase/service'
import {
  CREDITOS_PARA_AVISAR,
  ENFRIAMIENTO_MS,
  FALTA_LA_MIGRACION_256,
  FRENO_MS,
  claveValida,
  comprobarDirecciones,
  comprobarUna,
  contarComprobadas,
  estadoParaLaSalud,
  guardarAjustes,
  guardarClave,
  leerConfiguracion,
  loQueSeSabeAntesDeEnviar,
  probarClave,
  quitarClave,
  reiniciarLosFrenos,
  verificadorParaElMotor,
  verificarAntesDeEnviar,
} from './pago-servidor'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Servicio = ReturnType<typeof createServiceClient>

process.env.AMAZON_TOKEN_KEY = randomBytes(32).toString('base64')
delete process.env.MILLIONVERIFIER_API_KEY

const CLAVE = 'CLAVE_DE_PRUEBA_1234'
const HOY = Date.parse('2026-10-27T10:00:00Z')
const DIA = 86_400_000
let reloj = HOY
const ahora = () => reloj

const base = { free: false, role: false, didyoumean: '', executiontime: 0, error: '', livemode: true }
const BUENA = { ...base, quality: 'good', result: 'ok', resultcode: 1, subresult: 'ok' }
const MALA = { ...base, quality: 'bad', result: 'invalid', resultcode: 6, subresult: 'no_mailbox' }
const MALA_DOMINIO = { ...base, quality: 'bad', result: 'invalid', resultcode: 6, subresult: 'bad_domain', didyoumean: 'bademail@gmail.com' }
const DUDOSA = { ...base, quality: 'risky', result: 'catch_all', resultcode: 2, subresult: 'ok' }
const ERROR = (texto: string) => ({ ...base, result: '', resultcode: 4, subresult: '', error: texto })

/** Un MillionVerifier de mentira: cuenta las llamadas, cobra un crédito por las buenas y las malas, y contesta lo que se le diga por dirección */
function servicioFalso(creditosIniciales = 10_500) {
  const llamadas: Array<{ tipo: 'verificar' | 'creditos'; email: string | null; clave: string | null }> = []
  const respuestas = new Map<string, unknown>()
  let creditos = creditosIniciales
  let predeterminada: unknown = BUENA
  let alLlamar: (email: string) => void | Promise<void> = () => {}
  const f = (async (url: string | URL | Request) => {
    const u = new URL(String(url))
    const clave = u.searchParams.get('api')
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.pathname.endsWith('/credits')) {
      llamadas.push({ tipo: 'creditos', email: null, clave })
      return clave === CLAVE ? json({ credits: creditos, bulk_credits: creditos, renewing_credits: 0, plan: 4 }) : json({ result: 'error', error: 'apikey_not_found' })
    }
    const email = u.searchParams.get('email')
    llamadas.push({ tipo: 'verificar', email, clave })
    await alLlamar(email ?? '')
    if (clave !== CLAVE) return json(ERROR('Apikey not found'))
    const r = (respuestas.get(email ?? '') ?? predeterminada) as Record<string, unknown> | 'lanza'
    if (r === 'lanza') throw new Error('connect ECONNREFUSED')
    // Un error trae sus propios «credits» si se le ponen (con una clave que no existe, el servicio de verdad contesta «credits: 0»)
    if (r.resultcode === 4) return json({ email, credits: creditos, ...r })
    if (r.quality === 'good' || r.quality === 'bad') creditos -= 1
    return json({ ...r, email, credits: creditos })
  }) as typeof fetch
  return {
    fetch: f,
    llamadas: () => llamadas.filter((l) => l.tipo === 'verificar'),
    todas: llamadas,
    contestar: (email: string, r: unknown) => void respuestas.set(email, r),
    contestarTodo: (r: unknown) => void (predeterminada = r),
    ponerCreditos: (n: number) => void (creditos = n),
    alLlamar: (h: (email: string) => void | Promise<void>) => void (alLlamar = h),
    creditos: () => creditos,
  }
}

interface Entorno {
  base: BaseEnMemoria
  s: Servicio
  mv: ReturnType<typeof servicioFalso>
}

/** Una base nueva con la verificación ya configurada (clave guardada y encendida), o sin configurar */
async function montar(o: { configurada?: boolean; activa?: boolean; dudosas?: 'avisar' | 'sin_seguimientos' | 'bloquear'; creditos?: number } = {}): Promise<Entorno> {
  reloj = HOY
  reiniciarLosFrenos()
  const { base: b, service } = nuevaBase(ahora)
  b.sembrar('correo_verificacion_ajustes', { id: true })
  const s = service as unknown as Servicio
  const mv = servicioFalso(o.creditos)
  if (o.configurada !== false) {
    const r = await guardarClave(s, { id: 'admin' }, CLAVE, { fetch: mv.fetch }, reloj)
    if (!r.ok) throw new Error(`No se ha podido preparar la clave: ${r.mensaje}`)
    if (o.activa === false) await guardarAjustes(s, { id: 'admin' }, { activa: false }, reloj)
    if (o.dudosas) await guardarAjustes(s, { id: 'admin' }, { dudosas: o.dudosas }, reloj)
    mv.todas.length = 0
  }
  return { base: b, s, mv }
}

const filas = (e: Entorno, tabla: string) => e.base.filas(tabla)
const nivelDe = (r: Awaited<ReturnType<typeof comprobarDirecciones>> extends Map<string, infer R> ? R | undefined : never): string => (r?.tipo === 'veredicto' ? r.veredicto.nivel : `sin:${r?.tipo === 'sin_comprobar' ? r.causa : '?'}`)

async function main() {
  console.log('\n=== la clave y los ajustes ===')
  {
    ok('el formato de una clave: letras, cifras y guiones, de 8 a 128', claveValida('8y2hALTgko0iW9jEaPuMaRLRM') && claveValida('ab-cd_1234') && !claveValida('corta') && !claveValida('tiene espacios aqui') && !claveValida('con?simbolos&raros') && !claveValida('x'.repeat(129)) && !claveValida(123))

    const sin = await montar({ configurada: false })
    const c0 = await leerConfiguracion(sin.s)
    ok('recién creada: apagada, sin clave, con «avisar» a las dudosas', c0 !== null && !c0.ajustes.activa && !c0.ajustes.hayClave && c0.ajustes.dudosas === 'avisar' && c0.clave === null)

    ok('una clave que no tiene buena pinta no se guarda', (await guardarClave(sin.s, { id: 'a' }, 'abc', { fetch: sin.mv.fetch })).ok === false && sin.mv.todas.length === 0)
    const rechazada = await guardarClave(sin.s, { id: 'a' }, 'OTRA_CLAVE_QUE_NO_EXISTE', { fetch: sin.mv.fetch })
    ok('una clave que el servicio no reconoce no se guarda, y la frase dice qué hacer', !rechazada.ok && rechazada.estado === 422 && /no reconoce la clave/.test(rechazada.mensaje) && (await leerConfiguracion(sin.s))?.clave === null)
    const caida = await guardarClave(sin.s, { id: 'a' }, CLAVE, { fetch: (async () => { throw new Error('x') }) as typeof fetch })
    ok('si el servicio no contesta tampoco se guarda (no se sabe si vale)', !caida.ok && caida.estado === 502 && (await leerConfiguracion(sin.s))?.clave === null)

    const buena = await guardarClave(sin.s, { id: 'admin-1' }, CLAVE, { fetch: sin.mv.fetch }, reloj)
    ok('una clave buena se guarda, devuelve los créditos y enciende la verificación (era la primera)', buena.ok && buena.creditos === 10_500 && buena.activada)
    const guardada = filas(sin, 'correo_verificacion_ajustes')[0]
    ok('se guarda CIFRADA: en la base no está la clave', typeof guardada.clave_cifrada === 'string' && !String(guardada.clave_cifrada).includes(CLAVE) && String(guardada.clave_cifrada).startsWith('v1.') && !JSON.stringify(guardada).includes(CLAVE))
    ok('con sus últimos 4 caracteres para reconocerla, los créditos y quién la puso', guardada.clave_termina === '1234' && guardada.creditos === 10_500 && guardada.actualizada_por === 'admin-1' && guardada.activa === true)
    const c1 = await leerConfiguracion(sin.s)
    ok('se lee de vuelta descifrada, y los ajustes que se enseñan NO la llevan', c1?.clave === CLAVE && c1.ajustes.hayClave && c1.ajustes.claveDe === 'ajustes' && !JSON.stringify(c1.ajustes).includes(CLAVE) && c1.ajustes.claveTermina === '1234' && c1.ajustes.creditos === 10_500)

    await guardarAjustes(sin.s, { id: 'a' }, { activa: false }, reloj)
    const otra = await guardarClave(sin.s, { id: 'a' }, CLAVE, { fetch: sin.mv.fetch }, reloj)
    ok('si ya había clave y se apagó a propósito, guardar otra NO la vuelve a encender', otra.ok && !otra.activada && (await leerConfiguracion(sin.s))?.ajustes.activa === false)

    const encender = await guardarAjustes(sin.s, { id: 'a' }, { activa: true }, reloj)
    ok('se puede volver a encender', encender.ok && (await leerConfiguracion(sin.s))?.ajustes.activa === true)
    ok('elegir qué hacer con las dudosas', (await guardarAjustes(sin.s, { id: 'a' }, { dudosas: 'bloquear' }, reloj)).ok && (await leerConfiguracion(sin.s))?.ajustes.dudosas === 'bloquear')
    const mala = await guardarAjustes(sin.s, { id: 'a' }, { dudosas: 'otra' })
    ok('una opción que no existe, error', !mala.ok && mala.estado === 400)
    ok('un «activa» que no es verdadero o falso, error', !(await guardarAjustes(sin.s, { id: 'a' }, { activa: 'si' })).ok)
    ok('sin ningún cambio, error', !(await guardarAjustes(sin.s, { id: 'a' }, {})).ok)

    const sinClave = await montar({ configurada: false })
    const encenderSin = await guardarAjustes(sinClave.s, { id: 'a' }, { activa: true })
    ok('encender sin clave no se puede, y dice qué falta', !encenderSin.ok && encenderSin.estado === 422 && /clave/.test(encenderSin.mensaje))

    const quitar = await quitarClave(sin.s, { id: 'a' })
    const trasQuitar = await leerConfiguracion(sin.s)
    ok('quitar la clave la borra del todo y apaga', quitar.ok && trasQuitar?.clave === null && trasQuitar.ajustes.activa === false && filas(sin, 'correo_verificacion_ajustes')[0].clave_cifrada === null)

    // Sin la clave de cifrado del servidor no se puede guardar (se dice cómo arreglarlo)
    const clavePuesta = process.env.AMAZON_TOKEN_KEY
    delete process.env.AMAZON_TOKEN_KEY
    const sinCifrado = await guardarClave((await montar({ configurada: false })).s, { id: 'a' }, CLAVE, { fetch: servicioFalso().fetch })
    process.env.AMAZON_TOKEN_KEY = clavePuesta
    ok('sin la clave de cifrado del servidor, no se guarda y se dice por qué', !sinCifrado.ok && sinCifrado.estado === 503 && /AMAZON_TOKEN_KEY/.test(sinCifrado.mensaje) && /MILLIONVERIFIER_API_KEY/.test(sinCifrado.mensaje))

    // Una clave guardada que ya no se puede descifrar (cambió la clave del servidor): se dice, no se rompe
    const ilegible = await montar()
    filas(ilegible, 'correo_verificacion_ajustes')[0].clave_cifrada = 'v1.AAAA.BBBB.CCCC'
    const ci = await leerConfiguracion(ilegible.s)
    ok('una clave guardada que no se puede leer: sin clave, y avisa de que está ilegible', ci?.clave === null && ci.ajustes.claveIlegible && !ci.ajustes.hayClave)

    // La clave puesta en el servidor (variable de entorno) vale cuando no hay otra
    const entorno = await montar({ configurada: false })
    process.env.MILLIONVERIFIER_API_KEY = CLAVE
    const ce = await leerConfiguracion(entorno.s)
    delete process.env.MILLIONVERIFIER_API_KEY
    ok('la variable de entorno MILLIONVERIFIER_API_KEY vale si no hay clave guardada', ce?.clave === CLAVE && ce.ajustes.claveDe === 'entorno' && ce.ajustes.hayClave)

    // Sin la migración 256 todo sigue como siempre
    const sinMig = await montar({ configurada: false })
    sinMig.base.ausentes.add('correo_verificacion_ajustes')
    ok('sin la migración, no hay configuración y no se rompe nada', (await leerConfiguracion(sinMig.s)) === null)
    ok('guardar algo sin la migración da un 503 con el fichero que falta', (await guardarAjustes(sinMig.s, { id: 'a' }, { activa: false })).ok === false && /256_correo_verificacion_de_direcciones\.sql/.test(FALTA_LA_MIGRACION_256))
    const r256 = await comprobarDirecciones(sinMig.s, ['ana@tienda.es'], { origen: 'primer_correo', fetch: sinMig.mv.fetch })
    ok('comprobar sin la migración: «apagada» con el aviso de la migración, y no se llama a nadie', nivelDe(r256.get('ana@tienda.es')) === 'sin:apagada' && (r256.get('ana@tienda.es') as { motivo: string }).motivo === FALTA_LA_MIGRACION_256 && sinMig.mv.llamadas().length === 0)
    ok('verificar antes de enviar, sin la migración: null (el correo sale como siempre)', (await verificarAntesDeEnviar(sinMig.s, { para: ['ana@tienda.es'], direccionDelBuzon: 'x@libertyseller.es', usuarioId: 'u', fetch: sinMig.mv.fetch })) === null)
  }

  console.log('\n=== preguntar UNA vez y guardar la respuesta ===')
  {
    const e = await montar()
    const r1 = await comprobarDirecciones(e.s, ['ana@tienda.es'], { origen: 'primer_correo', usuarioId: 'u1', ahora, fetch: e.mv.fetch })
    const v1 = r1.get('ana@tienda.es')
    ok('una dirección nueva: se pregunta al servicio y es buena', nivelDe(v1) === 'buena' && v1?.tipo === 'veredicto' && v1.veredicto.origen === 'servicio' && e.mv.llamadas().length === 1)
    ok('a la dirección correcta y con la clave', e.mv.llamadas()[0].email === 'ana@tienda.es' && e.mv.llamadas()[0].clave === CLAVE)
    const guardada = filas(e, 'correo_verificaciones')[0]
    ok('lo que dijo queda guardado, con quién lo pidió y por qué', filas(e, 'correo_verificaciones').length === 1 && guardada.direccion === 'ana@tienda.es' && guardada.nivel === 'buena' && guardada.resultado === 'ok' && guardada.origen === 'primer_correo' && guardada.verificada_por === 'u1' && guardada.proveedor === 'millionverifier')
    ok('y los créditos que quedan se apuntan (uno menos)', filas(e, 'correo_verificacion_ajustes')[0].creditos === 10_499)

    // El segundo correo, el tercero… (los seguimientos): ni una llamada más
    const r2 = await comprobarDirecciones(e.s, ['ana@tienda.es'], { origen: 'seguimiento', ahora, fetch: e.mv.fetch })
    const r3 = await comprobarDirecciones(e.s, ['ANA@tienda.es'], { origen: 'seguimiento', ahora, fetch: e.mv.fetch })
    ok('LA MISMA DIRECCIÓN NO SE VUELVE A PREGUNTAR: los seguimientos usan lo guardado (1 llamada en total, 1 crédito)', e.mv.llamadas().length === 1 && nivelDe(r2.get('ana@tienda.es')) === 'buena' && nivelDe(r3.get('ana@tienda.es')) === 'buena' && filas(e, 'correo_verificacion_ajustes')[0].creditos === 10_499)
    ok('…y se dice que viene de lo guardado', r2.get('ana@tienda.es')?.tipo === 'veredicto' && (r2.get('ana@tienda.es') as { veredicto: { origen: string } }).veredicto.origen === 'memoria')

    // Con el motor: los dos seguimientos de una secuencia
    const motor = verificadorParaElMotor(e.s, { fetch: e.mv.fetch, ahora })
    const m1 = await motor('ana@tienda.es')
    const m2 = await motor('ana@tienda.es')
    ok('el motor, en los dos seguimientos, tampoco pregunta (buena = nada que decir)', m1 === null && m2 === null && e.mv.llamadas().length === 1)

    // Mayúsculas y duplicados en una misma petición: una sola llamada
    const e2 = await montar()
    const r = await comprobarDirecciones(e2.s, ['Pepe@Tienda.es', 'pepe@tienda.es', ' pepe@tienda.es '], { origen: 'primer_correo', ahora, fetch: e2.mv.fetch })
    ok('mayúsculas, espacios y repeticiones son la misma dirección: una llamada', e2.mv.llamadas().length === 1 && r.size === 1 && r.has('pepe@tienda.es'))

    // Dos envíos a la vez a la misma dirección (un doble clic): una sola llamada
    const e3 = await montar()
    let abrir: () => void = () => {}
    const espera = new Promise<void>((res) => (abrir = res))
    e3.mv.alLlamar(() => espera)
    const a = comprobarDirecciones(e3.s, ['doble@tienda.es'], { origen: 'primer_correo', ahora, fetch: e3.mv.fetch })
    const b = comprobarDirecciones(e3.s, ['doble@tienda.es'], { origen: 'primer_correo', ahora, fetch: e3.mv.fetch })
    await new Promise((res) => setTimeout(res, 20))
    abrir()
    const [ra, rb] = await Promise.all([a, b])
    ok('dos peticiones a la vez por la misma dirección esperan la misma respuesta: no se paga dos veces', e3.mv.llamadas().length === 1 && nivelDe(ra.get('doble@tienda.es')) === 'buena' && nivelDe(rb.get('doble@tienda.es')) === 'buena')

    // Lo guardado caduca: una buena, al año
    const e4 = await montar()
    await comprobarDirecciones(e4.s, ['vieja@tienda.es'], { origen: 'primer_correo', ahora, fetch: e4.mv.fetch })
    reloj = HOY + 364 * DIA
    await comprobarDirecciones(e4.s, ['vieja@tienda.es'], { origen: 'primer_correo', ahora, fetch: e4.mv.fetch })
    ok('a los 364 días sigue valiendo', e4.mv.llamadas().length === 1)
    reloj = HOY + 366 * DIA
    await comprobarDirecciones(e4.s, ['vieja@tienda.es'], { origen: 'primer_correo', ahora, fetch: e4.mv.fetch })
    ok('pasado un año se vuelve a preguntar', e4.mv.llamadas().length === 2)
    reloj = HOY
  }

  console.log('\n=== lo que dice cada tipo de respuesta ===')
  {
    const e = await montar()
    e.mv.contestar('mala@tienda.es', MALA)
    e.mv.contestar('bademail@gmal.com', MALA_DOMINIO)
    e.mv.contestar('jefe@grande.com', DUDOSA)
    const r = await comprobarDirecciones(e.s, ['mala@tienda.es', 'bademail@gmal.com', 'jefe@grande.com'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })
    ok('mala, mala y dudosa', nivelDe(r.get('mala@tienda.es')) === 'mala' && nivelDe(r.get('bademail@gmal.com')) === 'mala' && nivelDe(r.get('jefe@grande.com')) === 'dudosa')
    const dominio = r.get('bademail@gmal.com')
    ok('con la corrección que propone el servicio y la frase del dominio', dominio?.tipo === 'veredicto' && dominio.veredicto.sugerencia === 'bademail@gmail.com' && /dominio no existe/.test(dominio.veredicto.motivo))

    const memoria = filas(e, 'correo_direcciones_malas')
    ok('las malas entran en la memoria de direcciones que no sirven, con su origen (para el botón «Liberar»)', memoria.length === 2 && memoria.every((m) => m.estado === 'mala' && m.origen === 'verificador') && memoria.some((m) => m.direccion === 'mala@tienda.es'))
    ok('con el motivo sin punto final ni prefijos', memoria.find((m) => m.direccion === 'mala@tienda.es')?.motivo === 'El buzón no existe')
    ok('la dudosa NO entra en esa memoria (no es una dirección mala)', !memoria.some((m) => m.direccion === 'jefe@grande.com'))
    ok('pero las tres quedan guardadas', filas(e, 'correo_verificaciones').length === 3 && filas(e, 'correo_verificaciones').find((f) => f.direccion === 'jefe@grande.com')?.nivel === 'dudosa')
    ok('se gastaron los créditos de las dos malas (las dudosas no se cobran): 10.498', filas(e, 'correo_verificacion_ajustes')[0].creditos === 10_498)

    const otra = await comprobarDirecciones(e.s, ['mala@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })
    const o = otra.get('mala@tienda.es')
    ok('una mala ya conocida no se vuelve a preguntar, y se dice por qué', e.mv.llamadas().length === 3 && o?.tipo === 'veredicto' && o.veredicto.nivel === 'mala' && /servicio de verificación dice que esa dirección no existe/.test(o.veredicto.motivo) && !/rebot/.test(o.veredicto.motivo))

    // Una persona libera una dirección: se da por buena, mande lo que mande lo guardado
    await e.s.from('correo_direcciones_malas').update({ estado: 'liberada' }).eq('direccion', 'mala@tienda.es')
    const liberada = (await comprobarDirecciones(e.s, ['mala@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })).get('mala@tienda.es')
    ok('una dirección liberada por un administrador se da por buena SIN preguntar (aunque lo guardado diga que es mala)', e.mv.llamadas().length === 3 && liberada?.tipo === 'veredicto' && liberada.veredicto.nivel === 'buena' && liberada.veredicto.origen === 'persona')

    // Una que rebotó de verdad: mala, sin preguntar
    await e.s.from('correo_direcciones_malas').insert({ direccion: 'rebotada@tienda.es', estado: 'mala', motivo: 'el servidor dijo que no existe', origen: 'rebote', veces: 2 })
    const rebotada = (await comprobarDirecciones(e.s, ['rebotada@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })).get('rebotada@tienda.es')
    ok('una que ya rebotó es mala sin gastar nada, y se dice «rebotó»', e.mv.llamadas().length === 3 && rebotada?.tipo === 'veredicto' && rebotada.veredicto.nivel === 'mala' && rebotada.veredicto.origen === 'rebote' && /ya rebotó antes \(2 veces\)/.test(rebotada.veredicto.motivo))
  }

  console.log('\n=== lo que no se comprueba ===')
  {
    const e = await montar()
    const r = await comprobarDirecciones(e.s, ['ana@libertyseller.es', 'x@LibertySeller.com', 'jefe@otra.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch, direccionesPropias: ['jefe@otra.es'] })
    ok('los dominios del equipo y las direcciones propias no se comprueban', nivelDe(r.get('ana@libertyseller.es')) === 'sin:propia' && nivelDe(r.get('x@libertyseller.com')) === 'sin:propia' && nivelDe(r.get('jefe@otra.es')) === 'sin:propia' && e.mv.llamadas().length === 0)
    const dominioDeBuzon = await comprobarDirecciones(e.s, ['luis@empresa-del-buzon.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch, dominiosPropios: ['empresa-del-buzon.es'] })
    ok('ni el dominio de un buzón conectado', e.mv.llamadas().length === 0 && nivelDe(dominioDeBuzon.get('luis@empresa-del-buzon.es')) === 'sin:propia')
    await comprobarDirecciones(e.s, ['ana@libertyseller.es'], { origen: 'prueba', ahora, fetch: e.mv.fetch, incluirLasPropias: true })
    ok('salvo en la prueba de un administrador', e.mv.llamadas().length === 1)

    const apagada = await montar({ activa: false })
    const ra = await comprobarDirecciones(apagada.s, ['ana@tienda.es'], { origen: 'primer_correo', ahora, fetch: apagada.mv.fetch })
    ok('apagada: no se llama a nadie', nivelDe(ra.get('ana@tienda.es')) === 'sin:apagada' && apagada.mv.llamadas().length === 0)
    const sinConfigurar = await montar({ configurada: false })
    const rn = await comprobarDirecciones(sinConfigurar.s, ['ana@tienda.es'], { origen: 'primer_correo', ahora, fetch: sinConfigurar.mv.fetch })
    ok('sin configurar (nace apagada): no se llama a nadie', nivelDe(rn.get('ana@tienda.es')) === 'sin:apagada' && sinConfigurar.mv.llamadas().length === 0)
    // Encendida pero sin clave (se borró la columna a mano, o la clave guardada ya no se puede descifrar)
    const sinClave = await montar()
    filas(sinClave, 'correo_verificacion_ajustes')[0].clave_cifrada = null
    const rs = await comprobarDirecciones(sinClave.s, ['ana@tienda.es'], { origen: 'primer_correo', ahora, fetch: sinClave.mv.fetch })
    ok('encendida pero sin clave: tampoco se llama a nadie, y el correo sale', nivelDe(rs.get('ana@tienda.es')) === 'sin:sin_clave' && sinClave.mv.llamadas().length === 0 && (await verificarAntesDeEnviar(sinClave.s, { para: ['ana@tienda.es'], direccionDelBuzon: 'x@libertyseller.es', usuarioId: 'u', fetch: sinClave.mv.fetch })) === null)
    ok('una lista vacía no hace nada', (await comprobarDirecciones(e.s, [], { origen: 'primer_correo' })).size === 0 && (await comprobarDirecciones(e.s, ['', '   '], { origen: 'primer_correo' })).size === 0)
  }

  console.log('\n=== cuando el servicio falla, el correo NO se queda sin salir ===')
  {
    // Sin créditos: no se bloquea, se apunta, y se frena para no insistir
    const e = await montar()
    e.mv.contestarTodo(ERROR('Insufficient credits'))
    const r1 = await comprobarDirecciones(e.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })
    ok('sin créditos: la dirección queda sin comprobar (el correo sale)', nivelDe(r1.get('a@tienda.es')) === 'sin:sin_creditos')
    const fila = filas(e, 'correo_verificacion_ajustes')[0]
    ok('el fallo queda apuntado con una frase NUESTRA (no el texto del servicio)', fila.error_causa === 'sin_creditos' && /acabado los créditos/.test(String(fila.error_texto)) && !/Insufficient/.test(String(fila.error_texto)) && fila.creditos === 0)
    const r2 = await comprobarDirecciones(e.s, ['b@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })
    ok('con el freno puesto, la siguiente dirección ni se pregunta (no se insiste con cada correo)', e.mv.llamadas().length === 1 && (r2.get('b@tienda.es') as { causa: string }).causa === 'sin_creditos')
    reloj = HOY + FRENO_MS + 1000
    e.mv.contestarTodo(BUENA)
    const r3 = await comprobarDirecciones(e.s, ['c@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })
    ok('pasados diez minutos se vuelve a intentar, y si ya hay créditos funciona y quita el fallo', nivelDe(r3.get('c@tienda.es')) === 'buena' && filas(e, 'correo_verificacion_ajustes')[0].error_causa === null)
    reloj = HOY

    // El freno sobrevive a un reinicio del servidor: lo recuerda la base
    const reinicio = await montar()
    reinicio.mv.contestarTodo(ERROR('Apikey not found'))
    await comprobarDirecciones(reinicio.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: reinicio.mv.fetch })
    reiniciarLosFrenos()
    const trasReinicio = await comprobarDirecciones(reinicio.s, ['b@tienda.es'], { origen: 'primer_correo', ahora, fetch: reinicio.mv.fetch })
    ok('la clave mala: fallo «clave», y tras reiniciar el servidor el fallo apuntado en la base sigue frenando', (trasReinicio.get('b@tienda.es') as { causa: string }).causa === 'clave' && reinicio.mv.llamadas().length === 1)

    // El servicio contesta «credits: 0» a una clave que no existe: eso NO son los créditos de la cuenta, y no debe pisar los que había apuntados
    const claveCaida = await montar()
    claveCaida.mv.contestarTodo({ ...ERROR('Apikey not found'), credits: 0 })
    await comprobarDirecciones(claveCaida.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: claveCaida.mv.fetch })
    const filaCaida = filas(claveCaida, 'correo_verificacion_ajustes')[0]
    ok('una clave que ya no vale (el servicio dice «credits: 0») NO borra los créditos apuntados ni dispara «sin créditos»', filaCaida.error_causa === 'clave' && filaCaida.creditos === 10_500, JSON.stringify([filaCaida.error_causa, filaCaida.creditos]))

    const ip = await montar()
    ip.mv.contestarTodo(ERROR('IP address blocked'))
    const rip = await comprobarDirecciones(ip.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: ip.mv.fetch })
    ok('IP bloqueada: fallo «ip»', (rip.get('a@tienda.es') as { causa: string }).causa === 'ip' && filas(ip, 'correo_verificacion_ajustes')[0].error_causa === 'ip')

    // Un fallo pasajero: la red
    const red = await montar()
    red.mv.contestarTodo('lanza')
    const rr = await comprobarDirecciones(red.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: red.mv.fetch })
    ok('si el servicio no contesta: sin comprobar, y no hay freno largo (un primer correo siempre lo vuelve a intentar)', (rr.get('a@tienda.es') as { causa: string }).causa === 'red' && filas(red, 'correo_verificacion_ajustes')[0].error_causa === 'red')
    red.mv.contestarTodo(BUENA)
    const rr2 = await comprobarDirecciones(red.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: red.mv.fetch })
    ok('el siguiente intento a esa dirección, hecho por una persona, pregunta de nuevo y ya funciona', nivelDe(rr2.get('a@tienda.es')) === 'buena')

    const motor = await montar()
    motor.mv.contestarTodo('lanza')
    const rm = await comprobarDirecciones(motor.s, ['a@tienda.es'], { origen: 'seguimiento', ahora, fetch: motor.mv.fetch })
    const rm2 = await comprobarDirecciones(motor.s, ['a@tienda.es'], { origen: 'seguimiento', ahora, fetch: motor.mv.fetch })
    ok('para un seguimiento, tras un fallo pasajero, no se insiste en cada pasada: espera un rato', (rm.get('a@tienda.es') as { causa: string }).causa === 'red' && motor.mv.llamadas().length === 1 && (rm2.get('a@tienda.es') as { causa: string }).causa === 'red')
    reloj = HOY + ENFRIAMIENTO_MS + 1000
    motor.mv.contestarTodo(BUENA)
    const rm3 = await comprobarDirecciones(motor.s, ['a@tienda.es'], { origen: 'seguimiento', ahora, fetch: motor.mv.fetch })
    ok('y pasado ese rato lo vuelve a intentar', nivelDe(rm3.get('a@tienda.es')) === 'buena' && motor.mv.llamadas().length === 2)
    reloj = HOY

    const sinVeredicto = await montar()
    sinVeredicto.mv.contestarTodo({ ...base, result: 'unverified', resultcode: 0, subresult: 'unverified' })
    const ru = await comprobarDirecciones(sinVeredicto.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: sinVeredicto.mv.fetch })
    ok('«unverified»: ni buena ni mala, no se guarda como comprobada ni entra en la memoria de malas', nivelDe(ru.get('a@tienda.es')) === 'sin:otro' && filas(sinVeredicto, 'correo_verificaciones').length === 0 && filas(sinVeredicto, 'correo_direcciones_malas').length === 0)

    // La base falla al guardar: igualmente se devuelve lo averiguado
    const baseRota = await montar()
    baseRota.base.ausentes.add('correo_verificaciones')
    const rb = await comprobarDirecciones(baseRota.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: baseRota.mv.fetch })
    ok('si no se puede guardar la respuesta (la tabla no está), lo averiguado se usa igualmente', nivelDe(rb.get('a@tienda.es')) === 'buena')
  }

  console.log('\n=== el tope de llamadas por pasada del motor ===')
  {
    const e = await montar()
    const presupuesto = { restantes: 2 }
    const r = await comprobarDirecciones(e.s, ['a@t.es', 'b@t.es', 'c@t.es'], { origen: 'seguimiento', ahora, fetch: e.mv.fetch, presupuestoDeLlamadas: presupuesto })
    const niveles = ['a@t.es', 'b@t.es', 'c@t.es'].map((d) => nivelDe(r.get(d)))
    ok('con un tope de 2 llamadas, solo se hacen 2; la tercera queda para la pasada siguiente', e.mv.llamadas().length === 2 && niveles.filter((n) => n === 'buena').length === 2 && niveles.filter((n) => n === 'sin:limite').length === 1 && presupuesto.restantes === 0)
    const guardadas = await comprobarDirecciones(e.s, ['a@t.es', 'b@t.es'], { origen: 'seguimiento', ahora, fetch: e.mv.fetch, presupuestoDeLlamadas: { restantes: 0 } })
    ok('lo ya guardado no cuenta para el tope (no es una llamada)', nivelDe(guardadas.get('a@t.es')) === 'buena' && nivelDe(guardadas.get('b@t.es')) === 'buena')
  }

  console.log('\n=== antes de enviar el primer correo ===')
  {
    const entrada = (e: Entorno, para: string[], extra: Record<string, unknown> = {}) => ({ para, direccionDelBuzon: 'ana@libertyseller.es', usuarioId: 'u1', ahora, fetch: e.mv.fetch, ...extra })
    const apagada = await montar({ activa: false })
    ok('apagada: null, el correo sale como siempre', (await verificarAntesDeEnviar(apagada.s, entrada(apagada, ['a@tienda.es']))) === null && apagada.mv.llamadas().length === 0)

    const e = await montar()
    e.mv.contestar('mala@tienda.es', MALA)
    e.mv.contestar('bademail@gmal.com', MALA_DOMINIO)
    e.mv.contestar('jefe@grande.com', DUDOSA)
    const buena = await verificarAntesDeEnviar(e.s, entrada(e, ['ana@tienda.es']))
    ok('una buena: sale, sin avisos', buena !== null && buena.bloqueo === null && buena.avisos.length === 0 && e.mv.llamadas().length === 1)
    const segunda = await verificarAntesDeEnviar(e.s, entrada(e, ['ana@tienda.es']))
    ok('otra vez a la misma: no se vuelve a preguntar', segunda?.bloqueo === null && e.mv.llamadas().length === 1)

    const mala = await verificarAntesDeEnviar(e.s, entrada(e, ['bademail@gmal.com']))
    ok('una mala: NO sale, con la corrección que propone el servicio', mala?.bloqueo !== null && /No se ha enviado/.test(mala?.bloqueo?.mensaje ?? '') && /bademail@gmail\.com/.test(mala?.bloqueo?.mensaje ?? '') && mala?.bloqueo?.direcciones[0].bloquea === true)
    const otraVez = await verificarAntesDeEnviar(e.s, entrada(e, ['bademail@gmal.com']))
    ok('la misma mala otra vez: sigue sin salir y no se vuelve a preguntar ni a pagar', otraVez?.bloqueo !== null && e.mv.llamadas().filter((l) => l.email === 'bademail@gmal.com').length === 1)

    const mezcla = await verificarAntesDeEnviar(e.s, entrada(e, ['ana@tienda.es', 'mala@tienda.es']))
    ok('con una buena y una mala, no sale', mezcla?.bloqueo !== null && /mala@tienda\.es/.test(mezcla?.bloqueo?.mensaje ?? ''))

    const dudosa = await verificarAntesDeEnviar(e.s, entrada(e, ['jefe@grande.com']))
    ok('dudosa con «avisar» (lo normal): sale con aviso', dudosa?.bloqueo === null && dudosa.avisos.length === 1 && /es dudosa/.test(dudosa.avisos[0]) && dudosa.sinSeguimientos === null)
    await guardarAjustes(e.s, { id: 'a' }, { dudosas: 'sin_seguimientos' })
    const sinSeg = await verificarAntesDeEnviar(e.s, entrada(e, ['jefe@grande.com']))
    ok('dudosa con «sin seguimientos»: sale, y se dice que sin seguimientos', sinSeg?.bloqueo === null && /sin seguimientos automáticos/.test(sinSeg?.sinSeguimientos ?? ''))
    await guardarAjustes(e.s, { id: 'a' }, { dudosas: 'bloquear' })
    const bloquea = await verificarAntesDeEnviar(e.s, entrada(e, ['jefe@grande.com']))
    ok('dudosa con «no enviar»: no sale', bloquea?.bloqueo !== null)
    ok('…y la dudosa sigue sin gastar una segunda llamada', e.mv.llamadas().filter((l) => l.email === 'jefe@grande.com').length === 1)

    const propia = await verificarAntesDeEnviar(e.s, entrada(e, ['equipo@libertyseller.es']))
    ok('a una dirección del propio equipo no se le pregunta nada', propia?.bloqueo === null && e.mv.llamadas().filter((l) => l.email === 'equipo@libertyseller.es').length === 0)
    const delBuzon = await verificarAntesDeEnviar(e.s, entrada(e, ['x@empresa-propia.es'], { direccionDelBuzon: 'ana@empresa-propia.es' }))
    ok('ni al dominio del buzón desde el que se envía', delBuzon?.bloqueo === null && e.mv.llamadas().filter((l) => l.email === 'x@empresa-propia.es').length === 0)
    // Un buzón conectado de un proveedor libre (gmail.com) NO exime a todos los gmail.com: solo a su propia dirección
    const conGmail = await verificarAntesDeEnviar(e.s, entrada(e, ['cliente@gmail.com', 'yo@gmail.com'], { direccionDelBuzon: 'yo@gmail.com' }))
    ok('un buzón de gmail.com no exime a los demás gmail.com: solo se salta su propia dirección', conGmail?.bloqueo === null && e.mv.llamadas().some((l) => l.email === 'cliente@gmail.com') && !e.mv.llamadas().some((l) => l.email === 'yo@gmail.com'))

    // Sin créditos: sale igual, con aviso
    const sinCreditos = await montar()
    sinCreditos.mv.contestarTodo(ERROR('Insufficient credits'))
    const sc = await verificarAntesDeEnviar(sinCreditos.s, entrada(sinCreditos, ['a@tienda.es']))
    ok('sin créditos el correo SALE, y se le dice a quien envía que esta vez no se comprobó', sc !== null && sc.bloqueo === null && sc.avisos.length === 1 && /No se ha podido comprobar/.test(sc.avisos[0]) && /acabado los créditos/.test(sc.avisos[0]))

    // Una avería inesperada de la base (no «falta la tabla», sino un error de verdad): el correo sale sin comprobar y nada lanza
    const rota = await montar()
    const original = rota.base.ejecutor
    const averiada = crearCliente(async (c) => (c.tabla === 'correo_direcciones_malas' && c.op === 'select' ? { data: null, error: { code: 'XX000', message: 'boom' }, count: null } : original(c))) as unknown as Servicio
    const silenciar = console.error
    let avisos = 0
    console.error = () => void (avisos += 1)
    let lanzo = false
    let rr: Awaited<ReturnType<typeof verificarAntesDeEnviar>> | undefined
    let sabido: Awaited<ReturnType<typeof loQueSeSabeAntesDeEnviar>> | undefined
    let paraElMotor: Awaited<ReturnType<ReturnType<typeof verificadorParaElMotor>>> | undefined
    try {
      rr = await verificarAntesDeEnviar(averiada, entrada(rota, ['a@tienda.es']))
      sabido = await loQueSeSabeAntesDeEnviar(averiada, ['a@tienda.es'], ahora())
      paraElMotor = await verificadorParaElMotor(averiada, { fetch: rota.mv.fetch, ahora })('a@tienda.es')
    } catch {
      lanzo = true
    } finally {
      console.error = silenciar
    }
    ok('una avería de la base: el correo SALE sin comprobar (null), no lanza y deja constancia en el registro', !lanzo && rr === null && avisos >= 1)
    ok('…en el cuadro de escribir no se enseña nada, y para un seguimiento tampoco hay nada que decir', sabido === null && paraElMotor === null && rota.mv.llamadas().length === 0)
  }

  console.log('\n=== mientras se escribe: lo ya sabido, sin gastar ===')
  {
    const e = await montar()
    e.mv.contestar('mala@tienda.es', MALA)
    await comprobarDirecciones(e.s, ['mala@tienda.es', 'buena@tienda.es'], { origen: 'primer_correo', ahora, fetch: e.mv.fetch })
    const antes = e.mv.llamadas().length
    const s = await loQueSeSabeAntesDeEnviar(e.s, ['mala@tienda.es', 'buena@tienda.es', 'nueva@tienda.es', 'x@libertyseller.es'], ahora())
    ok('devuelve lo que ya se sabe, y de las nuevas, nada', s !== null && s.conocidas.get('mala@tienda.es')?.nivel === 'mala' && s.conocidas.get('buena@tienda.es')?.nivel === 'buena' && !s.conocidas.has('nueva@tienda.es') && !s.conocidas.has('x@libertyseller.es'))
    ok('y NO pregunta nada al servicio (preguntar al teclear gastaría créditos en cada errata)', e.mv.llamadas().length === antes)
    ok('lleva la política de las dudosas', s?.dudosas === 'avisar')
    const apagada = await montar({ activa: false })
    ok('apagada: null (el cuadro no enseña nada de esto)', (await loQueSeSabeAntesDeEnviar(apagada.s, ['a@tienda.es'])) === null)
  }

  console.log('\n=== el motor, con seguimientos ya programados ===')
  {
    const e = await montar()
    e.mv.contestar('mala@tienda.es', MALA)
    e.mv.contestar('jefe@grande.com', DUDOSA)
    const motor = verificadorParaElMotor(e.s, { fetch: e.mv.fetch, ahora })
    ok('una buena: nada que decir', (await motor('ana@tienda.es')) === null)
    const mala = await motor('mala@tienda.es')
    ok('una mala: hay que parar, y dice por qué', mala !== null && mala.parar && mala.porQue === 'mala' && /no existe/.test(mala.motivo))
    const dudosa = await motor('jefe@grande.com')
    ok('una dudosa con «avisar»: se dice pero NO se para (la secuencia sigue)', dudosa !== null && !dudosa.parar && dudosa.porQue === 'dudosa')
    await guardarAjustes(e.s, { id: 'a' }, { dudosas: 'bloquear' })
    // la configuración del verificador se lee una vez por minuto: pasado ese rato, ve el cambio
    reloj = HOY + 90_000
    const dudosa2 = await motor('jefe@grande.com')
    ok('una dudosa con «no enviar»: se para (los seguimientos que ya había también respetan el ajuste)', dudosa2 !== null && dudosa2.parar)
    reloj = HOY

    // El tope de 5 llamadas por pasada
    const muchos = await montar()
    const m = verificadorParaElMotor(muchos.s, { fetch: muchos.mv.fetch, ahora, llamadasPorPasada: 5 })
    for (let i = 0; i < 8; i++) await m(`lead${i}@tienda.es`)
    ok('como mucho 5 llamadas al servicio por pasada (las demás esperan a la siguiente)', muchos.mv.llamadas().length === 5)

    // Un fallo: el seguimiento sigue
    const roto = await montar()
    roto.mv.contestarTodo('lanza')
    const r = verificadorParaElMotor(roto.s, { fetch: roto.mv.fetch, ahora })
    ok('si el servicio falla, no hay nada que decir (el seguimiento sale como siempre)', (await r('a@tienda.es')) === null)
    for (const d of ['b@tienda.es', 'c@tienda.es', 'd@tienda.es', 'e@tienda.es']) await r(d)
    ok('y no se insiste con las demás direcciones de la pasada: una sola llamada (si el servicio está caído, cada una esperaría hasta el límite)', roto.mv.llamadas().length === 1, `${roto.mv.llamadas().length} llamadas`)
    const apagada = await montar({ activa: false })
    ok('apagada: nada que decir y ninguna llamada', (await verificadorParaElMotor(apagada.s, { fetch: apagada.mv.fetch, ahora })('a@tienda.es')) === null && apagada.mv.llamadas().length === 0)
  }

  console.log('\n=== la prueba de un administrador y los números ===')
  {
    const e = await montar({ activa: false })
    const r = await comprobarUna(e.s, { id: 'admin' }, 'Prueba@Tienda.es', { fetch: e.mv.fetch, ahora })
    ok('se puede probar una dirección aunque esté apagada (sirve para ver que funciona antes de encender)', r.ok && r.resultado.tipo === 'veredicto' && r.direccion === 'prueba@tienda.es' && e.mv.llamadas().length === 1)
    ok('queda guardada como «prueba»', filas(e, 'correo_verificaciones')[0].origen === 'prueba' && filas(e, 'correo_verificaciones')[0].verificada_por === 'admin')
    const propia = await comprobarUna(e.s, { id: 'admin' }, 'yo@libertyseller.es', { fetch: e.mv.fetch, ahora })
    ok('y se puede probar una dirección propia', propia.ok && propia.resultado.tipo === 'veredicto')
    ok('una dirección mal escrita, error', !(await comprobarUna(e.s, { id: 'admin' }, 'sin-arroba', { fetch: e.mv.fetch })).ok && !(await comprobarUna(e.s, { id: 'admin' }, 42, { fetch: e.mv.fetch })).ok)
    const sinClave = await montar({ configurada: false })
    ok('sin clave, error', !(await comprobarUna(sinClave.s, { id: 'admin' }, 'a@tienda.es', { fetch: sinClave.mv.fetch })).ok)

    e.mv.contestar('mala1@tienda.es', MALA)
    await comprobarUna(e.s, { id: 'admin' }, 'mala1@tienda.es', { fetch: e.mv.fetch, ahora })
    e.mv.contestar('dudosa1@tienda.es', DUDOSA)
    await comprobarUna(e.s, { id: 'admin' }, 'dudosa1@tienda.es', { fetch: e.mv.fetch, ahora })
    const n = await contarComprobadas(e.s)
    ok('se cuentan las comprobadas de cada tipo y la última', n.buenas === 2 && n.dudosas === 1 && n.malas === 1 && n.ultima === HOY)
    e.base.ausentes.add('correo_verificaciones')
    ok('sin la tabla, ceros', (await contarComprobadas(e.s)).buenas === 0)

    // «Probar la clave» recupera de un fallo
    const f = await montar()
    f.mv.contestarTodo(ERROR('Insufficient credits'))
    await comprobarDirecciones(f.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: f.mv.fetch })
    ok('tras quedarse sin créditos, el fallo está apuntado', filas(f, 'correo_verificacion_ajustes')[0].error_causa === 'sin_creditos')
    f.mv.ponerCreditos(5000)
    const p = await probarClave(f.s, { fetch: f.mv.fetch }, reloj)
    const trasProbar = filas(f, 'correo_verificacion_ajustes')[0]
    ok('«Probar la clave» con créditos nuevos: apunta los créditos y quita el fallo', p.ok && p.creditos === 5000 && trasProbar.creditos === 5000 && trasProbar.error_causa === null)
    f.mv.contestarTodo(BUENA)
    const siguiente = await comprobarDirecciones(f.s, ['b@tienda.es'], { origen: 'primer_correo', ahora, fetch: f.mv.fetch })
    ok('y se quitan los frenos: la siguiente dirección ya se comprueba (sin esperar diez minutos)', nivelDe(siguiente.get('b@tienda.es')) === 'buena')
    ok('probar sin clave, error', !(await probarClave((await montar({ configurada: false })).s)).ok)
    const claveVieja = await montar()
    claveVieja.mv.contestarTodo(BUENA)
    const f2 = servicioFalso()
    const probarMal = await probarClave(claveVieja.s, { fetch: ((async () => new Response(JSON.stringify({ result: 'error', error: 'apikey_not_found' }))) as unknown as typeof fetch) })
    ok('probar una clave que el servicio ya no reconoce: error y queda apuntado', !probarMal.ok && filas(claveVieja, 'correo_verificacion_ajustes')[0].error_causa === 'clave' && f2.llamadas().length === 0)

    // Para la salud
    const s1 = await montar()
    ok('estado para la salud con todo bien: créditos y sin fallo', (await estadoParaLaSalud(s1.s))?.creditos === 10_500 && (await estadoParaLaSalud(s1.s))?.fallo === null)
    s1.mv.contestarTodo(ERROR('Insufficient credits'))
    await comprobarDirecciones(s1.s, ['a@tienda.es'], { origen: 'primer_correo', ahora, fetch: s1.mv.fetch })
    ok('…y con el fallo, que sale', (await estadoParaLaSalud(s1.s))?.fallo?.causa === 'sin_creditos')
    ok('apagada: nada que vigilar', (await estadoParaLaSalud((await montar({ activa: false })).s)) === null && (await estadoParaLaSalud((await montar({ configurada: false })).s)) === null)
    ok('el umbral de «quedan pocos» es de 500', CREDITOS_PARA_AVISAR === 500)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
