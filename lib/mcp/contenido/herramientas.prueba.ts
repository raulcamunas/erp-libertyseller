import { componer } from '@/lib/contenido/redes'
import { crearBaseFalsa } from '../comercial/base-falsa'
import { FANTASMA, MAOLI, MFER, ANA, RAUL, JHANNA, fallaCon, usar, uuid } from '../comercial/datos-de-pruebas'
import type { ContextoMcp } from '../contexto'
import { HERRAMIENTAS, INSTRUCCIONES } from '../herramientas'
import {
  HERRAMIENTAS_DE_CONTENIDO,
  INSTRUCCIONES_DE_CONTENIDO,
  avisosDeLaPieza,
  contenidoCalendario,
  contenidoPendientes,
  contenidoPieza,
  contenidoPiezas,
  elegirPieza,
  ficheroDe,
  lunesDeLaSemana,
  nombreDelDia,
  rangoDelCalendario,
  textosDeLaPieza,
  urlDeFichero,
  type PiezaLeida,
  type TextoLeido,
} from './herramientas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Fila = Record<string, unknown>

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proyecto.supabase.co/'
const RAIZ = 'https://proyecto.supabase.co/storage/v1/object/public/contenido/'

/** Miércoles 4 de noviembre de 2026, 11:00 en Madrid: el reloj de las pruebas no se mueve */
const AHORA = Date.UTC(2026, 10, 4, 10, 0, 0)
const HOY = '2026-11-04'

const V1 = uuid('8', 1)
const V2 = uuid('8', 2)
const C1 = uuid('8', 3)
const SIN_FICHERO = uuid('8', 4)
const SOLA = uuid('8', 5)
const V3 = uuid('8', 6)

const pieza = (id: string, e: Fila): Fila => ({
  id,
  tipo: 'video',
  titulo: '',
  slug: '',
  texto_post: '',
  angulo: null,
  origen: 'remotion',
  fichero_path: null,
  fichero_nombre: null,
  fichero_bytes: null,
  fichero_mime: null,
  vistas: [],
  creado_at: '2026-10-20T08:00:00.000Z',
  creado_por: RAUL,
  ...e,
})

const encargo = (n: number, fecha: string, pieza_id: string, responsable_id: string, estado: string, e: Fila = {}): Fila => ({
  id: uuid('7', n),
  fecha,
  pieza_id,
  responsable_id,
  estado,
  publicado_at: null,
  nota: null,
  creado_at: `2026-10-28T08:${String(n).padStart(2, '0')}:00.000Z`,
  ...e,
})

const texto = (n: number, pieza_id: string, red: string, t: string, hashtags: string[], e: Fila = {}): Fila => ({ id: uuid('6', n), pieza_id, red, texto: t, hashtags, comentario_fijado: null, actualizado_at: '2026-10-21T10:00:00.000Z', ...e })

function crear(extra: { sinTablas?: string[]; encargosDeMas?: Fila[]; tablas?: Record<string, Fila[] | null> } = {}) {
  const piezas: Fila[] = [
    pieza(V1, {
      titulo: 'El stock multi-país',
      slug: 'stock-multipais',
      angulo: 'Un solo almacén que envía fuera',
      texto_post: 'Vendes en cinco países y tienes un solo almacén.\n\n#AmazonFBA #Ecommerce',
      fichero_path: 'videos/2026/stock-multipais.mp4',
      fichero_nombre: 'stock-multipais.mp4',
      fichero_bytes: 24_000_000,
      fichero_mime: 'video/mp4',
      vistas: ['videos/2026/stock-multipais-portada.png'],
      creado_at: '2026-10-20T08:00:00.000Z',
    }),
    pieza(V2, { titulo: 'Black Friday sin sustos', slug: 'black-friday', texto_post: 'Black Friday: prepara el stock ya.', fichero_path: 'videos/2026/black-friday.mp4', fichero_nombre: 'black-friday.mp4', fichero_bytes: 8_000_000, fichero_mime: 'video/mp4', creado_at: '2026-10-27T08:00:00.000Z' }),
    pieza(C1, {
      tipo: 'carrusel',
      titulo: 'Cinco errores en el listing',
      slug: 'cinco-errores',
      texto_post: '5 errores que veo cada semana en los listings. #Amazon',
      fichero_path: 'carruseles/2026/cinco-errores.zip',
      fichero_nombre: 'cinco-errores.zip',
      fichero_bytes: 800_000,
      fichero_mime: 'application/zip',
      vistas: ['carruseles/2026/cinco-errores-1.png', 'carruseles/2026/cinco-errores-2.png', 'carruseles/2026/cinco-errores-3.png'],
      creado_at: '2026-10-22T08:00:00.000Z',
    }),
    pieza(SIN_FICHERO, { titulo: 'Borrador sin subir', slug: 'borrador', creado_at: '2026-10-29T08:00:00.000Z' }),
    pieza(SOLA, { tipo: 'carrusel', titulo: 'Pieza sin programar', slug: 'sin-programar', texto_post: 'Texto listo.', fichero_path: 'carruseles/2026/sin-programar.zip', fichero_nombre: 'sin-programar.zip', fichero_bytes: 500_000, fichero_mime: 'application/zip', creado_at: '2026-11-02T08:00:00.000Z' }),
    pieza(V3, { titulo: 'Vídeo a medias', slug: 'a-medias', texto_post: 'Gancho', creado_at: '2026-11-03T08:00:00.000Z' }),
  ]
  const textos: Fila[] = [
    { ...texto(1, V1, 'instagram', 'IG texto del stock', ['#amazonfba', '#ecommerce', '#stock'], { comentario_fijado: 'Enlace en la bio' }) },
    texto(2, V1, 'tiktok', 'TT stock', ['#amazon', '#fba', '#ecommerce', '#stock']),
    texto(3, V1, 'facebook', 'FB: un solo almacén para todos los países', ['#amazon', '#fba']),
    texto(4, V2, 'instagram', 'IG BF', ['#a', '#b', '#c', '#d', '#e', '#f', '#g']),
    texto(5, V2, 'tiktok', 'x'.repeat(2300), ['#bf']),
    // Un carrusel solo se publica en LinkedIn: este texto suelto no tiene que salir
    texto(6, C1, 'instagram', 'no debería salir', []),
  ]
  const encargos: Fila[] = [
    encargo(1, '2026-11-02', V1, MAOLI, 'programado'),
    encargo(2, '2026-11-04', V2, MAOLI, 'programado'),
    encargo(3, '2026-11-05', C1, RAUL, 'programado'),
    encargo(4, '2026-11-09', V1, MFER, 'programado'),
    encargo(5, '2026-11-03', C1, RAUL, 'publicado', { publicado_at: '2026-11-03T09:30:00.000Z' }),
    encargo(6, '2026-11-06', SIN_FICHERO, ANA, 'saltado', { nota: 'Se salta por festivo' }),
    encargo(7, '2026-10-20', V1, MAOLI, 'publicado', { publicado_at: '2026-10-20T10:00:00.000Z' }),
    encargo(8, '2026-11-30', V2, MFER, 'programado'),
    encargo(9, '2026-11-12', V3, ANA, 'programado'),
    ...(extra.encargosDeMas ?? []),
  ]
  const perfiles: Fila[] = [
    { id: RAUL, full_name: 'Raúl Camuñas', email: 'raul@libertyseller.com', role: 'admin' },
    { id: MAOLI, full_name: 'Maoli Pérez', email: 'maoli@libertyseller.com', role: 'employee' },
    { id: MFER, full_name: 'María Fernanda Ruiz', email: 'mariafernanda@libertyseller.com', role: 'employee' },
    { id: ANA, full_name: 'Ana López', email: 'ana@libertyseller.com', role: 'employee' },
    // Nadie publica con ella: no tiene que salir entre quienes se pueden elegir
    { id: JHANNA, full_name: 'Jhanna', email: 'jhanna@libertyseller.com', role: 'employee' },
  ]
  const tablas: Record<string, Fila[] | null> = { contenido_piezas: piezas, contenido_calendario: encargos, contenido_textos: textos, profiles: perfiles, ...(extra.tablas ?? {}) }
  for (const t of extra.sinTablas ?? []) tablas[t] = null
  const base = crearBaseFalsa(tablas)
  const ctx: ContextoMcp = { usuario: { id: RAUL, email: 'raul@libertyseller.com', rol: 'admin', clienteOAuth: 'prueba' }, servicio: base.servicio, ahora: AHORA }
  return { base, ctx, piezas, textos, encargos }
}

const leida = (id: string, e: Fila = {}): PiezaLeida => ({ ...(crear().piezas.find((p) => p.id === id) as Fila), ...e }) as unknown as PiezaLeida

async function main() {
  console.log('\n=== los enlaces de los ficheros ===')
  {
    ok('el enlace público del bucket «contenido», sin barras de más', urlDeFichero('videos/2026/a.mp4') === `${RAIZ}videos/2026/a.mp4`)
    ok('un nombre con espacios o acentos se codifica por trozos, sin tocar las carpetas', urlDeFichero('videos/mi vídeo.mp4') === `${RAIZ}videos/mi%20v%C3%ADdeo.mp4`)
    ok('con `download`, el navegador lo baja con ese nombre', urlDeFichero('videos/a.mp4', 'Mi vídeo.mp4') === `${RAIZ}videos/a.mp4?download=Mi%20v%C3%ADdeo.mp4`)
    ok('sin ruta, null', urlDeFichero(null) === null && urlDeFichero('') === null)
    const f = ficheroDe(leida(V1)) as any
    ok('el fichero: nombre, tipo, peso y los dos enlaces', f.nombre === 'stock-multipais.mp4' && f.tipo_mime === 'video/mp4' && f.peso === '22.9 MB' && f.url === `${RAIZ}videos/2026/stock-multipais.mp4` && f.url_de_descarga === `${RAIZ}videos/2026/stock-multipais.mp4?download=stock-multipais.mp4`)
    ok('una pieza sin fichero, null', ficheroDe(leida(V3)) === null)
    ok('el peso de un fichero pequeño, en KB', (ficheroDe(leida(C1)) as any).peso === '781 KB')
    const sinPeso = ficheroDe(leida(V1, { fichero_bytes: null })) as any
    ok('sin peso guardado, null y no «0»', sinPeso.peso === null)
    const otra = process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    ok('si no está configurada la URL de Supabase, null en vez de un enlace roto', urlDeFichero('videos/a.mp4') === null)
    process.env.NEXT_PUBLIC_SUPABASE_URL = otra
  }

  console.log('\n=== los días ===')
  {
    ok('el lunes de una semana, desde cualquier día', lunesDeLaSemana('2026-11-04') === '2026-11-02' && lunesDeLaSemana('2026-11-08') === '2026-11-02' && lunesDeLaSemana('2026-11-02') === '2026-11-02')
    ok('el nombre del día', nombreDelDia('2026-11-04') === 'Miércoles' && nombreDelDia('2026-11-08') === 'Domingo')
    const r = rangoDelCalendario(undefined, undefined, HOY)
    ok('sin fechas: desde el lunes de esta semana, 14 días', r.desde === '2026-11-02' && r.hasta === '2026-11-15')
    const d = rangoDelCalendario('2026-12-01', undefined, HOY)
    ok('solo «desde»: 14 días desde ahí', d.desde === '2026-12-01' && d.hasta === '2026-12-14')
    const h = rangoDelCalendario(undefined, '2026-12-14', HOY)
    ok('solo «hasta»: los 14 días hasta ahí', h.desde === '2026-12-01' && h.hasta === '2026-12-14')
    const t = rangoDelCalendario('2026-10-01', '2026-10-31', HOY)
    ok('los dos: tal cual', t.desde === '2026-10-01' && t.hasta === '2026-10-31')
    let msg = ''
    try {
      rangoDelCalendario('2026-11-10', '2026-11-01', HOY)
    } catch (e) {
      msg = (e as Error).message
    }
    ok('«hasta» antes de «desde», error', /no puede ser anterior/.test(msg), msg)
    msg = ''
    try {
      rangoDelCalendario('2026-01-01', '2026-12-31', HOY)
    } catch (e) {
      msg = (e as Error).message
    }
    ok('un año entero, error que pide acotar', /máximo es 92/.test(msg), msg)
    ok('noventa y dos días justos sí valen', rangoDelCalendario('2026-11-01', '2027-01-31', HOY).hasta === '2027-01-31')
  }

  console.log('\n=== el texto de cada red ===')
  {
    const todos = crear().textos as unknown as TextoLeido[]
    const v1 = textosDeLaPieza(leida(V1), todos)
    ok('un vídeo se publica en las cuatro redes, en este orden', v1.map((t) => t.red).join() === 'linkedin,instagram,tiktok,facebook')
    ok('todas con texto listo', v1.every((t) => t.listo))
    const li = v1[0]
    ok('LinkedIn: el texto del post tal cual, con sus hashtags escritos dentro y sin lista aparte', li.texto_para_publicar === 'Vendes en cinco países y tienes un solo almacén.\n\n#AmazonFBA #Ecommerce' && li.hashtags_aparte === undefined && li.hashtags_en_total === 2)
    const ig = v1[1]
    ok('Instagram: texto + hashtags debajo, justo lo que se pega', ig.texto_para_publicar === componer('IG texto del stock', ['#amazonfba', '#ecommerce', '#stock']) && ig.texto_para_publicar === 'IG texto del stock\n\n#amazonfba #ecommerce #stock')
    ok('y lo que mide cuenta los hashtags', ig.caracteres === Array.from(ig.texto_para_publicar as string).length && ig.limite === 2200 && ig.nivel === 'ok')
    ok('los hashtags aparte salen en su lista y el primer comentario también', JSON.stringify(ig.hashtags_aparte) === '["#amazonfba","#ecommerce","#stock"]' && ig.primer_comentario === 'Enlace en la bio' && ig.actualizado === '2026-10-21 12:00')
    ok('TikTok y Facebook, cada uno con SU texto', v1[2].texto_para_publicar?.startsWith('TT stock') === true && v1[3].texto_para_publicar?.startsWith('FB: un solo almacén') === true)

    const v2 = textosDeLaPieza(leida(V2), todos)
    ok('al vídeo de Black Friday le falta el de Facebook: no hay texto y no se inventa uno', v2[3].listo === false && v2[3].texto_para_publicar === null && v2[3].caracteres === 0)
    ok('el de TikTok se pasa del límite', v2[2].nivel === 'pasa' && v2[2].caracteres > 2200)
    ok('el de Instagram lleva siete hashtags', v2[1].hashtags_en_total === 7)

    const c1 = textosDeLaPieza(leida(C1), todos)
    ok('un carrusel solo se publica en LinkedIn y un texto suelto de otra red no sale', c1.length === 1 && c1[0].red === 'linkedin' && c1[0].listo)

    const v3 = textosDeLaPieza(leida(V3), todos)
    ok('una pieza sin textos: LinkedIn sí (el gancho) y las demás no', v3[0].listo && v3.slice(1).every((t) => !t.listo))

    ok('sin avisos cuando todo está', avisosDeLaPieza(leida(V1), v1).length === 0)
    const a2 = avisosDeLaPieza(leida(V2), v2).join(' | ')
    ok('avisa del texto que falta, del que se pasa y de los hashtags de más', /Falta el texto de Facebook/.test(a2) && /TikTok se pasa del límite/.test(a2) && /Instagram lleva 7 hashtags y admite como mucho 5/.test(a2), a2)
    const a3 = avisosDeLaPieza(leida(V3), v3).join(' | ')
    ok('y de que no hay fichero que publicar', /Falta el texto de Instagram, TikTok, Facebook/.test(a3) && /no tiene fichero/.test(a3), a3)
  }

  console.log('\n=== elegir una pieza ===')
  {
    const piezas = crear().piezas as unknown as PiezaLeida[]
    ok('por su id', elegirPieza(piezas, V1).slug === 'stock-multipais' && elegirPieza(piezas, V1.toUpperCase()).slug === 'stock-multipais')
    ok('por su slug', elegirPieza(piezas, 'black-friday').id === V2)
    ok('por su título entero, sin acentos ni mayúsculas', elegirPieza(piezas, 'EL STOCK MULTI-PAIS').id === V1)
    ok('por parte del título', elegirPieza(piezas, 'cinco errores').id === C1)
    let msg = ''
    try {
      elegirPieza(piezas, 'sin')
    } catch (e) {
      msg = (e as Error).message
    }
    ok('si encaja con varias, las nombra con su slug para acertar a la segunda', /3 piezas/.test(msg) && /black-friday/.test(msg) && /borrador/.test(msg) && /sin-programar/.test(msg), msg)
    msg = ''
    try {
      elegirPieza(piezas, 'zzzz')
    } catch (e) {
      msg = (e as Error).message
    }
    ok('si no encaja con ninguna, manda a buscar', /No hay ninguna pieza/.test(msg) && /contenido_piezas/.test(msg), msg)
  }

  console.log('\n=== contenido_calendario ===')
  {
    const d = crear()
    const r = await usar(contenidoCalendario, d.ctx)
    ok('sin fechas: esta semana y la siguiente (lunes 2 a domingo 15)', r.periodo.desde === '2026-11-02' && r.periodo.hasta === '2026-11-15' && r.periodo.hoy === HOY, JSON.stringify(r.periodo))
    ok('siete publicaciones (no entran la de octubre ni la del 30)', r.total === 7 && r.publicaciones.length === 7, String(r.total))
    ok('del día más antiguo al más reciente', r.publicaciones.every((p: any, i: number) => i === 0 || r.publicaciones[i - 1].fecha <= p.fecha))
    ok('totales por estado y por persona', r.por_estado.programado === 5 && r.por_estado.publicado === 1 && r.por_estado.saltado === 1 && r.por_persona['Maoli Pérez'] === 2 && r.por_persona['María Fernanda Ruiz'] === 1, JSON.stringify([r.por_estado, r.por_persona]))

    const e2 = r.publicaciones.find((p: any) => p.fecha === HOY)
    ok('una tarjeta: día, estado, quién publica, pieza y tipo', e2.dia === 'Miércoles' && e2.estado === 'Programado' && e2.publica === 'Maoli Pérez' && e2.slug === 'black-friday' && e2.titulo === 'Black Friday sin sustos' && e2.tipo === 'Vídeo')
    ok('en qué redes va', e2.se_publica_en === 'LinkedIn, Instagram, TikTok, Facebook')
    ok('lo que falta y lo que se pasa del límite, a la vista', JSON.stringify(e2.faltan_textos) === '["Facebook"]' && JSON.stringify(e2.textos_que_se_pasan) === '["TikTok"]')
    ok('y una pieza sin problemas no trae la lista de los que se pasan', r.publicaciones.find((p: any) => p.fecha === '2026-11-09').textos_que_se_pasan === undefined)
    ok('el enlace del fichero para descargarlo', e2.fichero.url === `${RAIZ}videos/2026/black-friday.mp4` && e2.fichero.peso === '7.6 MB', JSON.stringify(e2.fichero))
    ok('lo que no hay no se escribe: sin nota, sin hora de publicación y sin marca de pasada', e2.nota === undefined && e2.publicado_el === undefined && e2.pasada_de_fecha_y_sin_cerrar === undefined && e2.angulo === undefined && e2.encargo_id === undefined)
    ok('una publicación ya hecha dice cuándo (hora de Madrid)', r.publicaciones.find((p: any) => p.estado === 'Publicado').publicado_el === '2026-11-03 10:30')
    ok('una saltada trae su nota', r.publicaciones.find((p: any) => p.estado === 'Saltado').nota === 'Se salta por festivo')
    const e1 = r.publicaciones.find((p: any) => p.fecha === '2026-11-02')
    ok('la que ya pasó de fecha y sigue «programado» lo dice; las demás no', e1.pasada_de_fecha_y_sin_cerrar === true && e2.pasada_de_fecha_y_sin_cerrar === undefined)
    ok('el aviso de las pasadas nombra la pieza', r.avisos.some((a: string) => /1 publicación ya pasó de fecha/.test(a) && /El stock multi-país/.test(a)), JSON.stringify(r.avisos))
    const sinTexto = r.avisos.find((a: string) => /Textos por escribir/.test(a)) as string
    ok('el aviso de los textos por escribir nombra lo que falta y solo lo pendiente', /Black Friday sin sustos»: falta el texto de Facebook/.test(sinTexto) && /Vídeo a medias»: falta el texto de Instagram, TikTok, Facebook/.test(sinTexto) && !/stock multi-país/.test(sinTexto), sinTexto)

    ok('por responsable', (await usar(contenidoCalendario, d.ctx, { responsable: 'maoli' })).total === 2 && (await usar(contenidoCalendario, d.ctx, { responsable: 'Ana López' })).total === 2)
    ok('por responsable sin acentos', (await usar(contenidoCalendario, d.ctx, { responsable: 'raul' })).total === 2)
    ok('por estado', (await usar(contenidoCalendario, d.ctx, { estado: 'publicado' })).total === 1 && (await usar(contenidoCalendario, d.ctx, { estado: 'saltado' })).total === 1)
    ok('por tipo de pieza', (await usar(contenidoCalendario, d.ctx, { tipo: 'carrusel' })).total === 2 && (await usar(contenidoCalendario, d.ctx, { tipo: 'video' })).total === 5)
    ok('con filtros combinados', (await usar(contenidoCalendario, d.ctx, { responsable: 'maoli', estado: 'programado', tipo: 'video' })).total === 2)
    const octubre = await usar(contenidoCalendario, d.ctx, { desde: '2026-10-01', hasta: '2026-10-31' })
    ok('otro mes, con sus fechas', octubre.total === 1 && octubre.publicaciones[0].fecha === '2026-10-20' && octubre.avisos.length === 0, JSON.stringify(octubre.avisos))
    ok('«hoy» vale como fecha', (await usar(contenidoCalendario, d.ctx, { desde: 'hoy', hasta: 'hoy' })).total === 1)
    const p0 = await usar(contenidoCalendario, d.ctx, { limite: 3 })
    const p2 = await usar(contenidoCalendario, d.ctx, { limite: 3, pagina: 2 })
    ok('paginación con el total real', p0.publicaciones.length === 3 && p0.hay_mas && p0.siguiente_pagina === 1 && p2.publicaciones.length === 1 && !p2.hay_mas && p0.total === 7)

    const sinPersona = (await fallaCon(contenidoCalendario, d.ctx, { responsable: 'pepito' })) ?? ''
    ok('un responsable que no existe, error con quienes publican (y sin quien nunca ha publicado)', /Ana López/.test(sinPersona) && /Maoli Pérez/.test(sinPersona) && /Raúl Camuñas/.test(sinPersona) && !/Jhanna/.test(sinPersona), sinPersona)
    const malEstado = (await fallaCon(contenidoCalendario, d.ctx, { estado: 'borrador' })) ?? ''
    ok('un estado inválido, error con las opciones y sin un «vacío» entre ellas', /uno de: programado, publicado, saltado/.test(malEstado), malEstado)
    ok('un tipo inválido, error con las opciones', /video, carrusel/.test((await fallaCon(contenidoCalendario, d.ctx, { tipo: 'reel' })) ?? ''))
    ok('un día mal escrito, error con el formato', /AAAA-MM-DD/.test((await fallaCon(contenidoCalendario, d.ctx, { desde: '4/11/2026' })) ?? ''))
    ok('un rango de un año, error', /92/.test((await fallaCon(contenidoCalendario, d.ctx, { desde: '2026-01-01', hasta: '2026-12-31' })) ?? ''))
    ok('un argumento de más, nada: lo rechaza el esquema, no la herramienta', contenidoCalendario.esquema.additionalProperties === false)
    ok('SOLO LEE: ninguna petición que no sea un select', d.base.peticiones.length > 0 && d.base.peticiones.every((p) => p.endsWith('.select')), d.base.peticiones.join())

    const sinTextos = crear({ sinTablas: ['contenido_textos'] })
    const st = await usar(contenidoCalendario, sinTextos.ctx)
    ok('sin la migración 229 sigue funcionando y lo dice', st.total === 7 && st.avisos.some((a: string) => /migración 229/.test(a)), JSON.stringify(st.avisos))
    ok('sin la tabla del calendario, dice que falta una migración', /migración/.test((await fallaCon(contenidoCalendario, crear({ sinTablas: ['contenido_calendario'] }).ctx)) ?? ''))
    ok('sin la tabla de piezas, también', /migración/.test((await fallaCon(contenidoCalendario, crear({ sinTablas: ['contenido_piezas'] }).ctx)) ?? ''))

    const huerfano = crear({ encargosDeMas: [encargo(50, '2026-11-10', uuid('8', 99), MAOLI, 'programado')] })
    const h = await usar(contenidoCalendario, huerfano.ctx)
    ok('un encargo de una pieza que ya no existe no rompe nada', h.total === 8 && h.publicaciones.some((p: any) => p.pieza === 'una pieza que ya no existe'))

    // 90 días con una publicación diaria: la respuesta no cabe y se recorta DICIÉNDOLO, con el JSON entero
    const muchas = Array.from({ length: 90 }, (_, i) => {
      const dia = new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10)
      return encargo(100 + i, dia, V1, MAOLI, 'programado')
    })
    const grande = crear({ encargosDeMas: muchas })
    const g = await usar(contenidoCalendario, grande.ctx, { desde: '2026-12-01', hasta: '2027-02-28', limite: 100 })
    ok('una respuesta enorme se recorta diciéndolo y sigue siendo JSON', typeof g === 'object' && g.total === 90 && typeof g.aviso_de_tamano === 'string' && g.publicaciones.length < 90, typeof g === 'string' ? g.slice(0, 120) : String(g.publicaciones?.length))
  }

  console.log('\n=== contenido_piezas ===')
  {
    const d = crear()
    const r = await usar(contenidoPiezas, d.ctx)
    ok('toda la biblioteca, la más reciente primero', r.total === 6 && r.piezas.map((p: any) => p.slug).join() === 'a-medias,sin-programar,borrador,black-friday,cinco-errores,stock-multipais', r.piezas.map((p: any) => p.slug).join())
    const v1 = r.piezas.find((p: any) => p.slug === 'stock-multipais')
    ok('cada pieza: tipo, ángulo, redes con su texto, fichero y cuándo se publica y quién', v1.tipo === 'Vídeo' && v1.angulo === 'Un solo almacén que envía fuera' && v1.se_publica_en === 'LinkedIn, Instagram, TikTok, Facebook' && v1.faltan_textos === undefined && v1.fichero.url === `${RAIZ}videos/2026/stock-multipais.mp4` && v1.programada_para.length === 3, JSON.stringify(v1.programada_para))
    ok('las fechas de la pieza, por orden y con quien publica', v1.programada_para.map((x: any) => `${x.fecha} ${x.publica} ${x.estado}`).join('|') === '2026-10-20 Maoli Pérez Publicado|2026-11-02 Maoli Pérez Programado|2026-11-09 María Fernanda Ruiz Programado')
    ok('una pieza sin fichero lo dice con null', r.piezas.find((p: any) => p.slug === 'borrador').fichero === null)

    ok('busca en el título', (await usar(contenidoPiezas, d.ctx, { texto: 'multi' })).total === 1)
    ok('sin distinguir acentos ni mayúsculas', (await usar(contenidoPiezas, d.ctx, { texto: 'BLACK friday' })).total === 1 && (await usar(contenidoPiezas, d.ctx, { texto: 'listíng' })).total === 1)
    ok('busca también en el texto del post', (await usar(contenidoPiezas, d.ctx, { texto: 'prepara el stock' })).piezas[0]?.slug === 'black-friday')
    ok('busca en el ángulo', (await usar(contenidoPiezas, d.ctx, { texto: 'envía fuera' })).piezas[0]?.slug === 'stock-multipais')
    ok('por tipo', (await usar(contenidoPiezas, d.ctx, { tipo: 'carrusel' })).total === 2)
    const sin = await usar(contenidoPiezas, d.ctx, { programacion: 'sin_programar' })
    ok('las que no están en ningún día del calendario (la que solo se saltó cuenta como sin programar)', sin.total === 2 && sin.piezas.map((p: any) => p.slug).sort().join() === 'borrador,sin-programar', sin.piezas.map((p: any) => p.slug).join())
    ok('y las que sí: con un día pendiente, uno pasado sin cerrar o uno ya publicado', (await usar(contenidoPiezas, d.ctx, { programacion: 'en_el_calendario' })).total === 4)
    // Una pieza con solo un día pasado sin cerrar, o solo uno ya publicado, SÍ estuvo en el calendario: no es material sin programar
    const antiguas = crear({ tablas: { contenido_calendario: [encargo(1, '2026-10-06', V1, MAOLI, 'programado'), encargo(2, '2026-10-07', V2, MAOLI, 'publicado')] } })
    const sinAntiguas = await usar(contenidoPiezas, antiguas.ctx, { programacion: 'sin_programar' })
    ok('un día pasado sin cerrar o ya publicado no deja a la pieza «sin programar»', sinAntiguas.total === 4 && !sinAntiguas.piezas.some((p: any) => p.slug === 'stock-multipais' || p.slug === 'black-friday'), sinAntiguas.piezas.map((p: any) => p.slug).join())
    ok('y esas dos son las que están en el calendario', (await usar(contenidoPiezas, antiguas.ctx, { programacion: 'en_el_calendario' })).piezas.map((p: any) => p.slug).sort().join() === 'black-friday,stock-multipais')
    const p1 = await usar(contenidoPiezas, d.ctx, { limite: 4, pagina: 1 })
    ok('paginación', p1.piezas.length === 2 && !p1.hay_mas && p1.total === 6)
    ok('una programación inválida, error con las opciones', /todas, sin_programar, en_el_calendario/.test((await fallaCon(contenidoPiezas, d.ctx, { programacion: 'pronto' })) ?? ''))
    ok('SOLO LEE', d.base.peticiones.every((p) => p.endsWith('.select')))
    ok('sin la migración 229 sigue funcionando y lo dice', (await usar(contenidoPiezas, crear({ sinTablas: ['contenido_textos'] }).ctx)).avisos.some((a: string) => /migración 229/.test(a)))
    ok('sin la tabla de piezas, dice que falta una migración', /migración/.test((await fallaCon(contenidoPiezas, crear({ sinTablas: ['contenido_piezas'] }).ctx)) ?? ''))
  }

  console.log('\n=== contenido_pieza ===')
  {
    const d = crear()
    const r = await usar(contenidoPieza, d.ctx, { pieza: 'stock-multipais' })
    ok('la pieza: título, tipo, ángulo y origen', r.titulo === 'El stock multi-país' && r.tipo === 'Vídeo' && r.angulo === 'Un solo almacén que envía fuera' && r.origen === 'remotion')
    ok('el fichero con el enlace para ver y para descargar', r.fichero.url === `${RAIZ}videos/2026/stock-multipais.mp4` && r.fichero.url_de_descarga.endsWith('?download=stock-multipais.mp4') && r.fichero.peso === '22.9 MB')
    ok('la portada de un vídeo con su enlace', r.portada.url === `${RAIZ}videos/2026/stock-multipais-portada.png` && r.laminas === undefined)
    ok('el texto de CADA red listo para pegar', r.textos_por_red.length === 4 && r.textos_por_red[1].texto_para_publicar === 'IG texto del stock\n\n#amazonfba #ecommerce #stock' && r.textos_por_red[0].texto_para_publicar.startsWith('Vendes en cinco países'))
    ok('con su primer comentario y sus límites', r.textos_por_red[1].primer_comentario === 'Enlace en la bio' && r.textos_por_red[1].limite === 2200 && r.textos_por_red[0].limite === 3000)
    ok('todos los días en que se publica, con quién y su estado', r.programada_para.map((x: any) => `${x.fecha} ${x.dia} ${x.publica} ${x.estado}`).join('|') === '2026-10-20 Martes Maoli Pérez Publicado|2026-11-02 Lunes Maoli Pérez Programado|2026-11-09 Lunes María Fernanda Ruiz Programado', r.programada_para.map((x: any) => x.fecha).join())
    ok('la que pasó de fecha sin cerrar se marca', r.programada_para[1].pasada_de_fecha_y_sin_cerrar === true && r.programada_para[2].pasada_de_fecha_y_sin_cerrar === undefined)
    ok('una pieza completa no trae avisos', r.avisos.length === 0, JSON.stringify(r.avisos))

    const c = await usar(contenidoPieza, d.ctx, { pieza: 'cinco errores' })
    ok('un carrusel: solo LinkedIn, el ZIP y sus láminas numeradas', c.textos_por_red.length === 1 && c.fichero.url.endsWith('.zip') && c.laminas.length === 3 && c.laminas[0].orden === 1 && c.laminas[2].url === `${RAIZ}carruseles/2026/cinco-errores-3.png` && c.portada === undefined)
    ok('el texto de un carrusel lleva sus hashtags dentro', c.textos_por_red[0].texto_para_publicar === '5 errores que veo cada semana en los listings. #Amazon')

    const v2 = await usar(contenidoPieza, d.ctx, { pieza: uuid('8', 2) })
    ok('por id también, y los avisos dicen qué arreglar', v2.slug === 'black-friday' && v2.avisos.some((a: string) => /Falta el texto de Facebook/.test(a)) && v2.avisos.some((a: string) => /TikTok se pasa/.test(a)) && v2.avisos.some((a: string) => /Instagram lleva 7/.test(a)), JSON.stringify(v2.avisos))

    const v3 = await usar(contenidoPieza, d.ctx, { pieza: 'a-medias' })
    ok('una pieza a medias: fichero null y el aviso de que no hay nada que descargar', v3.fichero === null && v3.avisos.some((a: string) => /no tiene fichero/.test(a)))

    ok('sin decir cuál, error', /Falta el argumento/.test((await fallaCon(contenidoPieza, d.ctx)) ?? ''))
    ok('una ambigua, error que las nombra', /3 piezas/.test((await fallaCon(contenidoPieza, d.ctx, { pieza: 'sin' })) ?? ''))
    ok('una que no existe, error', /No hay ninguna pieza/.test((await fallaCon(contenidoPieza, d.ctx, { pieza: 'zzzz' })) ?? ''))
    ok('SOLO LEE', d.base.peticiones.every((p) => p.endsWith('.select')), d.base.peticiones.join())

    const st = await usar(contenidoPieza, crear({ sinTablas: ['contenido_textos'] }).ctx, { pieza: 'stock-multipais' })
    ok('sin la migración 229 sigue funcionando: solo LinkedIn listo, y lo dice', st.avisos.some((a: string) => /migración 229/.test(a)) && st.textos_por_red[0].listo === true && st.textos_por_red[1].listo === false)
    ok('sin la tabla de piezas, dice que falta una migración', /migración/.test((await fallaCon(contenidoPieza, crear({ sinTablas: ['contenido_piezas'] }).ctx, { pieza: 'x' })) ?? ''))
  }

  console.log('\n=== contenido_pendientes ===')
  {
    const d = crear()
    const r = await usar(contenidoPendientes, d.ctx)
    ok('el resumen: pasadas, de hoy, próximas, con algo que falta y sin programar', JSON.stringify(r.resumen) === JSON.stringify({ pasadas_sin_cerrar: 1, se_publican_hoy: 1, proximos_dias_programados: 3, proximos_dias_con_algo_que_falta: 1, piezas_sin_programar: 2 }), JSON.stringify(r.resumen))
    ok('mira 14 días hacia delante', r.hoy === HOY && r.mira_hasta === '2026-11-18')
    ok('la pasada de fecha, con su pieza y quién la publica', r.pasadas_sin_cerrar.length === 1 && r.pasadas_sin_cerrar[0].titulo === 'El stock multi-país' && r.pasadas_sin_cerrar[0].publica === 'Maoli Pérez')
    ok('lo de hoy, con lo que le falta', r.se_publican_hoy.length === 1 && JSON.stringify(r.se_publican_hoy[0].falta) === '["texto de Facebook"]', JSON.stringify(r.se_publican_hoy))
    ok('lo próximo con algo que falta: los textos y el fichero', r.proximos_con_algo_que_falta.length === 1 && r.proximos_con_algo_que_falta[0].slug === 'a-medias' && JSON.stringify(r.proximos_con_algo_que_falta[0].falta) === '["texto de Instagram, TikTok, Facebook","el fichero"]', JSON.stringify(r.proximos_con_algo_que_falta))
    ok('las piezas sin programar (la saltada y la que nunca se programó)', r.piezas_sin_programar.map((p: any) => p.slug).sort().join() === 'borrador,sin-programar')

    const conAntiguas = await usar(contenidoPendientes, crear({ tablas: { contenido_calendario: [encargo(1, '2026-10-06', V1, MAOLI, 'programado'), encargo(2, '2026-10-07', V2, MAOLI, 'publicado')] } }).ctx)
    ok('las piezas sin programar no cuentan las que ya tuvieron su día (pasado o publicado)', conAntiguas.resumen.piezas_sin_programar === 4 && conAntiguas.resumen.pasadas_sin_cerrar === 1, JSON.stringify(conAntiguas.resumen))
    const largo = await usar(contenidoPendientes, d.ctx, { dias: 60 })
    ok('con 60 días entra también el del 30 de noviembre', largo.resumen.proximos_dias_programados === 4 && largo.resumen.proximos_dias_con_algo_que_falta === 2, JSON.stringify(largo.resumen))
    ok('un número de días fuera de rango, error', /entre 1 y 60/.test((await fallaCon(contenidoPendientes, d.ctx, { dias: 0 })) ?? '') && /entre 1 y 60/.test((await fallaCon(contenidoPendientes, d.ctx, { dias: 90 })) ?? ''))
    ok('SOLO LEE', d.base.peticiones.every((p) => p.endsWith('.select')))
    ok('sin la migración 229 sigue funcionando y lo dice', (await usar(contenidoPendientes, crear({ sinTablas: ['contenido_textos'] }).ctx)).avisos.some((a: string) => /migración 229/.test(a)))
    ok('sin la tabla del calendario, dice que falta una migración', /migración/.test((await fallaCon(contenidoPendientes, crear({ sinTablas: ['contenido_calendario'] }).ctx)) ?? ''))

    const vacio = crear({ tablas: { contenido_calendario: [], contenido_piezas: [] } })
    const v = await usar(contenidoPendientes, vacio.ctx)
    ok('sin nada en el calendario, ceros y no un error', v.resumen.pasadas_sin_cerrar === 0 && v.resumen.piezas_sin_programar === 0 && v.se_publican_hoy.length === 0)
  }

  console.log('\n=== el catálogo ===')
  {
    const nombres = HERRAMIENTAS_DE_CONTENIDO.map((h) => h.nombre).sort()
    ok('son las cuatro que se anuncian', JSON.stringify(nombres) === '["contenido_calendario","contenido_pendientes","contenido_pieza","contenido_piezas"]', nombres.join())
    ok('forman parte del catálogo del conector', HERRAMIENTAS_DE_CONTENIDO.every((h) => HERRAMIENTAS.includes(h)))
    ok('son de SOLO LECTURA', HERRAMIENTAS_DE_CONTENIDO.every((h) => h.soloLectura === true))
    ok('no piden `cliente`: no son de una cuenta de Amazon', HERRAMIENTAS_DE_CONTENIDO.every((h) => !('cliente' in (h.esquema.properties ?? {}))))
    ok('las instrucciones del conector las nombran todas', nombres.every((n) => INSTRUCCIONES.includes(`\`${n}\``)), nombres.filter((n) => !INSTRUCCIONES.includes(`\`${n}\``)).join())
    ok('y no nombran una que no exista', [...INSTRUCCIONES_DE_CONTENIDO.matchAll(/`(contenido_[a-z_]+)`/g)].every((m) => nombres.includes(m[1])))
    ok('las instrucciones explican cómo llevarlo a Metricool y que el conector no publica', /metricool/i.test(INSTRUCCIONES) && /texto_para_publicar/.test(INSTRUCCIONES) && /SOLO LECTURA/.test(INSTRUCCIONES_DE_CONTENIDO))
    ok('y avisan de que el ERP guarda el día y no la hora', /DÍA, no la hora/.test(INSTRUCCIONES_DE_CONTENIDO))
    ok('y de que un encargo pasado sigue en «Programado» si nadie lo cerró: preguntar antes de repetirlo', /pregunta antes de volver a programar/.test(INSTRUCCIONES_DE_CONTENIDO))
    ok('y de que las cuentas de redes no están en el ERP', /cuentas de redes de cada persona no están en el ERP/.test(INSTRUCCIONES_DE_CONTENIDO))
    ok('y le dicen a Metricool campo a campo: una publicación por red, `media`, `firstCommentText` y la marca (`blogId`)', /UNA publicación por red/.test(INSTRUCCIONES_DE_CONTENIDO) && /`media`/.test(INSTRUCCIONES_DE_CONTENIDO) && /firstCommentText/.test(INSTRUCCIONES_DE_CONTENIDO) && /blogId/.test(INSTRUCCIONES_DE_CONTENIDO))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
