import { NextResponse, type NextRequest } from 'next/server'
import { connectionCredentials } from '@/lib/amazon/data'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { fetchFbaInventory } from '@/lib/amazon/sp-api'
import { estadoDeEnvios, lineasDeEnvio, sigueVivo } from '@/lib/fba/inbound'
import { desdeCuandoLeer, leerLedger } from '@/lib/fba/ledger'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA PASADA DE REMESAS: LIBRO MAYOR + STOCK EN LOS ALMACENES DE AMAZON.
 *
 * Una vez al día. Las dos cosas van juntas porque el panel de remesas las
 * necesita a la vez: el libro mayor dice qué se ha consumido y el stock dice si
 * el reparto cuadra con la realidad.
 *
 *
 * ============ POR QUÉ NO VIVE DENTRO DEL CICLO DE CATÁLOGO ============
 *
 * Porque ahí el stock de FBA solo se pedía si el tramo de catálogo que tocaba en
 * esa pasada contenía alguna referencia de FBA:
 *
 *     const fba = catalogo.items.some((i) => i.isFba) ? await fetchFbaInventory(…)
 *
 * Con ShoesF eso es un problema de verdad: 42.737 listings, de los que 1.756 son
 * de FBA —un 4 %—. La lectura depende de por dónde vaya el barrido, puede tardar
 * horas en caer en un tramo con FBA, y mientras tanto el panel de remesas no
 * tiene contra qué cuadrar. Es exactamente lo que pasó el primer día.
 *
 * Aquí se le pide a Amazon el inventario de FBA DIRECTAMENTE. getInventorySummaries
 * devuelve solo lo que está en sus almacenes, así que para ShoesF son 1.756
 * referencias en vez de recorrer 42.737 esperando a tener suerte.
 *
 *
 * ============ SOLO LAS CUENTAS CON REMESAS ============
 *
 * Un cliente sin remesas no tiene nada que consumir, y pedirle el libro mayor
 * gasta una ficha de createReport —que se repone UNA VEZ POR MINUTO— para
 * guardar movimientos que nadie va a mirar.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 600

/** Se deja margen dentro de los 600 s para que la última cuenta termine entera */
const PRESUPUESTO_MS = 540_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('fba-remesas')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  }

  const salida = await conRegistro('fba-remesas', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const service = createServiceClient()

    const { data: conRemesas, error } = await service
      .from('fba_remesas')
      .select('connection_id, marketplace_id, fecha_envio')
      .not('connection_id', 'is', null)
      .order('fecha_envio', { ascending: true })
    if (error) throw error

    // La más antigua de cada (conexión, mercado): es desde donde hay que leer la
    // primera vez. Ver desdeCuandoLeer() en lib/fba/ledger.ts.
    const unidades = new Map<string, { conexion: string; mercado: string; primera: string }>()
    for (const r of (conRemesas ?? []) as Array<{
      connection_id: string
      marketplace_id: string
      fecha_envio: string
    }>) {
      const clave = `${r.connection_id}|${r.marketplace_id}`
      if (!unidades.has(clave)) {
        unidades.set(clave, {
          conexion: r.connection_id,
          mercado: r.marketplace_id,
          primera: r.fecha_envio,
        })
      }
    }

    const resultados: Array<Record<string, unknown>> = []

    for (const u of unidades.values()) {
      if (Date.now() - arranque > PRESUPUESTO_MS) {
        resultados.push({ conexion: u.conexion, saltado: 'sin tiempo en esta pasada' })
        continue
      }

      try {
        const resuelta = await connectionCredentials(u.conexion)
        if (!resuelta) {
          resultados.push({ conexion: u.conexion, saltado: 'la conexión ya no existe' })
          continue
        }
        const { connection, credentials } = resuelta

        /* ---------- 1) El stock, que es rápido y no depende de nada ---------- */
        let conStock = 0
        try {
          const fba = await fetchFbaInventory(credentials, u.mercado)
          for (const [sku, cantidades] of fba) {
            const { error: errStock } = await service
              .from('amazon_listings')
              .update({
                fba_quantity: cantidades.total,
                fba_fulfillable_quantity: cantidades.fulfillable,
                updated_at: new Date().toISOString(),
              })
              .eq('connection_id', u.conexion)
              .eq('marketplace_id', u.mercado)
              .eq('sku', sku)
            if (!errStock) conStock++
          }
        } catch (e) {
          // Que falle el stock NO impide leer el libro mayor: son dos datos
          // independientes y el reparto es el que de verdad hace falta.
          resultados.push({
            conexion: connection.name,
            avisoStock: e instanceof Error ? e.message.slice(0, 200) : 'error leyendo el stock',
          })
        }

        /* ---------- 1bis) El seguimiento de los envíos ---------- */
        //
        // Solo los que TIENEN número —sin él Amazon no sabe de cuál le hablamos—
        // y solo los que siguen vivos: un envío CERRADO ya no cambia, y volver a
        // preguntar cada noche es gastar cupo para recibir lo mismo.
        let seguidos = 0
        let faltantes = 0
        try {
          const { data: aSeguir } = await service
            .from('fba_remesas')
            .select('id, referencia_envio, estado_amazon')
            .eq('connection_id', u.conexion)
            .not('referencia_envio', 'is', null)

          const vivas = ((aSeguir ?? []) as Array<{
            id: string
            referencia_envio: string
            estado_amazon: string | null
          }>).filter((r) => sigueVivo(r.estado_amazon))

          if (vivas.length > 0) {
            const estados = await estadoDeEnvios(
              credentials,
              u.mercado,
              vivas.map((r) => r.referencia_envio)
            )

            for (const remesa of vivas) {
              const info = estados.get(remesa.referencia_envio)
              if (!info) {
                // Amazon no lo conoce: casi siempre un número mal escrito. Se
                // deja dicho en la propia remesa en vez de callarlo.
                await service
                  .from('fba_remesas')
                  .update({
                    seguimiento_at: new Date().toISOString(),
                    seguimiento_error: 'Amazon no reconoce este número de envío',
                  })
                  .eq('id', remesa.id)
                continue
              }

              // Las unidades recibidas, por referencia. Es lo que convierte un
              // descuadre en una reclamación con envío y SKU.
              const lineas = await lineasDeEnvio(credentials, u.mercado, remesa.referencia_envio)
              for (const l of lineas) {
                const { error: errLinea } = await service
                  .from('fba_remesa_lineas')
                  .update({ unidades_recibidas: l.recibidas, updated_at: new Date().toISOString() })
                  .eq('remesa_id', remesa.id)
                  .eq('sku', l.sku)
                if (!errLinea && l.recibidas < l.enviadas) faltantes += l.enviadas - l.recibidas
              }

              await service
                .from('fba_remesas')
                .update({
                  estado_amazon: info.estado,
                  seguimiento_at: new Date().toISOString(),
                  seguimiento_error: null,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', remesa.id)
              seguidos++
            }
          }
        } catch (e) {
          // Que falle el seguimiento NO impide leer el libro mayor: el reparto
          // es lo que de verdad hace falta y no depende de esto.
          resultados.push({
            conexion: connection.name,
            avisoSeguimiento: e instanceof Error ? e.message.slice(0, 200) : 'error en el seguimiento',
          })
        }

        /* ---------- 2) El libro mayor ---------- */
        const { data: lecturaPrevia } = await service
          .from('fba_lecturas')
          .select('leido_hasta')
          .eq('connection_id', u.conexion)
          .eq('marketplace_id', u.mercado)
          .maybeSingle()
        const leidoHasta =
          (lecturaPrevia as { leido_hasta: string | null } | null)?.leido_hasta ?? null

        const hoy = new Date()
        const desde = desdeCuandoLeer(leidoHasta, hoy, u.primera)
        const hasta = new Date(hoy.getTime() - 60 * 60_000)

        const lectura = await leerLedger(credentials, u.mercado, desde, hasta)
        if (!lectura) {
          resultados.push({ conexion: connection.name, error: 'Amazon no devolvió el informe' })
          continue
        }

        // Borrar la ventana ANTES de escribirla. Al revés, una pasada cortada a
        // mitad deja los movimientos duplicados y cada venta contaría doble.
        await service
          .from('fba_movimientos')
          .delete()
          .eq('connection_id', u.conexion)
          .eq('marketplace_id', u.mercado)
          .gte('fecha', lectura.desde)
          .lte('fecha', lectura.hasta)

        const filas = lectura.movimientos.map((m) => ({
          connection_id: u.conexion,
          marketplace_id: u.mercado,
          sku: m.sku,
          asin: m.asin,
          fecha: m.fecha,
          ocurrido_at: m.ocurridoAt,
          tipo: m.tipo,
          referencia: m.referencia,
          cantidad: m.cantidad,
          disposicion: m.disposicion,
          motivo: m.motivo,
          centro: m.centro,
          pais: m.pais,
        }))
        for (let i = 0; i < filas.length; i += 500) {
          const { error: errIns } = await service
            .from('fba_movimientos')
            .insert(filas.slice(i, i + 500))
          if (errIns) throw errIns
        }

        /* ---------- 2bis) El FNSKU al espejo del catálogo ---------- */
        //
        // Sin FNSKU no hay etiqueta de producto, y el libro mayor lo trae en una
        // columna que ya estamos leyendo. Se guarda en el espejo para que lo
        // tenga TODA referencia de FBA, no solo las que alguien tecleó.
        //
        // Solo se escribe lo que cambia: son miles de referencias y volver a
        // escribir el mismo valor cada noche es trabajo que no cambia nada.
        const fnskuPorSku = new Map<string, string>()
        for (const m of lectura.movimientos) {
          if (m.fnsku && !fnskuPorSku.has(m.sku)) fnskuPorSku.set(m.sku, m.fnsku)
        }
        let fnskusPuestos = 0
        if (fnskuPorSku.size > 0) {
          const { data: yaTienen } = await service
            .from('amazon_listings')
            .select('sku, fnsku')
            .eq('connection_id', u.conexion)
            .eq('marketplace_id', u.mercado)
            .in('sku', [...fnskuPorSku.keys()])

          const actual = new Map(
            ((yaTienen ?? []) as Array<{ sku: string; fnsku: string | null }>).map((l) => [l.sku, l.fnsku])
          )
          for (const [sku, fnsku] of fnskuPorSku) {
            if (actual.get(sku) === fnsku) continue
            const { error: errFnsku } = await service
              .from('amazon_listings')
              .update({ fnsku })
              .eq('connection_id', u.conexion)
              .eq('marketplace_id', u.mercado)
              .eq('sku', sku)
            if (!errFnsku) fnskusPuestos++
          }
        }

        /* ---------- 3) Las entradas reconocen su remesa ---------- */
        const llegadas = new Map<string, string>()
        for (const m of lectura.movimientos) {
          if (m.tipo !== 'Receipts' || !m.referencia) continue
          const previa = llegadas.get(m.referencia)
          if (!previa || m.fecha < previa) llegadas.set(m.referencia, m.fecha)
        }
        let reconocidas = 0
        for (const [referencia, fecha] of llegadas) {
          const { data } = await service
            .from('fba_remesas')
            .update({ llegada_at: `${fecha}T00:00:00Z`, updated_at: new Date().toISOString() })
            .eq('connection_id', u.conexion)
            .eq('referencia_envio', referencia)
            .is('llegada_at', null)
            .select('id')
          reconocidas += (data ?? []).length
        }

        await service.from('fba_lecturas').upsert(
          {
            connection_id: u.conexion,
            marketplace_id: u.mercado,
            leido_hasta: lectura.hasta,
            ultimo_informe: lectura.reportId,
            ultimo_intento_at: new Date().toISOString(),
            ultimo_error: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id,marketplace_id' }
        )

        resultados.push({
          conexion: connection.name,
          desde: lectura.desde,
          hasta: lectura.hasta,
          movimientos: filas.length,
          descartadas: lectura.descartadas,
          stockRefrescado: conStock,
          fnskusPuestos,
          remesasReconocidas: reconocidas,
          enviosSeguidos: seguidos,
          unidadesQueNoLlegaron: faltantes,
        })
      } catch (e) {
        const mensaje = e instanceof Error ? e.message.slice(0, 500) : 'Error desconocido'
        await service.from('fba_lecturas').upsert(
          {
            connection_id: u.conexion,
            marketplace_id: u.mercado,
            ultimo_intento_at: new Date().toISOString(),
            ultimo_error: mensaje,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id,marketplace_id' }
        )
        // Una cuenta que falla NO se lleva por delante a las demás.
        resultados.push({ conexion: u.conexion, error: mensaje })
      }
    }

    const movimientos = resultados.reduce((s, r) => s + ((r.movimientos as number) ?? 0), 0)
    return {
      ok: true,
      cuentas: unidades.size,
      movimientos,
      resumen: `${unidades.size} cuentas, ${movimientos} movimientos`,
      resultados,
    }
  })

  return NextResponse.json(salida)
}
