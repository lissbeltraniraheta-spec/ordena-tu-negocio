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
const TIPOS = { contado: "Contado", fiado: "Al crédito", abono: "Abono", gasto: "Gasto", compra: "Compra al contado", compra_credito: "Compra al crédito", pago_compra: "Pago a proveedor", retiro: "Retiro dueño" };
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
const MAX_NEGOCIOS = 5;
const S = { user: null, negocios: [], negocio: null, fecha: hoyLocal(), movs: [], saldos: [], pendientes: null, grabando: null };

/* ---------- vistas principales ---------- */
function mostrarPantalla(nombre) {
  $("v-auth").hidden = nombre !== "auth";
  $("v-setup").hidden = nombre !== "setup";
  $("v-negocios").hidden = nombre !== "negocios";
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
  if (/LIMITE_NEGOCIOS/.test(m)) return `Solo se permiten ${MAX_NEGOCIOS} negocios por cuenta. Quite uno para agregar otro.`;
  if (/Failed to fetch|NetworkError/i.test(m)) return "No se pudo conectar con el servidor. Revise su internet o intente de nuevo en unos minutos.";
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
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    setSt("au-st", "Ya existe una cuenta con ese correo. Toque Entrar, o «Olvidé mi contraseña» si no la recuerda.", "err"); return;
  }
  if (!data.session) setSt("au-st", "Listo. Le enviamos un correo para confirmar la cuenta. Ábralo y después entre aquí. Si no lo ve, revise Spam o Promociones.", "ok");
});
$("au-olvide").addEventListener("click", async () => {
  const email = $("au-email").value.trim();
  if (!$("au-email").checkValidity() || !email) { setSt("au-st", "Escriba su correo arriba y vuelva a tocar «Olvidé mi contraseña».", "err"); return; }
  setSt("au-st", "Enviando...");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) { setSt("au-st", traducirError(error), "err"); return; }
  setSt("au-st", "Si ese correo tiene cuenta, le llegará un enlace para poner una contraseña nueva. Revise también Spam o Promociones.", "ok");
});
async function pedirNuevaClave() {
  const p = prompt("Escriba su nueva contraseña (mínimo 6 caracteres):");
  if (!p) return;
  if (p.length < 6) { toast("La contraseña debe tener al menos 6 caracteres."); return pedirNuevaClave(); }
  const { error } = await sb.auth.updateUser({ password: p });
  toast(error ? traducirError(error) : "Listo, su contraseña quedó cambiada.");
}
$("b-salir").addEventListener("click", async () => { await sb.auth.signOut(); });

sb.auth.onAuthStateChange((evento, session) => {
  if (evento === "PASSWORD_RECOVERY") setTimeout(pedirNuevaClave, 300);
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
  if (!S.limpiezaHecha) { S.limpiezaHecha = true; limpiarArchivos(); }
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
    + `<option value="__admin">Agregar o quitar negocios</option>`;
  $("sel-negocio").value = S.negocio.id;
}
$("sel-negocio").addEventListener("change", async (e) => {
  if (e.target.value === "__nuevo") {
    e.target.value = S.negocio.id;
    $("ng-cancelar").hidden = false; $("f-negocio").reset(); mostrarPantalla("setup"); return;
  }
  if (e.target.value === "__admin") { e.target.value = S.negocio.id; abrirAdminNegocios(); return; }
  S.negocio = S.negocios.find((n) => n.id === e.target.value);
  guardarLocal("ordena:negocio", S.negocio.id);
  cerrarRevision();
  await cargarTodo(); mostrarTab();
});
$("ng-cancelar").addEventListener("click", () => mostrarPantalla("app"));

/* ---------- agregar o quitar negocios ---------- */
function abrirAdminNegocios() {
  setSt("adm-st", "");
  $("lista-negocios").innerHTML = S.negocios.map((n) => `<div class="negocio-fila">
      <strong>${esc(n.nombre)}</strong>
      <button class="btn small danger" type="button" data-quitar="${n.id}">Quitar</button>
    </div>`).join("");
  const lleno = S.negocios.length >= MAX_NEGOCIOS;
  $("adm-agregar").hidden = lleno;
  $("adm-limite").textContent = lleno
    ? `Ya tiene ${MAX_NEGOCIOS} negocios, que es el máximo por cuenta. Para agregar otro, quite uno.`
    : `Tiene ${S.negocios.length} de ${MAX_NEGOCIOS} negocios permitidos.`;
  mostrarPantalla("negocios");
}
$("adm-volver").addEventListener("click", () => mostrarPantalla("app"));
$("adm-agregar").addEventListener("click", () => {
  if (S.negocios.length >= MAX_NEGOCIOS) { setSt("adm-st", `Solo se permiten ${MAX_NEGOCIOS} negocios por cuenta.`, "err"); return; } $("ng-cancelar").hidden = false; $("f-negocio").reset(); mostrarPantalla("setup"); });
$("lista-negocios").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-quitar]"); if (!b) return;
  const n = S.negocios.find((x) => x.id === b.dataset.quitar); if (!n) return;
  const r = prompt(`Se borrará «${n.nombre}» con TODAS sus ventas, clientes, cierres y fotos. Esto no se puede deshacer.\n\nPara confirmar, escriba BORRAR:`);
  if (r === null) return;
  if (r.trim().toUpperCase() !== "BORRAR") { setSt("adm-st", "No se borró: debe escribir BORRAR.", "err"); return; }
  b.disabled = true; setSt("adm-st", "Borrando...");
  try {
    // Primero los archivos guardados de ese negocio, después el negocio (lo demás se borra en cadena)
    const { data: caps } = await sb.from("capturas").select("archivo_path").eq("negocio_id", n.id).eq("archivo_borrado", false);
    const paths = (caps || []).map((c) => c.archivo_path);
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from("capturas").remove(paths.slice(i, i + 100));
    const { error } = await sb.from("negocios").delete().eq("id", n.id);
    if (error) throw error;
    S.negocios = S.negocios.filter((x) => x.id !== n.id);
    toast(`«${n.nombre}» fue quitado`);
    if (!S.negocios.length) { S.negocio = null; $("ng-cancelar").hidden = true; $("f-negocio").reset(); mostrarPantalla("setup"); return; }
    if (S.negocio?.id === n.id) { S.negocio = S.negocios[0]; guardarLocal("ordena:negocio", S.negocio.id); await cargarTodo(); }
    pintarSelectorNegocio();
    abrirAdminNegocios();
  } catch (err) { setSt("adm-st", traducirError(err), "err"); b.disabled = false; }
});

/* ---------- borrar fotos y audios de más de 1 día (lo leído por la IA se queda) ---------- */
async function limpiarArchivos() {
  try {
    const limite = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, error } = await sb.from("capturas").select("id,archivo_path")
      .eq("archivo_borrado", false).lt("created_at", limite).limit(200);
    if (error || !data?.length) return;
    const { error: e2 } = await sb.storage.from("capturas").remove(data.map((c) => c.archivo_path));
    if (e2) return;
    await sb.from("capturas").update({ archivo_borrado: true }).in("id", data.map((c) => c.id));
  } catch (e) { /* se intenta otra vez la próxima vez que entre */ }
}
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
  S.caja = null; // el cierre vuelve a ser del día elegido
  await cargarTodo(); mostrarTab();
});

/* ---------- carga de datos ---------- */
async function cargarTodo() { await Promise.all([cargarDia(), cargarSaldos()]); pintarHoy(); pintarFiados(); pintarAlertas(); }
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
  pintarSelectorCliente();
}
// Lista de clientes para "Anotar a mano": en un abono salen primero los que deben, con su saldo
function pintarSelectorCliente() {
  const tipo = $("a-tipo").value, sel = $("a-cliente-sel"), antes = sel.value;
  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");
  const deben = S.saldos.filter((c) => Number(c.saldo) > 0).sort(porNombre);
  const alDia = S.saldos.filter((c) => !(Number(c.saldo) > 0)).sort(porNombre);
  const opt = (c) => `<option value="${c.id}">${esc(c.nombre)}${Number(c.saldo) > 0 ? " · debe " + money(c.saldo) : ""}</option>`;
  let html = `<option value="">${S.saldos.length ? "Elija el cliente…" : "Todavía no hay clientes"}</option>`;
  if (tipo === "abono") {
    if (deben.length) html += `<optgroup label="Clientes que deben">${deben.map(opt).join("")}</optgroup>`;
    if (alDia.length) html += `<optgroup label="Clientes al día">${alDia.map(opt).join("")}</optgroup>`;
  } else {
    html += S.saldos.slice().sort(porNombre).map(opt).join("");
  }
  html += `<option value="__nuevo">+ Cliente nuevo (escribir el nombre)</option>`;
  sel.innerHTML = html;
  sel.value = [...sel.options].some((o) => o.value === antes) ? antes : "";
  $("l-cliente-nuevo").hidden = sel.value !== "__nuevo";
}
function totales(lista) {
  const t = { contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0, compra: 0, compra_credito: 0, pago_compra: 0 };
  (lista || S.movs).forEach((m) => { t[m.tipo] += Number(m.monto); });
  return t;
}

/* ---------- Fechas de pago y alertas ---------- */
const DIAS_CREDITO = 30;   // plazo que se sugiere si no se escribe otra fecha
const DIAS_AVISO = 7;      // se avisa cuando faltan 7 días o menos
const conVence = (t) => t === "fiado" || t === "compra_credito";
const masDias = (f, n) => { const { y, m, d } = partes(f); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const venceSugerido = () => masDias(S.fecha || hoyLocal(), DIAS_CREDITO);
const fechaValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : venceSugerido();
const fechaC2 = (f) => { const { m, d } = partes(f); return `${d} ${MESES_C[m - 1]}`; };
function etiquetaVence(v, hoy) {
  const n = diasEntre(hoy, v);
  if (n < 0) return [`Atrasado ${-n} ${n === -1 ? "día" : "días"}`, "atrasado"];
  if (n === 0) return ["Vence hoy", "atrasado"];
  if (n === 1) return ["Vence mañana", "pronto"];
  if (n <= DIAS_AVISO) return [`Vence en ${n} días`, "pronto"];
  return [`Vence el ${fechaC2(v)}`, "lejos"];
}
async function pintarAlertas() {
  if (!S.negocio) return;
  const hoy = hoyLocal(), limite = masDias(hoy, DIAS_AVISO);
  const deudores = S.saldos.filter((c) => Number(c.saldo) > 0).map((c) => c.id);
  const [rc, rv] = await Promise.all([
    sb.from("movimientos").select("id,fecha,descripcion,proveedor,monto,vence").eq("negocio_id", S.negocio.id).eq("tipo", "compra_credito").order("fecha").limit(500),
    deudores.length
      ? sb.from("movimientos").select("fecha,tipo,monto,vence,cliente_id,created_at").eq("negocio_id", S.negocio.id).in("cliente_id", deudores).in("tipo", ["fiado", "abono"]).order("fecha").limit(5000)
      : Promise.resolve({ data: [] }),
  ]);
  if (rc.error || rv.error) return;
  // Compras al crédito que todavía no se pagan
  const ids = (rc.data || []).map((c) => c.id);
  let pagadas = new Set();
  if (ids.length) {
    const { data } = await sb.from("movimientos").select("paga_id").eq("negocio_id", S.negocio.id).in("paga_id", ids);
    pagadas = new Set((data || []).map((p) => p.paga_id));
  }
  const porPagar = (rc.data || []).filter((c) => !pagadas.has(c.id)).map((c) => ({ ...c, vence: c.vence || masDias(c.fecha, DIAS_CREDITO) }))
    .sort((a, b) => a.vence.localeCompare(b.vence));
  // Ventas al crédito: los abonos pagan primero lo más viejo; queda lo pendiente de cada compra
  const cobrar = [];
  for (const id of deudores) {
    const movs = (rv.data || []).filter((m) => m.cliente_id === id);
    let abonado = movs.filter((m) => m.tipo === "abono").reduce((s, m) => s + Number(m.monto), 0);
    let monto = 0, vence = null;
    for (const f of movs.filter((m) => m.tipo === "fiado")) {
      const usa = Math.min(abonado, Number(f.monto)); abonado -= usa;
      const falta = Math.round((Number(f.monto) - usa) * 100) / 100;
      if (falta <= 0) continue;
      const v = f.vence || masDias(f.fecha, DIAS_CREDITO);
      if (v <= limite) { monto += falta; if (!vence || v < vence) vence = v; }
    }
    if (monto > 0.004) cobrar.push({ cliente: S.saldos.find((c) => c.id === id), monto, vence });
  }
  cobrar.sort((a, b) => a.vence.localeCompare(b.vence));
  const proveedoresPronto = porPagar.filter((c) => c.vence <= limite);
  $("p-alertas").hidden = !cobrar.length && !porPagar.length;
  $("al-resumen").textContent = [
    cobrar.length ? `${cobrar.length} ${cobrar.length === 1 ? "cliente debe" : "clientes deben"} pagarle pronto` : "",
    proveedoresPronto.length ? `${proveedoresPronto.length} ${proveedoresPronto.length === 1 ? "pago" : "pagos"} a proveedores por vencer` : "",
  ].filter(Boolean).join(" · ") || "Nada por vencer en los próximos 7 días";
  $("al-cobrar-box").hidden = !cobrar.length;
  $("al-cobrar").innerHTML = cobrar.map((x) => {
    const [txt, cls] = etiquetaVence(x.vence, hoy);
    return `<li><span class="al-tag ${cls}">${txt}</span><span class="desc">${esc(x.cliente.nombre)}<small>Debe pagar ${money(x.monto)} de ventas al crédito</small></span>
      <button class="btn small" type="button" data-ver-cliente="${x.cliente.id}">Cobrar</button></li>`;
  }).join("");
  $("al-pagar-box").hidden = !porPagar.length;
  $("al-pagar").innerHTML = porPagar.map((c) => filaPorPagar(c, hoy)).join("");
  S.porPagar = porPagar;
  if (!$("v-compras").hidden) pintarCompras();
}
const nombreCompra = (c) => (c.proveedor ? c.proveedor + " · " : "") + c.descripcion;
function filaPorPagar(c, hoy) {
  const [txt, cls] = etiquetaVence(c.vence, hoy);
  return `<li><span class="al-tag ${cls}">${txt}</span><span class="desc">${esc(nombreCompra(c))}<small>${money(c.monto)} · comprado el ${fechaC2(c.fecha)}</small></span>
      <button class="btn small" type="button" data-pagar="${c.id}">Ya lo pagué</button></li>`;
}
$("al-cobrar").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ver-cliente]"); if (!b) return;
  location.hash = "fiados";
  setTimeout(() => { $("cl-filtro").value = b.dataset.verCliente; $("cl-buscar").value = ""; pintarFiados(); }, 50);
});
async function clicPagar(e) {
  const b = e.target.closest("[data-pagar]"); if (!b) return;
  const c = (S.porPagar || []).find((x) => x.id === b.dataset.pagar); if (!c) return;
  if (!b.classList.contains("confirm")) { b.classList.add("confirm"); b.textContent = `Anotar pago de ${money(c.monto)}`; return; }
  b.disabled = true;
  const { error } = await sb.from("movimientos").insert({ negocio_id: S.negocio.id, fecha: hoyLocal(), tipo: "pago_compra", descripcion: ("Pago: " + nombreCompra(c)).slice(0, 120), proveedor: c.proveedor || null, monto: c.monto, paga_id: c.id, origen: "manual" });
  if (error) { b.disabled = false; toast(traducirError(error)); return; }
  toast("Pago anotado. Se restó de la caja de hoy.");
  await cargarTodo();
}
$("al-pagar").addEventListener("click", clicPagar);

/* ---------- Compras ---------- */
function formaCompra() { return document.querySelector('input[name="cp-forma"]:checked')?.value || "compra"; }
function prepararFormCompra() {
  const credito = formaCompra() === "compra_credito";
  $("l-cp-vence").hidden = !credito;
  if (!$("cp-fecha").value) $("cp-fecha").value = hoyLocal();
  $("cp-fecha").max = hoyLocal();
  if (credito && !$("cp-vence").value) $("cp-vence").value = masDias($("cp-fecha").value, DIAS_CREDITO);
  $("cp-guardar").textContent = credito ? "Guardar compra al crédito" : "Guardar compra al contado";
}
document.querySelectorAll('input[name="cp-forma"]').forEach((r) => r.addEventListener("change", prepararFormCompra));
$("cp-fecha").addEventListener("change", () => { if (formaCompra() === "compra_credito") $("cp-vence").value = masDias($("cp-fecha").value || hoyLocal(), DIAS_CREDITO); });
$("f-compra").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tipo = formaCompra(), monto = Math.round(parseFloat($("cp-monto").value) * 100) / 100;
  const descripcion = $("cp-desc").value.trim(), proveedor = $("cp-prov").value.trim().slice(0, 80) || null;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test($("cp-fecha").value) ? $("cp-fecha").value : hoyLocal();
  if (!descripcion) { setSt("cp-st", "Escriba qué compró.", "err"); $("cp-desc").focus(); return; }
  if (!(monto > 0)) { setSt("cp-st", "Escriba el monto de la compra.", "err"); $("cp-monto").focus(); return; }
  if (fecha > hoyLocal()) { setSt("cp-st", "La fecha de compra no puede ser después de hoy.", "err"); return; }
  const vence = tipo === "compra_credito" ? (/^\d{4}-\d{2}-\d{2}$/.test($("cp-vence").value) ? $("cp-vence").value : masDias(fecha, DIAS_CREDITO)) : null;
  const b = $("cp-guardar"); b.disabled = true;
  const { error } = await sb.from("movimientos").insert({ negocio_id: S.negocio.id, fecha, tipo, descripcion, proveedor, monto, vence, origen: "manual" });
  b.disabled = false;
  if (error) { setSt("cp-st", traducirError(error), "err"); return; }
  setSt("cp-st", `${TIPOS[tipo]} de ${money(monto)} guardada.${tipo === "compra" ? " Se restó de la caja de ese día." : " Le avisaremos antes de la fecha de pago."}`, "ok");
  $("cp-desc").value = ""; $("cp-monto").value = ""; $("cp-vence").value = "";
  prepararFormCompra();
  await cargarTodo();
  pintarCompras();
});
async function pintarCompras() {
  prepararFormCompra();
  const hoy = hoyLocal(), [ini, fin] = rangoMes(hoy), { m } = partes(hoy);
  const { data, error } = await sb.from("movimientos").select("id,fecha,tipo,descripcion,proveedor,monto,vence")
    .eq("negocio_id", S.negocio.id).in("tipo", ["compra", "compra_credito"]).gte("fecha", ini).lte("fecha", fin)
    .order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  if (error) { toast(traducirError(error)); return; }
  const lista = data || [], t = totales(lista), deuda = (S.porPagar || []).reduce((s, c) => s + Number(c.monto), 0);
  $("cp-mes").textContent = MESES[m - 1];
  $("cp-total").textContent = money(t.compra + t.compra_credito);
  $("cp-contado").textContent = money(t.compra);
  $("cp-credito").textContent = money(t.compra_credito);
  $("cp-deuda").textContent = money(deuda);
  // Proveedores ya usados, para sugerirlos
  const { data: provs } = await sb.from("movimientos").select("proveedor").eq("negocio_id", S.negocio.id).not("proveedor", "is", null).limit(1000);
  $("dl-proveedores").innerHTML = [...new Set((provs || []).map((x) => x.proveedor))].sort((a, b) => a.localeCompare(b, "es")).map((x) => `<option value="${esc(x)}"></option>`).join("");
  // Por pagar
  const pend = S.porPagar || [], pendIds = new Set(pend.map((c) => c.id));
  $("cp-porpagar-box").hidden = !pend.length;
  $("cp-porpagar").innerHTML = pend.map((c) => filaPorPagar(c, hoy)).join("");
  // Compras del mes
  $("cp-vacio").hidden = lista.length > 0;
  $("cp-lista").innerHTML = lista.map((c) => {
    const estado = c.tipo === "compra" ? "Pagada" : pendIds.has(c.id) ? "Pendiente · pagar el " + fechaC2(c.vence || masDias(c.fecha, DIAS_CREDITO)) : "Pagada";
    return `<li><span class="chip c-${c.tipo}">${c.tipo === "compra" ? "Contado" : "Crédito"}</span>
      <span class="desc">${esc(nombreCompra(c))}<small>${fechaC2(c.fecha)} · ${estado}</small></span>
      <span class="amt">${money(c.monto)}</span>
      <button class="del" type="button" data-borrar-compra="${c.id}" aria-label="Borrar ${esc(c.descripcion)}">×</button></li>`;
  }).join("");
}
$("cp-porpagar").addEventListener("click", clicPagar);
$("cp-lista").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-borrar-compra]"); if (!b) return;
  if (!b.classList.contains("confirm")) {
    document.querySelectorAll("#cp-lista .del.confirm").forEach((x) => { x.classList.remove("confirm"); x.textContent = "×"; });
    b.classList.add("confirm"); b.textContent = "Borrar"; return;
  }
  const { error } = await sb.from("movimientos").delete().eq("id", b.dataset.borrarCompra);
  if (error) { toast(traducirError(error)); return; }
  toast("Compra borrada");
  await cargarTodo(); pintarCompras();
});

/* ---------- Movimientos del día ---------- */
function pintarHoy() {
  const t = totales();
  $("k-vendido").textContent = money(t.contado + t.fiado);
  $("k-contado").textContent = money(t.contado);
  $("k-fiado").textContent = money(t.fiado);
  $("k-comprado").textContent = money(t.compra + t.compra_credito);
  $("k-compras").textContent = money(t.compra);
  $("k-compras-cred").textContent = money(t.compra_credito);
  $("k-gastos").textContent = money(t.gasto);
  $("k-abonos").textContent = money(t.abono);
  $("t-movs").textContent = S.fecha === hoyLocal() ? "Movimientos de hoy" : "Movimientos del " + fechaLarga(S.fecha);
  $("n-movs").textContent = S.movs.length ? S.movs.length + " anotados" : "";
  $("movs-vacio").hidden = S.movs.length > 0;
  $("movs").innerHTML = S.movs.slice().reverse().map((m) => {
    const neg = m.tipo === "gasto" || m.tipo === "retiro" || m.tipo === "compra" || m.tipo === "pago_compra" ? "−" : "";
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

$("a-tipo").addEventListener("change", () => {
  const t = $("a-tipo").value; $("l-cliente").hidden = !(t === "fiado" || t === "abono");
  $("l-vence").hidden = !conVence(t); if (conVence(t) && !$("a-vence").value) $("a-vence").value = venceSugerido();
  $("a-desc").placeholder = t === "abono" ? "Opcional (si lo deja vacío dice «Abono de cliente»)" : "Ej. Pintura galón blanco";
  pintarSelectorCliente();
});
$("a-cliente-sel").addEventListener("change", () => {
  const nuevo = $("a-cliente-sel").value === "__nuevo";
  $("l-cliente-nuevo").hidden = !nuevo;
  if (nuevo) $("a-cliente").focus();
});
$("f-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tipo = $("a-tipo").value, monto = Math.round(parseFloat($("a-monto").value) * 100) / 100;
  const descripcion = $("a-desc").value.trim() || (tipo === "abono" ? "Abono de cliente" : "");
  if (!descripcion) { toast("Escriba qué se vendió o pagó"); $("a-desc").focus(); return; }
  if (!(monto > 0)) return;
  try {
    let cliente_id = null;
    if (tipo === "fiado" || tipo === "abono") {
      const elegido = $("a-cliente-sel").value;
      if (!elegido) { toast("Elija el cliente de la lista"); $("a-cliente-sel").focus(); return; }
      if (elegido === "__nuevo") {
        if (!$("a-cliente").value.trim()) { toast("Escriba el nombre del cliente nuevo"); $("a-cliente").focus(); return; }
        cliente_id = await resolverCliente($("a-cliente").value);
      } else cliente_id = elegido;
    }
    const vence = conVence(tipo) ? fechaValida($("a-vence").value) : null;
    const { error } = await sb.from("movimientos").insert({ negocio_id: S.negocio.id, fecha: S.fecha, tipo, descripcion, monto, cliente_id, vence, origen: "manual" });
    if (error) throw error;
    $("a-desc").value = ""; $("a-monto").value = ""; $("a-vence").value = conVence(tipo) ? venceSugerido() : ""; $("a-cliente").value = ""; $("a-cliente-sel").value = ""; $("l-cliente-nuevo").hidden = true;
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
  // Elegir un formato que el navegador sí grabe (el iPhone usa audio/mp4)
  const formato = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]
    .find((t) => window.MediaRecorder.isTypeSupported?.(t));
  let rec;
  try { rec = formato ? new MediaRecorder(stream, { mimeType: formato }) : new MediaRecorder(stream); }
  catch { rec = new MediaRecorder(stream); }
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
    // Safari a veces entrega el último trozo de audio justo después de detener
    await new Promise((r) => setTimeout(r, 400));
    clearInterval(tick); stream.getTracks().forEach((t) => t.stop());
    S.grabando = null; b.classList.remove("rec"); b.textContent = "Grabar audio";
    const blob = new Blob(trozos, { type: rec.mimeType || "audio/webm" });
    if (blob.size < 1000) {
      const corta = Date.now() - inicio < 2500;
      setSt("st-audio", corta
        ? "La grabación fue muy corta. Toque \"Grabar audio\", hable y toque \"Detener\" cuando termine."
        : "No se grabó sonido. Revise que el micrófono tenga permiso o use \"Subir audio\".", "err");
      return;
    }
    mostrarAudio(blob);
    setSt("st-audio", "Preparando el audio...");
    const ext = /mp4|aac/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
    try { await subirYProcesar("audio", await prepararAudio(blob, `grabacion.${ext}`), "st-audio"); }
    catch (e) { setSt("st-audio", e.message, "err"); }
  };
  // Sin "trozos por segundo": en Safari (iPhone) eso a veces deja la grabación vacía
  rec.start();
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
    let r, j;
    for (let vuelta = 1; vuelta <= 3; vuelta++) {
      const { data: ses } = await sb.auth.getSession();
      r = await fetch("/api/procesar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ses.session?.access_token}` },
        body: JSON.stringify({ captura_id: cap.id }),
      });
      j = await r.json().catch(() => ({}));
      // Si la IA de Google está saturada, se vuelve a intentar solo, sin que la persona tenga que subir de nuevo
      if (r.ok || vuelta === 3 || !/ocupada|límite|tardó|504|502/i.test(`${j.error || ""} ${r.status}`)) break;
      setSt(stId, `La IA de Google está muy ocupada. Reintentando (${vuelta + 1} de 3)... no cierre la página.`);
      await new Promise((ok) => setTimeout(ok, 8000));
    }
    if (!r.ok) throw new Error((j.error || "No se pudo leer. Intente de nuevo.") + " Su foto o audio quedó guardado en «Fotos y audios».");
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
      <label>Tipo<select data-k="tipo">${Object.entries(TIPOS).filter(([k]) => k !== "pago_compra").map(([k, v]) => `<option value="${k}"${k === l.tipo ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Monto (US$)<input data-k="monto" type="number" min="0.01" step="0.01" inputmode="decimal" value="${l.monto}"></label>
      <label data-vence${conVence(l.tipo) ? "" : " hidden"}>Fecha para pagar<input data-k="vence" type="date" value="${venceSugerido()}"></label>
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
  if (e.target.dataset.k === "tipo") { const t = e.target.value; item.querySelector("[data-cliente]").hidden = !(t === "fiado" || t === "abono"); item.querySelector("[data-vence]").hidden = !conVence(t); }
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
      const vence = conVence(tipo) ? fechaValida(v("vence").value) : null;
      filas.push({ negocio_id: S.negocio.id, fecha: S.fecha, tipo, descripcion, monto, cliente_id, vence, origen: S.pendientes.tipo, captura_id: S.pendientes.capturaId });
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
  return [c.ultimo_abono ? `Abonó hace ${d} días` : `Compró al crédito hace ${d} días`, "estado-ok", d];
}
function pintarFiados() {
  const con = S.saldos.filter((c) => Number(c.saldo) > 0);
  $("f-total").textContent = money(con.reduce((s, c) => s + Number(c.saldo), 0));
  $("f-n").textContent = con.length;
  $("f-30").textContent = money(con.filter((c) => estadoCliente(c)[2] >= 30).reduce((s, c) => s + Number(c.saldo), 0));
  $("f-hoy").textContent = money(totales().abono);
  const todos = S.saldos.slice().sort((a, b) => Number(b.saldo) - Number(a.saldo));
  const sel = $("cl-filtro"), antes = sel.value || "__deben";
  sel.innerHTML = `<option value="__deben">Todos los que deben (${con.length})</option>`
    + `<option value="__todos">Todos los clientes (${todos.length})</option>`
    + con.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${money(c.saldo)}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === antes) ? antes : "__deben";
  let lista = sel.value === "__todos" ? todos : sel.value === "__deben" ? todos.filter((c) => Number(c.saldo) > 0) : todos.filter((c) => c.id === sel.value);
  // Búsqueda por nombre o apellido: cada palabra escrita debe aparecer en el nombre (sin importar tildes ni mayúsculas)
  const palabras = norm($("cl-buscar").value).split(/\s+/).filter(Boolean);
  if (palabras.length) lista = lista.filter((c) => { const n = norm(c.nombre); return palabras.every((p) => n.includes(p)); });
  $("cl-vacio").hidden = lista.length > 0;
  $("cl-vacio").textContent = palabras.length ? `Ningún cliente coincide con «${$("cl-buscar").value.trim()}».`
    : todos.length ? "Ningún cliente debe en este momento." : "Aún no hay clientes. Se crean solos al anotar una venta al crédito o un abono.";
  $("clientes").innerHTML = lista.map((c) => {
    const [txt, cls] = estadoCliente(c);
    return `<div class="cliente">
      <div><strong>${esc(c.nombre)}</strong>${c.telefono ? ` <span class="muted num">· ${esc(c.telefono)}</span>` : ""}<br><span class="chip ${cls}">${txt}</span></div>
      <div class="amt">${money(c.saldo)}</div>
      <div class="acts">
        <button class="btn small" type="button" data-estado="${c.id}">Estado de cuenta</button>
        <button class="btn small" type="button" data-detalle="${c.id}">Detalle de compras</button>
        ${Number(c.saldo) > 0 ? `<button class="btn small" type="button" data-cobro="${c.id}">Preparar mensaje de cobro</button>` : ""}
      </div>
    </div>`;
  }).join("");
}
$("cl-filtro").addEventListener("change", () => { $("p-msg").hidden = true; pintarFiados(); });
$("cl-buscar").addEventListener("input", () => { $("p-msg").hidden = true; pintarFiados(); });
function mostrarMensaje(c, titulo, txt) {
  $("msg-title").textContent = titulo;
  $("msg").textContent = txt;
  let tel = String(c.telefono || "").replace(/\D/g, "");
  if (tel.length === 8) tel = "503" + tel;
  $("b-wa").href = `https://wa.me/${tel}?text=${encodeURIComponent(txt)}`;
  $("p-msg").hidden = false;
  $("p-msg").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
// Estado de cuenta: compras al crédito y abonos con el saldo después de cada uno
const MAX_LINEAS_ESTADO = 30;
async function estadoDeCuenta(c, boton) {
  boton.disabled = true;
  const { data, error } = await sb.from("movimientos").select("fecha,tipo,descripcion,monto")
    .eq("negocio_id", S.negocio.id).eq("cliente_id", c.id).in("tipo", ["fiado", "abono"])
    .order("fecha").order("created_at").limit(1000);
  boton.disabled = false;
  if (error) { toast(traducirError(error)); return; }
  const movs = data || [];
  const nombre = c.nombre.split(" ").slice(0, 2).join(" ");
  const mny = (v) => (v < -0.004 ? `−${money(-v)}` : money(Math.abs(v)));
  const fechaC = (f) => { const { d, m, y } = partes(f); return `${d} ${MESES_C[m - 1]} ${y}`; };
  const saldo = Number(c.saldo);
  const visibles = movs.slice(-MAX_LINEAS_ESTADO);
  const deltaVisible = visibles.reduce((s, m) => s + (m.tipo === "fiado" ? 1 : -1) * Number(m.monto), 0);
  // Si se muestra todo el historial se parte de cero; si no, del saldo que había antes de lo que se muestra
  let corrido = movs.length > visibles.length ? Math.round((saldo - deltaVisible) * 100) / 100 : 0;
  const lineas = [];
  if (movs.length > visibles.length) lineas.push(`Saldo anterior: ${mny(corrido)}`);
  visibles.forEach((m) => {
    const compra = m.tipo === "fiado";
    corrido = Math.round((corrido + (compra ? 1 : -1) * Number(m.monto)) * 100) / 100;
    lineas.push(`• ${fechaC(m.fecha)} · ${compra ? "Compra" : "Abono"}: ${money(m.monto)}`);
  });
  const txt = [
    `Buenas, ${nombre}. Le saluda ${S.negocio.nombre}.`,
    ``,
    `*Estado de cuenta al ${fechaLarga(hoyLocal())}*`,
    ``,
    movs.length ? (movs.length > visibles.length ? `Últimos ${visibles.length} movimientos:` : `Movimientos:`) : `No tiene compras al crédito ni abonos registrados.`,
    ...lineas,
    ``,
    saldo < -0.004 ? `*Saldo a su favor: ${money(-saldo)}*` : `*Saldo actual: ${money(saldo)}*`,
    ``,
    saldo > 0.004 ? `Puede abonar en el negocio o por transferencia, lo que le quede mejor.` : `Su cuenta está al día.`,
    ``,
    `¿Desea que le enviemos la factura con el detalle de cada compra?`,
    ``,
    `Muchas gracias por su preferencia.`,
  ].join("\n");
  mostrarMensaje(c, "Estado de cuenta de " + c.nombre, txt);
}
// Detalle de compras al crédito, agrupado por fecha (para cuando el cliente pide la factura)
const MAX_COMPRAS_DETALLE = 80;
async function detalleCompras(c, boton) {
  boton.disabled = true;
  const { data, error } = await sb.from("movimientos").select("fecha,tipo,descripcion,monto")
    .eq("negocio_id", S.negocio.id).eq("cliente_id", c.id).in("tipo", ["fiado", "abono"])
    .order("fecha").order("created_at").limit(2000);
  boton.disabled = false;
  if (error) { toast(traducirError(error)); return; }
  const movs = data || [];
  const compras = movs.filter((m) => m.tipo === "fiado");
  const visibles = compras.slice(-MAX_COMPRAS_DETALLE);
  const nombre = c.nombre.split(" ").slice(0, 2).join(" ");
  const saldo = Number(c.saldo);
  const porFecha = new Map();
  visibles.forEach((m) => { if (!porFecha.has(m.fecha)) porFecha.set(m.fecha, []); porFecha.get(m.fecha).push(m); });
  const bloques = [];
  porFecha.forEach((lista, fecha) => {
    const sub = lista.reduce((s, m) => s + Number(m.monto), 0);
    bloques.push([
      `*${fechaLarga(fecha)}${partes(fecha).y !== partes(hoyLocal()).y ? " de " + partes(fecha).y : ""}*`,
      ...lista.map((m) => `• ${String(m.descripcion || "Compra").slice(0, 60)}: ${money(m.monto)}`),
      lista.length > 1 ? `Total del día: ${money(sub)}` : null,
    ].filter(Boolean).join("\n"));
  });
  const totComprado = compras.reduce((s, m) => s + Number(m.monto), 0);
  const totAbonado = movs.filter((m) => m.tipo === "abono").reduce((s, m) => s + Number(m.monto), 0);
  const txt = [
    `Buenas, ${nombre}. Le saluda ${S.negocio.nombre}.`,
    ``,
    `Como nos pidió, le compartimos el *detalle de sus compras al crédito*:`,
    ``,
    compras.length > visibles.length ? `(Se muestran las últimas ${visibles.length} compras)\n` : null,
    compras.length ? bloques.join("\n\n") : `No tiene compras al crédito registradas.`,
    ``,
    `Total comprado al crédito: ${money(totComprado)}`,
    `Total abonado: ${money(totAbonado)}`,
    saldo < -0.004 ? `*Saldo a su favor: ${money(-saldo)}*` : `*Saldo actual: ${money(saldo)}*`,
    ``,
    `Cualquier duda, con gusto le atendemos. Muchas gracias por su preferencia.`,
  ].filter((x) => x !== null).join("\n");
  mostrarMensaje(c, "Detalle de compras de " + c.nombre, txt);
}
$("clientes").addEventListener("click", (e) => {
  const bd = e.target.closest("[data-detalle]");
  if (bd) { const c = S.saldos.find((x) => x.id === bd.dataset.detalle); if (c) detalleCompras(c, bd); return; }
  const be = e.target.closest("[data-estado]");
  if (be) { const c = S.saldos.find((x) => x.id === be.dataset.estado); if (c) estadoDeCuenta(c, be); return; }
  const b = e.target.closest("[data-cobro]"); if (!b) return;
  const c = S.saldos.find((x) => x.id === b.dataset.cobro);
  const nombre = c.nombre.split(" ").slice(0, 2).join(" ");
  const txt = `Buenas, ${nombre}. Le saluda ${S.negocio.nombre}.\n\nLe compartimos su estado de cuenta al ${fechaLarga(hoyLocal())}:\nSaldo pendiente: ${money(c.saldo)}\n\nPuede abonar en el negocio o por transferencia, lo que le quede mejor. Muchas gracias por su preferencia.`;
  mostrarMensaje(c, "Mensaje de cobro para " + c.nombre, txt);
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

/* ---------- Cierre de caja (un día o varios días) ---------- */
const MAX_DIAS_CIERRE = 62;
function textoRango(desde, hasta) {
  if (desde === hasta) return fechaLarga(hasta);
  const a = partes(desde), b = partes(hasta);
  return a.y === b.y && a.m === b.m ? `del ${a.d} al ${b.d} de ${MESES[b.m - 1]}` : `del ${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]}`;
}
function rangoCorto(desde, hasta) {
  const b = partes(hasta);
  if (!desde || desde === hasta) return `${b.d} ${MESES_C[b.m - 1]}`;
  const a = partes(desde);
  return a.m === b.m ? `${a.d}–${b.d} ${MESES_C[b.m - 1]}` : `${a.d} ${MESES_C[a.m - 1]}–${b.d} ${MESES_C[b.m - 1]}`;
}
function cambioRango(e) {
  let desde = $("c-desde").value, hasta = $("c-hasta").value;
  if (!desde || !hasta) { $("c-desde").value = S.caja.desde; $("c-hasta").value = S.caja.hasta; return; }
  if (desde > hasta) { if (e.target.id === "c-desde") hasta = desde; else desde = hasta; }
  if (diasEntre(desde, hasta) + 1 > MAX_DIAS_CIERRE) {
    toast(`Puede cerrar hasta ${MAX_DIAS_CIERRE} días juntos.`);
    $("c-desde").value = S.caja.desde; $("c-hasta").value = S.caja.hasta; return;
  }
  S.caja = { desde, hasta };
  pintarCaja();
}
$("c-desde").addEventListener("change", cambioRango);
$("c-hasta").addEventListener("change", cambioRango);
async function movsDelRango(desde, hasta) {
  if (desde === S.fecha && hasta === S.fecha) return S.movs;
  const { data, error } = await sb.from("movimientos").select("tipo,monto")
    .eq("negocio_id", S.negocio.id).gte("fecha", desde).lte("fecha", hasta);
  if (error) { toast(traducirError(error)); return null; }
  return data || [];
}
async function pintarCaja() {
  if (!S.caja) S.caja = { desde: S.fecha, hasta: S.fecha };
  const { desde, hasta } = S.caja, varios = desde !== hasta;
  $("c-desde").value = desde; $("c-hasta").value = hasta;
  $("c-desde").max = $("c-hasta").max = hoyLocal();
  const lista = await movsDelRango(desde, hasta);
  if (!lista) return;
  const t = totales(lista);
  const inicial = Number(S.negocio.efectivo_inicial || 0);
  const esperado = inicial + t.contado + t.abono - t.compra - t.pago_compra - t.gasto - t.retiro;
  S.esperado = esperado;
  $("t-caja").textContent = "Cierre de caja · " + textoRango(desde, hasta);
  $("b-cierre").textContent = varios ? `Guardar cierre de ${diasEntre(desde, hasta) + 1} días` : "Guardar cierre del día";
  $("c-inicial").value = inicial;
  const filas = [["Efectivo con que se abrió", inicial], ["+ Ventas al contado", t.contado], ["+ Abonos de clientes", t.abono], ["− Compras al contado", -t.compra], ["− Pagos a proveedores", -t.pago_compra], ["− Gastos del negocio", -t.gasto], ["− Retiros del dueño", -t.retiro]];
  $("cuadre").innerHTML = filas.map(([a, b]) => `<tr><td>${a}</td><td>${b < 0 ? "−" + money(-b) : money(b)}</td></tr>`).join("")
    + `<tr class="total"><td>Debe haber en la gaveta</td><td>${money(esperado)}</td></tr>`;
  S.cajaT = { inicial, ...t, desde, hasta };
  // Cierres ya guardados que tocan estas fechas
  const { data: cruzan } = await sb.from("cierres").select("fecha,fecha_desde,contado")
    .eq("negocio_id", S.negocio.id).gte("fecha", desde)
    .or(`fecha_desde.lte.${hasta},and(fecha_desde.is.null,fecha.lte.${hasta})`).order("fecha");
  const desdeDe = (c) => c.fecha_desde || c.fecha;
  const igual = (cruzan || []).find((c) => c.fecha === hasta && desdeDe(c) === desde);
  const otros = (cruzan || []).filter((c) => c !== igual);
  $("c-real").value = igual ? Number(igual.contado) : "";
  setSt("cierre-st", igual ? (varios ? "Estas fechas ya tienen un cierre guardado." : "Este día ya tiene un cierre guardado.") + " Si lo vuelve a guardar, se actualiza." : "", igual ? "ok" : "");
  const nota = $("c-rango-nota");
  const reemplaza = otros.find((c) => c.fecha === hasta);
  if (otros.length) {
    nota.hidden = false;
    nota.textContent = "Ojo: ya hay cierres guardados en estas fechas (" + otros.map((c) => rangoCorto(c.fecha_desde, c.fecha)).join(", ") + ")."
      + (reemplaza ? ` Al guardar, este cierre reemplaza el del ${rangoCorto(reemplaza.fecha_desde, reemplaza.fecha)}.` : "");
  } else if (varios) {
    nota.hidden = false;
    nota.textContent = "Se suman todos los movimientos de esos días. Escriba el efectivo que hay en la gaveta al final del último día.";
  } else nota.hidden = true;
  revisarCaja();
  pintarHistorial();

  const [inicioMes] = rangoMes(S.fecha);
  const { data, error } = await sb.from("resumen_mensual").select("tipo,total").eq("negocio_id", S.negocio.id).eq("mes", inicioMes);
  if (error) { toast(traducirError(error)); return; }
  const m = { contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0, compra: 0, compra_credito: 0, pago_compra: 0 };
  (data || []).forEach((r) => { m[r.tipo] = Number(r.total); });
  const { m: mes } = partes(S.fecha);
  $("t-mes").textContent = "Resumen de " + MESES[mes - 1];
  const entra = m.contado + m.abono, neto = entra - m.compra - m.pago_compra - m.gasto;
  $("mes").innerHTML = [["Ventas (contado + al crédito)", m.contado + m.fiado], ["Dinero que entró (contado + abonos)", entra], ["− Compras al contado", -m.compra], ["− Pagos a proveedores", -m.pago_compra], ["− Gastos del negocio", -m.gasto], ["− Retiros del dueño", -m.retiro]]
    .map(([a, b]) => `<tr><td>${a}</td><td>${b < 0 ? "−" + money(-b) : money(b)}</td></tr>`).join("")
    + `<tr class="total"><td>Queda para el negocio</td><td>${money(neto - m.retiro)}</td></tr>`;
  const box = $("m-msg");
  if (neto <= 0) { $("meter").innerHTML = ""; box.hidden = !(m.retiro > 0); box.className = "result bad"; box.textContent = "Este mes las compras, gastos y retiros son mayores que lo que entró."; return; }
  const pct = Math.min(100, (m.retiro / neto) * 100);
  $("meter").innerHTML = `<span style="width:${pct}%;background:var(--bad)"></span><span style="width:${100 - pct}%;background:var(--accent)"></span>`;
  $("meter").setAttribute("aria-label", `Retiros ${Math.round(pct)}% de lo que quedó después de compras y gastos`);
  box.hidden = false;
  if (m.retiro <= neto) { box.className = "result ok"; box.textContent = `El dueño se llevó el ${Math.round(pct)}% de lo que quedó después de compras y gastos.`; }
  else { box.className = "result bad"; box.textContent = `El dueño sacó ${money0(m.retiro - neto)} más de lo que quedó: se está comiendo el capital.`; }
}
function revisarCaja() {
  const v = parseFloat($("c-real").value), r = $("c-res");
  if (isNaN(v)) { r.hidden = true; return; }
  const d = Math.round((v - S.esperado) * 100) / 100;
  r.hidden = false;
  if (Math.abs(d) < 0.01) { r.className = "result ok"; r.textContent = "La caja cuadra exacto."; }
  else if (d > 0) { r.className = "result ok"; r.textContent = `Sobran ${money(d)}. Revise si falta anotar alguna venta.`; }
  else { r.className = "result bad"; r.textContent = `Faltan ${money(-d)}. Revise ventas al crédito, gastos o retiros sin anotar.`; }
}
$("c-real").addEventListener("input", revisarCaja);
$("b-cierre").addEventListener("click", async () => {
  const v = parseFloat($("c-real").value);
  if (isNaN(v) || v < 0) { setSt("cierre-st", "Primero cuente el efectivo y escríbalo en «Efectivo que hay en la gaveta».", "err"); $("c-real").focus(); return; }
  const t = S.cajaT, b = $("b-cierre"); b.disabled = true;
  const fila = {
    negocio_id: S.negocio.id, fecha: t.hasta, fecha_desde: t.desde === t.hasta ? null : t.desde, efectivo_inicial: t.inicial, ventas_contado: t.contado, abonos: t.abono,
    compras: t.compra + t.pago_compra, gastos: t.gasto, retiros: t.retiro, esperado: Math.round(S.esperado * 100) / 100, contado: Math.round(v * 100) / 100,
    diferencia: Math.round((v - S.esperado) * 100) / 100, updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("cierres").upsert(fila, { onConflict: "negocio_id,fecha" });
  b.disabled = false;
  if (error) { setSt("cierre-st", traducirError(error), "err"); return; }
  setSt("cierre-st", "Cierre " + (t.desde === t.hasta ? "del " : "") + textoRango(t.desde, t.hasta) + " guardado.", "ok");
  $("h-mes").value = "";
  pintarCaja();
});
$("h-mes").addEventListener("change", pintarHistorial);
$("h-ultimos").addEventListener("click", () => { $("h-mes").value = ""; pintarHistorial(); });
const DIAS_HISTORIAL = 10;
const sumarDias = (f, n) => { const { y, m, d } = partes(f); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const celdaDif = (d) => Math.abs(d) < 0.01 ? `<span class="dif-ok">Cuadra</span>` : d > 0 ? `<span class="dif-ok">+${money(d)}</span>` : `<span class="dif-bad">−${money(-d)}</span>`;
async function pintarHistorial() {
  const mes = $("h-mes").value;
  $("h-ultimos").hidden = !mes;
  $("h-titulo").textContent = mes ? "Cierres guardados en este mes" : `Últimos ${DIAS_HISTORIAL} días`;
  if (mes) {
    // Un mes elegido: los cierres que se guardaron en ese mes
    const [desde, hasta] = rangoMes(mes + "-01");
    const { data, error } = await sb.from("cierres").select("fecha,fecha_desde,esperado,contado,diferencia")
      .eq("negocio_id", S.negocio.id).gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false });
    if (error) { toast(traducirError(error)); return; }
    const filas = data || [];
    $("h-vacio").textContent = "No hay cierres guardados en este mes.";
    $("h-vacio").hidden = filas.length > 0;
    $("historial").innerHTML = filas.map((c) => `<tr><td>${rangoCorto(c.fecha_desde, c.fecha)}</td><td>${money(c.esperado)}</td><td>${money(c.contado)}</td><td>${celdaDif(Number(c.diferencia))}</td></tr>`).join("");
    return;
  }
  // Sin mes: siempre los últimos 10 días, con o sin cierre guardado
  const hasta = hoyLocal(), desde = sumarDias(hasta, -(DIAS_HISTORIAL - 1));
  const [rc, rm] = await Promise.all([
    sb.from("cierres").select("fecha,fecha_desde,esperado,contado,diferencia").eq("negocio_id", S.negocio.id)
      .gte("fecha", desde).lte("fecha", sumarDias(hasta, MAX_DIAS_CIERRE)).order("fecha"),
    sb.from("movimientos").select("fecha,tipo,monto").eq("negocio_id", S.negocio.id).gte("fecha", desde).lte("fecha", hasta).limit(5000),
  ]);
  if (rc.error || rm.error) { toast(traducirError(rc.error || rm.error)); return; }
  const cierres = rc.data || [];
  const inicial = Number(S.negocio.efectivo_inicial || 0);
  const filas = [];
  for (let i = 0; i < DIAS_HISTORIAL; i++) {
    const dia = sumarDias(hasta, -i);
    const propio = cierres.find((c) => c.fecha === dia);
    const dentro = cierres.find((c) => c.fecha_desde && c.fecha_desde <= dia && c.fecha > dia);
    if (propio) {
      filas.push(`<tr><td>${rangoCorto(propio.fecha_desde, propio.fecha)}</td><td>${money(propio.esperado)}</td><td>${money(propio.contado)}</td><td>${celdaDif(Number(propio.diferencia))}</td></tr>`);
    } else if (dentro) {
      filas.push(`<tr class="sin-cierre"><td>${rangoCorto(dia, dia)}</td><td colspan="3" class="muted">Incluido en el cierre del ${rangoCorto(dentro.fecha_desde, dentro.fecha)}</td></tr>`);
    } else {
      const t = totales((rm.data || []).filter((m) => m.fecha === dia));
      const esperado = inicial + t.contado + t.abono - t.compra - t.pago_compra - t.gasto - t.retiro;
      filas.push(`<tr class="sin-cierre"><td>${rangoCorto(dia, dia)}</td><td>${money(esperado)}</td><td><span class="dif-bad">Sin cierre</span></td><td>—</td></tr>`);
    }
  }
  $("h-vacio").hidden = true;
  $("historial").innerHTML = filas.join("");
}
$("c-inicial").addEventListener("change", async (e) => {
  const v = Math.max(0, Number(e.target.value) || 0);
  const { error } = await sb.from("negocios").update({ efectivo_inicial: v }).eq("id", S.negocio.id);
  if (error) { toast(traducirError(error)); return; }
  S.negocio.efectivo_inicial = v; toast("Efectivo inicial guardado"); pintarCaja();
});

/* ---------- Fotos y audios guardados ---------- */
async function pintarArchivo() {
  const { data, error } = await sb.from("capturas").select("id,tipo,archivo_path,archivo_borrado,estado,transcripcion,resultado,error,created_at")
    .eq("negocio_id", S.negocio.id).order("created_at", { ascending: false }).limit(30);
  if (error) { toast(traducirError(error)); return; }
  const caps = data || [];
  $("cap-vacio").hidden = caps.length > 0;
  let urls = {};
  const vivos = caps.filter((c) => !c.archivo_borrado);
  if (vivos.length) {
    const { data: firm } = await sb.storage.from("capturas").createSignedUrls(vivos.map((c) => c.archivo_path), 3600);
    (firm || []).forEach((f) => { if (f.signedUrl) urls[f.path] = f.signedUrl; });
  }
  const fmt = new Intl.DateTimeFormat("es-SV", { timeZone: CFG.zonaHoraria, dateStyle: "medium", timeStyle: "short" });
  $("capturas").innerHTML = caps.map((c) => {
    const u = urls[c.archivo_path];
    const n = c.resultado?.lineas?.length || 0;
    const estado = c.estado === "procesada" ? `<span class="chip c-contado">${n} movimientos leídos</span>` : c.estado === "error" ? `<span class="chip c-gasto">No se pudo leer</span>` : `<span class="chip c-fiado">Pendiente</span>`;
    const medio = c.archivo_borrado ? `<p class="muted archivo-borrado">${c.tipo === "foto" ? "La foto" : "El audio"} se borró después de 1 día para liberar espacio.</p>` : !u ? "" : c.tipo === "foto" ? `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Foto del cuaderno" loading="lazy"></a>` : `<audio controls preload="none" src="${u}"></audio>`;
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
$("f-exp").addEventListener("submit", (e) => { e.preventDefault(); pintarExpediente(); });
const fISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function fechaCorta(f) { const { y, m, d } = partes(f); return `${d} de ${MESES[m - 1]} de ${y}`; }
// Trae todos los movimientos del período, de 1000 en 1000 (límite de Supabase por consulta)
async function movimientosRango(desde, hasta) {
  const todos = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await sb.from("movimientos").select("fecha,tipo,monto").eq("negocio_id", S.negocio.id)
      .gte("fecha", desde).lte("fecha", hasta).order("fecha").order("id").range(i * 1000, i * 1000 + 999);
    if (error) throw error;
    todos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return todos;
}
// Tres modelos de gráfico para el expediente
let EXP = null;
const MODELOS_GRAF = { barras: "Ventas en barras", linea: "Cómo van las ventas", comparar: "Ventas y gastos" };
let modeloGraf = MODELOS_GRAF[leerLocal("ordena:grafico-exp")] ? leerLocal("ordena:grafico-exp") : "barras";
document.querySelectorAll("#exp-modelos button").forEach((btn) => btn.addEventListener("click", () => {
  modeloGraf = btn.dataset.modelo; guardarLocal("ordena:grafico-exp", modeloGraf); dibujarGrafico();
}));
function dibujarGrafico() {
  document.querySelectorAll("#exp-modelos button").forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.modelo === modeloGraf)));
  if (!EXP) return;
  const { meses, porDia, prom } = EXP, comparar = modeloGraf === "comparar";
  meses.forEach((x) => (x.salidas = x.compra + x.compra_credito + x.gasto + x.retiro));
  const W = 640, x0 = 56, y0 = 30, base = 220;
  const max = Math.max(porDia ? 50 : 500, ...meses.map((x) => comparar ? Math.max(x.ventas, x.salidas) : x.ventas)) * 1.15;
  const paso = Math.pow(10, Math.floor(Math.log10(max / 3)));
  const tick = Math.ceil(max / 3 / paso) * paso;
  const bw = (W - x0 - 20) / meses.length, yy = (v) => base - (v / (tick * 3)) * (base - y0);
  const centro = (i) => x0 + i * bw + bw / 2;
  const etiquetas = meses.length <= 8;
  let s = "";
  for (let v = 0; v <= tick * 3; v += tick) {
    s += `<line x1="${x0}" x2="${W - 10}" y1="${yy(v)}" y2="${yy(v)}" stroke="var(--line)"/><text x="${x0 - 8}" y="${yy(v) + 4}" text-anchor="end" font-size="12" fill="var(--muted)">${money0(v)}</text>`;
  }
  meses.forEach((x, i) => {
    if (meses.length <= 12 || i % Math.ceil(meses.length / 12) === 0) s += `<text x="${centro(i)}" y="${base + 18}" text-anchor="middle" font-size="12" fill="var(--muted)">${x.lbl}</text>`;
  });
  const valor = (cx, y, v, color) => `<text x="${cx}" y="${y - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="${color}">${money0(v)}</text>`;
  if (modeloGraf === "barras") {
    meses.forEach((x, i) => {
      const w = bw * 0.6, cx = centro(i) - w / 2, last = i === meses.length - 1;
      s += `<rect x="${cx}" y="${yy(x.ventas)}" width="${w}" height="${base - yy(x.ventas)}" rx="3" fill="var(--accent)" fill-opacity="${last ? 1 : 0.45}"><title>${x.lbl}: ${money0(x.ventas)}</title></rect>`;
      if (x.ventas > 0 && etiquetas) s += valor(centro(i), yy(x.ventas), x.ventas, "var(--ink)");
    });
    // La etiqueta del promedio va arriba, como leyenda, para no taparse con el valor de las barras
    if (prom > 0) s += `<line x1="${x0}" x2="${W - 10}" y1="${yy(prom)}" y2="${yy(prom)}" stroke="var(--ink)" stroke-dasharray="4 4"/><line x1="${x0}" x2="${x0 + 22}" y1="12" y2="12" stroke="var(--ink)" stroke-dasharray="4 4"/><text x="${x0 + 28}" y="16" font-size="12" fill="var(--ink)">Promedio ${money0(prom)}</text>`;
  } else if (modeloGraf === "linea") {
    const pts = meses.map((x, i) => [centro(i), yy(x.ventas)]);
    const linea = pts.map((p) => p.join(",")).join(" ");
    s += `<polygon points="${pts[0][0]},${base} ${linea} ${pts[pts.length - 1][0]},${base}" fill="var(--accent)" fill-opacity="0.15"/>`;
    s += `<polyline points="${linea}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    meses.forEach((x, i) => {
      if (meses.length <= 31) s += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="${meses.length > 12 ? 3 : 5}" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5"><title>${x.lbl}: ${money0(x.ventas)}</title></circle>`;
      if (x.ventas > 0 && etiquetas) s += valor(pts[i][0], pts[i][1] - 2, x.ventas, "var(--ink)");
    });
  } else {
    meses.forEach((x, i) => {
      const w = bw * 0.36, c = centro(i);
      s += `<rect x="${c - w}" y="${yy(x.ventas)}" width="${w}" height="${base - yy(x.ventas)}" rx="2" fill="var(--accent)"><title>${x.lbl} · ventas: ${money0(x.ventas)}</title></rect>`;
      s += `<rect x="${c}" y="${yy(x.salidas)}" width="${w}" height="${base - yy(x.salidas)}" rx="2" fill="var(--bad)"><title>${x.lbl} · compras, gastos y retiros: ${money0(x.salidas)}</title></rect>`;
      if (etiquetas && meses.length <= 6) {
        if (x.ventas > 0) s += valor(c - w / 2, yy(x.ventas), x.ventas, "var(--accent)");
        if (x.salidas > 0) s += valor(c + w / 2, yy(x.salidas), x.salidas, "var(--bad)");
      }
    });
    s += `<rect x="${x0}" y="6" width="12" height="12" rx="2" fill="var(--accent)"/><text x="${x0 + 18}" y="16" font-size="12" fill="var(--ink)">Ventas</text>`;
    s += `<rect x="${x0 + 90}" y="6" width="12" height="12" rx="2" fill="var(--bad)"/><text x="${x0 + 108}" y="16" font-size="12" fill="var(--ink)">Compras, gastos y retiros</text>`;
  }
  $("chart").innerHTML = s;
  $("chart").setAttribute("aria-label", MODELOS_GRAF[modeloGraf] + (porDia ? " por día" : " por mes"));
  const tv = meses.reduce((a, x) => a + x.ventas, 0), ts = meses.reduce((a, x) => a + x.salidas, 0);
  const txt = modeloGraf === "comparar"
    ? (tv - ts >= 0 ? `En este período vendió ${money(tv)} y salieron ${money(ts)} en compras, gastos y retiros. Le quedaron ${money(tv - ts)}.` : `En este período salió más dinero (${money(ts)}) del que vendió (${money(tv)}).`)
    : modeloGraf === "linea" ? "La línea muestra si sus ventas suben o bajan con el tiempo."
    : `Cada barra es lo que vendió ${porDia ? "ese día" : "ese mes"}. La línea punteada es su promedio.`;
  $("exp-explica").textContent = txt;
}
async function pintarExpediente() {
  const hoy = hoyLocal(), { y: hy, m: hm } = partes(hoy);
  if (!$("exp-desde").value || !$("exp-hasta").value) {
    $("exp-hasta").value = hoy;
    $("exp-desde").value = fISO(new Date(hy, hm - 6, 1));
  }
  $("exp-desde").max = $("exp-hasta").max = hoy;
  const okF = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  let a = $("exp-desde").value, b = $("exp-hasta").value;
  if (!okF(a) || !okF(b)) { setSt("exp-st", "Elija las dos fechas en el calendario.", "err"); return; }
  if (a > b) { [a, b] = [b, a]; $("exp-desde").value = a; $("exp-hasta").value = b; }
  const dias = diasEntre(a, b) + 1;
  if (dias > 731) { setSt("exp-st", "Elija un período de 2 años o menos.", "err"); return; }
  setSt("exp-st", "Cargando...");
  let movs;
  try { movs = await movimientosRango(a, b); } catch (err) { setSt("exp-st", traducirError(err), "err"); return; }
  setSt("exp-st", "");
  // Hasta 31 días: una barra por día. Más: una barra por mes.
  const porDia = dias <= 31;
  const meses = [];
  const pa = partes(a), pb = partes(b);
  if (porDia) {
    for (let i = 0; i < dias; i++) { const d = new Date(pa.y, pa.m - 1, pa.d + i); meses.push({ key: fISO(d), lbl: String(d.getDate()), contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0, compra: 0, compra_credito: 0, pago_compra: 0 }); }
  } else {
    const n = (pb.y - pa.y) * 12 + (pb.m - pa.m) + 1;
    for (let i = 0; i < n; i++) { const d = new Date(pa.y, pa.m - 1 + i, 1); meses.push({ key: fISO(d).slice(0, 7), lbl: MESES_C[d.getMonth()], contado: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0, compra: 0, compra_credito: 0, pago_compra: 0 }); }
  }
  const idx = new Map(meses.map((x) => [x.key, x]));
  movs.forEach((r) => { const x = idx.get(porDia ? r.fecha : r.fecha.slice(0, 7)); if (x) x[r.tipo] += Number(r.monto); });
  meses.forEach((x) => (x.ventas = x.contado + x.fiado));
  $("exp-titulo").textContent = `${S.negocio.nombre} · del ${fechaCorta(a)} al ${fechaCorta(b)}`;
  const conVentas = meses.filter((x) => x.ventas > 0);
  const prom = conVentas.length ? conVentas.reduce((a, x) => a + x.ventas, 0) / conVentas.length : 0;
  EXP = { meses, porDia, prom };
  dibujarGrafico();

  const tot = meses.reduce((a, x) => { ["ventas", "fiado", "abono", "gasto", "retiro", "compra", "compra_credito"].forEach((k) => (a[k] += x[k])); return a; }, { ventas: 0, fiado: 0, abono: 0, gasto: 0, retiro: 0, compra: 0, compra_credito: 0, pago_compra: 0 });
  const primero = conVentas[0], ultimo = conVentas[conVentas.length - 1];
  const crec = primero && ultimo && primero !== ultimo && primero.ventas > 0 ? ((ultimo.ventas / primero.ventas - 1) * 100) : null;
  $("exp-stats").innerHTML = [
    [`Ventas en ${dias} ${dias === 1 ? "día" : "días"}`, money0(tot.ventas)],
    [porDia ? "Venta diaria promedio" : "Venta mensual promedio", money0(prom)],
    ["Crecimiento", crec === null ? "—" : (crec >= 0 ? "+" : "") + crec.toFixed(1) + "%"],
    ["Créditos recuperados", tot.fiado > 0 ? Math.round(Math.min(1, tot.abono / tot.fiado) * 100) + "%" : "—"],
    ["Compras al contado", money0(tot.compra)],
    ["Compras al crédito", money0(tot.compra_credito)],
    ["Gastos del negocio", money0(tot.gasto)],
    ["Retiros del dueño", money0(tot.retiro)],
  ].map(([a, b]) => `<div><span class="eyebrow">${a}</span><b class="num">${b}</b></div>`).join("");
}

/* ---------- Consultar movimientos ---------- */
const MAX_CONSULTA = 5000;
const GRUPOS_TIPO = { ventas: ["contado", "fiado"], compras: ["compra", "compra_credito"] };
const SALIDAS = ["gasto", "retiro", "compra", "pago_compra"];
let CONSULTA = [];
function ponerRango(r) {
  const hoy = hoyLocal(), { y, m } = partes(hoy);
  let a = hoy, b = hoy;
  if (r === "7") a = masDias(hoy, -6);
  if (r === "mes") a = rangoMes(hoy)[0];
  if (r === "pasado") [a, b] = rangoMes(fISO(new Date(y, m - 2, 1)));
  $("b-desde").value = a; $("b-hasta").value = b;
}
function abrirConsulta() {
  const hoy = hoyLocal();
  cargarPreguntas();
  $("b-desde").max = $("b-hasta").max = hoy;
  if (!$("b-desde").value) ponerRango("mes");
  const sel = $("b-cliente"), antes = sel.value;
  sel.innerHTML = `<option value="">Todos</option>` + S.saldos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  sel.value = [...sel.options].some((o) => o.value === antes) ? antes : "";
  if ($("b-res").hidden) consultar();
}
document.querySelectorAll("[data-rango]").forEach((b) => b.addEventListener("click", () => { ponerRango(b.dataset.rango); consultar(); }));
$("f-buscar").addEventListener("submit", (e) => { e.preventDefault(); consultar(); });
$("b-tipo").addEventListener("change", consultar);
$("b-cliente").addEventListener("change", consultar);
async function consultar() {
  let a = $("b-desde").value, b = $("b-hasta").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) { setSt("b-st", "Elija las dos fechas en el calendario.", "err"); return; }
  if (a > b) { [a, b] = [b, a]; $("b-desde").value = a; $("b-hasta").value = b; }
  const tipo = $("b-tipo").value, cliente = $("b-cliente").value, palabras = norm($("b-texto").value).split(/\s+/).filter(Boolean);
  setSt("b-st", "Buscando...");
  const filas = [];
  try {
    for (let i = 0; i < MAX_CONSULTA / 1000; i++) {
      let q = sb.from("movimientos").select("id,fecha,hora,tipo,descripcion,proveedor,monto,vence,origen,cliente_id,clientes(nombre)")
        .eq("negocio_id", S.negocio.id).gte("fecha", a).lte("fecha", b);
      if (GRUPOS_TIPO[tipo]) q = q.in("tipo", GRUPOS_TIPO[tipo]); else if (tipo) q = q.eq("tipo", tipo);
      if (cliente) q = q.eq("cliente_id", cliente);
      const { data, error } = await q.order("fecha", { ascending: false }).order("hora", { ascending: false }).order("id").range(i * 1000, i * 1000 + 999);
      if (error) throw error;
      filas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  } catch (err) { setSt("b-st", traducirError(err), "err"); return; }
  CONSULTA = palabras.length
    ? filas.filter((m) => { const t = norm(m.descripcion + " " + (m.proveedor || "") + " " + (m.clientes?.nombre || "") + " " + TIPOS[m.tipo]); return palabras.every((p) => t.includes(p)); })
    : filas;
  setSt("b-st", filas.length >= MAX_CONSULTA ? `Se muestran los primeros ${MAX_CONSULTA}. Elija menos días para ver todo.` : "");
  pintarConsulta(a, b);
}
function pintarConsulta(a, b) {
  $("b-res").hidden = false;
  const n = CONSULTA.length;
  $("b-titulo").textContent = `${n} ${n === 1 ? "movimiento" : "movimientos"} · ${a === b ? fechaC2(a) : `del ${fechaC2(a)} al ${fechaC2(b)}`}`;
  $("b-vacio").hidden = n > 0; $("b-csv").hidden = !n;
  const t = totales(CONSULTA);
  const caja = [["Ventas al contado", t.contado], ["Ventas al crédito", t.fiado], ["Abonos", t.abono], ["Compras al contado", t.compra], ["Compras al crédito", t.compra_credito], ["Pagos a proveedores", t.pago_compra], ["Gastos", t.gasto], ["Retiros", t.retiro]];
  $("b-totales").innerHTML = caja.filter(([, v]) => v > 0).map(([k, v]) => `<div><span class="eyebrow">${k}</span><b class="num">${money(v)}</b></div>`).join("");
  const porFecha = new Map();
  CONSULTA.forEach((m) => { if (!porFecha.has(m.fecha)) porFecha.set(m.fecha, []); porFecha.get(m.fecha).push(m); });
  $("b-lista").innerHTML = [...porFecha].map(([f, lista]) => {
    const { y } = partes(f), anio = y !== partes(hoyLocal()).y ? ` de ${y}` : "";
    return `<p class="b-fecha">${fechaLarga(f)}${anio}</p><ul class="list">${lista.map((m) => {
      const neg = SALIDAS.includes(m.tipo) ? "−" : "";
      const extra = [String(m.hora || "").slice(0, 5), m.clientes ? esc(m.clientes.nombre) : "", m.proveedor ? esc(m.proveedor) : "", m.vence ? "pagar el " + fechaC2(m.vence) : ""].filter(Boolean).join(" · ");
      return `<li><span class="chip c-${m.tipo}">${TIPOS[m.tipo]}</span><span class="desc">${esc(m.descripcion)}<small class="num">${extra}</small></span><span class="amt">${neg}${money(m.monto)}</span></li>`;
    }).join("")}</ul>`;
  }).join("");
}
$("b-csv").addEventListener("click", () => {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = [["Fecha", "Hora", "Tipo", "Descripción", "Cliente", "Proveedor", "Monto", "Fecha para pagar"].map(q).join(",")]
    .concat(CONSULTA.map((m) => [m.fecha, String(m.hora || "").slice(0, 5), TIPOS[m.tipo], m.descripcion, m.clientes?.nombre || "", m.proveedor || "", (SALIDAS.includes(m.tipo) ? -1 : 1) * Number(m.monto), m.vence || ""].map(q).join(",")));
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `movimientos-${$("b-desde").value}-al-${$("b-hasta").value}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- Pregúntele a la IA ---------- */
const PREGUNTAS_POR_DIA = 5;
function inicioDiaUTC() { const { y, m, d } = partes(hoyLocal()); return new Date(Date.UTC(y, m - 1, d, 6)).toISOString(); } // 00:00 en El Salvador
function pintarQuedan(n) {
  $("ia-quedan").textContent = n === 1 ? "Le queda 1 pregunta hoy" : `Le quedan ${n} preguntas hoy`;
  $("ia-quedan").className = "chip ia-quedan " + (n > 0 ? "estado-ok" : "estado-30");
  $("ia-enviar").disabled = n <= 0;
  $("ia-pregunta").disabled = n <= 0;
  $("ia-pregunta").placeholder = n > 0 ? "Escriba su pregunta…" : "Ya usó sus preguntas de hoy. Mañana puede preguntar de nuevo.";
}
const respuestaHTML = (p) => `<div class="ia-par"><p class="ia-q">${esc(p.pregunta)}</p><p class="ia-a">${esc(p.respuesta)}</p></div>`;
async function cargarPreguntas() {
  const { data, error } = await sb.from("preguntas_ia").select("pregunta,respuesta,created_at")
    .eq("negocio_id", S.negocio.id).gte("created_at", inicioDiaUTC()).order("created_at", { ascending: false });
  if (error) return;
  pintarQuedan(Math.max(0, PREGUNTAS_POR_DIA - (data || []).length));
  $("ia-respuestas").innerHTML = (data || []).map(respuestaHTML).join("");
}
$("ia-sugeridas").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || $("ia-pregunta").disabled) return;
  $("ia-pregunta").value = b.textContent; $("ia-pregunta").focus();
});
$("ia-pregunta").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("f-ia").requestSubmit(); } });
$("f-ia").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pregunta = $("ia-pregunta").value.trim();
  if (pregunta.length < 3) { setSt("ia-st", "Escriba su pregunta.", "err"); $("ia-pregunta").focus(); return; }
  const b = $("ia-enviar"); b.disabled = true;
  setSt("ia-st", "La IA está revisando sus datos… puede tardar unos segundos.");
  try {
    const { data: ses } = await sb.auth.getSession();
    const r = await fetch("/api/preguntar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ses.session?.access_token}` },
      body: JSON.stringify({ negocio_id: S.negocio.id, pregunta }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setSt("ia-st", j.error || "No se pudo responder. Intente de nuevo.", "err"); if (typeof j.quedan === "number") pintarQuedan(j.quedan); else b.disabled = false; return; }
    setSt("ia-st", "");
    $("ia-pregunta").value = "";
    $("ia-respuestas").insertAdjacentHTML("afterbegin", respuestaHTML({ pregunta, respuesta: j.respuesta }));
    pintarQuedan(j.quedan);
  } catch (err) {
    setSt("ia-st", "No se pudo conectar. Revise su internet e intente de nuevo.", "err"); b.disabled = false;
  }
});

/* ---------- pestañas ---------- */
const VISTAS = ["hoy", "fiados", "compras", "caja", "archivo", "buscar", "expediente"];
function mostrarTab() {
  if ($("v-app").hidden || !S.negocio) return;
  const v = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "hoy";
  VISTAS.forEach((n) => ($("v-" + n).hidden = n !== v));
  document.querySelectorAll(".tabbar a").forEach((a) => {
    if (a.dataset.view === v) { a.setAttribute("aria-current", "page"); $("menu-actual").textContent = a.lastElementChild.textContent; } else a.removeAttribute("aria-current");
  });
  cerrarMenu();
  if (v === "caja") pintarCaja();
  if (v === "archivo") pintarArchivo();
  if (v === "compras") pintarCompras();
  if (v === "buscar") abrirConsulta();
  if (v === "expediente") pintarExpediente();
}
window.addEventListener("hashchange", mostrarTab);
function cerrarMenu() { $("menu").classList.remove("abierto"); $("menu-btn").setAttribute("aria-expanded", "false"); }
$("menu-btn").addEventListener("click", () => {
  const abierto = $("menu").classList.toggle("abierto");
  $("menu-btn").setAttribute("aria-expanded", String(abierto));
});
$("menu-lista").addEventListener("click", cerrarMenu);
document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) cerrarMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarMenu(); });

/* ---------- arranque ---------- */
sb.auth.getSession().then(({ data }) => { if (!data.session) mostrarPantalla("auth"); });
})();
