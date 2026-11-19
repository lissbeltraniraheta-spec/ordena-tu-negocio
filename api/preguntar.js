// Responde preguntas del dueño sobre su negocio usando sus propios datos.
// Usa el token de la persona: Supabase aplica las reglas de seguridad y solo se leen sus negocios.
// Límite: PREGUNTAS_POR_DIA por negocio (día de El Salvador).

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zjqogeateqsgortmswbt.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_6-XSGhoGL2aKdZkxnxOG7Q_1WjLTijN";
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const GEMINI_RESPALDO = (process.env.GEMINI_MODEL_RESPALDO || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);
const PREGUNTAS_POR_DIA = Number(process.env.PREGUNTAS_POR_DIA || 5);
const LIMITE_TOTAL_MS = 50000;
const LIMITE_LLAMADA_MS = 20000;
const OFFSET_SV = -6; // El Salvador: UTC-6 todo el año

const NOMBRES = { contado: "venta al contado", fiado: "venta al crédito", abono: "abono de cliente", gasto: "gasto", retiro: "retiro del dueño",
  compra: "compra al contado", compra_credito: "compra al crédito", pago_compra: "pago a proveedor" };

const h = (token, extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...extra });
const r2 = (n) => Math.round(n * 100) / 100;
const fechaSV = (d = new Date()) => new Date(d.getTime() + OFFSET_SV * 3600000).toISOString().slice(0, 10);
const masDias = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function leer(token, ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: h(token) });
  if (r.status === 401) { const e = new Error("Su sesión venció. Entre de nuevo."); e.status = 401; throw e; }
  if (!r.ok) throw new Error("No se pudieron leer los datos del negocio. Intente de nuevo.");
  return r.json();
}

async function llamarGemini(payload, inicio) {
  const modelos = [...new Set([GEMINI_MODEL, ...GEMINI_RESPALDO])];
  let ultimo = { status: 0, msg: "" };
  for (const modelo of [...modelos, ...modelos]) {
    const restante = LIMITE_TOTAL_MS - (Date.now() - inicio);
    if (restante < 6000) break;
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), Math.min(LIMITE_LLAMADA_MS, restante));
    let gr, gj;
    try {
      gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify(payload), signal: corte.signal,
      });
      gj = await gr.json().catch(() => ({}));
    } catch (e) {
      gr = { ok: false, status: 0 }; gj = { error: { message: corte.signal.aborted ? "tardó demasiado" : String(e?.message || e) } };
    } finally { clearTimeout(reloj); }
    if (gr.ok) return gj;
    ultimo = { status: gr.status, msg: gj?.error?.message || `Gemini respondió ${gr.status}` };
    console.warn(`[gemini] preguntar modelo=${modelo} status=${gr.status} ${ultimo.msg.slice(0, 200)}`);
    if ([0, 429, 500, 502, 503, 504].includes(gr.status)) continue;
    if ([400, 403, 404].includes(gr.status) && /model|available|not found|supported/i.test(ultimo.msg)) continue;
    break;
  }
  throw new Error("La IA está muy ocupada en este momento. Espere un minuto y pregunte de nuevo. Esta pregunta no se contó.");
}

// Resumen de los datos del negocio que se le pasa a la IA
function armarDatos(negocio, movs, viejas, saldos, mensual, hoy) {
  const tot = (lista) => { const t = {}; for (const m of lista) t[m.tipo] = r2((t[m.tipo] || 0) + Number(m.monto)); return t; };
  const entre = (a, b) => movs.filter((m) => m.fecha >= a && m.fecha <= b);
  const dia = new Date(hoy + "T12:00:00Z").getUTCDay(); // 0 domingo
  const lunes = masDias(hoy, -((dia + 6) % 7));
  const iniMes = hoy.slice(0, 8) + "01";
  const iniMesPasado = (() => { const d = new Date(iniMes + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const finMesPasado = masDias(iniMes, -1);
  const periodos = {
    hoy: tot(entre(hoy, hoy)),
    ayer: tot(entre(masDias(hoy, -1), masDias(hoy, -1))),
    esta_semana_desde_lunes: tot(entre(lunes, hoy)),
    semana_pasada: tot(entre(masDias(lunes, -7), masDias(lunes, -1))),
    este_mes_hasta_hoy: tot(entre(iniMes, hoy)),
    mes_pasado_completo: tot(entre(iniMesPasado, finMesPasado)),
    ultimos_90_dias: tot(movs),
  };
  const porMes = {};
  for (const r of mensual) { const k = String(r.mes).slice(0, 7); (porMes[k] ||= {})[r.tipo] = Number(r.total); }
  // Compras al crédito sin pagar
  const todas = [...viejas, ...movs];
  const pagadas = new Set(todas.filter((m) => m.paga_id).map((m) => m.paga_id));
  const porPagar = todas.filter((m) => m.tipo === "compra_credito" && !pagadas.has(m.id))
    .map((m) => ({ compra: m.descripcion, monto: Number(m.monto), fecha: m.fecha, vence: m.vence || masDias(m.fecha, 30) }));
  const deben = saldos.filter((c) => Number(c.saldo) > 0).sort((a, b) => b.saldo - a.saldo)
    .map((c) => ({ cliente: c.nombre, debe: Number(c.saldo), primera_compra_al_credito: c.primer_fiado, ultimo_abono: c.ultimo_abono }));
  const nombreCliente = new Map(saldos.map((c) => [c.id, c.nombre]));
  const detalle = movs.slice(-1500).map((m) => [m.fecha, NOMBRES[m.tipo] || m.tipo, m.descripcion.replace(/[|\n]/g, " "), Number(m.monto).toFixed(2),
    m.cliente_id ? nombreCliente.get(m.cliente_id) || "" : "", m.vence || ""].join(" | "));
  return [
    `Negocio: ${negocio.nombre}. Hoy es ${hoy}. Efectivo con que abre la caja cada día: $${Number(negocio.efectivo_inicial || 0).toFixed(2)}.`,
    `Nombres de los tipos: ${JSON.stringify(NOMBRES)}`,
    `TOTALES POR PERIODO (ya calculados, úselos tal cual): ${JSON.stringify(periodos)}`,
    `TOTALES POR MES, últimos 12 meses: ${JSON.stringify(porMes)}`,
    `CLIENTES QUE DEBEN (saldo de ventas al crédito menos abonos): ${JSON.stringify(deben)}`,
    `COMPRAS AL CRÉDITO SIN PAGAR A PROVEEDORES: ${JSON.stringify(porPagar)}`,
    `MOVIMIENTOS DE LOS ÚLTIMOS 90 DÍAS (fecha | tipo | descripción | monto | cliente | fecha para pagar):`,
    detalle.join("\n") || "(ninguno)",
  ].join("\n\n");
}

const INSTRUCCIONES = `Usted es el asistente de "Ordena tu Negocio", una app para negocios pequeños de El Salvador.
Responda la pregunta del dueño usando SOLO los datos que vienen abajo. Reglas:
- Español sencillo de El Salvador, tratando de "usted". Respuesta corta: de 1 a 6 frases o una lista corta.
- Montos en dólares con 2 decimales, por ejemplo $12.00.
- Use los totales ya calculados cuando sirvan. Si tiene que sumar, sume con cuidado. No invente números.
- Si los datos no alcanzan para responder, dígalo con claridad y sugiera qué anotar en la app.
- Diga "venta al crédito", nunca "fiado".
- Puede dar un consejo práctico al final si ayuda, en una frase.
- No hable de temas que no sean de este negocio. No dé asesoría legal ni de impuestos; sugiera consultar a un contador.
- Texto plano, sin tablas ni markdown (puede usar guiones al inicio de línea para listas).`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!GEMINI_KEY) return res.status(500).json({ error: "Falta configurar la IA. Avise al soporte." });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Inicie sesión de nuevo." });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const negocioId = body?.negocio_id;
  const pregunta = String(body?.pregunta || "").trim().slice(0, 300);
  if (!negocioId || !/^[0-9a-f-]{36}$/i.test(negocioId)) return res.status(400).json({ error: "Falta el negocio." });
  if (pregunta.length < 3) return res.status(400).json({ error: "Escriba su pregunta." });

  const inicio = Date.now();
  try {
    const [negocio] = await leer(token, `negocios?id=eq.${negocioId}&select=id,nombre,efectivo_inicial`);
    if (!negocio) return res.status(404).json({ error: "No se encontró ese negocio." });

    // Límite diario
    const hoy = fechaSV();
    const desdeUTC = new Date(`${hoy}T00:00:00Z`).getTime() - OFFSET_SV * 3600000;
    const hechas = await leer(token, `preguntas_ia?negocio_id=eq.${negocioId}&created_at=gte.${new Date(desdeUTC).toISOString()}&select=id`);
    if (hechas.length >= PREGUNTAS_POR_DIA) {
      return res.status(429).json({ error: `Ya usó sus ${PREGUNTAS_POR_DIA} preguntas de hoy. Mañana puede hacer ${PREGUNTAS_POR_DIA} más.`, quedan: 0 });
    }

    const desde = masDias(hoy, -89), desdeMes = masDias(hoy, -400).slice(0, 8) + "01";
    const [movs, saldos, mensual, viejasPorPagar] = await Promise.all([
      leer(token, `movimientos?negocio_id=eq.${negocioId}&fecha=gte.${desde}&select=id,fecha,tipo,descripcion,monto,cliente_id,vence,paga_id&order=fecha.desc,hora.desc&limit=5000`).then((l) => l.reverse()),
      leer(token, `saldos_clientes?negocio_id=eq.${negocioId}&select=id,nombre,saldo,primer_fiado,ultimo_abono`),
      leer(token, `resumen_mensual?negocio_id=eq.${negocioId}&mes=gte.${desdeMes}&select=mes,tipo,total`),
      // Compras al crédito y pagos más viejos que 90 días, para no olvidar deudas con proveedores
      leer(token, `movimientos?negocio_id=eq.${negocioId}&fecha=lt.${desde}&tipo=in.(compra_credito,pago_compra)&select=id,fecha,tipo,descripcion,monto,cliente_id,vence,paga_id&limit=2000`),
    ]);
    const datos = armarDatos(negocio, movs, viejasPorPagar, saldos, mensual, hoy);
    const gj = await llamarGemini({
      systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
      contents: [{ role: "user", parts: [{ text: `DATOS DEL NEGOCIO:\n${datos}\n\nPREGUNTA DEL DUEÑO: ${pregunta}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    }, inicio);
    const respuesta = (gj?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim()
      .replace(/\*\*(.+?)\*\*/g, "$1").slice(0, 3000);
    if (!respuesta) throw new Error("La IA no dio una respuesta. Pregunte de nuevo con otras palabras. Esta pregunta no se contó.");

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/preguntas_ia`, {
      method: "POST", headers: h(token, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ negocio_id: negocioId, pregunta, respuesta }),
    });
    if (!ins.ok) console.warn("[preguntar] no se guardó la pregunta", ins.status);
    return res.status(200).json({ respuesta, quedan: Math.max(0, PREGUNTAS_POR_DIA - hechas.length - 1) });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
