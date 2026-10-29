import { esDelEquipoMedido, FILTRO_DEL_EQUIPO_MEDIDO, leerEquipoMedido, type ClienteDePerfiles } from '@/lib/rendimiento/equipo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * QUIÉN SE MIDE EN RENDIMIENTO: los comerciales y los managers comerciales (Jhanna: puesto = manager_comercial, is_comercial = false).
 * Lo que duele si falla: que un manager se quede fuera de la tabla del equipo (no se ve su Rinkel ni se puede vincular), o que una base sin la migración 257 deje el equipo VACÍO.
 */

type Perfil = { id: string; full_name: string | null; email: string | null; is_comercial: boolean; puesto?: string | null }

const PERFILES: Perfil[] = [
  { id: 'raul', full_name: 'Raúl', email: 'raul@x', is_comercial: false, puesto: null },
  { id: 'maoli', full_name: 'Maoli', email: 'maoli@x', is_comercial: true, puesto: 'comercial' },
  { id: 'jhanna', full_name: 'Jhanna', email: 'jhanna@x', is_comercial: false, puesto: 'manager_comercial' },
  { id: 'alejandro', full_name: 'Alejandro', email: 'alejandro@x', is_comercial: true, puesto: null },
  { id: 'gestor', full_name: 'Gestión', email: 'gestion@x', is_comercial: false, puesto: 'gestion_administrativa' },
]

/** Un cliente de mentira que habla como PostgREST: entiende `.or('a.eq.x,b.eq.y')`, `.eq` y `.order`, y puede no tener la columna `puesto` */
function base(opciones: { sinPuesto?: boolean; falla?: boolean } = {}) {
  const llamadas: string[] = []
  const cliente = {
    from(_tabla: string) {
      let filtro: ((p: Perfil) => boolean) | null = null
      let usaPuesto = false
      const b = {
        select: (_c: string) => b,
        or(texto: string) {
          llamadas.push(`or ${texto}`)
          usaPuesto = texto.includes('puesto')
          const condiciones = texto.split(',').map((c) => c.split('.'))
          filtro = (p) => condiciones.some(([col, , valor]) => String((p as Record<string, unknown>)[col]) === valor)
          return b
        },
        eq(col: string, valor: unknown) {
          llamadas.push(`eq ${col}=${valor}`)
          filtro = (p) => (p as Record<string, unknown>)[col] === valor
          return b
        },
        order: (_c: string, _o?: unknown) => b,
        then<T>(res: (v: unknown) => T) {
          if (opciones.falla) return Promise.resolve({ data: null, error: { code: '57014', message: 'tiempo agotado' } }).then(res)
          if (opciones.sinPuesto && usaPuesto) return Promise.resolve({ data: null, error: { code: '42703', message: 'column profiles.puesto does not exist' } }).then(res)
          const filas = PERFILES.filter(filtro ?? (() => true)).sort((a, c) => (a.full_name ?? '').localeCompare(c.full_name ?? ''))
          return Promise.resolve({ data: filas.map(({ id, full_name, email }) => ({ id, full_name, email })), error: null }).then(res)
        },
      }
      return b
    },
  }
  return { cliente: cliente as unknown as ClienteDePerfiles, llamadas }
}

async function main() {
  console.log('\n=== quién es del equipo que se mide ===')
  {
    ok('un comercial sí', esDelEquipoMedido({ is_comercial: true, puesto: 'comercial' }) && esDelEquipoMedido({ is_comercial: true }))
    ok('un manager comercial sí, aunque no sea `is_comercial` (Jhanna)', esDelEquipoMedido({ is_comercial: false, puesto: 'manager_comercial' }) && esDelEquipoMedido({ puesto: 'manager_comercial' }))
    ok('un administrador que no llama, no', !esDelEquipoMedido({ is_comercial: false, puesto: null }) && !esDelEquipoMedido({ is_comercial: false }))
    ok('gestión administrativa, no', !esDelEquipoMedido({ is_comercial: false, puesto: 'gestion_administrativa' }))
    ok('nada o un perfil que no existe, no', !esDelEquipoMedido(null) && !esDelEquipoMedido(undefined) && !esDelEquipoMedido({}))
    ok('el filtro de la base dice las dos cosas', FILTRO_DEL_EQUIPO_MEDIDO === 'is_comercial.eq.true,puesto.eq.manager_comercial')
  }

  console.log('\n=== leer el equipo ===')
  {
    const { cliente, llamadas } = base()
    const r = await leerEquipoMedido(cliente)
    ok('salen los dos comerciales y la manager, por nombre, y no el administrador ni gestión', r.error === null && r.data?.map((p) => p.id).join() === 'alejandro,jhanna,maoli', r.data?.map((p) => p.id).join())
    ok('con una sola lectura', llamadas.length === 1 && llamadas[0] === `or ${FILTRO_DEL_EQUIPO_MEDIDO}`, llamadas.join(' | '))
  }

  console.log('\n=== una base sin la migración 257 (sin `puesto`) ===')
  {
    const { cliente, llamadas } = base({ sinPuesto: true })
    const r = await leerEquipoMedido(cliente)
    ok('no se vacía el equipo: salen los comerciales, como antes', r.error === null && r.data?.map((p) => p.id).join() === 'alejandro,maoli', r.data?.map((p) => p.id).join())
    ok('tras intentarlo con `puesto` repite solo con los comerciales', llamadas.length === 2 && llamadas[1] === 'eq is_comercial=true', llamadas.join(' | '))
  }

  console.log('\n=== un fallo de verdad se dice ===')
  {
    const { cliente } = base({ falla: true })
    const r = await leerEquipoMedido(cliente)
    ok('si las dos lecturas fallan, devuelve el error y ningún dato (no un equipo vacío como si no hubiera nadie)', r.data === null && r.error !== null)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
