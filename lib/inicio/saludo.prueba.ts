import { cuantasApps, etiquetaDeRol, fechaEnPalabras, primerNombre, saludoDe } from '@/lib/inicio/saludo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el saludo según la hora ===')
{
  ok('de 5 a 11: buenos días', saludoDe(5) === 'Buenos días' && saludoDe(9) === 'Buenos días' && saludoDe(11) === 'Buenos días')
  ok('de 12 a 19: buenas tardes', saludoDe(12) === 'Buenas tardes' && saludoDe(16) === 'Buenas tardes' && saludoDe(19) === 'Buenas tardes')
  ok('de 20 a 4: buenas noches', saludoDe(20) === 'Buenas noches' && saludoDe(23) === 'Buenas noches' && saludoDe(0) === 'Buenas noches' && saludoDe(4) === 'Buenas noches')
}

console.log('\n=== el nombre de pila ===')
{
  ok('la primera palabra del nombre completo', primerNombre('Daniela Rojas Pérez', 'daniela@libertyseller.es') === 'Daniela')
  ok('con espacios de más', primerNombre('  Daniela   Rojas ', null) === 'Daniela')
  ok('sin nombre, lo de antes de la @', primerNombre('', 'daniela@libertyseller.es') === 'daniela' && primerNombre(null, 'raul.c@x.es') === 'raul.c')
  ok('un nombre en blanco cuenta como sin nombre', primerNombre('   ', 'pedro@x.es') === 'pedro')
  ok('sin nada: vacío', primerNombre(null, null) === '' && primerNombre('', '') === '' && primerNombre(undefined, undefined) === '')
}

console.log('\n=== el rol ===')
{
  ok('los cuatro de siempre', etiquetaDeRol('admin') === 'Administración' && etiquetaDeRol('employee') === 'Equipo' && etiquetaDeRol('partner') === 'Partner' && etiquetaDeRol('cliente') === 'Cliente')
  ok('uno que no se conoce, tal cual', etiquetaDeRol('supervisor') === 'supervisor')
  ok('sin rol: vacío', etiquetaDeRol(null) === '' && etiquetaDeRol(undefined) === '')
}

console.log('\n=== la fecha y el recuento ===')
{
  const f = fechaEnPalabras(new Date(2026, 9, 23, 12, 0, 0))
  ok('el día de la semana con mayúscula, el día y el mes', /^Viernes, 23 de octubre$/.test(f), f)
  ok('uno en singular, el resto en plural', cuantasApps(1) === '1 aplicación' && cuantasApps(5) === '5 aplicaciones' && cuantasApps(0) === '0 aplicaciones')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
