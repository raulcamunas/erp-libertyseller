import { cambiosDelPerfil } from '@/lib/whatsapp/ia-cambios'
import { PERFIL_DE_SERIE, copiaDelPerfil, type PerfilDeWhatsapp } from '@/lib/whatsapp/ia-perfil'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una copia de la serie con los cambios que se pidan */
function con(cambios: Omit<Partial<PerfilDeWhatsapp>, 'ajustes' | 'secciones' | 'momentos'> & { ajustes?: Partial<PerfilDeWhatsapp['ajustes']>; secciones?: Partial<PerfilDeWhatsapp['secciones']>; momentos?: Partial<PerfilDeWhatsapp['momentos']> }): PerfilDeWhatsapp {
  const p = copiaDelPerfil(PERFIL_DE_SERIE)
  return { ...p, ...cambios, ajustes: { ...p.ajustes, ...cambios.ajustes }, secciones: { ...p.secciones, ...cambios.secciones }, momentos: { ...p.momentos, ...cambios.momentos } } as PerfilDeWhatsapp
}

console.log('\n=== sin cambios ===')
{
  ok('dos perfiles iguales no tienen cambios', cambiosDelPerfil(con({}), con({})).length === 0)
  ok('espacios al final no cuentan como cambio', cambiosDelPerfil(con({ secciones: { comoEscribes: `${PERFIL_DE_SERIE.secciones.comoEscribes}  \n` } }), con({})).length === 0)
}

console.log('\n=== los mandos ===')
{
  const c = cambiosDelPerfil(con({ ajustes: { tono: 'formal', longitud: 'muy_corto' } }), con({}))
  ok('dice qué mando y de qué a qué, con las palabras de la pantalla', c.length === 2 && c[0] === 'Cómo les habla: Cercano → De usted' && /^Cuánto escribe: .+ → .+$/.test(c[1]), JSON.stringify(c))
  ok('la insistencia y los emojis también', cambiosDelPerfil(con({ ajustes: { insistencia: 'directo', emojis: 'uno' } }), con({})).length === 2)
  const v = cambiosDelPerfil(con({ ajustes: { variar: false } }), con({}))
  ok('variar se dice con sí y no', v.length === 1 && v[0] === 'Variar cómo empieza y cierra cada mensaje: sí → no', JSON.stringify(v))
}

console.log('\n=== los textos y los momentos ===')
{
  const c = cambiosDelPerfil(con({ secciones: { comoPersuades: 'Otra cosa', extra: 'Empieza por la llamada' }, momentos: { no_contesta: 'Otro texto' } }), con({}))
  ok('un momento cambiado lo nombra con su etiqueta', c.includes('Qué se espera en «Te he llamado y no contesta»: texto cambiado'), JSON.stringify(c))
  ok('una sección cambiada, con su título', c.some((x) => /^Cómo persuade: texto cambiado$/.test(x)), JSON.stringify(c))
  ok('las instrucciones extra se dicen como añadidas', c.includes('Instrucciones extra de esta versión: añadidas'), JSON.stringify(c))
  ok('y como cambiadas o quitadas, según el caso', cambiosDelPerfil(con({ secciones: { extra: 'B' } }), con({ secciones: { extra: 'A' } })).join() === 'Instrucciones extra de esta versión: cambiadas' && cambiosDelPerfil(con({}), con({ secciones: { extra: 'A' } })).join() === 'Instrucciones extra de esta versión: quitadas')
  ok('los mandos van antes que los momentos y los momentos antes que los textos', (() => {
    const t = cambiosDelPerfil(con({ ajustes: { tono: 'formal' }, secciones: { comoPersuades: 'x' }, momentos: { primer_contacto: 'y' } }), con({}))
    return /Cómo les habla/.test(t[0]) && /Qué se espera/.test(t[1]) && /Cómo persuade/.test(t[2])
  })())
}

console.log('\n=== los ejemplos y el modelo ===')
{
  ok('el modo de los ejemplos', cambiosDelPerfil(con({ ejemplosModo: 'ninguno' }), con({})).join() === 'Ejemplos de tono: los de serie → ninguno')
  ok('el texto de los ejemplos no cuenta si no se le enseñan a la IA', cambiosDelPerfil(con({ secciones: { ejemplos: 'Otro' } }), con({})).length === 0)
  ok('pero sí en el modo «los tuyos»', cambiosDelPerfil(con({ ejemplosModo: 'propios', secciones: { ejemplos: 'B' } }), con({ ejemplosModo: 'propios', secciones: { ejemplos: 'A' } })).join() === 'Tus ejemplos de tono: cambiados')
  const m = cambiosDelPerfil(con({ modelo: 'gpt-6-sol', esfuerzo: 'low' }), con({}))
  ok('el modelo y el razonamiento, con «el de siempre» cuando no se ha elegido', m.join(' | ') === 'Modelo: el de siempre → gpt-6-sol | Razonamiento: el de siempre → poco', m.join(' | '))
  ok('de uno a otro', cambiosDelPerfil(con({ modelo: 'gpt-6-sol', esfuerzo: 'none' }), con({ modelo: 'gpt-6-luna', esfuerzo: 'low' })).join(' | ') === 'Modelo: gpt-6-luna → gpt-6-sol | Razonamiento: poco → sin razonar')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
