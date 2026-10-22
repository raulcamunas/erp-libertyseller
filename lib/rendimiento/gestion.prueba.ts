import { decidirObjetivo } from '@/lib/rendimiento/gestion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * QUIÉN PUEDE TOCAR LA CLAVE DE RINKEL DE QUIÉN.
 *
 * Lo que duele si falla: que alguien que no es administrador llegue a poner o quitar la clave de otra persona
 * pasando un `usuario` en la petición.
 */

const YO = '11111111-1111-4111-8111-111111111111'
const OTRA = '22222222-2222-4222-8222-222222222222'

function main() {
  console.log('\n=== sin pedir a nadie: la propia ===')
  {
    for (const rol of ['admin', 'partner', 'employee']) {
      for (const pedido of [undefined, null, '']) {
        const d = decidirObjetivo({ userId: YO, role: rol }, pedido)
        ok(`${rol} con ${JSON.stringify(pedido) ?? 'nada'}: su propia cuenta`, d.ok && d.userId === YO && !d.deOtra)
      }
    }
    const d = decidirObjetivo({ userId: YO, role: 'employee' }, YO)
    ok('pasar el id de uno mismo es lo mismo que no pasar nada (aunque no sea admin)', d.ok && d.userId === YO && !d.deOtra)
    const mayus = decidirObjetivo({ userId: YO, role: 'employee' }, YO.toUpperCase())
    ok('y no importa si viene en mayúsculas', mayus.ok && !mayus.deOtra)
  }

  console.log('\n=== un administrador sobre otra persona ===')
  {
    const d = decidirObjetivo({ userId: YO, role: 'admin' }, OTRA)
    ok('puede', d.ok && d.userId === OTRA && d.deOtra)
    const may = decidirObjetivo({ userId: YO, role: 'admin' }, OTRA.toUpperCase())
    ok('y se normaliza a minúsculas, que es como está en la base', may.ok && may.userId === OTRA)
  }

  console.log('\n=== quien no es administrador, no ===')
  {
    for (const rol of ['partner', 'employee', 'cliente', '', 'Admin', 'administrador']) {
      const d = decidirObjetivo({ userId: YO, role: rol }, OTRA)
      ok(`«${rol || 'sin rol'}» sobre otra persona: 403`, !d.ok && d.estado === 403)
    }
  }

  console.log('\n=== lo que no es un identificador no se adivina ===')
  {
    for (const malo of ['abc', 'no-es-un-uuid', `${OTRA} `, `${OTRA}; drop table`, '../' + OTRA, 123, {}, [OTRA], true]) {
      const d = decidirObjetivo({ userId: YO, role: 'admin' }, malo)
      ok(`${JSON.stringify(malo)}: 400, aunque sea administrador`, !d.ok && d.estado === 400)
    }
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
