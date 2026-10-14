'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import { cx, Tarjeta } from '../comun/ui'

/**
 * LOS DOS EXCEL QUE SE SUBEN A SELLER CENTRAL, EN EL ORDEN EN QUE SE SUBEN.
 *
 *   1 · MANIFIESTO   qué referencias van y cuántas de cada. LO DA EL ERP: un clic y se
 *                    descarga ya hecho, sobre la plantilla de Amazon que el ERP lleva
 *                    dentro. Se sube en «Enviar a Amazon» y Amazon carga todo el pedido.
 *   2 · EMBALAJE     en qué caja va cada unidad, con peso y medidas. Este SÍ necesita la
 *                    plantilla de Amazon, porque Amazon la genera DESPUÉS, al procesar el
 *                    manifiesto: lleva una fila por cada SKU del envío y el bloque de
 *                    medidas en un sitio distinto cada vez. Entra con la petición, se
 *                    rellena en memoria y sale; no se guarda.
 *
 * El orden importa y la pantalla lo dice: primero se descarga y sube el manifiesto, y
 * solo cuando Amazon lo ha procesado da la plantilla del segundo.
 */

interface Resultado {
  ok: boolean
  texto: string
  avisos?: string
}

/** Baja al disco lo que ha devuelto la ruta, con el nombre que ella propone */
async function bajarFichero(res: Response, nombreSiFalta: string) {
  const blob = await res.blob()
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? nombreSiFalta
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export function PlantillasAmazon({ remesaId, referencias, unidades }: { remesaId: string; referencias: number; unidades: number }) {
  return (
    <Tarjeta
      titulo="Preparar el envío en Seller Central"
      ayuda="El manifiesto te lo da el ERP. El embalaje, cuando Amazon te dé su plantilla"
      cuerpo={false}
    >
      <div className="grid divide-y divide-[var(--ls-linea)] md:grid-cols-2 md:divide-x md:divide-y-0">
        <PasoManifiesto remesaId={remesaId} referencias={referencias} unidades={unidades} />
        <PasoEmbalaje remesaId={remesaId} />
      </div>
    </Tarjeta>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · Manifiesto: un clic                                             */
/* ------------------------------------------------------------------ */

function PasoManifiesto({ remesaId, referencias, unidades }: { remesaId: string; referencias: number; unidades: number }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [propia, setPropia] = useState<File | null>(null)
  const [verPropia, setVerPropia] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [descargado, setDescargado] = useState(false)

  async function descargar() {
    setTrabajando(true)
    setResultado(null)
    try {
      // Sin plantilla propia el cuerpo va vacío y la ruta usa la de Amazon que lleva el ERP
      const form = new FormData()
      if (propia) form.append('plantilla', propia)
      const res = await fetch(`/api/fba/remesas/${remesaId}/manifiesto`, { method: 'POST', body: form })
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        const texto = p?.error ?? 'No se ha podido generar el manifiesto'
        setResultado({ ok: false, texto })
        toast.error(texto)
        return
      }
      await bajarFichero(res, 'manifiesto.xlsx')
      const descartadas = Number(res.headers.get('X-Descartadas') ?? 0)
      const r: Resultado = {
        ok: true,
        texto: `${res.headers.get('X-Lineas')} líneas y ${res.headers.get('X-Unidades')} unidades en el archivo${res.headers.get('X-Plantilla') === 'propia' ? ' (con tu plantilla)' : ''}.`,
        avisos: descartadas > 0 ? `${descartadas} sin poder incluir: ${decodeURIComponent(res.headers.get('X-Motivos') ?? '')}` : undefined,
      }
      setResultado(r)
      setDescargado(true)
      if (r.avisos) toast.warning(r.avisos, { duration: 10_000 })
      else toast.success('Manifiesto descargado. Ahora súbelo en Seller Central')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-[2px] h-4 w-4 shrink-0 text-[var(--ls-t3)]" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">1 · Manifiesto</p>
          <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
            Qué referencias van y cuántas de cada: con este archivo Amazon carga todo el pedido de golpe. Ya está hecho, no hay que subir nada.
          </p>
        </div>
      </div>

      <p className="pl-6 text-[12px] text-[var(--ls-t2)]">
        <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{referencias}</b> referencia{referencias === 1 ? '' : 's'} ·{' '}
        <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{unidades.toLocaleString('es-ES')}</b> unidades
      </p>

      <div className="pl-6">
        <button type="button" onClick={descargar} disabled={trabajando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
          {trabajando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {trabajando ? 'Preparando…' : descargado ? 'Descargar otra vez' : 'Descargar manifiesto'}
        </button>
      </div>

      {resultado && (
        <div className="flex items-start gap-2 pl-6 text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">
          {resultado.ok ? (
            <CheckCircle2 className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.verde }} />
          ) : (
            <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          )}
          <span>
            {resultado.texto}
            {resultado.avisos && <span className="mt-[2px] block text-[var(--ls-t3)]">{resultado.avisos}</span>}
          </span>
        </div>
      )}

      <ol className="ml-6 list-decimal space-y-[2px] pl-4 text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
        <li>
          En Seller Central: <b className="font-medium text-[var(--ls-t2)]">Cadena de suministro → Enviar a Amazon → Crear envío</b> y elige subir un archivo.
        </li>
        <li>Sube este Excel. Amazon carga las referencias y las cantidades.</li>
        <li>Cuando te pida la información de embalaje, sigue con el paso 2.</li>
      </ol>

      {/* La salida para el día que Amazon cambie el formato: rellenar SU plantilla en vez de la integrada */}
      <div className="pl-6">
        {!verPropia ? (
          <button type="button" onClick={() => setVerPropia(true)} className="text-[11px] text-[var(--ls-t4)] underline-offset-2 hover:text-[var(--ls-t2)] hover:underline">
            ¿Amazon ha cambiado la plantilla? Usa la tuya
          </button>
        ) : (
          <div className="space-y-[6px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2">
            <p className="text-[11px] leading-[1.5] text-[var(--ls-t3)]">
              Si Amazon publica otro formato, baja su plantilla vacía de «Enviar a Amazon» y elígela: el manifiesto se rellena sobre ella en lugar de la que lleva el ERP.
            </p>
            <input
              ref={entrada}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                setPropia(e.target.files?.[0] ?? null)
                setResultado(null)
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => entrada.current?.click()} className={cx(BOTON.base, BOTON.secundario)}>
                <Upload className="h-3 w-3" />
                {propia ? 'Cambiar plantilla' : 'Elegir plantilla (.xlsx)'}
              </button>
              {propia && (
                <span className="inline-flex max-w-[220px] items-center gap-1 text-[11.5px] text-[var(--ls-t2)]" title={propia.name}>
                  <span className="truncate">{propia.name}</span>
                  <button type="button" onClick={() => setPropia(null)} className={BOTON.icono} aria-label="Quitar la plantilla">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setVerPropia(false)
                  setPropia(null)
                }}
                className="ml-auto text-[11px] text-[var(--ls-t4)] hover:text-[var(--ls-t2)]"
              >
                Volver a la del ERP
              </button>
            </div>
            {propia && <p className="text-[11px] text-[var(--ls-t3)]">El botón de arriba rellenará esta plantilla.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2 · Embalaje: con la plantilla que da Amazon                        */
/* ------------------------------------------------------------------ */

function PasoEmbalaje({ remesaId }: { remesaId: string }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function generar() {
    if (!archivo) return
    setTrabajando(true)
    setResultado(null)
    try {
      const form = new FormData()
      form.append('plantilla', archivo)
      const res = await fetch(`/api/fba/remesas/${remesaId}/embalaje`, { method: 'POST', body: form })
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        const texto = p?.error ?? 'No se ha podido rellenar la plantilla'
        setResultado({ ok: false, texto })
        toast.error(texto)
        return
      }
      await bajarFichero(res, 'embalaje.xlsx')
      const desc = Number(res.headers.get('X-Descuadres') ?? 0)
      const r: Resultado = {
        ok: true,
        texto: `${res.headers.get('X-Cajas')} cajas y ${res.headers.get('X-Unidades')} unidades rellenadas.`,
        avisos: desc > 0 ? `Descuadres con lo que espera Amazon: ${decodeURIComponent(res.headers.get('X-Descuadre-Detalle') ?? '')}` : undefined,
      }
      setResultado(r)
      if (r.avisos) toast.warning(r.avisos, { duration: 10_000 })
      else toast.success(r.texto)
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-[2px] h-4 w-4 shrink-0 text-[var(--ls-t3)]" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">2 · Embalaje</p>
          <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
            En qué caja va cada unidad, con peso y medidas. Esta plantilla la genera Amazon <b className="font-medium text-[var(--ls-t2)]">después</b> de procesar el manifiesto, con las referencias de ese envío: en
            Seller Central, al llegar a «Información de embalaje de la caja», descárgala, elígela aquí y baja el Excel ya relleno.
          </p>
        </div>
      </div>

      <input
        ref={entrada}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          setArchivo(e.target.files?.[0] ?? null)
          setResultado(null)
        }}
      />
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <button type="button" onClick={() => entrada.current?.click()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
          <Upload className="h-3 w-3" />
          {archivo ? 'Cambiar plantilla' : 'Elegir la plantilla de Amazon (.xlsx)'}
        </button>
        {archivo && (
          <span className="max-w-[220px] truncate text-[11.5px] text-[var(--ls-t2)]" title={archivo.name}>
            {archivo.name}
          </span>
        )}
      </div>
      <div className="pl-6">
        <button type="button" onClick={generar} disabled={!archivo || trabajando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
          {trabajando ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
          {trabajando ? 'Rellenando…' : 'Rellenar y descargar'}
        </button>
      </div>

      {resultado && (
        <div className="flex items-start gap-2 pl-6 text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">
          {resultado.ok ? (
            <CheckCircle2 className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.verde }} />
          ) : (
            <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} />
          )}
          <span>
            {resultado.texto}
            {resultado.avisos && <span className="mt-[2px] block text-[var(--ls-t3)]">{resultado.avisos}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
