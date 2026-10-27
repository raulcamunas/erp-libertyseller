import { baseFalsa, type OpcionesDeLaBaseFalsa } from '@/lib/cold-calling/base-falsa'
import { AVISO_LISTA_FALLIDA, AVISO_PUESTO_FALLIDO, AVISO_SIN_LA_257, crearSuListaSiLlama, guardarPuesto } from '@/lib/usuarios/puestos-servidor'
import { cambioDePuestoDeLaPeticion } from '@/lib/usuarios/puestos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * GUARDAR EL PUESTO DE UNA PERSONA Y CREARLE SU LISTA, CONTRA UNA BASE FALSA.
 *
 * Lo que se vigila: que se escriba solo lo que la petición cambia, que SIN la migración 257 (sin la columna `puesto`) lo demás se guarde igualmente y se avise, que ningún
 * fallo haga reventar el alta, y que la lista propia solo se cree a quien llama y solo si se pidió.
 */

type Servicio = Parameters<typeof guardarPuesto>[0]
const ID = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'

function falso(opciones: OpcionesDeLaBaseFalsa = {}) {
  const base = baseFalsa({ tablas: { profiles: [], cold_lead_lists: [] }, ...opciones })
  return { ...base, service: base.service as unknown as Servicio }
}

const cambio = (cuerpo: { puesto?: unknown; is_comercial?: unknown }, rol = 'employee') => {
  const c = cambioDePuestoDeLaPeticion(cuerpo, rol)
  if (!c.ok) throw new Error(c.error)
  return c
}

async function main() {
  const silencio = console.error
  console.error = () => {}
  try {
    await pruebas()
  } finally {
    console.error = silencio
  }
}

async function pruebas() {
  console.log('\n=== guardar el puesto ===')
  {
    const b = falso()
    const r = await guardarPuesto(b.service, ID, cambio({ puesto: 'comercial' }))
    ok('un comercial: escribe el puesto y que llama, en SU perfil', r.avisos.length === 0 && b.escrituras.length === 1 && b.escrituras[0].tabla === 'profiles' && b.escrituras[0].op === 'update' && JSON.stringify(b.escrituras[0].valores) === JSON.stringify({ puesto: 'comercial', is_comercial: true }) && b.escrituras[0].filtros[0].col === 'id' && b.escrituras[0].filtros[0].valor === ID)
    const m = falso()
    await guardarPuesto(m.service, ID, cambio({ puesto: 'manager_comercial' }))
    ok('un manager sin decir si llama: solo el puesto, is_comercial no se toca', JSON.stringify(m.escrituras[0].valores) === JSON.stringify({ puesto: 'manager_comercial' }))
    const q = falso()
    await guardarPuesto(q.service, ID, cambio({ puesto: null }))
    ok('quitar el puesto: puesto a null', JSON.stringify(q.escrituras[0].valores) === JSON.stringify({ puesto: null }))
    const n = falso()
    const nada = await guardarPuesto(n.service, ID, cambio({}))
    ok('si la petición no cambia nada, no escribe', nada.avisos.length === 0 && n.escrituras.length === 0)
    const a = falso()
    await guardarPuesto(a.service, ID, cambio({}, 'admin'))
    ok('pasar a alguien a admin le quita el puesto que tuviera', JSON.stringify(a.escrituras[0].valores) === JSON.stringify({ puesto: null }))
  }

  console.log('\n=== sin la migración 257 (no existe la columna puesto) ===')
  {
    const b = falso({ columnasQueFaltan: { profiles: ['puesto'] } })
    const r = await guardarPuesto(b.service, ID, cambio({ puesto: 'comercial' }))
    ok('avisa de que el puesto no se ha guardado', r.avisos.length === 1 && r.avisos[0] === AVISO_SIN_LA_257)
    ok('pero guarda lo que sí existe: is_comercial', b.escrituras.length === 2 && JSON.stringify(b.escrituras[1].valores) === JSON.stringify({ is_comercial: true }))
    const s = falso({ columnasQueFaltan: { profiles: ['puesto'] } })
    const solo = await guardarPuesto(s.service, ID, cambio({ puesto: 'manager_comercial' }))
    ok('si solo había puesto que guardar: avisa y no hace un segundo intento vacío', solo.avisos[0] === AVISO_SIN_LA_257 && s.escrituras.length === 1)
    const k = falso({ columnasQueFaltan: { profiles: ['puesto'] } })
    const quitar = await guardarPuesto(k.service, ID, cambio({}, 'admin'))
    ok('quitar un puesto que todavía no puede existir no avisa de nada (no se pierde nada)', quitar.avisos.length === 0)
    const f = falso({ tablasQueFallan: { profiles: { code: '57014', message: 'statement timeout' } } })
    const fallo = await guardarPuesto(f.service, ID, cambio({ puesto: 'comercial' }))
    ok('un fallo cualquiera de la base: aviso genérico, no lanza', fallo.avisos[0] === AVISO_PUESTO_FALLIDO)
    ok('y el aviso no enseña el texto técnico', !/timeout|statement/.test(fallo.avisos.join(' ')))
  }

  console.log('\n=== la lista propia de quien llama ===')
  {
    const rpc = { cold_lista_crear: (args: Record<string, unknown>) => ({ id: 'l1', nombre: args.p_nombre }) }
    const persona = { id: ID, nombre: 'Ana López', correo: 'ana@x.com' }

    const a = falso({ rpc })
    const r = await crearSuListaSiLlama(a.service, ADMIN, persona, cambio({ puesto: 'comercial' }), true)
    ok('un comercial con la casilla marcada: «Ana López V1», asignada a ella, creada por quien da el alta', r.lista === 'Ana López V1' && r.avisos.length === 0 && a.rpcs[0].args.p_responsable === ID && a.rpcs[0].args.p_actor === ADMIN)

    const b = falso({ rpc })
    const sinPedir = await crearSuListaSiLlama(b.service, ADMIN, persona, cambio({ puesto: 'comercial' }), false)
    ok('sin marcar la casilla: no crea nada', sinPedir.lista === null && sinPedir.avisos.length === 0 && b.rpcs.length === 0)

    const c = falso({ rpc })
    const admin = await crearSuListaSiLlama(c.service, ADMIN, persona, cambio({ puesto: 'gestion_administrativa' }), true)
    ok('administración no llama: no se le crea lista aunque se pida', admin.lista === null && admin.avisos.length === 0 && c.rpcs.length === 0)

    const d = falso({ rpc })
    const manager = await crearSuListaSiLlama(d.service, ADMIN, persona, cambio({ puesto: 'manager_comercial', is_comercial: true }), true)
    const e = falso({ rpc })
    const managerQueNoLlama = await crearSuListaSiLlama(e.service, ADMIN, persona, cambio({ puesto: 'manager_comercial', is_comercial: false }), true)
    ok('un manager que también llama, sí; uno que solo supervisa, no', manager.lista === 'Ana López V1' && managerQueNoLlama.lista === null && e.rpcs.length === 0)

    const f = falso({ rpc, tablas: { profiles: [], cold_lead_lists: [{ nombre: 'Ana López V1' }, { nombre: 'ana lópez v2' }] } })
    const v3 = await crearSuListaSiLlama(f.service, ADMIN, persona, cambio({ puesto: 'comercial' }), true)
    ok('si ya hay listas con su nombre, la siguiente versión', v3.lista === 'Ana López V3')

    const g = falso()
    const sin257 = await crearSuListaSiLlama(g.service, ADMIN, persona, cambio({ puesto: 'comercial' }), true)
    ok('sin la migración 257: no lanza, avisa', sin257.lista === null && sin257.avisos[0] === AVISO_LISTA_FALLIDA)
    const h = falso({ rpc, fallan: { cold_lista_crear: { code: '42501', message: 'No tienes permiso para gestionar las listas de leads.' } } })
    const sinPermiso = await crearSuListaSiLlama(h.service, ADMIN, persona, cambio({ puesto: 'comercial' }), true)
    ok('si quien da el alta no puede gestionar listas: no lanza, avisa', sinPermiso.lista === null && sinPermiso.avisos[0] === AVISO_LISTA_FALLIDA)
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
