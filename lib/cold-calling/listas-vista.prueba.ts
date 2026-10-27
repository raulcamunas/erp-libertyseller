import { SIN_DUENO, armarPanorama, type FilaDeResumen, type ListaRegistrada, type Movimiento } from '@/lib/cold-calling/listas'
import {
  cargaPorPersona,
  describirMovimiento,
  ETIQUETA_DE_ACCION,
  filtrarListas,
  fraseDeAnadir,
  fraseDeMover,
  leadsTexto,
  mensajeDeAnadir,
  mensajeDeDeshacer,
  mensajeDeMover,
  segmentosDeEstados,
  sinTildes,
  tiendasTexto,
} from '@/lib/cold-calling/listas-vista'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LO QUE LA PANTALLA DE LISTAS CALCULA Y DICE.
 *
 * Lo que se vigila: que buscar «jose» encuentre «José V2», que cada filtro de la tabla de listas haga solo lo suyo, que la carga de cada persona sume bien (y que los leads
 * sin dueño salgan aparte), y que cada frase —antes de hacer algo, después y en el historial— diga la verdad en singular y en plural, con y sin lista, con y sin dueño.
 */

const JOSE = '10000000-0000-4000-8000-000000000001'
const DANI = '10000000-0000-4000-8000-000000000002'
const nombres: Record<string, string> = { [JOSE]: 'José', [DANI]: 'Daniela' }
const nombreDe = (id: string | null) => (id ? (nombres[id] ?? 'Alguien') : 'Nadie')

const fila = (lista: string | null, dueno: string | null, extra: Partial<FilaDeResumen> = {}): FilaDeResumen => ({
  lista,
  dueno,
  tipo_lead: 'tienda_online',
  total: 10,
  pendiente: 10,
  no_contesta: 0,
  programado: 0,
  email_enviado: 0,
  seguimiento: 0,
  cita_cualificada: 0,
  no_interesa: 0,
  vende: 0,
  no_vende: 0,
  sin_comprobar: 10,
  llamados: 0,
  intentos: 0,
  ultimo_contacto: null,
  ...extra,
})

const mov = (extra: Partial<Movimiento>): Movimiento => ({
  id: 'm1',
  usuario: JOSE,
  accion: 'mover',
  n: 3,
  lista_origen: null,
  lista_destino: null,
  cambia_lista: false,
  cambia_dueno: false,
  dueno_destino: null,
  deshecho_at: null,
  created_at: '2026-10-27T10:00:00Z',
  se_puede_deshacer: true,
  ...extra,
})

function main() {
  console.log('\n=== buscar sin tildes ===')
  {
    ok('sin tildes ni mayúsculas', sinTildes('José V2 ÁÉÍÓÚ ñ') === 'jose v2 aeiou n')
  }

  console.log('\n=== filtrar la tabla de listas ===')
  {
    const registro: ListaRegistrada[] = [
      { id: 'l1', nombre: 'José V2', descripcion: 'Para la ronda de octubre', responsable: JOSE, archivada: false },
      { id: 'l2', nombre: 'No Amazon V1', descripcion: null, responsable: null, archivada: false },
      { id: 'l3', nombre: 'Vieja', descripcion: null, responsable: DANI, archivada: true },
      { id: 'l4', nombre: 'Vacía', descripcion: null, responsable: null, archivada: false },
    ]
    const filas = [
      fila('José V2', JOSE, { tipo_lead: 'seller_amazon' }),
      fila('No Amazon V1', JOSE),
      fila('No Amazon V1', DANI),
      fila('No Amazon V1', null, { total: 2, pendiente: 2 }),
      fila('Vieja', DANI),
    ]
    const todas = armarPanorama(filas, registro).listas
    const f = (o: Partial<Parameters<typeof filtrarListas>[1]> = {}) => filtrarListas(todas, { texto: '', tipo: 'todas', archivadas: false, persona: null, ...o }).map((l) => l.nombre).sort()

    ok('sin filtros: las activas (la archivada no sale)', f().join() === 'José V2,No Amazon V1,Vacía')
    ok('con «archivadas»: también la archivada', f({ archivadas: true }).join() === 'José V2,No Amazon V1,Vacía,Vieja')
    ok('por texto, sin tildes ni mayúsculas', f({ texto: 'JOSE' }).join() === 'José V2')
    ok('el texto también busca en la descripción', f({ texto: 'octubre' }).join() === 'José V2')
    ok('un texto con espacios de los lados', f({ texto: '  amazon ' }).join() === 'No Amazon V1')
    ok('«venden en Amazon»', f({ tipo: 'seller_amazon' }).join() === 'José V2')
    ok('«no venden en Amazon»', f({ tipo: 'tienda_online' }).join() === 'No Amazon V1')
    ok('una lista vacía no es de ningún tipo: solo sale con «todas»', !f({ tipo: 'tienda_online' }).includes('Vacía') && f().includes('Vacía'))
    ok('por persona: su lista o una con leads suyos', f({ persona: JOSE }).join() === 'José V2,No Amazon V1')
    ok('por persona con la archivada incluida', f({ persona: DANI, archivadas: true }).join() === 'No Amazon V1,Vieja')
    ok('«sin dueño»: las listas con algún lead sin dueño', f({ persona: SIN_DUENO }).join() === 'No Amazon V1')
    ok('todos los filtros a la vez', f({ texto: 'amazon', tipo: 'tienda_online', persona: DANI }).join() === 'No Amazon V1' && f({ texto: 'amazon', tipo: 'seller_amazon' }).length === 0)
  }

  console.log('\n=== lo que tiene cada persona ===')
  {
    const filas = [
      fila('A', JOSE, { total: 100, pendiente: 60, llamados: 30, intentos: 70, ultimo_contacto: '2026-10-20T10:00:00Z' }),
      fila('B', JOSE, { total: 50, pendiente: 50, tipo_lead: 'seller_amazon' }),
      fila('a ', JOSE, { total: 5, pendiente: 0, llamados: 5, intentos: 9, ultimo_contacto: '2026-10-25T10:00:00Z' }),
      fila('A', DANI, { total: 20, pendiente: 5 }),
      fila('A', null, { total: 7, pendiente: 7 }),
      fila(null, null, { total: 3, pendiente: 3 }),
    ]
    const c = cargaPorPersona(filas)
    ok('una fila por persona y una para los que no tienen dueño, de más a menos leads', c.map((x) => x.id).join() === `${JOSE},${DANI},` && c.map((x) => x.id).at(-1) === null && c.map((x) => x.total).join() === '155,20,10', c.map((x) => `${x.id}:${x.total}`).join(' '))
    const jose = c.find((x) => x.id === JOSE)!
    ok('José: total, pendientes y trabajados', jose.total === 155 && jose.pendientes === 110 && jose.trabajados === 45 && Math.abs(jose.pctTrabajados - 45 / 155) < 1e-9)
    ok('llamados, intentos y último contacto (el más reciente)', jose.llamados === 35 && jose.intentos === 79 && jose.ultimoContacto === Date.parse('2026-10-25T10:00:00Z'))
    ok('en cuántas listas distintas tiene leads (sin mirar mayúsculas ni espacios)', jose.listas === 2)
    const sin = c.find((x) => x.id === null)!
    ok('los sin dueño: 10 leads, y una sola lista con nombre (los que no tienen lista no cuentan como lista)', sin.total === 10 && sin.listas === 1)
    ok('sin leads: nadie', cargaPorPersona([]).length === 0)
    ok('un porcentaje de una persona sin leads no es NaN', cargaPorPersona([fila('A', JOSE, { total: 0, pendiente: 0 })])[0].pctTrabajados === 0)
  }

  console.log('\n=== los segmentos de la barra de estados ===')
  {
    const s = segmentosDeEstados({ pendiente: 10, no_contesta: 0, seguimiento: 3, no_interesa: 1 })
    ok('en el orden de los estados y sin los que están a cero', s.map((x) => x.estado).join() === 'pendiente,seguimiento,no_interesa' && s.map((x) => x.n).join() === '10,3,1')
    ok('sin nada: ningún segmento', segmentosDeEstados({}).length === 0)
  }

  console.log('\n=== singular y plural ===')
  {
    ok('leads', leadsTexto(0) === '0 leads' && leadsTexto(1) === '1 lead' && leadsTexto(2) === '2 leads' && leadsTexto(1234) === '1234 leads' || leadsTexto(1234) === '1.234 leads')
    ok('tiendas', tiendasTexto(1) === '1 tienda' && tiendasTexto(3) === '3 tiendas' && tiendasTexto(0) === '0 tiendas')
  }

  console.log('\n=== antes de mover leads ===')
  {
    const base = { n: 120, nombreDe: (id: string) => nombreDe(id) }
    ok('a una lista', fraseDeMover({ ...base, cambiaLista: true, lista: 'José V3', cambiaDueno: false, dueno: null }) === 'Mover 120 leads a «José V3»')
    ok('a una lista y a una persona', fraseDeMover({ ...base, cambiaLista: true, lista: 'José V3', cambiaDueno: true, dueno: JOSE }) === 'Mover 120 leads a «José V3» y asignarlos a José')
    ok('a una lista y sin dueño', fraseDeMover({ ...base, cambiaLista: true, lista: 'José V3', cambiaDueno: true, dueno: null }) === 'Mover 120 leads a «José V3» y dejarlos sin dueño')
    ok('solo a una persona', fraseDeMover({ ...base, cambiaLista: false, lista: null, cambiaDueno: true, dueno: DANI }) === 'Asignar 120 leads a Daniela')
    ok('solo sin dueño', fraseDeMover({ ...base, cambiaLista: false, lista: null, cambiaDueno: true, dueno: null }) === 'Dejar 120 leads sin dueño')
    ok('sacarlos de toda lista', fraseDeMover({ ...base, n: 1, cambiaLista: true, lista: null, cambiaDueno: false, dueno: null }) === 'Sacar 1 lead de su lista')
    ok('sacarlos de toda lista y asignarlos', fraseDeMover({ ...base, cambiaLista: true, lista: null, cambiaDueno: true, dueno: JOSE }) === 'Mover 120 leads fuera de toda lista y asignarlos a José')
    ok('si no cambia nada, lo dice', fraseDeMover({ ...base, cambiaLista: false, lista: null, cambiaDueno: false, dueno: null }) === 'No hay nada que cambiar')
  }

  console.log('\n=== después de mover leads ===')
  {
    const base = { n: 120, nombreDe: (id: string) => nombreDe(id) }
    const lista = { ...base, cambiaLista: true, lista: 'José V3', cambiaDueno: false, dueno: null }
    ok('todos cambiaron', mensajeDeMover(lista, { movimiento: 'm', cambiados: 120 }) === '120 leads movidos a «José V3».')
    ok('unos ya estaban donde se pedía', mensajeDeMover(lista, { movimiento: 'm', cambiados: 118 }) === '118 leads movidos a «José V3» (otros 2 ya estaban así).')
    ok('uno ya estaba', mensajeDeMover(lista, { movimiento: 'm', cambiados: 119 }) === '119 leads movidos a «José V3» (otro ya estaba así).')
    ok('ninguno cambió', mensajeDeMover(lista, { movimiento: null, cambiados: 0 }) === 'No ha cambiado nada: ya estaban así.')
    ok('uno solo, en singular', mensajeDeMover({ ...lista, n: 1 }, { movimiento: 'm', cambiados: 1 }) === '1 lead movido a «José V3».')
    ok('asignados', mensajeDeMover({ ...base, cambiaLista: false, lista: null, cambiaDueno: true, dueno: JOSE }, { movimiento: 'm', cambiados: 120 }) === '120 leads asignados a José.')
    ok('sin dueño', mensajeDeMover({ ...base, cambiaLista: false, lista: null, cambiaDueno: true, dueno: null }, { movimiento: 'm', cambiados: 5 }) === '5 leads sin dueño (otros 115 ya estaban así).')
    ok('sacados de su lista', mensajeDeMover({ ...base, cambiaLista: true, lista: null, cambiaDueno: false, dueno: null }, { movimiento: 'm', cambiados: 120 }) === '120 leads sacados de su lista.')
    ok('lista y persona', mensajeDeMover({ ...base, cambiaLista: true, lista: 'X', cambiaDueno: true, dueno: DANI }, { movimiento: 'm', cambiados: 120 }) === '120 leads movidos a «X» y asignados a Daniela.')
  }

  console.log('\n=== añadir tiendas del banco ===')
  {
    ok('antes: con persona', fraseDeAnadir({ n: 200, lista: 'José V3', dueno: JOSE, nombreDe: (id) => nombreDe(id) }) === 'Añadir 200 tiendas a «José V3», asignadas a José')
    ok('antes: sin dueño y una sola', fraseDeAnadir({ n: 1, lista: 'X', dueno: null, nombreDe: (id) => nombreDe(id) }) === 'Añadir 1 tienda a «X», sin dueño')
    ok('después: todas entraron', mensajeDeAnadir({ movimiento: 'm', anadidos: 200, ya_estaban: 0, no_disponibles: 0, lista: 'José V3' }) === '200 tiendas añadidas a «José V3».')
    ok('después: unas ya estaban y otras no estaban disponibles', mensajeDeAnadir({ movimiento: 'm', anadidos: 190, ya_estaban: 6, no_disponibles: 4, lista: 'X' }) === '190 tiendas añadidas a «X»; 6 ya estaban entre los leads; 4 no estaban disponibles (ya repartidas o descartadas).')
    ok('después: una sola', mensajeDeAnadir({ movimiento: 'm', anadidos: 1, ya_estaban: 1, no_disponibles: 1, lista: 'X' }) === '1 tienda añadida a «X»; 1 ya estaba entre los leads; 1 no estaba disponible (ya repartidas o descartadas).')
    ok('después: ninguna entró', mensajeDeAnadir({ movimiento: 'm', anadidos: 0, ya_estaban: 0, no_disponibles: 5, lista: 'X' }) === 'No se ha añadido ninguna tienda: 5 no estaban disponibles (ya repartidas o descartadas).')
    ok('después: no había nada', mensajeDeAnadir({ movimiento: null, anadidos: 0, ya_estaban: 0, no_disponibles: 0, lista: 'X' }) === 'No se ha añadido ninguna tienda.')
  }

  console.log('\n=== deshacer ===')
  {
    ok('leads: todos vuelven', mensajeDeDeshacer({ deshechos: 5, conservados: 0, accion: 'mover' }) === '5 leads vuelven a como estaban.')
    ok('leads: uno solo', mensajeDeDeshacer({ deshechos: 1, conservados: 0, accion: 'asignar' }) === '1 lead vuelve a como estaban.')
    ok('leads: unos se quedan porque se volvieron a tocar', mensajeDeDeshacer({ deshechos: 3, conservados: 2, accion: 'mover_asignar' }) === '3 leads vuelven a como estaban; otros 2 se quedan como están porque alguien los ha vuelto a tocar después.')
    ok('leads: uno se queda', mensajeDeDeshacer({ deshechos: 3, conservados: 1, accion: 'mover' }) === '3 leads vuelven a como estaban; otro se queda como está porque alguien lo ha vuelto a tocar después.')
    ok('leads: ninguno pudo volver', mensajeDeDeshacer({ deshechos: 0, conservados: 4, accion: 'mover' }) === 'No ha vuelto ningún lead a como estaba; otros 4 se quedan como están porque alguien los ha vuelto a tocar después.')
    ok('banco: se quitan las que seguían sin tocar', mensajeDeDeshacer({ deshechos: 10, conservados: 0, accion: 'anadir_del_banco' }) === '10 tiendas quitadas (las que seguían sin tocar).')
    ok('banco: unas se quedan porque ya se habían trabajado', mensajeDeDeshacer({ deshechos: 8, conservados: 2, accion: 'anadir_del_banco' }) === '8 tiendas quitadas (las que seguían sin tocar); otras 2 se quedan porque ya se habían trabajado.')
    ok('banco: ninguna se pudo quitar', mensajeDeDeshacer({ deshechos: 0, conservados: 1, accion: 'anadir_del_banco' }) === 'No se ha quitado ninguna tienda; otra se queda porque ya se había trabajado.')
  }

  console.log('\n=== el historial ===')
  {
    const d = (m: Partial<Movimiento>) => describirMovimiento(mov(m), nombreDe)
    ok('crear una lista', d({ accion: 'crear_lista', lista_destino: 'José V3', dueno_destino: JOSE, n: 0 }) === 'Creó la lista «José V3», asignada a José' && d({ accion: 'crear_lista', lista_destino: 'X', n: 0 }) === 'Creó la lista «X»')
    ok('renombrar', d({ accion: 'renombrar_lista', lista_origen: 'A', lista_destino: 'B', n: 12 }) === 'Renombró «A» a «B» (12 leads)')
    ok('archivar y recuperar', d({ accion: 'archivar_lista', lista_origen: 'A' }) === 'Archivó la lista «A»' && d({ accion: 'desarchivar_lista', lista_origen: 'A' }) === 'Recuperó la lista «A»')
    ok('responsable', d({ accion: 'responsable_lista', lista_origen: 'A', dueno_destino: DANI }) === 'Puso a Daniela de responsable de «A»' && d({ accion: 'responsable_lista', lista_origen: 'A' }) === 'Quitó el responsable de «A»')
    ok('mover, con y sin lista de origen', d({ accion: 'mover', lista_origen: 'A', lista_destino: 'B', cambia_lista: true }) === 'Movió 3 leads de «A» a «B»' && d({ accion: 'mover', lista_destino: 'B', cambia_lista: true }) === 'Movió 3 leads a «B»')
    ok('mover fuera de toda lista', d({ accion: 'mover', lista_origen: 'A', cambia_lista: true }) === 'Sacó 3 leads de «A»' && d({ accion: 'mover', cambia_lista: true }) === 'Sacó 3 leads de su lista')
    ok('asignar y dejar sin dueño', d({ accion: 'asignar', dueno_destino: JOSE, cambia_dueno: true }) === 'Asignó 3 leads a José' && d({ accion: 'asignar', cambia_dueno: true }) === 'Dejó 3 leads sin dueño')
    ok('mover y asignar', d({ accion: 'mover_asignar', lista_destino: 'B', dueno_destino: DANI, cambia_lista: true, cambia_dueno: true }) === 'Movió 3 leads a «B» y los asignó a Daniela' && d({ accion: 'mover_asignar', lista_destino: 'B', cambia_lista: true, cambia_dueno: true }) === 'Movió 3 leads a «B» y los dejó sin dueño')
    ok('asignar una lista', d({ accion: 'asignar_lista', lista_origen: 'A', dueno_destino: JOSE, n: 40 }) === 'Pasó 40 leads de «A» a José')
    ok('añadir del banco', d({ accion: 'anadir_del_banco', lista_destino: 'B', dueno_destino: JOSE, n: 200 }) === 'Añadió 200 tiendas del banco a «B», asignadas a José' && d({ accion: 'anadir_del_banco', lista_destino: 'B', n: 1 }) === 'Añadió 1 tienda del banco a «B»')
    ok('añadir del banco sin que entre ninguna', d({ accion: 'anadir_del_banco', lista_destino: 'B', n: 0 }) === 'Intentó añadir tiendas del banco a «B», pero ninguna estaba libre')
    ok('deshacer', d({ accion: 'deshacer', n: 2 }) === 'Deshizo un movimiento (2 leads)')
    ok('una acción que no se conoce se enseña tal cual (no se rompe)', d({ accion: 'inventada' }) === 'inventada')
    ok('cada acción de la base tiene su etiqueta corta', ['crear_lista', 'renombrar_lista', 'archivar_lista', 'desarchivar_lista', 'responsable_lista', 'mover', 'asignar', 'mover_asignar', 'asignar_lista', 'anadir_del_banco', 'deshacer'].every((a) => (ETIQUETA_DE_ACCION[a] ?? '').length > 0))
  }
}

main()
console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
