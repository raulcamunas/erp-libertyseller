import { claseDeAdjunto, extensionDe, formatoDeTamano, MAX_BYTES_ADJUNTO, motivoDeRechazo, nombreLimpio, rutaDeAdjunto } from '@/lib/tareas-clientes/adjuntos'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}

igual('extensión en minúsculas', [extensionDe('Informe.PDF'), extensionDe('sin_ext'), extensionDe('a.tar.gz')], ['pdf', '', 'gz'])
igual('clases', ['a.xlsx', 'b.PDF', 'c.png', 'd.docx', 'e.mp4', 'f.zzz'].map(claseDeAdjunto), ['hoja', 'pdf', 'imagen', 'documento', 'video', 'otro'])
igual('lo ejecutable se rechaza', [motivoDeRechazo('virus.exe', 10) !== null, motivoDeRechazo('pagina.html', 10) !== null, motivoDeRechazo('script.JS', 10) !== null], [true, true, true])
igual('un PDF normal vale', motivoDeRechazo('informe.pdf', 1000), null)
igual('vacío o enorme se rechaza', [motivoDeRechazo('a.pdf', 0) !== null, motivoDeRechazo('a.pdf', MAX_BYTES_ADJUNTO + 1) !== null, motivoDeRechazo('a.pdf', MAX_BYTES_ADJUNTO)], [true, true, null])
igual('el nombre pierde la ruta y lo raro', nombreLimpio('C:\\Users\\yo\\..\\Informe  final?.pdf'), 'Informe final.pdf')
igual('un nombre larguísimo conserva la extensión', nombreLimpio(`${'a'.repeat(300)}.xlsx`).endsWith('.xlsx') && nombreLimpio(`${'a'.repeat(300)}.xlsx`).length === 140, true)
igual('un nombre vacío', nombreLimpio('///'), 'archivo')
igual('la ruta no lleva el nombre original', rutaDeAdjunto('t1', 'a1', '../../etc/pa sswd.PDF'), 't1/a1.pdf')
igual('tamaños', [formatoDeTamano(500), formatoDeTamano(2048), formatoDeTamano(1.5 * 1024 * 1024), formatoDeTamano(20 * 1024 * 1024)], ['500 B', '2 KB', '1,5 MB', '20 MB'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
