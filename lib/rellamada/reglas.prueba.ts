import { COMO_SACAR_EL_DIA, ESTADOS_QUE_SE_PUEDEN_TOCAR, MAX_DIAS_DE_RELLAMADA, diaConAnio, diaDeLaSemanaDicho, fechaCuadraConLaFrase, fraseDiceCuando, fraseEstaEnElTexto, normalizar } from '@/lib/rellamada/reglas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LO QUE COMPARTEN LAS RELLAMADAS DE LOS CORREOS Y LAS DE LAS LLAMADAS: comparar frases, el día de la semana que se dijo, y las constantes.
 * Hoy de las pruebas: lunes 26 de octubre de 2026 (el jueves es el 29, el sábado el 31).
 */

function main() {
  console.log('\n=== normalizar ===')
  {
    ok('minúsculas, sin tildes ni signos, con un solo espacio', normalizar('  ¡Llámame,   el JUEVES, por favor!  ') === 'llamame el jueves por favor')
    ok('la ñ y los números se conservan como letra y cifra', normalizar('El 7 de enero, año nuevo') === 'el 7 de enero ano nuevo')
    ok('vacío sigue vacío', normalizar('   ...  ') === '')
  }

  console.log('\n=== las palabras del cliente están en lo que dijo ===')
  {
    const llamada = 'Buenas tardes, sí, mira, ahora estamos con el cierre de mes, llámame el jueves por la mañana y lo vemos con calma. Un saludo.'
    ok('tal cual', fraseEstaEnElTexto('llámame el jueves por la mañana', llamada))
    ok('sin mirar mayúsculas, tildes ni signos', fraseEstaEnElTexto('LLAMAME EL JUEVES, por la manana', llamada))
    ok('si la IA se salta una muletilla al copiar, vale', fraseEstaEnElTexto('llámame el jueves por la mañana', 'Pues llámame, eh, el jueves, o sea, por la mañana, que estoy más tranquilo.'))
    ok('pero no si faltan palabras de verdad', !fraseEstaEnElTexto('llámame el jueves por la tarde', llamada))
    ok('ni si están en otro orden', !fraseEstaEnElTexto('el jueves llámame por la mañana', llamada))
    ok('ni si están tan separadas que ya son otra frase', !fraseEstaEnElTexto('llámame el jueves por la mañana', `llámame ${'blablabla '.repeat(40)} el jueves ${'blablabla '.repeat(40)} por la mañana`))
    ok('una frase demasiado corta no cuenta', !fraseEstaEnElTexto('sí', llamada) && !fraseEstaEnElTexto('  ', llamada) && !fraseEstaEnElTexto('', llamada))
    ok('de dos palabras solo vale tal cual (sin la tolerancia a muletillas)', fraseEstaEnElTexto('el jueves', llamada) && !fraseEstaEnElTexto('llámame jueves', llamada))
    ok('una invención no está', !fraseEstaEnElTexto('llámame el viernes a las cinco', llamada))
  }

  console.log('\n=== la frase dice cuándo ===')
  {
    for (const f of ['llámame el jueves a las diez', 'Llámame mañana', 'llámame después de Reyes', 'llámame dentro de dos semanas', 'cuando pase el Black Friday', 'el 15 de noviembre', 'a las 10', 'llámame en enero', 'esta tarde', 'el martes de la semana que viene']) ok(`«${f}» dice cuándo`, fraseDiceCuando(f))
    for (const f of ['Perfecto. Gracias.', 'vale, hablamos', 'llámame cuando puedas', '', '  ']) ok(`«${f}» no dice cuándo`, !fraseDiceCuando(f))
  }

  console.log('\n=== el día de la semana que nombra la frase ===')
  {
    ok('jueves es el 4', diaDeLaSemanaDicho('llámame el jueves') === 4)
    ok('con tilde o sin ella, y en plural', diaDeLaSemanaDicho('el miércoles') === 3 && diaDeLaSemanaDicho('el miercoles') === 3 && diaDeLaSemanaDicho('los martes') === 2 && diaDeLaSemanaDicho('el sábado') === 6 && diaDeLaSemanaDicho('el domingo') === 0 && diaDeLaSemanaDicho('el lunes') === 1 && diaDeLaSemanaDicho('el viernes') === 5)
    ok('sin día de la semana, null', diaDeLaSemanaDicho('llámame mañana') === null && diaDeLaSemanaDicho('después de Reyes') === null && diaDeLaSemanaDicho('') === null)
    ok('con dos días distintos no se sabe a cuál se refiere: null', diaDeLaSemanaDicho('el martes no puedo, llámame el jueves') === null)
    ok('el mismo día dos veces sí es ese día', diaDeLaSemanaDicho('el jueves, sí, el jueves') === 4)
    ok('una palabra que lo contiene no cuenta (no es el nombre del día)', diaDeLaSemanaDicho('el juevesito') === null)
  }

  console.log('\n=== la fecha cuadra con lo que dijo ===')
  {
    ok('el 29 de octubre de 2026 es jueves', fechaCuadraConLaFrase('2026-10-29', 'llámame el jueves'))
    ok('el 30 es viernes: con «el jueves» no cuadra', !fechaCuadraConLaFrase('2026-10-30', 'llámame el jueves'))
    ok('sin día de la semana en la frase, no hay nada que comprobar', fechaCuadraConLaFrase('2026-10-30', 'llámame mañana') && fechaCuadraConLaFrase('2027-01-07', 'después de Reyes'))
    ok('con dos días en la frase tampoco se puede comprobar', fechaCuadraConLaFrase('2026-10-30', 'el martes no puedo, llámame el jueves'))
  }

  console.log('\n=== enseñar un día ===')
  {
    ok('este año, sin año', diaConAnio('2026-12-02', '2026-10-26') === 'mié 2 dic')
    ok('otro año, con año', diaConAnio('2027-01-07', '2026-10-26') === 'jue 7 ene 2027')
  }

  console.log('\n=== constantes y texto para la IA ===')
  {
    ok('los estados que se pueden tocar son los de siempre', ESTADOS_QUE_SE_PUEDEN_TOCAR.join() === 'pendiente,no_contesta,programado,email_enviado')
    ok('no se programa más allá de 400 días', MAX_DIAS_DE_RELLAMADA === 400)
    ok('el texto explica mañana, el jueves, el mes, las fiestas y las campañas', ['«mañana»', 'el jueves', '«en enero»', 'después de Reyes', 'el 7 de enero', 'Black Friday', 'el 1 de diciembre', 'Nunca un día anterior a hoy'].every((t) => COMO_SACAR_EL_DIA.includes(t)))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
