/* Ordena tu Negocio — lógica de la app (sin build: se sirve tal cual en Vercel) */
(function () {
"use strict";

const CFG = window.ORDENA_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
const TIPOS = { contado: "Contado", fiado: "Fiado", abono: "Abono", gasto: "Gasto", retiro: "Retiro dueño" };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_C = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(don|dona|sr|sra|senor|senora)\b\.?/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

function hoyLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CFG.zonaHoraria, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function partes(f) { const [y, m, d] = f.split("-").map(Number); return { y, m, d }; }
function fechaLarga(f) { const { y, m, d } = partes(f); const dt = new Date(y, m - 1, d); return `${DIAS[dt.getDay()]} ${d} de ${MESES[m - 1]}`; }
function diasEntre(a, b) { const pa = partes(a), pb = partes(b); return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000); }
function rangoMes(f) { const { y, m } = partes(f); const last = new Date(y, m, 0).getDate(); const mm = String(m).padStart(2, "0"); return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`]; }
function setSt(id, t, tipo) { const el = $(id); el.textContent = t || ""; el.classList.toggle("err", tipo === "err"); el.classList.toggle("ok", tipo === "ok"); }
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), 2600); }
function guardarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
function leerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); })); }

/* ---------- estado ---------- */
const S = { user: null, negocios: [], negocio: null, fecha: hoyLocal(), movs: [], saldos: [], pendientes: null, grabando: null };

/* ---------- vistas principales ---------- */
function mostrarPantalla(nombre) {
  $("v-auth").hidden = nombre !== "auth";
  $("v-setup").hidden = nombre !== "setup";
  $("v-app").hidden = nombre !== "app";
}

/* ---------- sesión ---------- */
function traducirError(e) {
  const m = String(e?.message || e || "");
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/Email not confirmed/i.test(m)) return "Confirme su correo primero: revise su bandeja de entrada.";
  if (/already registered/i.test(m)) return "Ya existe una cuenta con ese correo. Use Entrar.";
  if (/Password should be/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
  if (/rate limit/i.test(m)) return "Demasiados intentos. Espere unos minutos.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revise el internet e intente de nuevo.";
  return m || "Algo falló. Intente de nuevo.";
}

$("f-auth").addEventListener("submit", async (e) => {
  e.preventDefault();
  setSt("au-st", "Entrando...");
  const { error } = await sb.auth.signInWithPassword({ email: $("au-email").value.trim(), password: $("au-pass").value });
  if (error) setSt("au-st", traducirError(error), "err");
});
$("au-crear").addEventListener("click", async () => {
  const email = $("au-email").value.trim(), password = $("au-pass").value;
  if (!$("au-email").checkValidity() || password.length < 6) { setSt("au-st", "Escriba su correo y una contraseña de al menos 6 caracteres.", "err"); return; }
  setSt("au-st", "Creando la cuenta...");
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) { setSt("au-st", traducirError(error), "err"); return; }
  if (!data.session) setSt("au-st", "Listo. Le enviamos un correo para confirmar la cuenta. Ábralo y después entre aquí.", "ok");
});
$("b-salir").addEventListener("click", async () => { await sb.auth.signOut(); });

sb.auth.onAuthStateChange((evento, session) => {
  const nuevo = session?.user || null;
  if (nuevo?.id === S.user?.id && evento !== "SIGNED_OUT") return;
  S.user = nuevo;
  if (!nuevo) { S.negocios = []; S.negocio = null; mostrarPantalla("auth"); return; }
  setTimeout(cargarNegocios, 0);
});

/* ---------- negocios ---------- */
async function cargarNegocios() {
  const { data, error } = await sb.from("negocios").select("*").order("created_at");
  if (error) { toast(traducirError(error)); return; }
  S.negocios = data || [];
  if (!S.negocios.length) { $("ng-cancelar").hidden = true; mostrarPantalla("setup"); return; }
  const guardado = leerLocal("ordena:negocio");
  S.negocio = S.negocios.find((n) => n.id === guardado) || S.negocios[0];
  pintarSelectorNegocio();
  mostrarPantalla("app");
  $("sel-fecha").value = S.fecha;
  $("sel-fecha").max = hoyLocal();
  await cargarTodo();
  mostrarTab();
}
function pintarSelectorNegocio() {
  $("sel-negocio").innerHTML = S.negocios.map((n) => `<option value="${n.id}">${esc(n.nombre)}</option>`).join("")
    + `<option value="__nuevo">+ Agregar otro negocio</option>`;
  $("sel-negocio").value = S.negocio.id;
}
$("sel-negocio").addEventListener("change", async (e) => {
  if (e.target.value === "__nuevo") {
    e.target.value = S.negocio.id;
    $("ng-cancelar").hidden = false; $("f-negocio").reset(); mostrarPantalla("setup"); return;
  }
  S.negocio = S.negocios.find((n) => n.id === e.target.value);
  guardarLocal("ordena:negocio", S.negocio.id);
  cerrarRevision();
  await cargarTodo(); mostrarTab();
});
$("ng-cancelar").addEventListener("click", () => mostrarPantalla("app"));
$("f-negocio").addEventListener("submit", async (e) => {
  e.preventDefault();
  setSt("ng-st", "Guardando...");
  const { data, error } = await sb.from("negocios")
    .insert({ nombre: $("ng-nombre").value.trim(), efectivo_inicial: Number($("ng-caja").value) || 0 })
    .select().single();
  if (error) { setSt("ng-st", traducirError(error), "err"); return; }
  setSt("ng-st", "");
  S.negocios.push(data); S.negocio = data; guardarLocal("ordena:negocio", data.id);
  pintarSelectorNegocio(); mostrarPantalla("app");
  $("sel-fecha").value = S.fecha;
  await cargarTodo(); mostrarTab();
});

/* ---------- fecha ---------- */
$("sel-fecha").addEventListener("change", async (e) => {
  if (!e.target.value) { e.target.value = S.fecha; return; }
  S.fecha = e.target.value;
  await cargarTodo(); mostrarTab();
});

/* ---------- carga de datos ---------- */
async function cargarTodo() { await Promise.all([cargarDia(), cargarSaldos()]); pintarHoy(); pintarFiados(); }
async function cargarDia() {
  const { data, error } = await sb.from("movimientos")
    .select("id,fecha,hora,tipo,descripcion,monto,cliente_id,origen,clientes(nombre)")
    .eq("negocio_id", S.negocio.id).eq("fecha", S.fecha)
    .order("hora").order("created_at");
  if (error) { toast(traducirError(error)); S.movs = []; return; }
  S.movs = data || [];
}
async function cargarSaldos() {
  const { data, error } = await sb.from("saldos_clientes").select("*").eq("negocio_id", S.negocio.id).order("nombre");
  if (error) { toast(traducirError(error)); S.saldos = []; return; }
  S.saldos = data || [];
  $("dl-clientes").innerHTML = S.saldos.map((c) => `<option value="${esc(c.nombre)}"></option>`).join("");
}
function totales(lista) {
  const t = { contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0 };
  (lista || S.movs).forEach((m) => { t[m.tipo] += Number(m.monto); });
  return t;
}

/* ---------- Ventas del día ---------- */
function pintarHoy() {
  const t = totales();
  $("k-vendido").textContent = money(t.contado + t.fiado);
  $("k-contado").textContent = money(t.contado);
  $("k-fiado").textContent = money(t.fiado);
  $("k-abonos").textContent = money(t.abono);
  $("t-movs").textContent = S.fecha === hoyLocal() ? "Movimientos de hoy" : "Movimientos del " + fechaLarga(S.fecha);
  $("n-movs").textContent = S.movs.length ? S.movs.length + " anotados" : "";
  $("movs-vacio").hidden = S.movs.length > 0;
  $("movs").innerHTML = S.movs.slice().reverse().map((m) => {
    const neg = m.tipo === "gasto" || m.tipo === "retiro" ? "−" : "";
    const origen = m.origen === "foto" ? " · foto" : m.origen === "audio" ? " · audio" : "";
    return `<li class="${m._nuevo ? "new" : ""}"><span class="chip c-${m.tipo}">${TIPOS[m.tipo]}</span>
      <span class="desc">${esc(m.descripcion)}<small class="num">${String(m.hora).slice(0, 5)}${m.clientes ? " · " + esc(m.clientes.nombre) : ""}${origen}</small></span>
      <span class="amt">${neg}${money(m.monto)}</span>
      <button class="del" type="button" data-borrar="${m.id}" aria-label="Borrar ${esc(m.descripcion)}">×</button></li>`;
  }).join("");
}
$("movs").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-borrar]"); if (!b) return;
  if (!b.classList.contains("confirm")) {
    document.querySelectorAll(".del.confirm").forEach((x) => { x.classList.remove("confirm"); x.textContent = "×"; });
    b.classList.add("confirm"); b.textContent = "Borrar"; return;
  }
  b.disabled = true;
  const { error } = await sb.from("movimientos").delete().eq("id", b.dataset.borrar);
  if (error) { toast(traducirError(error)); b.disabled = false; return; }
  toast("Movimiento borrado");
  await cargarTodo();
});

async function resolverCliente(nombre) {
  const limpio = String(nombre || "").trim().slice(0, 80);
  if (!limpio) return null;
  const n = norm(limpio);
  const hit = S.saldos.find((c) => norm(c.nombre) === n)
    || S.saldos.find((c) => { const cn = norm(c.nombre); return n.length > 2 && (cn.includes(n) || n.includes(cn)); });
  if (hit) return hit.id;
  const { data, error } = await sb.from("clientes").insert({ negocio_id: S.negocio.id, nombre: limpio }).select("id,nombre").single();
  if (error) throw error;
  S.saldos.push({ id: data.id, nombre: data.nombre, saldo: 0 });
  return data.id;
}

$("a-tipo").addEventListener("change", () => { const t = $("a-tipo").value; $("l-cliente").hidden = !(t === "fiado" || t === "abono"); });
$("f-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tipo = $("a-tipo").value, monto = Math.round(parseFloat($("a-monto").value) * 100) / 100, descripcion = $("a-desc").value.trim();
  if (!descripcion || !(monto > 0)) return;
  try {
    let cliente_id = null;
    if (tipo === "fiado" || tipo === "abono") {
      if (!$("a-cliente").value.trim()) { toast("Escriba el nombre del cliente"); $("a-cliente").focus(); return; }
      cliente_id = await resolverCliente($("a-cliente").value);
    }
    const { error } = await sb.from("movimientos").insert({ negocio_id: S.negocio.id, fecha: S.fecha, tipo, descripcion, monto, cliente_id, origen: "manual" });
    if (error) throw error;
    $("a-desc").value = ""; $("a-monto").value = ""; $("a-cliente").value = "";
    toast("Anotado: " + TIPOS[tipo] + " " + money(monto));
    await cargarTodo();
  } catch (err) { toast(traducirError(err)); }
});

/* ---------- Fotos ---------- */
async function comprimirImagen(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, mime: file.type || "image/jpeg", ext: (file.name.split(".").pop() || "jpg").toLowerCase() };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const max = 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob ? { blob, mime: "image/jpeg", ext: "jpg" } : { blob: file, mime: file.type, ext: "jpg" };
  } catch (e) { return { blob: file, mime: file.type || "image/jpeg", ext: "jpg" }; }
}

$("in-foto").addEventListener("change", async () => {
  const f = $("in-foto").files[0]; $("in-foto").value = "";
  if (!f) return;
  const img = $("foto-prev");
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(f); img.src = img.dataset.url; img.hidden = false;
  const prep = await comprimirImagen(f);
  await subirYProcesar("foto", prep, "st-foto");
});

/* ---------- Audios ---------- */
function codificarWav(buffer) {
  const datos = buffer.getChannelData(0), rate = buffer.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + datos.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); out.setUint32(4, 36 + datos.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, "data"); out.setUint32(40, datos.length * 2, true);
  for (let i = 0, o = 44; i < datos.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, datos[i])); out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([out], { type: "audio/wav" });
}
// Pasa cualquier audio (WhatsApp .opus, .m4a, grabación del navegador) a WAV de 16 kHz, que Gemini entiende siempre.
async function prepararAudio(blob, nombre) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const dec = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close && ctx.close();
    if (dec.duration > 600) throw Object.assign(new Error("largo"), { largo: true });
    const off = new OfflineAudioContext(1, Math.ceil(dec.duration * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
    const rend = await off.startRendering();
    return { blob: codificarWav(rend), mime: "audio/wav", ext: "wav" };
  } catch (e) {
    if (e.largo) throw new Error("El audio dura más de 10 minutos. Mande uno más corto.");
    const ext = ((nombre || "").split(".").pop() || "ogg").toLowerCase();
    const porExt = { opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", amr: "audio/amr", webm: "audio/webm" };
    return { blob, mime: (blob.type || porExt[ext] || "audio/ogg").split(";")[0], ext };
  }
}
function mostrarAudio(blob) {
  const a = $("aud");
  if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
  a.dataset.url = URL.createObjectURL(blob); a.src = a.dataset.url; a.hidden = false;
}
$("in-audio").addEventListener("change", async () => {
  const f = $("in-audio").files[0]; $("in-audio").value = "";
  if (!f) return;
  mostrarAudio(f);
  setSt("st-audio", "Preparando el audio...");
  try { await subirYProcesar("audio", await prepararAudio(f, f.name), "st-audio"); }
  catch (e) { setSt("st-audio", e.message, "err"); }
});

$("b-grabar").addEventListener("click", async () => {
  if (S.grabando) { S.grabando.rec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setSt("st-audio", "Este navegador no permite grabar. Use \"Subir audio\".", "err"); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { setSt("st-audio", "No se dio permiso al micrófono. Actívelo en el navegador o use \"Subir audio\".", "err"); return; }
  const trozos = [];
  const rec = new MediaRecorder(stream);
  const inicio = Date.now();
  const b = $("b-grabar"); b.classList.add("rec");
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - inicio) / 1000);
    b.textContent = `Detener (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`;
    if (s >= 300) rec.stop();
  }, 250);
  S.grabando = { rec };
  b.textContent = "Detener (0:00)";
  setSt("st-audio", "Grabando... hable con calma: qué vendió, a quién y cuánto.");
  rec.ondataavailable = (ev) => { if (ev.data.size) trozos.push(ev.data); };
  rec.onstop = async () => {
    clearInterval(tick); stream.getTracks().forEach((t) => t.stop());
    S.grabando = null; b.classList.remove("rec"); b.textContent = "Grabar audio";
    const blob = new Blob(trozos, { type: rec.mimeType || "audio/webm" });
    if (blob.size < 1000) { setSt("st-audio", "La grabación quedó vacía. Intente de nuevo.", "err"); return; }
    mostrarAudio(blob);
    setSt("st-audio", "Preparando el audio...");
    try { await subirYProcesar("audio", await prepararAudio(blob, "grabacion.webm"), "st-audio"); }
    catch (e) { setSt("st-audio", e.message, "err"); }
  };
  rec.start(1000);
});

/* ---------- Subir y leer con IA ---------- */
async function subirYProcesar(tipo, prep, stId) {
  const btns = [$("b-grabar"), $("in-foto"), $("in-audio")];
  btns.forEach((x) => (x.disabled = true));
  try {
    setSt(stId, tipo === "foto" ? "Subiendo la foto..." : "Subiendo el audio...");
    const path = `${S.negocio.id}/${S.fecha}/${uuid()}.${prep.ext}`;
    const up = await sb.storage.from("capturas").upload(path, prep.blob, { contentType: prep.mime, upsert: false });
    if (up.error) throw up.error;
    const { data: cap, error } = await sb.from("capturas").insert({ negocio_id: S.negocio.id, tipo, archivo_path: path, mime: prep.mime }).select("id").single();
    if (error) throw error;

    setSt(stId, tipo === "foto" ? "La IA está leyendo la foto... (10 a 30 segundos)" : "La IA está escuchando el audio... (10 a 30 segundos)");
    const { data: ses } = await sb.auth.getSession();
    const r = await fetch("/api/procesar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ses.session?.access_token}` },
      body: JSON.stringify({ captura_id: cap.id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "No se pudo leer. Intente de nuevo.");
    setSt(stId, "");
    mostrarRevision(j, tipo, cap.id);
  } catch (e) {
    setSt(stId, traducirError(e), "err");
  } finally {
    btns.forEach((x) => (x.disabled = false));
  }
}

/* ---------- Revisión editable ---------- */
function filaRevision(l, i) {
  const conCliente = l.tipo === "fiado" || l.tipo === "abono";
  return `<div class="rev-item" data-i="${i}">
    <input type="checkbox" checked aria-label="Incluir esta línea" data-k="ok">
    <div class="rev-fields">
      <label class="full">Qué fue<input data-k="descripcion" maxlength="120" value="${esc(l.descripcion)}"></label>
      <label>Tipo<select data-k="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === l.tipo ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Monto (US$)<input data-k="monto" type="number" min="0.01" step="0.01" inputmode="decimal" value="${l.monto}"></label>
      <label class="full" data-cliente${conCliente ? "" : " hidden"}>Cliente<input data-k="cliente" list="dl-clientes" maxlength="80" value="${esc(l.cliente || "")}"></label>
    </div>
  </div>`;
}
function mostrarRevision(res, tipo, capturaId) {
  S.pendientes = { tipo, capturaId };
  const n = res.lineas.length;
  $("rev-origen").textContent = tipo === "foto" ? "Leído de la foto con IA" : "Escuchado del audio con IA";
  $("rev-nota").textContent = (n ? `Se encontraron ${n} movimientos para el ${fechaLarga(S.fecha)}. Corrija lo que haga falta y quite la marca a lo que no va.` : "No se encontraron movimientos para anotar.") + (res.nota ? " " + res.nota : "");
  $("rev-trans").hidden = !res.transcripcion;
  $("rev-trans").textContent = res.transcripcion ? `"${res.transcripcion}"` : "";
  $("rev-list").innerHTML = res.lineas.map(filaRevision).join("");
  $("b-rev-ok").hidden = !n;
  $("p-rev").hidden = false;
  $("p-rev").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
function cerrarRevision() { S.pendientes = null; $("p-rev").hidden = true; $("rev-list").innerHTML = ""; }
$("rev-list").addEventListener("change", (e) => {
  const item = e.target.closest(".rev-item"); if (!item) return;
  if (e.target.dataset.k === "ok") item.classList.toggle("off", !e.target.checked);
  if (e.target.dataset.k === "tipo") { const t = e.target.value; item.querySelector("[data-cliente]").hidden = !(t === "fiado" || t === "abono"); }
});
$("b-rev-no").addEventListener("click", cerrarRevision);
$("b-rev-ok").addEventListener("click", async () => {
  const b = $("b-rev-ok"); b.disabled = true;
  try {
    const filas = [];
    for (const item of $("rev-list").querySelectorAll(".rev-item")) {
      const v = (k) => item.querySelector(`[data-k="${k}"]`);
      if (!v("ok").checked) continue;
      const tipo = v("tipo").value, monto = Math.round(parseFloat(v("monto").value) * 100) / 100, descripcion = v("descripcion").value.trim();
      if (!descripcion || !(monto > 0)) { toast("Revise que cada línea tenga descripción y monto"); v("monto").focus(); b.disabled = false; return; }
      let cliente_id = null;
      if (tipo === "fiado" || tipo === "abono") cliente_id = await resolverCliente(v("cliente").value || "Cliente sin nombre");
      filas.push({ negocio_id: S.negocio.id, fecha: S.fecha, tipo, descripcion, monto, cliente_id, origen: S.pendientes.tipo, captura_id: S.pendientes.capturaId });
    }
    if (filas.length) { const { error } = await sb.from("movimientos").insert(filas); if (error) throw error; }
    toast(filas.length === 1 ? "1 movimiento guardado" : `${filas.length} movimientos guardados`);
    cerrarRevision(); $("foto-prev").hidden = true; $("aud").hidden = true;
    await cargarTodo();
  } catch (e) { toast(traducirError(e)); }
  finally { b.disabled = false; }
});

/* ---------- Fiados ---------- */
function estadoCliente(c) {
  if (Number(c.saldo) <= 0) return ["Al día", "estado-ok", 0];
  const ref = c.ultimo_abono || c.primer_fiado;
  const d = ref ? diasEntre(ref, hoyLocal()) : 0;
  if (d >= 30) return [`${d} días sin abonar`, "estado-30", d];
  if (d >= 15) return [`${d} días sin abonar`, "estado-15", d];
  return [c.ultimo_abono ? `Abonó hace ${d} días` : `Fiado hace ${d} días`, "estado-ok", d];
}
function pintarFiados() {
  const con = S.saldos.filter((c) => Number(c.saldo) > 0);
  $("f-total").textContent = money(con.reduce((s, c) => s + Number(c.saldo), 0));
  $("f-n").textContent = con.length;
  $("f-30").textContent = money(con.filter((c) => estadoCliente(c)[2] >= 30).reduce((s, c) => s + Number(c.saldo), 0));
  $("f-hoy").textContent = money(totales().abono);
  const lista = S.saldos.slice().sort((a, b) => Number(b.saldo) - Number(a.saldo));
  $("cl-vacio").hidden = lista.length > 0;
  $("clientes").innerHTML = lista.map((c) => {
    const [txt, cls] = estadoCliente(c);
    return `<div class="cliente">
      <div><strong>${esc(c.nombre)}</strong>${c.telefono ? ` <span class="muted num">· ${esc(c.telefono)}</span>` : ""}<br><span class="chip ${cls}">${txt}</span></div>
      <div class="amt">${money(c.saldo)}</div>
      ${Number(c.saldo) > 0 ? `<div class="acts"><button class="btn small" type="button" data-cobro="${c.id}">Preparar mensaje de cobro</button></div>` : ""}
    </div>`;
  }).join("");
}
$("clientes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cobro]"); if (!b) return;
  const c = S.saldos.find((x) => x.id === b.dataset.cobro);
  const nombre = c.nombre.split(" ").slice(0, 2).join(" ");
  const txt = `Buenas, ${nombre}. Le saluda ${S.negocio.nombre}.\n\nLe compartimos su estado de cuenta al ${fechaLarga(hoyLocal())}:\nSaldo pendiente: ${money(c.saldo)}\n\nPuede abonar en el negocio o por transferencia, lo que le quede mejor. Muchas gracias por su preferencia.`;
  $("msg-title").textContent = "Mensaje de cobro para " + c.nombre;
  $("msg").textContent = txt;
  let tel = String(c.telefono || "").replace(/\D/g, "");
  if (tel.length === 8) tel = "503" + tel;
  $("b-wa").href = `https://wa.me/${tel}?text=${encodeURIComponent(txt)}`;
  $("p-msg").hidden = false;
  $("p-msg").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
});
$("b-copiar").addEventListener("click", () => {
  const txt = $("msg").textContent;
  const fallback = () => { const r = document.createRange(); r.selectNodeContents($("msg")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Texto seleccionado: cópielo"); };
  try { navigator.clipboard.writeText(txt).then(() => toast("Mensaje copiado"), fallback); } catch (e) { fallback(); }
});
$("f-cliente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("c-nombre").value.trim(); if (!nombre) return;
  const { error } = await sb.from("clientes").insert({ negocio_id: S.negocio.id, nombre, telefono: $("c-tel").value.trim() || null });
  if (error) { toast(traducirError(error)); return; }
  $("f-cliente").reset(); toast("Cliente agregado");
  await cargarSaldos(); pintarFiados();
});

/* ---------- Cierre de caja ---------- */
async function pintarCaja() {
  const t = totales();
  const inicial = Number(S.negocio.efectivo_inicial || 0);
  const esperado = inicial + t.contado + t.abono - t.gasto - t.retiro;
  S.esperado = esperado;
  $("t-caja").textContent = "Cierre de caja · " + fechaLarga(S.fecha);
  $("c-inicial").value = inicial;
  const filas = [["Efectivo con que se abrió", inicial], ["+ Ventas al contado", t.contado], ["+ Abonos de clientes", t.abono], ["− Gastos del negocio", -t.gasto], ["− Retiros del dueño", -t.retiro]];
  $("cuadre").innerHTML = filas.map(([a, b]) => `<tr><td>${a}</td><td>${b < 0 ? "−" + money(-b) : money(b)}</td></tr>`).join("")
    + `<tr class="total"><td>Debe haber en la gaveta</td><td>${money(esperado)}</td></tr>`;
  revisarCaja();

  const [desde] = rangoMes(S.fecha);
  const { data, error } = await sb.from("resumen_mensual").select("tipo,total").eq("negocio_id", S.negocio.id).eq("mes", desde);
  if (error) { toast(traducirError(error)); return; }
  const m = { contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0 };
  (data || []).forEach((r) => { m[r.tipo] = Number(r.total); });
  const { m: mes } = partes(S.fecha);
  $("t-mes").textContent = "Resumen de " + MESES[mes - 1];
  const entra = m.contado + m.abono, neto = entra - m.gasto;
  $("mes").innerHTML = [["Ventas (contado + fiado)", m.contado + m.fiado], ["Dinero que entró (contado + abonos)", entra], ["− Gastos del negocio", -m.gasto], ["− Retiros del dueño", -m.retiro]]
    .map(([a, b]) => `<tr><td>${a}</td><td>${b < 0 ? "−" + money(-b) : money(b)}</td></tr>`).join("")
    + `<tr class="total"><td>Queda para el negocio</td><td>${money(neto - m.retiro)}</td></tr>`;
  const box = $("m-msg");
  if (neto <= 0) { $("meter").innerHTML = ""; box.hidden = !(m.retiro > 0); box.className = "result bad"; box.textContent = "Este mes los gastos y retiros son mayores que lo que entró."; return; }
  const pct = Math.min(100, (m.retiro / neto) * 100);
  $("meter").innerHTML = `<span style="width:${pct}%;background:var(--bad)"></span><span style="width:${100 - pct}%;background:var(--accent)"></span>`;
  $("meter").setAttribute("aria-label", `Retiros ${Math.round(pct)}% de lo que quedó después de gastos`);
  box.hidden = false;
  if (m.retiro <= neto) { box.className = "result ok"; box.textContent = `El dueño se llevó el ${Math.round(pct)}% de lo que quedó después de gastos.`; }
  else { box.className = "result bad"; box.textContent = `El dueño sacó ${money0(m.retiro - neto)} más de lo que quedó: se está comiendo el capital.`; }
}
function revisarCaja() {
  const v = parseFloat($("c-real").value), r = $("c-res");
  if (isNaN(v)) { r.hidden = true; return; }
  const d = Math.round((v - S.esperado) * 100) / 100;
  r.hidden = false;
  if (Math.abs(d) < 0.01) { r.className = "result ok"; r.textContent = "La caja cuadra exacto."; }
  else if (d > 0) { r.className = "result ok"; r.textContent = `Sobran ${money(d)}. Revise si falta anotar alguna venta.`; }
  else { r.className = "result bad"; r.textContent = `Faltan ${money(-d)}. Revise fiados, gastos o retiros sin anotar.`; }
}
$("c-real").addEventListener("input", revisarCaja);
$("c-inicial").addEventListener("change", async (e) => {
  const v = Math.max(0, Number(e.target.value) || 0);
  const { error } = await sb.from("negocios").update({ efectivo_inicial: v }).eq("id", S.negocio.id);
  if (error) { toast(traducirError(error)); return; }
  S.negocio.efectivo_inicial = v; toast("Efectivo inicial guardado"); pintarCaja();
});

/* ---------- Fotos y audios guardados ---------- */
async function pintarArchivo() {
  const { data, error } = await sb.from("capturas").select("id,tipo,archivo_path,estado,transcripcion,resultado,error,created_at")
    .eq("negocio_id", S.negocio.id).order("created_at", { ascending: false }).limit(30);
  if (error) { toast(traducirError(error)); return; }
  const caps = data || [];
  $("cap-vacio").hidden = caps.length > 0;
  let urls = {};
  if (caps.length) {
    const { data: firm } = await sb.storage.from("capturas").createSignedUrls(caps.map((c) => c.archivo_path), 3600);
    (firm || []).forEach((f) => { if (f.signedUrl) urls[f.path] = f.signedUrl; });
  }
  const fmt = new Intl.DateTimeFormat("es-SV", { timeZone: CFG.zonaHoraria, dateStyle: "medium", timeStyle: "short" });
  $("capturas").innerHTML = caps.map((c) => {
    const u = urls[c.archivo_path];
    const n = c.resultado?.lineas?.length || 0;
    const estado = c.estado === "procesada" ? `<span class="chip c-contado">${n} movimientos leídos</span>` : c.estado === "error" ? `<span class="chip c-gasto">No se pudo leer</span>` : `<span class="chip c-fiado">Pendiente</span>`;
    const medio = !u ? "" : c.tipo === "foto" ? `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Foto del cuaderno" loading="lazy"></a>` : `<audio controls preload="none" src="${u}"></audio>`;
    return `<div class="captura">
      <div class="row between"><strong>${c.tipo === "foto" ? "Foto del cuaderno" : "Nota de voz"}</strong><span class="muted num">${fmt.format(new Date(c.created_at))}</span></div>
      ${medio}
      <div class="row">${estado}</div>
      ${c.transcripcion ? `<p class="transcript">"${esc(c.transcripcion)}"</p>` : ""}
      ${c.error ? `<p class="muted">${esc(c.error)}</p>` : ""}
    </div>`;
  }).join("");
}

/* ---------- Expediente ---------- */
async function pintarExpediente() {
  const { y, m } = partes(hoyLocal());
  const ini = new Date(y, m - 6, 1);
  const desde = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, "0")}-01`;
  const { data, error } = await sb.from("resumen_mensual").select("mes,tipo,total").eq("negocio_id", S.negocio.id).gte("mes", desde).order("mes");
  if (error) { toast(traducirError(error)); return; }
  const meses = [];
  for (let i = 0; i < 6; i++) { const d = new Date(ini.getFullYear(), ini.getMonth() + i, 1); meses.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, lbl: MESES_C[d.getMonth()], contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0 }); }
  (data || []).forEach((r) => { const mm = meses.find((x) => x.key === r.mes); if (mm) mm[r.tipo] = Number(r.total); });
  meses.forEach((x) => (x.ventas = x.contado + x.fiado));
  $("exp-titulo").textContent = `${S.negocio.nombre} · ${MESES[ini.getMonth()]} a ${MESES[m - 1]} ${y}`;

  const W = 640, x0 = 56, y0 = 30, base = 220;
  const max = Math.max(1000, ...meses.map((x) => x.ventas)) * 1.15;
  const paso = Math.pow(10, Math.floor(Math.log10(max / 3)));
  const tick = Math.ceil(max / 3 / paso) * paso;
  const bw = (W - x0 - 20) / meses.length, yy = (v) => base - (v / (tick * 3)) * (base - y0);
  let s = "";
  for (let v = 0; v <= tick * 3; v += tick) {
    s += `<line x1="${x0}" x2="${W - 10}" y1="${yy(v)}" y2="${yy(v)}" stroke="var(--line)"/><text x="${x0 - 8}" y="${yy(v) + 4}" text-anchor="end" font-size="12" fill="var(--muted)">${money0(v)}</text>`;
  }
  const conVentas = meses.filter((x) => x.ventas > 0);
  const prom = conVentas.length ? conVentas.reduce((a, x) => a + x.ventas, 0) / conVentas.length : 0;
  meses.forEach((x, i) => {
    const cx = x0 + i * bw + bw * 0.2, w = bw * 0.6, last = i === meses.length - 1;
    s += `<rect x="${cx}" y="${yy(x.ventas)}" width="${w}" height="${base - yy(x.ventas)}" rx="3" fill="var(--accent)" fill-opacity="${last ? 1 : 0.45}"><title>${x.lbl}: ${money0(x.ventas)}</title></rect>`;
    if (x.ventas > 0) s += `<text x="${cx + w / 2}" y="${yy(x.ventas) - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${money0(x.ventas)}</text>`;
    s += `<text x="${cx + w / 2}" y="${base + 18}" text-anchor="middle" font-size="12" fill="var(--muted)">${x.lbl}</text>`;
  });
  if (prom > 0) s += `<line x1="${x0}" x2="${W - 10}" y1="${yy(prom)}" y2="${yy(prom)}" stroke="var(--ink)" stroke-dasharray="4 4"/><text x="${W - 12}" y="${yy(prom) - 6}" text-anchor="end" font-size="12" fill="var(--ink)">Promedio ${money0(prom)}</text>`;
  $("chart").innerHTML = s;

  const tot = meses.reduce((a, x) => { ["ventas", "fiado", "abono", "gasto", "retiro"].forEach((k) => (a[k] += x[k])); return a; }, { ventas: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0 });
  const primero = conVentas[0], ultimo = conVentas[conVentas.length - 1];
  const crec = primero && ultimo && primero !== ultimo && primero.ventas > 0 ? ((ultimo.ventas / primero.ventas - 1) * 100) : null;
  $("exp-stats").innerHTML = [
    ["Ventas en 6 meses", money0(tot.ventas)],
    ["Venta mensual promedio", money0(prom)],
    ["Crecimiento", crec === null ? "—" : (crec >= 0 ? "+" : "") + crec.toFixed(1) + "%"],
    ["Fiados recuperados", tot.fiado > 0 ? Math.round(Math.min(1, tot.abono / tot.fiado) * 100) + "%" : "—"],
    ["Gastos del negocio", money0(tot.gasto)],
    ["Retiros del dueño", money0(tot.retiro)],
  ].map(([a, b]) => `<div><span class="eyebrow">${a}</span><b class="num">${b}</b></div>`).join("");
}

/* ---------- pestañas ---------- */
const VISTAS = ["hoy", "fiados", "caja", "archivo", "expediente"];
function mostrarTab() {
  if ($("v-app").hidden || !S.negocio) return;
  const v = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "hoy";
  VISTAS.forEach((n) => ($("v-" + n).hidden = n !== v));
  document.querySelectorAll(".tabbar a").forEach((a) => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (v === "caja") pintarCaja();
  if (v === "archivo") pintarArchivo();
  if (v === "expediente") pintarExpediente();
}
window.addEventListener("hashchange", mostrarTab);

/* ---------- arranque ---------- */
sb.auth.getSession().then(({ data }) => { if (!data.session) mostrarPantalla("auth"); });
})();
