import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch, FieldPath, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { firebaseConfig, ADMIN_EMAILS } from "./config.js";

/* ================= utilities ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const ym = d => d.getFullYear() + "-" + pad(d.getMonth() + 1);
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d || 1); };
const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY = ymd(today), THISMONTH = ym(today);
const yen = n => "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP");
const num = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("ja-JP");
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const md = s => { if (!s) return ""; const d = parse(s); return (d.getMonth() + 1) + "/" + d.getDate() + "(" + DOW[d.getDay()] + ")"; };
const monthLabel = m => { const [y, mm] = m.split("-"); return y + "年" + Number(mm) + "月"; };
const shiftMonth = (m, k) => { const d = parse(m + "-01"); d.setMonth(d.getMonth() + k); return ym(d); };
/* カレンダーは日曜始まり */
const weekStart = d => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
// 定例ミーティング：毎月 第2・第4木曜日。KPIの進捗はこの2回の時点で入力する
function meetingsOfMonth(m) {
  const first = parse(m + "-01"); const off = (4 - first.getDay() + 7) % 7; // 最初の木曜日
  const y = first.getFullYear(), mo = first.getMonth();
  return [ymd(new Date(y, mo, 1 + off + 7)), ymd(new Date(y, mo, 1 + off + 21)), ymd(new Date(y, mo + 1, 0))]; // 第2木・第4木・月末
}
const NEXTMTG = [...meetingsOfMonth(THISMONTH), ...meetingsOfMonth(shiftMonth(THISMONTH, 1))].find(x => x >= TODAY);
const mtgLabel = d => { const mt = meetingsOfMonth(d.slice(0, 7)); return mt[0] === d ? "第2木" : mt[1] === d ? "第4木" : "月末"; };
const mtgName = d => mtgLabel(d) === "月末" ? "月末" : "MTG";
const ls = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
/* 拡大・縮小させない（スマホの2本指拡大・ダブルタップ拡大を止める） */
try { localStorage.removeItem("uiZoom"); } catch (_) { }
["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
/* トースト：type = "success" | "error" | "info" | "warn"。同時に出すのは1つだけ（新しいものが前のものと入れ替わる） */
const TOAST_ICON = {
  success: '<path d="M20 6 9 17l-5-5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
  warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>'
};
function toast(msg, type = "success", opts = {}) {
  const box = $("#toasts"); if (!box) return;
  const el = document.createElement("div");
  el.className = "toast t-" + type; el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<svg class="t-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOAST_ICON[type] || TOAST_ICON.info}</svg><span class="t-msg"></span>${opts.action ? `<button type="button" class="t-act"></button>` : ""}<button type="button" class="t-x" aria-label="閉じる">×</button>`;
  el.querySelector(".t-msg").textContent = msg;
  const close = () => { if (el.dataset.closing) return; el.dataset.closing = "1"; el.classList.add("out"); setTimeout(() => el.remove(), 200); };
  if (opts.action) { const b = el.querySelector(".t-act"); b.textContent = opts.action.label; b.addEventListener("click", () => { close(); opts.action.run(); }); }
  el.querySelector(".t-x").addEventListener("click", close);
  [...box.children].forEach(c => c.remove());
  box.appendChild(el);
  const ms = opts.duration || (type === "error" ? 6000 : opts.action ? 5000 : 2800);
  let timer = setTimeout(close, ms);
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => { timer = setTimeout(close, 1500); });
}
function errMsg(e) {
  const c = e && e.code || "";
  if (c.includes("permission-denied")) return "この操作をする権限がありません。";
  if (c.includes("unavailable")) return "通信できませんでした。電波の良い場所でもう一度試してください。";
  return "うまくいきませんでした（" + (c || "不明なエラー") + "）。もう一度試してください。";
}

/* ================= firebase ================= */
const configured = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
let auth, db, fbApp;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app); fbApp = app;
}

const DEFAULTS = {
  // 仮の選択肢（管理 → 設定で変更できる）
  routines: ["MTG", "営業・商談", "開発", "SNS投稿", "ユーザー対応", "経理・事務", "採用"],
  incomeCats: ["サブスク売上", "B2B売上", "借入金", "その他"],
  expenseCats: ["Anam.ai", "LLM API", "サーバー・ドメイン", "広告", "外注", "ツール・サブスク", "その他"],
  methods: ["銀行振込", "クレジット", "現金", "立替"]
};
// 毎月デフォルトで用意するKPI（管理者がその月を初めて開いたときに自動で追加）。SHIN用の指標は後で決める
const DEFAULT_KPIS = [];
const KPI_TEMPLATES = DEFAULT_KPIS;

const TABS_ALL = [["home", "ホーム"], ["cal", "業務カレンダー"], ["kpi", "KPI"], ["forms", "フォーム"], ["templates", "テンプレ一覧"], ["minutes", "議事録"], ["money", "収支"], ["admin", "管理（設定・メンバー）"]];
const TAB_ICON = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  kpi: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  templates: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  forms: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  money: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 9.5v.01M18 15.5v.01"/>',
  minutes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  admin: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M17 4.5a3.5 3.5 0 0 1 0 7M19 14.8c1.3.9 2.2 2.6 2.5 5.2"/>'
};
const S = {
  user: null, member: null, isAdmin: false, dataKey: "",
  members: [], config: null, tasks: [], kpis: [], ledger: [],
  ready: {}, need: [],
  tab: "home", adminSub: "settings", forms: [], kpiMonth: THISMONTH, calMonth: THISMONTH, repMonth: THISMONTH, tplCat: "all", selDay: TODAY, moneyMonth: THISMONTH,
  onlyMine: ls.get("shin_onlymine", "0") === "1"
};
let memberUnsub = null, permsUnsub = null, dataUnsubs = [];
const cfg = () => Object.assign({}, DEFAULTS, S.config || {});
const uid = () => S.user && S.user.uid;
const isActive = () => S.isAdmin || (S.member && S.member.status === "active");
const ROLES = [["sub", "副管理者"], ["member", "メンバー"], ["intern", "インターン"], ["viewer", "閲覧のみ"]];
/* ===== 権限の表：段階ごとに、機能の「見る・追加・全員分の編集」をオン・オフする（管理 → 設定 → 権限）。
   同じ内容を firestore.rules でも確認するので、画面で隠すだけではない ===== */
const WS_DOMAIN = "shincareer.com";
const isWS = e => /@shincareer\.com$/i.test(e || "");
const PERM_DEFS = [
  ["業務カレンダー", [["cal_view", "見る"], ["cal_add", "登録する（自分が登録した分の編集・担当分の完了）"], ["cal_editAll", "全員の業務を編集・削除"]]],
  ["未対応事項", [["issue_add", "追加する（自分の分の編集・担当分の完了）"], ["issue_editAll", "全員の分を編集・削除"]]],
  ["KPI", [["kpi_input", "担当のKPIに進捗を入力"], ["kpi_viewAll", "公開範囲に関係なく、すべてのKPIを見る"], ["kpi_manage", "KPIの作成・編集・削除"]]],
  ["フォーム", [["forms_view", "見る"], ["forms_manage", "追加・編集"]]],
  ["テンプレ一覧", [["tpl_view", "見る"], ["tpl_add", "追加する（自分の分の編集）"], ["tpl_editAll", "全員の分を編集・削除"]]],
  ["議事録", [["min_view", "見る"], ["min_add", "追加する（自分の分の編集）"], ["min_editAll", "全員の分を編集・削除"]]],
  ["収支", [["fin_add", "記録を追加（自分が追加した記録だけ見られる）"], ["fin_view", "すべての記録と集計を見る（shincareer.com のアカウントのみ）"], ["fin_edit", "すべての記録を編集・削除（shincareer.com のアカウントのみ）"]]]
];
const PERM_KEYS = PERM_DEFS.flatMap(([, a]) => a.map(([k]) => k));
// オンにすると、前提になる項目も自動でオンにする（例：全員分の編集 → 登録 → 見る）
const PERM_DEPS = { cal_add: ["cal_view"], cal_editAll: ["cal_add"], issue_editAll: ["issue_add"], kpi_manage: ["kpi_viewAll", "kpi_input"], forms_manage: ["forms_view"], tpl_add: ["tpl_view"], tpl_editAll: ["tpl_add"], min_add: ["min_view"], min_editAll: ["min_add"], fin_view: ["fin_add"], fin_edit: ["fin_view"] };
const P = keys => Object.fromEntries(PERM_KEYS.map(k => [k, keys.includes(k)]));
const DEFAULT_PERMS = {
  sub: P(PERM_KEYS.filter(k => k !== "fin_edit")),
  member: P(["cal_view", "cal_add", "issue_add", "kpi_input", "forms_view", "tpl_view", "tpl_add", "min_view", "min_add", "fin_add"]),
  intern: P(["cal_view", "cal_add", "issue_add", "kpi_input", "forms_view", "tpl_view", "min_view", "fin_add"]),
  viewer: P(["cal_view", "forms_view", "tpl_view", "min_view"])
};
const roleOf = m => (m && ROLES.some(([k]) => k === m.role)) ? m.role : "member";
const myRole = () => S.isAdmin ? "admin" : roleOf(S.member);
const permsOf = r => Object.assign({}, DEFAULT_PERMS[r] || {}, (S.perms && S.perms[r]) || {});
const can = key => S.isAdmin || (isActive() && permsOf(myRole())[key] === true);
const myWS = () => isWS(S.user && S.user.email);
const finView = () => S.isAdmin || (can("fin_view") && myWS());   // すべての記録・集計
const finEdit = () => S.isAdmin || (can("fin_edit") && myWS());   // すべての記録の編集・CSV取り込み
const finAdd = () => finEdit() || can("fin_add");                 // 記録の追加（自分の分）
const roleHelp = r => { const p = permsOf(r); const on = PERM_DEFS.filter(([, a]) => a.some(([k]) => p[k])).map(([g, a]) => g + (a.filter(([k]) => p[k]).length === a.length ? "（すべて）" : "（一部）")); return on.length ? on.join("・") : "ほぼ何もできない"; };
const roleLabel = r => ({ admin: "管理者", sub: "副管理者", member: "メンバー", viewer: "閲覧のみ" })[r] || "メンバー";
const rolePill = r => r === "member" ? "" : `<span class="pill ${r === "viewer" ? "plain" : "info"}">${roleLabel(r)}</span>`;
const activeMembers = () => S.members.filter(m => m.status === "active").sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
const memName = id => { const m = S.members.find(x => x.id === id); return m ? (m.name || m.email || "名前未設定") : "（不明）"; };
const MEMBER_COLORS = ["#1E5FC4", "#0E8A82", "#C27A12", "#C2417A", "#6B4FC2", "#4A7A2A", "#D2462F", "#2E86B8", "#8A5A3C", "#5B6578"];
const mColor = id => {
  const m = S.members.find(x => x.id === id);
  if (m && m.color && /^#[0-9A-Fa-f]{6}$/.test(m.color)) return m.color;
  const i = activeMembers().findIndex(x => x.id === id);
  return i < 0 ? "var(--muted)" : MEMBER_COLORS[i % MEMBER_COLORS.length];
};
const whoTag = id => `<span class="who" style="--mc:${mColor(id)}"><i></i>${esc(memName(id))}</span>`;
const TAB_PERM = { cal: "cal_view", forms: "forms_view", templates: "tpl_view", minutes: "min_view" };
const tabsVisible = () => TABS_ALL.filter(([k]) => (k !== "money" || finAdd()) && (k !== "admin" || S.isAdmin) && (!TAB_PERM[k] || can(TAB_PERM[k])));

/* ================= auth & data lifecycle ================= */
function stopData() { dataUnsubs.forEach(u => u()); dataUnsubs = []; S.ready = {}; S.need = []; S.tasks = []; S.kpis = []; S.ledger = []; S.ledgerRaw = []; S.mine = []; S.members = []; S.config = null; S.priv = null; S.decCache = {}; S.vaultPub = null; S.vaultKey = null; S.pendingRecovery = null; }
function resetAll() { if (memberUnsub) { memberUnsub(); memberUnsub = null; } if (permsUnsub) { permsUnsub(); permsUnsub = null; } stopData(); S.member = null; S.isAdmin = false; S.dataKey = ""; S.perms = null; S.permsReady = false; }
/* 権限（本人の段階と権限の表）が変わったら、読み込むデータを組み直す */
function syncData() {
  const key = isActive() && S.permsReady ? ["on", myRole(), JSON.stringify(permsOf(myRole())), finView() ? "F" : finAdd() ? "a" : "-"].join("|") : "off";
  if (key !== S.dataKey) { stopData(); S.dataKey = key; if (key !== "off") startData(); }
  render();
}

if (configured) {
  getRedirectResult(auth).catch(e => console.warn(e));
  onAuthStateChanged(auth, async u => {
    resetAll(); S.user = u; S.authReady = true;
    if (!u) { render(); return; }
    S.isAdmin = !!u.email && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(u.email.toLowerCase());
    const ref = doc(db, "members", u.uid);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // 管理者が先に招待していれば、その内容（表示名・色・収支閲覧）で自動的に利用開始
        let inv = null;
        if (!S.isAdmin && u.email) { try { const is = await getDoc(doc(db, "invites", u.email.toLowerCase())); if (is.exists()) inv = is.data(); } catch (e) { } }
        const base = { email: u.email || "", createdAt: serverTimestamp() };
        if (S.isAdmin) await setDoc(ref, { ...base, name: u.displayName || u.email || "", status: "active", finance: false });
        else if (inv) await setDoc(ref, { ...base, name: inv.name, status: "active", finance: !!inv.finance, role: roleOf(inv), ...(inv.color ? { color: inv.color } : {}) });
        else await setDoc(ref, { ...base, name: u.displayName || u.email || "", status: "pending", finance: false });
      }
    } catch (e) { S.fatal = errMsg(e); render(); return; }
    memberUnsub = onSnapshot(ref, s => {
      S.member = s.exists() ? s.data() : null;
      if (isActive() && !permsUnsub) {
        permsUnsub = onSnapshot(doc(db, "config", "perms"), ps => { S.perms = ps.exists() ? ps.data() : null; S.permsReady = true; syncData(); },
          e => { console.warn("perms", e); S.permsReady = true; syncData(); });
      }
      syncData();
    }, e => { S.fatal = errMsg(e); render(); });
  });
}

function listen(key, ref, fn) {
  S.need.push(key);
  dataUnsubs.push(onSnapshot(ref, snap => { fn(snap); S.ready[key] = true; render(); }, e => { console.warn(key, e); S.ready[key] = true; render(); }));
}
const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
/* 最終利用日時：アプリを開いたとき（10分に1回まで）に自分の名簿に記録する */
function touchSeen() {
  if (!S.user || !isActive() || !S.member) return;
  const last = Number(memGet("seenAt") || 0); if (Date.now() - last < 10 * 60 * 1000) return;
  memSet("seenAt", Date.now());
  updateDoc(doc(db, "members", uid()), { lastSeen: serverTimestamp() }).catch(e => console.warn("lastSeen", e));
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") touchSeen(); });
function seenLabel(t) {
  const ms = t && t.toMillis ? t.toMillis() : 0; if (!ms) return "記録なし";
  const diff = Date.now() - ms, d = new Date(ms), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (diff < 15 * 60e3) return "たった今";
  if (diff < 60 * 60e3) return Math.floor(diff / 60e3) + "分前";
  const day = ymd(d);
  if (day === TODAY) return "今日 " + hm;
  const y = new Date(); y.setDate(y.getDate() - 1); if (day === ymd(y)) return "昨日 " + hm;
  return md(day) + " " + hm + (diff > 14 * 864e5 ? "（" + Math.floor(diff / 864e5) + "日前）" : "");
}
function startData() {
  setTimeout(touchSeen, 1500);
  if (notifyOn()) setTimeout(bindForeground, 0);
  listen("members", collection(db, "members"), s => S.members = docsOf(s));
  listen("config", doc(db, "config", "main"), s => S.config = s.exists() ? s.data() : null);
  // 権限の表がまだ無ければ、管理者が初期値で作る（ルールはこの表を見て判断する）
  if (S.isAdmin && !S.perms) setDoc(doc(db, "config", "perms"), DEFAULT_PERMS).catch(e => console.warn("perms seed", e));
  S.tasks = []; S.forms = []; S.minutes = []; S.templates = []; S.issues = [];
  if (can("cal_view")) listen("tasks", collection(db, "tasks"), s => S.tasks = docsOf(s));
  if (can("forms_view")) listen("forms", collection(db, "forms"), s => S.forms = docsOf(s));
  listen("issues", collection(db, "issues"), s => S.issues = docsOf(s));
  if (can("min_view")) listen("minutes", collection(db, "minutes"), s => S.minutes = docsOf(s));
  if (can("tpl_view")) listen("templates", collection(db, "templates"), s => S.templates = docsOf(s));
  if (S.isAdmin) listen("invites", collection(db, "invites"), s => S.invites = docsOf(s));
  if (can("kpi_manage") || can("kpi_viewAll")) listen("kpis", collection(db, "kpis"), s => S.kpis = docsOf(s));
  else {
    // 一般メンバーは「全員に公開」「自分に公開」「自分が担当」のKPIだけを取得（ルール上それ以外は読めない）
    const parts = {};
    const merge = () => { const m = {}; Object.values(parts).forEach(a => a.forEach(k => m[k.id] = k)); S.kpis = Object.values(m); };
    [["viewers", "array-contains", "all"], ["viewers", "array-contains", uid()], ["owner", "==", uid()]].forEach((w, i) =>
      listen("kpis" + i, query(collection(db, "kpis"), where(...w)), s => { parts[i] = docsOf(s); merge(); }));
  }
  // 収支：すべて見られる人は全件、追加だけの人は自分が追加した記録だけ（ルール上それ以外は読めない）
  if (finAdd()) listen("vaultPub", doc(db, "config", "vaultPub"), s => S.vaultPub = s.exists() ? s.data().pub : null);
  if (finView()) {
    listen("vaultKey", doc(db, "vault", "key"), s => S.vaultKey = s.exists() ? s.data() : null);
    listen("ledger", collection(db, "ledger"), s => { S.ledgerRaw = docsOf(s); decryptLedger(); });
    listen("accounts", collection(db, "accounts"), s => { S.accountsRaw = docsOf(s); decryptLedger(); });
  } else if (finAdd()) {
    listen("ledger", query(collection(db, "ledger"), where("createdBy", "==", uid())), s => { S.ledgerRaw = docsOf(s); mergeMine(); });
    listen("mine", query(collection(db, "ledgerMine"), where("createdBy", "==", uid())), s => { S.mine = docsOf(s); mergeMine(); });
  }
}

async function login() {
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) return signInWithRedirect(auth, p);
    if (e && e.code === "auth/popup-closed-by-user") return;
    toast(errMsg(e), "error");
  }
}

/* ================= KPI math ================= */
function kpiActual(k) {
  const w = k.weekly || {}; const keys = Object.keys(w).filter(x => w[x] && w[x].value !== null && w[x].value !== undefined && w[x].value !== "").sort();
  let base = { v: 0, has: false };
  if (keys.length) base = k.mode === "latest" ? { v: Number(w[keys[keys.length - 1]].value) || 0, has: true } : { v: keys.reduce((a, x) => a + (Number(w[x].value) || 0), 0), has: true };
  return base;
}
function monthElapsed(m) {
  if (m < THISMONTH) return 1; if (m > THISMONTH) return 0;
  return today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
}
function kpiStatus(k) {
  const a = kpiActual(k), t = Number(k.target) || 0, rate = t > 0 ? a.v / t : 0, el = monthElapsed(k.month);
  let st;
  if (!(t > 0)) st = { c: "plain", t: "目標未設定" };
  else if (k.month > THISMONTH) st = { c: "plain", t: "未開始" };
  else if (rate >= 1) st = { c: "good", t: "達成" };
  else if (k.month < THISMONTH) st = { c: "bad", t: "未達" };
  else if (!a.has) st = { c: "plain", t: "未報告" };
  else if (rate >= el * 0.9) st = { c: "info", t: "順調" };
  else st = { c: "warn", t: "遅れ" };
  return { a, t, rate, el, st };
}
/* 「記録のみ」のKPI：目標・達成率・ゲージを出さず、最新値と前回からの増減だけを見る */
const TRACK_NAMES = DEFAULT_KPIS.filter(d => d.track).map(d => d.name);
const isTrack = k => k.track === true || (k.track === undefined && TRACK_NAMES.includes(k.name));
function trackInfo(k) {
  const pts = []; const pushPts = (kk, label) => { const w = kk.weekly || {}; meetingsOfMonth(kk.month).forEach(d => { const e = w[d]; if (e && e.value !== null && e.value !== undefined && e.value !== "") pts.push({ d, v: Number(e.value), label }); }); };
  const prev = S.kpis.find(x => x.month === shiftMonth(k.month, -1) && x.name === k.name); if (prev) pushPts(prev, "先月");
  pushPts(k, "");
  const cur = pts.filter(p => p.d.slice(0, 7) === k.month);
  const last = cur[cur.length - 1] || null; const idx = last ? pts.indexOf(last) : -1; const before = idx > 0 ? pts[idx - 1] : null;
  return { last, before, delta: last && before ? last.v - before.v : null };
}
const deltaTag = (t, unit) => t.delta === null ? "" : `<span class="delta ${t.delta > 0 ? "up" : t.delta < 0 ? "down" : ""}">${t.delta > 0 ? "+" : t.delta < 0 ? "−" : "±"}${num(Math.abs(t.delta))}${esc(unit || "")}</span>`;
const sinceLabel = t => t.before ? `${t.before.d.slice(0, 7) !== t.last.d.slice(0, 7) ? "先月" : ""}${mtgLabel(t.before.d)}（${md(t.before.d)}）から` : "";
const viewersLabel = k => (!k.viewers || k.viewers.includes("all")) ? "全員に公開" : "公開：" + k.viewers.map(memName).join("・");
function kpiRow(k, withEdit) {
  const tap = withEdit ? "" : ` data-act="kpi-detail" data-id="${esc(k.id)}" role="button" tabindex="0" aria-label="${esc(k.name)}の詳細"`;
  const tools = withEdit && can("kpi_manage") ? ` <button class="link" type="button" data-act="kpi-edit" data-id="${esc(k.id)}">編集</button> <button class="link" type="button" style="color:var(--bad)" data-act="kpi-del" data-id="${esc(k.id)}">${S.armDel === k.id ? "本当に削除する（もう一度押す）" : "削除"}</button>` : "";
  if (isTrack(k)) {
    const t = trackInfo(k);
    return `<div class="kpi track${withEdit ? "" : " tap"}"${tap}>
    <div class="name">${esc(k.name)} <span class="pill plain">記録のみ</span>${tools}</div>
    <div class="nums">${t.last ? `<b>${cu(t.last.v, "num")}</b>` : `<b class="muted">—</b>`}${Number(k.target) > 0 ? ` / ${num(k.target)}` : ""}${esc(k.unit || "")} ${t.last ? deltaTag(t, k.unit) : `<span class="muted" style="font-size:.8rem">未記録</span>`}</div>
    <div class="meta"><span>担当：${whoTag(k.owner)}</span>${t.last ? `<span>${mtgLabel(t.last.d)}（${md(t.last.d)}）時点</span>` : ""}${t.delta !== null ? `<span>${esc(sinceLabel(t))}の増減</span>` : ""}${can("kpi_manage") ? `<span>${esc(viewersLabel(k))}</span>` : ""}</div>
  </div>`;
  }
  const s = kpiStatus(k); const w = Math.min(100, s.rate * 100);
  const cls = s.st.c === "good" ? "good" : (s.st.c === "warn" || s.st.c === "bad") ? "warn" : "";
  const pace = k.month === THISMONTH ? `<span class="pace" style="left:${(s.el * 100).toFixed(1)}%" title="今日時点の目安ペース"></span>` : "";
  return `<div class="kpi${withEdit ? "" : " tap"}"${tap}>
    <div class="name">${esc(k.name)} <span class="pill ${s.st.c}">${s.st.t}</span>${tools}</div>
    <div class="nums">${s.t > 0 ? `<b>${cu(s.a.v, "num")}</b> / ${num(s.t)}${esc(k.unit || "")} <span class="muted">（${Math.round(s.rate * 100)}%）</span>` : `<b>${num(s.a.v)}</b>${esc(k.unit || "")} <span class="muted">／ 目標未設定</span>`}</div>
    <div class="meter"><i class="${cls}" style="width:${w}%"></i>${pace}</div>
    <div class="meta"><span>担当：${whoTag(k.owner)}</span><span>${k.mode === "latest" ? "最新値で集計" : "MTG・月末ごとの合計で集計"}</span>${k.month === THISMONTH && s.t > 0 ? `<span>今日時点の目安：${num(s.t * s.el)}${esc(k.unit || "")}</span>` : ""}${can("kpi_manage") ? `<span>${esc(viewersLabel(k))}</span>` : ""}</div>
  </div>`;
}

/* ================= task helpers ================= */
const sharedAll = t => !t.shareWith || !t.shareWith.length || t.shareWith.includes("all");
const ownersOf = t => (Array.isArray(t.owners) && t.owners.length ? t.owners : (t.owner ? [t.owner] : []));
const isMine = t => ownersOf(t).includes(uid());
const whoTags = t => ownersOf(t).map(whoTag).join(" ") || `<span class="muted" style="font-size:.8rem">担当未定</span>`;
const ownerDots = t => ownersOf(t).map(o => `<i class="od" style="--mc:${mColor(o)}"></i>`).join("");
const relevant = t => sharedAll(t) || isMine(t) || (t.shareWith || []).includes(uid()) || t.createdBy === uid();
const canEditTask = t => can("cal_editAll") || (t.createdBy === uid() && can("cal_add"));
const canToggleTask = t => canEditTask(t) || (isMine(t) && can("cal_add"));
const taskTitle = t => t.label ? t.label : t.routine && t.routine !== "__other" ? t.routine : (t.detail || "（内容未記入）");
const timeLabel = t => !t.start ? "終日" : esc(t.start) + (t.end ? "–" + esc(t.end) : "〜");
const sortTasks = (a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || ""));
function taskItem(t, opts = {}) {
  const sw = sharedAll(t) ? "全員に共有" : "共有：" + t.shareWith.map(memName).join("・");
  const late = opts.late ? `<span class="pill bad">${daysBetween(t.date, TODAY)}日遅れ</span> ` : "";
  const sub = [opts.showDate ? md(t.date) : "", t.routine && t.routine !== "__other" && t.detail ? t.detail : "", sw, "登録：" + memName(t.createdBy)].filter(Boolean).join(" ／ ");
  return `<div class="task${t.done ? " done" : ""}" style="--mc:${mColor(ownersOf(t)[0])}">
    <div class="time">${timeLabel(t)}</div>
    <div><div class="what">${late}${esc(taskTitle(t))}${t.label && t.routine ? ` <span class="pill plain">${esc(t.routine)}</span>` : ""}</div><div class="whos">${whoTags(t)}</div></div>
    <div class="acts">${canToggleTask(t) ? `<label><input type="checkbox" data-act="task-done" data-id="${esc(t.id)}" ${t.done ? "checked" : ""}>完了</label>` : (t.done ? `<span class="pill good">完了</span>` : "")}<button class="link" type="button" data-act="task-open" data-id="${esc(t.id)}">${canEditTask(t) ? "編集" : "詳細"}</button></div>
    <div class="sub">${esc(sub)}</div>
  </div>`;
}
const sumBy = (rows, type) => rows.filter(r => r.type === type).reduce((a, r) => a + (Number(r.amount) || 0), 0);

/* ================= render ================= */
/* ===== アニメーション ===== */
/* ハンバーガーメニュー（左から出るドロワー） */
/* PC（横幅1024px以上）ではメニューを左側に常に表示する */
const DESK = window.matchMedia ? matchMedia("(min-width:1024px)") : { matches: false };
const deskNav = () => DESK.matches && document.body.classList.contains("has-nav");
/* PCで左メニューを閉じたかどうか（次に開いたときも覚えておく） */
let navCollapsed = (() => { try { return localStorage.getItem("shin_navCollapsed") === "1"; } catch (_) { return false; } })();
document.body.classList.toggle("nav-collapsed", navCollapsed);
function setDock(open) {
  navCollapsed = !open; try { localStorage.setItem("shin_navCollapsed", navCollapsed ? "1" : "0"); } catch (_) { }
  document.body.classList.add("dock-anim"); document.body.classList.toggle("nav-collapsed", navCollapsed);
  clearTimeout(setDock.t); setDock.t = setTimeout(() => document.body.classList.remove("dock-anim"), 400);
  setMenu(false);
}
function setMenu(open) {
  const d = $("#drawer"), bg = $("#drawer-bg"), b = $("#menu-btn"); if (!d) return;
  if (deskNav()) {
    d.classList.remove("open"); bg.classList.remove("open"); document.body.classList.remove("menu-open");
    if (navCollapsed) { d.setAttribute("inert", ""); if (d.contains(document.activeElement)) b.focus({ preventScroll: true }); } else d.removeAttribute("inert");
    b.setAttribute("aria-expanded", String(!navCollapsed)); b.setAttribute("aria-label", navCollapsed ? "メニューを開く" : "メニューを閉じる"); return;
  }
  b.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
  d.classList.toggle("open", open); bg.classList.toggle("open", open); document.body.classList.toggle("menu-open", open);
  if (open) { d.removeAttribute("inert"); b.setAttribute("aria-expanded", "true"); setTimeout(() => { const c = d.querySelector('[aria-current="page"]') || d.querySelector("button"); if (c) c.focus({ preventScroll: true }); }, 60); }
  else { d.setAttribute("inert", ""); b.setAttribute("aria-expanded", "false"); if (d.contains(document.activeElement)) b.focus({ preventScroll: true }); }
}
document.addEventListener("click", e => {
  if (e.target.closest("#menu-btn")) { if (deskNav()) setDock(navCollapsed); else setMenu(!$("#drawer").classList.contains("open")); return; }
  if (e.target.closest('[data-menu="close"]') && deskNav()) { setDock(false); return; }
  if (e.target.closest("#drawer-bg") || e.target.closest('[data-menu="close"]')) setMenu(false);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#drawer").classList.contains("open")) setMenu(false); });
document.addEventListener("keydown", e => { const t = e.target; if ((e.key === "Enter" || e.key === " ") && t.matches && t.matches('[role="button"][data-act]')) { e.preventDefault(); t.click(); } });
if (DESK.addEventListener) DESK.addEventListener("change", () => setMenu(false));
/* 左メニューの見出しの下線を、上部ヘッダーの下線と同じ高さにそろえる */
(() => { const mast = document.querySelector(".mast"); if (!mast) return;
  const sync = () => document.documentElement.style.setProperty("--mast-h", mast.offsetHeight + "px");
  sync(); if (window.ResizeObserver) new ResizeObserver(sync).observe(mast); else addEventListener("resize", sync); })();
function countUp(el) {
  const to = Number(el.dataset.v); const fmt = el.dataset.f; if (!isFinite(to)) return;
  const sign = el.dataset.sign || ""; const t0 = performance.now(), dur = 700;
  const show = v => el.textContent = sign + (fmt === "yen" ? yen(v) : num(v));
  const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); show(to * e); if (p < 1) requestAnimationFrame(step); else show(to); };
  show(0); requestAnimationFrame(step);
}
function runEnter(main, kind) {
  main.classList.remove("anim-in", "anim-l", "anim-r"); void main.offsetWidth;
  main.classList.add(kind === "l" ? "anim-l" : kind === "r" ? "anim-r" : "anim-in");
  main.querySelectorAll(".bar, .panel, .fig, .kpi, .task, .cal, .tablewrap tbody tr, .empty, .listedit .row, .legend").forEach((el, i) => el.style.setProperty("--i", Math.min(i, 14)));
  main.querySelectorAll(".cu").forEach(countUp);
  clearTimeout(runEnter.t); runEnter.t = setTimeout(() => main.classList.remove("anim-in", "anim-l", "anim-r"), 1100);
}
const cu = (v, f, sign = "") => `<span class="cu" data-v="${Math.abs(Number(v) || 0)}" data-f="${f}" data-sign="${sign}">${sign}${f === "yen" ? yen(Math.abs(v)) : num(v)}</span>`;
function renderChrome() {
  const tools = $("#mast-tools"), tabs = $("#tabs"), foot = $("#drawer-foot"), mb = $("#menu-btn");
  if (!S.user || !isActive()) {
    $("#page-title").textContent = "SHIN 運営ボード"; document.title = "SHIN 運営ボード";
    tabs.innerHTML = ""; foot.innerHTML = ""; mb.hidden = true; document.body.classList.remove("has-nav"); setMenu(false);
    tools.innerHTML = S.user ? `<span class="me">${esc(S.user.email || "")}</span><button class="ghost" type="button" data-act="logout">ログアウト</button>` : "";
    return;
  }
  const vis = tabsVisible(); if (!vis.some(([k]) => k === S.tab)) S.tab = "home";
  const pending = S.isAdmin ? S.members.filter(m => m.status === "pending").length : 0;
  mb.hidden = false; if (!document.body.classList.contains("has-nav")) { document.body.classList.add("has-nav"); setMenu(false); }
  tabs.innerHTML = vis.map(([k, l]) => `<button type="button" data-tab="${k}" ${k === S.tab ? 'aria-current="page"' : ""}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[k] || ""}</svg><span>${l}</span>${k === "admin" && pending ? `<span class="badge">${pending}</span>` : ""}</button>`).join("");
  mb.classList.toggle("has-badge", pending > 0);
  const meName = memName(uid()) !== "（不明）" ? memName(uid()) : (S.user.displayName || "");
  foot.innerHTML = `<div class="df-me"><b>${esc(meName)}</b><span class="muted">${esc(roleLabel(myRole()))}・${esc(S.user.email || "")}</span></div><div class="df-btns"><button class="btn sec small" type="button" data-act="logout">ログアウト</button></div>`;
  const cur = TABS_ALL.find(([k]) => k === S.tab);
  const pageName = cur ? cur[1].replace(/（.*）/, "") : "SHIN 運営ボード";
  $("#page-title").textContent = pageName; document.title = pageName + "｜SHIN";
  tools.innerHTML = `<button class="ghost" type="button" data-act="notify" aria-label="通知の設定" title="通知の設定"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>${notifyOn() ? "" : `<span class="dot-off"></span>`}</button>`;
}
function render() {
  renderChrome();
  const main = $("#main");
  if (!configured) { main.innerHTML = `<div class="center"><h2>初期設定が必要です</h2><p class="muted">config.js にFirebaseの設定値を入れてください。手順は README.md にあります。</p></div>`; return; }
  if (S.fatal) { main.innerHTML = `<div class="center"><h2>読み込めませんでした</h2><p class="muted">${esc(S.fatal)}</p></div>`; return; }
  if (!S.authReady) { main.innerHTML = skeleton(S.tab); return; }
  if (!S.user) {
    main.innerHTML = `<div class="center"><h2>運営メンバー専用ページです</h2><p class="muted">Googleアカウントでログインしてください。はじめての方は、ログイン後に管理者の承認を受けると使えるようになります。</p>
      <p><button class="gbtn" type="button" data-act="login"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.5-9.5 6.5-16.1z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.4v5.7C8 41 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.4C2.9 17.2 2 20.5 2 24s.9 6.8 2.4 9.8l7.3-5.7z"/><path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8 7 4.4 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.3-9.1z"/></svg>Googleでログイン</button></p></div>`;
    return;
  }
  if (!S.member && !S.isAdmin) { main.innerHTML = skeleton(S.tab); return; }
  if (!isActive()) {
    const stopped = S.member && S.member.status === "inactive";
    main.innerHTML = `<div class="center"><h2>${stopped ? "利用が停止されています" : "承認待ちです"}</h2><p class="muted">${stopped ? "管理者に確認してください。" : `管理者が承認すると、このページが使えるようになります。承認されたら自動で切り替わります。`}</p><p class="muted" style="font-size:.85rem">ログイン中：${esc(S.user.email || "")}</p></div>`;
    return;
  }
  if (!S.need.length || !S.need.every(k => S.ready[k])) { if (!main.querySelector(".sk-wrap")) main.innerHTML = skeleton(S.tab); return; }
  const views = { home: vHome, kpi: vKpi, cal: vCal, forms: vForms, money: vMoney, minutes: vMinutes, templates: vTemplates, admin: vAdmin };
  if (S.tab === "admin" && S.adminSub === "settings" && (S.settingsDirty || S.dragging) && main.querySelector("[data-list]")) return;
  // パスワードを入力している途中は、データが更新されても画面を描き直さない
  const vp = main.querySelector(".vault-box #v-pass"); if (S.tab === "money" && vp && vp.value) return;
  const prevScroll = window.scrollY;
  const anim = S.anim || (main.querySelector(".sk-wrap") ? "in" : null); S.anim = null;
  main.innerHTML = views[S.tab]();
  if (anim && !reducedMotion()) runEnter(main, anim);
  refreshSheet();
  if (S.tab === "templates") applyTplFilter();
  if (S.pulse) { const el = main.querySelector(S.pulse); S.pulse = null; if (el && !reducedMotion()) { el.classList.remove("pulse-in"); void el.offsetWidth; el.classList.add("pulse-in"); } }
  if (S.isAdmin) { setTimeout(() => { seedMonth(THISMONTH); if (S.tab === "kpi") seedMonth(S.kpiMonth); }, 0); }
  window.scrollTo(0, prevScroll);
}
const seeding = new Set();
async function seedMonth(m) {
  if (!S.isAdmin || m < THISMONTH || seeding.has(m)) return;
  const seeded = (S.config && S.config.kpiSeeded) || [];
  if (seeded.includes(m)) return;
  seeding.add(m);
  const cur = S.kpis.filter(k => k.month === m), prev = S.kpis.filter(k => k.month === shiftMonth(m, -1));
  const b = writeBatch(db); let n = 0;
  DEFAULT_KPIS.forEach((d, i) => {
    if (cur.some(k => k.name === d.name)) return;
    const p = prev.find(k => k.name === d.name);
    b.set(doc(db, "kpis", m + "-" + d.key), { name: d.name, unit: d.unit, mode: d.mode, track: p ? isTrack(p) : !!d.track, target: p ? p.target : null, owner: p ? p.owner : uid(), viewers: p ? (p.viewers || ["all"]) : ["all"], month: m, weekly: {}, order: i + 1, createdAt: serverTimestamp() }); n++;
  });
  // 空の月なら、先月に追加していた独自のKPIも目標ごと引き継ぐ
  if (!cur.length) prev.filter(k => !DEFAULT_KPIS.some(d => d.name === k.name)).forEach((k, i) => {
    b.set(doc(collection(db, "kpis")), { name: k.name, unit: k.unit || "", mode: k.mode, track: isTrack(k), target: k.target ?? null, owner: k.owner, viewers: k.viewers || ["all"], month: m, weekly: {}, order: 100 + i, createdAt: serverTimestamp() }); n++;
  });
  b.set(doc(db, "config", "main"), { kpiSeeded: arrayUnion(m) }, { merge: true });
  try { await b.commit(); if (n) toast(monthLabel(m) + "のKPIを" + n + "件用意しました。目標を設定してください", "info", { duration: 5000 }); }
  catch (e) { seeding.delete(m); console.warn(e); }
}
/* スケルトン：読み込み中に、実際のレイアウトに近い形のグレーの枠を出す */
const sk = (w, h = 14, extra = "") => `<span class="sk" style="width:${w};height:${h}px;${extra}"></span>`;
const skLines = n => Array.from({ length: n }, (_, i) => `<div class="sk-row">${sk("4.5em")}<div class="sk-col">${sk(["70%", "55%", "62%"][i % 3])}${sk("38%", 10)}</div></div>`).join("");
const skPanel = (rows, title = "40%") => `<section class="panel" aria-hidden="true"><div style="margin-bottom:14px">${sk(title, 16)}</div>${skLines(rows)}</section>`;
const skKpi = n => Array.from({ length: n }, () => `<div class="kpi">${sk("45%", 16)}${sk("5em", 16)}<div style="grid-column:1/-1">${sk("100%", 10, "border-radius:5px")}</div>${sk("60%", 10)}</div>`).join("");
function skeleton(tab) {
  const head = `<div class="bar" aria-hidden="true">${sk("8em", 24)}<span style="margin-left:auto"></span>${sk("9em", 34, "border-radius:6px")}</div>`;
  let body;
  if (tab === "kpi") body = `<section class="panel">${skKpi(5)}</section>`;
  else if (tab === "cal") body = `<div class="callayout"><div class="cal sk-cal">${Array.from({ length: 35 }, () => `<div class="day">${sk("1.2em", 12)}</div>`).join("")}</div>${skPanel(3, "30%")}</div>`;
  else if (tab === "money") body = `<div class="figs">${Array.from({ length: 4 }, () => `<div class="fig">${sk("40%", 11)}<div style="margin-top:8px">${sk("70%", 22)}</div></div>`).join("")}</div>${skPanel(5, "25%")}`;
  else if (tab === "admin" || tab === "forms" || tab === "minutes" || tab === "reports" || tab === "templates") body = `<div class="grid2">${skPanel(4)}${skPanel(4)}</div>`;
  else body = `<div class="grid2"><div class="stack">${skPanel(2, "35%")}${skPanel(1, "45%")}</div><div class="stack"><section class="panel">${sk("35%", 16)}<div style="margin-top:14px">${skKpi(3)}</div></section></div></div>`;
  return `<div class="sk-wrap" role="status" aria-label="読み込み中">${head}${body}<span class="visually-hidden">読み込み中です</span></div>`;
}
function monthNav(key) { return `<div class="monthnav"><button type="button" data-act="mprev" data-k="${key}" aria-label="前の月">‹</button><button type="button" class="mlabel" data-act="mpick" data-k="${key}" aria-label="月を選ぶ（${monthLabel(S[key])}）">${monthLabel(S[key])}</button><button type="button" data-act="mnext" data-k="${key}" aria-label="次の月">›</button></div>`; }

function vHome() {
  const mine = S.tasks.filter(t => t.date === TODAY && (isMine(t) || sharedAll(t) || (t.shareWith || []).includes(uid()))).sort(sortTasks);
  const myOpen = mine.filter(t => !t.done).length;
  const overdue = S.tasks.filter(t => sharedAll(t) && !t.done && t.date < TODAY).sort(sortTasks);
  const issues = S.issues || [];
  const openIssues = issues.filter(i => !i.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  const doneIssues = issues.filter(i => i.done).sort((a, b) => (b.doneAt?.seconds || 0) - (a.doneAt?.seconds || 0)).slice(0, 20);
  const myLate = S.tasks.filter(t => !sharedAll(t) && isMine(t) && !t.done && t.date < TODAY).sort(sortTasks);
  const ks = S.kpis.filter(k => k.month === THISMONTH).sort((a, b) => (a.order || 0) - (b.order || 0));
  const untilMtg = daysBetween(TODAY, NEXTMTG);
  const mtgKpis = S.kpis.filter(k => k.month === NEXTMTG.slice(0, 7));
  const myKpiNoReport = untilMtg <= 7 && can("kpi_input") ? mtgKpis.filter(k => k.owner === uid() && !((k.weekly || {})[NEXTMTG] && (k.weekly || {})[NEXTMTG].value !== null)) : [];
  return `<div class="bar"><h2>${md(TODAY)}</h2><span class="muted">${esc(memName(uid()))}さん</span></div>
  <div class="grid2 home-grid">
    <div class="stack">
      <section class="panel"><h3>今日やること<span class="hint">${myOpen ? `残り${myOpen}件` : ""}</span></h3>
        ${myOpen ? mine.filter(t => !t.done).map(t => taskItem(t)).join("") : `<p class="muted" style="margin:0">${mine.length ? "今日の業務はすべて完了しました。" : "今日の業務はありません。"}</p>`}
        ${myKpiNoReport.length ? `<div class="banner" style="margin:12px 0 0">${untilMtg === 0 ? "今日" : untilMtg === 1 ? "明日" : untilMtg + "日後"}の${mtgName(NEXTMTG) === "月末" ? "月末締め" : "MTG"}（${md(NEXTMTG)}）までにKPIの報告をお願いします：${myKpiNoReport.map(k => esc(k.name)).join("、")} <button class="link" type="button" data-act="go" data-tab="kpi">入力する</button></div>` : ""}
      </section>
      <section class="panel"><h3>未対応（全体共有）<span class="hint">${openIssues.length + overdue.length}件</span>${can("issue_add") ? `<button class="btn small" type="button" data-act="issue-new">＋ 追加</button>` : ""}</h3>
        ${openIssues.length ? openIssues.map(issueItem).join("") : ""}
        ${overdue.length ? `<div class="sub-head">期限を過ぎた業務</div>` + overdue.map(t => taskItem(t, { late: true, showDate: true })).join("") : ""}
        ${!openIssues.length && !overdue.length ? `<p class="muted" style="margin:0">未対応の事項はありません。${can("issue_add") ? "気づいたことは「＋ 追加」で登録できます。" : ""}</p>` : ""}
        ${doneIssues.length ? `<button class="link done-toggle" type="button" data-act="issue-showdone">${S.showDoneIssues ? "完了済みを隠す" : `完了済み ${doneIssues.length}件を表示`}</button>${S.showDoneIssues ? `<div class="done-list">${doneIssues.map(issueItem).join("")}</div>` : ""}` : ""}
      </section>
      ${myLate.length ? `<section class="panel"><h3>自分の未対応<span class="hint">${myLate.length}件</span></h3>${myLate.map(t => taskItem(t, { late: true, showDate: true })).join("")}</section>` : ""}
    </div>
    <div class="stack">
      <section class="panel"><h3>今月のKPI<button class="link hint" type="button" data-act="go" data-tab="kpi">進捗を入力</button></h3>
        ${ks.length ? ks.map(k => kpiRow(k, false)).join("") : `<p class="muted" style="margin:0">${can("kpi_manage") ? "今月のKPIはまだ設定されていません。" : "表示できる今月のKPIはありません。"}</p>`}
      </section>
    </div>
  </div>`;
}

function vKpi() {
  const m = S.kpiMonth; const ks = S.kpis.filter(k => k.month === m).sort((a, b) => (a.order || 0) - (b.order || 0));
  const weeks = meetingsOfMonth(m); const prev = S.kpis.filter(k => k.month === shiftMonth(m, -1));
  const head = `<div class="bar"><h2 class="vh">KPI</h2>${monthNav("kpiMonth")}${can("kpi_manage") ? `<button class="btn" type="button" data-act="kpi-new">KPIを追加</button>` : ""}</div>`;
  if (!ks.length) {
    if (!can("kpi_manage")) return head + `<div class="empty"><p>${monthLabel(m)}に表示できるKPIはありません。</p></div>`;
    return head + `<div class="empty"><p>${monthLabel(m)}の月次目標はまだありません。</p>
      ${prev.length ? `<p><button class="btn sec" type="button" data-act="kpi-carry">先月のKPI（${prev.length}件）を引き継ぐ</button></p>` : ""}
      ${KPI_TEMPLATES.length ? `<p class="muted" style="font-size:.85rem">指標を追加する：</p>
      <div class="tpls">${KPI_TEMPLATES.map((t, i) => `<button class="btn sec small" type="button" data-act="kpi-tpl" data-i="${i}">${esc(t.name)}</button>`).join("")}</div>` : `<p><button class="btn small" type="button" data-act="kpi-new">最初のKPIを追加</button></p>`}</div>`;
  }
  const rows = ks.map(k => {
    const w = k.weekly || {}; const editable = can("kpi_manage") || (k.owner === uid() && can("kpi_input"));
    const tools = can("kpi_manage") ? `<div class="kpi-tools"><button class="link" type="button" data-act="kpi-edit" data-id="${esc(k.id)}">編集</button></div>` : "";
    const tgt = Number(k.target) > 0 ? `目標 ${num(k.target)}${esc(k.unit || "")}` : "目標未設定";
    return `<tr><td><span class="kname"><b>${esc(k.name)}</b>${isTrack(k) ? ` <span class="pill plain">記録のみ</span>` : ""}</span><div class="muted" style="font-size:.75rem">${esc(memName(k.owner))}・${k.mode === "latest" ? "最新値" : "合計"}・${tgt}</div>${tools}</td>
      ${weeks.map(wk => { const v = w[wk] && w[wk].value !== null && w[wk].value !== undefined ? w[wk].value : "";
        return `<td class="num${wk === NEXTMTG ? " now" : ""}" data-label="${mtgLabel(wk)} ${md(wk).replace(/\(.\)/, "")}" data-short="${mtgLabel(wk)}">${editable ? `<input class="cell" id="c-${esc(k.id)}-${wk}" type="number" inputmode="decimal" step="any" aria-label="${esc(k.name)} ${mtgLabel(wk)} ${md(wk)}" data-act="kpi-cell" data-id="${esc(k.id)}" data-wk="${wk}" value="${esc(v)}">` : (v === "" ? `<span class="muted">—</span>` : num(v))}</td>`; }).join("")}</tr>`;
  }).join("");
  return head + `<section class="panel kpi-entry"><h3>MTG・月末ごとの進捗入力<span class="hint hide-sm">進捗はホームで確認</span></h3>
      <p class="kpi-note">第2・第4木曜のMTGと月末に、担当者が実績を入力します。入力すると自動で保存されます。</p>
      <details class="kpi-rule"><summary>何を入れればいい？</summary><ul>
        <li><b>最新値</b>：その時点の数（例：フォロワー数）</li>
        <li><b>合計</b>：前回から増えた分（第2木＝月初から／第4木＝第2木の翌日から／月末＝第4木の翌日から）</li></ul></details>
      <div class="tablewrap"><table><thead><tr><th>指標</th>${weeks.map(wk => `<th class="num${wk === NEXTMTG ? " now" : ""}">${mtgLabel(wk)} ${md(wk).replace(/\(.\)/, "")}${wk === NEXTMTG ? "<br>次回" : ""}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}

function vCal() {
  const m = S.calMonth; const first = parse(m + "-01"); const start = weekStart(first);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const endGrid = new Date(last); endGrid.setDate(endGrid.getDate() + (6 - last.getDay()));
  const vis = S.onlyMine ? S.tasks.filter(t => isMine(t) || (t.shareWith || []).includes(uid()) || t.createdBy === uid()) : S.tasks.filter(relevant);
  const byDay = {}; vis.forEach(t => { (byDay[t.date] = byDay[t.date] || []).push(t); });
  let cells = DOW.map((d, i) => `<div class="dow${i === 0 ? " sun" : i === 6 ? " sat" : ""}">${d}</div>`).join("");
  for (let d = new Date(start); d <= endGrid; d.setDate(d.getDate() + 1)) {
    const k = ymd(d); const list = (byDay[k] || []).sort(sortTasks);
    const cls = ["day", ym(d) !== m ? "out" : "", k === TODAY ? "today" : "", k === S.selDay ? "sel" : ""].join(" ");
    cells += `<button type="button" class="${cls}" data-act="day" data-d="${k}" aria-label="${md(k)} 予定${list.length}件">
      <span class="d"><span>${d.getDate()}</span></span>
      ${list.slice(0, 3).map(t => `<span class="chip${t.done ? " done" : ""}" style="--mc:${mColor(ownersOf(t)[0])}">${ownersOf(t).length > 1 ? `<span class="chip-dots">${ownerDots(t)}</span>` : ""}${esc(t.start || "")} ${esc(taskTitle(t))}</span>`).join("")}
      ${list.length > 3 ? `<span class="more">ほか${list.length - 3}件</span>` : ""}
      <span class="dots">${list.map(t => `<i style="--mc:${mColor(ownersOf(t)[0])}"></i>`).join("")}</span></button>`;
  }
  const dayList = (byDay[S.selDay] || []).sort(sortTasks);
  return `<div class="bar"><h2 class="vh">業務カレンダー</h2>
    <label class="muted" style="font-size:.85rem;display:flex;gap:6px;align-items:center"><input type="checkbox" id="onlymine" data-act="onlymine" ${S.onlyMine ? "checked" : ""}>自分に関係する業務だけ</label>
    ${monthNav("calMonth")}${can("cal_add") ? `<button class="btn" type="button" data-act="task-new">業務を登録</button>` : `<span class="pill plain">閲覧のみ</span>`}</div>
  <div class="callayout">
    <div class="stack"><div class="cal">${cells}</div>
      <div class="legend">${activeMembers().map(m => whoTag(m.id)).join("")}</div></div>
    <section class="panel day-panel"><h3>${md(S.selDay)}${S.selDay === TODAY ? "　今日" : ""}${can("cal_add") ? `<button class="btn small" style="margin-left:auto" type="button" data-act="task-new" data-d="${S.selDay}">この日に登録</button>` : ""}</h3>
      ${dayList.length ? dayList.map(t => taskItem(t)).join("") : `<p class="muted" style="margin:0">この日の業務はありません。</p>`}
    </section>
  </div>`;
}

/* ===== 銀行残高（照会用）：クレジットカードは「毎月15日締め・翌月10日引き落とし（休日なら翌営業日）」で反映 ===== */
const isCard = r => /クレジット|カード/.test(r.method || "");
function nthMonday(y, mo, n) { const d = new Date(y, mo, 1); const first = (8 - d.getDay()) % 7 + 1; return first + (n - 1) * 7; }
function isBankHoliday(d) {
  const y = d.getFullYear(), mo = d.getMonth(), day = d.getDate(), w = d.getDay();
  if (w === 0 || w === 6) return true;
  if ((mo === 0 && day <= 3) || (mo === 11 && day === 31)) return true;   // 年末年始
  const fixed = { "0-1": 1, "1-11": 1, "1-23": 1, "3-29": 1, "4-3": 1, "4-4": 1, "4-5": 1, "7-11": 1, "10-3": 1, "10-23": 1 };
  const equinox = { [`2-${Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))}`]: 1, [`8-${Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))}`]: 1 };
  const happy = { [`0-${nthMonday(y, 0, 2)}`]: 1, [`6-${nthMonday(y, 6, 3)}`]: 1, [`8-${nthMonday(y, 8, 3)}`]: 1, [`9-${nthMonday(y, 9, 2)}`]: 1 };
  const key = (m, dd) => `${m}-${dd}`; const isHol = (m, dd) => fixed[key(m, dd)] || equinox[key(m, dd)] || happy[key(m, dd)];
  if (isHol(mo, day)) return true;
  // 振替休日：日曜の祝日の翌日（月曜）
  if (w === 1) { const prev = new Date(y, mo, day - 1); if (isHol(prev.getMonth(), prev.getDate())) return true; }
  return false;
}
function cardClosing(useDate) { const d = parse(useDate); return ymd(new Date(d.getFullYear(), d.getMonth() + (d.getDate() <= 15 ? 0 : 1), 15)); }
function cardPayDate(useDate) {
  const d = parse(useDate); const add = d.getDate() <= 15 ? 1 : 2;
  const p = new Date(d.getFullYear(), d.getMonth() + add, 10);
  while (isBankHoliday(p)) p.setDate(p.getDate() + 1);
  return ymd(p);
}
function bankBalance(asOf) {
  let bal = 0; const upcoming = {};
  S.ledger.forEach(r => {
    if (!r.date) return; const amt = Number(r.amount) || 0;
    if (r.type === "収入") { if (r.date <= asOf) bal += amt; return; }
    if (r.type !== "支出") return;
    if (!isCard(r)) { if (r.date <= asOf) bal -= amt; return; }
    const pay = cardPayDate(r.date);
    if (pay <= asOf) bal -= amt;
    else if (r.date <= asOf) { const u = upcoming[pay] = upcoming[pay] || { date: pay, closing: cardClosing(r.date), amount: 0, count: 0 }; u.amount += amt; u.count++; }   // 使ったが、まだ引き落とされていない分
  });
  const list = Object.values(upcoming).sort((a, b) => a.date.localeCompare(b.date));
  // 次回・その次の引き落とし（利用がなくても日付は出す）
  const pays = []; let probe = parse(asOf);
  for (let i = 0; pays.length < 2 && i < 4; i++) {
    const c = new Date(probe.getFullYear(), probe.getMonth() + i, 15);
    const pd = cardPayDate(ymd(c));
    if (pd > asOf && !pays.some(p => p.date === pd)) pays.push(list.find(x => x.date === pd) || { date: pd, closing: ymd(c), amount: 0, count: 0 });
  }
  return { bal, pending: list.reduce((a, b) => a + b.amount, 0), pays };
}
/* ===================== 収支の暗号化 =====================
   ・記録は「書き込み用の鍵（公開鍵）」で暗号化して保存する。メンバーや自動取り込み（Stripe）はこの鍵で書ける
   ・読むための鍵（秘密鍵）は「閲覧用パスワード」で暗号化して保存し、収支を開くときだけ、この端末の中で元に戻す
   ・パスワードはサーバーに送らない。忘れたときは、設定時に表示した「復旧キー」で新しいパスワードにできる
   ・データベースには暗号文しか入らないので、アカウントが乗っ取られても、パスワードがなければ中身は読めない */
const subtle = () => { if (!(window.crypto && crypto.subtle)) throw new Error("このブラウザでは暗号化が使えません（https のページで開いてください）。"); return crypto.subtle; };
const b64 = buf => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const u8 = s => new TextEncoder().encode(s);
const EC = { name: "ECDH", namedCurve: "P-256" };
const PASS_ITER = 600000, RECOVERY_ITER = 100000, LOCK_MIN = 15;
async function pwKey(secret, salt, iter) {
  const base = await subtle().importKey("raw", u8(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function sealWith(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await subtle().encrypt({ name: "AES-GCM", iv }, key, bytes)) }; }
async function openWith(key, box) { return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct))); }
async function wrapSecret(bytes, secret, iter) { const salt = crypto.getRandomValues(new Uint8Array(16)); return { salt: b64(salt), iter, ...(await sealWith(await pwKey(secret, salt, iter), bytes)) }; }
async function unwrapSecret(w, secret) { return openWith(await pwKey(secret, unb64(w.salt), w.iter), w); }
const importPriv = pkcs8 => subtle().importKey("pkcs8", pkcs8, EC, false, ["deriveBits"]);
async function aesFrom(bits, epk) { const h = await subtle().digest("SHA-256", new Uint8Array([...new Uint8Array(bits), ...epk])); return subtle().importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]); }
async function sealRaw(bytes, pubB64) {
  const pub = await subtle().importKey("spki", unb64(pubB64), EC, false, []);
  const eph = await subtle().generateKey(EC, true, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
  const epk = new Uint8Array(await subtle().exportKey("raw", eph.publicKey));
  return { v: 1, epk: b64(epk), ...(await sealWith(await aesFrom(bits, epk), bytes)) };
}
async function openRaw(box, priv) {
  const epk = unb64(box.epk);
  const pub = await subtle().importKey("raw", epk, EC, false, []);
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return openWith(await aesFrom(bits, epk), box);
}
const sealRecord = (obj, pubB64) => sealRaw(u8(JSON.stringify(obj)), pubB64);
const openRecord = async (box, priv) => JSON.parse(new TextDecoder().decode(await openRaw(box, priv)));
const RC = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const newRecoveryKey = () => [...crypto.getRandomValues(new Uint8Array(28))].map(x => RC[x % RC.length]).join("").match(/.{4}/g).join("-");
const normRecovery = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const LED_FIELDS = ["title", "type", "category", "amount", "date", "owner", "method", "settled", "memo", "account", "fromAccount", "toAccount"];
const ledPlain = o => Object.fromEntries(LED_FIELDS.map(k => [k, o[k] ?? ""]));
const vaultReady = () => !!(S.vaultPub && S.vaultKey);
/* 届いた暗号文を、ロックを解除している間だけ元に戻す（同じ暗号文は2回戻さない） */
let decSeq = 0;
async function decryptLedger() {
  if (!finView()) return;
  if (!S.priv) { S.ledger = []; S.accounts = []; return; }
  const seq = ++decSeq; S.decCache = S.decCache || {};
  const out = [];
  for (const r of S.ledgerRaw || []) {
    const meta = { id: r.id, createdBy: r.createdBy, confirmed: !!r.confirmed, updatedBy: r.updatedBy, createdAt: r.createdAt, source: r.source || "", hasReceipt: !!r.hasReceipt };
    if (!r.enc) { out.push({ ...meta, ...ledPlain(r), legacy: true }); continue; }
    const c = S.decCache[r.id];
    if (c && c.ct === r.enc.ct) { out.push({ ...meta, ...c.data }); continue; }
    try { const data = await openRecord(r.enc, S.priv); S.decCache[r.id] = { ct: r.enc.ct, data }; out.push({ ...meta, ...data }); }
    catch (e) { out.push({ ...meta, title: "（読み取れない記録）", type: "支出", amount: 0, date: "", broken: true }); }
  }
  const accs = [];
  for (const a of S.accountsRaw || []) {
    const c = S.decCache["acc:" + a.id];
    if (c && c.ct === a.enc.ct) { accs.push({ id: a.id, order: a.order, ...c.data }); continue; }
    try { const data = await openRecord(a.enc, S.priv); S.decCache["acc:" + a.id] = { ct: a.enc.ct, data }; accs.push({ id: a.id, order: a.order, ...data }); } catch (e) { accs.push({ id: a.id, order: a.order, name: "（読み取れない口座）" }); }
  }
  if (seq !== decSeq) return;
  S.ledger = out; S.accounts = accs; render();
}
/* 追加だけの人：自分用の控え（ledgerMine）と、確認状況（ledger の confirmed）を合わせて表示する */
function mergeMine() {
  if (finView()) return;
  S.ledger = (S.mine || []).filter(m => (S.ledgerRaw || []).some(r => r.id === m.id)).map(m => ({ ...m, confirmed: !!((S.ledgerRaw || []).find(r => r.id === m.id) || {}).confirmed }));
}
function lockVault(msg) { S.priv = null; S.ledger = []; S.accounts = []; S.decCache = {}; if (msg) toast(msg, "info"); render(); }
let lastActive = Date.now();
["pointerdown", "keydown", "scroll"].forEach(t => document.addEventListener(t, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => { if (S.priv && Date.now() - lastActive > LOCK_MIN * 60e3) lockVault(`${LOCK_MIN}分間操作がなかったので、収支をロックしました`); }, 30e3);
async function unlockVault(pass) {
  const pk = await unwrapSecret(S.vaultKey.wrapped, pass).catch(() => null);
  if (!pk) throw new Error("パスワードが違います。");
  S.priv = await importPriv(pk); lastActive = Date.now();
  await decryptLedger();
  if (finEdit()) migrateLegacy();
}
/* 暗号化を設定する前に入っていた記録（平文）を、暗号化して置き換える */
async function migrateLegacy() {
  const legacy = (S.ledgerRaw || []).filter(r => !r.enc && r.title !== undefined);
  if (!legacy.length || !S.vaultPub) return;
  for (let i = 0; i < legacy.length; i += 200) {
    const b = writeBatch(db);
    for (const r of legacy.slice(i, i + 200)) b.set(doc(db, "ledger", r.id), { enc: await sealRecord(ledPlain(r), S.vaultPub), createdBy: r.createdBy || uid(), createdAt: r.createdAt || serverTimestamp(), confirmed: r.confirmed !== false, updatedBy: uid(), updatedAt: serverTimestamp() });
    await b.commit();
  }
  toast(`暗号化する前の記録${legacy.length}件を暗号化しました`, "info");
}
async function setupVault(pass) {
  const kp = await subtle().generateKey(EC, true, ["deriveBits"]);
  const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", kp.privateKey));
  const pub = b64(await subtle().exportKey("spki", kp.publicKey));
  const rk = newRecoveryKey();
  await setDoc(doc(db, "vault", "key"), { wrapped: await wrapSecret(pkcs8, pass, PASS_ITER), recovery: await wrapSecret(pkcs8, normRecovery(rk), RECOVERY_ITER), pub, createdBy: uid(), createdAt: serverTimestamp() });
  await setDoc(doc(db, "config", "vaultPub"), { pub, createdAt: serverTimestamp() });
  S.vaultPub = pub; S.priv = await importPriv(pkcs8); S.pendingRecovery = rk; lastActive = Date.now();
  return rk;
}
async function rewrapVault(fromSecret, isRecovery, newPass) {
  const pk = await unwrapSecret(isRecovery ? S.vaultKey.recovery : S.vaultKey.wrapped, isRecovery ? normRecovery(fromSecret) : fromSecret).catch(() => null);
  if (!pk) throw new Error(isRecovery ? "復旧キーが違います。" : "今のパスワードが違います。");
  await updateDoc(doc(db, "vault", "key"), { wrapped: await wrapSecret(pk, newPass, PASS_ITER), changedBy: uid(), changedAt: serverTimestamp() });
  S.priv = await importPriv(pk); lastActive = Date.now();
}
const passRule = p => (p || "").length >= 10 ? "" : "パスワードは10文字以上にしてください。";
function vVaultSetup() {
  if (S.pendingRecovery) return `<div class="bar"><h2 class="vh">収支</h2></div><section class="panel vault-box">
    <h3>復旧キーを書き留めてください</h3>
    <p style="margin:0 0 10px">閲覧用パスワードを忘れたとき、<b>このキーがないと収支のデータは誰にも元に戻せません</b>。紙に書いて、PCやスマホとは別の場所に保管してください。この画面を閉じると、二度と表示されません。</p>
    <div class="rk">${esc(S.pendingRecovery)}</div>
    <p><button class="btn sec small" type="button" data-act="vault-rk-copy">コピー</button></p>
    <label class="checks"><input type="checkbox" id="v-rk-ok">紙に書き留めて、保管しました</label>
    <p style="margin:12px 0 0"><button class="btn" type="button" data-act="vault-rk-done">収支を開く</button></p></section>`;
  return `<div class="bar"><h2 class="vh">収支</h2></div><form class="panel vault-box" id="vault-setup">
    <h3>収支の暗号化を設定する（最初の1回だけ）</h3>
    <p class="muted" style="margin:0 0 12px;font-size:.88rem">収支と口座情報は、ここで決める「閲覧用パスワード」で暗号化して保存します。Googleアカウントのパスワードとは別のものにしてください。副管理者など「すべて見る」がオンの人には、このパスワードを口頭など安全な方法で伝えます。</p>
    <div class="field"><span class="lbl">閲覧用パスワード（10文字以上）</span><input type="password" id="v-pass" autocomplete="new-password" minlength="10" required></div>
    <div class="field" style="margin-top:10px"><span class="lbl">もう一度</span><input type="password" id="v-pass2" autocomplete="new-password" required></div>
    <p class="err" id="v-err" hidden></p>
    <p style="margin:14px 0 0"><button class="btn" type="submit">暗号化を設定する</button></p></form>`;
}
function vVaultLock() {
  return `<div class="bar"><h2 class="vh">収支</h2></div><form class="panel vault-box" id="vault-unlock">
    <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>収支はロックされています</h3>
    <p class="muted" style="margin:0 0 12px;font-size:.88rem">閲覧用パスワードを入れると、この端末の中でだけ元に戻して表示します。${LOCK_MIN}分間操作がないと、自動でロックします。</p>
    <div class="field"><span class="lbl">閲覧用パスワード</span><input type="password" id="v-pass" autocomplete="current-password" required></div>
    <p class="err" id="v-err" hidden></p>
    <p style="margin:14px 0 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn" type="submit">開く</button>${S.isAdmin ? `<button class="link" type="button" data-act="vault-recover">パスワードを忘れた（復旧キーを使う）</button>` : `<span class="muted" style="font-size:.8rem">パスワードは管理者に確認してください</span>`}</p></form>`;
}
const vErr = m => { const p = document.getElementById("v-err"); if (p) { p.hidden = false; p.textContent = m; } };
document.addEventListener("submit", async e => {
  const f = e.target; if (!f.matches || !f.matches("#vault-setup, #vault-unlock")) return;
  e.preventDefault(); const btn = f.querySelector("[type=submit]"); const pass = f.querySelector("#v-pass").value;
  if (f.id === "vault-setup") {
    const er = passRule(pass); if (er) return vErr(er);
    if (pass !== f.querySelector("#v-pass2").value) return vErr("2つのパスワードが一致しません。");
  }
  btn.disabled = true; btn.textContent = f.id === "vault-setup" ? "設定しています…" : "開いています…";
  try {
    if (f.id === "vault-setup") { await setupVault(pass); f.querySelector("#v-pass").value = ""; render(); }
    else { await unlockVault(pass); f.querySelector("#v-pass").value = ""; S.anim = "in"; render(); }
  } catch (err) { btn.disabled = false; btn.textContent = f.id === "vault-setup" ? "暗号化を設定する" : "開く"; vErr(err.message || errMsg(err)); }
});
function vaultPassDialog(recovery) {
  const body = (recovery ? fld("復旧キー", `<input name="from" id="f-from" required autocomplete="off" placeholder="XXXX-XXXX-…">`, { full: true, req: true, help: "暗号化を設定したときに書き留めたキー（ハイフンはあってもなくても可）" })
    : fld("今のパスワード", `<input type="password" name="from" id="f-from" required autocomplete="current-password">`, { full: true, req: true })) +
    fld("新しいパスワード（10文字以上）", `<input type="password" name="np" id="f-np" required autocomplete="new-password">`, { full: true, req: true }) +
    fld("もう一度", `<input type="password" name="np2" id="f-np2" required autocomplete="new-password">`, { full: true, req: true, help: "「すべて見る」がオンの人にも、新しいパスワードを伝えてください" });
  openDlg(recovery ? "復旧キーで新しいパスワードにする" : "閲覧用パスワードを変える", body, {
    submit: async f => {
      const er = passRule(f.np); if (er) return showErr(er), false;
      if (f.np !== f.np2) return showErr("2つのパスワードが一致しません。"), false;
      try { await rewrapVault(f.from, recovery, f.np); } catch (e) { return showErr(e.message), false; }
      await decryptLedger(); S.anim = "in";
      return "閲覧用パスワードを変えました";
    }
  });
}

/* ===================== 口座（銀行・Stripe・現金）：中身はすべて暗号化して保存 ===================== */
const ACC_KINDS = ["銀行", "Stripe", "現金", "その他"];
const ACC_FIELDS = ["name", "kind", "bank", "branch", "acctType", "number", "holder", "opening", "openingDate", "memo"];
const accName = id => ((S.accounts || []).find(a => a.id === id) || {}).name || "";
const maskNo = n => n ? "••••" + String(n).slice(-4) : "";
const sortedAccs = () => (S.accounts || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
function accountBalances(asOf) {
  const accs = S.accounts || []; const def = (accs.find(a => a.kind === "銀行") || accs[0] || {}).id;
  const bal = Object.fromEntries(accs.map(a => [a.id, a.openingDate && a.openingDate > asOf ? 0 : (Number(a.opening) || 0)]));
  let unassigned = 0;
  // 開始残高を入れた日より前の記録は、その口座の残高に含めない（開始残高に含まれているため）
  const add = (id, v, date) => { const a = accs.find(x => x.id === id); if (!a) { unassigned += v; return; } if (a.openingDate && date < a.openingDate) return; bal[id] += v; };
  S.ledger.forEach(r => {
    if (!r.date || r.broken) return; const amt = Number(r.amount) || 0;
    if (r.type === "振替") { if (r.date <= asOf) { add(r.fromAccount, -amt, r.date); add(r.toAccount, amt, r.date); } return; }
    const acc = r.account || def;
    if (r.type === "収入") { if (r.date <= asOf) add(acc, amt, r.date); return; }
    if (r.type !== "支出") return;
    if (isCard(r)) { if (cardPayDate(r.date) <= asOf) add(acc, -amt, r.date); return; }
    if (r.date <= asOf) add(acc, -amt, r.date);
  });
  return { bal, unassigned, total: Object.values(bal).reduce((a, b) => a + b, 0) };
}
function accountsPanel(asOf, label) {
  const accs = sortedAccs();
  if (!accs.length) return finEdit() ? `<section class="panel acc-panel"><h3>口座</h3><p class="muted" style="margin:0 0 10px;font-size:.85rem">銀行・Stripe・現金などを登録すると、口座ごとの残高が出ます。口座の情報は暗号化して保存します。</p><button class="btn small" type="button" data-act="acc-new">口座を追加</button></section>` : "";
  const { bal, unassigned } = accountBalances(asOf);
  return `<section class="panel acc-panel"><h3>口座<span class="hint">${esc(label)}時点の残高</span>${finEdit() ? `<button class="btn sec small" type="button" data-act="acc-new">＋ 口座を追加</button>` : ""}</h3>
    <div class="acc-list">${accs.map(a => `<button type="button" class="acc-row" data-act="acc-open" data-id="${esc(a.id)}"><span class="pill plain">${esc(a.kind || "")}</span><span class="acc-name"><b>${esc(a.name)}</b><small class="muted">${esc([a.bank, a.branch, a.acctType, maskNo(a.number)].filter(Boolean).join(" "))}</small></span><span class="acc-bal ${bal[a.id] < 0 ? "neg" : ""}">${bal[a.id] < 0 ? "−" : ""}${yen(Math.abs(bal[a.id]))}</span></button>`).join("")}</div>
    ${unassigned ? `<p class="muted" style="margin:8px 0 0;font-size:.78rem">口座が決まっていない記録：${unassigned < 0 ? "−" : "+"}${yen(Math.abs(unassigned))}（最初の銀行口座として計算しています）</p>` : ""}</section>`;
}
function accountDialog(a) {
  if (a && !finEdit()) {
    const ro = (l, v) => fld(l, `<div class="ro">${esc(v || "—")}</div>`, { full: true });
    openDlg(a.name, ro("種類", a.kind) + ro("銀行名", a.bank) + ro("支店", a.branch) + ro("口座の種類", a.acctType) + ro("口座番号", a.number) + ro("名義", a.holder) + ro("開始残高", a.opening !== "" && a.opening != null ? yen(a.opening) + (a.openingDate ? `（${md(a.openingDate)}時点）` : "") : "") + ro("メモ", a.memo), { readOnly: true });
    return;
  }
  const v = a || { name: "", kind: "銀行", bank: "", branch: "", acctType: "普通", number: "", holder: "", opening: "", openingDate: TODAY, memo: "" };
  const body = fld("口座の名前", `<input name="name" id="f-name" required maxlength="30" value="${esc(v.name)}" placeholder="例：三井住友 普通、Stripe、小口現金">`, { full: true, req: true }) +
    fld("種類", sel("kind", ACC_KINDS, v.kind), { full: true, help: v.kind === "Stripe" ? "Stripe連携を設定すると、売上・手数料・入金が自動で記録されます" : "" }) +
    `<div class="field full acc-bank" ${v.kind === "銀行" ? "" : "hidden"}><div class="dlg-b" style="padding:0">` +
      fld("銀行名", `<input name="bank" id="f-bank" value="${esc(v.bank || "")}" placeholder="例：三井住友銀行">`) + fld("支店", `<input name="branch" id="f-branch" value="${esc(v.branch || "")}" placeholder="例：渋谷支店">`) +
      fld("口座の種類", sel("acctType", ["普通", "当座", "貯蓄"], v.acctType || "普通")) + fld("口座番号", `<input name="number" id="f-number" inputmode="numeric" value="${esc(v.number || "")}" autocomplete="off">`) +
      fld("名義", `<input name="holder" id="f-holder" value="${esc(v.holder || "")}" placeholder="例：カ）シン">`, { full: true }) + `</div></div>` +
    fld("開始残高（円）", `<input name="opening" id="f-opening" type="number" step="1" value="${esc(v.opening ?? "")}">`, { half: true }) +
    fld("その日付", `<input type="date" name="openingDate" id="f-openingDate" value="${esc(v.openingDate || "")}">`, { half: true }) +
    `<p class="muted full" style="grid-column:1/-1;margin:-4px 0 0;font-size:.75rem">通帳やネットバンキングに出ている、その日の残高を入れます。これより前の日付の記録は、この口座の残高に足しません。</p>` +
    fld("メモ", `<textarea name="memo" id="f-memo">${esc(v.memo || "")}</textarea>`, { full: true }) +
    `<p class="banner full" style="grid-column:1/-1;margin:0">ネットバンキングのIDやパスワード、暗証番号は入れないでください。</p>`;
  const used = a ? S.ledger.filter(r => r.account === a.id || r.fromAccount === a.id || r.toAccount === a.id).length : 0;
  openDlg(a ? "口座を編集" : "口座を追加", body, {
    submit: async f => {
      const data = Object.fromEntries(ACC_FIELDS.map(k => [k, (f[k] ?? "").toString().trim()]));
      if (!data.name) return showErr("口座の名前を入力してください。"), false;
      data.opening = data.opening === "" ? "" : Number(data.opening);
      if (data.kind !== "銀行") Object.assign(data, { bank: "", branch: "", acctType: "", number: "", holder: "" });
      const enc = await sealRecord(data, S.vaultPub);
      if (a) await updateDoc(doc(db, "accounts", a.id), { enc, updatedBy: uid(), updatedAt: serverTimestamp() });
      else await addDoc(collection(db, "accounts"), { enc, order: Date.now(), createdBy: uid(), createdAt: serverTimestamp() });
      return a ? "口座を保存しました" : "口座を追加しました";
    },
    del: a ? () => deleteDoc(doc(db, "accounts", a.id)) : null,
    delInBody: a ? { label: "この口座を削除", help: used ? `この口座を使っている記録が${used}件あります。削除すると、それらは「口座が決まっていない記録」になります` : "元に戻せません" } : null
  });
  const k = form.querySelector("#f-kind"), bk = form.querySelector(".acc-bank");
  k.addEventListener("change", () => { bk.hidden = k.value !== "銀行"; });
}
/* ===== 領収書：画像はこの端末で小さくしてから、暗号化して保存 ===== */
const RC_MAX = 450 * 1024, PDF_MAX = 600 * 1024;
async function prepReceipt(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > PDF_MAX) throw new Error("PDFは600KBまでです。大きい場合は、画面を写真で撮って添付してください。");
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: "application/pdf" };
  }
  if (!/^image\//.test(file.type)) throw new Error("画像かPDFを選んでください。");
  let img;
  try { img = await createImageBitmap(file); }
  catch (e) { img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error("この画像は読み込めませんでした。JPEGかPNGで撮り直してください。")); i.src = URL.createObjectURL(file); }); }
  let max = 1600;
  for (let t = 0; t < 6; t++) {
    const sc = Math.min(1, max / Math.max(img.width, img.height)); const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
    for (const q of [0.72, 0.6, 0.5]) { const blob = await new Promise(ok => cv.toBlob(ok, "image/jpeg", q)); if (blob && blob.size <= RC_MAX) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg" }; }
    max = Math.round(max * 0.75);
  }
  throw new Error("画像を小さくできませんでした。別の写真で試してください。");
}
async function viewReceipt(id) {
  if (!S.priv) return toast("収支のロックを解除してから開いてください", "warn");
  const s = await getDoc(doc(db, "receipts", id)); if (!s.exists()) return toast("領収書が見つかりませんでした", "error");
  const d = s.data(); const bytes = await openRaw(d.enc, S.priv);
  const url = URL.createObjectURL(new Blob([bytes], { type: d.mime || "image/jpeg" }));
  openDlg("領収書", d.mime === "application/pdf" ? `<p class="full" style="grid-column:1/-1"><a class="btn" href="${url}" target="_blank" rel="noopener">PDFを開く</a></p>` : `<div class="full" style="grid-column:1/-1"><img class="rc-img" src="${url}" alt="領収書"><p style="margin:8px 0 0"><a class="link" href="${url}" download="receipt-${esc(id)}.jpg">保存する</a></p></div>`, { readOnly: true });
}

const canEditLed = r => finEdit() || (r.createdBy === uid() && finAdd());
const ledStatus = r => r.confirmed ? `<span class="pill good">確認済</span>` : `<span class="pill plain">未確認</span>`;
/* 収支を「追加だけ」できる人の画面：自分が追加した記録だけ */
function vMyLedger() {
  const rows = S.ledger.filter(r => r.createdBy === uid()).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const head = `<div class="bar"><h2 class="vh">収支</h2><span class="muted" style="font-size:.85rem;margin-right:auto">あなたが記録したものだけが表示されます</span><button class="btn" type="button" data-act="led-new">収支を記録</button></div>
    <p class="muted" style="font-size:.82rem;margin:-8px 0 14px">記録は暗号化して保存され、全体を見られるのは管理者と許可された人だけです。この一覧は、あなただけが見られる控えです。間違えたときは、管理者が確認する前（未確認のうち）なら、記録を開いて取り消せます。</p>`;
  if (!rows.length) return head + `<div class="empty"><p>まだ記録はありません。</p><button class="btn small" type="button" data-act="led-new">記録を追加</button></div>`;
  return head + `<div class="tablewrap"><table class="ledger-table"><thead><tr><th>日付</th><th>項目</th><th>区分</th><th>カテゴリ</th><th class="num">金額</th><th>担当者</th><th>支払方法</th><th>状態</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${canEditLed(r) ? "click" : ""}" ${canEditLed(r) ? `data-act="led-edit" data-id="${esc(r.id)}" tabindex="0"` : ""}><td class="c-date">${md(r.date)}</td><td class="c-title" style="white-space:normal;min-width:12em">${r.hasReceipt ? `<span class="clip" aria-label="領収書あり">📎</span>` : ""}${esc(r.title)}${r.memo ? `<div class="muted" style="font-size:.75rem">${esc(r.memo)}</div>` : ""}</td><td class="c-meta"><span class="pill ${r.type === "収入" ? "good" : "bad"}">${esc(r.type)}</span></td><td class="c-meta">${esc(r.category || "")}</td><td class="num c-amt ${r.type === "収入" ? "pos" : "neg"}">${r.type === "収入" ? "+" : "−"}${yen(r.amount)}</td><td class="c-meta">${esc(r.owner || "")}</td><td class="c-meta">${esc(r.method || "")}</td><td class="c-meta">${ledStatus(r)}</td><td class="c-sub">${esc([r.category, r.method].filter(Boolean).join("・"))} ${ledStatus(r)}</td></tr>`).join("")}
  </tbody></table></div>`;
}
function vMoney() {
  if (!finView()) return vMyLedger();
  if (!vaultReady() || S.pendingRecovery) return S.isAdmin ? vVaultSetup() : `<div class="bar"><h2 class="vh">収支</h2></div><div class="empty"><p>管理者が収支の暗号化を設定するまでお待ちください。</p></div>`;
  if (!S.priv) return vVaultLock();
  const m = S.moneyMonth; const rows = S.ledger.filter(r => (r.date || "").startsWith(m)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const inc = sumBy(rows, "収入"), exp = sumBy(rows, "支出");
  const monthEnd = ymd(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
  const asOf = m === THISMONTH ? TODAY : monthEnd;
  const bk = bankBalance(asOf); const ab = accountBalances(asOf); const asLabel = m === THISMONTH ? "今日" : md(asOf).replace(/\(.\)/, "");
  const group = type => { const o = {}; rows.filter(r => r.type === type).forEach(r => o[r.category || "その他"] = (o[r.category || "その他"] || 0) + (Number(r.amount) || 0)); return o; };
  const cats = group("支出"), icats = group("収入");
  const maxC = Math.max(1, ...Object.values(cats), ...Object.values(icats));
  const bars = (o, cls) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar ${cls}"><span>${esc(k)}</span><span class="track"><i style="width:${(v / maxC * 100).toFixed(1)}%"></i></span><span class="val">${yen(v)}</span></div>`).join("");
  const stPill = s => s === "未精算" ? `<span class="pill warn">未精算</span>` : s === "精算済" ? `<span class="pill good">精算済</span>` : `<span class="pill plain">${esc(s || "対象外")}</span>`;
  return `<div class="bar"><h2 class="vh">収支</h2>${monthNav("moneyMonth")}<button class="ghost" type="button" data-act="vault-lock" title="収支をロックする">ロック</button>${S.isAdmin ? `<button class="ghost" type="button" data-act="vault-pass">パスワード変更</button>` : ""}${finEdit() ? `<button class="btn sec" type="button" data-act="led-import">CSVを取り込む</button>` : ""}${finAdd() ? `<button class="btn" type="button" data-act="led-new">収支を記録</button>` : ""}${!finEdit() ? `<span class="pill plain">${finAdd() ? "閲覧と自分の記録の追加" : "閲覧のみ"}</span>` : ""}</div>
  <div class="figs money-figs">
    <div class="fig"><div class="k">収入</div><div class="v pos">${cu(inc, "yen")}</div></div>
    <div class="fig"><div class="k">支出</div><div class="v neg">${cu(exp, "yen")}</div></div>
    <div class="fig"><div class="k">月の収支</div><div class="v ${inc - exp >= 0 ? "pos" : "neg"}">${cu(inc - exp, "yen", inc - exp >= 0 ? "+" : "−")}</div></div>
    <div class="fig"><div class="k">口座の合計残高（${asLabel}時点）</div><div class="v">${cu(ab.total + ab.unassigned, "yen", ab.total + ab.unassigned < 0 ? "−" : "")}</div>
      <div class="s">${bk.pending ? `カードの未引き落とし ${yen(bk.pending)} を引く前の額` : (S.accounts || []).length ? "未引き落としのカード利用なし" : "口座を登録すると、口座ごとに出ます"}</div></div>
    ${S.ledger.some(isCard) ? bk.pays.map((p, i) => { const fixed = p.closing <= asOf; const from = parse(p.closing); from.setMonth(from.getMonth() - 1); from.setDate(16);
      return `<div class="fig card-pay"><div class="k">${i === 0 ? "次回のカード" : "その次のカード"}　${md(p.date)}</div><div class="v neg">${cu(p.amount, "yen")}</div>
        <div class="s">${md(ymd(from)).replace(/\(.\)/, "")}〜${md(p.closing).replace(/\(.\)/, "")}利用・${p.count}件・${fixed ? "確定" : "締め前（増える可能性あり）"}</div></div>`; }).join("") : ""}
  </div>
  <div class="stack">
    ${accountsPanel(asOf, asLabel)}
    ${rows.length ? `<div class="tablewrap"><table class="ledger-table"><thead><tr><th>日付</th><th>項目</th><th>区分</th><th>カテゴリ</th><th class="num">金額</th><th>担当者</th><th>支払方法</th><th>精算</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${canEditLed(r) ? "click" : ""}" ${canEditLed(r) ? `data-act="led-edit" data-id="${esc(r.id)}" tabindex="0"` : ""}><td class="c-date">${md(r.date)}</td><td class="c-title" style="white-space:normal;min-width:12em">${r.hasReceipt ? `<span class="clip" title="領収書あり" aria-label="領収書あり">📎</span>` : ""}${esc(r.title)}${r.type === "支出" && !r.hasReceipt ? ` <span class="pill warn">領収書なし</span>` : ""}${r.memo ? `<div class="muted" style="font-size:.75rem">${esc(r.memo)}</div>` : ""}<div class="muted" style="font-size:.72rem">${r.type === "振替" ? esc(`${accName(r.fromAccount) || "?"} → ${accName(r.toAccount) || "?"}`) + "・" : r.account ? esc(accName(r.account)) + "・" : ""}記録：${esc(r.source === "stripe" ? "Stripe（自動）" : r.createdBy ? memName(r.createdBy) : "—")}${r.confirmed ? "・確認済" : "・未確認"}</div></td><td class="c-meta"><span class="pill ${r.type === "収入" ? "good" : r.type === "振替" ? "plain" : "bad"}">${esc(r.type)}</span></td><td class="c-meta">${esc(r.category || "")}</td><td class="num c-amt ${r.type === "収入" ? "pos" : r.type === "振替" ? "" : "neg"}">${r.type === "収入" ? "+" : r.type === "振替" ? "⇄" : "−"}${yen(r.amount)}</td><td class="c-meta">${esc(r.owner || "")}</td><td class="c-meta">${esc(r.method || "")}</td><td class="c-meta">${stPill(r.settled)}</td><td class="c-sub">${esc([r.category, r.owner, r.method].filter(Boolean).join("・"))} ${stPill(r.settled)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>${monthLabel(m)}の記録はありません。</p>${finAdd() ? `<button class="btn small" type="button" data-act="led-new">記録を追加</button>` : ""}</div>`}
    ${rows.length ? `<div class="grid2"><section class="panel"><h3>支出の内訳</h3>${Object.keys(cats).length ? bars(cats, "out") : `<p class="muted" style="margin:0">支出はありません。</p>`}</section>
      <section class="panel"><h3>収入の内訳</h3>${Object.keys(icats).length ? bars(icats, "") : `<p class="muted" style="margin:0">収入はありません。</p>`}</section></div>` : ""}
  </div>`;
}

const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, "");
const inviteText = name => `${name ? name + "さん、" : ""}SHINの運営ボードに追加しました。\n下のURLを開いて「Googleでログイン」してください（追加したGmailアドレスのアカウントでログインしてください）。\n${SITE_URL}\nスマホならSafari（AndroidはChrome）で開いて「ホーム画面に追加」すると、アプリのように使えます。`;
function inviteDialog() {
  const body = fld("Gmailアドレス", `<input type="email" name="email" id="f-email" required autocomplete="off" placeholder="例：yamada.taro@gmail.com">`, { full: true, req: true, help: "その人がログインに使うGoogleアカウントのアドレス" }) +
    fld("表示名", `<input name="name" id="f-name" required placeholder="例：山田">`, { req: true, help: "カレンダーやKPIに出る名前" }) +
    `<div class="field"><span class="lbl">色</span><div class="swatches" role="radiogroup" aria-label="色">${MEMBER_COLORS.map((c, i) => `<label class="sw-pick"><input type="radio" name="color" id="f-color-${i}" value="${c}" ${i === activeMembers().length % MEMBER_COLORS.length ? "checked" : ""}><span class="swatch" style="background:${c}" title="${c}"></span></label>`).join("")}</div></div>` +
    `<div class="field full"><span class="lbl">権限</span><div class="role-pick">${ROLES.map(([k, l]) => `<label class="role-opt"><input type="radio" name="role" id="f-role-${k}" value="${k}" ${k === "member" ? "checked" : ""}><span><b>${l}</b><small>${esc(roleHelp(k))}</small></span></label>`).join("")}</div><span class="help">それぞれの段階でできることは「管理 → 設定 → 権限」で変えられます。収支の閲覧・編集は shincareer.com のアカウントだけです</span></div>`;
  openDlg("メンバーを追加", body, {
    submit: async f => {
      const email = (f.email || "").trim().toLowerCase(); const name = (f.name || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr("メールアドレスの形式が正しくありません。"), false;
      if (!name) return showErr("表示名を入力してください。"), false;
      const data = { name, color: f.color || null, finance: false, role: roleOf({ role: f.role }) };
      const existing = S.members.find(m => (m.email || "").toLowerCase() === email);
      if (existing) {
        await updateDoc(doc(db, "members", existing.id), { ...data, status: "active" });
        return existing.status === "pending" ? name + "さんを承認しました（すでにログイン済みでした）" : name + "さんの設定を更新しました";
      }
      await setDoc(doc(db, "invites", email), { ...data, createdAt: serverTimestamp() });
      closeDlg();
      toast(name + "さんを追加しました。案内文をメールやチャットで送ってください", "success", { duration: 8000, action: { label: "案内文をコピー", run: () => copyText(inviteText(name)) } });
      return false;
    }
  });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast("案内文をコピーしました"); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("案内文をコピーしました"); } catch (_) { toast("コピーできませんでした", "error"); } ta.remove(); }
}
function vAdmin() {
  const sub = S.adminSub === "members" ? "members" : "settings";
  const pending = S.members.filter(m => m.status === "pending").length;
  const sw = `<div class="seg seg-lg" role="tablist" aria-label="管理"><label><input type="radio" name="adminsub" id="adm-settings" value="settings" data-act="adm-sub" ${sub === "settings" ? "checked" : ""}><span>設定</span></label><label><input type="radio" name="adminsub" id="adm-members" value="members" data-act="adm-sub" ${sub === "members" ? "checked" : ""}><span>メンバー${pending ? `<span class="badge">${pending}</span>` : ""}</span></label></div>`;
  return `<div class="adm-head">${sw}</div>` + (sub === "settings" ? vSettings() : vMembers());
}
/* ===== フォーム：外部に送るGoogleフォームのリンク集 ===== */
const safeUrl = u => /^https:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "";
const formShareText = f => (f.message ? f.message.trim() + "\n" : "") + f.url;
function vForms() {
  const list = [...(S.forms || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const head = `<div class="bar"><h2 class="vh">フォーム</h2>${can("forms_manage") ? `<button class="btn" type="button" data-act="form-new">フォームを追加</button>` : ""}</div>
    <p class="muted" style="font-size:.85rem;margin:-8px 0 14px">ユーザーや取引先に送るGoogleフォームのリンク集です。「案内文をコピー」で、メールやDMに貼り付けて送れます。</p>`;
  if (!list.length) return head + `<div class="empty"><p>まだフォームが登録されていません。</p>${can("forms_manage") ? `<button class="btn small" type="button" data-act="form-new">最初のフォームを追加</button>` : `<p class="muted">管理者が追加すると、ここに表示されます。</p>`}</div>`;
  return head + `<div class="form-grid">${list.map((f, i) => `<article class="panel form-card">
      <div class="fc-head"><h3>${esc(f.name)}</h3>${can("forms_manage") ? `<span class="fc-tools"><button class="icon-btn" type="button" data-act="form-up" data-id="${esc(f.id)}" aria-label="上へ" ${i === 0 ? "disabled" : ""}>↑</button><button class="icon-btn" type="button" data-act="form-down" data-id="${esc(f.id)}" aria-label="下へ" ${i === list.length - 1 ? "disabled" : ""}>↓</button><button class="link" type="button" data-act="form-edit" data-id="${esc(f.id)}">編集</button></span>` : ""}</div>
      ${f.desc ? `<p class="fc-desc">${esc(f.desc)}</p>` : ""}
      ${f.message ? `<div class="fc-msg"><span class="lbl">送るときの文面</span><p>${esc(f.message)}</p></div>` : ""}
      <div class="fc-url">${esc(f.url)}</div>
      <div class="fc-acts"><button class="btn" type="button" data-act="form-copy" data-id="${esc(f.id)}">${f.message ? "案内文をコピー" : "リンクをコピー"}</button>${f.message ? `<button class="btn sec" type="button" data-act="form-copy-url" data-id="${esc(f.id)}">リンクだけ</button>` : ""}<a class="btn sec" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">開く</a>${can("forms_manage") && safeUrl(f.editUrl) ? `<a class="btn sec" href="${esc(safeUrl(f.editUrl))}" target="_blank" rel="noopener">編集する</a>` : ""}${can("forms_manage") && safeUrl(f.respUrl) ? `<a class="link" href="${esc(safeUrl(f.respUrl))}" target="_blank" rel="noopener">回答を見る</a>` : ""}</div>
    </article>`).join("")}</div>`;
}
/* ===================== テンプレ一覧 ===================== */
const canEditTpl = tp => can("tpl_editAll") || (tp.createdBy === uid() && can("tpl_add"));
function vTemplates() {
  const list = [...(S.templates || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const cats = [...new Set(list.map(x => x.category).filter(Boolean))];
  if (S.tplCat !== "all" && !cats.includes(S.tplCat)) S.tplCat = "all";
  const shown = list.filter(x => S.tplCat === "all" || x.category === S.tplCat);
  const head = `<div class="bar"><h2 class="vh">テンプレ一覧</h2><input type="search" id="tpl-q" class="tpl-q" placeholder="タイトル・本文で検索" value="${esc(S.tplQ || "")}" aria-label="テンプレを検索">${can("tpl_add") ? `<button class="btn" type="button" data-act="tpl-new">テンプレを追加</button>` : ""}</div>
    ${cats.length ? `<div class="tpl-cats" role="group" aria-label="カテゴリ">${[["all", "すべて"], ...cats.map(c => [c, c])].map(([v, l]) => `<button type="button" class="tpl-cat${S.tplCat === v ? " on" : ""}" data-act="tpl-cat" data-v="${esc(v)}" aria-pressed="${S.tplCat === v}">${esc(l)}<span>${v === "all" ? list.length : list.filter(x => x.category === v).length}</span></button>`).join("")}</div>` : ""}`;
  if (!list.length) return head + `<div class="empty"><p>まだテンプレがありません。</p><p class="muted" style="font-size:.85rem">営業メール、ユーザーインタビューの依頼、問い合わせへの返信など、よく送る文章を入れておくと「コピー」ですぐ使えます。</p>${can("tpl_add") ? `<button class="btn small" type="button" data-act="tpl-new">最初のテンプレを追加</button>` : ""}</div>`;
  return head + `<div class="tpl-grid">${shown.map(tp => `<article class="panel tpl-card" data-text="${esc((tp.title + " " + tp.body + " " + (tp.category || "")).toLowerCase())}">
      <div class="tpl-h"><h3>${esc(tp.title)}</h3>${tp.category ? `<span class="pill plain">${esc(tp.category)}</span>` : ""}</div>
      <div class="tpl-body">${esc(tp.body)}</div>
      <div class="tpl-f"><button class="btn small" type="button" data-act="tpl-copy" data-id="${esc(tp.id)}">コピー</button>${canEditTpl(tp) ? `<button class="link" type="button" data-act="tpl-edit" data-id="${esc(tp.id)}">編集</button>` : ""}<span class="muted">${esc(memName(tp.createdBy))}</span></div>
    </article>`).join("")}</div><p class="muted tpl-none" hidden>見つかりませんでした。</p>`;
}
function applyTplFilter() {
  const q = (S.tplQ || "").trim().toLowerCase(); let n = 0;
  document.querySelectorAll(".tpl-card").forEach(c => { const hit = !q || q.split(/\s+/).every(w => c.dataset.text.includes(w)); c.hidden = !hit; if (hit) n++; });
  const none = document.querySelector(".tpl-none"); if (none) none.hidden = n > 0 || !document.querySelector(".tpl-card");
}
document.addEventListener("input", e => { if (e.target.id === "tpl-q") { S.tplQ = e.target.value; applyTplFilter(); } });
function tplDialog(tp) {
  const v = tp || { title: "", category: S.tplCat !== "all" ? S.tplCat : "", body: "" };
  const cats = [...new Set((S.templates || []).map(x => x.category).filter(Boolean))];
  const body = fld("タイトル", `<input name="title" id="f-title" required maxlength="40" value="${esc(v.title)}" placeholder="例：営業メール（初回）">`, { full: true, req: true }) +
    fld("カテゴリ（任意）", `<input name="category" id="f-category" list="tpl-cat-list" maxlength="20" value="${esc(v.category || "")}" placeholder="例：営業、ユーザー対応、採用"><datalist id="tpl-cat-list">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>`, { full: true }) +
    fld("本文", `<textarea name="body" id="f-body" required rows="9" placeholder="〇〇様&#10;&#10;SHINの佐藤です。…">${esc(v.body)}</textarea>`, { full: true, req: true, help: "名前や日付など毎回変わるところは【 】で囲んでおくと、コピー後に直す場所が分かりやすくなります" });
  openDlg(tp ? "テンプレを編集" : "テンプレを追加", body, {
    submit: async f => {
      const data = { title: f.title.trim(), category: (f.category || "").trim(), body: f.body.replace(/\s+$/, "") };
      if (!data.title) return showErr("タイトルを入力してください。"), false;
      if (!data.body.trim()) return showErr("本文を入力してください。"), false;
      if (tp) await updateDoc(doc(db, "templates", tp.id), data);
      else { Object.assign(data, { order: Date.now(), createdBy: uid(), createdAt: serverTimestamp() }); await addDoc(collection(db, "templates"), data); S.anim = "in"; }
    },
    del: tp ? () => deleteDoc(doc(db, "templates", tp.id)) : null,
    draft: tp ? null : "tpl"
  });
}

/* ===================== 議事録 ===================== */
// 文字起こしを貼ると、GitHubの自動実行（5分ごと）がGeminiで要約して書き戻す
const MIN_STALE = 20 * 60 * 1000;
const tsMs = t => (t && t.toMillis ? t.toMillis() : 0);
const minTime = m => tsMs(m.createdAt);
const canEditMin = m => can("min_editAll") || (m.createdBy === uid() && can("min_add"));
const minBusy = m => m.status === "pending" || m.status === "processing";
const minStuck = m => { const t = Math.max(minTime(m), tsMs(m.queuedAt), m.startedAt ? Date.parse(m.startedAt) || 0 : 0); return minBusy(m) && t > 0 && Date.now() - t > MIN_STALE; };
function minStatusPill(m) {
  if (minBusy(m)) return minStuck(m) ? `<span class="pill bad">止まっています</span>` : `<span class="pill warn"><span class="spin" aria-hidden="true"></span>まとめ中</span>`;
  if (m.status === "error") return `<span class="pill bad">まとめられませんでした</span>`;
  return "";
}
const minTitle = m => m.title || "MTGの議事録";
function vMinutes() {
  const list = [...(S.minutes || [])].sort((a, b) => (b.date || "").localeCompare(a.date || "") || minTime(b) - minTime(a));
  if (S.minId) { const m = list.find(x => x.id === S.minId); if (m) return vMinuteDetail(m); S.minId = null; }
  const head = `<div class="bar"><h2 class="vh">議事録</h2>${can("min_add") ? `<button class="btn" type="button" data-act="min-new">議事録を追加</button>` : ""}</div>
    <p class="muted" style="font-size:.85rem;margin:-8px 0 14px">MTGの音声を文字起こししたものを貼り付けると、5〜15分ほどで「決定・やること・持ち越し」に自動でまとまります。「詳細を見る」で、議題ごとの詳しい内容も見られます。</p>`;
  if (!list.length) return head + `<div class="empty"><p>まだ議事録がありません。</p>${can("min_add") ? `<button class="btn small" type="button" data-act="min-new">最初の議事録を追加</button>` : ""}</div>`;
  return head + `<div class="min-list">${list.map(m => `<article class="panel min-card">
      <div class="min-card-h"><b>${m.date ? md(m.date) : ""} ${esc(minTitle(m))}</b>${minStatusPill(m)}</div>
      ${m.status === "done" ? minBrief(m) : `<p class="muted" style="margin:0;font-size:.85rem">${minBusy(m) && !minStuck(m) ? "自動でまとめています。5〜15分ほどで、ここに決定事項とやることが出ます。" : "うまくまとめられませんでした。詳細から、もう一度まとめてください。"}</p>`}
      <div class="min-card-f"><span class="muted">追加：${esc(memName(m.createdBy))}</span><button class="btn sec small" type="button" data-act="min-open" data-id="${esc(m.id)}">詳細を見る ›</button></div>
    </article>`).join("")}</div>`;
}
/* 一覧に出す簡潔な形：【決定】【やること】【持ち越し】 */
const shortDate = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
const todoLine = t => t.task + (t.owner || t.due ? `（${[t.owner, shortDate(t.due)].filter(Boolean).join("・")}）` : "");
const minSections = m => { const sm = m.summary || {}; return [["決定", sm.decisions || []], ["やること", (m.todos || []).map(todoLine)], ["持ち越し", sm.pending || []]].filter(([, a]) => a.length); };
function minBrief(m) {
  const secs = minSections(m);
  if (!secs.length) return `<p class="muted" style="margin:0;font-size:.85rem">決定事項・やることはありませんでした。</p>`;
  return `<div class="min-brief">${secs.map(([t, a]) => `<div><span class="mb-h">【${t}】</span>${a.map(x => `<span class="mb-l">・${esc(x)}</span>`).join("")}</div>`).join("")}</div>`;
}
const minPlain = m => `${m.date ? md(m.date) : ""} ${minTitle(m)}\n\n` + minSections(m).map(([t, a]) => `【${t}】\n` + a.map(x => "・" + x).join("\n")).join("\n\n");
const minList = (title, items, empty) => `<section class="panel min-sec"><h3>${title}</h3>${items && items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">${empty}</p>`}</section>`;
function vMinuteDetail(m) {
  const sm = m.summary || {}; const todos = m.todos || []; const ed = canEditMin(m);
  const back = `<button class="link min-back" type="button" data-act="min-back">‹ 議事録の一覧</button>`;
  const tools = `${ed && m.status === "done" ? `<button class="btn sec small" type="button" data-act="min-edit" data-id="${esc(m.id)}">要約を直す</button>` : ""}${ed ? `<button class="btn sec small" type="button" data-act="min-more" data-id="${esc(m.id)}">その他</button>` : ""}`;
  let body;
  if (minBusy(m) && !minStuck(m)) body = `<section class="panel min-wait"><span class="spin lg" aria-hidden="true"></span><div><b>自動でまとめています</b><p class="muted" style="margin:4px 0 0">追加から5〜15分ほどで、ここに要約が表示されます。このページを閉じても大丈夫です。まとまったら追加した人に通知が届きます。</p></div></section>`;
  else if (minBusy(m) || m.status === "error") body = `<section class="panel min-wait err"><div><b>${minBusy(m) ? "まとめる処理が止まっているようです" : "まとめられませんでした"}</b>
      ${m.error ? `<p class="muted" style="margin:4px 0 0">理由：${esc(m.error)}</p>` : ""}
      ${ed ? `<p style="margin:10px 0 0"><button class="btn small" type="button" data-act="min-retry" data-id="${esc(m.id)}">もう一度まとめる</button></p>` : `<p class="muted" style="margin:6px 0 0">追加した人か管理者が、もう一度まとめ直せます。</p>`}</div></section>`;
  else body = `${(sm.topics || []).length ? `<section class="panel min-sec"><h3>話し合いの詳細</h3><div class="min-topics">${sm.topics.map(t => `<div class="min-topic">${t.title ? `<h4>${esc(t.title)}</h4>` : ""}<p>${esc(t.body)}</p></div>`).join("")}</div></section>` : (sm.points || []).length ? minList("要点", sm.points, "") : ""}
    ${minList("決定事項", sm.decisions, "決まったことはありませんでした")}
    <section class="panel min-sec"><h3>やること</h3>${todos.length ? `<div class="min-todos">${todos.map((t, i) => `<div class="min-todo">
        <div><b>${esc(t.task)}</b><span class="muted">${t.owner ? "担当：" + esc(t.owner) : "担当：未定"}${t.due ? "・期限：" + md(t.due) : ""}</span></div>
        ${t.issueId ? `<span class="pill good">未対応事項に追加済み</span>` : can("issue_add") ? `<button class="btn sec small" type="button" data-act="min-todo" data-id="${esc(m.id)}" data-i="${i}">未対応事項に追加</button>` : ""}</div>`).join("")}</div>` : `<p class="muted" style="margin:0">やることはありませんでした</p>`}</section>
    ${minList("持ち越し", sm.pending, "なし")}`;
  return `<div class="bar">${back}<span class="sp"></span>${tools}</div>
    <div class="min-head"><span class="muted">${m.date ? md(m.date) : ""}・追加：${esc(memName(m.createdBy))}</span><h2>${esc(minTitle(m))}</h2></div>
    <div class="stack">${body}
      <details class="panel min-raw"><summary>文字起こしの原文を見る（${num((m.transcript || "").length)}文字）</summary><div class="min-raw-text">${esc(m.transcript || "")}</div></details></div>`;
}
function minuteDialog() {
  const body = fld("MTGの日付", `<input type="date" name="date" id="f-date" required value="${esc(NEXTMTG && NEXTMTG <= TODAY ? NEXTMTG : TODAY)}">`, { full: true, req: true }) +
    `<div class="field full"><span class="lbl">文字起こし<span class="req">必須</span></span><textarea name="transcript" id="f-transcript" rows="8" placeholder="MTGの音声を文字起こししたものを、そのまま貼り付けてください" style="min-height:160px"></textarea>
      <span class="help">iPhoneのボイスメモの「文字起こし」や、LINE・Googleドキュメントの音声入力の結果をそのまま貼ってOKです。えーと・あの等は自動で取り除かれます。<label class="link" style="cursor:pointer">テキストファイルから読み込む<input type="file" id="f-txt" accept=".txt,text/plain" hidden></label></span></div>` +
    moreBtn("タイトルを付ける（空欄なら自動で付きます）") +
    fld("タイトル（任意）", `<input name="title" id="f-title" placeholder="例：10月第4回 定例MTG">`, { full: true, opt: true });
  openDlg("議事録を追加", body, {
    submit: async f => {
      const tr = (f.transcript || "").trim();
      if (tr.length < 50) return showErr("文字起こしが短すぎます。MTGの文字起こしを貼り付けてください。"), false;
      if (tr.length > 200000) return showErr("文字起こしが長すぎます（20万文字まで）。"), false;
      if (!f.date) return showErr("日付を入力してください。"), false;
      const ref = await addDoc(collection(db, "minutes"), { date: f.date, title: (f.title || "").trim(), transcript: tr, status: "pending", createdBy: uid(), createdAt: serverTimestamp() });
      S.minId = ref.id; S.anim = "in";
      return "議事録を追加しました。5〜15分ほどで自動でまとまります";
    },
    draft: "minute"
  });
  const fi = form.querySelector("#f-txt");
  if (fi) fi.addEventListener("change", async () => { const file = fi.files[0]; if (!file) return; const t = await file.text(); const ta = form.querySelector("#f-transcript"); ta.value = t; ta.dispatchEvent(new Event("input", { bubbles: true })); toast(`${num(t.length)}文字を読み込みました`); });
}
const lines = s => (s || "").split("\n").map(x => x.replace(/^[-・*\s]+/, "").trim()).filter(Boolean);
function parseDue(s, base) {
  s = (s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/月](\d{1,2})日?$/); if (!m) return null;
  let y = Number((base || TODAY).slice(0, 4)); const d = `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return d < (base || TODAY) && (base || TODAY).slice(5, 7) === "12" && m[1] !== "12" ? `${y + 1}${d.slice(4)}` : d;
}
function minuteEditDialog(m) {
  const sm = m.summary || {}; const todos = m.todos || [];
  const ta = (name, label, arr, help) => fld(label, `<textarea name="${name}" id="f-${name}" rows="4">${esc((arr || []).join("\n"))}</textarea>`, { full: true, help });
  const body = fld("タイトル", `<input name="title" id="f-title" value="${esc(m.title || "")}">`, { full: true }) +
    fld("MTGの日付", `<input type="date" name="date" id="f-date" value="${esc(m.date || "")}">`, { full: true }) +
    ta("decisions", "決定事項", sm.decisions, "1行に1つ") +
    fld("やること", `<textarea name="todos" id="f-todos" rows="5">${esc(todos.map(t => [t.task, t.owner || "", t.due ? md(t.due).replace(/\(.\)/, "") : ""].join(" / ").replace(/( \/ )+$/, "")).join("\n"))}</textarea>`, { full: true, help: "1行に1つ。「内容 / 担当 / 期限」の形（例：LPの文言を直す / 佐藤 / 10/30）" }) +
    ta("pending", "持ち越し", sm.pending, "1行に1つ") +
    fld("話し合いの詳細", `<textarea name="topics" id="f-topics" rows="8">${esc((sm.topics || []).map(t => "■" + t.title + "\n" + t.body).join("\n\n"))}</textarea>`, { full: true, help: "「■見出し」の次の行から本文。議題ごとに空行で区切る" });
  openDlg("要約を直す", body, {
    submit: async f => {
      const nt = [];
      for (const l of lines(f.todos)) {
        const [task, owner = "", due = ""] = l.split(/\s+\/\s+|\s*／\s*/);
        const d = parseDue(due, m.date); if (d === null) return showErr(`期限の形が読み取れません：「${due}」（例：10/30）`), false;
        const old = todos.find(t => t.task === task.trim());
        nt.push({ task: task.trim(), owner: owner.trim(), due: d, ...(old && old.issueId ? { issueId: old.issueId } : {}) });
      }
      await updateDoc(doc(db, "minutes", m.id), { title: f.title.trim(), date: f.date || m.date, summary: { ...(sm.points ? { points: sm.points } : {}), topics: (f.topics || "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => { const [h, ...r] = b.split("\n"); return r.length ? { title: h.replace(/^■\s*/, "").trim(), body: r.join("\n").trim() } : { title: "", body: h.replace(/^■\s*/, "").trim() }; }), decisions: lines(f.decisions), pending: lines(f.pending) }, todos: nt, editedBy: uid() });
      return "要約を保存しました";
    }
  });
}
function minuteMoreDialog(m) {
  openSheet({ kind: "min-more", id: m.id });
}
async function minuteTodoToIssue(m, i) {
  const t = (m.todos || [])[i]; if (!t || t.issueId) return;
  const owner = (t.owner || "").replace(/さん$/, "").trim();
  const owners = owner ? activeMembers().filter(x => { const n = (x.name || "").replace(/\s/g, ""); return n && (n.includes(owner.replace(/\s/g, "")) || owner.replace(/\s/g, "").includes(n)); }).map(x => x.id) : [];
  const ref = await addDoc(collection(db, "issues"), { title: t.task, detail: `議事録（${m.date ? md(m.date) : ""}${m.title ? " " + m.title : ""}）より${t.owner && !owners.length ? `\n担当：${t.owner}` : ""}`, due: t.due || "", owners, done: false, createdBy: uid(), createdAt: serverTimestamp(), notified: false });
  const todos = (m.todos || []).map((x, j) => j === i ? { ...x, issueId: ref.id } : x);
  await updateDoc(doc(db, "minutes", m.id), { todos });
  toast(owners.length ? "未対応事項に追加しました" : "未対応事項に追加しました（担当は未定のまま）");
}
function formDialog(fm) {
  const v = fm || { name: "", url: "", editUrl: "", desc: "", message: "", respUrl: "" };
  const body = fld("フォームの名前", `<input name="name" id="f-name" required value="${esc(v.name)}" placeholder="例：β版テスター募集フォーム">`, { full: true, req: true }) +
    fld("公開用のURL（送る人向け）", `<input name="url" id="f-url" type="url" required value="${esc(v.url)}" placeholder="https://forms.gle/…">`, { full: true, req: true, help: "Googleフォームの「送信」→リンクのアイコンで出るURL（短縮URLでOK）。回答する人が開くリンクです" }) +
    fld("編集用のURL（任意）", `<input name="editUrl" id="f-editUrl" type="url" value="${esc(v.editUrl || "")}" placeholder="https://docs.google.com/forms/d/…/edit">`, { full: true, help: "フォームを編集する画面のURL（ブラウザのアドレス欄の、最後が /edit のもの）。管理者・副管理者だけに「編集する」として表示されます。編集するには、Googleフォーム側でその人を共同編集者に追加しておく必要があります" }) +
    fld("説明（運営向けメモ）", `<input name="desc" id="f-desc" value="${esc(v.desc || "")}" placeholder="例：β版テスターの募集用。SNSで告知するときに使う">`, { full: true }) +
    fld("送るときの文面（任意）", `<textarea name="message" id="f-message" placeholder="例：β版テスターのお申し込みはこちらからお願いします。">${esc(v.message || "")}</textarea>`, { full: true, help: "入れておくと「案内文をコピー」で、この文面とURLがまとめてコピーされます" }) +
    fld("回答を見るURL（任意）", `<input name="respUrl" id="f-respUrl" type="url" value="${esc(v.respUrl || "")}" placeholder="回答のスプレッドシートやフォームの編集画面のURL">`, { full: true, help: "管理者・副管理者だけに「回答を見る」として表示されます" });
  openDlg(fm ? "フォームを編集" : "フォームを追加", body, {
    submit: async f => {
      const url = (f.url || "").trim(), respUrl = (f.respUrl || "").trim(), editUrl = (f.editUrl || "").trim();
      if (editUrl && !safeUrl(editUrl)) return showErr("編集用のURLは https:// から始まる形で入れてください。"), false;
      if (editUrl && editUrl === url) return showErr("公開用と編集用に同じURLが入っています。編集用は、最後が /edit のURLを入れてください。"), false;
      if (/\/viewform/.test(editUrl)) return showErr("編集用のURLに、回答用（/viewform）のURLが入っています。最後が /edit のURLを入れてください。"), false;
      if (/\/edit(\?|#|$)/.test(url)) return showErr("公開用のURLに編集用（/edit）のURLが入っています。送る人向けのリンク（forms.gle や /viewform）を入れてください。"), false;
      if (!safeUrl(url)) return showErr("URLは https:// から始まる形で入れてください。"), false;
      if (respUrl && !safeUrl(respUrl)) return showErr("回答を見るURLは https:// から始まる形で入れてください。"), false;
      const data = { name: f.name.trim(), url, editUrl, desc: f.desc.trim(), message: f.message.trim(), respUrl };
      if (!data.name) return showErr("フォームの名前を入力してください。"), false;
      if (fm) await updateDoc(doc(db, "forms", fm.id), data);
      else { data.order = Date.now(); data.createdAt = serverTimestamp(); await addDoc(collection(db, "forms"), data); S.anim = "in"; }
    },
    del: fm ? () => deleteDoc(doc(db, "forms", fm.id)) : null
  });
}
async function moveForm(id, dir) {
  const list = [...(S.forms || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const i = list.findIndex(f => f.id === id), j = i + dir; if (i < 0 || j < 0 || j >= list.length) return;
  const b = writeBatch(db); const oi = list[i].order || i, oj = list[j].order || j;
  b.update(doc(db, "forms", list[i].id), { order: oj === oi ? oi + dir : oj }); b.update(doc(db, "forms", list[j].id), { order: oi });
  await b.commit();
}
async function copyPlain(t, msg) {
  try { await navigator.clipboard.writeText(t); toast(msg); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast(msg); } catch (_) { toast("コピーできませんでした", "error"); } ta.remove(); }
}
function finLabel(m) {
  const p = permsOf(roleOf(m)), ws = isWS(m.email);
  if ((p.fin_edit || p.fin_view) && ws) return `<span class="pill info">${p.fin_edit ? "閲覧・編集" : "閲覧"}</span>`;
  if (p.fin_add) return `<span class="pill plain">追加のみ</span>${(p.fin_view || p.fin_edit) && !ws ? `<div class="seen">shincareer.com 以外のため閲覧不可</div>` : ""}`;
  return `<span class="muted">なし</span>`;
}
function vMembers() {
  const list = [...S.members].sort((a, b) => ({ pending: 0, active: 1, inactive: 2 }[a.status] ?? 3) - ({ pending: 0, active: 1, inactive: 2 }[b.status] ?? 3) || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  const st = s => s === "active" ? `<span class="pill good">利用中</span>` : s === "pending" ? `<span class="pill warn">承認待ち</span>` : `<span class="pill plain">停止中</span>`;
  const invites = (S.invites || []).filter(iv => !S.members.some(m => (m.email || "").toLowerCase() === iv.id)).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  return `<div class="bar"><h2>メンバー</h2><button class="btn" type="button" data-act="inv-new">メンバーを追加</button></div>
  <p class="muted" style="font-size:.85rem;margin:-8px 0 14px">「拒否」「利用停止」にした人は「削除」で名簿から消せます。消した人がもう一度ログインした場合は、また「承認待ち」で表示されます。「メンバーを追加」でGmailアドレスを登録しておくと、その人がGoogleでログインした瞬間に、承認なしで使えるようになります。登録していない人がログインした場合は「承認待ち」で表示されます。</p>
  ${invites.length ? `<section class="panel" style="margin-bottom:16px"><h3>追加済み・まだログインしていない人<span class="hint">${invites.length}人</span></h3>
    ${invites.map(iv => `<div class="inv-row"><span class="who" style="--mc:${iv.color || "var(--muted)"}"><i></i><b>${esc(iv.name)}</b></span><span class="muted inv-mail">${esc(iv.id)}</span>${rolePill(roleOf(iv))}<span class="sp"></span><button class="btn sec small" type="button" data-act="inv-copy" data-id="${esc(iv.id)}">案内文をコピー</button><button class="link" type="button" style="color:var(--bad)" data-act="inv-del" data-id="${esc(iv.id)}">${S.armDel === "inv:" + iv.id ? "本当に取り消す" : "取り消す"}</button></div>`).join("")}
  </section>` : ""}
  <div class="tablewrap"><table class="members-table"><thead><tr><th>表示名</th><th>色</th><th>Googleアカウント・最終利用</th><th>状態</th><th>権限</th><th>収支</th><th></th></tr></thead><tbody>
  ${list.map(m => { const self = m.id === uid(); return `<tr>
    <td><input class="name-in" id="mn-${esc(m.id)}" value="${esc(m.name || "")}" data-act="mem-name" data-id="${esc(m.id)}" aria-label="表示名"></td>
    <td><div class="swatches" role="group" aria-label="${esc(m.name || "")}の色">${MEMBER_COLORS.map(c => `<button type="button" class="swatch" style="background:${c}" data-act="mem-color" data-id="${esc(m.id)}" data-c="${c}" aria-label="色 ${c}" aria-pressed="${mColor(m.id) === c}"></button>`).join("")}</div></td>
    <td>${esc(m.email || "")}${m.status === "pending" ? "" : `<div class="seen${m.lastSeen && Date.now() - m.lastSeen.toMillis() > 14 * 864e5 ? " old" : ""}">最終利用：${esc(seenLabel(m.lastSeen))}</div>`}</td><td>${st(m.status)}</td>
    <td>${self ? `<span class="muted">管理者</span>` : `<select class="role-sel" id="mr-${esc(m.id)}" data-act="mem-role" data-id="${esc(m.id)}" aria-label="${esc(m.name || "")}の権限">${ROLES.map(([k, l]) => `<option value="${k}" ${roleOf(m) === k ? "selected" : ""}>${l}</option>`).join("")}</select>`}</td>
    <td>${self ? `<span class="muted">すべて</span>` : finLabel(m)}</td>
    <td>${self ? "" : m.status === "pending" ? `<button class="btn small" type="button" data-act="mem-status" data-id="${esc(m.id)}" data-v="active">承認する</button> <button class="btn sec small" type="button" data-act="mem-status" data-id="${esc(m.id)}" data-v="inactive">拒否</button>` : m.status === "active" ? `<button class="btn sec small" type="button" data-act="mem-status" data-id="${esc(m.id)}" data-v="inactive">利用停止</button>` : `<button class="btn sec small" type="button" data-act="mem-status" data-id="${esc(m.id)}" data-v="active">再開する</button> <button class="btn small ${S.armDel === "mem:" + m.id ? "danger" : "sec danger-sec"}" type="button" data-act="mem-del" data-id="${esc(m.id)}">${S.armDel === "mem:" + m.id ? "本当に削除する" : "削除"}</button>`}</td></tr>`; }).join("")}
  </tbody></table></div>
  <div class="role-legend"><b>権限の違い</b><ul>${ROLES.map(([k, l]) => `<li><b>${l}</b>：${esc(roleHelp(k))}</li>`).join("")}<li><b>管理者</b>：すべて＋メンバー管理・設定</li></ul><span class="muted">細かい内容は「設定」タブの「権限」で変えられます。収支の閲覧・編集は shincareer.com のアカウントだけに限られます。</span></div>`;
}

const rowHTML = (key, i, x, label) => `<div class="row"><button type="button" class="handle" aria-label="並べ替え（↑↓キーで移動）" title="ドラッグして並べ替え"><svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" fill="currentColor"><circle cx="3" cy="3" r="1.6"/><circle cx="9" cy="3" r="1.6"/><circle cx="3" cy="9" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="3" cy="15" r="1.6"/><circle cx="9" cy="15" r="1.6"/></svg></button><input id="s-${key}-${i}" value="${esc(x)}" aria-label="${esc(label || "項目")}"><button class="btn sec small" type="button" data-rm>外す</button></div>`;
function markDirty() { S.settingsDirty = true; const h = document.getElementById("save-hint"); if (h) h.hidden = false; }
function notifyTimeSelect(cur) {
  const opts = []; for (let h = 5; h <= 10; h++) for (const m of [0, 15, 30, 45]) opts.push(pad(h) + ":" + pad(m));
  return `<select id="s-notifyTime">${opts.map(o => `<option ${o === cur ? "selected" : ""}>${o}</option>`).join("")}</select>`;
}
function permTable() {
  const roles = ROLES;
  const rows = PERM_DEFS.map(([g, items]) => `<tr class="pt-group"><th colspan="${roles.length + 1}">${esc(g)}</th></tr>` + items.map(([k, l]) => `<tr><td class="pt-label">${esc(l)}</td>${roles.map(([r, rl]) => `<td class="pt-cell"><input type="checkbox" data-perm="${r}|${k}" id="pm-${r}-${k}" aria-label="${esc(rl)}：${esc(g)} ${esc(l)}" ${permsOf(r)[k] ? "checked" : ""}></td>`).join("")}</tr>`).join("")).join("");
  return `<section class="panel perm-panel" style="margin-bottom:16px"><h3>権限<span class="hint">段階ごとにできること</span></h3>
    <p class="muted" style="font-size:.8rem;margin:-4px 0 10px">管理者はすべてできます。ここでの設定はサーバー側のルールにも反映されるので、オフにした操作は画面以外からもできません。オンにすると、前提になる項目（例：「見る」）も自動でオンになります。</p>
    <div class="tablewrap pt-wrap"><table class="perm-table"><thead><tr><th>できること</th>${roles.map(([, rl]) => `<th class="pt-cell">${esc(rl)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted" style="font-size:.78rem;margin:8px 0 0">「保存」を押すまで反映されません。</p></section>`;
}
function readPermTable() {
  const out = {}; ROLES.forEach(([r]) => { out[r] = Object.fromEntries(PERM_KEYS.map(k => [k, false])); });
  document.querySelectorAll("[data-perm]").forEach(el => { const [r, k] = el.dataset.perm.split("|"); if (out[r]) out[r][k] = el.checked; });
  return out;
}
/* 前提になる項目の連動：オン → 前提もオン、オフ → それを前提にする項目もオフ */
document.addEventListener("change", e => {
  const el = e.target.closest && e.target.closest("[data-perm]"); if (!el) return;
  const [r, k] = el.dataset.perm.split("|"); const box = key => document.getElementById(`pm-${r}-${key}`);
  const on = key => { (PERM_DEPS[key] || []).forEach(d => { const b = box(d); if (b && !b.checked) { b.checked = true; on(d); } }); };
  const off = key => { Object.entries(PERM_DEPS).forEach(([x, deps]) => { if (deps.includes(key)) { const b = box(x); if (b && b.checked) { b.checked = false; off(x); } } }); };
  el.checked ? on(k) : off(k); markDirty();
});
function vSettings() {
  const c = cfg();
  const list = (key, items, label) => `<section class="panel"><h3>${label}</h3><div class="listedit" data-list="${key}">${items.map((x, i) => rowHTML(key, i, x, label)).join("")}</div><button class="link" type="button" data-add="${key}" style="margin-top:8px">＋ 追加</button></section>`;
  return `<div class="bar"><h2>設定</h2><span class="pill warn" id="save-hint" ${S.settingsDirty ? "" : "hidden"}>未保存の変更があります</span><button class="btn" type="button" data-act="save-settings">保存</button></div>
    <p class="muted" style="font-size:.82rem;margin:-8px 0 14px">左の点のつまみをドラッグすると並び順を変えられます（キーボードではつまみを選んで↑↓キー）。この順番で業務登録や収支の選択肢に表示されます。</p>
    <section class="panel" style="margin-bottom:16px"><h3>通知</h3>
      <div class="dlg-b" style="padding:0">
        <p class="muted full" style="grid-column:1/-1;margin:0;font-size:.8rem">受け取るかどうか・時刻・タイムゾーンは、各自が右上のベルから設定します。ここは全体でのオン・オフと、まだ自分で設定していない人の初期値です。</p>
        <div class="field"><label class="checks" style="font-size:.9rem"><input type="checkbox" id="s-notifyEnabled" ${c.notifyEnabled === false ? "" : "checked"}>朝の通知（担当業務がある日）を使う</label></div>
        <div class="field"><span class="lbl">初期の時刻（日本時間）</span>${notifyTimeSelect(c.notifyTime || "07:30")}<span class="help">自分で時刻を設定していない人に使います</span></div>
        <div class="field full"><label class="checks" style="font-size:.9rem"><input type="checkbox" id="s-issueNotify" ${c.issueNotify === false ? "" : "checked"}>未対応事項が追加されたときの通知を使う</label><span class="help">追加した人以外に送ります。各自が決めた夜間の時間帯には送らず、明けてから届きます</span></div>
        <div class="field full"><span class="lbl">ウェブプッシュ証明書の鍵（初回のみ）</span><input id="s-vapid" value="${esc(c.vapidKey || "")}" placeholder="Firebase →プロジェクトの設定 → Cloud Messaging →ウェブプッシュ証明書の「鍵ペア」"><span class="help">${c.vapidKey ? "設定済みです" : "未設定です。設定するまでメンバーは通知を受け取る登録ができません"}</span></div>
      </div></section>
    ${permTable()}
    <div class="grid2">${list("routines", c.routines, "定例業務（業務登録の選択肢）")}${list("expenseCats", c.expenseCats, "支出カテゴリ")}${list("incomeCats", c.incomeCats, "収入カテゴリ")}${list("methods", c.methods, "支払方法")}</div>`;
}

/* ================= push notifications ================= */
const notifyOn = () => !!memGet("push_token_id") && (typeof Notification !== "undefined" && Notification.permission === "granted");
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
async function sha256(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 40); }
let fgBound = false;
async function swReg() { return navigator.serviceWorker.register("firebase-messaging-sw.js?cfg=" + encodeURIComponent(JSON.stringify(firebaseConfig)), { scope: "./" }); }
async function enablePush() {
  const c = cfg(); if (!c.vapidKey) throw new Error("管理者が通知の初期設定（ウェブプッシュ証明書の鍵）をまだ入れていません。");
  if (!(await isSupported())) throw new Error(isIOS() && !isStandalone() ? "iPhoneでは、ホーム画面に追加したアプリから開いて登録してください。" : "このブラウザは通知に対応していません。");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("通知が許可されませんでした。端末の設定で、このアプリの通知を許可してください。");
  const reg = await swReg(); await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(fbApp), { vapidKey: c.vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error("通知の登録に失敗しました。もう一度試してください。");
  const id = await sha256(token);
  await setDoc(doc(db, "members", uid(), "tokens", id), { token, ua: navigator.userAgent.slice(0, 200), standalone: isStandalone(), createdAt: serverTimestamp() });
  memSet("push_token_id", id); bindForeground();
}
async function disablePush() {
  const id = memGet("push_token_id");
  try { await deleteToken(getMessaging(fbApp)); } catch (e) { }
  if (id) { try { await deleteDoc(doc(db, "members", uid(), "tokens", id)); } catch (e) { } }
  memSet("push_token_id", null);
}
function bindForeground() {
  if (fgBound || !fbApp) return; fgBound = true;
  try { onMessage(getMessaging(fbApp), p => { const n = p.notification || {}; toast((n.title ? n.title + "：" : "") + (n.body || ""), "info", { duration: 6000 }); }); } catch (e) { }
}
/* ===== 通知の個人設定（時差のある人のために、時刻とタイムゾーンを各自で決める） ===== */
const TZS = [["Asia/Tokyo", "日本"], ["Asia/Seoul", "韓国"], ["Asia/Shanghai", "中国"], ["Asia/Taipei", "台湾"], ["Asia/Singapore", "シンガポール"], ["Asia/Bangkok", "タイ"], ["Australia/Sydney", "オーストラリア東部"], ["Europe/London", "イギリス"], ["Europe/Paris", "ヨーロッパ中部（フランス・ドイツなど）"], ["America/New_York", "アメリカ東部（ボストン・ニューヨーク）"], ["America/Chicago", "アメリカ中部"], ["America/Denver", "アメリカ山岳部"], ["America/Los_Angeles", "アメリカ西部（カリフォルニア）"], ["America/Toronto", "カナダ東部"], ["America/Vancouver", "カナダ西部"], ["Pacific/Honolulu", "ハワイ"]];
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo"; } catch (e) { return "Asia/Tokyo"; } };
const tzNow = tz => { try { return new Intl.DateTimeFormat("ja-JP", { timeZone: tz, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()); } catch (e) { return ""; } };
function myNotify() {
  const c = cfg(); const n = (S.member && S.member.notify) || {};
  return { morning: n.morning !== false, time: n.time || c.notifyTime || "07:30", tz: n.tz || "Asia/Tokyo", issues: n.issues !== false, minutes: n.minutes !== false, quietStart: n.quietStart || "23:00", quietEnd: n.quietEnd || "07:00", saved: !!S.member && !!S.member.notify };
}
const timeOpts = (from, to, step, cur) => { const o = []; for (let m = from * 60; m <= to * 60; m += step) o.push(pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60)); return o.map(x => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join(""); };
function notifyDialog() {
  const c = cfg(); const on = notifyOn(); const n = myNotify();
  const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  const tzList = TZS.some(([z]) => z === n.tz) ? TZS : [[n.tz, n.tz], ...TZS];
  const bt = browserTz(); const tzHint = bt !== n.tz ? `<span class="help">この端末の時刻は「${esc(bt)}」です。<button class="link" type="button" id="n-tz-here">この端末のタイムゾーンにする</button></span>` : "";
  const iosNote = isIOS() && !isStandalone() ? `<p class="banner" style="grid-column:1/-1;margin:0">iPhoneで通知を受け取るには、Safariの共有ボタン →「ホーム画面に追加」で追加したアプリから開いて、ここで登録してください。</p>` : "";
  const body = iosNote + `<div class="field full"><span class="lbl">この端末</span><div class="ro">${on ? `<span class="pill good">通知を受け取ります</span>` : perm === "denied" ? `<span class="pill bad">通知がブロックされています</span>` : `<span class="pill plain">受け取っていません</span>`}
      ${on ? `<button class="link" type="button" id="n-off" style="margin-left:10px">この端末で受け取らない</button>` : `<button class="btn small" type="button" id="n-on" style="margin-left:10px">この端末で受け取る</button>`}</div>
      <span class="help">端末ごとに登録が必要です（スマホとPCの両方で受け取るなら両方で）。下の設定は、登録したすべての端末に共通です。</span>
      ${perm === "denied" ? `<span class="help">端末の設定（iPhoneは「設定」→「通知」→「SHIN」）で許可してから、もう一度押してください。</span>` : ""}</div>
    <div class="field full nt-sec"><span class="lbl">受け取る通知</span>
      <label class="checks"><input type="checkbox" name="morning" id="n-morning" value="1" ${n.morning ? "checked" : ""}>朝の通知（自分が担当の業務がある日）${c.notifyEnabled === false ? `<span class="pill plain" style="margin-left:6px">管理者が停止中</span>` : ""}</label>
      <label class="checks"><input type="checkbox" name="issues" id="n-issues" value="1" ${n.issues ? "checked" : ""}>未対応事項が追加されたとき${c.issueNotify === false ? `<span class="pill plain" style="margin-left:6px">管理者が停止中</span>` : ""}</label>
      <label class="checks"><input type="checkbox" name="minutes" id="n-minutes" value="1" ${n.minutes ? "checked" : ""}>自分が追加した議事録がまとまったとき</label></div>
    <div class="field full"><span class="lbl">タイムゾーン</span><select name="tz" id="n-tz">${tzList.map(([z, l]) => `<option value="${esc(z)}" ${z === n.tz ? "selected" : ""}>${esc(l)}（いま ${esc(tzNow(z))}）</option>`).join("")}</select>${tzHint}
      <span class="help">朝の通知の時刻と夜間の時間帯は、このタイムゾーンで判断します。業務の時刻も、この地域の時刻に直して届きます。</span></div>
    <div class="field"><span class="lbl">朝の通知の時刻</span><select name="time" id="n-time">${timeOpts(4, 12, 15, n.time)}</select></div>
    <div class="field"><span class="lbl">夜間は送らない</span><div class="nt-quiet"><select name="quietStart" id="n-qs" aria-label="夜間の開始">${timeOpts(19, 26, 30, n.quietStart)}</select><span>〜</span><select name="quietEnd" id="n-qe" aria-label="夜間の終わり">${timeOpts(4, 10, 30, n.quietEnd)}</select></div></div>
    <p class="muted full" style="grid-column:1/-1;margin:0;font-size:.78rem">夜間に追加された未対応事項は、夜間が明けてからまとめて届きます。実際に届くのは、設定した時刻から10分ほど遅れることがあります。</p>`;
  form.innerHTML = `<div class="dlg-h"><h3>通知</h3><button type="button" data-close aria-label="閉じる">×</button></div><div class="dlg-b">${body}<p class="err" id="f-err" hidden></p></div>
    <div class="dlg-f"><div class="sp"><button class="btn sec" type="button" data-close>閉じる</button><button class="btn" type="button" id="n-save">設定を保存</button></div></div>`;
  onSubmit = null; onDelete = null; draftKey = null; form.classList.remove("is-sheet"); S.sheet = null;
  showDlg();
  const onB = form.querySelector("#n-on"), offB = form.querySelector("#n-off"), here = form.querySelector("#n-tz-here");
  if (onB) onB.addEventListener("click", async () => { onB.disabled = true; onB.textContent = "登録しています…"; try { await enablePush(); toast("この端末で通知を受け取ります"); if (!myNotify().saved) await saveNotify(true); notifyDialog(); render(); } catch (e) { showErr(e.message || errMsg(e)); onB.disabled = false; onB.textContent = "この端末で受け取る"; } });
  if (offB) offB.addEventListener("click", async () => { offB.disabled = true; await disablePush(); toast("この端末への通知を止めました", "info"); notifyDialog(); render(); });
  if (here) here.addEventListener("click", () => { const sel = form.querySelector("#n-tz"); if (![...sel.options].some(o => o.value === bt)) sel.insertAdjacentHTML("afterbegin", `<option value="${esc(bt)}">${esc(bt)}（いま ${esc(tzNow(bt))}）</option>`); sel.value = bt; here.parentElement.remove(); });
  form.querySelector("#n-save").addEventListener("click", async e => { e.currentTarget.disabled = true; try { await saveNotify(false); closeDlg(); toast("通知の設定を保存しました"); } catch (err) { showErr(err); e.currentTarget.disabled = false; } });
}
async function saveNotify(quiet) {
  const g = id => form.querySelector(id);
  const n = myNotify();
  const data = g("#n-tz") ? { morning: g("#n-morning").checked, issues: g("#n-issues").checked, minutes: g("#n-minutes").checked, tz: g("#n-tz").value, time: g("#n-time").value, quietStart: g("#n-qs").value, quietEnd: g("#n-qe").value }
    : { morning: n.morning, issues: n.issues, minutes: n.minutes, tz: quiet ? browserTz() : n.tz, time: n.time, quietStart: n.quietStart, quietEnd: n.quietEnd };
  await updateDoc(doc(db, "members", uid()), { notify: data });
}

/* ================= dialogs ================= */
const dlg = $("#dlg"), form = $("#dlg-form"); let onSubmit = null, onDelete = null;
/* 入力の記憶：端末ごと・アカウントごとにブラウザ内へ保存（サーバーには送らない） */
const memKey = k => "shin_" + (uid() || "anon") + "_" + k;
const memGet = k => { try { return JSON.parse(ls.get(memKey(k), "null")); } catch (e) { return null; } };
const memSet = (k, v) => ls.set(memKey(k), v == null ? "null" : JSON.stringify(v));
function readFormState() {
  const out = {};
  form.querySelectorAll("input[name],select[name],textarea[name]").forEach(el => {
    if (el.type === "file") return;
    if (el.type === "checkbox") { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
}
function applyFormState(st) {
  const set = el => {
    const v = st[el.name]; if (v === undefined) return;
    if (el.type === "checkbox") el.checked = Array.isArray(v) && v.includes(el.value);
    else if (el.type === "radio") el.checked = v === el.value;
    else if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v)) return;
    else el.value = v;
  };
  // 先に区分・「全員」を戻して、連動する選択肢を作り直してから残りを戻す
  form.querySelectorAll("#f-type,[name$=_all]").forEach(el => { set(el); el.dispatchEvent(new Event("change")); });
  form.querySelectorAll("input[name],select[name],textarea[name]").forEach(el => { if (el.id !== "f-type" && !/_all$/.test(el.name)) set(el); });
}
let draftKey = null;
function openDlg(title, body, { submit, del, readOnly, draft, delInBody } = {}) {
  S.sheet = null; form.classList.remove("is-sheet");
  form.innerHTML = `<div class="dlg-h"><h3>${esc(title)}</h3><button type="button" data-close aria-label="閉じる">×</button></div>
    <div class="dlg-b">${body}${del && delInBody ? `<div class="danger-zone"><div><b>${esc(delInBody.label)}</b><span class="help">${esc(delInBody.help || "")}</span></div><button class="btn sec" type="button" id="f-del" style="color:var(--bad);border-color:var(--bad)">削除</button></div>` : ""}<p class="err" id="f-err" hidden></p></div>
    <div class="dlg-f">${del && !delInBody ? `<button class="btn sec" type="button" id="f-del" style="color:var(--bad);border-color:var(--bad)">削除</button>` : ""}<div class="sp">${readOnly ? `<button class="btn" type="button" data-close>閉じる</button>` : `<button class="btn sec" type="button" data-close>キャンセル</button><button class="btn" type="submit">保存</button>`}</div></div>`;
  onSubmit = submit; onDelete = del; draftKey = draft || null;
  showDlg();
  const f = form.querySelector("input:not([type=checkbox]),select,textarea"); if (f && !readOnly) f.focus();
}
let closeTimer = null;
const reducedMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
function closeDlg() {
  draftKey = null; S.sheet = null;
  if (!dlg.open) return;
  const done = () => { dlg.classList.remove("closing"); try { dlg.close(); } catch (e) { dlg.removeAttribute("open"); } closeTimer = null; };
  if (reducedMotion()) return done();
  dlg.classList.add("closing"); clearTimeout(closeTimer); closeTimer = setTimeout(done, 180);
}
function showDlg() {
  clearTimeout(closeTimer); closeTimer = null; dlg.classList.remove("closing");
  if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
  else { dlg.classList.remove("swap"); void dlg.offsetWidth; dlg.classList.add("swap"); }
}
/* ===== ボトムシート（スマホでは下から出る。PCでは中央の小窓） ===== */
function openSheet(sheet) {
  const r = sheetContent(sheet); if (!r) return;
  form.innerHTML = `<div class="dlg-h"><h3 id="sheet-title">${esc(r.title)}</h3><button type="button" data-close aria-label="閉じる">×</button></div>
    <div class="dlg-b sheet-b" data-sheet-body>${r.body}</div>${r.foot ? `<div class="dlg-f">${r.foot}</div>` : ""}`;
  onSubmit = null; onDelete = null; draftKey = null; form.classList.add("is-sheet");
  S.sheet = sheet; showDlg();
}
function refreshSheet() {
  if (!S.sheet || !dlg.open) return; const r = sheetContent(S.sheet); if (!r) return closeDlg();
  const b = form.querySelector("[data-sheet-body]"), t = form.querySelector("#sheet-title");
  if (t) t.textContent = r.title; if (b) b.innerHTML = r.body;
}
function sheetContent(sh) {
  if (sh.kind === "day") {
    const list = S.tasks.filter(t => t.date === sh.d && (S.onlyMine ? (isMine(t) || (t.shareWith || []).includes(uid()) || t.createdBy === uid()) : relevant(t))).sort(sortTasks);
    return { title: md(sh.d) + (sh.d === TODAY ? "　今日" : ""),
      body: list.length ? list.map(t => taskItem(t)).join("") : `<p class="muted" style="margin:0">この日の業務はありません。</p>`,
      foot: can("cal_add") ? `<div class="sp"><button class="btn" type="button" data-act="task-new" data-d="${sh.d}">この日に業務を登録</button></div>` : "" };
  }
  if (sh.kind === "month") {
    const cur = S[sh.key]; const y = sh.y;
    const cells = Array.from({ length: 12 }, (_, i) => { const v = `${y}-${String(i + 1).padStart(2, "0")}`;
      return `<button type="button" class="mp-cell${v === cur ? " on" : ""}${v === THISMONTH ? " now" : ""}" data-act="mp-pick" data-v="${v}">${i + 1}月</button>`; }).join("");
    return { title: "月を選ぶ",
      body: `<div class="mp-year"><button type="button" class="ghost" data-act="mp-year" data-step="-1" aria-label="前の年">‹</button><b>${y}年</b><button type="button" class="ghost" data-act="mp-year" data-step="1" aria-label="次の年">›</button></div>
        <div class="mon-grid">${cells}</div>`,
      foot: cur !== THISMONTH ? `<div class="sp"><button class="btn sec" type="button" data-act="mp-pick" data-v="${THISMONTH}">今月に戻る</button></div>` : "" };
  }
  if (sh.kind === "kpi") {
    const k = S.kpis.find(x => x.id === sh.id); if (!k) return null;
    const w = k.weekly || {}; const weeks = meetingsOfMonth(k.month);
    const rows = weeks.map(wk => { const v = w[wk] && w[wk].value !== null && w[wk].value !== undefined ? w[wk].value : null;
      return `<div class="kd-row${wk === NEXTMTG ? " now" : ""}"><span>${mtgLabel(wk)}（${md(wk)}）${wk === NEXTMTG ? `<span class="pill plain">次回</span>` : ""}</span><b>${v === null ? `<span class="muted">未入力</span>` : num(v) + esc(k.unit || "")}</b></div>`; }).join("");
    let head;
    if (isTrack(k)) { const t = trackInfo(k); head = `<div class="kd-big"><b>${t.last ? num(t.last.v) : "—"}</b>${Number(k.target) > 0 ? ` / ${num(k.target)}` : ""}${esc(k.unit || "")} ${t.last ? deltaTag(t, k.unit) : ""}</div>`; }
    else { const st = kpiStatus(k); head = `<div class="kd-big"><b>${num(st.a.v)}</b> / ${st.t > 0 ? num(st.t) : "—"}${esc(k.unit || "")} ${st.t > 0 ? `<span class="pill ${st.st.c}">${Math.round(st.rate * 100)}%</span>` : ""}</div>
      ${st.t > 0 ? `<div class="meter"><i class="${st.st.c === "good" ? "good" : (st.st.c === "warn" || st.st.c === "bad") ? "warn" : ""}" style="width:${Math.min(100, st.rate * 100)}%"></i></div>` : ""}`; }
    const canIn = can("kpi_manage") || (k.owner === uid() && can("kpi_input"));
    return { title: k.name, body: `${head}
      <div class="kd-meta"><span>担当：${whoTag(k.owner)}</span><span>${isTrack(k) ? "記録のみ（最新値）" : k.mode === "latest" ? "最新値で集計" : "MTG・月末ごとの合計"}</span></div>
      <div class="kd-list">${rows}</div>`,
      foot: canIn ? `<div class="sp"><button class="btn" type="button" data-act="go" data-tab="kpi">進捗を入力する</button></div>` : "" };
  }
  if (sh.kind === "min-more") {
    const m = (S.minutes || []).find(x => x.id === sh.id); if (!m) return null;
    return { title: "議事録の操作", body: `<div class="act-list">
      <button type="button" class="act-row" data-act="min-retry" data-id="${esc(m.id)}"><b>もう一度まとめ直す</b><span class="muted">今の要約を消して、原文からAIでまとめ直します（直した内容も上書きされます）</span></button>
      <button type="button" class="act-row" data-act="min-copy" data-id="${esc(m.id)}"><b>要約をコピー</b><span class="muted">LINEなどに貼り付けられる形でコピーします</span></button>
      <button type="button" class="act-row danger" data-act="min-del" data-id="${esc(m.id)}"><b>${S.armDel === m.id ? "本当に削除する（もう一度押す）" : "この議事録を削除"}</b><span class="muted">原文と要約が消えます。元に戻せません</span></button></div>` };
  }
  return null;
}

/* ===== キーボードが出たとき：シートをキーボードの上に収め、入力中の欄を見える位置へ ===== */
(() => {
  const vv = window.visualViewport; if (!vv) return;
  const sync = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const open = kb > 120;
    document.documentElement.classList.toggle("kb-open", open);
    if (open && dlg.open) { dlg.style.marginBottom = kb + "px"; dlg.style.maxHeight = (vv.height - 8) + "px"; }
    else { dlg.style.marginBottom = ""; dlg.style.maxHeight = ""; }
  };
  vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync);
  form.addEventListener("focusin", e => {
    const el = e.target.closest("input:not([type=checkbox]):not([type=radio]),select,textarea"); if (!el) return;
    setTimeout(() => { sync(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 300);
  });
  dlg.addEventListener("close", () => { dlg.style.marginBottom = ""; dlg.style.maxHeight = ""; });
})();

/* ===== スワイプで閉じる（スマホのボトムシート） ===== */
(() => {
  const mobile = () => window.matchMedia && matchMedia("(max-width:600px)").matches;
  let y0 = null, dy = 0, t0 = 0, pid = null;
  dlg.addEventListener("pointerdown", e => {
    if (!mobile() || !dlg.open || e.button > 0) return;
    const h = e.target.closest(".dlg-h"); if (!h || e.target.closest("button")) return;
    y0 = e.clientY; dy = 0; t0 = performance.now(); pid = e.pointerId; dlg.classList.add("dragging");
  });
  document.addEventListener("pointermove", e => {
    if (y0 === null || e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - y0); dlg.style.transform = `translateY(${dy}px)`; e.preventDefault();
  }, { passive: false });
  const end = e => {
    if (y0 === null || (e && e.pointerId !== pid)) return;
    const v = dy / Math.max(1, performance.now() - t0); y0 = null; dlg.classList.remove("dragging");
    if (dy > 90 || v > .6) {
      dlg.style.transition = "transform .2s ease-in"; dlg.style.transform = "translateY(100%)";
      // 入力途中の内容は下書きとして残っているので、次に開いたときに戻せる
      setTimeout(() => { draftKey = null; S.sheet = null; try { dlg.close(); } catch (_) { dlg.removeAttribute("open"); } dlg.style.transition = ""; dlg.style.transform = ""; }, 200);
    } else { dlg.style.transition = "transform .2s var(--ease-out)"; dlg.style.transform = ""; setTimeout(() => dlg.style.transition = "", 220); }
  };
  document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
})();

function restoreDraft() {
  if (!draftKey) return; const d = memGet("draft_" + draftKey); if (!d) return;
  applyFormState(d);
  const b = form.querySelector(".dlg-b"); b.insertAdjacentHTML("afterbegin", `<p class="banner" id="f-draft" style="grid-column:1/-1;margin:0">入力途中の内容を復元しました。<button class="link" type="button" data-discard>消して最初から</button></p>`);
}
form.addEventListener("input", () => { if (draftKey) memSet("draft_" + draftKey, readFormState()); });
form.addEventListener("change", () => { if (draftKey) memSet("draft_" + draftKey, readFormState()); });
function showErr(err) { const p = $("#f-err"); p.hidden = false; p.textContent = typeof err === "string" ? err : errMsg(err); }
dlg.addEventListener("click", e => { if (e.target === dlg) { if (draftKey) { /* 入力途中は残す */ } closeDlg(); } });
dlg.addEventListener("cancel", e => { e.preventDefault(); closeDlg(); });
form.addEventListener("click", e => {
  if (e.target.closest("[data-discard]")) { const k = draftKey; memSet("draft_" + k, null); closeDlg(); if (k === "task") taskDialog(null, S.selDay); if (k === "led") ledDialog(null); if (k === "issue") issueDialog(null); return; }
  if (e.target.closest("[data-close]")) { if (draftKey) memSet("draft_" + draftKey, null); closeDlg(); return; }
  const d = e.target.closest("#f-del");
  if (d) {
    if (d.dataset.armed) Promise.resolve(onDelete()).then(() => { closeDlg(); toast("削除しました"); }).catch(showErr);
    else { d.dataset.armed = "1"; d.textContent = "本当に削除する"; d.classList.remove("sec"); d.classList.add("danger"); d.style.color = ""; }
  }
});
form.addEventListener("submit", async e => {
  e.preventDefault(); if (!onSubmit) return;
  const fd = new FormData(form); const f = Object.fromEntries(fd.entries()); f.__fd = fd;
  const btn = form.querySelector("[type=submit]"); if (btn) btn.disabled = true;
  const dk = draftKey;
  try { const r = await onSubmit(f); if (r !== false) { if (dk) memSet("draft_" + dk, null); closeDlg(); toast(typeof r === "string" ? r : "保存しました"); } }
  catch (err) { showErr(err); }
  finally { if (btn) btn.disabled = false; }
});
const sel = (name, list, val) => `<select name="${name}" id="f-${name}">${list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
const fld = (label, inner, { full, req, help, half, opt } = {}) => `<div class="field${full ? " full" : ""}${half ? " half" : ""}${opt ? " opt" : ""}"><span class="lbl">${esc(label)}${req ? `<span class="req">必須</span>` : ""}</span>${inner}${help ? `<span class="help">${esc(help)}</span>` : ""}</div>`;
/* 入力画面：よく使わない項目は「＋ …を追加」を押したときだけ表示する */
const asOpt = html => html.replace('class="field', 'class="field opt');
const moreBtn = label => `<div class="field full more-row"><button type="button" class="link more-btn" data-more>＋ ${esc(label)}</button></div>`;
function openMore(focus) {
  const b = form.querySelector(".dlg-b"); if (!b || b.classList.contains("show-more")) return;
  b.classList.add("show-more");
  if (focus) { const f = b.querySelector(".opt input:not([type=hidden]):not([type=checkbox]),.opt textarea,.opt select"); if (f) f.focus(); }
}
function autoMore() {
  const b = form.querySelector(".dlg-b"); if (!b) return;
  const filled = [...b.querySelectorAll(".opt textarea,.opt input[type=date],.opt input[type=text],.opt input:not([type])")].some(x => x.value.trim());
  const shareAll = b.querySelector('.opt input[name$="_all"]');
  if (filled || (shareAll && !shareAll.checked)) openMore(false);
}
form.addEventListener("click", e => { if (e.target.closest("[data-more]")) openMore(true); });
const memberOpts = () => activeMembers().map(m => [m.id, m.name || m.email]);
/* メンバー選択はすべて同じ「色付きチップ」で選ぶ（multi=複数選択、false=1人だけ） */
function memberChips(name, selected, { multi = true, byName = false, extra = [] } = {}) {
  const type = multi ? "checkbox" : "radio";
  const items = activeMembers().map(m => ({ v: byName ? (m.name || m.email) : m.id, label: m.name || m.email, color: mColor(m.id) }));
  extra.forEach(n => { if (n && !items.some(x => x.v === n)) items.push({ v: n, label: n, color: "var(--muted)" }); });
  return `<div class="pick-chips" role="${multi ? "group" : "radiogroup"}">${items.map((x, i) => `<label class="pchip" style="--mc:${x.color}"><input type="${type}" name="${name}" id="f-${name}-${i}" value="${esc(x.v)}" ${selected.includes(x.v) ? "checked" : ""}><span><i></i>${esc(x.label)}</span></label>`).join("")}</div>`;
}
function shareBox(name, current, help) {
  const all = !current || !current.length || current.includes("all");
  return `<div class="field full"><span class="lbl">${name === "viewers" ? "表示できる人" : "共有する人"}</span><div class="pick-chips">
    <label class="pchip pchip-all" style="--mc:var(--navy)"><input type="checkbox" name="${name}_all" id="f-${name}_all" ${all ? "checked" : ""}><span><i></i>全員</span></label>
    ${activeMembers().map((m, i) => `<label class="pchip" style="--mc:${mColor(m.id)}"><input type="checkbox" name="${name}" id="f-${name}-${i}" value="${esc(m.id)}" ${!all && current.includes(m.id) ? "checked" : ""} ${all ? "disabled" : ""}><span><i></i>${esc(m.name || m.email)}</span></label>`).join("")}
  </div>${help ? `<span class="help">${esc(help)}</span>` : ""}</div>`;
}
function wireShare(name) {
  const a = form.querySelector(`#f-${name}_all`); if (!a) return;
  a.addEventListener("change", () => form.querySelectorAll(`input[name=${name}]`).forEach(x => { x.disabled = a.checked; if (a.checked) x.checked = false; }));
}
const readShare = (f, name) => { if (f[name + "_all"]) return ["all"]; const v = f.__fd.getAll(name); return v.length ? v : ["all"]; };

function kpiDialog(k, preset) {
  const v = k || Object.assign({ month: S.kpiMonth, mode: "sum", unit: "人", owner: uid(), viewers: ["all"] }, preset || {});
  const trk = isTrack(v);
  const body = fld("指標名", `<input name="name" id="f-name" required value="${esc(v.name || "")}" placeholder="例：新規登録者数">`, { full: true, req: true }) +
    `<div class="field full"><label class="checks" style="font-size:.88rem"><input type="checkbox" name="track" id="f-track" value="1" ${trk ? "checked" : ""}>記録のみの指標にする（フォロワー数など。達成率とゲージを出さず、「最新値／目標」と前回からの増減を表示）</label></div>` +
    `<div class="field" id="target-field"><span class="lbl">月次目標<span class="req" id="target-req">必須</span><span class="muted" id="target-opt" style="font-weight:400;margin-left:4px">（任意）</span></span><input name="target" id="f-target" type="number" step="any" min="0" value="${esc(v.target ?? "")}"></div>` +
    fld("単位", `<input name="unit" id="f-unit" value="${esc(v.unit || "")}" placeholder="人・回・件">`) +
    fld("集計方法", sel("mode", [["sum", "合計（MTG・月末ごとに、前回から増えた分を入力）"], ["latest", "最新値（MTG・月末時点の数値を入力）"]], v.mode), { full: true }) +
    fld("担当者", memberChips("owner", [v.owner], { multi: false }), { full: true, help: "MTGと月末に進捗を入力する人（1人）" }) +
    fld("対象月", `<input name="month" id="f-month" type="month" required value="${esc(v.month)}">`, { req: true }) +
    shareBox("viewers", v.viewers, "担当者には常に表示されます。表示できない人には、このKPIのデータ自体が送られません。");
  openDlg(k ? "KPIを編集" : "KPIを追加", body, {
    submit: async f => {
      if (!f.owner) return showErr("担当者を選んでください。"), false;
      const track = !!f.track;
      if (!track && (f.target === "" || !(Number(f.target) >= 0))) return showErr("月次目標を入力してください（記録のみの指標なら、上のチェックを入れると目標は任意になります）。"), false;
      const data = { name: f.name.trim(), track, target: f.target === "" ? null : Number(f.target), unit: f.unit.trim(), mode: f.mode, owner: f.owner, month: f.month, viewers: readShare(f, "viewers") };
      if (!data.name) return showErr("指標名を入力してください。"), false;
      if (!data.viewers.includes("all") && !data.viewers.includes(data.owner)) data.viewers.push(data.owner);
      if (k) await updateDoc(doc(db, "kpis", k.id), data);
      else { data.weekly = {}; data.order = Date.now(); data.createdAt = serverTimestamp(); await addDoc(collection(db, "kpis"), data); }
    },
    del: k ? () => deleteDoc(doc(db, "kpis", k.id)) : null,
    delInBody: k ? { label: "このKPIを削除", help: "MTG・月末ごとに入力した進捗も一緒に消えます。元に戻せません" } : null
  });
  wireShare("viewers");
  const tc = form.querySelector("#f-track"), tf = form.querySelector("#target-field");
  const syncT = () => { form.querySelector("#target-req").hidden = tc.checked; form.querySelector("#target-opt").hidden = !tc.checked; if (tc.checked && !k) form.querySelector("#f-mode").value = "latest"; };
  tc.addEventListener("change", syncT); syncT();
}

function taskDialog(t, date) {
  const c = cfg();
  if (t && !canEditTask(t)) {
    const sw = sharedAll(t) ? "全員" : t.shareWith.map(memName).join("・");
    openDlg("業務の詳細", fld("日時", `<div class="ro">${md(t.date)} ${timeLabel(t)}</div>`) + fld("担当者", `<div class="ro">${esc(ownersOf(t).map(memName).join("・") || "未定")}</div>`) +
      fld("担当業務", `<div class="ro">${esc(t.label ? `${t.label}（${t.routine}）` : taskTitle(t))}</div>`, { full: true }) + (t.detail && t.routine !== "__other" ? fld("内容・メモ", `<div class="ro">${esc(t.detail)}</div>`, { full: true }) : "") +
      fld("共有", `<div class="ro">${esc(sw)}</div>`) + fld("登録した人", `<div class="ro">${esc(memName(t.createdBy))}</div>`, { help: "編集できるのは登録した人と管理者・副管理者です" }), { readOnly: true });
    return;
  }
  const last = memGet("last_task") || {};
  const v = t || { date: date || S.selDay || TODAY, start: last.start ?? "10:00", end: last.end ?? "11:00", owners: [uid()], routine: last.routine && (c.routines.includes(last.routine) || last.routine === "__other") ? last.routine : c.routines[0], detail: "", shareWith: last.shareWith || ["all"] };
  const isOther = v.routine === "__other" || (v.routine && !c.routines.includes(v.routine));
  const routineOpts = [...c.routines.map(r => [r, r]), ...(isOther && v.routine !== "__other" ? [[v.routine, v.routine]] : []), ["__other", "その他（下に記述）"]];
  const dateField = t
    ? fld("日付", `<input type="date" name="date" id="f-date" required value="${esc(v.date)}">`, { req: true })
    : `<div class="field full"><span class="lbl">日付<span class="req">必須</span></span>
        <div class="seg" role="radiogroup" aria-label="日付の選び方"><label><input type="radio" name="dmode" id="f-dmode-one" value="one" checked><span>1日だけ</span></label><label><input type="radio" name="dmode" id="f-dmode-multi" value="multi"><span>複数日をまとめて</span></label></div>
        <div id="d-one"><input type="date" name="date" id="f-date" value="${esc(v.date)}"></div>
        <div id="d-multi" hidden><input type="hidden" name="dates" id="f-dates" value=""><div class="mpick" id="mpick"></div>
          <div class="mpick-sum" id="mpick-sum" aria-live="polite"></div>
          <span class="help">日付をタップして選びます（もう一度タップで解除）。時間・担当・内容は、選んだすべての日に同じものが入ります。</span></div>
      </div>`;
  const body = dateField +
    `<div class="field full"><span class="lbl">担当者（複数可）<span class="req">必須</span></span><div class="pick-chips" role="group" aria-label="担当者（複数選べます）">${activeMembers().map((m, i) => `<label class="pchip" style="--mc:${mColor(m.id)}"><input type="checkbox" name="owners" id="f-owner-${i}" value="${esc(m.id)}" ${ownersOf(v).includes(m.id) ? "checked" : ""}><span><i></i>${esc(m.name || m.email)}</span></label>`).join("")}</div></div>` +
    `<div class="field full"><label class="checks" style="font-size:.88rem"><input type="checkbox" name="allday" id="f-allday" value="1" ${t ? (!t.start ? "checked" : "") : (v.start ? "" : "checked")}>時間を決めない（終日・時間未定）</label></div>` +
    fld("開始", `<input type="time" name="start" id="f-start" value="${esc(v.start || "")}">`, { half: true }) +
    fld("終了（任意）", `<input type="time" name="end" id="f-end" value="${esc(v.end || "")}">`, { half: true }) +
    fld("担当業務", sel("routine", routineOpts, v.routine === "__other" ? "__other" : v.routine), { full: true }) +
    moreBtn("メモ・共有する人を設定（いまは全員に共有）") +
    fld("内容・メモ", `<textarea name="detail" id="f-detail" placeholder="定例業務以外の場合は内容を記述してください">${esc(v.detail || "")}</textarea>`, { full: true, opt: true }) +
    asOpt(shareBox("share", v.shareWith, "全員のカレンダーに表示されます。共有した人のホームの「今日やること」に出ます。"));
  openDlg(t ? "業務を編集" : "業務を登録", body, {
    submit: async f => {
      const allday = !!f.allday || !f.start;
      const start = allday ? "" : f.start, end = allday ? "" : (f.end || "");
      if (f.routine === "__other" && !f.detail.trim()) return openMore(true), showErr("「その他」を選んだときは内容を記述してください。"), false;
      if (end && start && end < start) return showErr("終了時刻が開始時刻より前になっています。"), false;
      const multi = !t && f.dmode === "multi";
      const dates = multi ? (f.dates || "").split(",").filter(Boolean).sort() : [f.date];
      if (!dates.length || !dates[0]) return showErr(multi ? "日付を1日以上選んでください。" : "日付を入力してください。"), false;
      if (dates.length > 31) return showErr("一度に登録できるのは31日分までです。"), false;
      const owners = f.__fd.getAll("owners");
      if (!owners.length) return showErr("担当者を1人以上選んでください。"), false;
      const data = { date: dates[0], start, end, owner: owners[0], owners, routine: f.routine, label: "", detail: f.detail.trim(), shareWith: readShare(f, "share") };
      if (t) await updateDoc(doc(db, "tasks", t.id), data);
      else {
        Object.assign(data, { done: false, createdBy: uid(), createdAt: serverTimestamp() });
        if (dates.length === 1) await addDoc(collection(db, "tasks"), data);
        else { const b = writeBatch(db); dates.forEach(d => b.set(doc(collection(db, "tasks")), { ...data, date: d })); await b.commit(); }
        memSet("last_task", { start: data.start, end: data.end, routine: data.routine, shareWith: data.shareWith });
      }
      S.selDay = dates[0]; S.calMonth = dates[0].slice(0, 7); S.anim = "in";
      if (dates.length > 1) return dates.length + "日分の業務を登録しました";
    },
    del: t ? () => deleteDoc(doc(db, "tasks", t.id)) : null,
    draft: t ? null : "task"
  });
  wireShare("share");
  const ad = form.querySelector("#f-allday"), st = form.querySelector("#f-start"), en = form.querySelector("#f-end");
  const syncAd = () => { [st, en].forEach(x => { x.disabled = ad.checked; x.closest(".field").style.opacity = ad.checked ? .45 : 1; }); };
  ad.addEventListener("change", () => { if (!ad.checked && !st.value) st.value = "10:00"; syncAd(); }); syncAd();
  if (!t) { wireMultiDate(v.date); restoreDraft(); syncAd(); syncDateMode(); }
  // 「その他」を選んだときは内容の記入が必要なので、メモ欄を開く
  const rt = form.querySelector('[name="routine"]');
  const chkOther = () => { if (rt && rt.value === "__other") openMore(false); };
  if (rt) rt.addEventListener("change", chkOther); chkOther(); autoMore();
}

/* 複数日の選択：小さなカレンダーで日付をタップして選ぶ */
let pickMonth = THISMONTH, syncDateMode = () => { };
function wireMultiDate(initial) {
  const one = form.querySelector("#d-one"), multi = form.querySelector("#d-multi"), hid = form.querySelector("#f-dates"), box = form.querySelector("#mpick"), sum = form.querySelector("#mpick-sum"), dateIn = form.querySelector("#f-date");
  pickMonth = (initial || TODAY).slice(0, 7);
  const getSel = () => new Set((hid.value || "").split(",").filter(Boolean));
  const setSel = set => { hid.value = [...set].sort().join(","); form.dispatchEvent(new Event("change")); };
  const draw = (dir) => {
    const sel = getSel(); const first = parse(pickMonth + "-01"); const start = weekStart(first);
    let cells = DOW.map((d, i) => `<span class="mp-dow${i === 0 ? " sun" : i === 6 ? " sat" : ""}">${d}</span>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d);
      if (i >= 35 && ym(d) !== pickMonth) break;
      cells += `<button type="button" class="mp-day${ym(d) !== pickMonth ? " out" : ""}${k === TODAY ? " today" : ""}${sel.has(k) ? " on" : ""}" data-pd="${k}" aria-pressed="${sel.has(k)}" aria-label="${md(k)}">${d.getDate()}</button>`;
    }
    box.innerHTML = `<div class="mp-head"><button type="button" class="mp-nav" data-pm="-1" aria-label="前の月">‹</button><b>${monthLabel(pickMonth)}</b><button type="button" class="mp-nav" data-pm="1" aria-label="次の月">›</button></div><div class="mp-grid${dir ? " slide-" + dir : ""}">${cells}</div>`;
    const list = [...sel].sort();
    sum.innerHTML = list.length ? `<b>${list.length}日</b>選択中：${list.slice(0, 8).map(md).join("・")}${list.length > 8 ? ` ほか${list.length - 8}日` : ""} <button type="button" class="link" data-pclear>すべて解除</button>` : `<span class="muted">まだ選ばれていません</span>`;
  };
  box.addEventListener("click", e => {
    const nav = e.target.closest("[data-pm]"); if (nav) { pickMonth = shiftMonth(pickMonth, +nav.dataset.pm); draw(+nav.dataset.pm > 0 ? "l" : "r"); return; }
    const b = e.target.closest("[data-pd]"); if (!b) return;
    const set = getSel(); const k = b.dataset.pd; set.has(k) ? set.delete(k) : set.add(k); setSel(set);
    if (ym(parse(k)) !== pickMonth) { pickMonth = k.slice(0, 7); }
    draw();
    const nb = box.querySelector(`[data-pd="${k}"]`); if (nb) { nb.classList.add("pop"); nb.focus({ preventScroll: true }); }
  });
  sum.addEventListener("click", e => { if (e.target.closest("[data-pclear]")) { setSel(new Set()); draw(); } });
  syncDateMode = () => {
    const isMulti = form.querySelector("#f-dmode-multi").checked;
    if (isMulti && !hid.value && dateIn.value) hid.value = dateIn.value;
    one.hidden = isMulti; multi.hidden = !isMulti; dateIn.required = !isMulti;
    if (isMulti) { const f = (hid.value.split(",").filter(Boolean).sort()[0]); if (f) pickMonth = f.slice(0, 7); draw(); }
  };
  form.querySelectorAll("[name=dmode]").forEach(r => r.addEventListener("change", syncDateMode));
  syncDateMode();
}

/* ===== 未対応事項：日付のない「やらなきゃいけないこと」を全員で共有 ===== */
const canEditIssue = i => can("issue_editAll") || (i.createdBy === uid() && can("issue_add"));
const canToggleIssue = i => canEditIssue(i) || ((i.owners || []).includes(uid()) && can("issue_add"));
function issueItem(i) {
  const late = i.due && !i.done && i.due < TODAY;
  const owners = (i.owners || []).map(whoTag).join(" ");
  return `<div class="task issue${i.done ? " done" : ""}">
    <div class="time">${i.due ? `<span class="${late ? "neg" : ""}">${md(i.due).replace(/\(.\)/, "")}まで</span>` : `<span class="muted">期限なし</span>`}</div>
    <div><div class="what">${late ? `<span class="pill bad">期限切れ</span> ` : ""}${esc(i.title)}</div><div class="whos">${owners || `<span class="muted" style="font-size:.8rem">担当未定</span>`}</div></div>
    <div class="acts">${canToggleIssue(i) ? `<label><input type="checkbox" data-act="issue-done" data-id="${esc(i.id)}" ${i.done ? "checked" : ""}>完了</label>` : (i.done ? `<span class="pill good">完了</span>` : "")}<button class="link" type="button" data-act="issue-open" data-id="${esc(i.id)}">${canEditIssue(i) ? "編集" : "詳細"}</button></div>
    ${i.detail ? `<div class="sub">${esc(i.detail)}</div>` : ""}
  </div>`;
}
function issueDialog(it) {
  if (it && !canEditIssue(it)) {
    openDlg("未対応事項", fld("内容", `<div class="ro">${esc(it.title)}</div>`, { full: true }) + (it.detail ? fld("詳細", `<div class="ro" style="white-space:pre-line">${esc(it.detail)}</div>`, { full: true }) : "") +
      fld("期限", `<div class="ro">${it.due ? md(it.due) : "なし"}</div>`) + fld("担当", `<div class="ro">${esc((it.owners || []).map(memName).join("・") || "未定")}</div>`) +
      fld("追加した人", `<div class="ro">${esc(memName(it.createdBy))}</div>`, { help: "編集できるのは追加した人と管理者・副管理者です" }), { readOnly: true });
    return;
  }
  const v = it || { title: "", detail: "", due: "", owners: [] };
  const body = fld("内容", `<input name="title" id="f-title" required value="${esc(v.title)}" placeholder="例：LPの問い合わせフォームの動作確認">`, { full: true, req: true }) +
    `<div class="field full"><span class="lbl">担当（任意・複数可）</span><div class="pick-chips">${activeMembers().map((m, i) => `<label class="pchip" style="--mc:${mColor(m.id)}"><input type="checkbox" name="owners" id="f-iowner-${i}" value="${esc(m.id)}" ${(v.owners || []).includes(m.id) ? "checked" : ""}><span><i></i>${esc(m.name || m.email)}</span></label>`).join("")}</div><span class="help">決まっていなければ空欄でOK。運営メンバー全員のホームに表示されます。</span></div>` +
    moreBtn("詳細・期限を追加") +
    fld("詳細（任意）", `<textarea name="detail" id="f-detail">${esc(v.detail || "")}</textarea>`, { full: true, opt: true }) +
    fld("期限（任意）", `<input type="date" name="due" id="f-due" value="${esc(v.due || "")}">`, { full: true, opt: true });
  openDlg(it ? "未対応事項を編集" : "未対応事項を追加", body, {
    submit: async f => {
      const data = { title: f.title.trim(), detail: f.detail.trim(), due: f.due || "", owners: f.__fd.getAll("owners") };
      if (!data.title) return showErr("内容を入力してください。"), false;
      if (it) await updateDoc(doc(db, "issues", it.id), data);
      else { Object.assign(data, { done: false, createdBy: uid(), createdAt: serverTimestamp(), notified: false }); await addDoc(collection(db, "issues"), data); S.anim = "in"; return cfg().issueNotify === false ? "未対応事項を追加しました" : "未対応事項を追加しました。メンバーに通知されます"; }
    },
    del: it ? () => deleteDoc(doc(db, "issues", it.id)) : null,
    draft: it ? null : "issue"
  });
  autoMore();
  if (!it) restoreDraft();
}
function myLedDialog(r) {
  const body = fld("日付", `<div class="ro">${md(r.date)}</div>`) + fld("金額", `<div class="ro">${r.type === "収入" ? "+" : "−"}${yen(r.amount)}</div>`) +
    fld("項目", `<div class="ro">${esc(r.title)}</div>`, { full: true }) + fld("状態", `<div class="ro">${ledStatus(r)}</div>`, { full: true, help: r.confirmed ? "管理者が確認済みなので、取り消せません。間違いがあれば管理者に連絡してください" : "間違えた場合は、下の「削除」で取り消して、もう一度記録してください" });
  openDlg("自分の記録", body + (r.hasReceipt ? fld("領収書", `<div class="ro"><span class="pill good">添付済み</span></div>`, { full: true }) : ""), { readOnly: true, del: r.confirmed ? null : () => { const b = writeBatch(db); b.delete(doc(db, "ledger", r.id)); b.delete(doc(db, "ledgerMine", r.id)); if (r.hasReceipt) b.delete(doc(db, "receipts", r.id)); return b.commit(); } });
}
function ledDialog(r) {
  const c = cfg(); const accs = finView() && S.priv ? sortedAccs() : [];
  const lastL = memGet("last_led") || {};
  const v = r || { date: TODAY, type: lastL.type === "収入" ? "収入" : "支出", category: lastL.category || c.expenseCats[0], owner: lastL.owner || memName(uid()), method: lastL.method || "現金", settled: lastL.settled || "未精算", title: "", amount: "", memo: "", account: lastL.account || "", fromAccount: "", toAccount: "" };
  const types = accs.length >= 2 || v.type === "振替" ? ["支出", "収入", "振替"] : ["支出", "収入"];
  const catList = t => t === "収入" ? c.incomeCats : c.expenseCats;
  const accOpts = [["", "（未設定）"], ...accs.map(a => [a.id, a.name])];
  const canRc = !r || finEdit();
  const body = fld("項目", `<input name="title" id="f-title" required value="${esc(v.title)}" placeholder="例：Anam.ai 10月分">`, { full: true, req: true }) +
    fld("区分", sel("type", types, v.type)) + `<div class="field" id="cat-field"><span class="lbl">カテゴリ</span>${sel("category", catList(v.type === "振替" ? "支出" : v.type), v.category)}</div>` +
    fld("金額（円）", `<input name="amount" id="f-amount" type="number" min="0" step="1" required value="${esc(v.amount)}">`, { req: true }) +
    fld("日付", `<input type="date" name="date" id="f-date" required value="${esc(v.date)}">`, { req: true }) +
    (accs.length ? `<div class="field full" id="acc-field"><span class="lbl">口座</span>${sel("account", accOpts, v.account || "")}<span class="help">どの口座のお金か（カード払いは、引き落としの口座）</span></div>
      <div class="field" id="tr-from"><span class="lbl">移す元の口座<span class="req">必須</span></span>${sel("fromAccount", accOpts, v.fromAccount || "")}</div>
      <div class="field" id="tr-to"><span class="lbl">移す先の口座<span class="req">必須</span></span>${sel("toAccount", accOpts, v.toAccount || "")}</div>
      <p class="muted full" id="tr-help" style="grid-column:1/-1;margin:-4px 0 0;font-size:.75rem">振替（Stripeから銀行への入金、現金の預け入れなど）は、収入にも支出にも数えません。</p>` : "") +
    `<div class="field full" id="owner-field"><span class="lbl">担当者</span>${memberChips("owner", [v.owner], { multi: false, byName: true, extra: [v.owner] })}</div>` +
    `<div class="field" id="method-field"><span class="lbl">支払方法</span>${sel("method", c.methods, v.method)}</div>` +
    `<div class="field" id="settled-field"><span class="lbl">精算</span>${sel("settled", ["未精算", "精算済", "対象外"], v.settled)}<span class="help">立替払いは「未精算」、返金したら「精算済」</span></div>` +
    fld("メモ", `<textarea name="memo" id="f-memo">${esc(v.memo || "")}</textarea>`, { full: true }) +
    `<div class="field full" id="rc-field"><span class="lbl">領収書（任意）</span>${r && r.hasReceipt ? `<div class="ro"><span class="pill good">添付済み</span>${S.priv ? ` <button class="link" type="button" id="rc-view">見る</button>` : ""}</div>` : ""}${canRc ? `<input type="file" id="f-receipt" accept="image/*,application/pdf"><span class="help">写真はこの端末で小さくしてから、暗号化して保存します。PDFは600KBまで${r && r.hasReceipt ? "。選ぶと差し替えます" : ""}</span>` : ""}</div>` +
    (finEdit() ? `<div class="field full"><label class="checks" style="font-size:.88rem"><input type="checkbox" name="confirmed" id="f-confirmed" value="1" ${r && r.confirmed ? "checked" : ""}>確認済みにする（記録した本人は取り消せなくなる）</label></div>` : "") +
    (r && (r.createdBy || r.source) ? `<p class="muted full" style="grid-column:1/-1;margin:0;font-size:.78rem">記録：${esc(r.source === "stripe" ? "Stripe（自動）" : memName(r.createdBy))}${r.updatedBy && r.updatedBy !== r.createdBy ? `・最終更新：${esc(memName(r.updatedBy))}` : ""}</p>` : "");
  openDlg(r ? "収支を編集" : "収支を記録", body, {
    submit: async f => {
      const amt = Number(f.amount); if (!(amt >= 0) || f.amount === "") return showErr("金額を数字で入力してください。"), false;
      const tr = f.type === "振替";
      const data = { title: f.title.trim(), type: f.type, category: tr ? "振替" : f.category, amount: amt, date: f.date, owner: f.owner || "", method: tr ? "" : f.method, settled: tr ? "対象外" : f.settled, memo: f.memo.trim(), account: tr ? "" : (f.account || ""), fromAccount: tr ? f.fromAccount : "", toAccount: tr ? f.toAccount : "" };
      if (!data.title) return showErr("項目を入力してください。"), false;
      if (tr && (!data.fromAccount || !data.toAccount || data.fromAccount === data.toAccount)) return showErr("振替は、移す元と移す先に別々の口座を選んでください。"), false;
      if (!S.vaultPub) return showErr("管理者が収支の暗号化を設定するまで、記録できません。"), false;
      const file = form.querySelector("#f-receipt") && form.querySelector("#f-receipt").files[0];
      let rc = null; if (file) { try { rc = await prepReceipt(file); } catch (e) { return showErr(e.message), false; } }
      const enc = await sealRecord(data, S.vaultPub);
      const rcDoc = rc ? { enc: await sealRaw(rc.bytes, S.vaultPub), mime: rc.mime, size: rc.bytes.length, createdBy: uid(), createdAt: serverTimestamp() } : null;
      const meta = { enc, updatedBy: uid(), updatedAt: serverTimestamp() };
      if (r) {
        if (rcDoc) await setDoc(doc(db, "receipts", r.id), rcDoc);
        await updateDoc(doc(db, "ledger", r.id), { ...meta, confirmed: !!f.confirmed, ...(rcDoc ? { hasReceipt: true } : {}) });
      } else {
        const ref = doc(collection(db, "ledger")); const b = writeBatch(db);
        b.set(ref, { ...meta, confirmed: finEdit() ? !!f.confirmed : false, hasReceipt: !!rcDoc, createdBy: uid(), createdAt: serverTimestamp() });
        // 追加だけの人は、自分だけが見られる控え（日付・項目・区分・金額など）も一緒に保存
        if (!finEdit()) b.set(doc(db, "ledgerMine", ref.id), { createdBy: uid(), date: data.date, title: data.title, type: data.type, amount: data.amount, category: data.category, method: data.method, hasReceipt: !!rcDoc, createdAt: serverTimestamp() });
        if (rcDoc) b.set(doc(db, "receipts", ref.id), rcDoc);
        await b.commit();
        memSet("last_led", { type: data.type, category: data.category, owner: data.owner, method: data.method, settled: data.settled, account: data.account });
      }
      S.moneyMonth = f.date.slice(0, 7);
      return rcDoc ? "保存しました（領収書も暗号化して保存）" : "保存しました";
    },
    del: r && finEdit() ? () => { const b = writeBatch(db); b.delete(doc(db, "ledger", r.id)); b.delete(doc(db, "ledgerMine", r.id)); if (r.hasReceipt) b.delete(doc(db, "receipts", r.id)); return b.commit(); } : null,
    draft: null   // 収支は端末に下書きを残さない
  });
  const ty = form.querySelector("#f-type"), ca = form.querySelector("#f-category");
  const show = (id, on) => { const el = form.querySelector(id); if (el) el.hidden = !on; };
  const sync = () => {
    const tr = ty.value === "振替";
    ["#tr-from", "#tr-to", "#tr-help"].forEach(x => show(x, tr)); ["#acc-field", "#cat-field", "#method-field", "#settled-field"].forEach(x => show(x, !tr));
    if (!tr) { const keep = ca.value; ca.innerHTML = catList(ty.value).map(o => `<option${o === keep ? " selected" : ""}>${esc(o)}</option>`).join(""); }
  };
  ty.addEventListener("change", sync); sync();
  const rv = form.querySelector("#rc-view"); if (rv) rv.addEventListener("click", () => viewReceipt(r.id).catch(e => toast(errMsg(e), "error")));
  const fi = form.querySelector("#f-receipt"); if (fi) fi.addEventListener("change", () => { const fl = fi.files[0]; if (fl) toast(`${fl.name}（${Math.round(fl.size / 1024)}KB）を添付します。保存すると暗号化して保存します`, "info"); });
}

/* CSV import (Notionの書き出しと同じ列名：項目,区分,カテゴリ,金額,日付,担当者,支払方法,精算,メモ) */
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}
function normDate(s) {
  s = (s || "").trim(); let m;
  if ((m = s.match(/^(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/))) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
  const d = new Date(s); return isNaN(d) ? "" : ymd(d);
}
function importDialog() {
  openDlg("CSVを取り込む", fld("CSVファイル", `<input type="file" id="f-csv" name="csv" accept=".csv,text/csv" required>`, { full: true, help: "1行目の列名：項目, 区分, カテゴリ, 金額, 日付, 担当者, 支払方法, 精算, メモ（NotionのCSV書き出しをそのまま使えます）。日付・項目・金額が同じ記録は登録済みとして飛ばします" }) + `<p class="muted full" id="f-prev" style="grid-column:1/-1;margin:0;font-size:.85rem"></p>`, {
    submit: async () => {
      const file = form.querySelector("#f-csv").files[0]; if (!file) return showErr("ファイルを選んでください。"), false;
      const rows = parseCSV(await file.text()); if (rows.length < 2) return showErr("データ行がありません。"), false;
      const h = rows[0].map(x => x.trim()); const ix = n => h.indexOf(n);
      if (ix("項目") < 0 || ix("金額") < 0 || ix("日付") < 0 || ix("区分") < 0) return showErr("「項目」「区分」「金額」「日付」の列が見つかりません。"), false;
      const items = rows.slice(1).map(r => {
        const g = n => ix(n) < 0 ? "" : (r[ix(n)] || "").trim();
        return { title: g("項目"), type: g("区分") === "収入" ? "収入" : "支出", category: g("カテゴリ") || "その他", amount: Number(g("金額").replace(/[¥￥,円\s]/g, "")) || 0, date: normDate(g("日付")), owner: g("担当者"), method: g("支払方法"), settled: g("精算") || "対象外", memo: g("メモ") };
      }).filter(x => x.title && x.date);
      if (!items.length) return showErr("取り込める行がありませんでした。日付の形式を確認してください。"), false;
      const keyOf = x => [x.date, x.title, Number(x.amount), x.type].join("|");
      const have = new Set(S.ledger.map(keyOf));
      const fresh = items.filter(x => !have.has(keyOf(x)));
      const skipped = items.length - fresh.length;
      if (!fresh.length) { closeDlg(); toast("すべて登録済みでした（" + skipped + "件）。追加はありません", "info"); return false; }
      items.length = 0; items.push(...fresh); S.importSkipped = skipped;
      for (let i = 0; i < items.length; i += 200) { const b = writeBatch(db); for (const x of items.slice(i, i + 200)) b.set(doc(collection(db, "ledger")), { enc: await sealRecord(ledPlain(x), S.vaultPub), confirmed: true, createdBy: uid(), createdAt: serverTimestamp(), updatedBy: uid(), updatedAt: serverTimestamp() }); await b.commit(); }
      closeDlg(); toast(items.length + "件を取り込みました" + (S.importSkipped ? "（登録済みの" + S.importSkipped + "件は飛ばしました）" : "")); return false;
    }
  });
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const tab = e.target.closest("#tabs [data-tab]"); if (tab) {
    if (S.tab === "admin" && S.adminSub === "settings" && S.settingsDirty && tab.dataset.tab !== "admin" && !S.leaveArmed) { S.leaveArmed = true; toast("設定が未保存です。もう一度押すと変更を破棄して移動します", "warn"); setTimeout(() => S.leaveArmed = false, 4000); return; }
    if (tab.dataset.tab !== "admin") S.settingsDirty = false;
    if (S.tab !== tab.dataset.tab) S.anim = "in";
    S.tab = tab.dataset.tab; try { history.replaceState(null, "", "#" + S.tab); } catch (_) { } setMenu(false); render(); window.scrollTo(0, 0); return; }
  const a = e.target.closest("[data-act]"); if (!a || (a.closest("dialog") && !a.closest("form.is-sheet"))) {
    const rm = e.target.closest("[data-rm]"); if (rm && !rm.closest("dialog")) { rm.parentElement.remove(); markDirty(); return; }
    const ad = e.target.closest("[data-add]"); if (ad && !ad.closest("dialog")) { const box = document.querySelector(`[data-list="${ad.dataset.add}"]`); box.insertAdjacentHTML("beforeend", rowHTML(ad.dataset.add, Date.now(), "", "追加項目")); box.lastElementChild.querySelector("input").focus(); markDirty(); }
    return;
  }
  const act = a.dataset.act, id = a.dataset.id;
  if (act === "login") return login();
  if (act === "logout") { if (notifyOn()) await disablePush(); await signOut(auth); return; }
  if (act === "notify") return notifyDialog();
  if (act === "mpick") { const k = a.dataset.k; return openSheet({ kind: "month", key: k, y: Number(S[k].slice(0, 4)) }); }
  if (act === "mp-year") { S.sheet.y += Number(a.dataset.step); refreshSheet(); return; }
  if (act === "mp-pick") { const k = S.sheet.key; const v = a.dataset.v; closeDlg(); if (v !== S[k]) { S.anim = v < S[k] ? "r" : "l"; S[k] = v; if (k === "calMonth") S.selDay = v === THISMONTH ? TODAY : v + "-01"; render(); } return; }
  if (act === "kpi-detail") return openSheet({ kind: "kpi", id });
  if (act === "go") { if (dlg.open) closeDlg(); S.anim = "in"; S.tab = a.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (act === "mprev" || act === "mnext") { const k = a.dataset.k; S.anim = act === "mprev" ? "r" : "l"; S[k] = shiftMonth(S[k], act === "mprev" ? -1 : 1); if (k === "calMonth") S.selDay = S.calMonth === THISMONTH ? TODAY : S.calMonth + "-01"; render(); return; }
  if (act === "kpi-new") return kpiDialog(null);
  if (act === "kpi-tpl") return kpiDialog(null, KPI_TEMPLATES[+a.dataset.i]);
  if (act === "kpi-edit") return kpiDialog(S.kpis.find(k => k.id === id));
  if (act === "kpi-del") {
    if (S.armDel !== id) { S.armDel = id; render(); clearTimeout(S.armTimer); S.armTimer = setTimeout(() => { S.armDel = null; render(); }, 5000); return; }
    S.armDel = null; try { await deleteDoc(doc(db, "kpis", id)); toast("KPIを削除しました"); } catch (err) { toast(errMsg(err), "error"); } return;
  }
  if (act === "kpi-carry") {
    const prev = S.kpis.filter(k => k.month === shiftMonth(S.kpiMonth, -1));
    try { const b = writeBatch(db); prev.forEach(k => b.set(doc(collection(db, "kpis")), { name: k.name, track: isTrack(k), target: k.target ?? null, unit: k.unit || "", mode: k.mode, owner: k.owner, viewers: k.viewers || ["all"], month: S.kpiMonth, weekly: {}, order: k.order || Date.now(), createdAt: serverTimestamp() })); await b.commit(); toast("先月のKPIを引き継ぎました"); } catch (err) { toast(errMsg(err), "error"); }
    return;
  }
  if (act === "task-new") { if (!can("cal_add")) return; return taskDialog(null, a.dataset.d); }
  if (act === "task-open") return taskDialog(S.tasks.find(t => t.id === id));
  if (act === "day") { S.selDay = a.dataset.d; render();
    if (window.matchMedia && matchMedia("(max-width:860px)").matches) openSheet({ kind: "day", d: a.dataset.d }); else { S.pulse = ".day-panel"; render(); }
    return; }
  if (act === "led-edit") { const r = S.ledger.find(x => x.id === id); if (r && finEdit()) ledDialog(r); else if (r && canEditLed(r)) myLedDialog(r); return; }
  if (act === "vault-lock") { lockVault("収支をロックしました"); return; }
  if (act === "acc-new") { if (finEdit() && S.priv) accountDialog(null); return; }
  if (act === "acc-open") { const ac = (S.accounts || []).find(x => x.id === id); if (ac) accountDialog(ac); return; }
  if (act === "vault-pass") { if (S.isAdmin) vaultPassDialog(false); return; }
  if (act === "vault-recover") { if (S.isAdmin) vaultPassDialog(true); return; }
  if (act === "vault-rk-copy") { copyPlain(S.pendingRecovery || "", "復旧キーをコピーしました。紙にも書き留めてください"); return; }
  if (act === "vault-rk-done") { const ok = document.getElementById("v-rk-ok"); if (!ok || !ok.checked) { toast("書き留めたら、チェックを入れてください", "warn"); return; } S.pendingRecovery = null; S.anim = "in"; render(); migrateLegacy(); return; }
  if (act === "led-new") { if (finAdd()) ledDialog(null); return; }
  if (act === "led-import") { if (finEdit() && S.priv) importDialog(); return; }
  if (act === "inv-new") return inviteDialog();
  if (act === "issue-new") { if (can("issue_add")) issueDialog(null); return; }
  if (act === "issue-open") return issueDialog((S.issues || []).find(i => i.id === id));
  if (act === "issue-showdone") { S.showDoneIssues = !S.showDoneIssues; render(); return; }
  if (act === "tpl-new") { if (can("tpl_add")) tplDialog(null); return; }
  if (act === "tpl-edit") { const tp = (S.templates || []).find(x => x.id === id); if (tp) tplDialog(tp); return; }
  if (act === "tpl-copy") { const tp = (S.templates || []).find(x => x.id === id); if (tp) copyPlain(tp.body, "「" + tp.title + "」をコピーしました"); return; }
  if (act === "tpl-cat") { S.tplCat = a.dataset.v; render(); return; }
  if (act === "min-new") { if (can("min_add")) minuteDialog(); return; }
  if (act === "min-open") { S.minId = id; S.anim = "l"; render(); window.scrollTo(0, 0); return; }
  if (act === "min-back") { S.minId = null; S.anim = "r"; render(); return; }
  if (act === "min-edit") { const m = (S.minutes || []).find(x => x.id === id); if (m) minuteEditDialog(m); return; }
  if (act === "min-more") { const m = (S.minutes || []).find(x => x.id === id); if (m) minuteMoreDialog(m); return; }
  if (act === "min-retry") { closeDlg(); try { await updateDoc(doc(db, "minutes", id), { status: "pending", error: "", startedAt: "", queuedAt: serverTimestamp() }); toast("もう一度まとめます。5〜15分ほどお待ちください"); } catch (err) { toast(errMsg(err), "error"); } return; }
  if (act === "min-todo") { const m = (S.minutes || []).find(x => x.id === id); if (m) { try { await minuteTodoToIssue(m, Number(a.dataset.i)); } catch (err) { toast(errMsg(err), "error"); } } return; }
  if (act === "min-copy") { const m = (S.minutes || []).find(x => x.id === id); if (m) { copyPlain(minPlain(m), "要約をコピーしました"); closeDlg(); } return; }
  if (act === "min-del") {
    if (S.armDel !== id) { S.armDel = id; refreshSheet(); clearTimeout(S.armTimer); S.armTimer = setTimeout(() => { S.armDel = null; refreshSheet(); }, 5000); return; }
    S.armDel = null; closeDlg(); try { await deleteDoc(doc(db, "minutes", id)); S.minId = null; toast("議事録を削除しました"); render(); } catch (err) { toast(errMsg(err), "error"); } return;
  }
  if (act === "form-new") return formDialog(null);
  if (act === "form-edit") return formDialog((S.forms || []).find(f => f.id === id));
  if (act === "form-copy") { const f = (S.forms || []).find(x => x.id === id); if (f) copyPlain(formShareText(f), f.message ? "案内文をコピーしました" : "リンクをコピーしました"); return; }
  if (act === "form-copy-url") { const f = (S.forms || []).find(x => x.id === id); if (f) copyPlain(f.url, "リンクをコピーしました"); return; }
  if (act === "form-up" || act === "form-down") { try { await moveForm(id, act === "form-up" ? -1 : 1); } catch (err) { toast(errMsg(err), "error"); } return; }
  if (act === "inv-copy") { const iv = (S.invites || []).find(x => x.id === id); return copyText(inviteText(iv && iv.name)); }
  if (act === "inv-del") {
    if (S.armDel !== "inv:" + id) { S.armDel = "inv:" + id; render(); clearTimeout(S.armTimer); S.armTimer = setTimeout(() => { S.armDel = null; render(); }, 5000); return; }
    S.armDel = null; try { await deleteDoc(doc(db, "invites", id)); toast("追加を取り消しました", "info"); } catch (err) { toast(errMsg(err), "error"); } return;
  }
  if (act === "mem-color") { try { await updateDoc(doc(db, "members", id), { color: a.dataset.c }); toast("色を変更しました"); } catch (err) { toast(errMsg(err), "error"); } return; }
  if (act === "mem-del") {
    const m = S.members.find(x => x.id === id); if (!m || m.status === "active" || m.id === uid()) return;
    if (S.armDel !== "mem:" + id) { S.armDel = "mem:" + id; render(); clearTimeout(S.armTimer); S.armTimer = setTimeout(() => { S.armDel = null; render(); }, 5000); return; }
    S.armDel = null;
    try {
      await deleteDoc(doc(db, "members", id));
      const em = (m.email || "").toLowerCase(); if (em && (S.invites || []).some(iv => iv.id === em)) await deleteDoc(doc(db, "invites", em));
      toast((m.name || m.email || "メンバー") + "さんを名簿から削除しました", "info");
    } catch (err) { toast(errMsg(err), "error"); }
    return;
  }
  if (act === "mem-status") { try { await updateDoc(doc(db, "members", id), { status: a.dataset.v }); toast(a.dataset.v === "active" ? "承認しました" : "停止しました"); } catch (err) { toast(errMsg(err), "error"); } return; }
  if (act === "save-settings") {
    const out = {}; ["routines", "expenseCats", "incomeCats", "methods"].forEach(k => { out[k] = [...document.querySelectorAll(`[data-list="${k}"] input`)].map(i => i.value.trim()).filter(Boolean); });
    const nt = document.getElementById("s-notifyTime"), ne = document.getElementById("s-notifyEnabled"), vk = document.getElementById("s-vapid"), ni = document.getElementById("s-issueNotify");
    if (nt) out.notifyTime = nt.value; if (ne) out.notifyEnabled = ne.checked; if (ni) out.issueNotify = ni.checked; if (vk) out.vapidKey = vk.value.trim();
    const perms = document.querySelector("[data-perm]") ? readPermTable() : null;
    try { await setDoc(doc(db, "config", "main"), out, { merge: true }); if (perms) await setDoc(doc(db, "config", "perms"), perms); S.settingsDirty = false; toast("設定を保存しました"); render(); } catch (err) { toast(errMsg(err), "error"); }
  }
});
document.addEventListener("keydown", e => { if (e.key === "Enter") { const r = e.target.closest && e.target.closest("tr[data-act=led-edit]"); if (r) { const x = S.ledger.find(y => y.id === r.dataset.id); if (x && finEdit()) ledDialog(x); else if (x && canEditLed(x)) myLedDialog(x); } } });
document.addEventListener("change", async e => {
  const a = e.target.closest("[data-act]"); if (!a || (a.closest("dialog") && !a.closest("form.is-sheet"))) return;
  const act = a.dataset.act, id = a.dataset.id;
  if (act === "adm-sub") {
    if (S.adminSub === "settings" && S.settingsDirty && a.value !== "settings" && !S.leaveArmed) { a.checked = false; document.getElementById("adm-settings").checked = true; S.leaveArmed = true; toast("設定が未保存です。もう一度押すと変更を破棄して移動します", "warn"); setTimeout(() => S.leaveArmed = false, 4000); return; }
    S.settingsDirty = false; S.adminSub = a.value; S.anim = "in"; try { history.replaceState(null, "", "#" + a.value); } catch (_) { } render(); return;
  }
  if (act === "onlymine") { S.onlyMine = a.checked; ls.set("shin_onlymine", a.checked ? "1" : "0"); render(); return; }
  try {
    if (act === "issue-done") {
      const row = a.closest(".task"); if (row) { row.classList.toggle("done", a.checked); row.classList.add("just"); }
      if (a.checked) toast("完了にしました", "success", { action: { label: "元に戻す", run: () => updateDoc(doc(db, "issues", id), { done: false, doneAt: null }).catch(e => toast(errMsg(e), "error")) } });
      await new Promise(r => setTimeout(r, reducedMotion() ? 0 : 380));
      await updateDoc(doc(db, "issues", id), { done: a.checked, doneAt: a.checked ? serverTimestamp() : null, doneBy: a.checked ? uid() : null });
    }
    if (act === "task-done") {
      const row = a.closest(".task"); if (row) { row.classList.toggle("done", a.checked); row.classList.add("just"); if (a.checked && S.tab === "home" && !row.closest("dialog")) setTimeout(() => row.classList.add("leaving"), 120); }
      if (a.checked) toast("完了にしました", "success", { action: { label: "元に戻す", run: () => updateDoc(doc(db, "tasks", id), { done: false }).catch(e => toast(errMsg(e), "error")) } });
      await new Promise(r => setTimeout(r, reducedMotion() ? 0 : 380));
      await updateDoc(doc(db, "tasks", id), { done: a.checked });
    }
    if (act === "kpi-cell") { const raw = a.value.trim(); await updateDoc(doc(db, "kpis", id), new FieldPath("weekly", a.dataset.wk), { value: raw === "" ? null : Number(raw), by: uid() }); toast("保存しました"); }
    if (act === "mem-name") { await updateDoc(doc(db, "members", id), { name: a.value.trim() }); toast("表示名を保存しました"); }
    if (act === "mem-role") { await updateDoc(doc(db, "members", id), { role: a.value }); toast(memName(id) + "さんを「" + roleLabel(a.value) + "」にしました"); }
  } catch (err) { if (a.type === "checkbox") a.checked = !a.checked; toast(errMsg(err), "error"); }
});

/* ---------- 並べ替え（ドラッグ＆ドロップ・タッチ・キーボード対応） ---------- */
document.addEventListener("input", e => { if (e.target.closest("[data-list]") || /^s-(notify|vapid)/.test(e.target.id || "")) markDirty(); });
document.addEventListener("change", e => { if (/^s-notify/.test(e.target.id || "")) markDirty(); });
document.addEventListener("pointerdown", e => {
  const handle = e.target.closest(".listedit .handle"); if (!handle || e.button > 0) return;
  e.preventDefault();
  const row = handle.closest(".row"), box = row.parentElement;
  S.dragging = true; row.classList.add("dragging");
  const move = ev => {
    if (ev.pointerId !== e.pointerId) return;
    const others = [...box.children].filter(r => r !== row);
    const before = others.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (before) { if (row.nextElementSibling !== before) box.insertBefore(row, before); }
    else if (box.lastElementChild !== row) box.appendChild(row);
  };
  // 行をDOM上で動かすとポインターキャプチャが外れるため、document で受け取る
  const end = ev => {
    if (ev.pointerId !== e.pointerId) return;
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", end);
    row.classList.remove("dragging"); S.dragging = false; markDirty(); handle.focus();
  };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
});
document.addEventListener("keydown", e => {
  const handle = e.target.closest && e.target.closest(".listedit .handle"); if (!handle) return;
  const row = handle.closest(".row"), box = row.parentElement;
  if (e.key === "ArrowUp" && row.previousElementSibling) { e.preventDefault(); box.insertBefore(row, row.previousElementSibling); handle.focus(); markDirty(); }
  if (e.key === "ArrowDown" && row.nextElementSibling) { e.preventDefault(); box.insertBefore(row.nextElementSibling, row); handle.focus(); markDirty(); }
});

let h0 = (location.hash || "").slice(1); if (h0 === "members" || h0 === "settings") { S.adminSub = h0; h0 = "admin"; } if (TABS_ALL.some(([k]) => k === h0)) S.tab = h0;
render();
