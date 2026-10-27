import { PISTA_PARA_LIBERAR, VIGENCIA_EN_DIAS, combinarConLoSabido, decidirEnvio, esDireccionPropia, esPoliticaDeDudosas, estaVigente, fraseDeDireccionMala, motivoParaLaMemoria, type ResultadoDeComprobar, type VeredictoDePago, type VeredictoLibre } from './pago'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const DIA = 86_400_000
const v = (direccion: string, nivel: VeredictoDePago['nivel'], e: Partial<VeredictoDePago> = {}): ResultadoDeComprobar => ({
  tipo: 'veredicto',
  veredicto: { direccion, nivel, resultado: nivel === 'buena' ? 'ok' : nivel === 'mala' ? 'invalid' : 'catch_all', detalle: null, sugerencia: null, motivo: nivel === 'buena' ? 'La dirección existe y recibe correo.' : nivel === 'mala' ? 'El buzón no existe.' : 'El servidor de esa empresa acepta cualquier dirección, así que no se puede confirmar que el buzón exista.', origen: 'servicio', verificadaAt: 0, ...e },
})
const sin = (causa: Extract<ResultadoDeComprobar, { tipo: 'sin_comprobar' }>['causa'], motivo = 'Motivo.'): ResultadoDeComprobar => ({ tipo: 'sin_comprobar', causa, motivo })
const mapa = (...pares: Array<[string, ResultadoDeComprobar]>) => new Map(pares)

console.log('\n=== los ajustes y lo que vale lo guardado ===')
{
  ok('las tres políticas, y nada más', esPoliticaDeDudosas('avisar') && esPoliticaDeDudosas('sin_seguimientos') && esPoliticaDeDudosas('bloquear') && !esPoliticaDeDudosas('otra') && !esPoliticaDeDudosas(null))
  const ahora = Date.parse('2026-10-27T12:00:00Z')
  ok('una dirección buena o mala vale un año', estaVigente('buena', ahora - 364 * DIA, ahora) && !estaVigente('buena', ahora - 366 * DIA, ahora) && estaVigente('mala', ahora - 364 * DIA, ahora) && VIGENCIA_EN_DIAS.mala === 365)
  ok('una dudosa, tres meses (se puede reintentar antes: no se cobra)', estaVigente('dudosa', ahora - 89 * DIA, ahora) && !estaVigente('dudosa', ahora - 91 * DIA, ahora))
  ok('una comprobación «del futuro» (reloj descuadrado) no se da por vigente', !estaVigente('buena', ahora + 2 * 3_600_000, ahora))
  ok('una de hace un momento sí', estaVigente('buena', ahora - 1000, ahora))
  const propios = ['libertyseller.es', 'LibertySeller.com']
  ok('los dominios del propio equipo no se comprueban', esDireccionPropia('ana@libertyseller.es', propios) && esDireccionPropia('Ana@LIBERTYSELLER.COM', propios) && !esDireccionPropia('ana@tienda.es', propios))
  ok('ni una dirección propia suelta', esDireccionPropia('jefe@otra.es', propios, ['Jefe@Otra.es']) && !esDireccionPropia('jefe@otra.es', propios, []))
  ok('«libertyseller.es.malo.com» no es del equipo', !esDireccionPropia('x@libertyseller.es.malo.com', propios))
}

console.log('\n=== qué se hace antes de enviar ===')
{
  const buena = decidirEnvio(mapa(['ana@tienda.es', v('ana@tienda.es', 'buena')]), 'avisar')
  ok('una dirección buena: sale, sin avisos', buena.bloqueo === null && buena.sinSeguimientos === null && buena.avisos.length === 0 && buena.direcciones.length === 1 && !buena.direcciones[0].bloquea)

  const mala = decidirEnvio(mapa(['bademail@gmal.com', v('bademail@gmal.com', 'mala', { detalle: 'bad_domain', sugerencia: 'bademail@gmail.com', motivo: 'El dominio no existe o no recibe correo.' })]), 'avisar')
  ok('una mala NO sale, y la frase dice cuál, por qué y qué quería decir', mala.bloqueo !== null && /No se ha enviado/.test(mala.bloqueo.mensaje) && /«bademail@gmal\.com»/.test(mala.bloqueo.mensaje) && /dominio no existe/.test(mala.bloqueo.mensaje) && /¿Querías decir «bademail@gmail\.com»\?/.test(mala.bloqueo.mensaje))
  ok('…con la dirección marcada para que el cuadro la enseñe en rojo', mala.bloqueo?.direcciones[0].bloquea === true && mala.bloqueo?.direcciones[0].sugerencia === 'bademail@gmail.com')
  ok('y dice cómo salir si en realidad funciona: un administrador la libera (no hay «enviar igualmente»)', mala.bloqueo !== null && mala.bloqueo.mensaje.includes(PISTA_PARA_LIBERAR) && /administrador/.test(PISTA_PARA_LIBERAR))
  ok('una mala bloquea con cualquier política', ['avisar', 'sin_seguimientos', 'bloquear'].every((p) => decidirEnvio(mapa(['x@y.es', v('x@y.es', 'mala')]), p as 'avisar').bloqueo !== null))

  const dudosaAvisar = decidirEnvio(mapa(['jefe@grande.com', v('jefe@grande.com', 'dudosa')]), 'avisar')
  ok('dudosa + «avisar»: sale con seguimientos y se avisa', dudosaAvisar.bloqueo === null && dudosaAvisar.sinSeguimientos === null && dudosaAvisar.avisos.length === 1 && /es dudosa/.test(dudosaAvisar.avisos[0]) && /enviado igualmente/.test(dudosaAvisar.avisos[0]))
  const dudosaSin = decidirEnvio(mapa(['jefe@grande.com', v('jefe@grande.com', 'dudosa')]), 'sin_seguimientos')
  ok('dudosa + «sin seguimientos»: sale, sin seguimientos, y se dice', dudosaSin.bloqueo === null && dudosaSin.sinSeguimientos !== null && /sin seguimientos automáticos/.test(dudosaSin.sinSeguimientos) && dudosaSin.avisos.length === 1)
  const dudosaNo = decidirEnvio(mapa(['jefe@grande.com', v('jefe@grande.com', 'dudosa')]), 'bloquear')
  ok('dudosa + «no enviar»: no sale, y dice que es por el ajuste', dudosaNo.bloqueo !== null && /No enviar/.test(dudosaNo.bloqueo.mensaje) && dudosaNo.bloqueo.direcciones[0].bloquea)

  const mezcla = decidirEnvio(mapa(['ana@tienda.es', v('ana@tienda.es', 'buena')], ['mala@tienda.es', v('mala@tienda.es', 'mala')]), 'avisar')
  ok('con una buena y una mala, no sale; la frase habla solo de la mala y las dos aparecen en la lista', mezcla.bloqueo !== null && /mala@tienda\.es/.test(mezcla.bloqueo.mensaje) && !/ana@tienda\.es/.test(mezcla.bloqueo.mensaje) && mezcla.direcciones.length === 2)
  const dos = decidirEnvio(mapa(['a@x.es', v('a@x.es', 'mala')], ['b@x.es', v('b@x.es', 'mala')]), 'avisar')
  ok('con dos malas, las dos en la frase', dos.bloqueo !== null && /a@x\.es/.test(dos.bloqueo.mensaje) && /b@x\.es/.test(dos.bloqueo.mensaje) && /hay direcciones que no sirven/.test(dos.bloqueo.mensaje))

  const rebotada = decidirEnvio(mapa(['x@y.es', v('x@y.es', 'mala', { origen: 'rebote', resultado: 'rebotada', motivo: 'Esa dirección ya rebotó antes.' })]), 'avisar')
  ok('una que ya rebotó antes también bloquea, y se marca como rebotada', rebotada.bloqueo !== null && rebotada.direcciones[0].rebotada === true)
}

console.log('\n=== cuando no se ha podido comprobar, el correo sale igual ===')
{
  for (const causa of ['apagada', 'sin_clave', 'propia'] as const) {
    const d = decidirEnvio(mapa(['x@y.es', sin(causa)]), 'bloquear')
    ok(`«${causa}»: sale sin decir nada (no es un fallo)`, d.bloqueo === null && d.avisos.length === 0 && d.direcciones.length === 0)
  }
  for (const causa of ['sin_creditos', 'clave', 'ip', 'red', 'otro'] as const) {
    const d = decidirEnvio(mapa(['x@y.es', sin(causa, 'Se han acabado los créditos.')]), 'bloquear')
    ok(`«${causa}»: sale igual (aunque la política sea «no enviar») y se le dice a quien envía`, d.bloqueo === null && d.avisos.length === 1 && /No se ha podido comprobar/.test(d.avisos[0]) && /enviado igualmente/.test(d.avisos[0]))
  }
  ok('«limite» (el motor no pregunta más en esta pasada) no se cuenta como fallo', decidirEnvio(mapa(['x@y.es', sin('limite')]), 'bloquear').avisos.length === 0)
  const mezcla = decidirEnvio(mapa(['a@x.es', v('a@x.es', 'mala')], ['b@x.es', sin('red')]), 'avisar')
  ok('una mala bloquea aunque otra no se haya podido comprobar', mezcla.bloqueo !== null)
}

console.log('\n=== cómo se dice una dirección mala según de dónde viene ===')
{
  const rebote = { motivo: 'el servidor dijo que no existe', veces: 2, origen: 'rebote' }
  ok('un rebote: «ya rebotó antes (2 veces)»', /ya rebotó antes \(2 veces\)/.test(fraseDeDireccionMala(rebote, 'aviso')) && /ya había rebotado antes/.test(fraseDeDireccionMala(rebote, 'parada')) && /ya rebotó antes \(2 veces\)/.test(fraseDeDireccionMala(rebote, 'alta')))
  ok('sin origen se trata como un rebote (lo de siempre)', /ya rebotó antes/.test(fraseDeDireccionMala({ motivo: null, veces: 1 }, 'aviso')) && /el servidor dijo que no existe/.test(fraseDeDireccionMala({ motivo: null, veces: 1 }, 'aviso')))
  const ver = { motivo: 'El dominio no existe o no recibe correo', veces: 1, origen: 'verificador' }
  ok('del verificador: lo dice, y NO miente diciendo que rebotó', /servicio de verificación dice que esa dirección no existe: El dominio no existe/.test(fraseDeDireccionMala(ver, 'aviso')) && !/rebot/.test(fraseDeDireccionMala(ver, 'aviso')) && !/rebot/.test(fraseDeDireccionMala(ver, 'parada')) && !/rebot/.test(fraseDeDireccionMala(ver, 'alta')))
  ok('del verificador, al parar una secuencia y al programarla', /dijo que esa dirección no existe \(El dominio no existe o no recibe correo\): no se le escribe más/.test(fraseDeDireccionMala(ver, 'parada')) && /^No se programan seguimientos: el servicio de verificación dice/.test(fraseDeDireccionMala(ver, 'alta')))
  ok('del verificador sin motivo, también tiene frase', /dice que esa dirección no existe\./.test(fraseDeDireccionMala({ motivo: null, origen: 'verificador' }, 'aviso')))
  ok('el motivo que va a la memoria no lleva punto final ni pasa de 300', motivoParaLaMemoria('El buzón no existe.') === 'El buzón no existe' && motivoParaLaMemoria('x'.repeat(500)).length === 300)
}

console.log('\n=== las dudosas en una secuencia que ya está en marcha ===')
{
  const dudosa = { motivo: 'El servidor de esa empresa acepta cualquier dirección.', veces: 1, origen: 'verificador_dudosa' }
  const aviso = fraseDeDireccionMala(dudosa, 'aviso')
  const parada = fraseDeDireccionMala(dudosa, 'parada')
  const alta = fraseDeDireccionMala(dudosa, 'alta')
  ok('una dudosa NO dice que la dirección no existe ni que rebotó: dice que no se pudo confirmar', [aviso, parada, alta].every((f) => /no ha podido confirmar que esa dirección exista/.test(f) && !/rebot/.test(f) && !/no existe\b/.test(f.replace('no ha podido confirmar que esa dirección exista', ''))))
  ok('explica por qué no se le escribe: lo dicen los ajustes', /según los ajustes no se le escriben seguimientos/.test(aviso) && /según los ajustes no se le escriben seguimientos/.test(parada) && /los ajustes no lo permiten/.test(alta))
  ok('y lleva el motivo entre paréntesis, sin el punto final de dentro', /\(El servidor de esa empresa acepta cualquier dirección\)/.test(aviso) && !/\.\)/.test(aviso))
  ok('al programar los seguimientos dice que no se programan', /^No se programan seguimientos:/.test(alta))
  ok('sin motivo también tiene frase', /no ha podido confirmar que esa dirección exista:/.test(fraseDeDireccionMala({ motivo: null, origen: 'verificador_dudosa' }, 'parada')))
}

console.log('\n=== el cuadro de escribir: lo gratis y lo ya sabido, juntos ===')
{
  const libre = (direccion: string, e: Partial<VeredictoLibre> = {}): VeredictoLibre => ({ direccion, nivel: 'buena', motivo: 'Parece una dirección correcta.', sugerencia: null, sinComprobar: true, rebotada: false, ...e })
  const sabido = (direccion: string, nivel: VeredictoDePago['nivel'], e: Partial<VeredictoDePago> = {}): VeredictoDePago => {
    const r = v(direccion, nivel, e)
    return r.tipo === 'veredicto' ? r.veredicto : (undefined as never)
  }

  const apagada = combinarConLoSabido(libre('a@x.es'), sabido('a@x.es', 'mala'), null)
  ok('con la verificación apagada, nada bloquea ni se enseña como verificado, aunque haya algo guardado', !apagada.bloquea && !apagada.verificada && apagada.nivel === 'buena')
  const nada = combinarConLoSabido(libre('a@x.es'), undefined, 'avisar')
  ok('si no se sabe nada de la dirección, queda lo de la revisión gratuita', !nada.bloquea && !nada.verificada && nada.sinComprobar && nada.nivel === 'buena')

  const buena = combinarConLoSabido(libre('a@x.es'), sabido('a@x.es', 'buena'), 'avisar')
  ok('una buena ya comprobada: sin problema y marcada como verificada', !buena.bloquea && buena.verificada && buena.nivel === 'buena')

  const mala = combinarConLoSabido(libre('b@gmal.com'), sabido('b@gmal.com', 'mala', { sugerencia: 'b@gmail.com', motivo: 'El dominio no existe o no recibe correo.' }), 'avisar')
  ok('una mala ya comprobada: roja, bloquea y propone la corrección', mala.nivel === 'mala' && mala.bloquea && mala.verificada && mala.sugerencia === 'b@gmail.com' && /dominio no existe/.test(mala.motivo) && !mala.sinComprobar && !mala.rebotada)
  const malaSinSugerencia = combinarConLoSabido(libre('b@gmal.com', { sugerencia: 'b@gmail.com' }), sabido('b@gmal.com', 'mala'), 'avisar')
  ok('si el servicio no propone nada, se conserva la corrección de la revisión gratuita', malaSinSugerencia.sugerencia === 'b@gmail.com')
  const rebotada = combinarConLoSabido(libre('c@x.es'), sabido('c@x.es', 'mala', { origen: 'rebote' }), 'avisar')
  ok('una que rebotó se marca como rebotada', rebotada.rebotada && rebotada.bloquea)

  const persona = combinarConLoSabido(libre('d@x.es', { nivel: 'mala', rebotada: true, motivo: 'Rebotó.' }), sabido('d@x.es', 'buena', { origen: 'persona', motivo: 'Un administrador ha marcado esta dirección como buena.' }), 'bloquear')
  ok('una liberada por un administrador manda sobre todo: buena, sin bloquear y ya no «rebotada»', persona.nivel === 'buena' && !persona.bloquea && !persona.rebotada && persona.verificada && /administrador/.test(persona.motivo))

  for (const [politica, bloquea] of [['avisar', false], ['sin_seguimientos', false], ['bloquear', true]] as const) {
    const d = combinarConLoSabido(libre('e@grande.com'), sabido('e@grande.com', 'dudosa'), politica)
    ok(`una dudosa con «${politica}»: ${bloquea ? 'bloquea' : 'no bloquea'}, y se ve como dudosa`, d.nivel === 'dudosa' && d.bloquea === bloquea && d.verificada && !d.sinComprobar)
  }
  const dudosaPeor = combinarConLoSabido(libre('f@x.es', { nivel: 'mala', motivo: 'Está mal escrita.' }), sabido('f@x.es', 'dudosa'), 'avisar')
  ok('si la revisión gratuita ya la daba por mala (mal escrita), no se suaviza a dudosa', dudosaPeor.nivel === 'mala' && dudosaPeor.motivo === 'Está mal escrita.')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
