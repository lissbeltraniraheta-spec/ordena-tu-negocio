// Lee una foto del cuaderno o una nota de voz con Gemini y devuelve los movimientos encontrados.
// La persona que llama debe haber iniciado sesión: se usa su token, así Supabase aplica
// las reglas de seguridad y nadie puede procesar archivos de otro negocio.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zjqogeateqsgortmswbt.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_6-XSGhoGL2aKdZkxnxOG7Q_1WjLTijN";
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS = ["contado", "fiado", "abono", "gasto", "retiro"];

// Formatos que Gemini acepta tal cual; los demás se traducen al más cercano.
const MIME_GEMINI = {
  "audio/opus": "audio/ogg",
  "application/ogg": "audio/ogg",
  "audio/x-wav": "audio/wav",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/mpeg": "audio/mp3",
};

function sbHeaders(token, extra = {}) {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...extra };
}

async function actualizarCaptura(token, id, datos) {
  await fetch(`${SUPABASE_URL}/rest/v1/capturas?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: sbHeaders(token, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(datos),
  }).catch(() => {});
}

function instrucciones(tipo, clientes) {
  const fuente = tipo === "foto"
    ? "La imagen es una foto de una página del cuaderno de ventas de un negocio pequeño en El Salvador (ferretería, tienda, depósito u otro)."
    : "El audio es una nota de voz del dueño de un negocio pequeño en El Salvador contando lo que vendió, cobró o gastó.";
  return `${fuente}

${tipo === "audio" ? "Primero transcribe el audio completo en español, tal como se dijo.\n" : ""}Convierte cada venta, abono, gasto o retiro en un movimiento. Los montos son en dólares (US$).
Tipos:
- "contado": venta pagada al momento.
- "fiado": venta al crédito, fiada o apuntada a un cliente.
- "abono": un cliente paga parte o todo lo que debe.
- "gasto": pago del negocio (flete, luz, agua, compra de mercadería, sueldo).
- "retiro": dinero que el dueño saca para su casa o uso personal.
Clientes conocidos del negocio: ${clientes.length ? clientes.join(", ") : "(ninguno todavía)"}.
Si el nombre de un cliente coincide con uno conocido, usa ese nombre exacto; si es otro, escríbelo como aparece.
Si en una línea no se distingue el monto, no la incluyas y explícalo en "nota".
Si ${tipo === "foto" ? "la imagen no es un cuaderno o lista de ventas" : "el audio no habla de ventas o pagos"}, devuelve "lineas" vacío y dilo en "nota".
Responde solo con JSON con esta forma:
{"transcripcion": ${tipo === "audio" ? '"texto del audio"' : "null"}, "lineas": [{"tipo": "fiado", "descripcion": "Cemento 2 bolsas", "monto": 19, "cliente": "Doña Rosa"}], "nota": ""}
"cliente" es null en contado, gasto y retiro. "nota" es una frase corta en español o vacía.`;
}

function limpiarResultado(r) {
  const lineas = Array.isArray(r?.lineas) ? r.lineas : [];
  return {
    transcripcion: typeof r?.transcripcion === "string" ? r.transcripcion.slice(0, 4000) : null,
    nota: typeof r?.nota === "string" ? r.nota.slice(0, 300) : "",
    lineas: lineas.slice(0, 60).map((l) => {
      const tipo = TIPOS.includes(l?.tipo) ? l.tipo : "contado";
      const monto = Math.round(Number(String(l?.monto ?? "").replace(/[^0-9.]/g, "")) * 100) / 100;
      const cliente = (tipo === "fiado" || tipo === "abono") ? String(l?.cliente || "").slice(0, 80) || null : null;
      return { tipo, monto, descripcion: String(l?.descripcion || l?.desc || "Movimiento").slice(0, 120), cliente };
    }).filter((l) => l.monto > 0),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!GEMINI_KEY) return res.status(500).json({ error: "Falta configurar GEMINI_API_KEY en Vercel." });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Inicie sesión de nuevo." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = body?.captura_id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Falta la captura." });

  try {
    // 1. La captura (solo se encuentra si es de un negocio de esta persona)
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/capturas?id=eq.${id}&select=id,negocio_id,tipo,archivo_path,mime`, { headers: sbHeaders(token) });
    if (cr.status === 401) return res.status(401).json({ error: "Su sesión venció. Entre de nuevo." });
    const [captura] = await cr.json();
    if (!captura) return res.status(404).json({ error: "No se encontró esa foto o audio." });

    // 2. Nombres de clientes del negocio, para que la IA los reconozca
    const cl = await fetch(`${SUPABASE_URL}/rest/v1/clientes?negocio_id=eq.${captura.negocio_id}&select=nombre&order=nombre`, { headers: sbHeaders(token) });
    const clientes = cl.ok ? (await cl.json()).map((c) => c.nombre).slice(0, 200) : [];

    // 3. El archivo
    const path = captura.archivo_path.split("/").map(encodeURIComponent).join("/");
    const fr = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/capturas/${path}`, { headers: sbHeaders(token) });
    if (!fr.ok) throw new Error("No se pudo descargar el archivo.");
    const buf = Buffer.from(await fr.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("El archivo es muy grande (máximo 15 MB).");
    const mimeOriginal = (captura.mime || fr.headers.get("content-type") || "").split(";")[0].trim();
    const mime = MIME_GEMINI[mimeOriginal] || mimeOriginal || (captura.tipo === "foto" ? "image/jpeg" : "audio/ogg");

    // 4. Gemini
    const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: instrucciones(captura.tipo, clientes) },
          { inline_data: { mime_type: mime, data: buf.toString("base64") } },
        ] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    });
    const gj = await gr.json().catch(() => ({}));
    if (!gr.ok) {
      const msg = gj?.error?.message || `Gemini respondió ${gr.status}`;
      throw new Error(gr.status === 429 ? "Se alcanzó el límite de uso de Gemini. Intente en un momento." : `La IA no pudo leer el archivo: ${msg}`);
    }
    const texto = (gj?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    let crudo;
    try { crudo = JSON.parse(texto); } catch {
      const m = texto.match(/\{[\s\S]*\}/);
      crudo = m ? JSON.parse(m[0]) : null;
    }
    if (!crudo) throw new Error("La IA respondió algo que no se entendió. Intente de nuevo.");
    const resultado = limpiarResultado(crudo);

    await actualizarCaptura(token, id, { estado: "procesada", transcripcion: resultado.transcripcion, resultado, error: null });
    return res.status(200).json(resultado);
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 300);
    await actualizarCaptura(token, id, { estado: "error", error: msg });
    return res.status(502).json({ error: msg });
  }
}
