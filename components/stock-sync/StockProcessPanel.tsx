'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react'
import {
  STOCK_MATCH_METHOD_HINTS,
  STOCK_MATCH_METHOD_LABELS,
  STOCK_MATCH_VIAS,
  formatInt,
  matchMethodColor,
} from '@/lib/types/stock-sync'
import {
  ProcessResult,
  downloadBase64,
  errorMessage,
  unmatchedAction,
  unmatchedColor,
  unmatchedShort,
} from './shared'

export interface StockProcessPanelProps {
  clientId: string
  clientName: string
  /** Cuántas líneas de mapeo tiene el cliente; con cero no hay nada que cruzar */
  mappingCount: number
  /** Avisa al tablero de que hay un proceso nuevo, para que refresque el historial */
  onProcessed: (result: ProcessResult) => void
  /** En móvil el panel ocupa toda la pantalla y hace falta volver a la lista de clientes */
  showBack: boolean
  onBack: () => void
  className?: string
}

/** Los tres huecos de subida. El tipo obliga a repasar los tres al tocar cualquiera */
type DropSlot = 'stock' | 'ean' | 'plantilla'

/** Extensiones que sabe leer el motor. Comprobarlo aquí ahorra subir 2 MB para nada */
const ACCEPTED = ['.xlsx', '.xls', '.csv']

/** La plantilla de Amazon llega como .xlsm; algunas cuentas la sirven como .xlsx */
const ACCEPTED_TEMPLATE = ['.xlsm', '.xlsx']

function acceptedFor(slot: DropSlot): string[] {
  return slot === 'plantilla' ? ACCEPTED_TEMPLATE : ACCEPTED
}

function hasValidExtension(name: string, accepted: string[]): boolean {
  const lower = name.toLowerCase()
  return accepted.some((ext) => lower.endsWith(ext))
}

/**
 * Los tres ficheros son fáciles de confundir entre sí: los dos del ERP del
 * cliente salen de la misma pantalla y se llaman casi igual
 * (ARTICULOS_STOCK_COSTE PROMEDIO_… y ARTICULOS_EAN_…), y la plantilla de
 * Amazon es un Excel más. No se bloquea —el nombre lo puede cambiar
 * cualquiera— pero se avisa, porque el fallo se manifiesta como «no ha casado
 * nada» y desde ahí no hay quien lo adivine.
 */
function looksSwapped(name: string, slot: DropSlot): boolean {
  const lower = name.toLowerCase()
  const isEan = /ean/.test(lower) && !/stock/.test(lower)
  const isStock = /stock/.test(lower)
  const isTemplate = /price.?and.?quantity|pricequantity|plantilla/.test(lower)

  if (slot === 'stock') return isEan || isTemplate
  if (slot === 'ean') return (isStock && !isEan) || isTemplate
  return isStock || isEan
}

/** El aviso concreto de cada hueco cuando el fichero no parece el suyo */
const SWAPPED_HINTS: Record<DropSlot, string> = {
  stock: 'Ese fichero no parece el del stock. Compruébalo antes de procesar',
  ean: 'Ese fichero no parece el de EAN. Compruébalo antes de procesar',
  plantilla:
    'Ese fichero parece un volcado del ERP, no la plantilla de Amazon. Compruébalo antes de procesar',
}

export function StockProcessPanel({
  clientId,
  clientName,
  mappingCount,
  onProcessed,
  showBack,
  onBack,
  className = '',
}: StockProcessPanelProps) {
  const [stockFile, setStockFile] = useState<File | null>(null)
  const [eanFile, setEanFile] = useState<File | null>(null)
  // La plantilla oficial de Amazon. Opcional: sin ella el módulo hace
  // exactamente lo de siempre y saca el Excel de tres columnas.
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  // Apagado por defecto y con el riesgo escrito al lado: encenderlo convierte
  // «no sé cuánto stock tiene» en «no tiene stock» para todo lo que no case.
  const [includeZero, setIncludeZero] = useState(false)
  // También apagado por defecto, pero por otro motivo: es la petición literal
  // del usuario (solo SKU y cantidad). Lo de FBA no depende de este
  // interruptor —lo provoca la columna de cantidad, que va siempre— y por eso
  // ese aviso se pinta aparte, encima, y no aquí dentro.
  const [withChannel, setWithChannel] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  async function process() {
    if (!stockFile || running) return

    setRunning(true)
    try {
      const form = new FormData()
      form.append('client_id', clientId)
      form.append('stock', stockFile)
      if (eanFile) form.append('ean', eanFile)
      if (templateFile) form.append('plantilla', templateFile)
      form.append('include_zero', includeZero ? 'true' : 'false')
      // Sin plantilla no hay columna que rellenar: se manda apagado aunque el
      // interruptor se quedara encendido de una vez anterior.
      form.append('with_channel', templateFile && withChannel ? 'true' : 'false')
      // El cuerpo es JSON y no el Excel: la pantalla necesita la lista de
      // listings sin resolver, que es el trabajo pendiente de la semana. Los
      // dos ficheros vienen dentro, en base64.
      form.append('format', 'json')

      const res = await fetch('/api/stock-sync/process', { method: 'POST', body: form })
      if (!res.ok) {
        toast.error(await errorMessage(res, 'No se ha podido procesar el stock'))
        return
      }

      const data = (await res.json()) as ProcessResult
      setResult(data)
      onProcessed(data)

      // El resumen y el botón de descarga nacen por debajo del formulario, y
      // en una pantalla de portátil eso los deja fuera de la vista: quien
      // acaba de procesar se queda mirando el mismo botón que ya pulsó. El
      // requestAnimationFrame es para que React haya pintado ya el bloque.
      requestAnimationFrame(() =>
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )

      if (data.stats.unmatched > 0) {
        toast.success(
          `${formatInt(data.stats.matched)} referencias listas y ${formatInt(data.stats.unmatched)} sin resolver`
        )
      } else {
        toast.success(`Las ${formatInt(data.stats.matched)} referencias han casado`)
      }
    } catch (err) {
      console.error('Error procesando el stock:', err)
      toast.error('No se ha podido contactar con el servidor. Comprueba la conexión')
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    setStockFile(null)
    setEanFile(null)
    setTemplateFile(null)
    setResult(null)
  }

  // Los interruptores y la plantilla viajan en la petición, así que tocarlos con
  // un resultado ya en pantalla no cambia el fichero que se generó: hay que
  // volver a procesar. Se dice en vez de rehacerlo solo, que dejaría un run de
  // más en el historial.
  const staleSwitch =
    result !== null &&
    (result.includeZero !== includeZero ||
      result.withChannel !== (templateFile !== null && withChannel) ||
      (result.templateFile !== null) !== (templateFile !== null))

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-[12px] font-medium text-white/60 hover:text-white transition-colors flex-shrink-0"
            >
              <ChevronLeft className="h-4 w-4" /> Clientes
            </button>
          )}
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider truncate">
            Actualizar stock
            <span className="text-white/70 normal-case tracking-normal"> · {clientName}</span>
          </h3>
        </div>
        {(stockFile || eanFile || templateFile || result) && (
          <button
            type="button"
            onClick={reset}
            className="text-[11px] font-medium text-white/40 hover:text-white transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <RotateCcw className="h-3 w-3" /> Empezar de nuevo
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto min-w-0 p-3 flex flex-col gap-3">
        {mappingCount === 0 && (
          <p className="rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/[0.07] px-3 py-2 text-[12px] text-white/75">
            {clientName} todavía no tiene tabla de mapeo. Impórtala desde «Base de
            datos actual» antes de procesar: sin ella no hay forma de saber qué SKU
            de Amazon le toca a cada referencia del ERP.
          </p>
        )}

        {/* Ficheros. El panel vive en una columna estrecha del tablero, así que
            son dos por fila como mucho y la plantilla ocupa la suya entera: su
            pista es la más larga de las tres y en media columna se parte. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
          <DropZone
            slot="stock"
            title="Volcado de stock"
            hint="ARTICULOS_STOCK_COSTE PROMEDIO"
            required
            file={stockFile}
            onFile={setStockFile}
            disabled={running}
          />
          <DropZone
            slot="ean"
            title="Fichero de EAN"
            hint="ARTICULOS_EAN · opcional, desempata las referencias que se pisan"
            required={false}
            file={eanFile}
            onFile={setEanFile}
            disabled={running}
          />
          <div className="sm:col-span-2 min-w-0">
            <DropZone
              slot="plantilla"
              title="Plantilla de Amazon"
              hint="PriceAndQuantity.xlsm · opcional, para subirla tal cual a Seller Central"
              required={false}
              file={templateFile}
              onFile={setTemplateFile}
              disabled={running}
            />
          </div>
        </div>

        {/* De dónde sale la plantilla y por qué tiene que ser la del cliente. El
            segundo párrafo se queda puesto aunque ya se haya subido una: el
            error que hay que evitar es reutilizar la de otro cliente, y ese solo
            se ve cuando el fichero ya está en el hueco. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 flex items-start gap-2.5 min-w-0">
          <FileSpreadsheet className="h-4 w-4 text-white/30 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-white/80">
              {templateFile
                ? `Comprueba que esa plantilla es la de ${clientName}`
                : 'La plantilla de Amazon es opcional'}
            </p>
            {!templateFile && (
              <p className="text-[11px] text-white/40 leading-snug mt-0.5">
                Sin ella sale el Excel de tres columnas de siempre. Si la subes, se te
                devuelve además esa misma plantilla rellenada: el SKU en la columna
                del SKU y las unidades en la de cantidad, lista para subirla a Seller
                Central sin tocar nada.
              </p>
            )}
            <p className="text-[11px] text-white/40 leading-snug mt-1.5">
              Descárgala de Seller Central{' '}
              <span className="text-white/60">del propio {clientName}</span>, en la carga
              masiva de inventario, eligiendo «Precio y cantidad». Lleva grabada dentro la
              cuenta de vendedor: la plantilla de otro cliente se rellena igual de bien y
              el fallo no se ve hasta que Seller Central devuelve un error por cada SKU,
              porque ninguno existe en esa cuenta.
            </p>
            <p className="text-[11px] text-white/30 leading-snug mt-1">
              Que sea de otra semana no es problema: Amazon convierte solo las
              desactualizadas a la versión del día. Bajar la última evita arrastrar
              validaciones viejas, pero no es lo que rompe una carga.
            </p>
          </div>
        </div>

        {/* El riesgo de FBA. Va aquí, fuera del interruptor del canal, porque no
            depende de él: la columna de cantidad se escribe siempre y es esa la
            que saca un producto de FBA. Metido dentro del interruptor, la
            lectura natural era «si lo dejo apagado no pasa nada», que es
            justamente lo contrario de lo que ocurre. */}
        {templateFile && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-300/80 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-amber-100/90">
                Los SKU que hoy gestione Amazon (FBA) dejarán de estarlo
              </p>
              <p className="text-[11px] text-amber-200/70 leading-snug mt-0.5">
                La plantilla lleva una cantidad para cada SKU que case, y Amazon avisa en
                sus instrucciones de que indicar cantidad en un SKU gestionado por él lo
                convierte en gestionado por el vendedor. Ocurre igual con el interruptor
                de abajo encendido o apagado: lo provoca la columna de cantidad, que va
                siempre.
              </p>
              <p className="text-[11px] text-amber-200/70 leading-snug mt-1">
                El mapeo de {clientName} no distingue qué listings están en FBA, así que
                la única forma de proteger uno es que su SKU no salga en el fichero:
                desactívalo en «Base de datos actual» antes de procesar.
              </p>
            </div>
          </div>
        )}

        {/* Interruptor de los sin resolver */}
        <SwitchRow
          checked={includeZero}
          onChange={() => setIncludeZero((v) => !v)}
          disabled={running}
          tone="rojo"
          title="Enviar a 0 los listings que no se resuelvan"
        >
          Apagado, lo que no casa se queda fuera del fichero y Amazon conserva el
          stock que ya tenía. Encendido, todo lo que el volcado no explique se
          publica con 0 unidades: si el volcado llega incompleto un día, tumba
          listings que sí tenían producto. Enciéndelo solo cuando te conste que el
          fichero del cliente viene completo.
        </SwitchRow>

        {/* Interruptor del canal de logística: solo tiene sentido con plantilla */}
        <AnimatePresence initial={false}>
          {templateFile && (
            <motion.div
              key="canal"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden min-w-0"
            >
              <SwitchRow
                checked={withChannel}
                onChange={() => setWithChannel((v) => !v)}
                disabled={running}
                tone="ambar"
                title="Rellenar también el canal de logística de la plantilla"
              >
                Apagado, la plantilla sale solo con el SKU y las unidades, que es lo
                pedido. Encendido, cada fila lleva además «Logística por parte del
                vendedor», declarando que ese SKU lo envía {clientName}.
                <span className="block mt-1 text-amber-200/70">
                  Las instrucciones de Amazon dicen que hay que indicar el canal de
                  logística para poder cambiar la cantidad, así que apagado corres el
                  riesgo de que el stock no llegue a aplicarse. Encendido no añade
                  ningún riesgo sobre el que ya trae la columna de cantidad (el aviso
                  de arriba): solo lo deja escrito.
                </span>
              </SwitchRow>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={process}
          disabled={!stockFile || running || mappingCount === 0}
          className="h-10 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Cruzando el volcado...' : 'Procesar y generar el fichero'}
        </button>

        {/* Resultado */}
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              ref={resultRef}
              key={result.runId ?? result.file.name}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col gap-3 min-w-0"
            >
              <Summary result={result} />

              {staleSwitch && (
                <p className="rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/[0.07] px-3 py-2 text-[11px] text-white/75 flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#FF6600] flex-shrink-0 mt-0.5" />
                  Has cambiado los ficheros o los interruptores después de procesar.
                  Lo de abajo es el resultado de antes; vuelve a procesar para que lo
                  tenga en cuenta.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {/* La plantilla manda cuando existe: es la que se sube tal cual */}
                {result.templateFile && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadBase64(
                        result.templateFile!.base64,
                        result.templateFile!.name,
                        result.templateFile!.mime
                      )
                    }
                    title={
                      `SKU en la columna ${result.templateFile.colSku} y cantidad en la ` +
                      `${result.templateFile.colCantidad}` +
                      (result.templateFile.colCanal
                        ? `, «${result.templateFile.canalEtiqueta}» en la ${result.templateFile.colCanal}`
                        : ', sin canal de logística') +
                      (result.templateFile.version
                        ? `. Plantilla versión ${result.templateFile.version}`
                        : '') +
                      (result.templateFile.contributorId
                        ? `, cuenta ${result.templateFile.contributorId}`
                        : '')
                    }
                    className="h-9 px-4 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" /> Plantilla de Amazon
                    <span className="font-normal text-white/70">
                      ({formatInt(result.templateFile.rows)} filas · .xlsm)
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => downloadBase64(result.file.base64, result.file.name)}
                  className={
                    result.templateFile
                      ? 'h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[12px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors'
                      : 'h-9 px-4 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center gap-2'
                  }
                >
                  <Download className="h-4 w-4" />{' '}
                  {result.templateFile ? 'Excel de tres columnas' : 'Excel para Amazon'}
                  <span
                    className={`font-normal ${result.templateFile ? 'text-white/40' : 'text-white/70'}`}
                  >
                    ({formatInt(result.stats.matched + result.zeroedRows)} filas)
                  </span>
                </button>

                {result.unmatchedFile && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadBase64(result.unmatchedFile!.base64, result.unmatchedFile!.name)
                    }
                    className="h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[12px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors"
                  >
                    <Download className="h-4 w-4" /> Sin resolver
                    <span className="font-normal text-white/40">
                      ({formatInt(result.stats.unmatched)})
                    </span>
                  </button>
                )}
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 flex flex-col gap-1">
                  {result.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] text-amber-200/80 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              <UnmatchedTable rows={result.unmatched} includeZero={result.includeZero} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// =====================================================
// Interruptor con su explicación al lado
// =====================================================

/**
 * Los dos interruptores del panel tienen la misma pinta y el mismo peso: los
 * dos están apagados por defecto y los dos hacen algo que hay que entender
 * antes de encenderlo. Compartir el componente evita que uno se quede con el
 * texto pequeño y el otro no, que es como se dejan de leer los avisos.
 */
function SwitchRow({
  checked,
  onChange,
  disabled,
  tone,
  title,
  children,
}: {
  checked: boolean
  onChange: () => void
  disabled: boolean
  /** Rojo, lo que puede vaciar stock; ámbar, lo que cambia cómo se envía el producto */
  tone: 'rojo' | 'ambar'
  title: string
  children: ReactNode
}) {
  const encendido = tone === 'rojo' ? 'bg-red-500/70' : 'bg-amber-400/70'
  const borde =
    checked && tone === 'ambar' ? 'border-amber-400/25 bg-amber-400/[0.05]' : 'border-white/10 bg-white/[0.02]'

  return (
    <div
      className={`rounded-xl border px-3 py-2 flex items-start gap-3 min-w-0 transition-colors ${borde}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
        disabled={disabled}
        className={`mt-0.5 h-5 w-9 rounded-full flex-shrink-0 transition-colors relative ${
          checked ? encendido : 'bg-white/[0.12]'
        } disabled:opacity-40`}
      >
        <motion.span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white"
          animate={{ left: checked ? 18 : 2 }}
          transition={{ duration: 0.15 }}
        />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-white/80">{title}</p>
        <p className="text-[11px] text-white/40 leading-snug mt-0.5">{children}</p>
      </div>
    </div>
  )
}

// =====================================================
// Zona de arrastrar y soltar
// =====================================================

interface DropZoneProps {
  slot: DropSlot
  title: string
  hint: string
  required: boolean
  file: File | null
  onFile: (file: File | null) => void
  disabled: boolean
}

function DropZone({ slot, title, hint, required, file, onFile, disabled }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const accepted = acceptedFor(slot)

  function accept(picked: File | null | undefined) {
    if (!picked) return
    if (!hasValidExtension(picked.name, accepted)) {
      toast.error(
        slot === 'plantilla'
          ? `«${picked.name}» no es una plantilla de Amazon. Se admiten ${accepted.join(', ')}`
          : `«${picked.name}» no es un Excel ni un CSV. Se admiten ${accepted.join(', ')}`
      )
      return
    }
    if (looksSwapped(picked.name, slot)) {
      toast.warning(SWAPPED_HINTS[slot])
    }
    onFile(picked)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (disabled) return
        accept(e.dataTransfer.files?.[0])
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`rounded-xl border border-dashed px-3 py-3 min-w-0 cursor-pointer transition-colors ${
        over
          ? 'border-[#FF6600] bg-[#FF6600]/[0.08]'
          : file
            ? 'border-green-400/30 bg-green-400/[0.05]'
            : 'border-white/15 bg-white/[0.02] hover:border-white/25'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accepted.join(',')}
        className="hidden"
        onChange={(e) => {
          accept(e.target.files?.[0])
          // Se limpia para que volver a elegir el mismo fichero dispare el
          // change: sin esto, corregir el fichero y resubirlo no hace nada.
          e.target.value = ''
        }}
      />

      <div className="flex items-start gap-2 min-w-0">
        {file ? (
          <FileSpreadsheet className="h-4 w-4 text-green-300 flex-shrink-0 mt-0.5" />
        ) : (
          <Upload className="h-4 w-4 text-white/30 flex-shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-white/80 flex items-center gap-1.5">
            {title}
            {required && <span className="text-[#FF6600]">*</span>}
          </p>
          {file ? (
            <p className="text-[11px] text-green-300/80 truncate" title={file.name}>
              {file.name}
              <span className="text-white/30"> · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
            </p>
          ) : (
            <p className="text-[11px] text-white/35 truncate" title={hint}>
              {hint}
            </p>
          )}
        </div>
        {file && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onFile(null)
            }}
            className="text-white/30 hover:text-white transition-colors flex-shrink-0"
            title="Quitar el fichero"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// =====================================================
// Resumen del proceso
// =====================================================

function Summary({ result }: { result: ProcessResult }) {
  const { stats } = result

  const cards = [
    {
      key: 'matched',
      label: 'Casan',
      value: formatInt(stats.matched),
      tone: 'text-green-300',
      hint: `${formatInt(stats.matched)} de las ${formatInt(stats.mappings)} líneas de mapeo han encontrado su artículo`,
    },
    {
      key: 'unmatched',
      label: 'Sin resolver',
      value: formatInt(stats.unmatched),
      tone: stats.unmatched > 0 ? 'text-red-300' : 'text-white/40',
      hint: 'Listings publicados en Amazon cuyo stock no se ha podido averiguar',
    },
    {
      key: 'units',
      label: 'Unidades',
      value: formatInt(stats.totalUnits),
      tone: 'text-white',
      hint: 'Suma de todo lo que se va a publicar. Un total muy bajo delata un volcado a medias',
    },
    {
      key: 'lines',
      label: 'Líneas leídas',
      value: formatInt(stats.stockLines),
      tone: 'text-white/70',
      hint: `${formatInt(stats.stockArticles)} artículos distintos en el volcado del cliente`,
    },
  ]

  // Las vías salen de STOCK_MATCH_VIAS y no de una lista escrita aquí: son
  // las mismas que prueba el motor y en el mismo orden, así que el día que se
  // añada o se quite una, esta tira no se queda con un contador muerto.
  const vias = STOCK_MATCH_VIAS.map((key) => ({
    key,
    label: STOCK_MATCH_METHOD_LABELS[key],
    value: stats.byVia[key] ?? 0,
    hint: STOCK_MATCH_METHOD_HINTS[key],
  }))

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {cards.map((c) => (
          <div
            key={c.key}
            title={c.hint}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 min-w-0"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 truncate">{c.label}</p>
            <p className={`font-bold text-[19px] mt-0.5 tabular-nums truncate ${c.tone}`}>
              {c.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {vias.map((v) => (
          <span
            key={v.key}
            title={v.hint}
            className="text-[11px] tabular-nums px-2 py-1 rounded-full border border-white/10 bg-white/[0.02] flex items-center gap-1.5"
            style={{ color: v.value > 0 ? matchMethodColor(v.key) : undefined }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: matchMethodColor(v.key) }}
            />
            {v.label}
            <span className="font-semibold">{formatInt(v.value)}</span>
          </span>
        ))}

        {stats.zeroStock > 0 && (
          <span
            title="Han casado, pero el ERP del cliente dice que tienen 0 unidades. Es un cero real, no un fallo del cruce"
            className="text-[11px] tabular-nums px-2 py-1 rounded-full border border-white/10 bg-white/[0.02] text-white/45"
          >
            {formatInt(stats.zeroStock)} con 0 unidades reales
          </span>
        )}

        {result.zeroedRows > 0 && (
          <span
            title="Listings sin resolver que van en el fichero con 0 unidades porque el interruptor está encendido"
            className="text-[11px] tabular-nums px-2 py-1 rounded-full border border-red-400/30 bg-red-500/[0.08] text-red-300 font-medium"
          >
            {formatInt(result.zeroedRows)} enviados a 0 sin resolver
          </span>
        )}

        {stats.duplicatedSkus > 0 && (
          <span
            title="El mapeo traía el mismo SKU en varias filas; se ha usado la última de cada uno"
            className="text-[11px] tabular-nums px-2 py-1 rounded-full border border-amber-400/25 bg-amber-400/[0.06] text-amber-200/80"
          >
            {formatInt(stats.duplicatedSkus)} SKU repetidos en el mapeo
          </span>
        )}
      </div>
    </div>
  )
}

// =====================================================
// Trabajo pendiente
// =====================================================

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

/**
 * El trabajo pendiente, agrupado por motivo y de mayor a menor.
 *
 * Agrupar no es cosmético: lo que hay que hacer depende del motivo y no del
 * SKU, así que ochenta y seis filas son en realidad tres o cuatro tareas
 * distintas. Ordenadas por volumen, la primera es siempre la que más listings
 * devuelve al fichero de la semana que viene.
 */
function UnmatchedTable({
  rows,
  includeZero,
}: {
  rows: ProcessResult['unmatched']
  includeZero: boolean
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ProcessResult['unmatched']>()
    for (const row of rows) {
      const list = map.get(row.reason)
      if (list) list.push(row)
      else map.set(row.reason, [row])
    }
    return [...map.entries()]
      .map(([reason, list]) => ({ reason, rows: list }))
      .sort((a, b) => b.rows.length - a.rows.length)
  }, [rows])

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-green-400/25 bg-green-400/[0.05] px-3 py-2 text-[12px] text-green-200/80">
        Todos los listings del mapeo han encontrado su stock. No hay nada pendiente.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-red-400/25 bg-red-500/[0.04] flex flex-col min-w-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-red-400/15 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[19px] font-bold text-red-300 tabular-nums">{rows.length}</span>
        <span className="text-[12px] font-medium text-white/80">
          {rows.length === 1 ? 'listing sin resolver' : 'listings sin resolver'}
        </span>
        <span className="text-[11px] text-white/45 min-w-0">
          {includeZero
            ? '· Van en el fichero con 0 unidades porque el interruptor está encendido. Revísalos antes de subirlo.'
            : '· No van en el fichero: Amazon les conserva el stock que ya tenía. Ninguno se ha puesto a 0.'}
        </span>
      </div>

      <p className="px-3 py-2 text-[11px] text-white/45 leading-snug">
        Esto es el trabajo pendiente: cada fila es un producto publicado del que
        hoy no sabemos las unidades. Arreglar su línea en «Base de datos actual»
        hace que el lunes que viene ya case sola.
      </p>

      {groups.map((group) => (
        <div key={group.reason} className="border-t border-red-400/10 min-w-0">
          <div className="px-3 pt-2 pb-1.5 min-w-0">
            <p className="flex items-baseline gap-2 min-w-0">
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0"
                style={{
                  color: unmatchedColor(group.reason),
                  backgroundColor: `${unmatchedColor(group.reason)}1f`,
                }}
              >
                {formatInt(group.rows.length)} · {unmatchedShort(group.reason)}
              </span>
              <span className="text-[11px] text-white/40 min-w-0">{group.rows[0].reasonLabel}</span>
            </p>
            {/* El consejo va una vez por motivo y no una vez por fila: es el
                mismo para las sesenta y nueve, y repetirlo en cada celda lo
                dejaba en una columna de ciento cuarenta píxeles que hacía
                filas de veinte líneas. */}
            <p className="text-[11px] text-white/55 leading-snug mt-1">
              {unmatchedAction(group.reason)}
            </p>
          </div>

          {/* Solo scroll horizontal: el vertical lo lleva el panel entero. Dos
              barras de scroll anidadas para una lista de ochenta filas obligan
              a buscar dónde está el ratón antes de cada gesto. */}
          <div className="overflow-x-auto min-w-0">
            <table className="w-full min-w-[380px] text-[12px] border-collapse table-fixed">
              <thead>
                <tr>
                  <th className={`${th} text-left px-3 w-[132px]`}>SKU</th>
                  <th className={`${th} text-left px-1 w-[100px]`}>ASIN</th>
                  <th className={`${th} text-left px-1 w-[88px]`}>REF_ERP</th>
                  <th className={`${th} text-left px-3`}>Qué se intentó</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, i) => (
                  <tr
                    key={`${row.sku}-${i}`}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-3 py-1 text-white/85 font-medium truncate" title={row.sku}>
                      {row.sku || <span className="text-white/25">sin SKU</span>}
                    </td>
                    <td className="px-1 py-1 text-white/50 tabular-nums truncate">
                      {row.asin ?? '—'}
                    </td>
                    <td className="px-1 py-1 text-white/50 tabular-nums truncate">
                      {row.refErp ?? '—'}
                    </td>
                    {/* En una línea y con el texto entero en el tooltip: son
                        decenas de filas y lo que se busca aquí es reconocer el
                        SKU de un vistazo. El detalle completo va en el Excel de
                        sin resolver, que es donde se trabaja con calma. */}
                    <td className="px-3 py-1 text-white/35 truncate" title={row.detail}>
                      {row.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
