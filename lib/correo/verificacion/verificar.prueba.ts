import { comprobarDominio, olvidarDominios, type ResolvedorDeDominio } from '@/lib/correo/verificacion/dominio'
import { verificarDirecciones, type RebotePrevio } from '@/lib/correo/verificacion/verificar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

type Mundo = Record<string, { mx?: string[] | 'nulo' | { code: string }; a?: string[] | { code: string } }>

/** Un DNS de mentira: cada dominio con sus registros, o con el error que daría */
function dns(mundo: Mundo): { resolvedor: ResolvedorDeDominio; consultas: string[] } {
  const consultas: string[] = []
  return {
    consultas,
    resolvedor: {
      async resolverMx(d) {
        consultas.push(`mx:${d}`)
        const e = mundo[d]
        if (!e) throw Object.assign(new Error('x'), { code: 'ENOTFOUND' })
        if (e.mx === undefined) throw Object.assign(new Error('x'), { code: 'ENODATA' })
        if (e.mx === 'nulo') return [{ exchange: '.', priority: 0 }]
        if (!Array.isArray(e.mx)) throw Object.assign(new Error('x'), { code: e.mx.code })
        return e.mx.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }))
      },
      async resolverDirecciones(d) {
        consultas.push(`a:${d}`)
        const e = mundo[d]
        if (!e) throw Object.assign(new Error('x'), { code: 'ENOTFOUND' })
        if (e.a === undefined) throw Object.assign(new Error('x'), { code: 'ENODATA' })
        if (!Array.isArray(e.a)) throw Object.assign(new Error('x'), { code: e.a.code })
        return e.a
      },
    },
  }
}

const sinMemoria = async (): Promise<ReadonlyMap<string, RebotePrevio>> => new Map()

async function main() {
  console.log('\n=== el dominio ===')
  {
    olvidarDominios()
    const { resolvedor, consultas } = dns({
      'tienda.es': { mx: ['mx1.proveedor.es', 'mx2.proveedor.es'] },
      'solo-web.es': { a: ['1.2.3.4'] },
      'sin-nada.es': {},
      'nulo.es': { mx: 'nulo' },
      'caido.es': { mx: { code: 'ESERVFAIL' } },
      'lento.es': { mx: { code: 'ETIMEOUT' } },
    })
    const memoria = new Map()
    const o = { memoria, ahora: () => 1_000_000 }
    const a = await comprobarDominio('Tienda.ES', resolvedor, o)
    ok('con MX: recibe correo, con sus servidores ordenados por prioridad', a.estado === 'ok' && a.servidores.join() === 'mx1.proveedor.es,mx2.proveedor.es')
    ok('sin MX pero con dirección: existe (el correo iría a la dirección del dominio)', (await comprobarDominio('solo-web.es', resolvedor, o)).estado === 'ok')
    ok('existe pero no tiene ni MX ni dirección: no recibe correo', (await comprobarDominio('sin-nada.es', resolvedor, o)).estado === 'sin_correo')
    ok('MX nulo (RFC 7505): dice expresamente que no recibe correo', (await comprobarDominio('nulo.es', resolvedor, o)).estado === 'sin_correo')
    ok('no existe', (await comprobarDominio('inventado.es', resolvedor, o)).estado === 'no_existe')
    ok('si el DNS falla o no contesta, NO se concluye nada', (await comprobarDominio('caido.es', resolvedor, o)).estado === 'sin_comprobar' && (await comprobarDominio('lento.es', resolvedor, o)).estado === 'sin_comprobar')
    const antes = consultas.length
    await comprobarDominio('tienda.es', resolvedor, o)
    ok('se recuerda: no se vuelve a preguntar', consultas.length === antes)
    const despues = await comprobarDominio('tienda.es', resolvedor, { memoria, ahora: () => 1_000_000 + 13 * 3_600_000 })
    ok('pero caduca (a las 12 horas)', despues.estado === 'ok' && consultas.length > antes)
    const tarda: ResolvedorDeDominio = { resolverMx: () => new Promise(() => undefined), resolverDirecciones: () => new Promise(() => undefined) }
    ok('un DNS que no contesta nunca se corta por tiempo', (await comprobarDominio('x.es', tarda, { tiempoMs: 20, memoria: new Map() })).estado === 'sin_comprobar')
  }

  console.log('\n=== el veredicto de una dirección ===')
  {
    olvidarDominios()
    const { resolvedor, consultas } = dns({
      'tienda.es': { mx: ['mx.proveedor.es'] },
      'gmail.com': { mx: ['gmail-smtp-in.l.google.com'] },
      'gmial.com': { mx: ['mx.squatter.com'] },
      'muerta.es': { mx: { code: 'ENOTFOUND' } },
      'sin-correo.es': {},
      'caido.es': { mx: { code: 'ESERVFAIL' } },
    })
    const memoria = new Map<string, RebotePrevio>([['antigua@tienda.es', { motivo: 'user unknown', veces: 2 }]])
    const v = await verificarDirecciones(
      ['ana@tienda.es', 'pepe@gmial.com', 'ana@muerta.es', 'ana@sin-correo.es', 'antigua@tienda.es', 'info@tienda.es', 'ana@caido.es', 'noreply@tienda.es', 'mal escrita', 'x@mailinator.com', 'otra@gmail.com'],
      { resolvedor, memoria: async (ds) => new Map(ds.filter((d) => memoria.has(d)).map((d) => [d, memoria.get(d)!])), dominios: { memoria: new Map() } }
    )
    const por = (d: string) => v.find((x) => x.direccion === d.toLowerCase()) ?? v[v.length]
    ok('una dirección normal con dominio vivo es buena', por('ana@tienda.es').nivel === 'buena' && por('ana@tienda.es').dominio?.estado === 'ok')
    ok('una errata de gmail es dudosa (aunque el dominio de la errata tenga MX, como los de quien compra erratas), con la corrección', por('pepe@gmial.com').nivel === 'dudosa' && por('pepe@gmial.com').sugerencia === 'pepe@gmail.com')
    ok('un dominio que no existe es mala', por('ana@muerta.es').nivel === 'mala' && /no existe/.test(por('ana@muerta.es').motivo))
    ok('un dominio que no recibe correo es mala', por('ana@sin-correo.es').nivel === 'mala' && /no recibe correo/.test(por('ana@sin-correo.es').motivo))
    ok('una que ya rebotó es mala, con cuántas veces', por('antigua@tienda.es').nivel === 'mala' && /rebotó antes \(2 veces\)/.test(por('antigua@tienda.es').motivo) && por('antigua@tienda.es').rebotada?.veces === 2)
    ok('una genérica es buena (se avisa, pero no se penaliza)', por('info@tienda.es').nivel === 'buena' && por('info@tienda.es').problemas.some((p) => p.codigo === 'generica'))
    ok('con el DNS caído se da por buena y se dice que no se pudo comprobar', por('ana@caido.es').nivel === 'buena' && por('ana@caido.es').sinComprobar && /no se ha podido comprobar/i.test(por('ana@caido.es').motivo))
    ok('una que no lee nadie es mala', por('noreply@tienda.es').nivel === 'mala')
    ok('mal escrita: mala, y ni se pregunta al DNS por ella', por('mal escrita').nivel === 'mala' && !consultas.some((c) => c.includes('escrita')))
    ok('desechable: mala', por('x@mailinator.com').nivel === 'mala')
    ok('un gmail normal es buena', por('otra@gmail.com').nivel === 'buena')
    ok('cada dominio se consulta una sola vez aunque haya varias direcciones', consultas.filter((c) => c === 'mx:tienda.es').length === 1)
    ok('las malas por la memoria o por la escritura no gastan una consulta de DNS', !consultas.includes('mx:mailinator.com'))
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
