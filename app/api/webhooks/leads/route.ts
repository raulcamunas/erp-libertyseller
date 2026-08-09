import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { comprobarTamañoPeticion, leerCuerpoConTope, MAX_BYTES_WEBHOOK } from '@/lib/subidas-limite'

export async function POST(request: NextRequest) {
  try {
    /**
     * TOPE DE BYTES, ANTES DE PARSEAR NADA.
     *
     * QUÉ IMPIDE: que cualquiera de Internet tumbe el contenedor por falta de
     * memoria, y con él el ERP de los 16 clientes. Esta ruta NO pide sesión ni
     * secreto —cualquiera puede llamarla— y tanto `request.json()` como
     * `request.formData()` se comen el cuerpo ENTERO en memoria antes de que
     * aquí se mire nada. Está medido en la ruta hermana de subidas: un solo
     * cuerpo de 60 MB dejó el proceso en 894 MB de RSS, y cuatro a la vez lo
     * clavaron ahí.
     *
     * POR QUÉ NO ROMPE NINGÚN LEAD REAL: lo que entra por aquí es el formulario
     * de contacto de libertyupgrowth.es (nombre, email, teléfono, empresa,
     * mensaje, ingresos), del orden de un kilobyte. El tope es de un megabyte:
     * mil veces el uso real.
     */
    const demasiado = comprobarTamañoPeticion(request, MAX_BYTES_WEBHOOK)
    if (demasiado) return demasiado

    /**
     * Y EL TOPE DE VERDAD, LEYENDO EL FLUJO.
     *
     * La comprobación de arriba mira Content-Length, y un cuerpo con
     * `Transfer-Encoding: chunked` NO la trae, así que la esquivaba entero.
     * Reproducido contra el servidor local, sin cookie:
     *
     *   curl -H 'Transfer-Encoding: chunked' --data-binary @2MB  ->  antes: el
     *   cuerpo se parseaba;  ahora: HTTP 413 en 0,007 s.
     *
     * LO QUE ESTO NO ARREGLA: el pico de RSS del proceso. Está medido que sube
     * igual en una ruta que contesta 401 sin leer el cuerpo, o sea que los
     * bytes los acumula Node por debajo. El freno para eso va en el proxy de
     * delante. Explicado entero en lib/subidas-limite.ts.
     *
     * No cambia nada para un lead real: el texto que sale de aquí es el mismo
     * que devolvía `request.text()`, y el formulario de la web ocupa ~1 kB.
     * Comprobados los tres caminos —JSON, JSON troceado y urlencoded— y los
     * tres contestan exactamente lo mismo que antes.
     */
    const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_WEBHOOK)
    if (cuerpo instanceof NextResponse) return cuerpo

    // Intentar parsear como JSON primero, si falla, intentar como form-data
    let body: any
    const contentType = request.headers.get('content-type') || ''

    try {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Mismo resultado que `Object.fromEntries(formData.entries())` para un
        // cuerpo urlencoded, pero sobre el texto ya leído: el cuerpo solo se
        // puede consumir una vez.
        body = Object.fromEntries(new URLSearchParams(cuerpo.texto).entries())
      } else {
        // JSON por defecto, igual que antes
        body = JSON.parse(cuerpo.texto)
      }
    } catch (parseError) {
      console.error('Error parsing request body:', parseError)
      return NextResponse.json(
        { error: 'Error al parsear el cuerpo de la solicitud', details: String(parseError) },
        { status: 400 }
      )
    }
    
    // Traza SIN datos personales.
    //
    // QUÉ IMPIDE: que los datos de contacto de cada lead acaben en el log del
    // servidor. Antes esta línea era
    //
    //     console.log('Webhook received:', JSON.stringify(body, null, 2))
    //
    // y el cuerpo es el formulario de la web: nombre, email, teléfono, empresa,
    // mensaje e ingresos. O sea, la ficha completa de cada uno de los 3.978
    // leads de cold_leads y los 512 de company_prospects, en un log sin
    // caducidad ni control de acceso, que se copia entero cada vez que alguien
    // depura un despliegue.
    //
    // Lo que se necesitaba para depurar de verdad es saber si el formulario
    // trae los campos y con qué Content-Type llega, y eso se sigue viendo.
    console.log('Webhook lead recibido', {
      contentType,
      tieneNombre: !!(body.nombre || body.name),
      tieneEmail: !!body.email,
      tieneTelefono: !!(body.telefono || body.phone),
      camposRecibidos: Object.keys(body || {}).length,
    })

    // Validar campos requeridos (aceptar tanto 'nombre' como 'name', y 'telefono' como 'phone')
    const nombre = body.nombre || body.name
    const email = body.email
    const telefono = body.telefono || body.phone

    if (!nombre || !email) {
      // Sin PII, por lo mismo que la traza de arriba: aquí se registraba el
      // nombre y el email del lead en el log. Basta con saber cuál falta.
      console.error('Webhook lead rechazado: faltan campos', {
        tieneNombre: !!nombre,
        tieneEmail: !!email,
      })
      return NextResponse.json(
        { error: 'Los campos "nombre" (o "name") y "email" son requeridos' },
        { status: 400 }
      )
    }

    // Verificar que las variables de entorno estén configuradas
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { error: 'Error de configuración del servidor' },
        { status: 500 }
      )
    }

    // Crear cliente de Supabase público (sin autenticación para webhook)
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    // Construir mensaje con información adicional del formulario
    let mensaje = body.mensaje || ''
    const mensajeParts: string[] = []
    
    if (body.vendeEnAmazon) {
      mensajeParts.push(`Vende en Amazon: ${body.vendeEnAmazon}`)
    }
    if (body.sellingDuration) {
      mensajeParts.push(`Tiempo vendiendo: ${body.sellingDuration}`)
    }
    if (body.monthlyRevenue) {
      mensajeParts.push(`Facturación mensual: ${body.monthlyRevenue}`)
    }
    if (body.source) {
      mensajeParts.push(`Fuente: ${body.source}`)
    }
    
    if (mensajeParts.length > 0) {
      mensaje = mensajeParts.join('\n') + (mensaje ? '\n\n' + mensaje : '')
    }

    // Mapear campos del webhook a la tabla web_leads
    const leadData = {
      nombre: nombre.trim(),
      email: email.trim(),
      telefono: telefono ? telefono.trim() : null,
      empresa: body.empresa ? body.empresa.trim() : null,
      mensaje: mensaje || null,
      ingresos: body.ingresos || body.monthlyRevenue || null,
      status: 'registrado' as const // Estado inicial
    }

    // Sin PII: antes volcaba `JSON.stringify(leadData)` entero, o sea nombre,
    // email, teléfono, empresa, mensaje e ingresos del lead, al log.
    console.log('Insertando lead', {
      tieneTelefono: !!leadData.telefono,
      tieneEmpresa: !!leadData.empresa,
      tieneMensaje: !!leadData.mensaje,
    })

    // Usar función SQL con SECURITY DEFINER para bypassear RLS
    const { data, error } = await supabase.rpc('insert_web_lead', {
      p_nombre: leadData.nombre,
      p_email: leadData.email,
      p_telefono: leadData.telefono,
      p_empresa: leadData.empresa,
      p_mensaje: leadData.mensaje,
      p_ingresos: leadData.ingresos
    })

    if (error) {
      console.error('Error inserting web lead via function:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        // `leadData` NO se registra: llevaba el nombre, el email y el teléfono
        // del lead al log. Para diagnosticar el fallo basta el error de
        // Postgres, que es lo que dice por qué no entró la fila.
      })
      
      // Si la función no existe, intentar insert directo como fallback
      if (error.code === '42883' || error.message.includes('function') || error.message.includes('does not exist')) {
        console.log('Function not found, trying direct insert...')
        const { data: directData, error: directError } = await supabase
          .from('web_leads')
          .insert([leadData])
          .select()
          .single()
        
        if (directError) {
          console.error('Error with direct insert:', directError)
          return NextResponse.json(
            { 
              error: 'Error al guardar el lead', 
              details: directError.message,
              code: directError.code,
              hint: directError.hint
            },
            { status: 500 }
          )
        }
        
        return NextResponse.json(
          {
            success: true,
            message: 'Lead creado exitosamente',
            data: directData,
          },
          { status: 201 }
        )
      }
      
      return NextResponse.json(
        { 
          error: 'Error al guardar el lead', 
          details: error.message,
          code: error.code,
          hint: error.hint
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Lead creado exitosamente',
        data,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Error al procesar la solicitud', details: error.message },
      { status: 500 }
    )
  }
}

// Método GET para verificar que el endpoint funciona
export async function GET() {
  return NextResponse.json(
    {
      message: 'Webhook endpoint para web leads',
      method: 'POST',
      required_fields: ['nombre (o name)', 'email'],
      optional_fields: [
        'telefono (o phone)',
        'empresa',
        'mensaje',
        'ingresos (o monthlyRevenue)',
        'vendeEnAmazon',
        'sellingDuration',
        'source',
        'timestamp'
      ],
      example: {
        nombre: 'Pepe',
        email: 'pepe@example.com',
        telefono: '678112754',
        vendeEnAmazon: 'Sí',
        sellingDuration: '0-1 año',
        monthlyRevenue: '0-5k',
        source: 'Hero Form'
      }
    },
    { status: 200 }
  )
}

