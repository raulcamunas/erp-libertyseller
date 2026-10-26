import type { AvisoDeCorreo } from '@/lib/correo/avisos'
import {
  avisoDeAccionDeOtro,
  avisoDeCorreoNuevo,
  avisoDeEnvioFallido,
  avisoDeReboteDeSecuencia,
  avisoDeRespuestaDeLead,
  avisoDeSeguimientoParado,
  avisoDeSeguimientoPausado,
  avisoDeSeguimientoRechazado,
  claveDeMensaje,
  sinRepetidos,
} from '@/lib/correo/campana'
import { TIPOS_DE_AVISO_DE_CORREO, destinoDeAvisoDeCorreo, esTipoDeAvisoDeCorreo } from '@/lib/correo/campana-tipos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const U = '00000000-0000-4000-8000-0000000000a1'
const BUZON = '00000000-0000-4000-8000-0000000000b1'
const HILO = '00000000-0000-4000-8000-0000000000d1'
const MSG = '00000000-0000-4000-8000-0000000000f1'
const INSC = '00000000-0000-4000-8000-0000000000c1'
const LEAD = '00000000-0000-4000-8000-0000000000e1'

const correo: AvisoDeCorreo = { id: MSG, buzonId: BUZON, hiloId: HILO, de: 'Marta López', asunto: 'Re: Propuesta para Amazon', vistaPrevia: 'Hola Ana, me ha gustado, ¿lo vemos el jueves?', fecha: '2026-10-26T09:00:00Z', rebote: false }
const base = { userId: U, buzonId: BUZON, inscripcionId: INSC, leadId: LEAD, lead: 'Casa Luz' }

function main() {
  console.log('\n=== un correo nuevo ===')
  {
    const a = avisoDeCorreoNuevo(U, correo)
    ok('es un aviso de correo nuevo para su dueña, con la clave del correo', a.tipo === 'correo_nuevo' && a.userId === U && a.clave === `msg:${MSG}` && a.clave === claveDeMensaje(MSG))
    ok('dice quién escribe y el asunto con el principio del texto', a.titulo === 'Correo nuevo de Marta López' && a.mensaje === 'Re: Propuesta para Amazon — Hola Ana, me ha gustado, ¿lo vemos el jueves?', `${a.titulo} | ${a.mensaje}`)
    ok('lleva a su conversación', JSON.stringify(a.datos) === JSON.stringify({ buzonId: BUZON, hiloId: HILO, mensajeId: MSG }), JSON.stringify(a.datos))
    ok('no es una mejora de nada', a.enriquecer !== true)
    const sin = avisoDeCorreoNuevo(U, { ...correo, asunto: '  ', vistaPrevia: '' })
    ok('sin asunto ni texto, lo dice', sin.mensaje === '(sin asunto)')
    const largo = avisoDeCorreoNuevo(U, { ...correo, de: 'X'.repeat(200), asunto: 'A'.repeat(500), vistaPrevia: 'B'.repeat(500) })
    ok('los textos largos se recortan', largo.titulo.length <= 100 && largo.mensaje.length <= 260 && largo.mensaje.endsWith('…'), `${largo.titulo.length}/${largo.mensaje.length}`)
    const espacios = avisoDeCorreoNuevo(U, { ...correo, de: 'Marta\n   López', vistaPrevia: 'uno\n\n dos' })
    ok('los saltos de línea y los espacios dobles no llegan al aviso', !/\s{2}|\n/.test(`${espacios.titulo}${espacios.mensaje}`))
  }

  console.log('\n=== un correo que rebota ===')
  {
    const r = { ...correo, id: '00000000-0000-4000-8000-0000000000f2', de: 'Mail Delivery Subsystem', asunto: 'Delivery Status Notification (Failure)', rebote: true }
    const a = avisoDeCorreoNuevo(U, r, { direccion: 'hola@tienda.es', motivo: 'inexistente' })
    ok('es un aviso de rebote con la dirección y por qué', a.tipo === 'correo_rebote' && a.titulo === 'Un correo no se ha entregado' && a.mensaje === 'El correo a hola@tienda.es ha rebotado: esa dirección no existe o no admite correo. Busca otra dirección.', a.mensaje)
    ok('lleva la dirección en los datos, y a su conversación', a.datos.direccion === 'hola@tienda.es' && a.datos.hiloId === HILO && a.clave === `msg:${r.id}`)
    const politica = avisoDeCorreoNuevo(U, r, { direccion: 'hola@tienda.es', motivo: 'rechazo_de_politica' })
    ok('un rechazo por política no dice que la dirección esté mal', politica.mensaje.includes('spam o política') && !politica.mensaje.includes('Busca otra'), politica.mensaje)
    const pasajero = avisoDeCorreoNuevo(U, r, { direccion: 'hola@tienda.es', motivo: 'pasajero' })
    ok('un fallo pasajero lo cuenta como tal', pasajero.mensaje.includes('lleno') && !pasajero.mensaje.includes('Busca otra'), pasajero.mensaje)
    const sinDireccion = avisoDeCorreoNuevo(U, r, null)
    ok('si no se sabe a quién iba, lo dice sin inventar', sinDireccion.mensaje.startsWith('Un correo tuyo ha rebotado') && sinDireccion.datos.direccion === undefined && !('direccion' in sinDireccion.datos), JSON.stringify(sinDireccion))
  }

  console.log('\n=== lo que pasa con un seguimiento ===')
  {
    const p = avisoDeSeguimientoPausado({ ...base, motivo: 'La IA ha pausado este seguimiento: pidió que le escribamos en enero', cuando: 1_000 })
    ok('un seguimiento pausado: tipo, título con el lead y el motivo con su punto', p.tipo === 'secuencia_pausada' && p.titulo === 'Seguimiento pausado: Casa Luz' && p.mensaje === 'La IA ha pausado este seguimiento: pidió que le escribamos en enero. Decide qué hacer en Correo → Secuencias.', p.mensaje)
    ok('lleva a la secuencia', p.datos.inscripcionId === INSC && p.datos.buzonId === BUZON && p.datos.leadId === LEAD && p.clave === `pausa:${INSC}:1000`)
    const dosVeces = avisoDeSeguimientoPausado({ ...base, motivo: 'x', cuando: 2_000 })
    ok('dos pausas distintas del mismo lead no comparten clave', dosVeces.clave !== p.clave)
    const conPunto = avisoDeSeguimientoPausado({ ...base, motivo: 'Ya llevaba punto.', cuando: 1 })
    ok('si el motivo ya acaba en punto, no se duplica', conPunto.mensaje.startsWith('Ya llevaba punto. Decide') && !conPunto.mensaje.includes('..'))

    const f = avisoDeEnvioFallido({ ...base, motivo: 'El seguimiento 1 no ha podido enviarse tras 5 intentos', cuando: 5 })
    ok('un envío fallido', f.tipo === 'secuencia_pausada' && f.titulo === 'No se ha podido enviar el seguimiento a Casa Luz' && f.mensaje === 'El seguimiento 1 no ha podido enviarse tras 5 intentos. Míralo en Correo → Secuencias.', f.mensaje)

    const rz = avisoDeSeguimientoRechazado({ ...base, direccion: 'x@casaluz.es', cuando: 7 })
    ok('el servidor rechaza el mensaje: secuencia parada, con la dirección', rz.tipo === 'secuencia_parada' && rz.titulo === 'Se ha parado el seguimiento a Casa Luz' && rz.mensaje.includes('x@casaluz.es') && rz.datos.direccion === 'x@casaluz.es' && rz.clave === `rechazo:${INSC}:7`)

    const par = avisoDeSeguimientoParado({ ...base, motivo: 'El lead ya no es de este comercial', cuando: 9 })
    ok('un seguimiento parado por algo ajeno', par.tipo === 'secuencia_parada' && par.mensaje === 'El lead ya no es de este comercial.' && par.clave === `parada:${INSC}:9`)

    const pausa = avisoDeAccionDeOtro({ ...base, quien: 'Raúl', accion: 'pausar', cuando: 11 })
    const cancela = avisoDeAccionDeOtro({ ...base, quien: 'Raúl', accion: 'cancelar', cuando: 12 })
    ok('un administrador pausa la secuencia de otra persona', pausa.tipo === 'secuencia_parada' && pausa.titulo === 'Raúl ha pausado el seguimiento a Casa Luz' && pausa.mensaje.includes('hasta que se reanude'))
    ok('o la cancela', cancela.titulo === 'Raúl ha cancelado el seguimiento a Casa Luz' && cancela.mensaje.includes('ningún seguimiento más') && pausa.clave !== cancela.clave)

    const reb = avisoDeReboteDeSecuencia({ ...base, mensajeId: MSG, hiloId: HILO, direccion: 'x@casaluz.es', motivo: 'inexistente' })
    ok('el rebote de una secuencia mejora el aviso del correo (misma clave, «mejora»)', reb.tipo === 'correo_rebote' && reb.clave === claveDeMensaje(MSG) && reb.enriquecer === true && reb.titulo === 'Ha rebotado el correo a Casa Luz' && reb.mensaje.includes('Su seguimiento se ha parado'), reb.mensaje)
    const rebPolitica = avisoDeReboteDeSecuencia({ ...base, mensajeId: MSG, direccion: 'x@casaluz.es', motivo: 'rechazo_de_politica' })
    ok('un rechazo por política dice que no es la dirección', rebPolitica.mensaje.includes('no por la dirección') && !rebPolitica.mensaje.includes('no existe') && !('hiloId' in rebPolitica.datos))
  }

  console.log('\n=== lo que contesta un lead ===')
  {
    const r = (clase: Parameters<typeof avisoDeRespuestaDeLead>[0]['clase'], hecho: Parameters<typeof avisoDeRespuestaDeLead>[0]['hecho'] = null, resumen = 'Quiere una videollamada.') => avisoDeRespuestaDeLead({ ...base, mensajeId: MSG, hiloId: HILO, clase, resumen, hecho })
    const interesado = r('interesado')
    ok('interesado: título y qué hacer, y mejora el aviso del correo', interesado?.titulo === 'Casa Luz está interesado' && interesado.mensaje === 'Quiere una videollamada. Contéstale o llámale cuanto antes.' && interesado.enriquecer === true && interesado.clave === claveDeMensaje(MSG) && interesado.tipo === 'respuesta_lead', interesado?.mensaje)
    ok('guarda qué entendió la IA', interesado?.datos.clase === 'interesado' && interesado.datos.hiloId === HILO && interesado.datos.inscripcionId === INSC)
    ok('pide información', r('pide_info')?.titulo === 'Casa Luz pide información' && r('pide_info')?.mensaje.endsWith('Contéstale con lo que pide.') === true)
    ok('te deriva a otra persona', r('derivacion')?.titulo === 'Casa Luz te deriva a otra persona')
    ok('«más adelante» con la rellamada puesta', r('mas_tarde', { tipo: 'rellamada', fecha: '2027-01-11' })?.mensaje.endsWith('Queda una rellamada puesta para el lun 11 ene.') === true, r('mas_tarde', { tipo: 'rellamada', fecha: '2027-01-11' })?.mensaje)
    ok('«más adelante» sin rellamada puesta (ensayo): no dice que esté puesta', r('mas_tarde')?.mensaje.endsWith('Ponle una rellamada para entonces.') === true)
    ok('«no le interesa» cerrado dice que el lead pasa a «No interesa»', r('no_interesa', { tipo: 'cerrado' }, 'No les interesa.')?.mensaje === 'No les interesa. El lead pasa a «No interesa».')
    ok('«no le interesa» sin cerrar (ensayo) no lo dice', r('no_interesa', null, 'No les interesa.')?.mensaje === 'No les interesa. Mira si hay que cerrarlo.')
    ok('la baja', r('baja', { tipo: 'cerrado' })?.titulo === 'Casa Luz pide que no le escribas más')
    ok('si la ficha había cambiado, lo dice', r('interesado', { tipo: 'revisar' })?.mensaje.endsWith('Revisa su ficha.') === true)
    ok('«fuera de oficina» y «otra cosa» no tienen aviso propio', r('fuera_de_oficina') === null && r('otro') === null)
    ok('sin resumen usa el nombre de la clase', r('interesado', null, '')?.mensaje.startsWith('Interesado. Contéstale') === true, r('interesado', null, '')?.mensaje)
    const sinInscripcion = avisoDeRespuestaDeLead({ userId: U, buzonId: BUZON, leadId: LEAD, lead: 'Casa Luz', mensajeId: MSG, clase: 'interesado', resumen: 'Quiere hablar.', hecho: null })
    ok('un lead sin secuencia también tiene aviso', sinInscripcion?.datos.inscripcionId === undefined && !('inscripcionId' in (sinInscripcion?.datos ?? {})))
  }

  console.log('\n=== no repetir ===')
  {
    const a = avisoDeCorreoNuevo(U, correo)
    const b = { ...a, titulo: 'otro texto' }
    const c = { ...a, userId: '00000000-0000-4000-8000-0000000000a2' }
    const lista = sinRepetidos([a, b, c])
    ok('misma persona y misma clave: queda una (la última); otra persona con la misma clave es otro aviso', lista.length === 2 && lista.some((x) => x.userId === U && x.titulo === 'otro texto') && lista.some((x) => x.userId === c.userId))
  }

  console.log('\n=== los tipos y a dónde llevan ===')
  {
    ok('hay cinco tipos y se reconocen', TIPOS_DE_AVISO_DE_CORREO.length === 5 && TIPOS_DE_AVISO_DE_CORREO.every(esTipoDeAvisoDeCorreo) && !esTipoDeAvisoDeCorreo('web_lead') && !esTipoDeAvisoDeCorreo(null))
    ok('un correo nuevo lleva a su conversación', JSON.stringify(destinoDeAvisoDeCorreo('correo_nuevo', { buzonId: BUZON, hiloId: HILO })) === JSON.stringify({ tipo: 'hilo', buzonId: BUZON, hiloId: HILO }))
    ok('una respuesta de un lead también', destinoDeAvisoDeCorreo('respuesta_lead', { buzonId: BUZON, hiloId: HILO, inscripcionId: INSC })?.tipo === 'hilo')
    ok('un seguimiento pausado o parado lleva a su secuencia', JSON.stringify(destinoDeAvisoDeCorreo('secuencia_pausada', { buzonId: BUZON, inscripcionId: INSC })) === JSON.stringify({ tipo: 'secuencia', inscripcionId: INSC }) && destinoDeAvisoDeCorreo('secuencia_parada', { buzonId: BUZON, hiloId: HILO, inscripcionId: INSC })?.tipo === 'secuencia')
    ok('un rebote de una secuencia sin hilo lleva a la secuencia', destinoDeAvisoDeCorreo('correo_rebote', { buzonId: BUZON, inscripcionId: INSC })?.tipo === 'secuencia')
    ok('sin datos lleva a Correo', destinoDeAvisoDeCorreo('correo_nuevo', null)?.tipo === 'correo' && destinoDeAvisoDeCorreo('correo_nuevo', {})?.tipo === 'correo' && destinoDeAvisoDeCorreo('secuencia_pausada', 'basura')?.tipo === 'correo')
    ok('un identificador que no es un UUID no se da por bueno', destinoDeAvisoDeCorreo('correo_nuevo', { buzonId: 'x', hiloId: '../../etc' })?.tipo === 'correo' && destinoDeAvisoDeCorreo('secuencia_pausada', { inscripcionId: '123' })?.tipo === 'correo')
    ok('un tipo que no es de correo no lleva a ningún sitio de aquí', destinoDeAvisoDeCorreo('web_lead', { buzonId: BUZON, hiloId: HILO }) === null && destinoDeAvisoDeCorreo('alarma_correo', {}) === null)
    ok('los identificadores en mayúsculas se normalizan', (destinoDeAvisoDeCorreo('correo_nuevo', { buzonId: BUZON.toUpperCase(), hiloId: HILO.toUpperCase() }) as { buzonId: string }).buzonId === BUZON)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
