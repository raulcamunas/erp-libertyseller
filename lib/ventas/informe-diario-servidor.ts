import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { enviarDesdeBuzon } from '@/lib/correo/servidor'
import type { FilaDeBuzon } from '@/lib/correo/almacen'
import { normalizarAjustes } from './ajustes'
import { hoyEnMadrid, sumarDias, totalizar, type Totales } from './panel'
import { costesDelPanel, cuentasDelPanel, filasDelPanel } from './panel-servidor'

/**
 * VENTAS · EL INFORME DIARIO POR CORREO («Enviar informes de ventas todos los días» de la Configuración). Cada mañana, desde las 8 (Madrid), a la
 * dirección de cada cuenta que lo tenga puesto: lo de AYER (ventas, unidades, pedidos, reembolsos, publicidad, ganancia neta, margen) comparado con
 * el mismo día de la semana anterior. Sale desde el buzón del ERP elegido (módulo Correo). Una vez al día por cuenta (`informe_enviado_dia`, 354).
 */
const euros = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)
const cambio = (a: number, b: number) => (b === 0 ? '' : ` (${a >= b ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %)`)

export function textoDelInforme(nombre: string, dia: string, t: Totales, c: Totales): { asunto: string; texto: string; html: string } {
  const fecha = new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  const filas: Array<[string, string, string]> = [
    ['Ventas', euros(t.ventas), euros(c.ventas) + cambio(t.ventas, c.ventas)],
    ['Unidades', String(t.unidades), String(c.unidades) + cambio(t.unidades, c.unidades)],
    ['Pedidos', String(t.pedidos), String(c.pedidos)],
    ['Reembolsos', String(t.reembolsos), String(c.reembolsos)],
    ['Publicidad', euros(t.publicidad), euros(c.publicidad)],
    ['Ganancia neta', euros(t.neto), euros(c.neto) + cambio(t.neto, c.neto)],
    ['Margen', pct(t.margen), pct(c.margen)],
  ]
  const asunto = `${nombre} · ${euros(t.ventas)} en ventas y ${euros(t.neto)} de ganancia (${fecha})`
  const texto = [`Ventas de ${nombre} del ${fecha}`, '', ...filas.map(([k, v, a]) => `${k}: ${v}   (hace una semana: ${a})`), '', 'Liberty Seller · Sellerboard'].join('\n')
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#141414;max-width:560px"><h2 style="margin:0 0 4px;font-size:18px">${nombre}</h2><div style="color:#5E5852;margin-bottom:16px">Ventas del ${fecha}</div><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="text-align:left;padding:6px 0;border-bottom:1px solid #E5E1DB"></th><th style="text-align:right;padding:6px 0;border-bottom:1px solid #E5E1DB">Ayer</th><th style="text-align:right;padding:6px 0;border-bottom:1px solid #E5E1DB;color:#5E5852">Hace una semana</th></tr>${filas
    .map(([k, v, a]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #F7F5F2">${k}</td><td style="text-align:right;padding:6px 0;border-bottom:1px solid #F7F5F2;font-weight:600">${v}</td><td style="text-align:right;padding:6px 0;border-bottom:1px solid #F7F5F2;color:#5E5852">${a}</td></tr>`)
    .join('')}</table><div style="margin-top:16px;color:#B8AE9F;font-size:12px">Liberty Seller · Sellerboard</div></div>`
  return { asunto, texto, html }
}

export async function enviarInformesDiarios(): Promise<string[]> {
  const { hoy } = hoyEnMadrid()
  const hora = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }))
  if (hora < 8) return []
  const s = createServiceClient()
  const { data, error } = await s.from('ventas_cuentas').select('connection_id, ajustes, informe_enviado_dia').eq('activa', true)
  if (error) return [] // sin la migración 354 no hay informe
  const pendientes = ((data ?? []) as Array<{ connection_id: string; ajustes: unknown; informe_enviado_dia: string | null }>).filter((c) => {
    const a = normalizarAjustes(c.ajustes)
    return a.informeCorreo && a.informeBuzon && c.informe_enviado_dia !== hoy
  })
  if (!pendientes.length) return []
  const cuentas = await cuentasDelPanel()
  const hechos: string[] = []
  const ayer = sumarDias(hoy, -1)
  const semana = sumarDias(ayer, -7)
  for (const c of pendientes) {
    const a = normalizarAjustes(c.ajustes)
    const cuenta = cuentas.find((x) => x.id === c.connection_id)
    if (!cuenta) continue
    try {
      const { data: b } = await s.from('correo_buzones').select('*').eq('id', a.informeBuzon as string).maybeSingle()
      if (!b) {
        hechos.push(`${cuenta.nombre}: el buzón del informe ya no existe`)
        continue
      }
      const [filasAyer, filasSemana, costes] = await Promise.all([filasDelPanel(c.connection_id, ayer, ayer), filasDelPanel(c.connection_id, semana, semana), costesDelPanel(c.connection_id)])
      const iva = { ...cuenta.ajustes, pct: cuenta.iva, porPais: cuenta.ivaPorPais }
      const t = totalizar(filasAyer, iva, costes)
      const cmp = totalizar(filasSemana, iva, costes)
      const correo = textoDelInforme(cuenta.cliente ?? cuenta.nombre, ayer, t, cmp)
      const r = await enviarDesdeBuzon(s, b as FilaDeBuzon, { para: [{ nombre: '', direccion: a.informeCorreo as string }], cc: [], asunto: correo.asunto, texto: correo.texto, html: correo.html })
      if (r.tipo === 'enviado') {
        await s.from('ventas_cuentas').update({ informe_enviado_dia: hoy }).eq('connection_id', c.connection_id)
        hechos.push(`${cuenta.nombre}: informe enviado`)
      } else hechos.push(`${cuenta.nombre}: informe sin enviar (${r.mensaje})`)
    } catch (e) {
      hechos.push(`${cuenta.nombre}: informe sin enviar (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  return hechos
}

/** Los buzones del ERP desde los que se puede enviar el informe */
export async function buzonesParaInforme(): Promise<Array<{ id: string; direccion: string }>> {
  const { data } = await createServiceClient().from('correo_buzones').select('id, direccion, credenciales_invalidas').order('direccion')
  return ((data ?? []) as Array<{ id: string; direccion: string; credenciales_invalidas: boolean }>).filter((b) => !b.credenciales_invalidas).map((b) => ({ id: b.id, direccion: b.direccion }))
}
