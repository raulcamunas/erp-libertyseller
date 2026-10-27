import { sumarDias } from '@/lib/rendimiento/dia'
import { B_ANA, B_MAOLI, B_RAUL, H_ANA, H_PROPUESTA, H_RAUL, M_ANA, M_AUTO, M_A_MANO, M_RAUL, M_RESPUESTA, M_VIEJO, MAOLI, RAUL, crearDatos, fallaCon, usar, uuid } from './datos-de-pruebas'
import {
  CARACTERES_POR_CORREO,
  correoHilo,
  correoHilos,
  correosEnviados,
  dejarRastro,
  esAutomatico,
  filtrarEnviados,
  listaDeCorreos,
  nombreEnElRastro,
  olvidarAccesosRecientes,
  personaDeCorreo,
  resumenDeEnviados,
  tarjetaDeEnviado,
  tarjetaDeHilo,
  tarjetaDeMensaje,
  type BuzonDelEquipo,
  type HiloLeido,
  type MensajeEnviadoLeido,
  type MensajeLeido,
} from './correos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const accesos = (d: ReturnType<typeof crearDatos>) => d.base.tablas.get('correo_accesos') as Array<Record<string, any>>

async function main() {
  console.log('\n=== direcciones y nombres ===')
  {
    ok('nombre y dirección', personaDeCorreo({ nombre: 'Ana López', direccion: 'ana@x.es' }) === 'Ana López <ana@x.es>')
    ok('solo dirección, o solo nombre', personaDeCorreo({ nombre: '', direccion: 'ana@x.es' }) === 'ana@x.es' && personaDeCorreo({ nombre: 'Ana', direccion: null }) === 'Ana')
    ok('nada', personaDeCorreo(null) === '' && personaDeCorreo(undefined) === '')
    ok('una lista; lo que no es una lista, vacío; lo roto se quita', listaDeCorreos([{ nombre: 'A', direccion: 'a@x.es' }, null, {}]).join() === 'A <a@x.es>' && listaDeCorreos('x').length === 0 && listaDeCorreos(null).length === 0)
    ok('en el rastro consta que miró Claude', nombreEnElRastro('Raúl Camuñas') === 'Raúl Camuñas (vía el conector de Claude)')
    ok('y el nombre se corta a 200', nombreEnElRastro('x'.repeat(500)).length === 200)
  }

  console.log('\n=== los enviados: origen, totales y tarjeta ===')
  {
    const buzones = new Map<string, BuzonDelEquipo>([[B_MAOLI, { id: B_MAOLI, user_id: MAOLI, direccion: 'maoli@libertyseller.es', nombre: null, propietario: { id: MAOLI, nombre: 'Maoli Pérez' } }]])
    const m = (id: string, mid: string | null, fecha: string): MensajeEnviadoLeido => ({ id, buzon_id: B_MAOLI, hilo_id: 'h', message_id: mid, de_nombre: null, de_direccion: 'maoli@libertyseller.es', para: [{ nombre: 'C', direccion: 'c@x.es' }], cc: [], asunto: 'Asunto', fecha, vista_previa: 'Vista', adjuntos: [{ nombre: 'a.pdf', tamano: 100 }] })
    const mensajes = [m('1', 'auto-1', '2026-10-25T10:00:00.000Z'), m('2', 'mano-1', '2026-10-26T10:00:00.000Z'), m('3', null, '2026-10-26T11:00:00.000Z')]
    const automaticos = new Set(['auto-1'])
    ok('automático = su message_id salió de un paso de secuencia', esAutomatico(mensajes[0], automaticos) && !esAutomatico(mensajes[1], automaticos) && !esAutomatico(mensajes[2], automaticos))
    ok('todos, del más reciente al más antiguo', filtrarEnviados({ mensajes, automaticos, origen: 'todos' }).map((x) => x.id).join() === '3,2,1')
    ok('solo automáticos', filtrarEnviados({ mensajes, automaticos, origen: 'automaticos' }).map((x) => x.id).join() === '1')
    ok('solo a mano (también el que no tiene message_id)', filtrarEnviados({ mensajes, automaticos, origen: 'a_mano' }).map((x) => x.id).join() === '3,2')
    const r = resumenDeEnviados(mensajes, { buzones, automaticos }) as any
    ok('totales por buzón y por día', r.total === 3 && r.por_buzon[0].enviados === 3 && r.por_buzon[0].seguimientos_automaticos === 1 && r.por_buzon[0].a_mano === 2 && r.por_dia.length === 2 && r.por_dia[0].dia < r.por_dia[1].dia)
    const t = tarjetaDeEnviado(mensajes[0], { buzones, automaticos, hilosConRespuesta: new Set(['h']) }) as any
    ok('la tarjeta: tipo, destinatario, hilo con respuesta y adjuntos', t.tipo === 'seguimiento automático' && t.para[0] === 'C <c@x.es>' && t.el_hilo_tiene_respuesta === true && t.adjuntos[0].kb === 1 && t.hilo_id === 'h' && t.mensaje_id === '1')
    ok('un buzón que ya no está se dice', (tarjetaDeEnviado(mensajes[0], { buzones: new Map(), automaticos, hilosConRespuesta: new Set() }) as any).desde === 'Un buzón que ya no está')
  }

  console.log('\n=== las conversaciones y los mensajes: tarjetas ===')
  {
    const buzones = new Map<string, BuzonDelEquipo>([[B_MAOLI, { id: B_MAOLI, user_id: MAOLI, direccion: 'maoli@libertyseller.es', nombre: null, propietario: { id: MAOLI, nombre: 'Maoli Pérez' } }]])
    const h: HiloLeido = { id: 'h', buzon_id: B_MAOLI, asunto: '', contraparte: '', contraparte_direccion: 'c@x.es', mensajes: 2, entrantes: 1, salientes: 1, no_leidos: 0, tiene_adjuntos: false, vista_previa: 'Hola', primer_mensaje_at: '2026-10-26T10:00:00.000Z', ultimo_mensaje_at: '2026-10-26T11:00:00.000Z', ultimo_es_entrante: true, automatico: false }
    const t = tarjetaDeHilo(h, buzones) as any
    ok('un hilo sin asunto ni nombre no rompe', t.asunto === '(sin asunto)' && t.con === 'c@x.es' && t.el_ultimo_es_del_otro === true && t.ultimo_mensaje === '2026-10-26 12:00')
    const msg: MensajeLeido = { id: 'm', buzon_id: B_MAOLI, direccion: 'entrante', de_nombre: 'Carlos', de_direccion: 'c@x.es', para: [], cc: [], asunto: 'A', fecha: '2026-10-26T10:00:00.000Z', texto: 'x'.repeat(5000), automatico: false, adjuntos: [] }
    const c = tarjetaDeMensaje(msg, 1000) as any
    ok('un mensaje largo se recorta y dice cuántos caracteres había', c.texto.length === 1000 && /1000 de 5000/.test(c.texto_recortado) && c.sentido === 'recibido' && c.de === 'Carlos <c@x.es>')
    ok('uno corto, entero y sin aviso; sin adjuntos, null', (tarjetaDeMensaje({ ...msg, texto: 'Hola' }, 1000) as any).texto_recortado === null && c.adjuntos === null)
    ok('un mensaje vacío lo dice', (tarjetaDeMensaje({ ...msg, texto: '' }, 1000) as any).texto === '(sin texto)')
  }

  console.log('\n=== el rastro de quien mira un buzón ajeno ===')
  {
    olvidarAccesosRecientes()
    const d = crearDatos()
    await dejarRastro(d.base.servicio, { usuarioId: RAUL, nombre: 'Raúl Camuñas', buzones: [{ id: B_MAOLI, user_id: MAOLI }, { id: B_RAUL, user_id: RAUL }], accion: 'lista' })
    ok('deja una fila por buzón AJENO (el suyo no)', accesos(d).length === 1 && accesos(d)[0].buzon_id === B_MAOLI && accesos(d)[0].usuario_id === RAUL)
    ok('con su nombre y que fue por el conector', accesos(d)[0].usuario_nombre === 'Raúl Camuñas (vía el conector de Claude)' && accesos(d)[0].accion === 'lista')
    await dejarRastro(d.base.servicio, { usuarioId: RAUL, nombre: 'Raúl Camuñas', buzones: [{ id: B_MAOLI, user_id: MAOLI }], accion: 'lista' })
    ok('mirar lo mismo otra vez enseguida no repite la fila', accesos(d).length === 1)
    await dejarRastro(d.base.servicio, { usuarioId: RAUL, nombre: 'Raúl Camuñas', buzones: [{ id: B_MAOLI, user_id: MAOLI }], accion: 'hilo', hilo: { id: H_PROPUESTA, asunto: 'Propuesta' } })
    ok('pero otra acción u otro hilo sí', accesos(d).length === 2 && accesos(d)[1].hilo_id === H_PROPUESTA && accesos(d)[1].asunto === 'Propuesta')
    await dejarRastro(d.base.servicio, { usuarioId: RAUL, nombre: 'Raúl Camuñas', buzones: [{ id: B_MAOLI, user_id: MAOLI }], accion: 'lista', ahora: Date.now() + 31 * 60_000 })
    ok('pasados 30 minutos, otra vez', accesos(d).length === 3)
    olvidarAccesosRecientes()
    const roto = crearDatos()
    roto.base.errores.set('correo_accesos', { code: 'XX000', message: 'boom' })
    let error = ''
    try {
      await dejarRastro(roto.base.servicio, { usuarioId: RAUL, nombre: 'Raúl', buzones: [{ id: B_MAOLI, user_id: MAOLI }], accion: 'lista' })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    ok('si no se puede apuntar, LANZA (no se enseña sin rastro) y sin volcar el error de la base', /constancia/.test(error) && !/boom/.test(error))
    olvidarAccesosRecientes()
    const sinTabla = crearDatos({ sinTablas: ['correo_accesos'] })
    let faltaMigracion = ''
    try {
      await dejarRastro(sinTabla.base.servicio, { usuarioId: RAUL, nombre: 'Raúl', buzones: [{ id: B_MAOLI, user_id: MAOLI }], accion: 'lista' })
    } catch (e) {
      faltaMigracion = e instanceof Error ? e.message : String(e)
    }
    ok('sin la tabla del rastro, dice que falta la migración 236', /migración 236/.test(faltaMigracion))
  }

  console.log('\n=== correos_enviados ===')
  {
    olvidarAccesosRecientes()
    const d = crearDatos()
    const r = await usar(correosEnviados, d.ctx)
    ok('sin fechas: los últimos 3 días, solo lo enviado (4 correos; ni el recibido ni el de hace 40 días)', r.total === 4 && r.correos.length === 4 && !r.correos.some((c: any) => c.mensaje_id === M_RESPUESTA || c.mensaje_id === M_VIEJO))
    ok('totales por buzón: Maoli 2 (1 automático, 1 a mano), Ana 1, Raúl 1', r.resumen.total === 4 && r.resumen.por_buzon[0].buzon.startsWith('Maoli') && r.resumen.por_buzon[0].enviados === 2 && r.resumen.por_buzon[0].seguimientos_automaticos === 1 && r.resumen.por_buzon[0].a_mano === 1)
    ok('por día', r.resumen.por_dia.length >= 1 && r.resumen.por_dia.reduce((s: number, x: any) => s + x.enviados, 0) === 4)
    const auto = r.correos.find((c: any) => c.mensaje_id === M_AUTO)
    ok('el automático lo dice, y su hilo ya tiene respuesta', auto.tipo === 'seguimiento automático' && auto.el_hilo_tiene_respuesta === true && auto.hilo_id === H_PROPUESTA)
    ok('el que escribió la persona, a mano; el de Ana, sin respuesta', r.correos.find((c: any) => c.mensaje_id === M_A_MANO).tipo === 'a mano' && r.correos.find((c: any) => c.mensaje_id === M_ANA).el_hilo_tiene_respuesta === false)
    ok('la tarjeta: de quién, a quién, asunto y adelanto', auto.desde === 'Maoli Pérez (maoli@libertyseller.es)' && auto.para[0] === 'Carlos Sol <info@lamparassol.es>' && auto.asunto === 'Propuesta para Lámparas Sol' && /propuesta/.test(auto.adelanto))
    ok('dejó rastro de los dos buzones ajenos y de ninguno más', accesos(d).length === 2 && accesos(d).every((x) => x.accion === 'lista' && x.buzon_id !== B_RAUL) && accesos(d).some((x) => x.buzon_id === B_MAOLI) && accesos(d).some((x) => x.buzon_id === B_ANA))

    ok('solo automáticos', (await usar(correosEnviados, d.ctx, { origen: 'automaticos' })).total === 1)
    ok('solo a mano', (await usar(correosEnviados, d.ctx, { origen: 'a_mano' })).total === 3)
    olvidarAccesosRecientes()
    const maoli = crearDatos()
    const m = await usar(correosEnviados, maoli.ctx, { buzon: 'maoli' })
    ok('un buzón por su dueño', m.total === 2 && accesos(maoli).length === 1 && accesos(maoli)[0].buzon_id === B_MAOLI)
    ok('el filtro del buzón se dice', m.filtro.buzon === 'Maoli Pérez (maoli@libertyseller.es)')
    ok('por texto en el asunto', (await usar(correosEnviados, maoli.ctx, { texto: 'Catálogo' })).total === 1)
    ok('por texto en el destinatario', (await usar(correosEnviados, maoli.ctx, { texto: 'zapatosnorte' })).correos[0].mensaje_id === M_ANA)
    ok('un texto con comas y paréntesis no rompe el filtro', (await usar(correosEnviados, maoli.ctx, { texto: 'a), (asunto.eq.x' })).total === 0)
    const viejo = await usar(correosEnviados, maoli.ctx, { desde: sumarDias(maoli.hoy, -41), hasta: sumarDias(maoli.hoy, -39) })
    ok('con fechas se llega al de hace 40 días', viejo.total === 1 && viejo.correos[0].mensaje_id === M_VIEJO)
    const pagina = await usar(correosEnviados, maoli.ctx, { limite: 3 })
    const siguiente = await usar(correosEnviados, maoli.ctx, { limite: 3, pagina: 1 })
    ok('paginación con el total real', pagina.correos.length === 3 && pagina.hay_mas && siguiente.correos.length === 1 && !siguiente.hay_mas && pagina.total === 4)
    ok('más de 31 días, error que dice el máximo', /31/.test((await fallaCon(correosEnviados, maoli.ctx, { desde: sumarDias(maoli.hoy, -90) })) ?? ''))
    ok('un buzón que no existe: el error lista los que hay', /maoli@libertyseller\.es/.test((await fallaCon(correosEnviados, maoli.ctx, { buzon: 'pepito' })) ?? ''))
    ok('un origen inválido, error', /automaticos/.test((await fallaCon(correosEnviados, maoli.ctx, { origen: 'xx' })) ?? ''))

    olvidarAccesosRecientes()
    const roto = crearDatos()
    roto.base.errores.set('correo_accesos', { code: 'XX000', message: 'boom' })
    ok('si el rastro falla, NO enseña nada de los demás buzones', /constancia/.test((await fallaCon(correosEnviados, roto.ctx, { buzon: 'ana' })) ?? '') && !roto.base.peticiones.includes('correo_mensajes.select'))
    ok('pero su propio buzón lo lee sin rastro', (await usar(correosEnviados, roto.ctx, { buzon: 'raul' })).total === 1)

    const vacio = crearDatos({ tablas: { correo_buzones: [] } })
    ok('sin buzones conectados, lo dice', /No hay ningún buzón/.test((await usar(correosEnviados, vacio.ctx)).aviso))
    const sin = crearDatos({ sinTablas: ['correo_buzones'] })
    ok('sin la migración 236, dice cuál falta', /236/.test((await fallaCon(correosEnviados, sin.ctx)) ?? ''))
    const sin245 = crearDatos({ sinTablas: ['correo_secuencia_pasos'] })
    olvidarAccesosRecientes()
    const todoAMano = await usar(correosEnviados, sin245.ctx)
    ok('sin la 245 (secuencias) no hay automáticos: todo fue a mano', todoAMano.total === 4 && todoAMano.correos.every((c: any) => c.tipo === 'a mano'))
  }

  console.log('\n=== correo_hilos ===')
  {
    olvidarAccesosRecientes()
    const d = crearDatos()
    const r = await usar(correoHilos, d.ctx)
    ok('sin fechas: los últimos 14 días, los tres hilos, el último mensaje primero', r.total === 3 && r.hilos.map((h: any) => h.hilo_id).join() === [H_PROPUESTA, H_ANA, H_RAUL].join())
    const h = r.hilos[0]
    ok('la tarjeta: buzón, asunto, con quién, cuántos y de quién es el último', h.buzon === 'Maoli Pérez (maoli@libertyseller.es)' && h.asunto === 'Propuesta para Lámparas Sol' && h.con === 'Carlos Sol <info@lamparassol.es>' && h.mensajes === 3 && h.enviados === 2 && h.recibidos === 1 && h.sin_leer === 1 && h.el_ultimo_es_del_otro === true)
    ok('rastro de los dos buzones ajenos', accesos(d).length === 2)
    ok('esperando respuesta nuestra', (await usar(correoHilos, d.ctx, { estado: 'esperando_respuesta_nuestra' })).hilos.map((x: any) => x.hilo_id).join() === H_PROPUESTA)
    ok('con respuesta', (await usar(correoHilos, d.ctx, { estado: 'con_respuesta' })).total === 1)
    ok('sin respuesta', (await usar(correoHilos, d.ctx, { estado: 'sin_respuesta' })).total === 2)
    ok('sin leer', (await usar(correoHilos, d.ctx, { estado: 'sin_leer' })).hilos[0].hilo_id === H_PROPUESTA)
    ok('por texto (la otra persona)', (await usar(correoHilos, d.ctx, { texto: 'zapatos' })).hilos[0].hilo_id === H_ANA)
    ok('por buzón', (await usar(correoHilos, d.ctx, { buzon: 'ana' })).total === 1)
    ok('un estado inválido, error', /esperando_respuesta_nuestra/.test((await fallaCon(correoHilos, d.ctx, { estado: 'xx' })) ?? ''))
    const p = await usar(correoHilos, d.ctx, { limite: 2 })
    ok('paginación', p.hilos.length === 2 && p.hay_mas && p.total === 3)
    ok('más de 92 días, error', /92/.test((await fallaCon(correoHilos, d.ctx, { desde: sumarDias(d.hoy, -200) })) ?? ''))
    olvidarAccesosRecientes()
    const roto = crearDatos()
    roto.base.errores.set('correo_accesos', { code: 'XX000', message: 'boom' })
    ok('si el rastro falla, no enseña los hilos ajenos', /constancia/.test((await fallaCon(correoHilos, roto.ctx, { buzon: 'maoli' })) ?? '') && !roto.base.peticiones.includes('correo_hilos.select'))
  }

  console.log('\n=== correo_hilo ===')
  {
    olvidarAccesosRecientes()
    const d = crearDatos()
    const r = await usar(correoHilo, d.ctx, { hilo_id: H_PROPUESTA })
    ok('la conversación entera, en orden: el más antiguo primero', r.mensajes_en_total === 4 && r.mensajes_mostrados === 4 && r.mensajes[0].mensaje_id === M_VIEJO && r.mensajes[3].mensaje_id === M_A_MANO)
    ok('quién escribió cada uno', r.mensajes.find((m: any) => m.mensaje_id === M_RESPUESTA).sentido === 'recibido' && r.mensajes.find((m: any) => m.mensaje_id === M_AUTO).sentido === 'enviado')
    ok('el texto y el adjunto del recibido', /Gracias por la propuesta/.test(r.mensajes.find((m: any) => m.mensaje_id === M_RESPUESTA).texto) && r.mensajes.find((m: any) => m.mensaje_id === M_RESPUESTA).adjuntos[0].nombre === 'tarifas.pdf')
    ok('el buzón y el asunto de la conversación', r.buzon === 'Maoli Pérez (maoli@libertyseller.es)' && r.asunto === 'Propuesta para Lámparas Sol')
    ok('dejó rastro de ESTE hilo, con su asunto', accesos(d).length === 1 && accesos(d)[0].accion === 'hilo' && accesos(d)[0].hilo_id === H_PROPUESTA && accesos(d)[0].asunto === 'Propuesta para Lámparas Sol')

    const dos = await usar(correoHilo, d.ctx, { hilo_id: H_PROPUESTA, max_mensajes: 2 })
    ok('con max_mensajes, los más recientes y el aviso de los que faltan', dos.mensajes_mostrados === 2 && dos.mensajes[0].mensaje_id === M_RESPUESTA && /2 mensajes anteriores/.test(dos.aviso))
    const corto = await usar(correoHilo, d.ctx, { hilo_id: H_PROPUESTA, max_caracteres: 500 })
    ok('con max_caracteres, el largo se recorta y lo dice', corto.mensajes.find((m: any) => m.mensaje_id === M_A_MANO).texto_recortado !== null && corto.mensajes.find((m: any) => m.mensaje_id === M_AUTO).texto_recortado === null)
    ok('por defecto cabe un correo normal', CARACTERES_POR_CORREO >= 2000 && r.mensajes.find((m: any) => m.mensaje_id === M_A_MANO).texto_recortado === null)
    const porMensaje = await usar(correoHilo, d.ctx, { mensaje_id: M_RESPUESTA })
    ok('por el id de un mensaje, su conversación', porMensaje.hilo_id === H_PROPUESTA && porMensaje.mensajes_en_total === 4)

    olvidarAccesosRecientes()
    const propio = crearDatos()
    propio.base.errores.set('correo_accesos', { code: 'XX000', message: 'boom' })
    const mio = await usar(correoHilo, propio.ctx, { hilo_id: H_RAUL })
    ok('su propio buzón se lee sin rastro, aunque el rastro no funcione', mio.mensajes_en_total === 1 && mio.mensajes[0].mensaje_id === M_RAUL)
    ok('el de otra persona, no: sin rastro no se abre', /constancia/.test((await fallaCon(correoHilo, propio.ctx, { hilo_id: H_ANA })) ?? ''))

    olvidarAccesosRecientes()
    const sinRastro = crearDatos()
    sinRastro.base.errores.set('correo_accesos', { code: 'XX000', message: 'boom' })
    const antes = sinRastro.base.peticiones.length
    const falla = await fallaCon(correoHilo, sinRastro.ctx, { hilo_id: H_ANA })
    const lecturas = sinRastro.base.peticiones.slice(antes).filter((x) => x === 'correo_mensajes.select').length
    ok('si el rastro falla, no se llega a leer ningún mensaje', /constancia/.test(falla ?? '') && lecturas === 0)

    ok('sin id, error', /Falta/.test((await fallaCon(correoHilo, d.ctx, {})) ?? ''))
    ok('un id que no es un id, error', /no es válido/.test((await fallaCon(correoHilo, d.ctx, { hilo_id: 'abc' })) ?? ''))
    ok('un hilo que no existe, error', /No existe ninguna conversación/.test((await fallaCon(correoHilo, d.ctx, { hilo_id: uuid('e', 999) })) ?? ''))
    ok('un mensaje que no existe, error', /No existe ningún mensaje/.test((await fallaCon(correoHilo, d.ctx, { mensaje_id: uuid('f', 999) })) ?? ''))
    ok('un máximo de mensajes fuera de rango, error', /entre 1 y 40/.test((await fallaCon(correoHilo, d.ctx, { hilo_id: H_PROPUESTA, max_mensajes: 100 })) ?? ''))
    ok('es solo lectura: lo único que se escribió es el rastro', d.base.peticiones.filter((x) => !x.endsWith('.select')).every((x) => x === 'correo_accesos.insert'))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
