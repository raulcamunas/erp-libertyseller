import type { QuienPide } from '@/lib/correo/acceso'
import { nuevaBase } from '@/lib/correo/secuencias/cliente-falso'
import { ejecutarPasada } from '@/lib/correo/secuencias/motor'
import { B1, B2, HORA, MIN, T0, TEXTO_S1, UA, UB, UC, UD, crearMundo, type Entorno } from '@/lib/correo/secuencias/mundo-de-pruebas'
import { FALTA_LA_MIGRACION_245, accionSobreSecuencia, buzonesVisibles, colaDeSecuencias, detalleDeSecuencia, estadoParaElCuadro, guardarAjustesDeBuzon, guardarAjustesDelMotor, pantallaVisible, tablero } from '@/lib/correo/secuencias/servidor'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const entorno: Entorno = {
  async nuevo(reloj) {
    const { base, service } = nuevaBase(reloj)
    base.sembrar('correo_secuencias', { nombre: 'Prospección', es_base: true, activa: true, pasos: [{ orden: 1, dias: 3 }, { orden: 2, dias: 7 }] })
    base.sembrar('correo_secuencia_ajustes', { id: true, activa: false, modo_ensayo: true })
    return { service, soloEnMemoria: { ausentes: base.ausentes } }
  },
}

const quien = (userId: string, role = 'employee', extra: Partial<QuienPide> = {}): QuienPide => ({ userId, role, tienePermisoEquipo: false, tienePermisoCorreo: false, ...extra })
const ANA = quien(UA)
const ALE = quien(UB)
const RAUL = quien(UC, 'admin')
const JHANNA_CORREO = quien(UD, 'employee', { tienePermisoCorreo: true })
const JHANNA_EQUIPO = quien(UD, 'employee', { tienePermisoEquipo: true })
const JHANNA_NADA = quien(UD)

async function main() {
  console.log('\n=== quién ve qué buzón ===')
  {
    const m = await crearMundo(entorno)
    const ids = async (q: QuienPide) => (await buzonesVisibles(m.almacen, q)).map((b) => b.id).sort().join()
    ok('un comercial ve solo el suyo', (await ids(ANA)) === B1 && (await ids(ALE)) === B2)
    ok('un administrador los ve todos', (await ids(RAUL)) === [B1, B2].join())
    ok('«Supervisión del correo» los ve todos (no son de administradores)', (await ids(JHANNA_CORREO)) === [B1, B2].join())
    ok('«Supervisión del equipo comercial» ve los de los comerciales', (await ids(JHANNA_EQUIPO)) === [B1, B2].join())
    ok('sin permisos no ve ninguno', (await ids(JHANNA_NADA)) === '')
    await m.actualizar('profiles', { is_comercial: false }, (q) => q.eq('id', UB))
    ok('«equipo comercial» no ve el buzón de quien no es comercial', (await ids(JHANNA_EQUIPO)) === B1)
    await m.actualizar('profiles', { role: 'admin' }, (q) => q.eq('id', UB))
    ok('y «correo» no abre el de un administrador', (await ids(JHANNA_CORREO)) === B1)
    const v = (await buzonesVisibles(m.almacen, ANA))[0]
    ok('lleva el nombre del dueño y si es mío', v.propietario.nombre === 'Ana' && v.esMio)
  }

  console.log('\n=== el tablero ===')
  {
    const m = await crearMundo(entorno)
    m.ausentes?.add('correo_secuencia_ajustes')
    const sin = await tablero(m.almacen, RAUL, { ahora: T0 })
    ok('sin la migración lo dice con el nombre del fichero', !sin.disponible && sin.mensaje === FALTA_LA_MIGRACION_245 && /245_correo_secuencias\.sql/.test(sin.mensaje))
  }
  {
    const m = await crearMundo(entorno)
    const a1 = await m.secuenciaNueva(1)
    const a2 = await m.secuenciaNueva(2)
    const b1 = await m.secuenciaNueva(3, { buzon: B2 })
    if (!a1.resultado.ok || !a2.resultado.ok || !b1.resultado.ok) throw new Error('alta')
    // Ana ha mandado a mano 5 correos hoy
    for (let i = 0; i < 5; i++) await m.saliente({ para: `x${i}@y.es`, messageId: `mano-${i}@libertyseller.es`, cuando: T0 + i * MIN })
    const t = await tablero(m.almacen, ANA, { ahora: T0 + HORA })
    if (!t.disponible) throw new Error('no disponible')
    ok('Ana solo ve su buzón', t.buzones.length === 1 && t.buzones[0].id === B1 && t.hoy.carriles.length === 1)
    ok('con lo enviado a mano hoy (5 sueltos + los 2 primeros correos de sus secuencias) y el tope de la rampa', t.buzones[0].manualHoy === 7 && t.buzones[0].automaticosHoy === 0 && t.buzones[0].topeHoy === 150 && t.buzones[0].enviadosHoy === 7, JSON.stringify({ m: t.buzones[0].manualHoy, e: t.buzones[0].enviadosHoy }))
    ok('sus dos secuencias vivas', t.buzones[0].vivas === 2 && t.conteos.activa === 2)
    ok('no puede administrar', !t.puedeAdministrar)
    ok('los próximos días traen sus 4 seguimientos (2 el lunes 2 y 2 el viernes 6), no los de Alejandro', t.proximos.reduce((s, d) => s + d.total, 0) === 4, JSON.stringify(t.proximos.map((d) => `${d.dia}:${d.total}`)))
    ok('el rastro reciente es solo de lo suyo', t.actividad.length > 0 && t.actividad.every((x) => x.buzonId === B1))
    ok('los ajustes viajan para enseñarlos', t.ajustes.ventanaDesdeMin === 540 && t.ajustes.rampa.length === 4)
    ok('y la lectura de respuestas viaja vacía mientras nadie contesta', t.respuestas.total === 0 && t.respuestas.recientes.length === 0 && t.respuestas.pendientes === 0 && t.respuestas.dias === 30 && t.ajustes.respuestasIa)
    const r = await tablero(m.almacen, RAUL, { ahora: T0 + HORA })
    if (!r.disponible) throw new Error('no disponible')
    ok('un administrador ve los dos buzones y puede administrar', r.buzones.length === 2 && r.puedeAdministrar && r.proximos.reduce((s, d) => s + d.total, 0) === 6)
    const uno = await tablero(m.almacen, RAUL, { ahora: T0 + HORA, buzonId: B2 })
    ok('y puede quedarse con uno', uno.disponible && uno.buzones.length === 1 && uno.buzones[0].id === B2)
    const nada = await tablero(m.almacen, JHANNA_NADA, { ahora: T0 })
    ok('sin permisos no ve nada (pero no es un error)', nada.disponible && nada.buzones.length === 0 && nada.proximos.every((d) => d.total === 0))
  }

  console.log('\n=== lo que contestan los leads: en el tablero y en el detalle ===')
  {
    const NO = { clase: 'no_interesa' as const, confianza: 'alta' as const, evidencia: 'no nos interesa', resumen: 'No les interesa.', fecha: null }
    const MAS_TARDE = { clase: 'mas_tarde' as const, confianza: 'alta' as const, evidencia: 'escríbeme en enero', resumen: 'Pide que le escribamos en enero.', fecha: '2027-01-11' }
    const m = await crearMundo(entorno)
    const a = await m.secuenciaNueva(1)
    const b = await m.secuenciaNueva(2, { buzon: B2 })
    const c = await m.secuenciaNueva(3)
    if (!a.resultado.ok || !b.resultado.ok || !c.resultado.ok) throw new Error('alta')
    const antes = await tablero(m.almacen, RAUL, { ahora: T0 + HORA })
    ok('antes de que conteste nadie, todo a cero', antes.disponible && antes.respuestas.total === 0 && antes.respuestas.recientes.length === 0)

    // Ana: un «no» seguro. Alejandro: «escríbeme en enero»
    m.reloj.ahora = T0 + 2 * HORA
    m.clasificaciones.push(NO)
    await m.entrante({ de: a.email, hilo: a.hiloId, texto: 'Gracias, pero ahora mismo no nos interesa.', cuando: T0 + 2 * HORA - MIN })
    await ejecutarPasada(m.deps)
    m.reloj.ahora = T0 + 2 * HORA + 6 * MIN
    m.clasificaciones.push(MAS_TARDE)
    await m.entrante({ buzon: B2, de: b.email, hilo: b.hiloId, texto: 'Ahora no es buen momento. Escríbeme en enero.', cuando: T0 + 2 * HORA + 5 * MIN })
    await ejecutarPasada(m.deps)

    const deAna = await tablero(m.almacen, ANA, { ahora: m.reloj.ahora })
    if (!deAna.disponible) throw new Error('no disponible')
    ok('Ana ve solo la lectura de su respuesta, con el lead, la clase y lo que se hizo', deAna.respuestas.total === 1 && deAna.respuestas.porClase[0].clase === 'no_interesa' && deAna.respuestas.recientes.length === 1 && deAna.respuestas.recientes[0].lead === 'Tienda 1' && deAna.respuestas.recientes[0].propietario === 'Ana' && deAna.respuestas.recientes[0].accion === 'cerrar' && deAna.respuestas.recientes[0].aplicada, JSON.stringify(deAna.respuestas))
    const deAle = await tablero(m.almacen, ALE, { ahora: m.reloj.ahora })
    ok('Alejandro, la suya, con el día de la rellamada', deAle.disponible && deAle.respuestas.total === 1 && deAle.respuestas.recientes[0].clase === 'mas_tarde' && deAle.respuestas.recientes[0].fechaPedida === '2027-01-11' && deAle.respuestas.recientes[0].propietario === 'Alejandro', JSON.stringify(deAle.disponible && deAle.respuestas))
    const deRaul = await tablero(m.almacen, RAUL, { ahora: m.reloj.ahora })
    ok('un administrador ve las dos, la más reciente primero', deRaul.disponible && deRaul.respuestas.total === 2 && deRaul.respuestas.recientes.map((r) => r.clase).join() === 'mas_tarde,no_interesa')
    const unBuzon = await tablero(m.almacen, RAUL, { ahora: m.reloj.ahora, buzonId: B2 })
    ok('y si se queda con un buzón, solo cuenta ese', unBuzon.disponible && unBuzon.respuestas.total === 1)
    const nadie = await tablero(m.almacen, JHANNA_NADA, { ahora: m.reloj.ahora })
    ok('quien no ve ningún buzón no ve ninguna respuesta (una lista vacía no es «todos»)', nadie.disponible && nadie.respuestas.total === 0 && nadie.respuestas.recientes.length === 0)
    const antiguo = await tablero(m.almacen, RAUL, { ahora: m.reloj.ahora + 40 * 86_400_000 })
    ok('pasados 30 días ya no cuentan', antiguo.disponible && antiguo.respuestas.total === 0)

    const dA = await detalleDeSecuencia(m.almacen, ANA, a.resultado.inscripcionId)
    ok('el detalle de su secuencia trae lo que entendió la IA, con la frase en que se apoya', dA?.respuesta?.clase === 'no_interesa' && dA.respuesta.evidencia === 'no nos interesa' && dA.respuesta.lead === 'Tienda 1' && dA.respuesta.modo === 'real', JSON.stringify(dA?.respuesta))
    const dC = await detalleDeSecuencia(m.almacen, ANA, c.resultado.inscripcionId)
    ok('y el de una a la que nadie ha contestado, nada', !!dC && dC.respuesta === null)
    ok('Ana no abre la de Alejandro, así que tampoco ve su lectura', (await detalleDeSecuencia(m.almacen, ANA, b.resultado.inscripcionId)) === null)
  }
  {
    const m = await crearMundo(entorno)
    m.ausentes?.add('correo_respuestas_ia')
    const a = await m.secuenciaNueva(1)
    if (!a.resultado.ok) throw new Error('alta')
    const t = await tablero(m.almacen, RAUL, { ahora: T0 + HORA })
    const d = await detalleDeSecuencia(m.almacen, RAUL, a.resultado.inscripcionId)
    ok('sin la tabla de la migración 246, el tablero y el detalle siguen funcionando sin respuestas', t.disponible && t.respuestas.total === 0 && !!d && d.respuesta === null)
  }

  console.log('\n=== la salud en el tablero ===')
  {
    const m = await crearMundo(entorno)
    const ahora = T0 + 2 * HORA
    m.reloj.ahora = ahora
    await m.actualizar('correo_buzones', { ultimo_sync_at: m.iso(ahora - 2 * MIN) }, (q) => q.in('id', [B1, B2]))
    await m.sembrar('cron_ejecuciones', { tarea: 'correo-secuencias', iniciado_at: m.iso(ahora - 30_000), terminado_at: m.iso(ahora - 29_000), ok: true, duracion_ms: 900 })

    const admin = await tablero(m.almacen, RAUL, { ahora })
    if (!admin.disponible) throw new Error('no disponible')
    ok('con todo en orden, la salud lo dice', admin.salud.nivel === 'ok' && admin.salud.alarmas.length === 0 && admin.salud.resumen === 'Todo en orden', JSON.stringify(admin.salud.alarmas))
    ok('un administrador ve el motor con su última pasada y los dos buzones', admin.salud.motor?.modo === 'real' && admin.salud.motor.registroDisponible && admin.salud.motor.ultimaPasada?.ok === true && admin.salud.buzones.length === 2)
    const suyoDeAna = admin.salud.buzones.find((b) => b.buzonId === B1)
    const carrilDeAna = admin.buzones.find((b) => b.id === B1)
    ok('las cifras de hoy de cada buzón son las del tablero', suyoDeAna?.hoy?.tope === carrilDeAna?.topeHoy && suyoDeAna?.hoy?.enviados === carrilDeAna?.enviadosHoy && suyoDeAna?.vivas === carrilDeAna?.vivas)
    ok('y la rampa: el 1 de octubre al 28 de octubre es el día hábil 20 (tope 150)', suyoDeAna?.rampa.diaHabil === 20 && suyoDeAna.rampa.tope === 150, JSON.stringify(suyoDeAna?.rampa))

    const ana = await tablero(m.almacen, ANA, { ahora })
    if (!ana.disponible) throw new Error('no disponible')
    ok('Ana ve la salud de su buzón y nada del motor', ana.salud.motor === null && ana.salud.buzones.length === 1 && ana.salud.buzones[0].buzonId === B1)

    // La contraseña de Ana deja de valer
    await m.actualizar('correo_buzones', { credenciales_invalidas: true }, (q) => q.eq('id', B1))
    const conProblema = await tablero(m.almacen, RAUL, { ahora })
    const anaConProblema = await tablero(m.almacen, ANA, { ahora })
    const aleConProblema = await tablero(m.almacen, ALE, { ahora })
    if (!conProblema.disponible || !anaConProblema.disponible || !aleConProblema.disponible) throw new Error('no disponible')
    ok('Raúl ve «el buzón de Ana» en rojo y su tarjeta, la primera', conProblema.salud.nivel === 'problema' && conProblema.salud.alarmas[0]?.titulo === 'El buzón de Ana no se puede conectar' && conProblema.salud.buzones[0].buzonId === B1 && conProblema.salud.buzones[0].conexion.estado === 'contrasena', JSON.stringify(conProblema.salud.alarmas))
    ok('Ana lo ve dicho a ella: «tu buzón»', anaConProblema.salud.alarmas.length === 1 && anaConProblema.salud.alarmas[0].titulo === 'Tu buzón no se puede conectar')
    ok('y Alejandro no se entera de lo del buzón de Ana', aleConProblema.salud.alarmas.length === 0 && aleConProblema.salud.nivel === 'ok')

    // El motor deja de pasar
    await m.actualizar('cron_ejecuciones', { iniciado_at: m.iso(ahora - 25 * MIN) }, (q) => q.eq('tarea', 'correo-secuencias'))
    const parado = await tablero(m.almacen, RAUL, { ahora })
    const paradoParaAna = await tablero(m.almacen, ANA, { ahora })
    if (!parado.disponible || !paradoParaAna.disponible) throw new Error('no disponible')
    ok('el administrador ve el motor parado', parado.salud.motor?.parado === true && parado.salud.alarmas.some((a) => a.codigo === 'motor_parado'))
    ok('y la comercial no (es del sistema, no de su buzón)', !paradoParaAna.salud.alarmas.some((a) => a.codigo === 'motor_parado') && paradoParaAna.salud.motor === null)
  }
  {
    const m = await crearMundo(entorno)
    m.ausentes?.add('cron_ejecuciones')
    const t = await tablero(m.almacen, RAUL, { ahora: T0 + HORA })
    ok('sin el registro de procesos el tablero sigue funcionando y dice que no sabe si el motor corre', t.disponible && t.salud.motor?.registroDisponible === false && !t.salud.alarmas.some((a) => a.codigo === 'motor_parado'))
    const sinConexion = await crearMundo(entorno)
    await sinConexion.actualizar('correo_buzones', { fallos_seguidos: 7, ultimo_error: 'ETIMEDOUT' }, (q) => q.eq('id', B2))
    const t2 = await tablero(sinConexion.almacen, RAUL, { ahora: T0 + 5 * MIN })
    ok('siete fallos seguidos de conexión salen en la salud con el error', t2.disponible && t2.salud.alarmas.some((a) => a.codigo === 'fallando' && a.gravedad === 'roja' && a.detalle.includes('7 fallos seguidos') && a.detalle.includes('ETIMEDOUT')), t2.disponible ? JSON.stringify(t2.salud.alarmas) : '')
  }

  console.log('\n=== la cola ===')
  {
    const m = await crearMundo(entorno)
    for (let n = 1; n <= 5; n++) {
      const a = await m.secuenciaNueva(n)
      if (!a.resultado.ok) throw new Error('alta')
    }
    const b = await m.secuenciaNueva(6, { buzon: B2, email: 'otra@casaluz.es' })
    if (!b.resultado.ok) throw new Error('alta')
    // la 1 contesta (se para), la 2 se cancela a mano
    const todas = await m.leer('correo_secuencia_inscripciones', (q) => q.order('creada_at', { ascending: true }))
    await m.actualizar('correo_secuencia_inscripciones', { estado: 'respondida', codigo: 'respuesta' }, (q) => q.eq('id', todas[0].id))
    await m.actualizar('correo_secuencia_inscripciones', { estado: 'cancelada', codigo: 'cancelada_por_persona' }, (q) => q.eq('id', todas[1].id))

    const vivas = await colaDeSecuencias(m.almacen, ANA, { grupo: 'vivas' })
    ok('Ana ve sus 3 vivas, no la de Alejandro', vivas.total === 3 && vivas.items.every((i) => i.buzonId === B1 && i.propio))
    ok('las vivas, por lo que antes sale', vivas.items.every((i, k) => k === 0 || (vivas.items[k - 1].siguiente?.en ?? Infinity) <= (i.siguiente?.en ?? Infinity)))
    const terminadas = await colaDeSecuencias(m.almacen, ANA, { grupo: 'terminadas' })
    ok('y 2 terminadas', terminadas.total === 2 && terminadas.items.map((i) => i.estado).sort().join() === 'cancelada,respondida')
    const todasLasDeAna = await colaDeSecuencias(m.almacen, ANA, { grupo: 'todas' })
    ok('todas: 5', todasLasDeAna.total === 5)
    const admin = await colaDeSecuencias(m.almacen, RAUL, { grupo: 'todas' })
    ok('un administrador ve las 6, con el nombre del dueño', admin.total === 6 && admin.items.some((i) => i.propietario === 'Alejandro') && admin.items.some((i) => i.propietario === 'Ana'))
    const pagina = await colaDeSecuencias(m.almacen, RAUL, { grupo: 'todas', limite: 4, pagina: 1 })
    ok('paginada: la segunda página de 4 trae las 2 que faltan', pagina.items.length === 2 && pagina.total === 6)
    const nombre = await colaDeSecuencias(m.almacen, ANA, { grupo: 'todas', q: 'Tienda 3' })
    ok('se busca por el nombre del lead', nombre.total === 1 && nombre.items[0].lead.nombre === 'Tienda 3')
    const dir = await colaDeSecuencias(m.almacen, RAUL, { grupo: 'todas', q: 'casaluz' })
    ok('y por la dirección', dir.total === 1 && dir.items[0].destinatario === 'otra@casaluz.es')
    const ajena = await colaDeSecuencias(m.almacen, ANA, { grupo: 'todas', q: 'casaluz' })
    ok('pero no se puede buscar lo de otro buzón', ajena.total === 0)
    const sinPermisos = await colaDeSecuencias(m.almacen, JHANNA_NADA, { grupo: 'todas' })
    ok('sin permisos, nada', sinPermisos.total === 0 && sinPermisos.items.length === 0)
    ok('cada elemento trae su línea de tiempo: 3 correos y el progreso', vivas.items[0].pasos.length === 3 && Math.abs(vivas.items[0].progreso - 1 / 3) < 1e-9)
  }

  console.log('\n=== el detalle y las acciones ===')
  {
    const m = await crearMundo(entorno)
    const a = await m.secuenciaNueva(1)
    const b = await m.secuenciaNueva(2, { buzon: B2 })
    if (!a.resultado.ok || !b.resultado.ok) throw new Error('alta')
    const [deAna, deAle] = (await m.leer('correo_secuencia_inscripciones', (q) => q.order('creada_at', { ascending: true }))).map((x) => x.id as string)
    const pasoDeAna = (await m.pasos(deAna))[1].id as string

    const d = await detalleDeSecuencia(m.almacen, ANA, deAna)
    ok('Ana abre la suya, con los textos y el rastro', !!d && d.pasos.length === 3 && d.pasos[1].texto === TEXTO_S1 && d.eventos.length > 0 && d.permisos.puedeAdministrar && d.permisos.puedeEditar)
    ok('pero no la de Alejandro (como si no existiera)', (await detalleDeSecuencia(m.almacen, ANA, deAle)) === null && (await detalleDeSecuencia(m.almacen, ANA, 'no-existe')) === null)
    const dAdmin = await detalleDeSecuencia(m.almacen, RAUL, deAna)
    ok('un administrador la ve y puede administrar, pero no editar el texto', !!dAdmin && dAdmin.permisos.puedeAdministrar && !dAdmin.permisos.puedeEditar)
    const dSuper = await detalleDeSecuencia(m.almacen, JHANNA_CORREO, deAna)
    ok('quien supervisa la ve pero no puede hacer nada', !!dSuper && !dSuper.permisos.puedeAdministrar && !dSuper.permisos.puedeEditar)

    ok('Alejandro no puede ni pausar la de Ana (no la ve: 404)', (await accionSobreSecuencia(m.almacen, ALE, deAna, { accion: 'pausar' }, m.deps.ahora)).estado === 404)
    const porSuper = await accionSobreSecuencia(m.almacen, JHANNA_CORREO, deAna, { accion: 'pausar' }, m.deps.ahora)
    ok('quien solo supervisa la ve pero no pausa (403)', !porSuper.ok && porSuper.estado === 403)
    const editaAdmin = await accionSobreSecuencia(m.almacen, RAUL, deAna, { accion: 'editar', pasoId: pasoDeAna, texto: 'Hola, texto nuevo escrito por el administrador para ver qué pasa con los permisos. Un saludo,' }, m.deps.ahora)
    ok('un administrador NO edita el texto de otra persona (saldría con su nombre)', !editaAdmin.ok && editaAdmin.estado === 403 && (await m.pasos(deAna))[1].texto === TEXTO_S1)
    const pausaAdmin = await accionSobreSecuencia(m.almacen, RAUL, deAna, { accion: 'pausar' }, m.deps.ahora)
    ok('pero sí puede pausarla', pausaAdmin.ok && (await m.almacen.inscripcion(deAna))?.estado === 'pausada')
    const reanudaAna = await accionSobreSecuencia(m.almacen, ANA, deAna, { accion: 'reanudar' }, m.deps.ahora)
    ok('y su dueña reanudarla', reanudaAna.ok && (await m.almacen.inscripcion(deAna))?.estado === 'activa')
    const nuevoTexto = 'Hola,\n\nQuería retomar lo que te comenté: si te encaja, miramos juntos cómo se vería vuestro catálogo en Amazon en una videollamada corta de diez minutos.\n\nUn saludo,'
    const editaAna = await accionSobreSecuencia(m.almacen, ANA, deAna, { accion: 'editar', pasoId: pasoDeAna, texto: nuevoTexto }, m.deps.ahora)
    ok('Ana edita su texto', editaAna.ok && (await m.pasos(deAna))[1].texto === nuevoTexto)
    const ajeno = await accionSobreSecuencia(m.almacen, ANA, deAna, { accion: 'saltar', pasoId: (await m.pasos(deAle))[1].id as string }, m.deps.ahora)
    ok('un paso que no es de esa secuencia no existe', !ajeno.ok && ajeno.estado === 404)
    const salta = await accionSobreSecuencia(m.almacen, ANA, deAna, { accion: 'saltar', pasoId: pasoDeAna }, m.deps.ahora)
    ok('saltar un seguimiento', salta.ok && (await m.pasos(deAna))[1].estado === 'saltado')
    const cancela = await accionSobreSecuencia(m.almacen, ANA, deAna, { accion: 'cancelar' }, m.deps.ahora)
    ok('cancelar', cancela.ok && (await m.almacen.inscripcion(deAna))?.estado === 'cancelada')
    const otra = await accionSobreSecuencia(m.almacen, ANA, deAna, { accion: 'pausar' }, m.deps.ahora)
    ok('una terminada no admite más acciones (y lo explica)', !otra.ok && otra.estado === 409 && /terminado/.test(otra.mensaje))
  }

  console.log('\n=== los ajustes ===')
  {
    const m = await crearMundo(entorno, { activa: false, ensayo: true })
    const ahora = m.deps.ahora
    const noAdmin = await guardarAjustesDelMotor(m.almacen, ANA, { topeHora: 10 }, ahora)
    ok('solo un administrador cambia los ajustes', !noAdmin.ok && noAdmin.estado === 403 && (await m.almacen.leerAjustes())?.ajustes.topeHora === 25)
    const malo = await guardarAjustesDelMotor(m.almacen, RAUL, { topeHora: 9999 }, ahora)
    ok('un valor fuera de rango se rechaza con 400', !malo.ok && malo.estado === 400)
    const bien = await guardarAjustesDelMotor(m.almacen, RAUL, { topeHora: 10, activa: true }, ahora)
    ok('un administrador guarda; encender en ensayo no pide confirmar', bien.ok && (await m.almacen.leerAjustes())?.ajustes.topeHora === 10 && (await m.almacen.leerAjustes())?.ajustes.activa === true)
    const real = await guardarAjustesDelMotor(m.almacen, RAUL, { modoEnsayo: false }, ahora)
    ok('pasar a envío real sin confirmar se rechaza', !real.ok && real.estado === 400 && /confirmarlo/.test(real.mensaje) && (await m.almacen.leerAjustes())?.ajustes.modoEnsayo === true)
    const confirmado = await guardarAjustesDelMotor(m.almacen, RAUL, { modoEnsayo: false, confirmarEnvioReal: true }, ahora)
    ok('confirmado, pasa; y se anota quién lo hizo', confirmado.ok && (await m.almacen.leerAjustes())?.ajustes.modoEnsayo === false && (await m.uno('correo_secuencia_ajustes', (q) => q.eq('id', true)))?.actualizada_por === UC)

    const pausa = await guardarAjustesDeBuzon(m.almacen, RAUL, B1, { pausarHastaMañana: true }, ahora)
    const buzon = await m.uno('correo_secuencia_buzones', (q) => q.eq('buzon_id', B1))
    ok('un administrador pausa un buzón hasta el siguiente día hábil, con motivo y rastro', pausa.ok && buzon?.pausado_hasta !== null && String(buzon?.motivo_pausa).includes('administrador') && (await m.leer('correo_secuencia_eventos', (q) => q.eq('tipo', 'freno'))).length === 1)
    const quita = await guardarAjustesDeBuzon(m.almacen, RAUL, B1, { quitarPausa: true }, ahora)
    ok('y se la quita', quita.ok && (await m.uno('correo_secuencia_buzones', (q) => q.eq('buzon_id', B1)))?.pausado_hasta === null)
    const tope = await guardarAjustesDeBuzon(m.almacen, RAUL, B1, { topeDiario: 60, llamadasHastaMin: 900 }, ahora)
    ok('tope fijo y horas de llamadas', tope.ok && (await m.uno('correo_secuencia_buzones', (q) => q.eq('buzon_id', B1)))?.tope_diario === 60)
    ok('Ana no toca los ajustes de su buzón', !(await guardarAjustesDeBuzon(m.almacen, ANA, B1, { topeDiario: 500 }, ahora)).ok)
    const sinBuzon = await guardarAjustesDeBuzon(m.almacen, RAUL, '00000000-0000-4000-8000-0000000000ff', { participa: false }, ahora)
    ok('un buzón que no existe', !sinBuzon.ok && sinBuzon.estado === 404)
    // si deja de participar y vuelve, recoge lo que se quedó sin hora
    await guardarAjustesDeBuzon(m.almacen, RAUL, B1, { participa: false }, ahora)
    const alta = await m.secuenciaNueva(1)
    ok('con el buzón fuera, el alta se rechaza', !alta.resultado.ok && alta.resultado.motivo === 'buzon_no_participa')
  }

  console.log('\n=== lo que ve el cuadro de Correo ===')
  {
    const apagado = await crearMundo(entorno, { activa: false, ensayo: true })
    const e1 = await estadoParaElCuadro(apagado.almacen, ANA, B1, T0)
    ok('con el motor apagado, la función es INVISIBLE para el equipo', !e1.disponible && e1.mensaje === null)
    const e2 = await estadoParaElCuadro(apagado.almacen, RAUL, B1, T0)
    ok('(un administrador sí la ve, para poder probar… pero solo en un buzón suyo: Raúl no tiene)', !e2.disponible)
    await apagado.actualizar('correo_buzones', { user_id: UC }, (q) => q.eq('id', B2))
    const e3 = await estadoParaElCuadro(apagado.almacen, RAUL, B2, T0)
    ok('en su propio buzón, un administrador la ve con el aviso de que está apagado', e3.disponible && /apagado/.test(e3.mensaje ?? '') && !e3.activa)
    ok('el botón «Secuencias» de Correo: un administrador lo ve aunque el motor esté apagado', await pantallaVisible(apagado.almacen, RAUL))
    ok('(y el equipo no, con el motor apagado)', !(await pantallaVisible(apagado.almacen, ANA)))

    const ensayo = await crearMundo(entorno, { activa: true, ensayo: true })
    const e4 = await estadoParaElCuadro(ensayo.almacen, ANA, B1, T0)
    ok('en ensayo, todos la ven, con el aviso de que todavía no sale nada', e4.disponible && e4.ensayo && /pruebas/.test(e4.mensaje ?? ''))
    ok('con los días de cada seguimiento y la fecha aproximada (3 y 7 días hábiles desde el miércoles 28)', e4.pasos.map((p) => `${p.dias}:${p.diaAprox}`).join() === '3:2026-11-02,7:2026-11-06', JSON.stringify(e4.pasos))
    ok('y el tope de hoy', e4.topeHoy === 150 && e4.enviadosHoy === 0)
    ok('con el motor en ensayo, el botón «Secuencias» lo ve también el equipo', await pantallaVisible(ensayo.almacen, ANA))

    const real = await crearMundo(entorno, { activa: true, ensayo: false })
    const e5 = await estadoParaElCuadro(real.almacen, ANA, B1, T0)
    ok('con el envío real encendido no hay ningún aviso', e5.disponible && e5.mensaje === null)
    ok('el cuadro sabe a los cuántos días hábiles pasa solo a «No interesa»', e5.diasHastaNoInteresa === 7)
    ok('y que, con el ajuste apagado, los textos que se ven son los que saldrán', e5.disponible && e5.redactaAlEnviar === false)
    const redactor = await crearMundo(entorno, { activa: true, ensayo: false, redactar: true })
    const e5b = await estadoParaElCuadro(redactor.almacen, ANA, B1, T0)
    ok('con «escribir al enviar» encendido, el cuadro avisa de que esos textos son un borrador', e5b.disponible && e5b.redactaAlEnviar === true)
    ok('el buzón de otra persona no es tuyo', !(await estadoParaElCuadro(real.almacen, ANA, B2, T0)).disponible)
    await real.actualizar('correo_secuencia_buzones', { participa: false }, (q) => q.eq('buzon_id', B1))
    const e6 = await estadoParaElCuadro(real.almacen, ANA, B1, T0)
    ok('si el buzón no participa, se explica', !e6.disponible && /no participa/.test(e6.mensaje ?? ''))
  }

  console.log('\n=== una pasada a mano ===')
  {
    const m = await crearMundo(entorno)
    const a = await m.secuenciaNueva(1)
    if (!a.resultado.ok) throw new Error('alta')
    m.reloj.ahora = a.resultado.pasos[0].programadoAt! + 5_000
    const r = await ejecutarPasada(m.deps)
    ok('una pasada normal envía', r.enviados === 1)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
