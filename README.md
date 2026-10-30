# Ordena tu Negocio

App web para negocios pequeños: ventas del día, fiados, cierre de caja y expediente para crédito.
El dueño puede anotar a mano, **mandar la foto del cuaderno** o **grabar / subir una nota de voz**;
la IA (Google Gemini) los convierte en movimientos que el dueño revisa antes de guardar.

## Cómo está armado

| Parte | Dónde | Qué hace |
| --- | --- | --- |
| `index.html`, `app.css`, `app.js` | Vercel (estático) | La app. Usa `supabase-js` desde el navegador. |
| `config.js` | Vercel (estático) | URL y clave pública de Supabase. |
| `api/procesar.js` | Vercel (función) | Descarga la foto o el audio de Supabase y se lo pasa a Gemini. |
| `supabase/migrations/` | Supabase | Tablas, reglas de seguridad (RLS), vistas y almacenamiento. |

Cada usuario entra con su correo y solo ve sus propios negocios: las reglas RLS de la base de datos
y del almacenamiento lo garantizan, también para la función de IA (usa el token del usuario).

Las fotos se reducen a 2000 px en el celular antes de subir. Los audios (WhatsApp `.opus`, `.m4a`,
grabaciones del navegador) se convierten en el celular a WAV de 16 kHz, que Gemini entiende siempre.

## Variables de entorno en Vercel

| Variable | Obligatoria | Valor |
| --- | --- | --- |
| `GEMINI_API_KEY` | Sí | Clave de [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | No | Por defecto `gemini-2.5-flash` |
| `SUPABASE_URL` | No | Por defecto el proyecto `ordena-tu-negocio` |
| `SUPABASE_ANON_KEY` | No | Por defecto su clave publishable |

## Configuración de Supabase (una sola vez)

En **Authentication → URL Configuration** del proyecto `ordena-tu-negocio`:

- **Site URL**: la dirección de Vercel (por ejemplo `https://ordena-tu-negocio.vercel.app`).
- **Redirect URLs**: la misma dirección con `/**` al final.

Así el enlace del correo de confirmación de cuenta abre la app y no `localhost`.

## Desarrollo local

```bash
npm i -g vercel
vercel dev   # sirve la app y la función en http://localhost:3000
```
