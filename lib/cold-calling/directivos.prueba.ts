import { agruparPorCargo, cargoLegible, nombreLegible, parsearDirectivos } from './directivos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n=== el caso real: seis administradores solidarios ===')
{
  const texto =
    'NARRO GARCIA JULIAN (Administrador solidario); VALERO NAVARRO JUAN JOSE (Administrador solidario); RODRIGUEZ DUARTE JOSEFINA (Administrador solidario); MEDINA GAMBOA NATALIA (Administrador solidario); IGLESIAS FRAIZ JOSE MANUEL (Administrador solidario); ZARAGOZA CARRILLO SERGIO (Administrador solidario)'
  const d = parsearDirectivos(texto)
  ok('seis personas', d.length === 6, String(d.length))
  ok('la primera, con su cargo', d[0].nombre === 'NARRO GARCIA JULIAN' && d[0].cargo === 'Administrador solidario')
  const g = agruparPorCargo(d)
  ok('un solo grupo, no seis cargos repetidos', g.length === 1 && g[0].cargo === 'Administrador solidario' && g[0].nombres.length === 6)
  ok('los nombres se leen en minúscula con inicial', g[0].nombres[0] === 'Narro Garcia Julian' && g[0].nombres[4] === 'Iglesias Fraiz Jose Manuel')
}

console.log('\n=== cargos distintos: un grupo por cargo, en orden de aparición ===')
{
  const g = agruparPorCargo(parsearDirectivos('LOPEZ RUIZ ANA (Administrador único); PEREZ SOLA LUIS (Apoderado); GIL MORA EVA (administrador único)'))
  ok('dos grupos', g.length === 2, JSON.stringify(g))
  ok('«Administrador único» se junta aunque cambie la mayúscula', g[0].nombres.length === 2 && g[0].cargo === 'Administrador único')
  ok('el apoderado va aparte', g[1].cargo === 'Apoderado' && g[1].nombres[0] === 'Perez Sola Luis')
}

console.log('\n=== sin cargo, un solo nombre, texto raro ===')
{
  ok('un nombre sin paréntesis', igual(parsearDirectivos('GARCIA PEREZ MARIA'), [{ nombre: 'GARCIA PEREZ MARIA', cargo: null }]))
  ok('separado por saltos de línea también', parsearDirectivos('A B C\nD E F').length === 2)
  ok('vacío y null: nada', parsearDirectivos('').length === 0 && parsearDirectivos(null).length === 0 && parsearDirectivos(undefined).length === 0 && parsearDirectivos(' ; ; ').length === 0)
  ok('un paréntesis sin nombre delante no se parte', igual(parsearDirectivos('(Administrador)'), [{ nombre: '(Administrador)', cargo: null }]))
  ok('un cargo con paréntesis dentro se entiende', igual(parsearDirectivos('RUIZ SOLA PEDRO (Administrador (suplente))'), [{ nombre: 'RUIZ SOLA PEDRO', cargo: 'Administrador (suplente)' }]))
  ok('un paréntesis sin cerrar no rompe nada', igual(parsearDirectivos('RUIZ SOLA PEDRO (Admin'), [{ nombre: 'RUIZ SOLA PEDRO (Admin', cargo: null }]))
  ok('un cargo vacío es sin cargo', igual(parsearDirectivos('RUIZ SOLA PEDRO ()'), [{ nombre: 'RUIZ SOLA PEDRO', cargo: null }]))
  ok('el mismo directivo dos veces sale una', parsearDirectivos('A B C (Admin); a b c (admin)').length === 1)
  const g = agruparPorCargo(parsearDirectivos('A B C'))
  ok('sin cargo: un grupo sin cabecera', g.length === 1 && g[0].cargo === null)
}

console.log('\n=== nombres legibles ===')
{
  ok('mayúsculas a inicial', nombreLegible('NARRO GARCIA JULIAN') === 'Narro Garcia Julian')
  ok('las partículas en minúscula', nombreLegible('DE LA TORRE DEL RIO ANA') === 'De la Torre del Rio Ana', nombreLegible('DE LA TORRE DEL RIO ANA'))
  ok('guiones y apóstrofos', nombreLegible('RUIZ-GOMEZ D\'ANGELO LUIS') === "Ruiz-Gomez D'Angelo Luis", nombreLegible("RUIZ-GOMEZ D'ANGELO LUIS"))
  ok('las siglas de una empresa se quedan', nombreLegible('EUROPEAN HOLDING SL') === 'European Holding SL', nombreLegible('EUROPEAN HOLDING SL'))
  ok('lo que ya viene con minúsculas no se toca', nombreLegible('Ana López') === 'Ana López')
  ok('las tildes que traiga se respetan', nombreLegible('MUÑOZ ÁLVAREZ JOSÉ') === 'Muñoz Álvarez José', nombreLegible('MUÑOZ ÁLVAREZ JOSÉ'))
  ok('el cargo en frase', cargoLegible('ADMINISTRADOR SOLIDARIO') === 'Administrador solidario' && cargoLegible('administrador único') === 'Administrador único')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
