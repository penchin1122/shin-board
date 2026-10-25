// SHIN 運営ボード — 通知を送る処理
// cron-job.org → GitHub Actions から10分ごとに起動され、次の3つを行います。
//  1. 朝の通知：各メンバーが決めたタイムゾーン・時刻を過ぎていて、その人の「今日」にまだ送っていなければ、
//     その人が担当の業務を、その人の現地時間に直して1回だけ送る
//  2. 未対応事項の通知：追加した人以外に送る。各メンバーの夜間の時間帯には送らず、明けてから届ける
//  3. 議事録のまとめ：「まとめ待ち」の議事録があれば、Gemini で要約して書き戻し、追加した人に通知する
//  4. Stripe 連携：取引を収支に（暗号化して）記録し、契約数・MRRをKPIに入れる（STRIPE_KEY があるときだけ）
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const SITE_URL = (process.env.SITE_URL || "").replace(/\/?$/, "/");   // notify.yml で指定（例：https://penchin1122.github.io/shin-board/）
const FORCE = process.env.FORCE === "true";      // 手動実行で「今すぐ送る」
const DRY = process.env.DRY_RUN === "true";      // 送らずに内容だけ表示
const TEST = process.env.TEST === "true";        // 管理者の端末にだけテスト通知を送る
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

export function jstNow(d = new Date()) {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return { date: `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}`, time: `${p(j.getUTCHours())}:${p(j.getUTCMinutes())}` };
}
/* ===== 時刻：業務の日付・時刻は日本時間で登録されている。通知はメンバーごとのタイムゾーンで判断する ===== */
export function localParts(tz, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour === "24" ? "00" : o.hour}:${o.minute}` };
}
const jstAbs = (date, time) => new Date(`${date}T${time}:00+09:00`);
export function prefsOf(member, cfg = {}) {
  const n = member.notify || {};
  return { morning: n.morning !== false, time: n.time || cfg.notifyTime || "07:30", tz: n.tz || "Asia/Tokyo", issues: n.issues !== false, minutes: n.minutes !== false, quietStart: n.quietStart || "23:00", quietEnd: n.quietEnd || "07:00" };
}
export function inQuiet(pref, now = new Date()) {
  const t = localParts(pref.tz, now).time, a = pref.quietStart, b = pref.quietEnd;
  if (a === b) return false;
  return a > b ? (t >= a || t < b) : (t >= a && t < b);
}
export function shouldSendMorning({ pref, now = new Date(), lastDate, force = false, enabled = true }) {
  if (force) return true;
  if (enabled === false || !pref.morning) return false;
  const lp = localParts(pref.tz, now);
  if (lastDate === lp.date) return false;
  return lp.time >= pref.time && lp.time < "12:00";
}
/* その人の「今日」（現地の日付）にある担当業務。時刻のある業務は現地時刻に直して判定、終日の業務は日付で判定 */
export function buildMorning(tasks, memberId, pref, now = new Date()) {
  const label = t => t.label ? `${t.label}（${t.routine}）` : t.routine && t.routine !== "__other" ? t.routine : (t.detail || "業務");
  const ownersOf = t => (Array.isArray(t.owners) && t.owners.length ? t.owners : (t.owner ? [t.owner] : []));
  const today = localParts(pref.tz, now).date;
  const list = tasks.filter(t => !t.done && ownersOf(t).includes(memberId)).map(t => {
    if (!t.start) return t.date === today ? { t, sort: "", time: "終日" } : null;
    const s = jstAbs(t.date, t.start); const ls = localParts(pref.tz, s);
    if (ls.date !== today) return null;
    const le = t.end ? localParts(pref.tz, jstAbs(t.date, t.end)).time : "";
    return { t, sort: ls.time, time: ls.time + (le ? "–" + le : "〜") };
  }).filter(Boolean).sort((a, b) => a.sort.localeCompare(b.sort));
  if (!list.length) return null;
  const local = pref.tz !== "Asia/Tokyo";
  return { title: `今日の担当業務（${list.length}件）`, body: list.map(x => `${x.time} ${label(x.t)}`).join("\n") + (local ? "\n※時刻は現地時間" : "") };
}

export function addDaysStr(d, n) { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
export function buildIssueMessages(issues, members) {
  // members: [{ id, name }]（有効なメンバー）。追加した本人には送らない
  const nameOf = id => (members.find(m => m.id === id) || {}).name || "メンバー";
  const out = [];
  for (const m of members) {
    const list = issues.filter(i => i.createdBy !== m.id);
    if (!list.length) continue;
    const mine = list.filter(i => (i.owners || []).includes(m.id));
    const title = list.length === 1 ? (mine.length ? "未対応事項（あなたが担当）" : "未対応事項が追加されました") : `未対応事項が${list.length}件追加されました`;
    const line = i => `${i.title}${i.due ? `（期限 ${Number(i.due.slice(5, 7))}/${Number(i.due.slice(8, 10))}）` : ""}`;
    const body = list.length === 1 ? `${line(list[0])}\n追加：${nameOf(list[0].createdBy)}` : list.slice(0, 4).map(i => "・" + line(i)).join("\n") + (list.length > 4 ? `\nほか${list.length - 4}件` : "") + (mine.length ? `\nうち${mine.length}件はあなたが担当` : "");
    out.push({ owner: m.id, title, body });
  }
  return out;
}

async function sendTo(db, fcm, uid, name, title, body, tag) {
  const toks = await db.collection(`members/${uid}/tokens`).get();
  if (toks.empty) { console.log(`- ${name}: 通知未登録`); return 0; }
  if (DRY) { console.log(`- ${name}: ${toks.size}台に「${title} / ${body.replace(/\n/g, " ／ ")}」`); return 0; }
  const res = await fcm.sendEachForMulticast({
    tokens: toks.docs.map(d => d.data().token),
    notification: { title, body },
    webpush: { fcmOptions: { link: SITE_URL }, notification: { icon: SITE_URL + "icon-192.png", badge: SITE_URL + "favicon.png", ...(tag ? { tag } : {}) } }
  });
  // 使われなくなった端末の登録は削除する
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error && r.error.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") return toks.docs[i].ref.delete();
  }));
  console.log(`- ${name}: 成功${res.successCount} 失敗${res.failureCount}`);
  return res.successCount;
}

export async function issueNotify(db, fcm, cfg, members) {
  const snap = await db.collection("issues").where("notified", "==", false).get();
  if (snap.empty) { console.log("未対応事項：新しい追加なし"); return; }
  if (cfg.issueNotify === false) {
    // 通知がオフのときは、あとでオンにしたときにまとめて届かないよう「通知済み」にしておく
    if (!DRY) { const b = db.batch(); snap.docs.forEach(d => b.update(d.ref, { notified: true })); await b.commit(); }
    console.log(`未対応事項：${snap.size}件（通知オフのため送らない）`); return;
  }
  // 受け取る人ごとに、まだ送っていないものだけを、その人の夜間を避けて送る（sentTo に送った人を記録）
  const items = snap.docs.map(d => ({ ref: d.ref, id: d.id, ...d.data() }));
  const targets = members.filter(m => prefsOf(m, cfg).issues);
  const nameOf = id => (members.find(m => m.id === id) || {}).name || "メンバー";
  const sent = {};
  for (const m of targets) {
    if (!FORCE && inQuiet(prefsOf(m, cfg))) continue;
    const list = items.filter(i => !i.done && i.createdBy !== m.id && !(i.sentTo || []).includes(m.id));
    if (!list.length) continue;
    const [msg] = buildIssueMessages(list, [{ id: m.id, name: m.name }].concat(members.filter(x => x.id !== m.id)).map(x => ({ id: x.id, name: x.name }))).filter(x => x.owner === m.id);
    if (!msg) continue;
    if (!DRY) { const b = db.batch(); list.forEach(i => { b.update(i.ref, { sentTo: FieldValue.arrayUnion(m.id) }); (sent[i.id] = sent[i.id] || []).push(m.id); }); await b.commit(); }
    await sendTo(db, fcm, m.id, m.name, msg.title, msg.body, "issues");
  }
  // 全員に届け終わったもの（または追加から24時間たったもの）は「通知済み」にする
  if (!DRY) {
    const b = db.batch(); let n = 0;
    for (const i of items) {
      const got = new Set([...(i.sentTo || []), ...(sent[i.id] || [])]);
      const need = targets.filter(m => m.id !== i.createdBy).every(m => got.has(m.id));
      const old = i.createdAt && i.createdAt.toMillis && Date.now() - i.createdAt.toMillis() > 24 * 3600e3;
      if (i.done || need || old) { b.update(i.ref, { notified: true, notifiedAt: new Date().toISOString() }); n++; }
    }
    if (n) await b.commit();
  }
  console.log(`未対応事項：${items.length}件を確認`);
}

/* ===================== Stripe 連携 =====================
   ・GitHub Secrets の STRIPE_KEY（読み取り専用の制限付きキー）で、Stripe の取引と契約を読む
   ・取引（売上・手数料・返金・入金）は、収支に暗号化して記録する（書き込み用の公開鍵で暗号化。読むにはボードの閲覧用パスワードが必要）
   ・契約（サブスク）の数とMRRは、「自動入力：Stripe」を選んだKPIに書き込む
   ・お客様の名前やメールアドレスは読まない・保存しない */
const wc = globalThis.crypto.subtle;
const b64 = buf => Buffer.from(buf).toString("base64");
const unb64 = s => new Uint8Array(Buffer.from(s, "base64"));
const EC = { name: "ECDH", namedCurve: "P-256" };
export async function sealRecord(obj, pubB64) {
  const pub = await wc.importKey("spki", unb64(pubB64), EC, false, []);
  const eph = await wc.generateKey(EC, true, ["deriveBits"]);
  const bits = new Uint8Array(await wc.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256));
  const epk = new Uint8Array(await wc.exportKey("raw", eph.publicKey));
  const h = await wc.digest("SHA-256", new Uint8Array([...bits, ...epk]));
  const key = await wc.importKey("raw", h, "AES-GCM", false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await wc.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) };
}
const ZERO_DEC = ["jpy", "krw", "vnd", "clp", "pyg", "xof", "xaf", "ugx", "rwf", "kmf", "gnf", "djf", "bif", "mga", "vuv", "xpf"];
const money = (v, cur) => ZERO_DEC.includes((cur || "jpy").toLowerCase()) ? v : v / 100;
const jstDate = unix => localParts("Asia/Tokyo", new Date(unix * 1000)).date;
async function stripeGet(path, params, key) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${path}?${qs}`, { headers: { Authorization: `Bearer ${key}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Stripe ${res.status}: ${(j.error && j.error.message) || res.statusText}`), { status: res.status });
  return j;
}
async function stripeAll(path, params, key, max = 2000) {
  const out = []; let after = null;
  for (;;) {
    const j = await stripeGet(path, { ...params, limit: 100, ...(after ? { starting_after: after } : {}) }, key);
    out.push(...j.data); if (!j.has_more || !j.data.length || out.length >= max) return out;
    after = j.data[j.data.length - 1].id;
  }
}
/* Stripe の取引1件 → 収支の記録（0〜2件）。売上は「総額」で収入、手数料は別の支出、入金は Stripe → 銀行 の振替 */
export function btToRecords(bt, { account, payoutAccount, test }) {
  const cur = bt.currency || "jpy"; const amt = money(bt.amount, cur), fee = money(bt.fee || 0, cur);
  const date = jstDate(bt.created); const tag = test ? "【テスト】" : ""; const memo = (cur.toLowerCase() !== "jpy" ? `通貨：${cur.toUpperCase()}（換算前の金額）\n` : "") + `Stripe ${bt.type} ${bt.id}`;
  const base = { date, owner: "Stripe", method: "Stripe", settled: "対象外", memo, account, fromAccount: "", toAccount: "" };
  const recs = [];
  const t = bt.type;
  if (t === "charge" || t === "payment") recs.push({ id: bt.id, ...base, title: tag + "サブスク売上", type: "収入", category: "サブスク売上", amount: Math.abs(amt) });
  else if (t === "refund" || t === "payment_refund") recs.push({ id: bt.id, ...base, title: tag + "返金", type: "支出", category: "返金", amount: Math.abs(amt) });
  else if (t === "payout" || t === "payout_failure" || t === "payout_cancel") {
    const out = amt < 0; recs.push({ id: bt.id, ...base, title: tag + (out ? "Stripeから銀行へ入金" : "入金の取り消し（Stripeに戻る）"), type: "振替", category: "振替", method: "", account: "", fromAccount: out ? account : payoutAccount, toAccount: out ? payoutAccount : account, amount: Math.abs(amt) });
  }
  else if (t === "stripe_fee" || t === "application_fee") recs.push({ id: bt.id, ...base, title: tag + "Stripe利用料", type: "支出", category: "支払手数料", amount: Math.abs(amt) });
  else if (amt !== 0) recs.push({ id: bt.id, ...base, title: tag + `Stripe（${t}）`, type: amt > 0 ? "収入" : "支出", category: "その他", amount: Math.abs(amt) });
  if (fee && t !== "stripe_fee") recs.push({ id: bt.id + "_fee", ...base, title: tag + "Stripe決済手数料", type: fee > 0 ? "支出" : "収入", category: "支払手数料", amount: Math.abs(fee) });
  return recs;
}
/* KPIの区切り（第2・第4木曜と月末）。ボードの画面と同じ決め方 */
export function meetingsOfMonth(m) {
  const [y, mo] = m.split("-").map(Number); const first = new Date(Date.UTC(y, mo - 1, 1)); const off = (4 - first.getUTCDay() + 7) % 7;
  const d = n => new Date(Date.UTC(y, mo - 1, n)).toISOString().slice(0, 10);
  return [d(1 + off + 7), d(1 + off + 21), new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)];
}
const monthly = (price, qty) => { const r = price && price.recurring; if (!r || price.unit_amount == null) return 0; const a = money(price.unit_amount, price.currency) * (qty || 1) / (r.interval_count || 1);
  return r.interval === "year" ? a / 12 : r.interval === "week" ? a * 52 / 12 : r.interval === "day" ? a * 365 / 12 : a; };
export function subsMetrics(subs, today) {
  const month = today.slice(0, 7); const cps = meetingsOfMonth(month); const cp = cps.find(x => x >= today) || cps[2];
  const win = d => { const i = cps.findIndex(x => x >= d); return i < 0 ? null : cps[i]; };
  const active = subs.filter(s => s.status === "active" || s.status === "past_due");
  const mrr = Math.round(active.reduce((a, s) => a + (s.items && s.items.data || []).reduce((b, it) => b + monthly(it.price, it.quantity), 0) * (1 - ((s.discount && s.discount.coupon && s.discount.coupon.percent_off) || 0) / 100), 0));
  const byCp = (list, f) => { const o = {}; list.forEach(s => { const d = f(s); if (d && d.slice(0, 7) === month) { const c = win(d); if (c) o[c] = (o[c] || 0) + 1; } }); return o; };
  return {
    cp, latest: { stripe_mrr: mrr, stripe_active: active.length },
    sums: {
      stripe_new: byCp(subs.filter(s => s.status !== "incomplete" && s.status !== "incomplete_expired"), s => jstDate(s.start_date || s.created)),
      stripe_canceled: byCp(subs.filter(s => s.canceled_at || s.ended_at), s => jstDate(s.ended_at || s.canceled_at))
    }
  };
}
export async function stripeSync(db) {
  const key = process.env.STRIPE_KEY;
  const stateRef = db.doc("config/stripeState");
  if (!key) { console.log("Stripe：STRIPE_KEY が未登録のため取り込みません"); return; }
  const test = /^(rk|sk)_test_/.test(key);
  const [cfgSnap, pubSnap, stSnap] = await Promise.all([db.doc("config/main").get(), db.doc("config/vaultPub").get(), stateRef.get()]);
  const sc = (cfgSnap.exists && cfgSnap.data().stripe) || {};
  const pub = pubSnap.exists && pubSnap.data().pub;
  const st = stSnap.exists ? stSnap.data() : {};
  const fail = async msg => { console.log("Stripe：" + msg); if (!DRY) await stateRef.set({ lastRun: new Date().toISOString(), lastError: msg, test }, { merge: true }); };
  if (!pub) return fail("収支の暗号化がまだ設定されていません");
  if (!sc.account || !sc.payoutAccount) return fail("ボードの収支画面で「Stripeの口座」と「入金先の口座」を選んでください");
  try {
    // 1) 取引 → 収支（同じ取引は2回記録しない：記録のIDを stripe_<取引ID> にする）
    const since = st.cursor && st.mode === (test ? "test" : "live") ? st.cursor - 3600 : Math.floor(new Date((sc.since || localParts("Asia/Tokyo").date.slice(0, 8) + "01") + "T00:00:00+09:00").getTime() / 1000);
    const bts = await stripeAll("balance_transactions", { "created[gte]": since }, key);
    const recs = bts.flatMap(bt => btToRecords(bt, { account: sc.account, payoutAccount: sc.payoutAccount, test }));
    let added = 0;
    for (let i = 0; i < recs.length; i += 100) {
      const chunk = recs.slice(i, i + 100); const refs = chunk.map(r => db.doc(`ledger/stripe_${r.id}`));
      const snaps = await db.getAll(...refs); const b = db.batch(); let n = 0;
      for (let k = 0; k < chunk.length; k++) {
        if (snaps[k].exists) continue; const { id, ...plain } = chunk[k];
        if (DRY) { console.log(`- 記録予定：${plain.date} ${plain.type} ${plain.title} ${plain.amount}`); continue; }
        b.set(refs[k], { enc: await sealRecord(plain, pub), source: test ? "stripe-test" : "stripe", createdBy: "stripe", confirmed: true, hasReceipt: false, createdAt: FieldValue.serverTimestamp(), updatedBy: "stripe", updatedAt: FieldValue.serverTimestamp() }); n++;
      }
      if (n) { await b.commit(); added += n; }
    }
    const maxCreated = bts.reduce((a, b) => Math.max(a, b.created), st.mode === (test ? "test" : "live") ? (st.cursor || 0) : 0);
    // 2) 契約 → KPI（「自動入力：Stripe」を選んだ今月のKPIだけ）
    const subs = await stripeAll("subscriptions", { status: "all" }, key, 5000);
    const today = localParts("Asia/Tokyo").date; const mtr = subsMetrics(subs, today);
    const ks = await db.collection("kpis").where("month", "==", today.slice(0, 7)).get();
    let kn = 0;
    for (const d of ks.docs) {
      const k = d.data(); if (!k.auto || !String(k.auto).startsWith("stripe_")) continue;
      const args = [];
      if (k.auto in mtr.latest) args.push(new FieldPath("weekly", mtr.cp), { value: mtr.latest[k.auto], by: "stripe" });
      else for (const cp of meetingsOfMonth(today.slice(0, 7)).filter(x => x <= mtr.cp)) args.push(new FieldPath("weekly", cp), { value: (mtr.sums[k.auto] || {})[cp] || 0, by: "stripe" });
      if (!DRY && args.length) await d.ref.update(...args); kn++;
    }
    console.log(`Stripe（${test ? "テスト" : "本番"}）：取引${bts.length}件 → 収支に${added}件追加 / 契約${subs.length}件 → KPI ${kn}件を更新（MRR ${mtr.latest.stripe_mrr}・有料会員 ${mtr.latest.stripe_active}）`);
    if (!DRY) await stateRef.set({ lastRun: new Date().toISOString(), lastError: "", lastAdded: added, cursor: maxCreated || since, mode: test ? "test" : "live", test, metrics: { at: today, ...mtr.latest } }, { merge: true });
  } catch (e) {
    await fail(e.status === 401 ? "STRIPE_KEY が正しくありません" : e.status === 403 ? "キーの権限が足りません（" + e.message + "）" : e.message);
  }
}

/* ===== 議事録のまとめ（Gemini） ===== */
const GEMINI_MODELS = [process.env.GEMINI_MODEL || "gemini-2.5-flash", "gemini-flash-latest"];
const MIN_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "会議の短いタイトル（20文字以内）" },
    topics: { type: "ARRAY", items: { type: "OBJECT", properties: {
      title: { type: "STRING", description: "議題の見出し（15文字以内）" },
      body: { type: "STRING", description: "その議題で話し合った内容・出た意見・結論に至った理由（2〜5文）" } }, required: ["title", "body"] } },
    decisions: { type: "ARRAY", items: { type: "STRING" }, description: "会議で決まったこと（1行で簡潔に）" },
    todos: { type: "ARRAY", items: { type: "OBJECT", properties: {
      task: { type: "STRING", description: "やることを具体的に（〜する、の形）" },
      owner: { type: "STRING", description: "担当者の名前。会話から分からなければ空文字" },
      due: { type: "STRING", description: "期限 YYYY-MM-DD。分からなければ空文字" } }, required: ["task", "owner", "due"] } },
    pending: { type: "ARRAY", items: { type: "STRING" }, description: "結論が出ず保留・次回に持ち越しになったこと" }
  },
  required: ["title", "topics", "decisions", "todos", "pending"]
};
export function buildMinutesPrompt({ date, transcript, members }) {
  return `あなたはスタートアップ「SHIN」（海外大生・バイリンガル向けのAIアバター模擬面接サービス）の社内ミーティングの書記です。
以下はミーティング（${date}）の音声を自動で文字起こししたものです。誤変換や「えーと」「あの」などの言いよどみ、話者の区別がないことがあります。

これを読んで、運営メンバーが後から見返す議事録をJSONでまとめてください。
一覧画面では decisions・todos・pending だけを表示し、topics は「詳細」を開いたときに表示します。
- decisions：はっきり決まったことだけ。1項目1行で簡潔に、数字・日付・場所を入れる（例：「β版の公開は11/5（水）」「インタビューは5人に依頼する」）。決まっていないことは入れない
- todos：誰かがやることになった作業。task は「LPの文言を直す」のように動詞で終わる短い1行。担当者は次の運営メンバーの名前に合わせる（${members.join("、") || "名前一覧なし"}）。会話から担当が分からなければ owner は空文字。「来週の木曜まで」などの相対的な期限は ${date} を基準に YYYY-MM-DD に直す。期限が出てこなければ空文字
- pending：結論が出ず、保留や次回に持ち越しになったこと。短い1行（例：「料金プランの価格」）
- topics：議題ごとの詳しい記録。話した順に並べ、各議題で出た意見・検討した案・結論に至った理由を2〜5文で書く。雑談は入れない
- title：内容が分かる短いタイトル（例：「β版公開に向けた準備」）
- 文字起こしに書かれていないことは推測で足さない。数字・日付・固有名詞は文字起こしのまま
- 誤変換と思われる語は、文脈から明らかな場合だけ正しい語に直す
- 文体は「です・ます」をつけない簡潔な書き方（例：「β版は11/5に公開する」）

--- 文字起こし ---
${transcript}`;
}
export function normalizeSummary(r) {
  const arr = a => (Array.isArray(a) ? a : []).map(x => String(x || "").trim()).filter(Boolean).slice(0, 30);
  const due = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "").trim()) ? String(d).trim() : "");
  return {
    title: String(r.title || "").trim().slice(0, 40),
    summary: { topics: (Array.isArray(r.topics) ? r.topics : []).filter(t => t && String(t.body || "").trim()).slice(0, 15).map(t => ({ title: String(t.title || "").trim().slice(0, 30), body: String(t.body).trim() })), decisions: arr(r.decisions), pending: arr(r.pending) },
    todos: (Array.isArray(r.todos) ? r.todos : []).filter(t => t && String(t.task || "").trim()).slice(0, 30)
      .map(t => ({ task: String(t.task).trim(), owner: String(t.owner || "").trim(), due: due(t.due) }))
  };
}
async function callGemini(prompt, key) {
  let lastErr;
  for (const model of [...new Set(GEMINI_MODELS)]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: MIN_SCHEMA } })
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || "").join("") || "";
      if (!text) throw Object.assign(new Error("AIから空の返事が返ってきました（内容がブロックされた可能性があります）"), { permanent: true });
      return { data: JSON.parse(text), model };
    }
    const msg = (j.error && j.error.message) || res.statusText;
    lastErr = Object.assign(new Error(`Gemini ${res.status}: ${msg}`), { status: res.status });
    if (res.status === 404) continue;          // モデル名が古い → 次の候補で試す
    if (res.status === 400 || res.status === 403) lastErr.permanent = true;
    break;
  }
  throw lastErr;
}
async function summarizeMinutes(db, fcm) {
  const key = process.env.GEMINI_API_KEY;
  const snap = await db.collection("minutes").where("status", "in", ["pending", "processing"]).get();
  const now = Date.now();
  const due = snap.docs.filter(d => d.data().status === "pending" || (Date.parse(d.data().startedAt || "") || 0) < now - 15 * 60 * 1000);
  if (!due.length) { console.log("議事録：まとめ待ちなし"); return; }
  if (!key) { console.log(`議事録：${due.length}件まとめ待ち（GitHubのSecretsに GEMINI_API_KEY が未登録のため、まとめられません）`); return; }
  const ms = await db.collection("members").where("status", "==", "active").get();
  const names = ms.docs.map(d => d.data().name).filter(Boolean);
  for (const d of due.slice(0, 3)) {
    const m = d.data();
    if (DRY) { console.log(`議事録：${m.date} を要約予定（${(m.transcript || "").length}文字）`); continue; }
    await d.ref.update({ status: "processing", startedAt: new Date().toISOString() });
    try {
      const { data, model } = await callGemini(buildMinutesPrompt({ date: m.date || jstNow().date, transcript: m.transcript || "", members: names }), key);
      const r = normalizeSummary(data);
      await d.ref.update({ status: "done", error: "", title: m.title || r.title, summary: r.summary, todos: r.todos, model, summarizedAt: new Date().toISOString(), tries: 0 });
      console.log(`議事録：${m.date} をまとめました（${model}・やること${r.todos.length}件）`);
      const who = ms.docs.find(x => x.id === m.createdBy);
      if (who && prefsOf(who.data()).minutes) await sendTo(db, fcm, who.id, who.data().name || who.id, "議事録をまとめました", `${m.date ? Number(m.date.slice(5, 7)) + "/" + Number(m.date.slice(8, 10)) + " " : ""}${m.title || r.title}\n決定事項${r.summary.decisions.length}件・やること${r.todos.length}件`, "minutes-" + d.id);
    } catch (e) {
      const tries = (m.tries || 0) + 1;
      const retry = !e.permanent && tries < 4;   // 混雑（429など）は次の回でやり直す
      console.log(`議事録：${m.date} 失敗（${tries}回目）${e.message}`);
      await d.ref.update(retry ? { status: "pending", tries, error: "" } : { status: "error", tries, error: friendlyGeminiError(e) });
    }
  }
}
export function friendlyGeminiError(e) {
  const s = e.status;
  if (s === 400 && /API key/i.test(e.message)) return "GeminiのAPIキーが正しくありません。管理者に連絡してください";
  if (s === 403) return "GeminiのAPIキーが使えない状態です。管理者に連絡してください";
  if (s === 429) return "AIの無料枠の上限に達しました。しばらくしてからもう一度まとめてください";
  if (s === 400) return "文字起こしが長すぎるか、読み取れない内容でした";
  return String(e.message || "不明なエラー").slice(0, 200);
}

async function main() {
  if (!process.env.SITE_URL) throw new Error("SITE_URL が設定されていません（notify.yml）");
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (!sa.project_id) throw new Error("FIREBASE_SERVICE_ACCOUNT が設定されていません");
  initializeApp({ credential: cert(sa) });
  const db = getFirestore(), fcm = getMessaging();
  if (TEST) {
    const ms = await db.collection("members").where("email", "==", ADMIN_EMAIL).get();
    if (ms.empty) throw new Error("管理者のメンバー情報が見つかりません（ADMIN_EMAIL を確認）");
    const toks = await ms.docs[0].ref.collection("tokens").get();
    if (toks.empty) { console.log("管理者の端末が通知に登録されていません。サイト右上のベルから登録してください。"); return; }
    const res = await fcm.sendEachForMulticast({ tokens: toks.docs.map(d => d.data().token), notification: { title: "通知のテスト", body: "SHIN 運営ボードからの通知が届いています。" }, webpush: { fcmOptions: { link: SITE_URL }, notification: { icon: SITE_URL + "icon-192.png" } } });
    console.log(`テスト送信：成功${res.successCount} 失敗${res.failureCount}`);
    res.responses.forEach((r, i) => r.error && console.log(" -", r.error.code));
    return;
  }
  const cfgRef = db.doc("config/main"), stateRef = db.doc("config/notifyState");
  const [cfgSnap, stateSnap] = await Promise.all([cfgRef.get(), stateRef.get()]);
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const sent = (stateSnap.exists && stateSnap.data().morning) || {};
  const now = new Date(), jst = localParts("Asia/Tokyo", now);
  const ms = await db.collection("members").where("status", "==", "active").get();
  const members = ms.docs.map(d => ({ id: d.id, ...d.data(), name: d.data().name || d.data().email || d.id }));
  console.log(`JST ${jst.date} ${jst.time} / 朝の通知（全体）${cfg.notifyEnabled !== false ? "有効" : "停止中"} / メンバー${members.length}人`);
  // 時差を考えて、日本時間の前日〜翌日の業務を読む
  const tasksSnap = await db.collection("tasks").where("date", ">=", addDaysStr(jst.date, -1)).where("date", "<=", addDaysStr(jst.date, 1)).get();
  const tasks = tasksSnap.docs.map(d => d.data());
  for (const m of members) {
    const pref = prefsOf(m, cfg);
    if (!shouldSendMorning({ pref, now, lastDate: sent[m.id], force: FORCE, enabled: cfg.notifyEnabled })) continue;
    const today = localParts(pref.tz, now).date;
    // 二重送信を防ぐため、先に「この人には今日送った」を記録する（手動の今すぐ送信では記録しない）
    if (!FORCE && !DRY) await stateRef.set({ morning: { [m.id]: today } }, { merge: true });
    const msg = buildMorning(tasks, m.id, pref, now);
    if (!msg) { console.log(`- ${m.name}: 今日の担当業務なし（${pref.tz} ${today}）`); continue; }
    await sendTo(db, fcm, m.id, m.name, msg.title, msg.body, "morning");
  }
  await issueNotify(db, fcm, cfg, members);
  await stripeSync(db).catch(e => console.log("Stripe：" + e.message));
  await summarizeMinutes(db, fcm);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
