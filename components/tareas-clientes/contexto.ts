'use client'

import { createContext, useContext } from 'react'

/** Las tareas que ahora mismo están bloqueadas por otra sin hacer (lo calcula el espacio de trabajo una vez; las tarjetas y las filas solo miran) */
export const BloqueadasContexto = createContext<ReadonlySet<string>>(new Set())
export const useBloqueadas = (): ReadonlySet<string> => useContext(BloqueadasContexto)
