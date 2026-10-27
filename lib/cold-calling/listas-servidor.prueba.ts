import { baseFalsa, type OpcionesDeLaBaseFalsa } from '@/lib/cold-calling/base-falsa'
import { FILTRO_DE_BANCO_VACIO, FILTRO_DE_LEADS_VACIO, SIN_DUENO, SIN_LISTA, filtroDeBancoParaLaBase, filtroParaLaBase, leerFiltroDeLeads } from '@/lib/cold-calling/listas'
import {
  ErrorDeListas,
  FALTA_LA_MIGRACION_257,
  aErrorDeListas,
  anadirDelBanco,
  archivarLista,
  asignarLista,
  buscarEnElBanco,
  crearLista,
  crearListaParaPersona,
  deshacerMovimiento,
  esLaMisma,
  idsDelFiltro,
  leadsDelFiltro,
  leerEquipo,
  leerPanel,
  leerPersonas,
  moverLeads,
  movimientosRecientes,
  renombrarLista,
  resumenDelBanco,
} from '@/lib/cold-calling/listas-servidor'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LO QUE HACE EL SERVIDOR CON LAS LISTAS, CONTRA UNA BASE FALSA.
 *
 * Lo que se vigila: que cada error de la base llegue a la pantalla con el estado y la frase que le tocan (y que un fallo raro NO enseñe su mensaje técnico), que lo
 * que no vale se rechace ANTES de llamar a la base, que a cada función SQL le lleguen los argumentos con el nombre exacto que declara la migración 257, que «todos los
 * que cumplen el filtro» respete los excluidos y el tope de 10.000, y que sin la migración las listas se vean igualmente (resumidas aquí) sin dejar cambiar nada.
 * Las funciones SQL en sí —mover, deshacer, añadir del banco…— se validaron aparte contra un Postgres de verdad.
 */

type Servicio = Parameters<typeof leerPanel>[0]

const ACTOR = '11111111-1111-4111-8111-111111111111'
const LEAD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LEAD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LEAD_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PERSONA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LISTA_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

/** Una base falsa (lib/cold-calling/base-falsa.ts): lo que no se define no existe, como sin la migración 257 */
function falso(opciones: OpcionesDeLaBaseFalsa = {}) {
  const base = baseFalsa(opciones)
  return { ...base, service: base.service as unknown as Servicio }
}

async function falla(que: () => Promise<unknown>): Promise<ErrorDeListas | null> {
  try {
    await que()
    return null
  } catch (e) {
    return e instanceof ErrorDeListas ? e : new ErrorDeListas(`NO ERA UN ErrorDeListas: ${e instanceof Error ? e.message : String(e)}`, -1)
  }
}

/** Los fallos raros se apuntan en el registro del servidor con console.error: en la prueba se callan para no ensuciar la salida */
async function sinRuido<T>(que: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await que()
  } finally {
    console.error = original
  }
}

const fila = (lista: string | null, extra: Partial<Record<string, unknown>> = {}) => ({
  lista,
  dueno: null,
  tipo_lead: 'tienda_online',
  total: 1,
  pendiente: 1,
  no_contesta: 0,
  programado: 0,
  email_enviado: 0,
  seguimiento: 0,
  cita_cualificada: 0,
  no_interesa: 0,
  vende: 0,
  no_vende: 0,
  sin_comprobar: 1,
  llamados: 0,
  intentos: 0,
  ultimo_contacto: null,
  ...extra,
})

const leadSuelto = (i: number) => ({ source_list: `Lista ${i % 3}`, assigned_to: null, tipo_lead: 'tienda_online', status: 'pendiente', vende_en_amazon: 'sin_comprobar', call_attempts: 0, last_contacted_at: null })

async function main() {
  console.log('\n=== de un error de la base a una frase para la pantalla ===')
  {
    await sinRuido(async () => {
      const permiso = aErrorDeListas({ code: '42501', message: 'No tienes permiso para gestionar las listas de leads.' })
      ok('42501 con frase propia: 403 y esa frase', permiso.estado === 403 && permiso.message === 'No tienes permiso para gestionar las listas de leads.')
      ok('42501 sin frase: 403 y una genérica', aErrorDeListas({ code: '42501' }).estado === 403 && aErrorDeListas({ code: '42501' }).message === 'No tienes permiso para hacer esto.')
      const invalido = aErrorDeListas({ code: '22023', message: 'Esa lista no existe o está archivada.' })
      ok('22023: 400 y la frase de la función', invalido.estado === 400 && invalido.message === 'Esa lista no existe o está archivada.')
      const repetido = aErrorDeListas({ code: '23505', message: 'Ya existe una lista que se llama «José V2».' })
      ok('23505: 409 y dice cuál', repetido.estado === 409 && /José V2/.test(repetido.message))
      for (const codigo of ['PGRST202', 'PGRST205', '42P01', '42883', '42703']) {
        const e = aErrorDeListas({ code: codigo, message: 'x' })
        ok(`${codigo} (falta la migración): 503 y la frase de la 257`, e.estado === 503 && e.message === FALTA_LA_MIGRACION_257)
      }
      const raro = aErrorDeListas({ code: '57014', message: 'canceling statement due to statement timeout' })
      ok('un tiempo agotado: 500 y NO se enseña el mensaje técnico', raro.estado === 500 && !/statement/.test(raro.message) && /Vuelve a intentarlo/.test(raro.message))
      ok('algo que ni es un error: 500', aErrorDeListas(null).estado === 500 && aErrorDeListas('hola').estado === 500 && aErrorDeListas(undefined).estado === 500)
      const propio = new ErrorDeListas('x', 418)
      ok('un ErrorDeListas pasa tal cual', aErrorDeListas(propio) === propio)
    })
  }

  console.log('\n=== leer el panel de listas ===')
  {
    const registro = [{ id: LISTA_ID, nombre: 'José V2', descripcion: null, responsable: PERSONA, archivada: false }]
    const filas = [fila('José V2', { dueno: PERSONA, total: 5, pendiente: 5 })]
    const con = falso({ rpc: { cold_listas_resumen: filas }, tablas: { cold_lead_lists: registro } })
    const panel = await leerPanel(con.service)
    ok('con la migración: el registro y el resumen de la base', panel.migracion && panel.registro.length === 1 && panel.filas.length === 1 && panel.filas[0].total === 5)
    ok('y no baja ni un lead', con.lecturas.every((l) => l.tabla === 'cold_lead_lists'))

    const sin = falso({ tablas: { cold_leads: Array.from({ length: 2350 }, (_, i) => leadSuelto(i)) } })
    const respaldo = await leerPanel(sin.service)
    ok('sin la migración: avisa, sin registro, pero resume los leads aquí mismo', !respaldo.migracion && respaldo.registro.length === 0 && respaldo.filas.reduce((s, f) => s + f.total, 0) === 2350)
    const paginas = sin.lecturas.filter((l) => l.tabla === 'cold_leads').map((l) => l.rango?.join('-'))
    ok('los leads se piden de 1.000 en 1.000 (PostgREST no da más)', paginas.join(' ') === '0-999 1000-1999 2000-2999', paginas.join(' '))

    const justo = falso({ tablas: { cold_leads: Array.from({ length: 1000 }, (_, i) => leadSuelto(i)) } })
    const justas = await leerPanel(justo.service)
    ok('con justo 1.000 pide una página más para asegurarse y no cuenta de más', justas.filas.reduce((s, f) => s + f.total, 0) === 1000 && justo.lecturas.filter((l) => l.tabla === 'cold_leads').length === 2)

    const mediana = falso({ tablas: { cold_lead_lists: registro, cold_leads: [leadSuelto(1)] } })
    const aMedias = await leerPanel(mediana.service)
    ok('si existe el registro pero no la función de resumen, sigue contando como «sin migración»', !aMedias.migracion && aMedias.registro.length === 0 && aMedias.filas.length === 1)

    const cae = falso({ tablasQueFallan: { cold_lead_lists: { code: '57014', message: 'statement timeout' } } })
    const caida = await sinRuido(() => falla(() => leerPanel(cae.service)))
    ok('si la base falla de verdad (no por falta de migración), el error sube: 500', caida?.estado === 500)

    const leadsCaen = falso({ tablasQueFallan: { cold_leads: { code: '57014', message: 'statement timeout' } } })
    const caidaLeads = await sinRuido(() => falla(() => leerPanel(leadsCaen.service)))
    ok('y también si falla al leer los leads del respaldo', caidaLeads?.estado === 500)
  }

  console.log('\n=== crear, renombrar, archivar y asignar listas ===')
  {
    const b = falso({ rpc: { cold_lista_crear: { id: LISTA_ID, nombre: 'Ana V1' } } })
    const hecha = await crearLista(b.service, ACTOR, { nombre: '  Ana   V1 ', descripcion: 'Para Ana', responsable: PERSONA.toUpperCase() })
    ok('crear: llega el nombre limpio y la persona en minúsculas, con los nombres de la 257', hecha.nombre === 'Ana V1' && JSON.stringify(b.rpcs[0]) === JSON.stringify({ nombre: 'cold_lista_crear', args: { p_actor: ACTOR, p_nombre: 'Ana V1', p_descripcion: 'Para Ana', p_responsable: PERSONA } }), JSON.stringify(b.rpcs[0]))
    await crearLista(b.service, ACTOR, { nombre: 'Sola' })
    ok('sin descripción ni responsable: null', b.rpcs[1].args.p_descripcion === null && b.rpcs[1].args.p_responsable === null)
    await crearLista(b.service, ACTOR, { nombre: 'Vacía', responsable: '' })
    ok('un responsable en blanco es «ninguno»', b.rpcs[2].args.p_responsable === null)
    const antes = b.rpcs.length
    ok('sin nombre: 400 y no llama a la base', (await falla(() => crearLista(b.service, ACTOR, { nombre: '   ' })))?.estado === 400)
    ok('un nombre que no es texto: 400', (await falla(() => crearLista(b.service, ACTOR, { nombre: 42 })))?.estado === 400)
    ok('más de 80 caracteres: 400', (await falla(() => crearLista(b.service, ACTOR, { nombre: 'x'.repeat(81) })))?.estado === 400)
    ok('con exactamente 80 pasa', (await crearLista(b.service, ACTOR, { nombre: 'x'.repeat(80) })).nombre === 'Ana V1')
    ok('el nombre reservado de los filtros: 400', (await falla(() => crearLista(b.service, ACTOR, { nombre: SIN_LISTA })))?.estado === 400)
    ok('una persona que no es un id: 400', (await falla(() => crearLista(b.service, ACTOR, { nombre: 'Rara', responsable: 'ana' })))?.estado === 400)
    ok('nada de eso ha llegado a la base (salvo la de 80)', b.rpcs.length === antes + 1)

    const duplicada = falso({ fallan: { cold_lista_crear: { code: '23505', message: 'Ya existe una lista que se llama «Ana V1».' } } })
    ok('una repetida: 409 con la frase de la base', (await falla(() => crearLista(duplicada.service, ACTOR, { nombre: 'Ana V1' })))?.estado === 409)
    const sinPermiso = falso({ fallan: { cold_lista_crear: { code: '42501', message: 'No tienes permiso para gestionar las listas de leads.' } } })
    ok('sin permiso: 403', (await falla(() => crearLista(sinPermiso.service, ACTOR, { nombre: 'Ana V1' })))?.estado === 403)
    const sinMigracion = falso()
    ok('sin migración: 503', (await falla(() => crearLista(sinMigracion.service, ACTOR, { nombre: 'Ana V1' })))?.estado === 503)

    const r = falso({ rpc: { cold_lista_renombrar: { id: LISTA_ID, nombre: 'Nuevo', leads: 4 }, cold_lista_archivar: { id: LISTA_ID, nombre: 'Nuevo', archivada: true } } })
    await renombrarLista(r.service, ACTOR, LISTA_ID.toUpperCase(), ' Nuevo  nombre ')
    ok('renombrar: id en minúsculas y nombre limpio', JSON.stringify(r.rpcs[0].args) === JSON.stringify({ p_actor: ACTOR, p_id: LISTA_ID, p_nombre: 'Nuevo nombre' }), JSON.stringify(r.rpcs[0].args))
    ok('renombrar con un id que no es un id: 400', (await falla(() => renombrarLista(r.service, ACTOR, 'esa', 'Nuevo')))?.estado === 400)
    ok('renombrar sin nombre: 400', (await falla(() => renombrarLista(r.service, ACTOR, LISTA_ID, '')))?.estado === 400)
    ok('y no llegaron a la base', r.rpcs.length === 1)
    await archivarLista(r.service, ACTOR, LISTA_ID, true)
    await archivarLista(r.service, ACTOR, LISTA_ID, false)
    ok('archivar y desarchivar mandan el booleano tal cual', r.rpcs[1].args.p_archivada === true && r.rpcs[2].args.p_archivada === false)
    ok('archivar un id que no es un id: 400', (await falla(() => archivarLista(r.service, ACTOR, 'no', true)))?.estado === 400)

    const a = falso({ rpc: { cold_lista_responsable: { id: LISTA_ID, nombre: 'Ana V1', responsable: PERSONA, movimiento: null, cambiados: 0 } } })
    await asignarLista(a.service, ACTOR, LISTA_ID, PERSONA, 'pendientes')
    await asignarLista(a.service, ACTOR, LISTA_ID, PERSONA, 'lo que sea')
    await asignarLista(a.service, ACTOR, LISTA_ID, '', 'todos')
    await asignarLista(a.service, ACTOR, LISTA_ID, null, undefined)
    ok('asignar: el alcance pedido pasa', a.rpcs[0].args.p_alcance === 'pendientes' && a.rpcs[0].args.p_dueno === PERSONA)
    ok('un alcance inventado se queda en «ninguno»', a.rpcs[1].args.p_alcance === 'ninguno')
    ok('una persona en blanco o null quita al responsable', a.rpcs[2].args.p_dueno === null && a.rpcs[3].args.p_dueno === null && a.rpcs[3].args.p_alcance === 'ninguno')
    ok('la lista tiene que ser un id', (await falla(() => asignarLista(a.service, ACTOR, 'esa', PERSONA, 'todos')))?.estado === 400)
    ok('la persona también', (await falla(() => asignarLista(a.service, ACTOR, LISTA_ID, 'ana', 'todos')))?.estado === 400)
  }

  console.log('\n=== mover leads ===')
  {
    const b = falso({ rpc: { cold_leads_mover: { movimiento: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm', cambiados: 2 } } })
    await moverLeads(b.service, ACTOR, { ids: [LEAD_A, LEAD_A.toUpperCase(), LEAD_B], lista: '  Mi   lista ' })
    ok(
      'a una lista: ids sin repetir y en minúsculas, lista limpia, el dueño sin tocar',
      JSON.stringify(b.rpcs[0]) ===
        JSON.stringify({ nombre: 'cold_leads_mover', args: { p_actor: ACTOR, p_ids: [LEAD_A, LEAD_B], p_cambia_lista: true, p_lista: 'Mi lista', p_cambia_dueno: false, p_dueno: null } }),
      JSON.stringify(b.rpcs[0])
    )
    await moverLeads(b.service, ACTOR, { ids: [LEAD_A], lista: null })
    ok('«lista: null» es sacarlos de toda lista (cambia_lista a true, lista null)', b.rpcs[1].args.p_cambia_lista === true && b.rpcs[1].args.p_lista === null)
    await moverLeads(b.service, ACTOR, { ids: [LEAD_A], dueno: null })
    ok('«dueno: null» es dejarlos sin dueño (cambia_dueno a true, dueño null)', b.rpcs[2].args.p_cambia_dueno === true && b.rpcs[2].args.p_dueno === null && b.rpcs[2].args.p_cambia_lista === false)
    await moverLeads(b.service, ACTOR, { ids: [LEAD_A], dueno: PERSONA.toUpperCase(), lista: 'Otra' })
    ok('lista y dueño a la vez', b.rpcs[3].args.p_cambia_lista === true && b.rpcs[3].args.p_cambia_dueno === true && b.rpcs[3].args.p_dueno === PERSONA)

    const antes = b.rpcs.length
    ok('sin decir qué cambiar: 400', (await falla(() => moverLeads(b.service, ACTOR, { ids: [LEAD_A] })))?.estado === 400)
    ok('sin leads: 400', (await falla(() => moverLeads(b.service, ACTOR, { ids: [], lista: 'X' })))?.estado === 400)
    ok('sin la lista de ids: 400', (await falla(() => moverLeads(b.service, ACTOR, { lista: 'X' })))?.estado === 400)
    ok('un id que no es un id: 400', (await falla(() => moverLeads(b.service, ACTOR, { ids: ['hola'], lista: 'X' })))?.estado === 400)
    ok('una persona que no es un id: 400', (await falla(() => moverLeads(b.service, ACTOR, { ids: [LEAD_A], dueno: 'ana' })))?.estado === 400)
    const muchos = Array.from({ length: 10_001 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const demasiados = await falla(() => moverLeads(b.service, ACTOR, { ids: muchos, lista: 'X' }))
    ok('más de 10.000 de una vez: 400', demasiados?.estado === 400 && /10\.000/.test(demasiados.message))
    ok('con exactamente 10.000 pasa', (await moverLeads(b.service, ACTOR, { ids: muchos.slice(0, 10_000), lista: 'X' })).cambiados === 2)
    ok('nada de lo rechazado llegó a la base', b.rpcs.length === antes + 1)

    const sinPermiso = falso({ fallan: { cold_leads_mover: { code: '42501', message: 'No tienes permiso para gestionar las listas de leads.' } } })
    ok('sin permiso: 403', (await falla(() => moverLeads(sinPermiso.service, ACTOR, { ids: [LEAD_A], lista: 'X' })))?.estado === 403)
    const listaMala = falso({ fallan: { cold_leads_mover: { code: '22023', message: 'Esa lista no existe o está archivada.' } } })
    const noExiste = await falla(() => moverLeads(listaMala.service, ACTOR, { ids: [LEAD_A], lista: 'X' }))
    ok('a una lista que no existe o está archivada: 400 con esa frase', noExiste?.estado === 400 && /archivada/.test(noExiste.message))
  }

  console.log('\n=== mover «todos los que cumplen el filtro» ===')
  {
    const filtro = leerFiltroDeLeads({ lista: 'No Amazon V1', estado: 'pendiente', tipo: 'tienda_online' })
    const b = falso({ rpc: { cold_leads_buscar: { total: 3, ids: [LEAD_A, LEAD_B.toUpperCase(), LEAD_C] }, cold_leads_mover: { movimiento: null, cambiados: 2 } } })
    const ids = await idsDelFiltro(b.service, filtro)
    ok('los id de un filtro: pide solo los id, hasta 10.000, con el filtro como lo espera la base', ids.length === 3 && JSON.stringify(b.rpcs[0].args) === JSON.stringify({ p_filtro: filtroParaLaBase(filtro), p_limite: 10_000, p_desde: 0, p_solo_ids: true }), JSON.stringify(b.rpcs[0].args))
    const sin = await idsDelFiltro(b.service, filtro, [LEAD_B])
    ok('menos los excluidos, sin mirar mayúsculas', sin.length === 2 && !sin.some((x) => x.toLowerCase() === LEAD_B))
    await moverLeads(b.service, ACTOR, { filtro, excluidos: [LEAD_A.toUpperCase()], lista: 'Otra' })
    const mover = b.rpcs.find((r) => r.nombre === 'cold_leads_mover')!
    ok('mover por filtro manda los que quedan', JSON.stringify(mover.args.p_ids) === JSON.stringify([LEAD_B.toUpperCase(), LEAD_C]), JSON.stringify(mover.args.p_ids))

    const gordo = falso({ rpc: { cold_leads_buscar: { total: 12_345, ids: [LEAD_A] } } })
    const tope = await falla(() => idsDelFiltro(gordo.service, filtro))
    ok('si el filtro da más de 10.000: 400, dice cuántos son y pide afinar', tope?.estado === 400 && /12\.345/.test(tope.message) && /Afina/.test(tope.message), tope?.message)
    const ninguno = falso({ rpc: { cold_leads_buscar: { total: 0, ids: [] } } })
    const nada = await falla(() => moverLeads(ninguno.service, ACTOR, { filtro, lista: 'Otra' }))
    ok('si no cumple ninguno: 400 «no hay ningún lead elegido» y no llama a mover', nada?.estado === 400 && /ningún lead/.test(nada.message) && ninguno.rpcs.every((r) => r.nombre === 'cold_leads_buscar'))
    const todosFuera = falso({ rpc: { cold_leads_buscar: { total: 1, ids: [LEAD_A] } } })
    ok('si lo excluido era todo: lo mismo', (await falla(() => moverLeads(todosFuera.service, ACTOR, { filtro, excluidos: [LEAD_A], dueno: PERSONA })))?.estado === 400)
    const vacio = falso({ rpc: { cold_leads_buscar: null } })
    ok('si la base no devuelve nada, es como ninguno', (await idsDelFiltro(vacio.service, filtro)).length === 0)
  }

  console.log('\n=== buscar leads, por páginas ===')
  {
    const b = falso({ rpc: { cold_leads_buscar: { total: 7, filas: [{ id: LEAD_A }] } } })
    const filtro = { ...FILTRO_DE_LEADS_VACIO, lista: SIN_LISTA, dueno: SIN_DUENO, q: 'moda' }
    const r = await leadsDelFiltro(b.service, filtro, 3, 50)
    ok('devuelve el total y las filas', r.total === 7 && r.filas.length === 1)
    ok('la página 3 de 50 empieza en el 150', b.rpcs[0].args.p_desde === 150 && b.rpcs[0].args.p_limite === 50 && b.rpcs[0].args.p_solo_ids === false)
    ok('el filtro llega en la forma de la base', JSON.stringify(b.rpcs[0].args.p_filtro) === JSON.stringify(filtroParaLaBase(filtro)))
    await leadsDelFiltro(b.service, FILTRO_DE_LEADS_VACIO, 0, 100_000)
    await leadsDelFiltro(b.service, FILTRO_DE_LEADS_VACIO, -4)
    await leadsDelFiltro(b.service, FILTRO_DE_LEADS_VACIO, Number.NaN, 0)
    ok('el tamaño de página se acota a 500', b.rpcs[1].args.p_limite === 500)
    ok('una página negativa es la primera, y sin tamaño son 100', b.rpcs[2].args.p_desde === 0 && b.rpcs[2].args.p_limite === 100)
    ok('una página que no es un número es la primera', b.rpcs[3].args.p_desde === 0)
    const nulo = falso({ rpc: { cold_leads_buscar: null } })
    const vacio = await leadsDelFiltro(nulo.service, FILTRO_DE_LEADS_VACIO, 0)
    ok('si la base no devuelve nada: cero y sin filas', vacio.total === 0 && vacio.filas.length === 0)
  }

  console.log('\n=== deshacer y el historial ===')
  {
    const b = falso({ rpc: { cold_leads_deshacer: { deshechos: 2, conservados: 1, accion: 'mover' }, cold_movimientos_recientes: null } })
    const r = await deshacerMovimiento(b.service, ACTOR, LEAD_A.toUpperCase())
    ok('deshacer manda el actor y el id en minúsculas', r.deshechos === 2 && JSON.stringify(b.rpcs[0].args) === JSON.stringify({ p_actor: ACTOR, p_movimiento: LEAD_A }))
    ok('con un id que no es un id: 400', (await falla(() => deshacerMovimiento(b.service, ACTOR, 'x')))?.estado === 400)
    const ya = falso({ fallan: { cold_leads_deshacer: { code: '22023', message: 'Ese movimiento ya se había deshecho.' } } })
    const yaHecho = await falla(() => deshacerMovimiento(ya.service, ACTOR, LEAD_A))
    ok('uno ya deshecho: 400 con su frase', yaHecho?.estado === 400 && /ya se había deshecho/.test(yaHecho.message))
    ok('sin movimientos (la base devuelve null): una lista vacía', (await movimientosRecientes(b.service)).length === 0)
    await movimientosRecientes(b.service, 7)
    ok('el límite pedido llega a la base', b.rpcs.at(-1)?.args.p_limite === 7)
  }

  console.log('\n=== el banco de tiendas ===')
  {
    const b = falso({
      rpc: {
        cold_banco_resumen: { total: 10, libres: 8, descartadas: 1, por_nivel: {}, por_tramo: {}, por_tipo: {}, categorias: [], plataformas: [] },
        cold_banco_buscar: (args: Record<string, unknown>) => (args.p_solo_dominios ? { total: 4, dominios: ['a.es', 'b.es', 'c.es'] } : { total: 4, filas: [{ dominio: 'a.es' }] }),
        cold_banco_anadir: { movimiento: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm', anadidos: 2, ya_estaban: 1, no_disponibles: 0, lista: 'Ana V1' },
      },
    })
    ok('el resumen pasa tal cual', (await resumenDelBanco(b.service)).libres === 8)
    const pagina = await buscarEnElBanco(b.service, { ...FILTRO_DE_BANCO_VACIO, tramo: 'A', conTelefono: true }, 2, 10)
    ok('buscar: total, filas y la página 2 de 10 empieza en el 20', pagina.total === 4 && pagina.filas.length === 1 && b.rpcs[1].args.p_desde === 20 && b.rpcs[1].args.p_limite === 10 && b.rpcs[1].args.p_solo_dominios === false)
    ok('con el filtro en la forma de la base', JSON.stringify(b.rpcs[1].args.p_filtro) === JSON.stringify(filtroDeBancoParaLaBase({ ...FILTRO_DE_BANCO_VACIO, tramo: 'A', conTelefono: true })))
    await buscarEnElBanco(b.service, FILTRO_DE_BANCO_VACIO, 0, 9999)
    await buscarEnElBanco(b.service, FILTRO_DE_BANCO_VACIO, 0)
    ok('el tamaño de página se acota a 200 y por defecto son 50', b.rpcs[2].args.p_limite === 200 && b.rpcs[3].args.p_limite === 50)

    const antes = b.rpcs.length
    const a1 = await anadirDelBanco(b.service, ACTOR, { dominios: ['  Tienda.ES ', 'tienda.es', 'otra.com', 'no es un dominio', 'x', "a'; drop table x;--.es"], lista: ' Ana  V1 ', dueno: PERSONA.toUpperCase() })
    const llamada = b.rpcs[antes]
    ok('añadir por dominios: se quedan los válidos, sin repetir y en minúsculas', a1.anadidos === 2 && JSON.stringify(llamada.args.p_dominios) === JSON.stringify(['tienda.es', 'otra.com']), JSON.stringify(llamada.args.p_dominios))
    ok('la lista limpia y el dueño en minúsculas, con los nombres de la 257', llamada.args.p_lista === 'Ana V1' && llamada.args.p_dueno === PERSONA && llamada.args.p_actor === ACTOR && llamada.nombre === 'cold_banco_anadir')
    await anadirDelBanco(b.service, ACTOR, { dominios: ['tienda.es'], lista: 'Ana V1', dueno: null })
    ok('sin dueño: null', b.rpcs.at(-1)?.args.p_dueno === null)

    const total = b.rpcs.length
    ok('ningún dominio válido: 400', (await falla(() => anadirDelBanco(b.service, ACTOR, { dominios: ['hola', ''], lista: 'Ana V1', dueno: null })))?.estado === 400)
    ok('sin dominios ni filtro: 400', (await falla(() => anadirDelBanco(b.service, ACTOR, { lista: 'Ana V1', dueno: null })))?.estado === 400)
    ok('sin lista: 400', (await falla(() => anadirDelBanco(b.service, ACTOR, { dominios: ['a.es'], lista: '  ', dueno: null })))?.estado === 400)
    ok('con un dueño que no es un id: 400', (await falla(() => anadirDelBanco(b.service, ACTOR, { dominios: ['a.es'], lista: 'Ana V1', dueno: 'ana' })))?.estado === 400)
    const tres001 = Array.from({ length: 3001 }, (_, i) => `tienda${i}.es`)
    const mucho = await falla(() => anadirDelBanco(b.service, ACTOR, { dominios: tres001, lista: 'Ana V1', dueno: null }))
    ok('más de 3.000 tiendas elegidas a mano: 400', mucho?.estado === 400 && /3000|3\.000/.test(mucho.message))
    ok('nada de eso llegó a la base', b.rpcs.length === total)

    const porFiltro = await anadirDelBanco(b.service, ACTOR, { filtro: { ...FILTRO_DE_BANCO_VACIO, nivel: 1 }, primeras: 5000, lista: 'Ana V1', dueno: PERSONA })
    const buscar = b.rpcs.at(-2)!
    ok('«las N primeras de un filtro»: pide solo los dominios, con el tope de 3.000', buscar.nombre === 'cold_banco_buscar' && buscar.args.p_solo_dominios === true && buscar.args.p_limite === 3000 && buscar.args.p_desde === 0)
    ok('y añade los que le devuelve la búsqueda', JSON.stringify(b.rpcs.at(-1)?.args.p_dominios) === JSON.stringify(['a.es', 'b.es', 'c.es']) && porFiltro.anadidos === 2)
    ok('sin decir cuántas: 400', (await falla(() => anadirDelBanco(b.service, ACTOR, { filtro: FILTRO_DE_BANCO_VACIO, lista: 'Ana V1', dueno: null })))?.estado === 400)
    ok('cuántas negativas: 400', (await falla(() => anadirDelBanco(b.service, ACTOR, { filtro: FILTRO_DE_BANCO_VACIO, primeras: -3, lista: 'Ana V1', dueno: null })))?.estado === 400)
    const vacio = falso({ rpc: { cold_banco_buscar: { total: 0, dominios: [] } } })
    const nada = await falla(() => anadirDelBanco(vacio.service, ACTOR, { filtro: FILTRO_DE_BANCO_VACIO, primeras: 10, lista: 'Ana V1', dueno: null }))
    ok('si el filtro no da ninguna tienda: 400 y no se añade', nada?.estado === 400 && /ninguna tienda/.test(nada.message) && vacio.rpcs.length === 1)

    const sinPermiso = falso({ fallan: { cold_banco_anadir: { code: '42501', message: 'No tienes permiso para gestionar las listas de leads.' } } })
    ok('sin permiso: 403', (await falla(() => anadirDelBanco(sinPermiso.service, ACTOR, { dominios: ['a.es'], lista: 'Ana V1', dueno: null })))?.estado === 403)
    const listaMala = falso({ fallan: { cold_banco_anadir: { code: '22023', message: 'Esa lista no existe o está archivada.' } } })
    ok('a una lista que no existe: 400', (await falla(() => anadirDelBanco(listaMala.service, ACTOR, { dominios: ['a.es'], lista: 'Nada', dueno: null })))?.estado === 400)
    const sinBanco = falso()
    ok('sin migración: 503', (await falla(() => buscarEnElBanco(sinBanco.service, FILTRO_DE_BANCO_VACIO, 0)))?.estado === 503 && (await falla(() => resumenDelBanco(sinBanco.service)))?.estado === 503)
  }

  console.log('\n=== la lista de una persona nueva ===')
  {
    const nueva = (existentes: string[]) => falso({ tablas: { cold_lead_lists: existentes.map((nombre) => ({ nombre })) }, rpc: { cold_lista_crear: (args: Record<string, unknown>) => ({ id: LISTA_ID, nombre: args.p_nombre }) } })
    const a = nueva([])
    const nombre = await crearListaParaPersona(a.service, ACTOR, { id: PERSONA, nombre: 'Ana López', correo: 'ana@x.com' })
    ok('«Ana López V1», asignada a ella', nombre === 'Ana López V1' && a.rpcs[0].args.p_nombre === 'Ana López V1' && a.rpcs[0].args.p_responsable === PERSONA && a.rpcs[0].args.p_actor === ACTOR, JSON.stringify(a.rpcs[0]?.args))
    const b = nueva(['Ana López V1', 'ana lópez v2'])
    ok('si ya tiene, la siguiente libre (sin mirar mayúsculas)', (await crearListaParaPersona(b.service, ACTOR, { id: PERSONA, nombre: 'Ana López', correo: null })) === 'Ana López V3')
    const c = nueva([])
    ok('con un nombre largo usa solo el primero', (await crearListaParaPersona(c.service, ACTOR, { id: PERSONA, nombre: 'José Luis García Pérez', correo: null })) === 'José V1')
    const d = nueva([])
    ok('sin nombre usa el correo', (await crearListaParaPersona(d.service, ACTOR, { id: PERSONA, nombre: null, correo: 'maria.fernanda@x.com' })) === 'Maria fernanda V1')
    await sinRuido(async () => {
      const sinMigracion = falso()
      ok('sin migración: null, no lanza', (await crearListaParaPersona(sinMigracion.service, ACTOR, { id: PERSONA, nombre: 'Ana', correo: null })) === null)
      const sinPermiso = falso({ tablas: { cold_lead_lists: [] }, fallan: { cold_lista_crear: { code: '42501', message: 'No tienes permiso para gestionar las listas de leads.' } } })
      ok('sin permiso: null, no lanza', (await crearListaParaPersona(sinPermiso.service, ACTOR, { id: PERSONA, nombre: 'Ana', correo: null })) === null)
      const cae = falso({ tablasQueFallan: { cold_lead_lists: { code: '57014', message: 'timeout' } } })
      ok('con la base caída: null, no lanza', (await crearListaParaPersona(cae.service, ACTOR, { id: PERSONA, nombre: 'Ana', correo: null })) === null)
    })
  }

  console.log('\n=== el equipo al que se pueden asignar listas ===')
  {
    const A = 'a0000000-0000-4000-8000-000000000001'
    const B = 'b0000000-0000-4000-8000-000000000002'
    const C = 'c0000000-0000-4000-8000-000000000003'
    const D = 'd0000000-0000-4000-8000-000000000004'
    const E = 'e0000000-0000-4000-8000-000000000005'
    const F = 'f0000000-0000-4000-8000-000000000006'
    const G = '90000000-0000-4000-8000-000000000007'
    const perfiles = [
      { id: A, full_name: 'Raúl', email: 'raul@x.com', role: 'admin', is_comercial: false, puesto: null },
      { id: B, full_name: 'María Fernanda', email: 'mf@x.com', role: 'employee', is_comercial: true, puesto: 'comercial' },
      { id: C, full_name: '  ', email: 'jose@x.com', role: 'employee', is_comercial: true, puesto: 'comercial' },
      { id: D, full_name: 'Jhanna', email: 'j@x.com', role: 'employee', is_comercial: false, puesto: 'manager_comercial' },
      { id: E, full_name: 'Carlos', email: 'c@x.com', role: 'employee', is_comercial: false, puesto: 'gestion_administrativa' },
      { id: F, full_name: 'Enrique', email: 'e@x.com', role: 'partner', is_comercial: true, puesto: null },
      { id: G, full_name: 'Una clienta', email: 'cl@x.com', role: 'cliente', is_comercial: true, puesto: null },
    ]
    const permisos = [
      { user_id: B, app_id: 'cold-calling', can_access: true },
      { user_id: D, app_id: 'cold-calling', can_access: true },
      { user_id: E, app_id: 'correo', can_access: true },
    ]
    const b = falso({ tablas: { profiles: perfiles, user_app_permissions: permisos } })
    const equipo = await leerEquipo(b.service)
    const nombres = equipo.map((p) => p.nombre)
    ok('salen los que llaman, los que tienen puesto de comercial o de manager y los empleados con Cold Calling; por orden alfabético', nombres.join() === 'Enrique,Jhanna,Jose,María Fernanda', nombres.join())
    ok('un administrador que no llama no sale', !equipo.some((p) => p.id === A))
    ok('una persona de administración sin Cold Calling no sale', !equipo.some((p) => p.id === E))
    ok('un cliente no sale nunca, aunque llevara la marca de comercial', !equipo.some((p) => p.id === G))
    ok('sin nombre completo se usa lo de antes de la @, con mayúscula', equipo.find((p) => p.id === C)?.nombre === 'Jose')
    ok('cada uno dice si puede entrar en Cold Calling: el partner siempre; los demás, con la casilla', equipo.find((p) => p.id === F)?.coldCalling === true && equipo.find((p) => p.id === B)?.coldCalling === true && equipo.find((p) => p.id === C)?.coldCalling === false)
    ok('y su puesto y si llama', equipo.find((p) => p.id === D)?.puesto === 'manager_comercial' && equipo.find((p) => p.id === D)?.llama === false && equipo.find((p) => p.id === B)?.llama === true)
    ok('el permiso se pide solo de Cold Calling y solo si está concedido', b.lecturas.some((l) => l.tabla === 'user_app_permissions' && l.filtros.some((f) => f.col === 'app_id' && f.valor === 'cold-calling') && l.filtros.some((f) => f.col === 'can_access' && f.valor === true)))

    const sinPuesto = falso({ tablas: { profiles: perfiles.map(({ puesto: _puesto, ...resto }) => resto), user_app_permissions: permisos }, columnasQueFaltan: { profiles: ['puesto'] } })
    const antes = await leerEquipo(sinPuesto.service)
    ok('antes de la migración 257 (sin la columna puesto) sigue funcionando, sin puesto', antes.map((p) => p.nombre).join() === 'Enrique,Jhanna,Jose,María Fernanda' && antes.every((p) => p.puesto === null))
    ok('lo intenta con el puesto y, al no existir, sin él', sinPuesto.lecturas.filter((l) => l.tabla === 'profiles').length === 2)

    const personas = await leerPersonas(b.service)
    ok('los nombres son los de TODAS las personas, también las que no están en el equipo (un administrador que no llama, una clienta)', personas.nombres[A] === 'Raúl' && personas.nombres[E] === 'Carlos' && personas.nombres[G] === 'Una clienta' && Object.keys(personas.nombres).length === 7)
    ok('y el equipo es el mismo de antes', personas.equipo.map((p) => p.id).join() === equipo.map((p) => p.id).join())

    const cae = falso({ tablasQueFallan: { profiles: { code: '57014', message: 'timeout' } } })
    ok('si la base falla de verdad, el error sube: 500', (await sinRuido(() => falla(() => leerEquipo(cae.service))))?.estado === 500)
    const caePermisos = falso({ tablas: { profiles: perfiles }, tablasQueFallan: { user_app_permissions: { code: '57014', message: 'timeout' } } })
    ok('también si falla al leer los permisos', (await sinRuido(() => falla(() => leerEquipo(caePermisos.service))))?.estado === 500)
  }

  console.log('\n=== comparar nombres de lista ===')
  {
    ok('sin mirar mayúsculas ni espacios de los lados', esLaMisma('  José V2 ', 'josé v2') && !esLaMisma('José V2', 'José V3'))
    ok('«sin lista» es la misma que otra sin lista', esLaMisma(null, '') && esLaMisma(undefined, '   '))
  }
}

main()
  .then(() => {
    console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
    if (fallos > 0) process.exit(1)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
