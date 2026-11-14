'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleCheck, Clock, CloudOff, Loader2, MessageSquare, Minus, PackagePlus, Plus, Search, Sparkles, TriangleAlert, X } from 'lucide-react'
import type { DatosDelPortal, ProductoParaAnadir } from '@/lib/fba/portal'
import { MAX_COMENTARIO, diferenciaDe, resumirDiferencias, type LineaDePropuesta } from '@/lib/fba/propuesta-cliente'
import { FUENTE_TITULO, cx, n0 } from '@/components/encaje/marca'
import { BuscadorCatalogo } from './BuscadorCatalogo'
import { useGuardadoPropuesta, type LineaEnviada } from './useGuardadoPropuesta'

/**
 * LA FASE «PROPUESTA» DEL PORTAL: LO QUE TE PROPONEMOS Y TU CANTIDAD.
 *
 * Dos columnas que mandan: «Propuesto» (la foto de lo que propuso la agencia, que no cambia) y «Tu
 * cantidad» (lo que él quiere). Puede subir, bajar, poner 0 («esta no»), comentar cada línea y añadir
 * productos de su catálogo, que salen como «Nuevo». Todo se guarda solo. Al final, «Acepto»: escribe su
 * nombre y la propuesta queda PENDIENTE DE REVISIÓN (no aprobada) hasta que la agencia la mira.
 *
 * Rendimiento: un envío de ShoesF tiene unas 300 líneas. No se anima fila a fila (solo las primeras al
 * entrar) y con más de 12 líneas aparece un filtro para encontrar la que se busca.
 */

type Linea = LineaDePropuesta

const aEnviar = (ls: Linea[]): LineaEnviada[] => ls.map((l) => ({ sku: l.sku, unidades: l.unidades, comentario: l.comentario }))

export function FasePropuesta({ token, datos, onAceptada }: { token: string; datos: DatosDelPortal; onAceptada: () => void }) {
  const [lineas, setLineas] = useState<Linea[]>(datos.lineas)
  const [buscando, setBuscando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [comentando, setComentando] = useState<string | null>(null)
  const [aceptando, setAceptando] = useState(false)
  const editable = datos.editable

  const enviadas = useMemo(() => aEnviar(lineas), [lineas])
  const guardado = useGuardadoPropuesta(token, enviadas, editable, datos.version, (delServidor) => {
    // Del servidor solo se toma lo que no se edita aquí (nombre, ASIN, marca «Nuevo», lo propuesto): las
    // cantidades que el cliente siguió tecleando mientras se guardaba no se pisan
    const meta = new Map(delServidor.map((l) => [l.sku, l]))
    setLineas((prev) => prev.map((l) => {
      const m = meta.get(l.sku)
      return m ? { ...l, nombre: m.nombre, variante: m.variante, referencia: m.referencia, asin: m.asin, propuestas: m.propuestas, nueva: m.nueva } : l
    }))
  })

  const resumen = useMemo(() => resumirDiferencias(lineas), [lineas])
  const yaEstan = useMemo(() => new Set(lineas.map((l) => l.sku)), [lineas])
  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (!f) return lineas
    return lineas.filter((l) => [l.sku, l.nombre, l.variante, l.referencia, l.asin].some((x) => x?.toLowerCase().includes(f)))
  }, [lineas, filtro])

  function poner(sku: string, unidades: number) {
    const n = Math.max(0, Math.min(99_999, Math.round(Number.isFinite(unidades) ? unidades : 0)))
    setLineas((prev) => prev.map((l) => (l.sku === sku ? { ...l, unidades: n } : l)))
  }
  function comentar(sku: string, texto: string) {
    setLineas((prev) => prev.map((l) => (l.sku === sku ? { ...l, comentario: texto.slice(0, MAX_COMENTARIO) || null } : l)))
  }
  function quitarNueva(sku: string) {
    setLineas((prev) => prev.filter((l) => l.sku !== sku))
  }
  function anadir(p: ProductoParaAnadir) {
    if (yaEstan.has(p.sku)) return
    setLineas((prev) => [{ sku: p.sku, nombre: p.titulo, variante: null, referencia: null, asin: p.asin, unidades: 1, propuestas: null, nueva: true, comentario: null }, ...prev])
  }

  /* ---------- Antes de mandársela, o ya cerrada ---------- */
  if (datos.punto === 'montando') {
    return (
      <Aviso icono={<Clock className="h-7 w-7" />} titulo="Estamos preparando tu propuesta">
        En cuanto esté lista la verás aquí, con lo que te proponemos mandar a Amazon. Puedes volver a este mismo enlace.
      </Aviso>
    )
  }

  const soloLectura = !editable
  const pendiente = datos.punto === 'pendiente_revision'
  const cerrada = datos.punto === 'cerrada'

  return (
    <div className="space-y-5">
      {/* ---------- En qué punto está ---------- */}
      {pendiente && (
        <Franja tono="ok" icono={<CircleCheck className="h-5 w-5" />}>
          <strong>Has aceptado la propuesta{datos.aceptada?.nombre ? ` como «${datos.aceptada.nombre}»` : ''}.</strong> La estamos revisando: cuando la aprobemos podrás descargar las etiquetas desde este mismo enlace.
        </Franja>
      )}
      {cerrada && (
        <Franja tono="ok" icono={<Check className="h-5 w-5" />}>
          <strong>Propuesta aprobada.</strong> Esto es lo que se manda. Pasa a «Etiquetas» para descargarlas.
        </Franja>
      )}
      {editable && (
        <Franja tono="info" icono={<Sparkles className="h-5 w-5" />}>
          Revisa lo que te proponemos. Cambia las cantidades que quieras (0 = no mandarlo), comenta lo que haga falta y añade productos de tu catálogo. <strong>Se guarda solo.</strong> Cuando esté, pulsa «Acepto».
        </Franja>
      )}
      {guardado.conflicto && (
        <Franja tono="error" icono={<TriangleAlert className="h-5 w-5" />} accion={<BotonPequeno onClick={() => window.location.reload()}>Recargar</BotonPequeno>}>
          {guardado.motivo ?? 'La propuesta ha cambiado mientras la mirabas.'}
        </Franja>
      )}

      {/* ---------- Cifras ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra rotulo="Propuesto" valor={resumen.unidadesPropuestas} pie="unidades" />
        <Cifra rotulo={soloLectura ? 'Final' : 'Tu pedido'} valor={resumen.unidadesCliente} pie="unidades" acento />
        <Cifra rotulo="Cambios" valor={resumen.cambios} pie={resumen.cambios === 1 ? 'línea' : 'líneas'} />
        <Cifra rotulo="Nuevos" valor={resumen.nuevas} pie={resumen.nuevas === 1 ? 'producto' : 'productos'} />
      </div>

      {/* ---------- Herramientas ---------- */}
      <div className="flex flex-wrap items-center gap-3">
        {lineas.length > 12 && (
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-4 focus-within:border-[#F26212] sm:max-w-[360px]">
            <Search className="h-4 w-4 shrink-0 text-[#8C857C]" />
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar la lista" aria-label="Filtrar la lista" className="h-full w-full min-w-0 bg-transparent text-[14px] focus:outline-none" />
          </label>
        )}
        {editable && datos.conCatalogo && !buscando && (
          <button type="button" onClick={() => setBuscando(true)} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#F26212]/40 bg-[#FFFFFF] px-4 text-[14px] font-semibold text-[#F26212] transition hover:bg-[#FBEFE8]">
            <PackagePlus className="h-4 w-4" />
            Añadir productos
          </button>
        )}
        {editable && <EstadoGuardado estado={guardado.estado} motivo={guardado.conflicto ? null : guardado.motivo} />}
      </div>

      <AnimatePresence>
        {buscando && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            <BuscadorCatalogo token={token} yaEstan={yaEstan} onAnadir={anadir} onCerrar={() => setBuscando(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- La lista ---------- */}
      <section className="overflow-hidden rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF]">
        {/* Cabecera de columnas: solo en el PC; en el móvil cada línea es una tarjeta */}
        <div className="hidden grid-cols-[minmax(0,1fr)_96px_184px_92px] items-center gap-4 border-b border-[#EFEBE5] bg-[#FBFAF8] px-5 py-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8C857C] md:grid">
          <span>Producto</span>
          <span className="text-right">Propuesto</span>
          <span className="text-center">{soloLectura ? 'Cantidad' : 'Tu cantidad'}</span>
          <span className="text-right">Diferencia</span>
        </div>
        {visibles.length === 0 ? (
          <p className="px-5 py-10 text-center text-[14px] text-[#5E5852]">{filtro ? 'Nada coincide con el filtro.' : 'Esta propuesta no tiene productos.'}</p>
        ) : (
          <ul className="divide-y divide-[#EFEBE5]">
            {visibles.map((l, i) => (
              <FilaDePropuesta
                key={l.sku}
                linea={l}
                indice={i}
                editable={editable}
                comentando={comentando === l.sku}
                onComentar={() => setComentando((c) => (c === l.sku ? null : l.sku))}
                onTexto={(t) => comentar(l.sku, t)}
                onUnidades={(n) => poner(l.sku, n)}
                onQuitar={() => quitarNueva(l.sku)}
              />
            ))}
          </ul>
        )}
      </section>

      {datos.comentarioCliente && (
        <p className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-5 py-4 text-[14px] leading-relaxed text-[#5E5852]">
          <span className="font-semibold text-[#141414]">Tu comentario: </span>
          {datos.comentarioCliente}
        </p>
      )}

      {/* ---------- Acepto ---------- */}
      {editable && (
        <div className="sticky bottom-3 z-20">
          <div className="flex flex-col items-stretch gap-3 rounded-3xl border border-[#E5E1DB] bg-[#141414] px-5 py-4 text-[#FFFFFF] shadow-[0_24px_50px_-20px_rgba(20,20,20,0.6)] sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] leading-snug text-[#EDE6DC]">
              <span className="font-semibold text-[#FFFFFF]">{n0(resumen.unidadesCliente)} unidades</span> en {n0(lineas.filter((l) => l.unidades > 0).length)} productos
              {resumen.cambios > 0 ? ` · ${resumen.cambios} cambio${resumen.cambios === 1 ? '' : 's'} sobre lo propuesto` : ' · sin cambios'}
            </p>
            <button
              type="button"
              disabled={guardado.conflicto || resumen.unidadesCliente === 0}
              onClick={() => setAceptando(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#F26212] px-6 text-[15px] font-semibold text-[#FFFFFF] shadow-[0_10px_24px_-10px_rgba(242,98,18,0.9)] transition hover:bg-[#E0560C] disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Acepto la propuesta
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {aceptando && (
          <DialogoAceptar
            token={token}
            resumen={{ unidades: resumen.unidadesCliente, cambios: resumen.cambios, nuevas: resumen.nuevas }}
            antes={() => guardado.sincronizar()}
            version={guardado.version}
            onCerrar={() => setAceptando(false)}
            onHecho={() => {
              setAceptando(false)
              onAceptada()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Una línea                                                           */
/* ------------------------------------------------------------------ */

function FilaDePropuesta({
  linea: l,
  indice,
  editable,
  comentando,
  onComentar,
  onTexto,
  onUnidades,
  onQuitar,
}: {
  linea: Linea
  indice: number
  editable: boolean
  comentando: boolean
  onComentar: () => void
  onTexto: (t: string) => void
  onUnidades: (n: number) => void
  onQuitar: () => void
}) {
  const d = diferenciaDe(l)
  const titulo = l.nombre ?? l.sku
  // Solo las primeras entran con movimiento: animar 300 filas fila a fila es tirar la batería del móvil
  const animar = indice < 12
  return (
    <motion.li
      initial={animar ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: animar ? indice * 0.025 : 0 }}
      className={cx('px-4 py-4 sm:px-5', d.tipo === 'quitada' && 'bg-[#FBFAF8]')}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_96px_184px_92px] md:items-center md:gap-4">
        {/* Producto */}
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            {l.nueva && <span className="mt-[2px] shrink-0 rounded-full bg-[#F26212] px-2 py-[2px] text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#FFFFFF]">Nuevo</span>}
            <p className={cx('line-clamp-2 text-[14.5px] leading-snug', d.tipo === 'quitada' ? 'text-[#8C857C] line-through' : 'text-[#141414]')} title={titulo}>
              {l.referencia && <span className="mr-1.5 text-[#8C857C]">{l.referencia}</span>}
              {titulo}
            </p>
          </div>
          <p className="mt-1 truncate font-mono text-[11.5px] text-[#8C857C]">
            {l.sku}
            {l.variante ? ` · ${l.variante}` : ''}
          </p>
          {l.comentario && !comentando && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-[#5E5852]">
              <MessageSquare className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#F26212]" />
              {l.comentario}
            </p>
          )}
        </div>

        {/* En el móvil, propuesto y diferencia van en una fila; en el PC, cada uno en su columna */}
        <div className="flex items-center justify-between md:contents">
          <span className="text-[13px] text-[#8C857C] md:text-right md:text-[15px] md:tabular-nums md:text-[#5E5852]">
            <span className="md:hidden">Propuesto: </span>
            {l.propuestas === null ? '—' : n0(l.propuestas)}
          </span>
          <span className="md:order-last md:text-right">
            <Diferencia tipo={d.tipo} delta={d.delta} />
          </span>
        </div>

        {/* Tu cantidad */}
        <div className="flex items-center justify-between gap-2 md:justify-center">
          {editable ? (
            <div className="flex items-center gap-1.5">
              <BotonCantidad etiqueta={`Una menos de ${l.sku}`} onClick={() => onUnidades(l.unidades - 1)} disabled={l.unidades <= 0}>
                <Minus className="h-4 w-4" />
              </BotonCantidad>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={l.unidades}
                onChange={(e) => onUnidades(e.target.value === '' ? 0 : Number(e.target.value))}
                onFocus={(e) => e.target.select()}
                aria-label={`Tu cantidad de ${l.sku}`}
                className={cx(
                  'h-11 w-[72px] rounded-xl border bg-[#FFFFFF] text-center text-[16px] font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#F26212]/30',
                  d.tipo === 'igual' ? 'border-[#E5E1DB] text-[#141414]' : 'border-[#F26212]/50 text-[#141414]'
                )}
              />
              <BotonCantidad etiqueta={`Una más de ${l.sku}`} onClick={() => onUnidades(l.unidades + 1)}>
                <Plus className="h-4 w-4" />
              </BotonCantidad>
            </div>
          ) : (
            <span className="text-[16px] font-semibold tabular-nums text-[#141414] md:mx-auto">{n0(l.unidades)}</span>
          )}
          {editable && (
            <div className="flex items-center gap-1 md:hidden">
              <BotonIcono etiqueta="Comentar" activo={comentando || !!l.comentario} onClick={onComentar}>
                <MessageSquare className="h-4 w-4" />
              </BotonIcono>
              {l.nueva && (
                <BotonIcono etiqueta="Quitar este producto" onClick={onQuitar}>
                  <X className="h-4 w-4" />
                </BotonIcono>
              )}
            </div>
          )}
        </div>
      </div>

      {editable && (
        <div className="mt-2 hidden items-center gap-1 md:flex">
          <button type="button" onClick={onComentar} className={cx('inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-2 text-[12.5px] transition', comentando || l.comentario ? 'text-[#F26212]' : 'text-[#8C857C] hover:text-[#141414]')}>
            <MessageSquare className="h-3.5 w-3.5" />
            {l.comentario ? 'Editar comentario' : 'Comentar'}
          </button>
          {l.nueva && (
            <button type="button" onClick={onQuitar} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-[#8C857C] transition hover:text-[#C23B3B]">
              <X className="h-3.5 w-3.5" />
              Quitar
            </button>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {comentando && editable && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <textarea
              autoFocus
              defaultValue={l.comentario ?? ''}
              onChange={(e) => onTexto(e.target.value)}
              maxLength={MAX_COMENTARIO}
              rows={2}
              placeholder="Algo que debamos saber de este producto (opcional)"
              className="mt-3 w-full rounded-2xl border border-[#E5E1DB] bg-[#F7F5F2] px-4 py-3 text-[14px] leading-snug focus:border-[#F26212] focus:outline-none"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

function Diferencia({ tipo, delta }: { tipo: ReturnType<typeof diferenciaDe>['tipo']; delta: number }) {
  if (tipo === 'igual') return <span className="text-[13px] text-[#B8AE9F]">=</span>
  const estilo: Record<string, string> = {
    mas: 'bg-[#E4F3EA] text-[#2F9657]',
    menos: 'bg-[#FBF0D2] text-[#9A7410]',
    quitada: 'bg-[#FBE3E0] text-[#C23B3B]',
    nueva: 'bg-[#FBEFE8] text-[#F26212]',
  }
  const texto = tipo === 'quitada' ? 'Fuera' : tipo === 'nueva' ? 'Nuevo' : `${delta > 0 ? '+' : ''}${n0(delta)}`
  return <span className={cx('inline-flex rounded-full px-2.5 py-1 text-[12.5px] font-semibold tabular-nums', estilo[tipo])}>{texto}</span>
}

/* ------------------------------------------------------------------ */
/* El diálogo de «Acepto»                                              */
/* ------------------------------------------------------------------ */

function DialogoAceptar({
  token,
  resumen,
  antes,
  version,
  onCerrar,
  onHecho,
}: {
  token: string
  resumen: { unidades: number; cambios: number; nuevas: number }
  antes: () => Promise<boolean>
  version: () => number | null
  onCerrar: () => void
  onHecho: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function aceptar() {
    setEnviando(true)
    setError(null)
    try {
      // Lo último que tocó, guardado antes: se acepta lo que se ve
      const bien = await antes()
      if (!bien) {
        setError('No se han podido guardar tus últimos cambios. Revisa la conexión y vuelve a probar.')
        return
      }
      const res = await fetch(`/api/publico/envio/${token}/aceptar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, comentario, version: version() }),
      })
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(cuerpo?.error ?? `No se ha podido aceptar (código ${res.status}).`)
        return
      }
      onHecho()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-[#141414]/50 p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCerrar}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-aceptar"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-t-3xl bg-[#FFFFFF] px-6 pb-6 pt-5 shadow-[0_30px_80px_-30px_rgba(20,20,20,0.7)] sm:rounded-3xl"
      >
        <h2 id="titulo-aceptar" className="text-[22px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          Aceptar la propuesta
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#5E5852]">
          {n0(resumen.unidades)} unidades{resumen.cambios > 0 ? `, con ${resumen.cambios} cambio${resumen.cambios === 1 ? '' : 's'}` : ''}
          {resumen.nuevas > 0 ? ` y ${resumen.nuevas} producto${resumen.nuevas === 1 ? '' : 's'} nuevo${resumen.nuevas === 1 ? '' : 's'}` : ''}. Liberty Seller lo revisará y te avisará cuando esté aprobado.
        </p>
        <label className="mt-5 block text-[13px] font-semibold text-[#141414]">
          Tu nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus maxLength={80} placeholder="Nombre y apellido" className="mt-1.5 h-12 w-full rounded-2xl border border-[#E5E1DB] bg-[#F7F5F2] px-4 text-[15px] font-normal focus:border-[#F26212] focus:outline-none" />
        </label>
        <label className="mt-4 block text-[13px] font-semibold text-[#141414]">
          Comentario <span className="font-normal text-[#8C857C]">(opcional)</span>
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} maxLength={900} placeholder="Algo que debamos saber del envío" className="mt-1.5 w-full rounded-2xl border border-[#E5E1DB] bg-[#F7F5F2] px-4 py-3 text-[14px] font-normal focus:border-[#F26212] focus:outline-none" />
        </label>
        {error && <p className="mt-4 rounded-2xl bg-[#FBE3E0] px-4 py-3 text-[13.5px] text-[#7A2020]">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCerrar} className="h-12 rounded-2xl px-5 text-[14.5px] font-medium text-[#5E5852] hover:bg-[#F7F5F2]">
            Seguir revisando
          </button>
          <button type="button" onClick={() => void aceptar()} disabled={enviando || nombre.trim().length < 2} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#F26212] px-6 text-[15px] font-semibold text-[#FFFFFF] transition hover:bg-[#E0560C] disabled:opacity-50">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Acepto
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function EstadoGuardado({ estado, motivo }: { estado: string; motivo: string | null }) {
  if (estado === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-[#C23B3B]">
        <CloudOff className="h-4 w-4" />
        {motivo ?? 'Sin guardar'}
      </span>
    )
  }
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-[#8C857C]" aria-live="polite">
      {estado === 'guardando' || estado === 'pendiente' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-[#2F9657]" />}
      {estado === 'guardando' || estado === 'pendiente' ? 'Guardando…' : 'Guardado'}
    </span>
  )
}

function Cifra({ rotulo, valor, pie, acento }: { rotulo: string; valor: number; pie: string; acento?: boolean }) {
  return (
    <div className={cx('rounded-2xl border px-4 py-3.5', acento ? 'border-[#F26212]/30 bg-gradient-to-br from-[#FFFFFF] to-[#FBEFE8]' : 'border-[#E5E1DB] bg-[#FFFFFF]')}>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8C857C]">{rotulo}</p>
      <p className={cx('mt-1 text-[26px] leading-none tabular-nums', acento ? 'text-[#F26212]' : 'text-[#141414]')} style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
        {n0(valor)}
      </p>
      <p className="mt-1 text-[12px] text-[#8C857C]">{pie}</p>
    </div>
  )
}

export function Franja({ tono, icono, children, accion }: { tono: 'info' | 'ok' | 'error'; icono: React.ReactNode; children: React.ReactNode; accion?: React.ReactNode }) {
  const estilo = {
    info: 'border-[#F26212]/25 bg-[#FBEFE8] text-[#5E4A3A]',
    ok: 'border-[#2F9657]/25 bg-[#E4F3EA] text-[#1F5A36]',
    error: 'border-[#C23B3B]/30 bg-[#FBE3E0] text-[#7A2020]',
  }[tono]
  return (
    <div role={tono === 'error' ? 'alert' : undefined} className={cx('flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3.5 text-[14px] leading-snug', estilo)}>
      <span className="mt-[1px] shrink-0">{icono}</span>
      <p className="min-w-0 flex-1">{children}</p>
      {accion}
    </div>
  )
}

export function Aviso({ icono, titulo, children, accion }: { icono: React.ReactNode; titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center sm:px-12">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#FBEFE8] text-[#F26212]">{icono}</span>
      <h2 className="mt-5 text-[22px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
        {titulo}
      </h2>
      <p className="mx-auto mt-2 max-w-[460px] text-[14.5px] leading-relaxed text-[#5E5852]">{children}</p>
      {accion && <div className="mt-6">{accion}</div>}
    </div>
  )
}

function BotonPequeno({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[44px] shrink-0 rounded-xl bg-[#C23B3B] px-4 text-[13px] font-semibold text-[#FFFFFF]">
      {children}
    </button>
  )
}

function BotonCantidad({ etiqueta, onClick, disabled, children }: { etiqueta: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={etiqueta} onClick={onClick} disabled={disabled} className="grid h-11 w-11 place-items-center rounded-xl border border-[#E5E1DB] bg-[#F7F5F2] text-[#5E5852] transition hover:border-[#F26212] hover:text-[#F26212] disabled:opacity-40">
      {children}
    </button>
  )
}

function BotonIcono({ etiqueta, onClick, activo, children }: { etiqueta: string; onClick: () => void; activo?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={etiqueta} title={etiqueta} onClick={onClick} className={cx('grid h-11 w-11 place-items-center rounded-xl transition', activo ? 'bg-[#FBEFE8] text-[#F26212]' : 'text-[#8C857C] hover:bg-[#F7F5F2]')}>
      {children}
    </button>
  )
}

