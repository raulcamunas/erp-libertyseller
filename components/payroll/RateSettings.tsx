'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { X, Settings2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import {
  PayrollRate,
  PayrollPeriod,
  DEFAULT_HOURLY_RATE,
  DEFAULT_COMMISSION,
  DEFAULT_SEMI_COMMISSION,
} from '@/lib/types/payroll'

/**
 * LAS TARIFAS DEL AÑO, LOS DOCE MESES A LA VEZ
 * ============================================
 *
 * Qué se paga por hora, por cita y por cita semi-cualificada, mes a mes. Todo el equipo cobra
 * lo mismo: no hay tarifas por persona.
 *
 *
 * ============ POR QUÉ EL AÑO ENTERO Y NO UN MES CADA VEZ ============
 *
 * Antes esto era una pantalla de UN mes con flechas para moverse. Tenía dos
 * problemas, y el segundo es el que hacía perder dinero:
 *
 *   · Para saber qué se pagó en mayo había que ir mes a mes hasta mayo.
 *   · Un mes sin tarifa propia HEREDABA la del mes anterior sin decirlo. Así,
 *     poner 20 $ en septiembre lo ponía también en octubre, noviembre y todos
 *     los siguientes. Y al revés: el número que veías en un mes podía venir de
 *     tres meses atrás.
 *
 * Con los doce delante, lo que hay puesto en cada mes SE VE. Y desde la
 * migración 184 cada mes usa su propia fila y solo la suya: tocar septiembre no
 * toca octubre.
 *
 *
 * ============ UN MES VACÍO NO HEREDA, CAE A LA DE POR DEFECTO ============
 *
 * Y se marca en ámbar, porque es una tarifa que nadie ha decidido. Heredar en
 * silencio del mes anterior es justo lo que se viene a quitar: un número que no
 * se ve no se puede revisar.
 */

interface RateSettingsProps {
  period: PayrollPeriod
  rates: PayrollRate[]
  onClose: () => void
  onSaved: (rate: PayrollRate) => void
  onRemoved: (id: string) => void
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// 16 px con el dedo: con menos, iOS amplía la página al enfocar la casilla y no la devuelve
const campo =
  'w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-right text-[13px] tabular-nums text-white outline-none transition-colors focus:border-[#FF6600] [@media(pointer:coarse)]:py-2 [@media(pointer:coarse)]:text-[16px]'

/** Una fila del año: un mes, su precio/hora, su comisión por cita y la de la semi-cualificada. En el móvil las casillas bajan a 60 px para que el nombre del mes no se quede en una columna de 50 px */
function FilaMes({
  mesKey,
  nombre,
  esteMes,
  fila,
  onSaved,
  onRemoved,
}: {
  mesKey: string
  nombre: string
  /** El mes en curso, para señalarlo en la lista */
  esteMes: boolean
  /** La tarifa de ESE mes, si la tiene. null = usa la de por defecto */
  fila: PayrollRate | null
  onSaved: (rate: PayrollRate) => void
  onRemoved: (id: string) => void
}) {
  const supabase = createClient()
  const [hora, setHora] = useState(String(fila?.hourly_rate ?? ''))
  const [cita, setCita] = useState(String(fila?.commission_per_appointment ?? ''))
  const [semi, setSemi] = useState(String(fila?.commission_per_semi_qualified ?? ''))
  const [guardando, setGuardando] = useState(false)

  // Si la fila cambia desde fuera —otro guardado, una recarga— el campo la sigue.
  useEffect(() => {
    setHora(String(fila?.hourly_rate ?? ''))
    setCita(String(fila?.commission_per_appointment ?? ''))
    setSemi(String(fila?.commission_per_semi_qualified ?? ''))
  }, [fila])

  const sinTarifa = !fila

  async function guardar(campoTocado: 'hora' | 'cita' | 'semi', valor: string) {
    const horaTexto = (campoTocado === 'hora' ? valor : hora).trim()
    const citaTexto = (campoTocado === 'cita' ? valor : cita).trim()
    const semiTexto = (campoTocado === 'semi' ? valor : semi).trim()

    /**
     * VACIAR LOS TRES CAMPOS BORRA LA TARIFA DEL MES.
     *
     * Es la única forma de decir «este mes no tiene tarifa propia». Sin esto,
     * una tarifa puesta por error no se puede quitar: solo cambiar por otra.
     */
    if (horaTexto === '' && citaTexto === '' && semiTexto === '') {
      if (!fila) return
      setGuardando(true)
      const { error } = await supabase.from('payroll_rates').delete().eq('id', fila.id)
      setGuardando(false)
      if (error) {
        toast.error('No se ha podido quitar la tarifa')
        return
      }
      onRemoved(fila.id)
      toast.success(`${nombre} se queda sin tarifa propia`)
      return
    }

    /**
     * UNA CASILLA VACÍA NO ES UN CERO.
     *
     * Poner solo el precio de la semi-cualificada en un mes sin tarifa guardaba la hora y la cita a 0 $, y el mes dejaba de pagar
     * nada. Lo vacío se queda como estaba o, si no había nada, con la de por defecto. La semi vacía sí es «sin decidir»: no cobra.
     */
    const aNumero = (texto: string) => Number(texto.replace(',', '.'))
    const h = horaTexto === '' ? Number(fila?.hourly_rate ?? DEFAULT_HOURLY_RATE) : aNumero(horaTexto)
    const c = citaTexto === '' ? Number(fila?.commission_per_appointment ?? DEFAULT_COMMISSION) : aNumero(citaTexto)
    const s = semiTexto === '' ? null : aNumero(semiTexto)
    if (!Number.isFinite(h) || !Number.isFinite(c) || (s !== null && !Number.isFinite(s))) {
      toast.error('Los importes tienen que ser números')
      return
    }
    // Nada que guardar si no ha cambiado: evita una escritura por cada clic fuera.
    if (
      fila &&
      Math.abs(Number(fila.hourly_rate) - h) < 0.0001 &&
      Math.abs(Number(fila.commission_per_appointment) - c) < 0.0001 &&
      (fila.commission_per_semi_qualified == null ? s === null : s !== null && Math.abs(Number(fila.commission_per_semi_qualified) - s) < 0.0001)
    ) {
      // Una casilla que se vació sin cambiar nada vuelve a enseñar lo que hay guardado
      setHora(String(h))
      setCita(String(c))
      return
    }

    setGuardando(true)
    try {
      if (fila) {
        const { data, error } = await supabase
          .from('payroll_rates')
          .update({ hourly_rate: h, commission_per_appointment: c, commission_per_semi_qualified: s })
          .eq('id', fila.id)
          .select('*')
          .single()
        if (error) throw error
        onSaved(data as PayrollRate)
      } else {
        const { data, error } = await supabase
          .from('payroll_rates')
          .insert({
            period_start: mesKey,
            // Siempre general: ya no hay tarifas por persona.
            user_id: null,
            hourly_rate: h,
            commission_per_appointment: c,
            commission_per_semi_qualified: s,
          })
          .select('*')
          .single()
        if (error) throw error
        onSaved(data as PayrollRate)
      }
    } catch (err) {
      console.error('Error guardando la tarifa:', err)
      toast.error('No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className={`grid grid-cols-[1fr_60px_60px_60px] sm:grid-cols-[1fr_72px_72px_72px] items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
        esteMes
          ? 'border-[#FF6600]/40 bg-[#FF6600]/[0.06]'
          : sinTarifa
            ? 'border-white/[0.07] bg-transparent'
            : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-white">
          {nombre}
          {esteMes && (
            <span className="rounded-full bg-[#FF6600]/20 px-1.5 text-[9px] font-bold uppercase tracking-wider text-[#FF6600]">
              este mes
            </span>
          )}
          {guardando && <Loader2 className="h-3 w-3 animate-spin text-white/35" />}
        </p>
        {sinTarifa && (
          <p className="text-[10px] text-yellow-300/60">
            Sin tarifa propia: {DEFAULT_HOURLY_RATE} $/h y {DEFAULT_COMMISSION} $/cita
          </p>
        )}
      </div>

      <input
        value={hora}
        onChange={(e) => setHora(e.target.value)}
        onBlur={(e) => void guardar('hora', e.target.value)}
        inputMode="decimal"
        placeholder={String(DEFAULT_HOURLY_RATE)}
        aria-label={`Precio por hora de ${nombre}`}
        className={campo}
      />
      <input
        value={cita}
        onChange={(e) => setCita(e.target.value)}
        onBlur={(e) => void guardar('cita', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        inputMode="decimal"
        placeholder={String(DEFAULT_COMMISSION)}
        aria-label={`Comisión por cita de ${nombre}`}
        className={campo}
      />
      <input
        value={semi}
        onChange={(e) => setSemi(e.target.value)}
        onBlur={(e) => void guardar('semi', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        inputMode="decimal"
        placeholder={String(DEFAULT_SEMI_COMMISSION)}
        aria-label={`Comisión por cita semi-cualificada de ${nombre}`}
        className={campo}
      />
    </div>
  )
}

export function RateSettings({
  period,
  rates,
  onClose,
  onSaved,
  onRemoved,
}: RateSettingsProps) {
  const mesEnCurso = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [])

  const [anio, setAnio] = useState(() => Number(period.key.slice(0, 4)))

  /** Las doce filas del año, cada una con su tarifa si la tiene */
  const meses = useMemo(() => {
    const generales = rates.filter((r) => r.user_id === null)
    return MESES.map((nombre, i) => {
      const mesKey = `${anio}-${String(i + 1).padStart(2, '0')}-01`
      return {
        mesKey,
        nombre,
        esteMes: mesKey === mesEnCurso,
        fila: generales.find((r) => r.period_start.slice(0, 7) === mesKey.slice(0, 7)) ?? null,
      }
    })
  }, [rates, anio, mesEnCurso])

  const conTarifa = meses.filter((m) => m.fila).length

  /**
   * MIENTRAS ESTÁ ABIERTO, LA PÁGINA DE DETRÁS NO SE MUEVE, y Escape cierra.
   *
   * Sin esto, en el móvil deslizar por la lista de meses arrastraba la página de debajo (medido: 589 px de scroll de
   * fondo en cuatro deslizamientos dentro del diálogo). Se guarda y se devuelve lo que hubiera en el body.
   */
  useEffect(() => {
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', tecla)
    return () => {
      document.body.style.overflow = antes
      window.removeEventListener('keydown', tecla)
    }
  }, [onClose])

  /**
   * EN UN PORTAL AL BODY. Dentro de la página, `fixed` se colocaba respecto al recuadro animado de la ruta (su animación
   * de entrada deja un transform puesto) y no respecto a la ventana: en el móvil el diálogo salía centrado en una caja de
   * 2.300 px de alto, a 900 px de la parte de arriba, fuera de la pantalla. Solo se veía el fondo oscuro.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative max-h-[88dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <Settings2 className="h-4 w-4 text-[#FF6600]" /> Tarifas del año
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex items-center justify-center text-white/40 transition-colors hover:text-white [@media(pointer:coarse)]:-mr-2 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-white/40">
          Lo que cobra <strong className="text-white/60">todo el equipo</strong> por hora, por cita
          cualificada y por cita semi-cualificada. Cada mes lleva la suya y solo la suya: tocar uno no cambia ninguno de los
          otros. Se guarda al salir de la casilla.
        </p>

        {/* ---------------- El año ---------------- */}
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
          <button
            type="button"
            onClick={() => setAnio((a) => a - 1)}
            className="rounded border border-white/10 p-0.5 text-white/50 transition-colors hover:text-white"
            aria-label="Año anterior"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="flex-1 text-center text-[13px] font-semibold tabular-nums text-white">
            {anio}
          </span>
          <button
            type="button"
            onClick={() => setAnio((a) => a + 1)}
            className="rounded border border-white/10 p-0.5 text-white/50 transition-colors hover:text-white"
            aria-label="Año siguiente"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-[1fr_60px_60px_60px] sm:grid-cols-[1fr_72px_72px_72px] gap-2 px-2.5 text-[9.5px] font-semibold uppercase tracking-wider text-white/35">
          <span>Mes</span>
          <span className="text-right">$/hora</span>
          <span className="text-right">$/cita</span>
          <span className="text-right">$/semi</span>
        </div>

        <div className="space-y-1">
          {meses.map((m) => (
            <FilaMes
              key={m.mesKey}
              mesKey={m.mesKey}
              nombre={m.nombre}
              esteMes={m.esteMes}
              fila={m.fila}
              onSaved={onSaved}
              onRemoved={onRemoved}
            />
          ))}
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-white/30">
          {conTarifa} de 12 meses tienen tarifa propia en {anio}. Los demás cobran la de por
          defecto. Una semi-cualificada no cobra hasta que su mes tenga precio. Para quitarle la tarifa a un
          mes, vacía sus tres casillas.
        </p>
      </motion.div>
    </div>,
    document.body,
  )
}
