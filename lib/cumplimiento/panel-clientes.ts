import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { emojisDeClientes } from '@/lib/ventas/emoji-servidor'
import type { ClienteDelPanel, ResumenDelPanel } from '@/components/plataforma/PanelDeClientes'
import { conMemoria } from '@/lib/plataforma/memoria'
import { repartirAvisos } from '@/lib/plataforma/avisos-del-panel'
import { responsablesDeClientes } from '@/lib/cuentas/datos'
import { conexionesDeCliente } from './conexiones'

/**
 * CUMPLIMIENTO · EL PANEL DE TODOS LOS CLIENTES (la pantalla de inicio del módulo). De cada cliente, sus cifras de todos los países juntos con la misma
 * función que el panel de dentro (`cumplimiento_cifras`, migración 297): listings sin problemas, los que necesitan atención (y cuántos de esos tienen
 * stock: ventas en juego), ocultos, normativa y cuándo se revisó por última vez. Una llamada por cliente, todas a la vez.
 */

const n = (v: unknown) => Number(v ?? 0) || 0
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`)
const DIA = 86_400_000

async function panelCumplimientoCalculo(clientes: Array<{ slug: string; nombre: string; amazonClientId: string; paises: string[] }>): Promise<{ clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] }> {
  const s = createServiceClient()
  const [cifras, emojis, responsables] = await Promise.all([
    Promise.all(
      clientes.map(async (c) => {
        // Un fallo se dice como fallo (antes salía «sin datos todavía» y escondía, por ejemplo, la RPC caída)
        let conexiones: Awaited<ReturnType<typeof conexionesDeCliente>>
        try {
          conexiones = await conexionesDeCliente(c.amazonClientId)
        } catch (e) {
          return { error: `No se han podido leer sus cuentas de Amazon: ${e instanceof Error ? e.message : String(e)}` }
        }
        if (!conexiones.length) return null
        const { data, error } = await s.rpc('cumplimiento_cifras', { p_conexiones: conexiones.map((x) => x.id) })
        if (error) return { error: `No se han podido calcular sus cifras: ${error.message}` }
        return (data ?? []) as Array<Record<string, unknown>>
      }),
    ),
    emojisDeClientes(clientes.map((c) => c.nombre)).catch(() => new Map<string, string | null>()),
    responsablesDeClientes(),
  ])

  const total = { revisados: 0, limpios: 0, atencion: 0, conStock: 0, ocultos: 0 }
  let conAviso = 0
  const salida: ClienteDelPanel[] = clientes.map((c, i) => {
    const filas = cifras[i]
    const base = { id: c.slug, nombre: c.nombre, sub: `${c.paises.length} ${c.paises.length === 1 ? 'país' : 'países'} · ${c.paises.join(', ')}`, emoji: emojis.get(c.nombre) ?? null, href: `/dashboard/cumplimiento?c=${encodeURIComponent(c.slug)}`, responsable: responsables.get(c.amazonClientId) ?? null }
    if (!filas) return { ...base, cifras: [], sinDatos: 'Sin cuentas de Amazon conectadas' }
    if (!Array.isArray(filas)) {
      conAviso++
      return { ...base, cifras: [], aviso: { texto: filas.error.slice(0, 160), tono: 'rojo' }, sinDatos: 'Error al leer' }
    }
    type Suma = { revisados: number; limpios: number; atencion: number; conStock: number; ocultos: number; normativa: number; ultima: string }
    const x = filas.reduce<Suma>(
      (a, f) => ({
        revisados: a.revisados + n(f.revisados),
        limpios: a.limpios + n(f.limpios),
        atencion: a.atencion + n(f.atencion),
        conStock: a.conStock + n(f.atencion_con_stock),
        ocultos: a.ocultos + n(f.ocultos),
        normativa: a.normativa + n(f.normativa),
        ultima: [a.ultima, (f.ultima_revision as string | null) ?? ''].sort().reverse()[0] ?? '',
      }),
      { revisados: 0, limpios: 0, atencion: 0, conStock: 0, ocultos: 0, normativa: 0, ultima: '' },
    )
    total.revisados += x.revisados
    total.limpios += x.limpios
    total.atencion += x.atencion
    total.conStock += x.conStock
    total.ocultos += x.ocultos
    const sano = x.revisados > 0 ? x.limpios / x.revisados : null
    const dias = x.ultima ? (Date.now() - Date.parse(x.ultima)) / DIA : null
    const { aviso, masAvisos } = repartirAvisos([
      x.conStock > 0 && { texto: `${x.conStock} ${x.conStock === 1 ? 'listing con stock necesita' : 'listings con stock necesitan'} atención: ventas en juego`, tono: 'rojo' },
      x.ocultos > 0 && { texto: `${x.ocultos} ${x.ocultos === 1 ? 'listing oculto' : 'listings ocultos'} en Amazon`, tono: 'ambar' },
      dias != null && dias > 3 && { texto: `Sin revisar desde hace ${Math.floor(dias)} días`, tono: 'ambar' },
    ])
    if (aviso) conAviso++
    if (x.revisados === 0) return { ...base, cifras: [], sinDatos: 'Ningún listing revisado todavía' }
    return {
      ...base,
      aviso,
      masAvisos,
      principal: { texto: 'Listings sin problemas', valor: pct(sano), orden: sano ?? -1, tono: sano == null ? undefined : sano >= 0.9 ? 'verde' : sano >= 0.75 ? 'ambar' : 'rojo', ayuda: `${x.limpios.toLocaleString('es-ES')} de ${x.revisados.toLocaleString('es-ES')} revisados` },
      cifras: [
        { texto: 'Atención', valor: x.atencion.toLocaleString('es-ES'), orden: x.atencion, tono: x.atencion ? 'ambar' : undefined, ayuda: 'Listings con algo que corregir' },
        { texto: 'Con stock', valor: x.conStock.toLocaleString('es-ES'), orden: x.conStock, tono: x.conStock ? 'rojo' : undefined, ayuda: 'De los que necesitan atención, los que tienen stock (ventas en juego)' },
        { texto: 'Ocultos', valor: x.ocultos.toLocaleString('es-ES'), orden: x.ocultos, tono: x.ocultos ? 'rojo' : undefined },
        { texto: 'Normativa', valor: x.normativa.toLocaleString('es-ES'), orden: x.normativa, ayuda: 'Incidencias de normativa (seguridad, documentación…)' },
      ],
    }
  })
  return {
    clientes: salida,
    resumen: [
      { texto: 'Sin problemas', valor: pct(total.revisados ? total.limpios / total.revisados : null), tono: 'verde' },
      { texto: 'Necesitan atención', valor: total.atencion.toLocaleString('es-ES'), tono: total.atencion ? 'ambar' : undefined },
      { texto: 'Con stock en juego', valor: total.conStock.toLocaleString('es-ES'), tono: total.conStock ? 'rojo' : undefined },
      { texto: 'Ocultos', valor: total.ocultos.toLocaleString('es-ES'), tono: total.ocultos ? 'rojo' : undefined },
      { texto: 'Clientes con aviso', valor: String(conAviso), tono: conAviso ? 'ambar' : 'verde' },
    ],
  }
}

/** Con memoria de 2 minutos (lib/plataforma/memoria.ts): el panel lo abre todo el equipo a primera hora y cada carga lee miles de filas */
export async function panelCumplimiento(clientes: Array<{ slug: string; nombre: string; amazonClientId: string; paises: string[] }>): Promise<{ clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] }> {
  return conMemoria(`panelCumplimiento:${JSON.stringify(clientes)}`, 120_000, () => panelCumplimientoCalculo(clientes))
}
