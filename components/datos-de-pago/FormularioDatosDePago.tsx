'use client'

import { useState } from 'react'
import { CheckCircle2, Lock, TriangleAlert } from 'lucide-react'
import { Cabecera } from '@/components/encaje/Cabecera'
import { FUENTE_CUERPO, FUENTE_TITULO } from '@/components/encaje/marca'
import { NOMBRE_DEL_TIPO, TIPOS_DE_CUENTA, validarDatos, type TipoDeCuenta } from '@/lib/empleados/datos-de-pago'

/**
 * EL FORMULARIO QUE RELLENA EL EMPLEADO. Se adapta al país de la cuenta y comprueba al enviar lo mismo que el servidor (los dígitos de control de la
 * CLABE, el IBAN o el número de ruta), para que un número mal copiado se corrija aquí y no en un pago devuelto. Pensado para el móvil: llega por WhatsApp.
 */

const MONEDA_POR_TIPO: Record<TipoDeCuenta, string> = { us: 'USD', mx: 'MXN', co: 'COP', iban: 'EUR', otro: '' }
const PAIS_POR_TIPO: Record<TipoDeCuenta, string> = { us: 'Estados Unidos', mx: 'México', co: 'Colombia', iban: '', otro: '' }

type Valores = Record<string, string>

export function FormularioDatosDePago({ token, nombre }: { token: string; nombre: string }) {
  const [v, setV] = useState<Valores>({ tipo: '' })
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [estado, setEstado] = useState<'editando' | 'enviando' | 'hecho'>('editando')
  const [error, setError] = useState<string | null>(null)
  const tipo = v.tipo as TipoDeCuenta | ''

  const poner = (k: string, valor: string) => {
    setV((x) => ({ ...x, [k]: valor }))
    if (errores[k]) setErrores((e) => ({ ...e, [k]: '' }))
  }
  const elegirTipo = (t: TipoDeCuenta) =>
    setV((x) => ({ ...x, tipo: t, moneda: x.moneda || MONEDA_POR_TIPO[t], paisBanco: x.paisBanco || PAIS_POR_TIPO[t], pais: x.pais || PAIS_POR_TIPO[t] }))

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const local = validarDatos(v)
    if (!local.ok) {
      setErrores(local.errores)
      document.getElementById(`c-${Object.keys(local.errores)[0]}`)?.focus()
      return
    }
    setEstado('enviando')
    try {
      const res = await fetch('/api/publico/datos-de-pago', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, datos: v }) })
      const j = await res.json().catch(() => ({}))
      if (res.ok) return setEstado('hecho')
      if (j.errores) setErrores(j.errores)
      setError(j.error ?? (j.errores ? 'Revisa los campos marcados.' : 'No se han podido enviar. Inténtalo de nuevo.'))
    } catch {
      setError('Sin conexión. Inténtalo de nuevo.')
    }
    setEstado('editando')
  }

  if (estado === 'hecho') {
    return (
      <Marco>
        <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center sm:px-12">
          <CheckCircle2 className="mx-auto h-14 w-14 text-[#2E8B57]" />
          <h2 className="mt-4 text-[24px]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
            ¡Recibido{nombre ? `, ${nombre}` : ''}!
          </h2>
          <p className="mx-auto mt-3 max-w-[420px] text-[14.5px] leading-relaxed text-[#5E5852]">Tus datos de pago se han guardado. Ya puedes cerrar esta página.</p>
        </div>
      </Marco>
    )
  }

  const campo = (k: string, etiqueta: string, extra?: { ayuda?: string; inputMode?: 'numeric' | 'text'; placeholder?: string; autoComplete?: string }) => (
    <label className="block" htmlFor={`c-${k}`}>
      <span className="text-[13.5px] font-semibold text-[#141414]">{etiqueta}</span>
      {extra?.ayuda && <span className="mt-0.5 block text-[12.5px] text-[#7A736B]">{extra.ayuda}</span>}
      <input
        id={`c-${k}`}
        value={v[k] ?? ''}
        onChange={(e) => poner(k, e.target.value)}
        inputMode={extra?.inputMode}
        placeholder={extra?.placeholder}
        autoComplete={extra?.autoComplete ?? 'off'}
        className={`mt-1.5 min-h-[46px] w-full rounded-xl border bg-[#FFFFFF] px-3.5 text-[15px] text-[#141414] outline-none focus:border-[#F26212] ${errores[k] ? 'border-[#C23B3B]' : 'border-[#D9D3CB]'}`}
      />
      {errores[k] && <span className="mt-1 block text-[12.5px] text-[#C23B3B]">{errores[k]}</span>}
    </label>
  )
  const elegir = (k: string, etiqueta: string, opciones: Array<[string, string]>, alElegir: (valor: string) => void = (x) => poner(k, x)) => (
    <div>
      <span className="text-[13.5px] font-semibold text-[#141414]">{etiqueta}</span>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {opciones.map(([valor, texto], i) => (
          <button
            key={valor}
            id={i === 0 ? `c-${k}` : undefined}
            type="button"
            onClick={() => alElegir(valor)}
            className={`min-h-[44px] rounded-xl border px-4 text-[14px] ${v[k] === valor ? 'border-[#F26212] bg-[#FBEFE8] font-semibold text-[#141414]' : 'border-[#D9D3CB] bg-[#FFFFFF] text-[#5E5852]'}`}
          >
            {texto}
          </button>
        ))}
      </div>
      {errores[k] && <span className="mt-1 block text-[12.5px] text-[#C23B3B]">{errores[k]}</span>}
    </div>
  )

  return (
    <Marco>
      <form onSubmit={enviar} noValidate className="space-y-5">
        <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-5 py-6 sm:px-8">
          <h2 className="text-[22px] leading-tight" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
            Hola{nombre ? `, ${nombre}` : ''}
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[#5E5852]">Para hacerte los pagos necesitamos tus datos bancarios. Escríbelos tal y como aparecen en tu banco.</p>
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-[#F7F5F2] px-3.5 py-3 text-[13px] leading-snug text-[#5E5852]">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#F26212]" />
            Nunca te pediremos contraseñas, PIN, códigos de SMS ni datos de tu tarjeta. Este enlace es solo para ti y sirve una vez.
          </p>
        </div>

        <Bloque titulo="¿De qué país es tu cuenta bancaria?">
          {elegir('tipo', '', TIPOS_DE_CUENTA.map((t) => [t, NOMBRE_DEL_TIPO[t]]), (t) => elegirTipo(t as TipoDeCuenta))}
        </Bloque>

        {tipo && (
          <>
            <Bloque titulo="Tu cuenta">
              {campo('titular', 'Nombre y apellidos del titular', { ayuda: 'Exactamente como en el banco', autoComplete: 'name' })}
              {campo('banco', 'Nombre del banco')}
              {tipo === 'us' && (
                <>
                  {campo('numeroRuta', 'Número de ruta (routing / ABA)', { inputMode: 'numeric', placeholder: '9 dígitos' })}
                  {campo('numeroCuenta', 'Número de cuenta', { inputMode: 'numeric' })}
                  {elegir('tipoCuentaBancaria', 'Tipo de cuenta', [['corriente', 'Corriente (checking)'], ['ahorros', 'Ahorros (savings)']])}
                </>
              )}
              {tipo === 'mx' && campo('clabe', 'CLABE interbancaria', { inputMode: 'numeric', placeholder: '18 dígitos' })}
              {tipo === 'co' && (
                <>
                  {campo('numeroCuenta', 'Número de cuenta', { inputMode: 'numeric' })}
                  {elegir('tipoCuentaBancaria', 'Tipo de cuenta', [['ahorros', 'Ahorros'], ['corriente', 'Corriente']])}
                  {campo('documento', 'Número de cédula', { inputMode: 'numeric' })}
                </>
              )}
              {tipo === 'iban' && campo('iban', 'IBAN', { placeholder: 'ES00 0000 0000 0000 0000 0000' })}
              {tipo === 'otro' && campo('numeroCuenta', 'Número de cuenta')}
              {campo('swift', tipo === 'otro' ? 'Código SWIFT / BIC del banco' : 'Código SWIFT / BIC (si lo sabes)', { placeholder: 'p. ej. BOFAUS3N' })}
              {campo('paisBanco', 'País del banco')}
              {elegir('moneda', 'Moneda en la que cobras', [['USD', 'USD'], ['MXN', 'MXN'], ['COP', 'COP'], ['EUR', 'EUR']])}
            </Bloque>

            <Bloque titulo="Tu dirección" ayuda="La pide el banco para poder enviarte el dinero.">
              {campo('calle', 'Calle y número', { autoComplete: 'street-address' })}
              <div className="grid gap-4 sm:grid-cols-2">
                {campo('ciudad', 'Ciudad', { autoComplete: 'address-level2' })}
                {campo('estado', tipo === 'us' ? 'Estado' : 'Estado / provincia / departamento', { autoComplete: 'address-level1' })}
                {campo('codigoPostal', 'Código postal', { autoComplete: 'postal-code' })}
                {campo('pais', 'País', { autoComplete: 'country-name' })}
              </div>
            </Bloque>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-2xl border border-[#C23B3B]/30 bg-[#FBE3E0] px-4 py-3 text-[14px] text-[#7A2020]">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
            <button type="submit" disabled={estado === 'enviando'} className="min-h-[52px] w-full rounded-2xl bg-[#F26212] text-[16px] font-semibold text-[#141414] disabled:opacity-60">
              {estado === 'enviando' ? 'Enviando…' : 'Enviar mis datos'}
            </button>
          </>
        )}
      </form>
    </Marco>
  )
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
      <Cabecera titulo="Datos de pago" cliente="Liberty Seller" etiqueta="Datos de pago" />
      <main className="mx-auto max-w-[640px] px-4 pb-24 pt-6 sm:px-8">{children}</main>
    </div>
  )
}

function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-5 py-6 sm:px-8">
      <div>
        <h3 className="text-[17px]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          {titulo}
        </h3>
        {ayuda && <p className="mt-1 text-[13px] text-[#7A736B]">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}
