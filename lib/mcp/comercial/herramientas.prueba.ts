import { HERRAMIENTAS, INSTRUCCIONES } from '../herramientas'
import { HERRAMIENTAS_COMERCIALES, INSTRUCCIONES_COMERCIALES } from './herramientas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const NOMBRES_DE_LAS_COMERCIALES = [
  'rendimiento_equipo',
  'rendimiento_comercial',
  'cold_resumen',
  'cold_buscar_leads',
  'cold_ficha_lead',
  'cold_llamadas',
  'cold_transcripcion',
  'cold_notas',
  'agenda_citas',
  'correo_envios',
  'correo_cola',
  'correos_enviados',
  'correo_hilos',
  'correo_hilo',
]

console.log('\n=== el catálogo del conector ===')
{
  const nombres = HERRAMIENTAS.map((h) => h.nombre)
  ok('los nombres no se repiten', new Set(nombres).size === nombres.length)
  ok('todas las herramientas son de SOLO LECTURA', HERRAMIENTAS.every((h) => h.soloLectura === true))
  ok('ninguna declara que escribe', HERRAMIENTAS.every((h) => h.idempotente === undefined || h.idempotente === true))
  ok('nombres legibles para un modelo: minúsculas y guiones bajos, hasta 64', HERRAMIENTAS.every((h) => /^[a-z][a-z0-9_]{1,63}$/.test(h.nombre)))
  ok('todas tienen título y descripción', HERRAMIENTAS.every((h) => h.titulo.trim().length > 5 && h.descripcion.trim().length > 40))
  ok('los esquemas son objetos que no admiten argumentos de más', HERRAMIENTAS.every((h) => h.esquema.type === 'object' && h.esquema.additionalProperties === false))
  ok('lo que es obligatorio existe entre las propiedades', HERRAMIENTAS.every((h) => (h.esquema.required ?? []).every((r) => r in (h.esquema.properties ?? {}))))
  ok('cada argumento explica para qué sirve', HERRAMIENTAS.every((h) => Object.values(h.esquema.properties ?? {}).every((p) => typeof (p as { description?: unknown }).description === 'string' && ((p as { description: string }).description.length ?? 0) > 10)))
}

console.log('\n=== las del equipo comercial ===')
{
  const nombres = HERRAMIENTAS_COMERCIALES.map((h) => h.nombre)
  ok('son las catorce que se anuncian, ni más ni menos', JSON.stringify([...nombres].sort()) === JSON.stringify([...NOMBRES_DE_LAS_COMERCIALES].sort()), nombres.join())
  ok('forman parte del catálogo del conector', HERRAMIENTAS_COMERCIALES.every((c) => HERRAMIENTAS.includes(c)))
  ok('NO piden `cliente`: no son de una cuenta de Amazon', HERRAMIENTAS_COMERCIALES.every((h) => !('cliente' in (h.esquema.properties ?? {}))))
  ok('las de cuentas de Amazon siguen pidiéndolo', HERRAMIENTAS.filter((h) => !HERRAMIENTAS_COMERCIALES.includes(h)).filter((h) => h.nombre !== 'listar_clientes' && h.nombre !== 'estado_procesos').every((h) => 'cliente' in (h.esquema.properties ?? {})))
  ok('las instrucciones del conector nombran cada una (si no, el modelo no sabe por dónde empezar)', NOMBRES_DE_LAS_COMERCIALES.every((n) => INSTRUCCIONES.includes(`\`${n}\``)), NOMBRES_DE_LAS_COMERCIALES.filter((n) => !INSTRUCCIONES.includes(`\`${n}\``)).join())
  ok('y no nombran una que no exista', [...INSTRUCCIONES_COMERCIALES.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => /^(rendimiento|cold|correo|agenda)/.test(n)).every((n) => NOMBRES_DE_LAS_COMERCIALES.includes(n)))
  ok('las instrucciones avisan de que se leen los buzones de otros y queda rastro', /rastro de Correo/.test(INSTRUCCIONES))
  ok('y de que las cifras de Mi rendimiento cuentan clientes, no llamadas', /CLIENTE distinto/.test(INSTRUCCIONES))
  const peso = HERRAMIENTAS.reduce((s, h) => s + h.descripcion.length + JSON.stringify(h.esquema).length, 0)
  ok('el catálogo entero no se come el contexto del modelo (menos de 45.000 caracteres)', peso < 45_000, `${peso} caracteres`)
  ok('ninguna descripción pasa de 1.800 caracteres', HERRAMIENTAS.every((h) => h.descripcion.length <= 1800), HERRAMIENTAS.filter((h) => h.descripcion.length > 1800).map((h) => h.nombre).join())
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
