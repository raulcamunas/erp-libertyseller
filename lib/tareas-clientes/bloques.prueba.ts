import {
  arbolParaNotion,
  bloquesDesdeNotion,
  contarChecklist,
  esUrlDeNotion,
  estaBloqueado,
  huellaDeContenido,
  juntarIguales,
  planDeContenido,
  progresoDeChecklist,
  segmentosDesdeNotion,
  textoParaNotion,
  textoPlano,
  type Bloque,
  type BloqueNotion,
} from '@/lib/tareas-clientes/bloques'
import { colocar, hayQueRenumerar, ordenAlFinal, ordenEntre, SEPARACION } from '@/lib/tareas-clientes/orden'
import { colorCss, colorValido, fondoAnimadoId, fondoCss } from '@/lib/tareas-clientes/colores'

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

/* ---------- orden ---------- */
igual('en una columna vacía, el primero', ordenEntre(null, null), SEPARACION)
igual('al final', ordenEntre(2048, null), 3072)
igual('al principio', ordenEntre(null, 1024), 0)
igual('entre dos, la media', ordenEntre(1024, 2048), 1536)
igual('el último de una columna', ordenAlFinal([1024, 4096, 2048]), 5120)
igual('dos números pegados piden renumerar', hayQueRenumerar(1, 1 + 1e-9), true)
igual('dos separados, no', hayQueRenumerar(1, 2), false)
const orden = new Map([['a', 1024], ['b', 2048], ['c', 3072]])
igual('soltar entre a y b', colocar(['a', 'b', 'c'], orden, 1).orden, 1536)
igual('soltar al final', colocar(['a', 'b', 'c'], orden, 3).orden, 4096)
igual('soltar al principio', colocar(['a', 'b', 'c'], orden, 0).orden, 0)
igual('en una columna vacía', colocar([], new Map(), 0).orden, SEPARACION)
const pegados = new Map([['a', 5], ['b', 5 + 1e-9]])
const r = colocar(['a', 'b'], pegados, 1)
igual('si no cabe, renumera toda la columna y deja hueco', [r.renumeradas?.map((x) => x.id).join(), r.orden], [['a,b'].join(), 2048])

/* ---------- colores ---------- */
igual('un color que no existe, neutro', colorValido('verdeagua'), 'default')
igual('un color como variable', colorCss('blue'), 'var(--tc-blue)')
igual('un degradado conocido se pinta', fondoCss({ tipo: 'degradado', valor: 'aurora' })?.startsWith('linear-gradient'), true)
igual('un degradado que no existe, nada', fondoCss({ tipo: 'degradado', valor: 'inventado' }), null)
igual('una imagen https se acepta', fondoCss({ tipo: 'imagen', valor: 'https://x.supabase.co/a.png' }), 'url("https://x.supabase.co/a.png")')
igual('una imagen que intenta salirse del url() se rechaza', fondoCss({ tipo: 'imagen', valor: 'https://x.co/a.png") ;x:(' }), null)
igual('javascript: no es una imagen', fondoCss({ tipo: 'imagen', valor: 'javascript:alert(1)' }), null)
igual('un fondo animado de la lista', fondoAnimadoId({ tipo: 'animado', valor: 'aurora' }), 'aurora')
igual('un fondo animado que no existe, nada', fondoAnimadoId({ tipo: 'animado', valor: 'inventado' }), null)
igual('un color no es un fondo animado', fondoAnimadoId({ tipo: 'color', valor: 'aurora' }), null)
igual('un fondo animado no se pinta como CSS suelto', fondoCss({ tipo: 'animado', valor: 'aurora' }), null)
igual('un hexadecimal, tal cual', fondoCss({ tipo: 'color', valor: '#245ea8' }), '#245ea8')

/* ---------- texto con formato ---------- */
const notionTexto = [
  { plain_text: 'Hola ', annotations: { bold: true, color: 'default' } },
  { plain_text: 'mundo', annotations: { bold: true, color: 'default' } },
  { plain_text: ' y ', annotations: { color: 'default' } },
  { plain_text: 'enlace', href: 'https://x.es', annotations: { italic: true, color: 'red' } },
]
const seg = segmentosDesdeNotion(notionTexto)
igual('une los trozos vecinos con el mismo formato', seg.map((s) => s.t), ['Hola mundo', ' y ', 'enlace'])
igual('guarda el formato, el enlace y el color', [seg[0].b, seg[2].i, seg[2].l, seg[2].k], [true, true, 'https://x.es', 'red'])
igual('vuelve a Notion con sus anotaciones', textoParaNotion(seg).map((x) => [x.text?.content, x.annotations?.bold, x.text?.link?.url ?? null]), [['Hola mundo', true, null], [' y ', false, null], ['enlace', false, 'https://x.es']])
igual('un texto de más de 2000 caracteres se parte', textoParaNotion([{ t: 'a'.repeat(4500) }]).map((x) => x.text?.content?.length), [2000, 2000, 500])
igual('un trozo vacío no manda nada', textoParaNotion([{ t: '' }]), [])
igual('juntarIguales no junta formatos distintos', juntarIguales([{ t: 'a', b: true }, { t: 'b' }]).length, 2)

/* ---------- de Notion al editor ---------- */
const parrafo = (id: string, t: string, extra: Partial<BloqueNotion> = {}): BloqueNotion => ({ id, type: 'paragraph', paragraph: { rich_text: [{ plain_text: t }] }, ...extra })
const delNotion: BloqueNotion[] = [
  { id: 'n1', type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Lista de Tareas' }] } },
  { id: 'n2', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Confirmar recogida' }], checked: true }, has_children: true, children: [{ id: 'n2a', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Llamar' }], checked: false } }] },
  { id: 'n3', type: 'to_do', to_do: { rich_text: [{ plain_text: 'Avisar' }], checked: false } },
  { id: 'n4', type: 'table', table: {}, has_children: true },
  { id: 'n5', type: 'callout', callout: { rich_text: [{ plain_text: 'Ojo' }], icon: { type: 'emoji', emoji: '🔥' } } },
  { id: 'n6', type: 'image', image: { type: 'external', external: { url: 'https://x.es/a.png' }, caption: [{ plain_text: 'pie' }] } },
  { id: 'n7', type: 'code', code: { rich_text: [{ plain_text: 'let a = 1' }], language: 'javascript' } },
  parrafo('n8', 'Contexto'),
  { id: 'n9', type: 'child_database', child_database: { title: 'Pedidos' } },
]
const bloques = bloquesDesdeNotion(delNotion)
igual('cada bloque conocido pasa a su tipo', bloques.map((b) => b.tipo), ['h1', 'tarea', 'tarea', 'tarea', 'notion', 'aviso', 'imagen', 'codigo', 'parrafo', 'notion'])
igual('los hijos se aplanan con un nivel más', bloques.map((b) => b.nivel ?? 0), [0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
igual('cada uno guarda su bloque de Notion', bloques.map((b) => b.notion_id).slice(0, 4), ['n1', 'n2', 'n2a', 'n3'])
igual('un bloque que no se sabe editar enseña qué es', [bloques[4].vista, bloques[9].vista], ['Tabla', 'Base de datos: Pedidos'])
igual('el aviso lleva su emoji y el código su lenguaje', [bloques[5].icono, bloques[7].lenguaje], ['🔥', 'javascript'])
igual('la imagen lleva su dirección y su pie', [bloques[6].url, bloques[6].texto[0]?.t], ['https://x.es/a.png', 'pie'])
igual('cuenta las casillas', contarChecklist(bloques), { total: 3, hecho: 1 })
igual('el progreso sale de la checklist', [progresoDeChecklist({ total: 3, hecho: 1 }), progresoDeChecklist({ total: 0, hecho: 0 })], [33, null])
igual('el texto plano incluye lo que se ve', textoPlano(bloques).includes('Confirmar recogida') && textoPlano(bloques).includes('Base de datos: Pedidos'), true)

/* ---------- del editor a Notion ---------- */
const editor: Bloque[] = [
  { id: 'a', tipo: 'h1', texto: [{ t: 'Plan' }] },
  { id: 'b', tipo: 'vineta', texto: [{ t: 'Uno' }] },
  { id: 'c', tipo: 'vineta', texto: [{ t: 'Uno.a' }], nivel: 1 },
  { id: 'd', tipo: 'vineta', texto: [{ t: 'Uno.b' }], nivel: 1 },
  { id: 'e', tipo: 'tarea', texto: [{ t: 'Dos' }], hecho: true },
  { id: 'f', tipo: 'notion', texto: [], notion_id: 'x', notion_tipo: 'table', vista: 'Tabla' },
  { id: 'g', tipo: 'divisor', texto: [] },
]
const arbol = arbolParaNotion(editor) as Array<{ type: string; [k: string]: unknown }>
igual('los bloques de arriba quedan en la raíz, sin el ajeno', arbol.map((x) => x.type), ['heading_1', 'bulleted_list_item', 'to_do', 'divider'])
const vineta = arbol[1].bulleted_list_item as { children?: Array<{ type: string }> }
igual('los de nivel 1 cuelgan del anterior', vineta.children?.map((x) => x.type), ['bulleted_list_item', 'bulleted_list_item'])
igual('uno sin hijos no lleva la lista vacía', 'children' in (arbol[2].to_do as object), false)
igual('la casilla marcada viaja marcada', (arbol[2].to_do as { checked: boolean }).checked, true)

/* ---------- el plan de cambios ---------- */
const conIds = (lista: Bloque[]) => lista.map((b, i) => ({ ...b, notion_id: b.notion_id ?? `id${i}` }))
const base = conIds([{ id: '1', tipo: 'parrafo', texto: [{ t: 'a' }] }, { id: '2', tipo: 'tarea', texto: [{ t: 'b' }], hecho: false }])
igual('sin cambios, nada', planDeContenido(base, base).modo, 'nada')
const editado = base.map((b, i) => (i === 1 ? { ...b, hecho: true } : b))
const sinAjenos = planDeContenido(base, editado)
igual('sin bloques ajenos, se reemplaza todo', [sinAjenos.modo, sinAjenos.modo === 'reemplazar' ? sinAjenos.borrar : null], ['reemplazar', ['id0', 'id1']])
const conAjeno = conIds([...base, { id: '3', tipo: 'notion', texto: [], notion_id: 'tabla1', notion_tipo: 'table', vista: 'Tabla' }])
const cambio = conAjeno.map((b, i) => (i === 1 ? { ...b, hecho: true } : b))
const dif = planDeContenido(conAjeno, [...cambio, { id: '4', tipo: 'parrafo', texto: [{ t: 'nuevo' }] }])
igual('con un bloque ajeno solo se toca lo cambiado', dif.modo === 'diferencial' ? [dif.actualizar.map((b) => b.notion_id), dif.crear.map((b) => textoPlano([b])), dif.borrar] : dif, [['id1'], ['nuevo'], []])
const sinUno = planDeContenido(conAjeno, conAjeno.filter((b) => b.notion_id !== 'id0'))
igual('lo que se quita se borra, y el ajeno nunca', sinUno.modo === 'diferencial' ? sinUno.borrar : sinUno, ['id0'])
const cambioDeTipo = planDeContenido(conAjeno, conAjeno.map((b, i) => (i === 0 ? { ...b, tipo: 'h2' as const } : b)))
igual('cambiar de tipo es borrar y crear', cambioDeTipo.modo === 'diferencial' ? [cambioDeTipo.borrar, cambioDeTipo.crear.length] : cambioDeTipo, [['id0'], 1])
igual('la huella no depende de los ids de aquí', huellaDeContenido([{ id: 'x', tipo: 'parrafo', texto: [{ t: 'a' }] }]), huellaDeContenido([{ id: 'otro', tipo: 'parrafo', texto: [{ t: 'a' }] }]))
igual('y cambia cuando cambia el texto', huellaDeContenido([{ id: 'x', tipo: 'parrafo', texto: [{ t: 'a' }] }]) === huellaDeContenido([{ id: 'x', tipo: 'parrafo', texto: [{ t: 'b' }] }]), false)

/* ---------- desplegables, tablas e imágenes ---------- */
const toggleNotion = [
  { id: 't1', type: 'toggle', has_children: true, toggle: { rich_text: [{ plain_text: 'Detalles', annotations: {} }] }, children: [{ id: 't1a', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Dentro', annotations: {} }] } }] },
]
const deToggle = bloquesDesdeNotion(toggleNotion as never)
igual('un toggle de Notion es un desplegable con sus hijos aplanados', deToggle.map((b) => [b.tipo, b.nivel ?? 0, textoPlano([b])]), [['desplegable', 0, 'Detalles'], ['parrafo', 1, 'Dentro']])
const arbolToggle = arbolParaNotion(deToggle) as Array<{ type: string; toggle?: { children?: Array<{ type: string }> } }>
igual('y vuelve a ser un toggle con su hijo dentro', [arbolToggle[0].type, arbolToggle[0].toggle?.children?.map((x) => x.type)], ['toggle', ['paragraph']])

const tablaNotion = [
  { id: 'tb', type: 'table', has_children: true, table: { table_width: 2, has_column_header: true, has_row_header: false }, children: [
    { id: 'r1', type: 'table_row', table_row: { cells: [[{ plain_text: 'A', annotations: { bold: true } }], [{ plain_text: 'B', annotations: {} }]] } },
    { id: 'r2', type: 'table_row', table_row: { cells: [[{ plain_text: '1', annotations: {} }], []] } },
  ] },
]
const [tabla] = bloquesDesdeNotion(tablaNotion as never)
igual('una tabla de Notion es una tabla editable', [tabla.tipo, tabla.filas?.length, tabla.filaIds, tabla.encabezadoFila, tabla.encabezadoColumna], ['tabla', 2, ['r1', 'r2'], true, false])
igual('con el formato de cada celda', tabla.filas?.[0][0], [{ t: 'A', b: true }])
const arbolTabla = arbolParaNotion([{ ...tabla, notion_id: undefined }]) as Array<{ type: string; table: { table_width: number; has_column_header: boolean; children: Array<{ type: string; table_row: { cells: unknown[][] } }> } }>
igual('se manda con su ancho, su encabezado y sus filas (rellenas hasta el ancho)', [arbolTabla[0].type, arbolTabla[0].table.table_width, arbolTabla[0].table.has_column_header, arbolTabla[0].table.children.map((f) => f.table_row.cells.length)], ['table', 2, true, [2, 2]])
igual('una tabla sin hijos traídos sigue siendo un bloque ajeno', bloquesDesdeNotion([{ id: 'x', type: 'table', has_children: true, table: { table_width: 2 } }] as never)[0].tipo, 'notion')
igual('el texto de las celdas cuenta para buscar', textoPlano([tabla]).includes('A B'), true)

igual('una dirección firmada de Notion caduca (se copia)', esUrlDeNotion('https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/notion/imagen.png?X-Amz-Signature=1'), true)
igual('el almacén de ficheros de Notion (prod-files-secure) también', esUrlDeNotion('https://prod-files-secure.s3.us-west-2.amazonaws.com/4cc4eb84-0d9d/746c9208/Captura.png?X-Amz-Algorithm=AWS4-HMAC-SHA256'), true)
igual('un fichero de notion.so también', esUrlDeNotion('https://www.notion.so/image/https%3A%2F%2Fx?table=block'), true)
igual('una dirección nuestra no', esUrlDeNotion('https://abc.supabase.co/storage/v1/object/public/tareas-portadas/notion/a.png'), false)
igual('un amazonaws que no es de Notion no', esUrlDeNotion('https://s3.amazonaws.com/mi-bucket/a.png'), false)
igual('sin dirección, no', esUrlDeNotion(undefined), false)
const imagenDeNotion: Bloque = { id: 'i', tipo: 'imagen', texto: [], url: 'https://x/a.png', notion_id: 'img1' }
igual('una imagen que viene de Notion es un bloque protegido', estaBloqueado(imagenDeNotion), true)
igual('una imagen subida desde aquí (sin id de Notion) se puede mover y borrar', estaBloqueado({ id: 'j', tipo: 'imagen', texto: [], url: 'https://x/b.png' }), false)
const arbolImagen = arbolParaNotion([{ id: 'j', tipo: 'imagen', texto: [{ t: 'Pie' }], url: 'https://x/b.png' }]) as Array<{ type: string; image: { type: string; external: { url: string } } }>
igual('se manda como imagen externa', [arbolImagen[0].type, arbolImagen[0].image.type, arbolImagen[0].image.external.url], ['image', 'external', 'https://x/b.png'])
igual('la huella no depende de la dirección firmada de una imagen de Notion', huellaDeContenido([imagenDeNotion]), huellaDeContenido([{ ...imagenDeNotion, url: 'https://x/otra-firma.png' }]))

const conImagen = conIds([{ id: '1', tipo: 'parrafo', texto: [{ t: 'a' }] }, { ...imagenDeNotion, notion_id: undefined }])
const planImagen = planDeContenido(conImagen, [...conImagen.slice(0, 1).map((b) => ({ ...b, texto: [{ t: 'a cambiado' }] })), conImagen[1]])
igual('con una imagen en la página, editar un párrafo NO borra la imagen', planImagen.modo === 'diferencial' ? [planImagen.borrar, planImagen.actualizar.map((b) => b.notion_id)] : planImagen, [[], ['id0']])

const conTabla = conIds([{ id: '1', tipo: 'parrafo', texto: [{ t: 'a' }] }, { ...tabla, notion_id: undefined }, { id: '3', tipo: 'parrafo', texto: [{ t: 'z' }] }])
const planTabla = planDeContenido(conTabla, conTabla.map((b, i) => (i === 0 ? { ...b, texto: [{ t: 'a2' }] } : b)))
igual('con una tabla, tocar un párrafo no recrea la tabla', planTabla.modo === 'diferencial' ? [planTabla.borrar, planTabla.crear.length, planTabla.actualizar.map((b) => b.tipo)] : planTabla, [[], 0, ['parrafo']])
const tablaEditada = conTabla.map((b) => (b.tipo === 'tabla' ? { ...b, filas: [[[{ t: 'A' }], [{ t: 'B2' }]], ...(b.filas ?? []).slice(1)] } : b))
const planCelda = planDeContenido(conTabla, tablaEditada)
igual('cambiar una celda actualiza la tabla (no la borra)', planCelda.modo === 'diferencial' ? [planCelda.actualizar.map((b) => b.tipo), planCelda.borrar] : planCelda, [['tabla'], []])

const medio = conIds([{ id: '1', tipo: 'parrafo', texto: [{ t: 'a' }] }, { id: '2', tipo: 'parrafo', texto: [{ t: 'b' }] }, { id: '3', tipo: 'notion', texto: [], notion_tipo: 'file', vista: 'Archivo' }])
const conNuevoEnMedio = [medio[0], { id: 'n', tipo: 'parrafo' as const, texto: [{ t: 'nuevo' }] }, medio[1], medio[2]]
const planMedio = planDeContenido(medio, conNuevoEnMedio)
igual('un párrafo nuevo en medio se añade DETRÁS del anterior, no al final', planMedio.modo === 'diferencial' ? planMedio.tramos.map((t) => [t.despues, t.bloques.map((b) => textoPlano([b]))]) : planMedio, [['id0', ['nuevo']]])
const planFinal = planDeContenido(medio, [...medio, { id: 'm', tipo: 'parrafo' as const, texto: [{ t: 'al final' }] }])
igual('uno nuevo al final va detrás del último bloque', planFinal.modo === 'diferencial' ? planFinal.tramos.map((t) => t.despues) : planFinal, ['id2'])
const planSeguidos = planDeContenido(medio, [medio[0], { id: 'n1', tipo: 'parrafo' as const, texto: [{ t: 'uno' }] }, { id: 'n2', tipo: 'parrafo' as const, texto: [{ t: 'dos' }] }, medio[1], medio[2]])
igual('varios nuevos seguidos forman un solo tramo', planSeguidos.modo === 'diferencial' ? planSeguidos.tramos.map((t) => [t.despues, t.bloques.length]) : planSeguidos, [['id0', 2]])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
