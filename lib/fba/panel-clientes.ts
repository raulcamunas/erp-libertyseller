import 'server-only'
import { emojisDeClientes } from '@/lib/ventas/emoji-servidor'
import type { ClienteDelPanel, ResumenDelPanel } from '@/components/plataforma/PanelDeClientes'
import { responsablesDeClientes } from '@/lib/cuentas/datos'
import { resumenGlobal } from './resumen-servidor'

/**
 * REMESAS · EL PANEL DE TODOS LOS CLIENTES (`?vista=cliente` sin cliente: la pestaña «Cliente» de la agencia). De cada cliente, lo mismo que la
 * vista «Hoy» ya calcula para la salud (`resumenGlobal`, memoria de 3 min): vendibles y de camino, primera rotura, roturas en 14 días, dinero en
 * riesgo y el próximo envío propuesto. No calcula planes: lee la última pasada.
 */

const num = (n: number) => n.toLocaleString('es-ES')
const dinero = (n: number, moneda: string) => n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', maximumFractionDigits: 0 })
const fecha = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const diasHasta = (d: string, hoy: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000)

export async function panelRemesas(permitidos: string[] | null, hoy: string): Promise<{ clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] }> {
  const r = await resumenGlobal(permitidos, hoy)
  const [emojis, responsables] = await Promise.all([emojisDeClientes(r.clientes.map((c) => c.nombre)).catch(() => new Map<string, string | null>()), responsablesDeClientes()])
  let conAviso = 0
  const clientes: ClienteDelPanel[] = r.clientes.map((c) => {
    const base = { id: c.clienteId, nombre: c.nombre, emoji: emojis.get(c.nombre) ?? null, href: `/dashboard/remesas?vista=cliente&cliente=${encodeURIComponent(c.clienteId)}&seccion=resumen`, responsable: responsables.get(c.clienteId) ?? null }
    const aviso: ClienteDelPanel['aviso'] = c.salud.tono === 'rojo' || c.salud.tono === 'ambar' ? { texto: c.salud.motivo, tono: c.salud.tono } : null
    if (aviso) conAviso++
    const x = c.resumen
    if (!x) return { ...base, aviso, cifras: [], sinDatos: c.salud.motivo || 'Sin plan calculado todavía' }
    const rotura = x.primeraRotura ? diasHasta(x.primeraRotura, hoy) : null
    const prox = c.proximoEnvio ? diasHasta(c.proximoEnvio.salirAntesDe, hoy) : null
    return {
      ...base,
      sub: `${num(x.referencias)} referencias${x.coberturaMediana != null ? ` · cobertura ${Math.round(x.coberturaMediana)} d` : ''}`,
      aviso,
      principal: { texto: 'Vendibles en Amazon', valor: num(x.vendibles), orden: x.vendibles, ayuda: `De camino: ${num(x.deCamino)} uds.` },
      cifras: [
        { texto: '1.ª rotura', valor: rotura == null ? '—' : rotura <= 0 ? 'Ya' : `${rotura} d`, orden: rotura == null ? -9999 : -rotura, tono: rotura == null ? 'verde' : rotura <= 14 ? 'rojo' : rotura <= 30 ? 'ambar' : undefined, ayuda: x.primeraRotura ? `El ${fecha(x.primeraRotura)}` : 'Ninguna a la vista' },
        { texto: 'Roturas 14 d', valor: num(x.roturas14), orden: x.roturas14, tono: x.roturas14 ? 'rojo' : undefined, ayuda: `${num(x.agotadosConVentas)} agotados que vendían` },
        { texto: 'En riesgo', valor: dinero(x.eurosEnRiesgo, x.moneda), orden: x.eurosEnRiesgo, tono: x.eurosEnRiesgo > 0 ? 'ambar' : undefined, ayuda: 'Ventas que se pierden si se agota' },
        {
          texto: 'Próximo envío',
          valor: prox == null ? '—' : prox < 0 ? 'Vencido' : prox === 0 ? 'Hoy' : `${prox} d`,
          orden: prox == null ? -9999 : -prox,
          tono: prox == null ? undefined : prox < 0 ? 'rojo' : prox <= 7 ? 'ambar' : undefined,
          ayuda: c.proximoEnvio ? `${num(c.proximoEnvio.unidades)} uds. · salir antes del ${fecha(c.proximoEnvio.salirAntesDe)}` : 'Nada propuesto',
        },
      ],
    }
  })
  const k = r.kpis
  return {
    clientes,
    resumen: [
      { texto: 'Salen esta semana', valor: num(k.salenEstaSemana) },
      { texto: 'Roturas en 14 días', valor: num(k.roturas14), tono: k.roturas14 ? 'rojo' : 'verde' },
      { texto: 'De camino', valor: `${num(k.deCaminoEnvios)} · ${num(k.deCaminoUnidades)} uds.` },
      { texto: 'Envíos vencidos', valor: num(k.pendientesVencidos), tono: k.pendientesVencidos ? 'rojo' : undefined },
      { texto: 'Clientes con aviso', valor: String(conAviso), tono: conAviso ? 'ambar' : 'verde' },
    ],
  }
}
