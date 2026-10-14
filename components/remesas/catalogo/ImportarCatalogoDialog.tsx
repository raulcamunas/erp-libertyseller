'use client'

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { AVISO, BOTON, CAMPO, CIFRAS, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { AvisoImportacion, ResumenImportacion } from '@/lib/fba/catalogo/importar'
import { cx } from '../comun/ui'
import { cargarCatalogo } from './useCatalogo'

/**
 * IMPORTAR LA HOJA DE REFERENCIAS.
 *
 * Es la forma de cargar de golpe lo que ya está en la hoja de cálculo —418 tallas en
 * el caso de ShoesF— y la de tenerla al día cuando alguien la amplía por su lado.
 *
 * SE ENSEÑA ANTES DE ESCRIBIR. Nada más elegir el archivo, el servidor lo lee y lo
 * cruza con lo que hay, y aquí se cuenta qué haría: cuántas filas son nuevas, cuántas
 * completan una existente, cuáles se saltan y por qué, y qué datos tienen mala pinta
 * (un FNSKU copiado de la talla de al lado, un FBASKU que acaba en otra talla). Solo
 * entonces se pulsa Importar, y se aplica ese mismo plan.
 *
 * NO BORRA NADA, y una celda en blanco no vacía lo que ya hubiera: se puede volver a
 * subir la hoja entera sin miedo a pisar lo que se completó a mano.
 */

type Fase = 'elegir' | 'leyendo' | 'listo' | 'importando'

export function ImportarCatalogoDialog({
  clienteId,
  clienteNombre,
  onCerrar,
  onImportado,
}: {
  clienteId: string
  clienteNombre: string
  onCerrar: () => void
  onImportado?: () => void
}) {
  const [fase, setFase] = useState<Fase>('elegir')
  const [texto, setTexto] = useState('')
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)
  const [pegando, setPegando] = useState(false)
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null)
  const [errorRed, setErrorRed] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const peticion = useRef(0)

  /** Lee y cruza SIN escribir. Si llegan dos a la vez, vale la última */
  async function leer(contenido: string) {
    const mia = ++peticion.current
    setFase('leyendo')
    setErrorRed(null)
    try {
      const res = await fetch('/api/fba/catalogo/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, texto: contenido, simular: true }),
      })
      const p = (await res.json().catch(() => null)) as (ResumenImportacion & { error?: string | null }) | null
      if (mia !== peticion.current) return
      if (!res.ok || !p) {
        setErrorRed((p as { error?: string } | null)?.error ?? 'No se ha podido leer el archivo')
        setResumen(null)
        setFase('elegir')
        return
      }
      setResumen(p)
      setFase('listo')
    } catch {
      if (mia !== peticion.current) return
      setErrorRed('No se ha podido conectar con el servidor')
      setFase('elegir')
    }
  }

  /** UTF-8 y, si no es UTF-8 (un CSV de Excel en español), Windows-1252: sin esto «COÑAC» sale «CO�AC» */
  async function leerArchivo(archivo: File) {
    const buffer = await archivo.arrayBuffer()
    let contenido: string
    try {
      contenido = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      contenido = new TextDecoder('windows-1252').decode(buffer)
    }
    setNombreArchivo(archivo.name)
    setTexto(contenido)
    void leer(contenido)
  }

  // Pegar: se lee cuando se deja de teclear
  useEffect(() => {
    if (!pegando || texto.trim() === '') return
    const t = setTimeout(() => void leer(texto), 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, pegando])

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastrando(false)
    const archivo = e.dataTransfer.files?.[0]
    if (archivo) void leerArchivo(archivo)
  }

  async function importar() {
    if (!resumen) return
    setFase('importando')
    try {
      const res = await fetch('/api/fba/catalogo/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, texto, simular: false }),
      })
      const p = (await res.json().catch(() => null)) as (ResumenImportacion & { error?: string | null }) | null
      if (!res.ok || !p) {
        toast.error((p as { error?: string } | null)?.error ?? 'No se ha podido importar')
        setFase('listo')
        return
      }
      const r = p.resultado
      await cargarCatalogo(clienteId, true)
      if (r) {
        const partes = [`${r.creadas} nueva${r.creadas === 1 ? '' : 's'}`]
        if (r.actualizadas > 0) partes.push(`${r.actualizadas} completada${r.actualizadas === 1 ? '' : 's'}`)
        if (r.fallidas > 0) toast.warning(`${partes.join(', ')}. ${r.fallidas} no se han podido guardar: vuelve a importar y mira qué choca.`)
        else toast.success(`Importado: ${partes.join(', ')}`)
      }
      onImportado?.()
      onCerrar()
    } catch {
      toast.error('No se ha podido conectar con el servidor')
      setFase('listo')
    }
  }

  const aplicables = resumen ? resumen.nuevas + resumen.cambian : 0
  const saltadas = resumen ? resumen.avisos.filter((a) => a.tipo === 'saltada' || a.tipo === 'repetida' || a.tipo === 'choque').length + resumen.conflictos.length : 0
  const aRevisar = resumen ? resumen.avisos.filter((a) => a.tipo === 'dato') : []
  const ocupado = fase === 'leyendo' || fase === 'importando'

  return (
    <Dialogo
      titulo="Importar referencias"
      entradilla={`Sube el CSV de la hoja de ${clienteNombre} (REF, Nombre y color, Talla, EAN, FBASKU, FNSKU, ASIN…) o pega las celdas. Antes de guardar nada te enseño qué haría. No borra lo que ya hay.`}
      onCerrar={onCerrar}
      ancho="max-w-[820px]"
      pie={
        <>
          {resumen && fase !== 'elegir' && (
            <button
              type="button"
              onClick={() => {
                setResumen(null)
                setTexto('')
                setNombreArchivo(null)
                setPegando(false)
                setFase('elegir')
              }}
              disabled={ocupado}
              className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'mr-auto')}
            >
              Elegir otro archivo
            </button>
          )}
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          <button type="button" onClick={importar} disabled={!resumen || !!resumen.error || resumen.sinMigrar || aplicables === 0 || ocupado} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {fase === 'importando' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {fase === 'importando' ? 'Importando…' : aplicables > 0 ? `Importar ${aplicables.toLocaleString('es-ES')} fila${aplicables === 1 ? '' : 's'}` : 'Importar'}
          </button>
        </>
      }
    >
      {/* ================= ELEGIR ================= */}
      {(fase === 'elegir' || !resumen) && fase !== 'leyendo' && (
        <div className="space-y-2">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setArrastrando(true)
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={alSoltar}
            className={cx(
              'flex flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed px-6 py-8 text-center transition-colors',
              arrastrando ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)]'
            )}
          >
            <FileSpreadsheet className="h-7 w-7 text-[var(--ls-t4)]" />
            <p className="text-[12.5px] text-[var(--ls-t2)]">Arrastra aquí el CSV de la hoja, o</p>
            <input ref={entrada} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && void leerArchivo(e.target.files[0])} />
            <button type="button" onClick={() => entrada.current?.click()} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
              <Upload className="h-3 w-3" />
              Elegir archivo
            </button>
            <p className="max-w-[460px] text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
              En Google Sheets: <b className="font-semibold text-[var(--ls-t2)]">Archivo → Descargar → Valores separados por comas (.csv)</b>. La primera fila tiene que llevar los títulos.
            </p>
          </div>

          {errorRed && (
            <div className={cx(AVISO.base, AVISO.conTono)} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
              {errorRed}
            </div>
          )}

          <button type="button" onClick={() => setPegando((v) => !v)} className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]" aria-expanded={pegando}>
            <ChevronDown className={cx('h-3 w-3 transition-transform', pegando && 'rotate-180')} />
            O pega las celdas en vez de subir un archivo
          </button>
          {pegando && (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={6}
              spellCheck={false}
              autoFocus
              placeholder={'REF\tNombre y color\tTalla\tEAN\tFBASKU\n8412\tCUERO\t40\t8435215107671\tFBA047768-40'}
              className={cx(CAMPO.input, 'h-auto py-2 font-mono text-[11.5px]')}
            />
          )}
        </div>
      )}

      {fase === 'leyendo' && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t3)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Leyendo {nombreArchivo ?? 'lo pegado'} y comparándolo con la base de datos…
        </div>
      )}

      {/* ================= LO QUE HARÍA ================= */}
      {resumen && fase !== 'elegir' && fase !== 'leyendo' && (
        <div className="space-y-2.5">
          {nombreArchivo && (
            <p className="flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]">
              <FileSpreadsheet className="h-3 w-3" />
              {nombreArchivo}
            </p>
          )}

          {resumen.error ? (
            <div className={cx(AVISO.base, AVISO.conTono)} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
              {resumen.error}
            </div>
          ) : (
            <>
              {resumen.sinMigrar && (
                <div className={cx(AVISO.base, AVISO.conTono)} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
                  <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
                  <span>
                    <b className={AVISO.fuerte}>Falta lanzar la migración 226 en Supabase.</b> Sin ella la tabla de la base de datos no existe y no se puede importar. El archivo se lee bien: esto es lo que haría.
                  </span>
                </div>
              )}

              <div className={cx(CIFRAS.tira, 'h-auto flex-wrap')}>
                <Dato rotulo="filas leídas" valor={resumen.leidas} />
                <Dato rotulo="nuevas" valor={resumen.nuevas} destacado={resumen.nuevas > 0} />
                <Dato rotulo="completan una existente" valor={resumen.cambian} />
                <Dato rotulo="ya estaban" valor={resumen.iguales} />
                <Dato rotulo="se saltan" valor={resumen.leidas - resumen.importables} alerta={resumen.leidas - resumen.importables > 0} />
              </div>

              <p className="text-[11.5px] leading-[1.6] text-[var(--ls-t3)]">
                <b className="font-semibold text-[var(--ls-t2)]">Columnas entendidas:</b> {resumen.columnas.map((c) => c.titulo).join(' · ')}.
                {resumen.ignoradas.length > 0 && (
                  <>
                    {' '}
                    <b className="font-semibold text-[var(--ls-t2)]">No se usan:</b> {resumen.ignoradas.join(', ')}.
                  </>
                )}
              </p>

              {aplicables === 0 && (
                <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.verde }}>
                  <CheckCircle2 className={AVISO.icono} style={{ color: COLOR_ESTADO.verde }} />
                  No hay nada que añadir ni completar: todo lo que trae el archivo ya está en la base de datos.
                </div>
              )}

              <Lista titulo="Se saltan o se juntan" cuenta={saltadas} avisos={[...resumen.avisos.filter((a) => a.tipo !== 'dato'), ...resumen.conflictos]} tono="ambar" abierta />
              <Lista titulo="Datos que conviene revisar" cuenta={aRevisar.length} avisos={aRevisar} tono="ambar" ayuda="Se importan igual: son datos que no tienen la forma de lo que dicen ser. Se corrigen después en la base de datos." />
              {resumen.cambios.length > 0 && (
                <Lista
                  titulo="Lo que se completa en filas que ya existían"
                  cuenta={resumen.cambian}
                  avisos={resumen.cambios.map((c) => ({ fila: c.fila, tipo: 'dato' as const, texto: `${c.etiqueta}: ${c.campos.join(', ')}` }))}
                  tono="azul"
                />
              )}
            </>
          )}
        </div>
      )}
    </Dialogo>
  )
}

function Dato({ rotulo, valor, destacado, alerta }: { rotulo: string; valor: number; destacado?: boolean; alerta?: boolean }) {
  return (
    <div className={CIFRAS.celda}>
      <span className={cx(CIFRAS.valor, destacado && CIFRAS.urgente)} style={alerta ? { color: COLOR_ESTADO.ambar } : undefined}>
        {valor.toLocaleString('es-ES')}
      </span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </div>
  )
}

function Lista({
  titulo,
  cuenta,
  avisos,
  tono,
  ayuda,
  abierta,
}: {
  titulo: string
  cuenta: number
  avisos: AvisoImportacion[]
  tono: 'ambar' | 'azul'
  ayuda?: ReactNode
  abierta?: boolean
}) {
  const [ver, setVer] = useState(!!abierta)
  if (cuenta === 0 || avisos.length === 0) return null
  return (
    <section className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" style={{ borderLeft: `2px solid ${COLOR_ESTADO[tono]}` }}>
      <button type="button" onClick={() => setVer((v) => !v)} aria-expanded={ver} className="flex w-full items-center justify-between gap-3 px-[10px] py-[7px] text-left">
        <span className="text-[12.5px] font-medium text-[var(--ls-t1)]">
          {titulo} <span className="ml-1 tabular-nums text-[var(--ls-t3)]">{cuenta}</span>
        </span>
        <ChevronDown className={cx('h-3.5 w-3.5 text-[var(--ls-t4)] transition-transform', ver && 'rotate-180')} />
      </button>
      {ver && (
        <div className="border-t border-[var(--ls-linea)]">
          {ayuda && <p className="px-[10px] pt-[6px] text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{ayuda}</p>}
          <ul className="max-h-[200px] space-y-[1px] overflow-y-auto px-[10px] py-[6px]">
            {avisos.map((a, i) => (
              <li key={`${a.fila}-${i}`} className="flex gap-2 text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">
                <span className="w-[64px] shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-[var(--ls-t4)]">fila {a.fila}</span>
                <span className="min-w-0">{a.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
