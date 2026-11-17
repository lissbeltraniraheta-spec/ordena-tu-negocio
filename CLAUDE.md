# Ordena tu Negocio — reglas para trabajar en este proyecto

App web para negocios pequeños de El Salvador: ventas al contado, ventas al crédito, abonos, gastos,
retiros, cierre de caja y expediente para crédito. El dueño anota a mano, con foto del cuaderno o
con nota de voz; la IA (Gemini) propone los movimientos y el dueño los revisa antes de guardar.
Ver `README.md` para la arquitectura.

## Textos que ve el usuario
- Español sencillo de El Salvador, tratando de **"usted"**. Frases cortas; los usuarios no son técnicos.
- Decir **"al crédito"** (venta al crédito, créditos recuperados). **Nunca "fiado"** en textos visibles.
  - Ojo: en el código y la base de datos el valor interno sigue siendo `fiado` (tipo de movimiento,
    vista `#fiados`, ids `v-fiados`, etc.). **No renombrarlo**: rompería los datos guardados.
- No mencionar ciudades ni departamentos (la marca es general, para todo El Salvador).
- Montos en dólares con 2 decimales: `$12.00`.
- Los mensajes de error deben decir qué hacer, no códigos técnicos.

## Datos del negocio que no se cambian sin preguntar
- Precios: **Plan Básico $12/mes** y **Plan Negocio $20/mes**. Primer mes gratis. Solo esos dos planes.
- No inventar funciones que la app no tiene (ni en la app ni en textos de marketing).

## Dónde vive cada cosa
| Parte | Dónde |
| --- | --- |
| Código | GitHub `lissbeltraniraheta-spec/ordena-tu-negocio`, rama `main` |
| App publicada | Vercel, proyecto **`ordena-tu-negocio`** → https://ordena-tu-negocio.vercel.app |
| Base de datos, cuentas y archivos | Supabase, proyecto `ordena-tu-negocio` (ref `zjqogeateqsgortmswbt`) |
| IA | Google Gemini (clave en la variable `GEMINI_API_KEY` de Vercel) |

- **Cuidado:** existe un proyecto duplicado en Vercel, `ordena-tu-negocio-6aak`. **No es el de producción**
  (no tiene las variables de entorno). Publicar siempre en `ordena-tu-negocio`.
- Mientras el proyecto `ordena-tu-negocio` no esté conectado a GitHub, después de subir a `main` hay que
  crear el despliegue de producción de ese proyecto a mano y confirmar que quedó `READY`.
- Zona horaria: `America/El_Salvador` (en `config.js`).
- En Supabase → Authentication → URL Configuration, la Site URL debe ser
  `https://ordena-tu-negocio.vercel.app` (nunca `localhost`), o fallan los enlaces de los correos.
- Supabase gratis se pausa tras ~7 días sin uso; si la app dice "No se pudo conectar con el servidor",
  revisar primero si el proyecto está pausado.

## Seguridad
- **Nunca** poner claves, contraseñas ni tokens en el código. Van en las variables de entorno de Vercel.
  La única excepción es la clave *publishable* de Supabase en `config.js`, que está hecha para el navegador.
- Cada usuario solo ve sus negocios gracias a las reglas RLS. Toda tabla o bucket nuevo necesita RLS.
- La función `api/procesar.js` usa el token del usuario, no una clave de servicio. Mantenerlo así.
- No leer, cambiar ni borrar datos reales de clientes (movimientos, clientes, capturas) sin que la dueña
  lo pida. Para probar, usar un negocio de prueba.

## Cómo trabajar
- Cambios pequeños y concretos, uno por commit, con mensaje en español que diga qué cambia para el usuario.
- Cambios a la base de datos: como migración nueva en `supabase/migrations/`, nunca editando una que ya se aplicó.
- Antes de publicar, comprobar al menos: `node --check app.js` y `node --check api/procesar.js`.
- Después de publicar, verificar en el celular: entrar, subir una foto, ver la lista "Revise antes de guardar"
  y tocar "Guardar en el registro". Si la IA falla, revisar los registros de Vercel (`[gemini] ...`).
- La IA de Gemini a veces está saturada (error 503 o tarda mucho). La función ya prueba varios modelos
  de respaldo; no quitar ese comportamiento.
- Preguntar antes de: borrar archivos o proyectos, cambiar precios, gastar dinero (planes pagados) o
  cambiar la configuración de cuentas.
