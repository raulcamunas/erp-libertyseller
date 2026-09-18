'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

/**
 * DAR DE ALTA UNA REMESA PEGANDO LA TABLA.
 *
 * El alta no es un formulario fila a fila y no es por comodidad: una remesa de
 * ShoesF trae 83 líneas. Teclearlas es exactamente lo que hizo que el Excel
 * dejara de actualizarse, y un formulario lento aquí acabaría igual.
 *
 * Así que se pega directamente desde la hoja de cálculo. Se acepta lo que salga
 * de copiar unas celdas de Excel —columnas separadas por tabulador— y también
 * comas y punto y coma, porque a veces se pega desde un CSV.
 *
 *
 * ============ LAS COLUMNAS SE ADIVINAN, PERO SE ENSEÑAN ============
 *
 * Se detecta si la primera fila es una cabecera y se casan los nombres que ya
 * usabais («FBASKU», «Unidades a enviar», «Talla»…). Pero el resultado se PINTA
 * antes de guardar: adivinar sin enseñar es como se acaba metiendo una columna
 * de tallas en el hueco de las unidades y no enterarse hasta que los números no
 * cuadran.
 */

interface LineaPegada {
  sku: string
  unidades: number
  referencia: string | null
  nombre: string | null
  variante: string | null
  ean: string | null
  fnsku: string | null
  asin: string | null
}

/** Los nombres que ya se usaban en el Excel, más los evidentes */
const NOMBRES: Record<keyof LineaPegada, string[]> = {
  sku: ['fbasku', 'sku', 'msku', 'seller sku', 'sku amazon'],
  unidades: ['unidades a enviar', 'unidades', 'cantidad', 'uds', 'qty', 'quantity'],
  referencia: ['ref', 'referencia', 'modelo'],
  nombre: ['nombre y color', 'nombre', 'producto', 'titulo', 'título', 'descripcion', 'descripción'],
  variante: ['talla', 'variante', 'color', 'size'],
  ean: ['ean', 'codigo de barras', 'código de barras', 'barcode'],
  fnsku: ['fnsku'],
  asin: ['asin'],
}

function partirFilas(texto: string): string[][] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.split(',')))
    .map((c) => c.map((x) => x.trim().replace(/^"|"$/g, '')))
}

function esCabecera(fila: string[]): boolean {
  const norm = fila.map((c) => c.toLowerCase())
  return Object.values(NOMBRES).some((alias) => norm.some((c) => alias.includes(c)))
}

function mapearColumnas(cabecera: string[]): Partial<Record<keyof LineaPegada, number>> {
  const norm = cabecera.map((c) => c.toLowerCase().trim())
  const mapa: Partial<Record<keyof LineaPegada, number>> = {}
  for (const [campo, alias] of Object.entries(NOMBRES) as Array<[keyof LineaPegada, string[]]>) {
    const i = norm.findIndex((c) => alias.includes(c))
    if (i >= 0) mapa[campo] = i
  }
  return mapa
}

function interpretar(texto: string): { lineas: LineaPegada[]; avisos: string[] } {
  const filas = partirFilas(texto)
  const avisos: string[] = []
  if (filas.length === 0) return { lineas: [], avisos }

  const conCabecera = esCabecera(filas[0])
  const mapa = conCabecera
    ? mapearColumnas(filas[0])
    : // Sin cabecera se asume el orden mínimo: SKU y unidades. Es lo único
      // que se puede suponer sin equivocarse a lo grande.
      { sku: 0, unidades: 1 }
  const cuerpo = conCabecera ? filas.slice(1) : filas

  if (mapa.sku === undefined || mapa.unidades === undefined) {
    avisos.push(
      'No encuentro la columna del SKU o la de las unidades. Pega también la fila de títulos, ' +
        'o deja el SKU en la primera columna y las unidades en la segunda.'
    )
    return { lineas: [], avisos }
  }

  const lineas: LineaPegada[] = []
  const vistos = new Map<string, number>()

  for (const [i, c] of cuerpo.entries()) {
    const sku = (c[mapa.sku] ?? '').trim()
    if (!sku) continue

    // Las hojas de cálculo escriben 1.234 o 1,5. Se queda solo lo numérico.
    const bruto = (c[mapa.unidades] ?? '').replace(/[^\d-]/g, '')
    const unidades = Number(bruto)
    if (!Number.isInteger(unidades) || unidades <= 0) {
      avisos.push(`Fila ${i + 1} (${sku}): «${c[mapa.unidades] ?? ''}» no son unidades válidas`)
      continue
    }

    if (vistos.has(sku)) {
      // Se SUMAN en vez de rechazar: dos cajas del mismo modelo en una hoja es
      // lo normal, y hacer que el usuario las sume a mano es pedirle que haga
      // justo lo que esto viene a evitar.
      const idx = vistos.get(sku)!
      lineas[idx].unidades += unidades
      continue
    }

    const texto = (campo: keyof LineaPegada): string | null => {
      const i = mapa[campo]
      if (i === undefined) return null
      const v = (c[i] ?? '').trim()
      return v.length > 0 ? v : null
    }

    vistos.set(sku, lineas.length)
    lineas.push({
      sku,
      unidades,
      referencia: texto('referencia'),
      nombre: texto('nombre'),
      variante: texto('variante'),
      ean: texto('ean'),
      fnsku: texto('fnsku'),
      asin: texto('asin'),
    })
  }

  return { lineas, avisos }
}

export function NuevaRemesaDialog({
  clienteId,
  clienteNombre,
  marketplaceId = 'A1RKKUPIHCS9HS',
  onClose,
}: {
  clienteId: string
  clienteNombre: string
  marketplaceId?: string
  onClose: () => void
}) {
  const router = useRouter()
  const [nombre, setNombre] = useState('')
  const [fechaEnvio, setFechaEnvio] = useState(() => new Date().toISOString().slice(0, 10))
  const [referenciaEnvio, setReferenciaEnvio] = useState('')
  const [pegado, setPegado] = useState('')
  const [guardando, setGuardando] = useState(false)

  const { lineas, avisos } = useMemo(() => interpretar(pegado), [pegado])
  const totalUnidades = lineas.reduce((s, l) => s + l.unidades, 0)

  async function guardar() {
    if (lineas.length === 0) return
    setGuardando(true)
    try {
      const res = await fetch('/api/fba/remesas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          marketplaceId,
          nombre: nombre.trim() || null,
          fechaEnvio,
          referenciaEnvio: referenciaEnvio.trim() || null,
          lineas,
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error ?? 'No se ha podido crear la remesa')
        return
      }
      toast.success(`Remesa creada: ${lineas.length} referencias, ${totalUnidades} unidades`)
      onClose()
      router.refresh()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="glass-card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-white">Nueva remesa</h2>
            <p className="text-[11px] text-white/40">{clienteNombre}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-white/40 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            <Campo etiqueta="Nombre" pista="Como lo llames tú. Opcional">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Envío de septiembre"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/20 focus:border-[#FF6600]/40 focus:outline-none"
              />
            </Campo>
            <Campo etiqueta="Fecha de envío" pista="Desde aquí empieza a contar">
              <input
                type="date"
                value={fechaEnvio}
                onChange={(e) => setFechaEnvio(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white focus:border-[#FF6600]/40 focus:outline-none"
              />
            </Campo>
            <Campo etiqueta="Nº de envío FBA" pista="Opcional. Para reconocer la llegada">
              <input
                value={referenciaEnvio}
                onChange={(e) => setReferenciaEnvio(e.target.value)}
                placeholder="FBA15ABCDEF"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] text-white placeholder:text-white/20 focus:border-[#FF6600]/40 focus:outline-none"
              />
            </Campo>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/60">
              Pega aquí las referencias
            </label>
            <p className="mb-2 text-[10px] leading-relaxed text-white/35">
              Copia las celdas directamente de tu hoja de cálculo, con la fila de títulos incluida.
              Reconoce los nombres que ya usabas: FBASKU, Unidades a enviar, Talla, REF, Nombre y
              color, EAN, FNSKU y ASIN.
            </p>
            <textarea
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'FBASKU\tUnidades a enviar\tTalla\nFBA047768-40\t2\t40'}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 font-mono text-[11px] text-white placeholder:text-white/20 focus:border-[#FF6600]/40 focus:outline-none"
            />
          </div>

          {avisos.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2">
              {avisos.slice(0, 6).map((a) => (
                <p key={a} className="text-[11px] text-amber-200/90">
                  {a}
                </p>
              ))}
              {avisos.length > 6 && (
                <p className="text-[10px] text-amber-200/60">y {avisos.length - 6} más</p>
              )}
            </div>
          )}

          {lineas.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] text-white/50">
                <span className="font-semibold text-white">{lineas.length}</span> referencias ·{' '}
                <span className="font-semibold text-white">{totalUnidades}</span> unidades. Repásalo
                antes de guardar.
              </p>
              <div className="max-h-52 overflow-auto rounded-lg border border-white/10">
                <table className="w-full">
                  <thead className="sticky top-0 bg-[#0d0d0d]">
                    <tr>
                      <th className="border-b border-white/10 px-2 py-1 text-left text-[9px] uppercase tracking-wider text-white/40">
                        SKU
                      </th>
                      <th className="border-b border-white/10 px-2 py-1 text-left text-[9px] uppercase tracking-wider text-white/40">
                        Producto
                      </th>
                      <th className="border-b border-white/10 px-2 py-1 text-left text-[9px] uppercase tracking-wider text-white/40">
                        Variante
                      </th>
                      <th className="border-b border-white/10 px-2 py-1 text-right text-[9px] uppercase tracking-wider text-white/40">
                        Unidades
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l) => (
                      <tr key={l.sku} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-2 py-1 font-mono text-[11px] text-white/70">{l.sku}</td>
                        <td className="max-w-[200px] truncate px-2 py-1 text-[11px] text-white/60">
                          {l.nombre ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-[11px] text-white/60">{l.variante ?? '—'}</td>
                        <td className="px-2 py-1 text-right text-[11px] font-semibold text-white">
                          {l.unidades}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-white/50 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={lineas.length === 0 || guardando}
            className="flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#FF6600]/85 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar remesa
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({
  etiqueta,
  pista,
  children,
}: {
  etiqueta: string
  pista: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-white/60">{etiqueta}</label>
      {children}
      <p className="mt-1 text-[9px] text-white/30">{pista}</p>
    </div>
  )
}
