import { acortar, aTexto, booleano, entero, opcion, texto } from '@/lib/mcp/argumentos'
import {
  ErrorDeHerramienta,
  VERSIONES_SOPORTADAS,
  procesarPost,
  type EntornoMcp,
  type Herramienta,
} from '@/lib/mcp/protocolo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Tres herramientas de mentira: una que sale bien, una que falla «con motivo» y una que revienta */
const bien: Herramienta<{ quien: string }> = {
  nombre: 'saludar',
  titulo: 'Saludar',
  descripcion: 'Saluda a un cliente',
  esquema: {
    type: 'object',
    properties: { cliente: { type: 'string' }, veces: { type: 'integer' } },
    required: ['cliente'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const c = texto(args, 'cliente', { requerido: true })
    const n = entero(args, 'veces', { min: 1, max: 3, defecto: 1 })
    return { texto: `hola ${c} x${n} de ${ctx.quien}`, estructurado: { c, n } }
  },
}
const conMotivo: Herramienta<{ quien: string }> = {
  nombre: 'falla_con_motivo',
  titulo: 'Falla con motivo',
  descripcion: 'x',
  esquema: { type: 'object', additionalProperties: false },
  soloLectura: true,
  async ejecutar() {
    throw new ErrorDeHerramienta('No existe ese cliente.')
  },
}
const revienta: Herramienta<{ quien: string }> = {
  nombre: 'revienta',
  titulo: 'Revienta',
  descripcion: 'x',
  esquema: { type: 'object', additionalProperties: false },
  soloLectura: true,
  async ejecutar() {
    throw new Error('relation "secreta" does not exist en 10.0.0.5')
  },
}

const registro: Array<{ nombre: string; esError: boolean }> = []
const entorno: EntornoMcp<{ quien: string }> = {
  nombreServidor: 'prueba',
  tituloServidor: 'Servidor de prueba',
  version: '9.9.9',
  instrucciones: 'Solo lectura.',
  herramientas: [bien, conMotivo, revienta],
  alTerminarHerramienta: (i) => registro.push({ nombre: i.nombre, esError: i.esError }),
}
const ctx = { quien: 'raul' }
const enviar = (mensaje: unknown, cabeceraVersion: string | null = null) =>
  procesarPost({ cuerpoCrudo: typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje), cabeceraVersion, entorno, ctx })
const peticion = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })

async function principal() {
  console.log('\n=== mensajes que no son MCP ===')
  {
    const roto = await enviar('{esto no es json')
    ok('JSON roto: 400 y -32700', roto.status === 400 && (roto.cuerpo as { error: { code: number } }).error.code === -32700)
    const lote = await enviar([peticion('ping')])
    ok('un lote se rechaza (la spec ya no los admite)', lote.status === 400)
    const sinVersion = await enviar({ id: 1, method: 'ping' })
    ok('sin «jsonrpc: 2.0»: 400', sinVersion.status === 400)
    const idRaro = await enviar({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' })
    ok('un id que no es texto ni número: 400', idRaro.status === 400)
    const incompleto = await enviar({ jsonrpc: '2.0' })
    ok('un mensaje sin método ni resultado: 400', incompleto.status === 400)
  }

  console.log('\n=== notificaciones y respuestas del cliente ===')
  {
    const n = await enviar({ jsonrpc: '2.0', method: 'notifications/initialized' })
    ok('una notificación: 202 y sin cuerpo', n.status === 202 && n.cuerpo === undefined)
    const r = await enviar({ jsonrpc: '2.0', id: 7, result: {} })
    ok('una respuesta del cliente: 202 y sin cuerpo', r.status === 202 && r.cuerpo === undefined)
  }

  console.log('\n=== initialize ===')
  {
    const r = await enviar(peticion('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } }))
    const res = (r.cuerpo as { result: Record<string, any> }).result
    ok('200', r.status === 200)
    ok('contesta la misma versión si la conoce', res.protocolVersion === '2025-06-18')
    ok('declara solo herramientas', JSON.stringify(Object.keys(res.capabilities)) === '["tools"]')
    ok('sin avisos de cambios en la lista', res.capabilities.tools.listChanged === false)
    ok('nombre, título y versión del servidor', res.serverInfo.name === 'prueba' && res.serverInfo.title === 'Servidor de prueba' && res.serverInfo.version === '9.9.9')
    ok('lleva las instrucciones', res.instructions === 'Solo lectura.')
    const futura = await enviar(peticion('initialize', { protocolVersion: '2099-01-01' }))
    ok('versión desconocida: ofrece la más reciente que sabe', (futura.cuerpo as any).result.protocolVersion === VERSIONES_SOPORTADAS[0])
    const sinVersion = await enviar(peticion('initialize', {}))
    ok('sin versión: ofrece la más reciente', (sinVersion.cuerpo as any).result.protocolVersion === VERSIONES_SOPORTADAS[0])
  }

  console.log('\n=== la cabecera MCP-Protocol-Version ===')
  {
    const mala = await enviar(peticion('ping'), '1999-01-01')
    ok('versión desconocida: 400', mala.status === 400)
    const buena = await enviar(peticion('ping'), '2025-11-25')
    ok('versión conocida: 200', buena.status === 200)
    const ausente = await enviar(peticion('ping'), null)
    ok('sin cabecera: 200 (se da por buena la 2025-03-26)', ausente.status === 200)
    const vacia = await enviar(peticion('ping'), '')
    ok('cabecera vacía: como si no estuviera', vacia.status === 200)
  }

  console.log('\n=== ping y métodos que no existen ===')
  {
    const p = await enviar(peticion('ping'))
    ok('ping contesta {}', JSON.stringify((p.cuerpo as any).result) === '{}')
    const otro = await enviar(peticion('resources/list'))
    ok('un método que no ofrecemos: -32601', (otro.cuerpo as any).error.code === -32601 && otro.status === 200)
    const prompts = await enviar(peticion('prompts/list'))
    ok('prompts tampoco', (prompts.cuerpo as any).error.code === -32601)
  }

  console.log('\n=== tools/list ===')
  {
    const r = await enviar(peticion('tools/list'))
    const tools = (r.cuerpo as any).result.tools as Array<Record<string, any>>
    ok('las tres herramientas', tools.map((t) => t.name).join() === 'saludar,falla_con_motivo,revienta')
    ok('cada una con su esquema, título y descripción', tools.every((t) => t.inputSchema?.type === 'object' && t.title && t.description))
    ok('marcadas como solo lectura y no destructivas', tools.every((t) => t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false))
    ok('no hablan con el mundo abierto', tools.every((t) => t.annotations.openWorldHint === false))
    ok('el esquema es el publicado', JSON.stringify(tools[0].inputSchema.required) === '["cliente"]')
  }

  console.log('\n=== tools/call ===')
  {
    registro.length = 0
    const r = await enviar(peticion('tools/call', { name: 'saludar', arguments: { cliente: 'shoesf', veces: '2' } }))
    const res = (r.cuerpo as any).result
    ok('sale bien', r.status === 200 && res.isError === false)
    ok('el texto lo monta la herramienta, con el contexto', res.content[0].text === 'hola shoesf x2 de raul', res.content[0].text)
    ok('el contenido es de tipo texto', res.content[0].type === 'text')
    ok('devuelve también el contenido estructurado', res.structuredContent.c === 'shoesf')
    ok('se avisa al registro, sin error', registro.length === 1 && registro[0].nombre === 'saludar' && !registro[0].esError)

    const sinArgs = await enviar(peticion('tools/call', { name: 'saludar' }))
    ok('falta un argumento obligatorio: error de ejecución, no de protocolo', (sinArgs.cuerpo as any).result.isError === true && /cliente/.test((sinArgs.cuerpo as any).result.content[0].text))

    const rarito = await enviar(peticion('tools/call', { name: 'saludar', arguments: { cliente: 'x', cliente_slug: 'y' } }))
    ok('un argumento que no existe se rechaza y dice cuáles valen', (rarito.cuerpo as any).result.isError === true && /cliente_slug/.test((rarito.cuerpo as any).result.content[0].text) && /cliente, veces/.test((rarito.cuerpo as any).result.content[0].text))

    const fueraDeRango = await enviar(peticion('tools/call', { name: 'saludar', arguments: { cliente: 'x', veces: 99 } }))
    ok('un número fuera de rango: error con el rango', (fueraDeRango.cuerpo as any).result.isError === true && /entre 1 y 3/.test((fueraDeRango.cuerpo as any).result.content[0].text))

    const motivo = await enviar(peticion('tools/call', { name: 'falla_con_motivo', arguments: {} }))
    ok('un fallo con motivo se cuenta tal cual', (motivo.cuerpo as any).result.isError === true && (motivo.cuerpo as any).result.content[0].text === 'No existe ese cliente.')

    const rev = await enviar(peticion('tools/call', { name: 'revienta', arguments: {} }))
    const textoRev = (rev.cuerpo as any).result.content[0].text as string
    ok('un fallo inesperado NO se cuenta (puede llevar nombres de tablas o direcciones)', (rev.cuerpo as any).result.isError === true && !/secreta|10\.0\.0\.5/.test(textoRev), textoRev)

    ok('el registro ve los errores', registro.filter((x) => x.esError).length >= 4)

    const noExiste = await enviar(peticion('tools/call', { name: 'no_existe', arguments: {} }))
    ok('una herramienta que no existe: error de protocolo -32602', (noExiste.cuerpo as any).error.code === -32602)

    const sinNombre = await enviar(peticion('tools/call', { arguments: {} }))
    ok('sin nombre: -32602', (sinNombre.cuerpo as any).error.code === -32602)

    const argsMalos = await enviar(peticion('tools/call', { name: 'saludar', arguments: [1, 2] }))
    ok('argumentos que no son un objeto: -32602', (argsMalos.cuerpo as any).error.code === -32602)

    const sinArgumentos = await enviar(peticion('tools/call', { name: 'falla_con_motivo' }))
    ok('sin «arguments» se toma como {}', (sinArgumentos.cuerpo as any).result.content[0].text === 'No existe ese cliente.')
  }

  console.log('\n=== el registro no puede romper la respuesta ===')
  {
    const roto: EntornoMcp<{ quien: string }> = { ...entorno, alTerminarHerramienta: () => { throw new Error('la tabla no existe') } }
    const r = await procesarPost({ cuerpoCrudo: JSON.stringify(peticion('tools/call', { name: 'saludar', arguments: { cliente: 'x' } })), cabeceraVersion: null, entorno: roto, ctx })
    ok('si el registro lanza, la herramienta contesta igual', r.status === 200 && (r.cuerpo as any).result.isError === false)
  }

  console.log('\n=== los validadores de argumentos ===')
  {
    const lanza = (f: () => unknown) => { try { f(); return null } catch (e) { return e instanceof ErrorDeHerramienta ? e.message : `OTRO: ${e}` } }
    ok('texto: recorta espacios', texto({ a: '  hola ' }, 'a') === 'hola')
    ok('texto: vacío no obligatorio = undefined', texto({ a: '   ' }, 'a') === undefined)
    ok('texto: vacío obligatorio lanza', /Falta/.test(lanza(() => texto({}, 'a', { requerido: true })) ?? ''))
    ok('texto: un número no vale', /texto/.test(lanza(() => texto({ a: 5 }, 'a')) ?? ''))
    ok('texto: demasiado largo', /demasiado largo/.test(lanza(() => texto({ a: 'x'.repeat(30) }, 'a', { max: 10 })) ?? ''))
    ok('entero: defecto', entero({}, 'n', { min: 1, max: 5, defecto: 3 }) === 3)
    ok('entero: acepta «20» como texto', entero({ n: '20' }, 'n', { min: 1, max: 50, defecto: 1 }) === 20)
    ok('entero: rechaza decimales', /entero/.test(lanza(() => entero({ n: 1.5 }, 'n', { min: 1, max: 5, defecto: 1 })) ?? ''))
    ok('entero: rechaza texto raro', /entero/.test(lanza(() => entero({ n: 'mucho' }, 'n', { min: 1, max: 5, defecto: 1 })) ?? ''))
    ok('entero: rango', /entre 1 y 5/.test(lanza(() => entero({ n: 6 }, 'n', { min: 1, max: 5, defecto: 1 })) ?? ''))
    ok('booleano: defecto', booleano({}, 'b') === false && booleano({}, 'b', true) === true)
    ok('booleano: «true» como texto', booleano({ b: 'true' }, 'b') === true)
    ok('booleano: lo raro lanza', /verdadero o falso/.test(lanza(() => booleano({ b: 'quizá' }, 'b')) ?? ''))
    ok('opción: válida', opcion({ o: 'b' }, 'o', ['a', 'b'] as const, 'a') === 'b')
    ok('opción: defecto', opcion({}, 'o', ['a', 'b'] as const, 'a') === 'a')
    ok('opción: dice cuáles valen', /a, b/.test(lanza(() => opcion({ o: 'z' }, 'o', ['a', 'b'] as const, 'a')) ?? ''))
    ok('acortar: respeta lo corto', acortar('hola', 10) === 'hola')
    ok('acortar: corta con puntos suspensivos', acortar('x'.repeat(50), 10)?.length === 10 && acortar('x'.repeat(50), 10)?.endsWith('…') === true)
    ok('acortar: null', acortar(null, 10) === null)
    const largo = aTexto({ filas: Array.from({ length: 5000 }, (_, i) => ({ i, texto: 'abcdefghij' })) }, 2000)
    ok('aTexto: pone un techo y lo avisa dentro', largo.length < 2300 && /respuesta cortada/.test(largo))
    ok('aTexto: lo corto va entero', aTexto({ a: 1 }) === '{\n "a": 1\n}')
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
