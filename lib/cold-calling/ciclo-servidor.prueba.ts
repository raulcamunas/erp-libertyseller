import { avanzarElCiclo, faltaLaMigracionDelCiclo, type AlmacenDelCiclo, type LeadDelCicloFila } from './ciclo-servidor'
import type { CambioDelCiclo, PasoParaElCiclo, SecuenciaParaElCiclo } from './ciclo-avance'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL PROCESO DEL CICLO CON UNA BASE EN MEMORIA.
 *
 * Lo que se comprueba aquí es lo que la regla pura (ciclo-avance.prueba.ts) no puede: que lee solo lo que hace falta, que no escribe en un ensayo, que respeta lo que una persona cambió mientras
 * tanto, que para en el tope y que con la migración sin lanzar no toca nada.
 */

const iso = (dia: string, hora = '08:30') => `${dia}T${hora}:00Z`
const paso = (orden: number, estado: string, programado: string | null, enviado: string | null = null): PasoParaElCiclo => ({ orden, estado, programado_at: programado ? iso(programado) : null, enviado_at: enviado ? iso(enviado, '08:35') : null })
const recienEmpezada = (): SecuenciaParaElCiclo => ({ estado: 'activa', pasos: [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'pendiente', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')] })
const trasElPrimero = (): SecuenciaParaElCiclo => ({ estado: 'activa', pasos: [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'pendiente', '2026-11-05')] })
const trasElSegundo = (estado = 'completada'): SecuenciaParaElCiclo => ({ estado, pasos: [paso(0, 'enviado', '2026-10-27', '2026-10-27'), paso(1, 'enviado', '2026-10-30', '2026-10-30'), paso(2, 'enviado', '2026-11-05', '2026-11-05')] })

interface Mundo {
  leads: Map<string, LeadDelCicloFila & { ciclo_vuelta: number }>
  secuencias: Map<string, SecuenciaParaElCiclo>
  lecturas: string[]
  escrituras: Array<{ id: string; campos: CambioDelCiclo['campos'] }>
  /** Leads que una persona cambia justo antes de guardar (para probar la carrera) */
  tocadosAlVuelo: Set<string>
  /** Leads que la base rechaza al guardar (un CHECK, un fallo de verdad) */
  rechazados: Set<string>
  /** Las llamadas SALIENTES de Rinkel enlazadas con un lead */
  llamadas: Array<{ lead_id: string; fecha: string }>
  /** Lo que se ha apuntado en el historial de cada lead */
  notas: Array<{ id: string; nota: string }>
  /** Si es true, la tabla de llamadas no se puede leer (falta la migración 234 o la base falla) */
  sinLlamadas: boolean
  fallaLaLectura: unknown
}

function mundo(): Mundo {
  return { leads: new Map(), secuencias: new Map(), lecturas: [], escrituras: [], tocadosAlVuelo: new Set(), rechazados: new Set(), llamadas: [], notas: [], sinLlamadas: false, fallaLaLectura: null }
}
let n = 0
const ponerLead = (m: Mundo, extra: Partial<LeadDelCicloFila> = {}, secuencia: SecuenciaParaElCiclo | null = null): string => {
  const id = `lead-${String(++n).padStart(3, '0')}`
  m.leads.set(id, { id, status: 'no_contesta', ciclo_fase: null, ciclo_vuelta: 1, next_call_date: null, ccaa: null, municipio_ine: null, ...extra } as LeadDelCicloFila & { ciclo_vuelta: number })
  if (secuencia) m.secuencias.set(id, secuencia)
  return id
}

function almacen(m: Mundo): AlmacenDelCiclo {
  return {
    async leadsConFase(hoy) {
      m.lecturas.push('leadsConFase')
      if (m.fallaLaLectura) throw m.fallaLaLectura
      // Lo mismo que pide la base: los de Fase 2 y 3, y los de «No responde» solo si ya les llegó su día
      return [...m.leads.values()].filter((l) => l.ciclo_fase !== null && (l.ciclo_fase !== 'sin_respuesta' || (l.next_call_date !== null && l.next_call_date <= hoy))).map((l) => ({ ...l }))
    },
    async leadsConSecuenciaViva() {
      m.lecturas.push('leadsConSecuenciaViva')
      return [...m.secuencias.entries()].filter(([, s]) => s.estado === 'activa').map(([id]) => id)
    },
    async leadsEnFase1(ids) {
      m.lecturas.push(`leadsEnFase1(${ids.length})`)
      return ids.map((id) => m.leads.get(id)).filter((l): l is LeadDelCicloFila & { ciclo_vuelta: number } => !!l && l.ciclo_fase === null).map((l) => ({ ...l }))
    },
    async secuenciasDe(ids) {
      m.lecturas.push(`secuenciasDe(${ids.length})`)
      const fuera = new Map<string, SecuenciaParaElCiclo>()
      for (const id of ids) {
        const s = m.secuencias.get(id)
        if (s) fuera.set(id, s)
      }
      return fuera
    },
    async llamadasSalientesDesde(ids, desdeIso) {
      m.lecturas.push(`llamadasDesde(${ids.length})`)
      if (m.sinLlamadas) return []
      return m.llamadas.filter((c) => ids.includes(c.lead_id) && Date.parse(c.fecha) >= Date.parse(desdeIso))
    },
    async aplicar(lead, campos, _ahora, nota) {
      if (m.rechazados.has(lead.id)) throw { code: '23514', message: 'new row violates check constraint' }
      if (m.tocadosAlVuelo.has(lead.id)) return false
      const real = m.leads.get(lead.id)
      if (!real || real.status !== lead.status || real.ciclo_fase !== lead.ciclo_fase) return false
      Object.assign(real, campos)
      m.escrituras.push({ id: lead.id, campos })
      m.notas.push({ id: lead.id, nota })
      return true
    },
  }
}

const sinEspera = async () => {}
const opciones = (ahora: string, extra: Record<string, unknown> = {}) => ({ ahora: () => Date.parse(ahora), esperar: sinEspera, ...extra })

// (Sin await de nivel superior: tsx lo compila como CommonJS)
async function main() {
  console.log('\n=== lo que lee ===')
  {
    const m = mundo()
    ponerLead(m) // Fase 1 sin secuencia: no cuesta ni una lectura de secuencias
    const a = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z'))
    ok('con un lead en Fase 1 sin secuencia no hay nada que hacer, y solo se miran las secuencias vivas', a.revisados === 0 && a.resumen.startsWith('Nada que mover') && m.lecturas.join(',') === 'leadsConFase,leadsConSecuenciaViva', m.lecturas.join(','))
    ok('sin nada que hacer no escribe', m.escrituras.length === 0)
  }
  {
    const m = mundo()
    for (let i = 0; i < 50; i++) ponerLead(m) // 50 leads del ciclo sin secuencia
    const a = ponerLead(m, {}, recienEmpezada())
    const r = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z'))
    ok('de 51 leads del ciclo solo se miran el que tiene la secuencia viva (no se recorren los demás)', r.revisados === 1 && m.lecturas.includes('leadsEnFase1(1)') && m.lecturas.includes('secuenciasDe(1)'), m.lecturas.join(','))
    ok('y pasa a Fase 2, con la rellamada el día del seguimiento 1', m.leads.get(a)?.ciclo_fase === 'f2' && m.leads.get(a)?.next_call_date === '2026-10-30' && r.cambios.fase_2 === 1)
    ok('el resumen lo dice', r.resumen === 'Movidos: 1 a Fase 2.', r.resumen)
  }

  console.log('\n=== avanza al LLAMAR, pasada a pasada ===')
  {
    const m = mundo()
    const id = ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-10-30' }, trasElPrimero())
    const sinLlamar = await avanzarElCiclo(almacen(m), opciones('2026-11-02T10:00:00Z'))
    ok('el lunes 2, con la rellamada del viernes 30 sin hacer, sigue en Fase 2 (atrasado): no salta de fase en silencio', sinLlamar.revisados === 1 && m.leads.get(id)?.ciclo_fase === 'f2' && m.escrituras.length === 0 && sinLlamar.resumen.startsWith('Nada que mover'))
    ok('y para saberlo se miraron las llamadas salientes de ESE lead, una consulta', m.lecturas.filter((l) => l.startsWith('llamadasDesde')).join() === 'llamadasDesde(1)', m.lecturas.join(','))
    m.llamadas.push({ lead_id: id, fecha: '2026-11-02T10:05:00Z' })
    const llamado = await avanzarElCiclo(almacen(m), opciones('2026-11-02T10:07:00Z'))
    ok('en cuanto se le llama pasa a Fase 3, con la rellamada el día del seguimiento 2', m.leads.get(id)?.ciclo_fase === 'f3' && m.leads.get(id)?.next_call_date === '2026-11-05' && llamado.cambios.fase_3 === 1)
    ok('y lo apunta en su historial', m.notas.length === 1 && m.notas[0].id === id && m.notas[0].nota === 'Ciclo comercial · Hecha la llamada de la Fase 2: pasa a Fase 3. Rellamada el jue 5 nov.', JSON.stringify(m.notas))
    const otraVez = await avanzarElCiclo(almacen(m), opciones('2026-11-02T10:09:00Z'))
    ok('y la pasada siguiente no repite nada: es estable, y la llamada de antes no cuenta para la Fase 3 (es de antes de su día)', otraVez.resumen.startsWith('Nada que mover') && m.escrituras.length === 1 && m.leads.get(id)?.ciclo_fase === 'f3')
  }
  {
    const m = mundo()
    const antes = ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-10-30' }, trasElPrimero())
    const entrante = ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-10-30' }, trasElPrimero())
    // Una llamada del 27 (los dos toques de la Fase 1) NO es la de la Fase 2; a `entrante` no se le ha hecho ninguna saliente (la entrante no cuenta y el almacén solo da salientes)
    m.llamadas.push({ lead_id: antes, fecha: '2026-10-27T10:00:00Z' })
    await avanzarElCiclo(almacen(m), opciones('2026-10-31T10:00:00Z'))
    ok('las llamadas anteriores al día de la rellamada (los dos toques de la Fase 1) no cuentan', m.leads.get(antes)?.ciclo_fase === 'f2' && m.leads.get(entrante)?.ciclo_fase === 'f2' && m.escrituras.length === 0)
    m.llamadas.push({ lead_id: antes, fecha: '2026-10-30T23:30:00Z' })
    await avanzarElCiclo(almacen(m), opciones('2026-10-31T07:00:00Z'))
    ok('una llamada de las 00:30 del 31 en Madrid (23:30 UTC del 30) cuenta como del 31: el día se cuenta en hora de Madrid, y vale porque es posterior a la rellamada', m.leads.get(antes)?.ciclo_fase === 'f3')
    ok('y la otra, sin llamada, sigue donde estaba', m.leads.get(entrante)?.ciclo_fase === 'f2')
  }
  {
    const m = mundo()
    const id = ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-10-30' }, trasElPrimero())
    for (let i = 0; i < 30; i++) ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-11-20' }, trasElPrimero())
    m.llamadas.push({ lead_id: id, fecha: '2026-10-30T09:00:00Z' })
    await avanzarElCiclo(almacen(m), opciones('2026-11-02T10:00:00Z'))
    ok('solo se miran las llamadas de los leads a los que YA les toca (los de rellamada futura no cuestan una lectura)', m.lecturas.filter((l) => l.startsWith('llamadasDesde')).join() === 'llamadasDesde(1)' && m.leads.get(id)?.ciclo_fase === 'f3', m.lecturas.join(','))
  }
  {
    const m = mundo()
    const id = ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-10-30' }, trasElPrimero())
    m.llamadas.push({ lead_id: id, fecha: '2026-10-30T09:00:00Z' })
    m.sinLlamadas = true
    const r = await avanzarElCiclo(almacen(m), opciones('2026-11-02T10:00:00Z'))
    ok('si no se pueden leer las llamadas (falta la tabla de Rinkel) no se avanza por llamada y la pasada NO falla: el lead se queda donde está', r.errores === 0 && m.leads.get(id)?.ciclo_fase === 'f2')
  }
  {
    const m = mundo()
    const id = ponerLead(m, { ciclo_fase: 'f2', next_call_date: '2026-10-30' }, trasElSegundo('sin_respuesta'))
    const r = await avanzarElCiclo(almacen(m), opciones('2026-11-16T10:00:00Z'))
    ok('cuando el motor cierra la secuencia sin respuesta, un lead al que nunca se llamó pasa a «No responde» (no se queda atrasado para siempre)', m.leads.get(id)?.ciclo_fase === 'sin_respuesta' && r.cambios.sin_respuesta === 1 && m.notas[0]?.nota.startsWith('Ciclo comercial · Acabó la secuencia de correos sin respuesta'))
  }
  {
    const m = mundo()
    const id = ponerLead(m, { ciclo_fase: 'f2', status: 'seguimiento' }, trasElPrimero())
    const r = await avanzarElCiclo(almacen(m), opciones('2026-10-31T07:00:00Z'))
    ok('un lead que el comercial ya pasó a «En seguimiento» pierde la fase y NO se toca nada más', m.leads.get(id)?.ciclo_fase === null && m.leads.get(id)?.status === 'seguimiento' && r.cambios.sale_del_ritmo === 1)
  }

  console.log('\n=== el ensayo no escribe ===')
  {
    const m = mundo()
    const id = ponerLead(m, {}, recienEmpezada())
    const r = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z', { ensayo: true }))
    ok('dice lo que haría y no guarda nada', r.ensayo && r.cambios.fase_2 === 1 && m.leads.get(id)?.ciclo_fase === null && m.escrituras.length === 0 && r.resumen.startsWith('Haría: 1 a Fase 2'), r.resumen)
  }

  console.log('\n=== si una persona toca el lead mientras tanto ===')
  {
    const m = mundo()
    const a = ponerLead(m, {}, recienEmpezada())
    const b = ponerLead(m, {}, recienEmpezada())
    m.tocadosAlVuelo.add(a)
    const r = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z'))
    ok('el cambio de ese lead no se guarda (gana la persona) y se cuenta aparte', m.leads.get(a)?.ciclo_fase === null && r.alVuelo === 1)
    ok('el otro sí se guarda', m.leads.get(b)?.ciclo_fase === 'f2' && r.cambios.fase_2 === 1)
    ok('y el resumen lo explica', r.resumen.includes('1 tocados por una persona mientras tanto'), r.resumen)
    m.tocadosAlVuelo.clear()
    const otra = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:02:00Z'))
    ok('en la pasada siguiente, con el lead ya libre, se rehace', m.leads.get(a)?.ciclo_fase === 'f2' && otra.cambios.fase_2 === 1)
  }

  console.log('\n=== los aparcados en «No responde» no se leen hasta su día ===')
  {
    const m = mundo()
    for (let i = 0; i < 60; i++) ponerLead(m, { ciclo_fase: 'sin_respuesta', next_call_date: '2027-01-05' })
    const r = await avanzarElCiclo(almacen(m), opciones('2026-11-20T09:00:00Z'))
    ok('60 aparcados a dos meses no cuestan ni una lectura de secuencias', r.revisados === 0 && !m.lecturas.some((l) => l.startsWith('secuenciasDe')) && r.resumen.startsWith('Nada que mover'), m.lecturas.join(','))
    const llega = await avanzarElCiclo(almacen(m), opciones('2027-01-05T09:00:00Z'))
    ok('el día que les toca se leen todos y vuelven a empezar', llega.revisados === 60 && llega.cambios.otra_vuelta === 60 && m.lecturas.some((l) => l === 'secuenciasDe(60)'), m.lecturas.join(','))
  }

  console.log('\n=== un lead que la base rechaza no deja parados a los demás ===')
  {
    const m = mundo()
    const malo = ponerLead(m, {}, recienEmpezada())
    const buenos = [ponerLead(m, {}, recienEmpezada()), ponerLead(m, {}, recienEmpezada())]
    m.rechazados.add(malo)
    let mensaje = ''
    try {
      await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z'))
    } catch (error) {
      mensaje = (error as Error).message
    }
    ok('los otros dos SÍ avanzan y el rechazado se queda como estaba', buenos.every((id) => m.leads.get(id)?.ciclo_fase === 'f2') && m.leads.get(malo)?.ciclo_fase === null)
    ok('y la pasada acaba diciéndolo (sale en rojo en Sistema), con lo que sí se hizo', mensaje.includes('1 cambio no se ha podido guardar') && mensaje.includes('Movidos: 2 a Fase 2'), mensaje)
    m.rechazados.clear()
    const otra = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:02:00Z'))
    ok('al quitarse el fallo, en la pasada siguiente se rehace', m.leads.get(malo)?.ciclo_fase === 'f2' && otra.cambios.fase_2 === 1)
  }

  console.log('\n=== el tope por pasada ===')
  {
    const m = mundo()
    const ids = Array.from({ length: 12 }, () => ponerLead(m, {}, recienEmpezada()))
    const r = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z', { tope: 5 }))
    ok('con 12 por mover y un tope de 5 mueve 5 y dice que quedan más', r.cambios.fase_2 === 5 && r.quedan && ids.filter((id) => m.leads.get(id)?.ciclo_fase === 'f2').length === 5 && r.resumen.endsWith('quedan más para la siguiente pasada.'), r.resumen)
    const r2 = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:02:00Z', { tope: 5 }))
    const r3 = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:04:00Z', { tope: 5 }))
    ok('en tres pasadas están los 12 y la última ya no dice que quedan', ids.every((id) => m.leads.get(id)?.ciclo_fase === 'f2') && !r3.quedan && r2.quedan)
  }
  {
    const m = mundo()
    for (let i = 0; i < 4; i++) ponerLead(m, {}, recienEmpezada())
    const pausas: number[] = []
    await avanzarElCiclo(almacen(m), { ahora: () => Date.parse('2026-10-28T09:00:00Z'), esperar: async (ms) => { pausas.push(ms) }, pausaMs: 25 })
    ok('entre un cambio y otro hay una pausa (cada guardado es un aviso del tiempo real)', pausas.length === 4 && pausas.every((p) => p === 25), pausas.join(','))
  }

  console.log('\n=== con la migración sin lanzar ===')
  {
    const m = mundo()
    m.fallaLaLectura = { code: '42703', message: 'column cold_leads.ciclo_fase does not exist' }
    const r = await avanzarElCiclo(almacen(m), opciones('2026-10-28T09:00:00Z'))
    ok('lo dice y no toca nada', r.faltaLaMigracion && r.resumen.includes('migración 264') && m.escrituras.length === 0 && m.lecturas.join(',') === 'leadsConFase')
    ok('reconoce los códigos de «no existe la columna o la tabla»', ['42703', 'PGRST204', 'PGRST205', '42P01'].every((c) => faltaLaMigracionDelCiclo({ code: c })) && !faltaLaMigracionDelCiclo({ code: '57014' }) && !faltaLaMigracionDelCiclo(null))
    const otra = mundo()
    otra.fallaLaLectura = { code: '57014', message: 'canceling statement due to statement timeout' }
    let lanzo = false
    try {
      await avanzarElCiclo(almacen(otra), opciones('2026-10-28T09:00:00Z'))
    } catch {
      lanzo = true
    }
    ok('cualquier otro fallo (un tiempo agotado de la base) NO se disfraza de «falta la migración»: se propaga para que Sistema lo ponga en rojo', lanzo)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
