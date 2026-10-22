import { CAMPOS_DE_PLANTILLA, camposSinRellenar, insertarPlantilla, nombreNormalizado, rellenarPlantilla, textoSinFirma } from './plantillas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== rellenar lo que se sabe ===')
{
  const d = { empresa: 'Badis Aquariums', mi_nombre: 'Daniela', mi_correo: 'daniela@libertyseller.es' }
  ok('empresa, tu nombre y tu correo', rellenarPlantilla('Para {{empresa}}: soy {{mi_nombre}} ({{mi_correo}})', d) === 'Para Badis Aquariums: soy Daniela (daniela@libertyseller.es)')
  ok('con espacios dentro y sin mirar mayúsculas', rellenarPlantilla('{{ EMPRESA }} / {{Mi_Nombre}}', d) === 'Badis Aquariums / Daniela')
  ok('el mismo campo varias veces', rellenarPlantilla('{{empresa}} y {{empresa}}', d) === 'Badis Aquariums y Badis Aquariums')
  ok('{{nombre}} NO se rellena nunca solo', rellenarPlantilla('Hola {{nombre}}', { ...d, empresa: 'x' }) === 'Hola {{nombre}}')
  ok('lo que no se sabe se queda con sus llaves', rellenarPlantilla('Para {{empresa}}', {}) === 'Para {{empresa}}' && rellenarPlantilla('Para {{empresa}}', { empresa: '   ' }) === 'Para {{empresa}}' && rellenarPlantilla('Para {{empresa}}', { empresa: null }) === 'Para {{empresa}}')
  ok('un campo que no existe se deja y no rompe', rellenarPlantilla('Hola {{apellido}}', d) === 'Hola {{apellido}}')
  ok('las llaves sueltas no son campos', rellenarPlantilla('{ {empresa} } {{ }} {empresa}', d) === '{ {empresa} } {{ }} {empresa}')
  ok('un valor con «$&» u otros símbolos de reemplazo sale tal cual', rellenarPlantilla('{{empresa}}', { empresa: 'A$&B$1C' }) === 'A$&B$1C')
}

console.log('\n=== lo que queda sin rellenar bloquea el envío ===')
{
  ok('lista los campos pendientes, sin repetir y en orden', JSON.stringify(camposSinRellenar('Hola {{nombre}}, {{empresa}} {{ Nombre }} {{apellido}}')) === JSON.stringify(['{{nombre}}', '{{empresa}}', '{{apellido}}']))
  ok('sin campos, nada', camposSinRellenar('Un texto normal con { llaves } sueltas').length === 0)
  ok('tras rellenar solo quedan los que faltan', JSON.stringify(camposSinRellenar(rellenarPlantilla('{{empresa}} {{nombre}}', { empresa: 'X' }))) === JSON.stringify(['{{nombre}}']))
}

console.log('\n=== guardar sin la firma ===')
{
  const firma = 'Daniela Guzman\nLiberty Seller'
  ok('la firma del final no se guarda', textoSinFirma(`Hola, soy Daniela.\n\n${firma}`, firma) === 'Hola, soy Daniela.')
  ok('sin firma, solo se recortan los espacios del final', textoSinFirma('Hola.\n\n', null) === 'Hola.' && textoSinFirma('Hola.', '') === 'Hola.')
  ok('una firma que no está al final no se toca', textoSinFirma(`${firma}\n\nHola`, firma) === `${firma}\n\nHola`)
}

console.log('\n=== insertar en el mensaje ===')
{
  const firma = '\n\nDaniela'
  const a = insertarPlantilla(firma, firma, 'Hola {{nombre}}.', 0)
  ok('en un mensaje sin tocar, la plantilla va arriba y la firma debajo', a.texto === `Hola {{nombre}}.${firma}` && a.cursor === 'Hola {{nombre}}.'.length)
  const b = insertarPlantilla('', '', 'Hola.\n\n', 0)
  ok('en uno vacío, solo la plantilla', b.texto === 'Hola.')
  const c = insertarPlantilla('Ya había algo escrito', firma, ' [PLANTILLA]', 3)
  ok('si ya se escribió algo, se inserta en el cursor', c.texto === 'Ya  [PLANTILLA]había algo escrito' && c.cursor === 3 + ' [PLANTILLA]'.length)
  const d = insertarPlantilla('abc', firma, 'X', 99)
  ok('un cursor fuera de sitio se corrige', d.texto === 'abcX')
}

console.log('\n=== nombres y campos que se ofrecen ===')
{
  ok('el nombre se compara sin mayúsculas ni espacios de más', nombreNormalizado('  Apertura   DE canal ') === 'apertura de canal')
  ok('los cuatro campos, y {{nombre}} avisa de que lo pone quien envía', CAMPOS_DE_PLANTILLA.length === 4 && /pones tú/.test(CAMPOS_DE_PLANTILLA.find((c) => c.clave === 'nombre')!.ayuda))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
