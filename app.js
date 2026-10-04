"use strict";
const SUPABASE_URL = "https://letstuovdrfxihrtrwdy.supabase.co";
const SUPABASE_KEY = "sb_publishable_hY_4KuyHayNUk5vdu_kbrQ_jJXmeD6M";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let serverOffset = 0;
const now = () => Date.now() + serverOffset;
let S = { tz:"Asia/Dubai", grace_min:5, early_min:10, early_max:15, checkin_open_min:15, late_hard_min:30, late_black_min:120, early_leave_min:5, break_edge_min:30, review_threshold:3, early_per_clear:3, late_allowance:2, max_clears:2, break_short_min:15, break_short_count:2, break_long_min:30, break_long_count:1, break_wc_min:5, break_wc_count:2, min_available:1, break_alert_after_min:15, workdays:[1,2,3,4,5], holidays:[], default_shift:"s08", radius_m:500 };
const fmts = {};
function parts(ms){
  let f = fmts[S.tz];
  if(!f) f = fmts[S.tz] = new Intl.DateTimeFormat("en-GB",{timeZone:S.tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const o = {}; for(const p of f.formatToParts(ms)) o[p.type] = p.value;
  return { y:o.year, m:o.month, d:o.day, h:(+o.hour)%24, mi:+o.minute, s:+o.second };
}
const dkey = ms => { const p = parts(ms); return `${p.y}-${p.m}-${p.d}`; };
const mins = ms => { const p = parts(ms); return p.h*60 + p.mi; };
const hm = m => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(Math.round(m%60)).padStart(2,"0")}`;
const ts = v => v ? Date.parse(v) : null;
const tstr = v => v ? hm(mins(ts(v))) : "";
const pHM = s => { const [a,b] = String(s||"0:0").split(":").map(Number); return (a||0)*60 + (b||0); };
const short = t => String(t||"").slice(0,5);
const wdOf = k => new Date(k+"T12:00:00Z").getUTCDay();
const ymOf = k => k.slice(0,7);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function monthKeys(ym){ const [y,m] = ym.split("-").map(Number); const n = new Date(Date.UTC(y,m,0)).getUTCDate(); return Array.from({length:n},(_,i)=>`${ym}-${String(i+1).padStart(2,"0")}`); }
const monthEnd = ym => monthKeys(ym).pop();
const prettyDate = k => new Date(k+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"});
const longDate = k => new Date(k+"T12:00:00Z").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"});
const monthLabel = ym => new Date(ym+"-15T12:00:00Z").toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"});
function lastMonths(n){ const out=[]; let [y,m] = ymOf(dkey(now())).split("-").map(Number); for(let i=0;i<n;i++){ out.push(`${y}-${String(m).padStart(2,"0")}`); m--; if(!m){m=12;y--;} } return out; }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),3200); }
const errMsg = e => (e && (e.message || e.error_description)) || "Something went wrong. Try again.";
function getPos(){ return new Promise((res,rej)=>{ if(!navigator.geolocation) return rej(new Error("Location is not available on this device.")); navigator.geolocation.getCurrentPosition(res,()=>rej(new Error("Location access was blocked. Allow it in your browser settings and try again.")),{enableHighAccuracy:true,timeout:15000,maximumAge:0}); }); }

/* ---------- data ---------- */
let me = null;                 // employees row for this user
let shifts = {};               // id -> {start,end}
let emps = [];                 // admin: all employees
const mine = { att:{}, sched:{}, adj:[] , ym:null };
const team = { ym:null, att:{}, sched:{}, adj:[], alerts:{}, loading:false };
const shiftLabel = id => shifts[id] ? `${shifts[id].start} to ${shifts[id].end}` : "No shift";

function isWorkday(k){ return (S.workdays||[]).includes(wdOf(k)) && !(S.holidays||[]).includes(k); }
function shiftFor(emp, k, schedMap){
  const row = schedMap[`${emp.id}|${k}`];
  const mode = schedMap[`M|${emp.id}|${k}`] || emp.default_mode || "office";
  const base = shifts[emp.shift_id] || shifts[S.default_shift] || Object.values(shifts)[0] || {start:"08:00",end:"17:00"};
  if(row !== undefined){
    if(row === null) return { off:true, sh:base, planned:true, mode };
    if(shifts[row]) return { off:false, sh:shifts[row], planned:true, mode };
  }
  return { off:!isWorkday(k), sh:base, planned:false, mode };
}
function leftEarlyBy(emp, k, rec, schedMap){
  if(!rec || !rec.check_out || rec.auto_out) return 0;
  const end = pHM(shiftFor(emp, k, schedMap).sh.end), out = mins(ts(rec.check_out));
  return end - out > S.early_leave_min ? end - out : 0;
}
function dayStatus(emp, k, rec, schedMap){
  const today = dkey(now());
  if(k > today) return { s:"future" };
  if(emp.since && k < emp.since) return { s:"na" };
  const { off, sh } = shiftFor(emp, k, schedMap), start = pHM(sh.start), end = pHM(sh.end);
  const ex = schedMap[`X|${emp.id}|${k}`];
  if(ex !== undefined) return { s:"excused", reason: ex };
  if(off) return { s:"off" };
  if(!rec){
    if(k < today || mins(now()) >= end) return { s:"absent" };
    return { s:"pending" };
  }
  const m = mins(ts(rec.check_in));
  if(rec.mode === "remote"){
    if(m <= start + S.grace_min) return { s:"remote" };
    return { s:"remotelate", by: m - start };
  }
  if(m < start - S.early_min) return m >= start - S.early_max ? { s:"early", ahead: start - m } : { s:"ontime" };
  if(m <= start + S.grace_min) return { s:"ontime" };
  return { s:"late", by: m - start };
}
function summarize(emp, ym, att, schedMap, adj){
  const today = dkey(now());
  const c = { early:0, ontime:0, late:0, allowed:0, absent:0, office:0, remote:0, red:0, black:0, rows:[] };
  for(const k of monthKeys(ym)){
    if(k > today) break;
    const st = dayStatus(emp, k, att[`${emp.id}|${k}`], schedMap);
    if(st.s==="na") continue;
    if(st.s==="late" || st.s==="remotelate"){
      c.late++;
      if(st.by > S.late_black_min){ st.severe = "black"; c.black++; }
      else if(st.by > S.late_hard_min){ st.severe = "red"; c.red++; }
      else { c.soft = (c.soft||0) + 1; if(c.soft <= S.late_allowance){ st.allowed = c.soft; c.allowed++; } else c.red++; }
      if(st.s==="late") c.office++; else c.remote++;
    }
    else if(st.s==="early"){ c.early++; c.office++; }
    else if(st.s==="ontime"){ c.ontime++; c.office++; }
    else if(st.s==="remote") c.remote++;
    else if(st.s==="absent"){ c.absent++; c.black++; }
    else if(st.s==="excused") c.excused = (c.excused||0) + 1;
    const le = leftEarlyBy(emp, k, att[`${emp.id}|${k}`], schedMap);
    if(le){ st.leftEarly = le; c.leftEarly = (c.leftEarly||0) + 1; }
    c.rows.push({ k, ...st });
  }
  for(const a of adj) if(a.employee_id===emp.id && a.month===ym){ if(a.type==="red") c.red += a.delta; else if(a.type==="black") c.black += a.delta; }
  c.red = Math.max(0, c.red); c.black = Math.max(0, c.black);
  const per = Math.max(1, S.early_per_clear||3), cap = Math.max(0, S.max_clears ?? 2);
  c.cleared = Math.min(c.red, Math.floor(c.early / per), cap);
  c.red -= c.cleared;
  c.clearsLeft = cap - c.cleared;
  c.toNext = c.red > 0 && c.clearsLeft > 0 ? per - (c.early - c.cleared*per) : 0;
  c.lateLeft = Math.max(0, S.late_allowance - (c.soft||0));
  c.penalties = c.red + c.black;
  return c;
}
const dayFrom = (sum, k, fallback) => sum.rows.find(r => r.k === k) || fallback;
const STREAK_GOAL = 10;
function streakFor(emp, att, sm){
  const today = dkey(now()); let n = 0, t = Date.parse(today+"T12:00:00Z");
  for(let i = 0; i < 75; i++, t -= 864e5){
    const k = new Date(t).toISOString().slice(0,10);
    if(emp.since && k < emp.since) break;
    if(sm[`X|${emp.id}|${k}`] !== undefined) continue;
    const sf = shiftFor(emp, k, sm); if(sf.off) continue;
    const rec = att[`${emp.id}|${k}`];
    if(!rec){ if(k === today) continue; break; }
    if(mins(ts(rec.check_in)) <= pHM(sf.sh.start)) n++; else break;
  }
  return n;
}
function streakPanel(n){
  const goal = STREAK_GOAL, done = n >= goal, pct = Math.min(100, Math.round(n / goal * 100));
  return `<section class="panel streak ${done?"done":""}">
    <div class="sk-row"><div><div class="small muted">On-time streak</div><div class="sk-n">${n}<small> working day${n===1?"":"s"}</small></div></div>
    <div class="sk-badge">${done ? `2-week streak${n >= goal*2 ? ` × ${Math.floor(n/goal)}` : ""}` : `${goal - n} to go`}</div></div>
    <div class="sk-bar"><i style="width:${pct}%"></i></div>
    <p class="hint">Two full weeks (${goal} working days) in a row with no late minute, office or remote. Days off and excused days do not break it.</p>
  </section>`;
}
const fmtMin = m => m >= 60 ? `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m` : `${m} min`;
function chip(st){
  const map = {
    early:[`Early ${st.ahead||""} min, +1 credit`,"early"], ontime:["On time","ontime"],
    late: st.severe==="black" ? [`Late ${fmtMin(st.by)}, +1 black`,"absent"] : st.allowed ? [`Late ${st.by} min, allowed (${st.allowed} of ${S.late_allowance})`,"pending"] : [`Late ${fmtMin(st.by)}, +1 red${st.severe?` (over ${S.late_hard_min} min)`:""}`,"late"], absent:["Absent, +1 black","absent"],
    remote:["Remote, on time","remote"], remotelate: st.severe==="black" ? [`Remote, late ${fmtMin(st.by)}, +1 black`,"absent"] : st.allowed ? [`Remote, late ${st.by} min, allowed (${st.allowed} of ${S.late_allowance})`,"pending"] : [`Remote, late ${fmtMin(st.by)}, +1 red${st.severe?` (over ${S.late_hard_min} min)`:""}`,"late"],
    off:["Day off","off"], pending:["Not checked in","pending"], excused:[st.reason ? `Excused: ${st.reason}` : "Excused","remote"], na:["Not started","na"], future:["",""]
  };
  const [t,c] = map[st.s] || [st.s,"na"];
  return t ? `<span class="chip c-${c}">${esc(t)}</span>` : "";
}

async function loadBase(){
  const [st, sh, em] = await Promise.all([
    sb.from("settings").select("*").eq("id",1).maybeSingle(),
    sb.from("shifts").select("*").order("start_time"),
    sb.from("employees").select("*").order("name")
  ]);
  if(st.error) throw st.error; if(sh.error) throw sh.error; if(em.error) throw em.error;
  if(st.data) S = { ...S, ...st.data };
  shifts = {}; for(const r of sh.data) shifts[r.id] = { start:short(r.start_time), end:short(r.end_time) };
  const email = (await sb.auth.getUser()).data.user?.email?.toLowerCase();
  me = em.data.find(e => (e.email||"").toLowerCase() === email && e.active) || null;
  emps = em.data;
}
const toMap = (rows, val) => { const o = {}; for(const r of rows) o[`${r.employee_id}|${r.day}`] = val(r); return o; };
const histStart = ym => new Date(Date.parse(ym+"-01T12:00:00Z") - 45*864e5).toISOString().slice(0,10);
async function loadMine(ym){
  if(!me) return;
  const a = histStart(ym), b = monthEnd(ym);
  const [att, sc, ex, adj] = await Promise.all([
    sb.from("attendance").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("schedule").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("excused").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("adjustments").select("*").eq("employee_id",me.id).eq("month",ym),
    sb.from("overtime").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b)
  ]).then(r => { mine.ot = r[4].data || []; return r; });
  mine.ym = ym;
  mine.att = toMap(att.data||[], r=>r);
  mine.sched = toMap(sc.data||[], r=>r.shift_id);
  for(const r of sc.data||[]) if(r.work_mode) mine.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex.data||[]) mine.sched[`X|${r.employee_id}|${r.day}`] = r.reason || "";
  mine.adj = adj.data||[];
  if(typeof paintSideShift==="function") paintSideShift();
}
async function loadTeam(ym){
  team.loading = true; update();
  const a = histStart(ym), b = monthEnd(ym);
  const [att, sc, ex, adj] = await Promise.all([
    sb.from("attendance").select("*").gte("day",a).lte("day",b),
    sb.from("schedule").select("*").gte("day",a).lte("day",b),
    sb.from("excused").select("*").gte("day",a).lte("day",b),
    sb.from("adjustments").select("*").eq("month",ym).order("created_at",{ascending:false}),
    sb.from("overtime").select("*").gte("day",`${ym}-01`).lte("day",b).order("id",{ascending:false})
  ]).then(r => { team.ot = r[4].data || []; return r; });
  team.ym = ym;
  team.att = toMap(att.data||[], r=>r);
  team.sched = toMap(sc.data||[], r=>r.shift_id);
  for(const r of sc.data||[]) if(r.work_mode) team.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex.data||[]) team.sched[`X|${r.employee_id}|${r.day}`] = r.reason || "";
  team.adj = adj.data||[];
  team.loading = false; update();
}
const tracked = () => emps.filter(e => e.active && e.tracked);

/* ---------- shell ---------- */
let tab = null;
const views = {};
const ICONS = {
  checkin:'<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>',
  breaks:'<path d="M5 10h11v4a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 4v3M12 4v3"/>',
  live:'<circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M13.5 18c.4-2 1.6-3 3-3s2.6 1 3 3"/>',
  mine:'<path d="M5 19V11M10 19V6M15 19v-5M20 19V9"/>',
  myschedule:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  team:'<path d="M4 6h16M4 12h16M4 18h10"/>',
  points:'<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.5L12 16.2 7 19l1.2-5.5L4 9.6 9.6 9z"/>',
  schedule:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 14h3M13 14h3M8 17h3"/>',
  people:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  audit:'<path d="M12 8v4l2.5 1.5"/><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/>',
  issue:'<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'
};
function tabsFor(){
  const t = [];
  if(me?.tracked) t.push(["head","My work"],["checkin","Check in"],["breaks","Status"],["live","Live board"],["mine","My points"],["myschedule","My schedule"]);
  if(me?.is_admin){ t.push(["head","Manage"]); if(!me.tracked) t.push(["live","Live board"]); t.push(["team","Attendance today"],["points","Points report"],["schedule","Schedule"],["people","Employees"],["audit","Activity log"],["settings","Settings"]); }
  if(me) t.push(["head","Help"],["issue","Report an issue"]);
  return t;
}
function renderTabs(){
  const t = tabsFor();
  if(!tab || !t.some(x=>x[0]===tab)) tab = t.find(x=>x[0]!=="head")?.[0];
  $("#tabs").innerHTML = t.map(([k,l]) => k==="head" ? `<div class="side-head">${l}</div>` :
    `<button role="tab" aria-selected="${tab===k}" data-t="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]||""}</svg><span>${l}</span></button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(x => x.onclick = () => setTab(x.dataset.t));
}
const PAGES = {
  checkin:["Check in","Your shift today and this month so far."], breaks:["Status","Breaks, meetings and tasks. Someone always stays available."],
  live:["Live board","Who is available right now."], mine:["My points","Your points, history and streak."], myschedule:["My schedule","Your shifts and where you work."],
  team:["Attendance today","Check-ins, early leaves and overtime requests."], points:["Points report","Monthly points per agent."], schedule:["Schedule","Shifts, work location and excused days."],
  people:["Employees","Team list, roles and defaults."], audit:["Activity log","Every change, with who made it and when."], settings:["Settings","Rules, breaks and the office location."], issue:["Report an issue","Something not working? Tell the developer."] };
function setTab(t){ tab = t; renderTabs(); paintSideShift(); const p = PAGES[t] || ["",""]; $("#pgTitle").textContent = p[0]; $("#pgSub").textContent = p[1]; views[tab].mount($("#main")); window.scrollTo(0,0); }
function update(){ const v = views[tab]; if(v && v.update) v.update(); }

/* ---------- live board & breaks ---------- */
let live = [], liveLoaded = false;
const fmtClock = sec => { const a = Math.abs(Math.round(sec)); return `${Math.floor(a/60)}m ${String(a%60).padStart(2,"0")}s`; };
function liveState(r){
  if(!r.check_in) return r.is_off ? { s:"off" } : { s:"notin" };
  if(r.check_out) return { s:"done" };
  if(r.break_kind === "meeting" || r.break_kind === "task") return { s:"busy", el:(now() - Date.parse(r.break_started)) / 1000 };
  if(r.break_kind){
    const el = (now() - Date.parse(r.break_started)) / 1000, allowed = (r.break_allowed||15) * 60;
    const over = el > allowed, alert = el > allowed + S.break_alert_after_min*60;
    return { s: over ? "over" : "break", el, allowed, alert };
  }
  return { s:"available" };
}
async function refreshLive(){
  if(!me) return;
  const { data, error } = await sb.rpc("team_status");
  if(error) return;
  live = data || []; liveLoaded = true;
  if(["live","checkin","breaks"].includes(tab)) update();
  paintAlerts();
}
function breaksLeft(r){ return { short: Math.max(0, S.break_short_count - (r?.short_used||0)), long: Math.max(0, S.break_long_count - (r?.long_used||0)), wc: Math.max(0, S.break_wc_count - (r?.wc_used||0)) }; }
const KIND_NAME = { meeting:"Meeting", task:"Task / Out of Q", wc:"WC break" };
const breakName = r => KIND_NAME[r.break_kind] || `${r.break_allowed}-min break`;
function breaksLeftHtml(left){
  const pill = (label, n, total) => `<span class="bl-pill ${n?"":"none"}" title="${label}: ${n} of ${total} left"><b>${label}</b><span class="bl-dots">${Array.from({length:total},(_,i)=>`<i class="${i < n ? "on" : ""}"></i>`).join("")}</span></span>`;
  return `<div class="bl"><span class="bl-h">Breaks left</span>${pill(`${S.break_short_min}m`, left.short, S.break_short_count)}${pill(`${S.break_long_min}m`, left.long, S.break_long_count)}${pill("WC", left.wc, S.break_wc_count)}</div>`;
}
const isAway = s => ["break","over","busy"].includes(s);
function paintAlerts(){
  const bar = $("#alertbar"); if(!bar) return;
  const msgs = [];
  const mineRow = live.find(r => r.employee_id === me?.id);
  if(mineRow){ const st = liveState(mineRow); if(st.s==="over") msgs.push(`You are ${Math.floor((st.el-st.allowed)/60)} min over your break. End it from the Status tab.`); }
  if(me?.is_admin) for(const r of live){ if(r.employee_id===me.id) continue; const st = liveState(r); if(st.alert) msgs.push(`${r.name} is ${Math.floor((st.el-st.allowed)/60)} min over break.`); }
  bar.hidden = !msgs.length; bar.innerHTML = msgs.map(m=>`<div>${esc(m)}</div>`).join("");
  document.title = msgs.length ? "Over break | Opus Support Attendance" : "Opus Support Attendance | Applied AI";
}
function fmtLong(sec){ const m = Math.floor(sec/60); return m >= 60 ? `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m` : fmtClock(sec); }
function tickBreaks(){
  document.querySelectorAll("[data-bup]").forEach(el => { el.textContent = fmtLong((now() - Number(el.dataset.bup)) / 1000); });
  document.querySelectorAll("[data-bstart]").forEach(el => {
    const el2 = (now() - Number(el.dataset.bstart)) / 1000, allowed = Number(el.dataset.ballow) * 60;
    const over = el2 > allowed;
    el.textContent = over ? `${fmtClock(el2-allowed)} over` : `${fmtClock(allowed-el2)} left`;
    el.closest("[data-bwrap]")?.classList.toggle("is-over", over);
  });
  paintAlerts();
}
const STATUS = { available:["Available","available"], break:["On break","break"], over:["Over break","over"], busy:["Busy","busy"], notin:["Not checked in","notin"], done:["Checked out","done"], off:["Day off","off"] };
const timerSpan = r => (r.break_kind==="meeting"||r.break_kind==="task") ? `<span data-bup="${Date.parse(r.break_started)}"></span>` : `<span data-bstart="${Date.parse(r.break_started)}" data-ballow="${r.break_allowed}"></span>`;
views.live = {
  mount(el){ this.el = el; el.innerHTML = `<div id="lvBody"><p class="muted">Loading</p></div>`; refreshLive(); this.update(); },
  update(){
    if(tab!=="live" || !liveLoaded) return;
    const rows = live.map(r => ({ r, st: liveState(r) }));
    const n = s => rows.filter(x=>x.st.s===s).length;
    const order = { over:0, break:1, busy:2, available:3, notin:4, done:5, off:6 };
    rows.sort((a,b)=>order[a.st.s]-order[b.st.s] || a.r.name.localeCompare(b.r.name));
    $("#lvBody").innerHTML = `
      <div class="panel"><div class="tally">
        <div class="t-g"><div class="n">${n("available")}</div><div class="l">Available</div></div>
        <div class="t-a"><div class="n">${n("break")}</div><div class="l muted">On break</div></div>
        <div class="t-a"><div class="n">${n("busy")}</div><div class="l muted">Meeting or task</div></div>
        <div class="t-r"><div class="n">${n("over")}</div><div class="l">Over break</div></div>
        <div class="t-b"><div class="n">${n("notin")}</div><div class="l">Not checked in</div></div>
      </div><p class="hint">Updates on its own every 15 seconds. At least ${S.min_available} teammate(s) must stay available, so a break can only start when someone else is free.</p></div>
      <div class="board">${rows.map(({r,st}) => { const [t0,c] = STATUS[st.s]; const t = st.s==="busy" ? breakName(r) : t0; const left = breaksLeft(r);
        return `<div class="pcard st-${c}" ${st.s==="break"||st.s==="over" ? "data-bwrap" : ""}>
          <div class="pc-top"><span class="avn">${avatar(r.name)}<b>${esc(r.name)}${r.employee_id===me.id?" <span class='muted small'>(you)</span>":""}</b></span><span class="pill p-${c}">${t}</span></div>
          <div class="small muted">${r.is_off && !r.check_in ? "No shift today" : `Shift ${short(r.shift_start)} to ${short(r.shift_end)}`}${me.is_admin && r.check_in && !r.check_out ? `, ${r.mode==="remote"?"remote":"office"} since ${tstr(r.check_in)}` : ""}</div>
          ${st.s==="break"||st.s==="over" ? `<div class="pc-timer">${breakName(r)}, ${timerSpan(r)}</div>` : ""}
          ${st.s==="busy" ? `<div class="pc-timer">${breakName(r)} for ${timerSpan(r)}</div>` : ""}
          ${me.is_admin && r.check_out && !r.auto_out && (pHM(short(r.shift_end)) - mins(ts(r.check_out))) > S.early_leave_min ? `<div class="flag-red">Left early, ${fmtMin(pHM(short(r.shift_end)) - mins(ts(r.check_out)))} before ${short(r.shift_end)}</div>` : ""}
          ${r.check_in && !r.check_out ? breaksLeftHtml(left) : ""}
        </div>`; }).join("")}</div>`;
    tickBreaks();
  }
};
function breakPanel(rec, mode){
  if(!rec || rec.check_out || rec.mode !== mode) return "";
  if(!liveLoaded) return `<section class="panel"><h2>Status</h2><p class="muted">Loading</p></section>`;
  const mineRow = live.find(r => r.employee_id === me.id);
  const st = mineRow ? liveState(mineRow) : { s:"available" };
  if(st.s==="busy"){
    return `<section class="panel brk"><div class="punch"><div><div class="small muted">${breakName(mineRow)} since ${tstr(mineRow.break_started)}</div>
      <div class="brk-time" data-bup="${Date.parse(mineRow.break_started)}"></div></div>
      <button class="btn primary big" id="bEnd">Back to available</button></div></section>`;
  }
  if(st.s==="break" || st.s==="over"){
    return `<section class="panel brk" data-bwrap><div class="punch"><div><div class="small muted">On a ${breakName(mineRow)} since ${tstr(mineRow.break_started)}</div>
      <div class="brk-time" data-bstart="${Date.parse(mineRow.break_started)}" data-ballow="${mineRow.break_allowed}"></div></div>
      <button class="btn primary big" id="bEnd">Back to available</button></div></section>`;
  }
  const left = breaksLeft(mineRow);
  const others = live.filter(r => r.employee_id !== me.id && liveState(r).s === "available").length;
  const blocked = others < S.min_available;
  const away = live.filter(r => r.employee_id !== me.id && isAway(liveState(r).s)).map(r => { const x = liveState(r); return `${r.name} (${x.s==="busy" ? breakName(r).toLowerCase() : x.s==="over" ? "over" : Math.ceil((x.allowed-x.el)/60)+" min left"})`; });
  const sfx = shiftFor(me, dkey(now()), mine.sched), sStart = pHM(sfx.sh.start), sEnd = pHM(sfx.sh.end), nm = mins(now());
  const edge = nm < sStart + S.break_edge_min || nm > sEnd - S.break_edge_min;
  const card = (id, title, mins, n, total) => `<button class="bcard" id="${id}" ${!n||blocked||edge?"disabled":""}><span class="bc-min">${mins}<small>min</small></span><span class="bc-t">${title}</span><span class="bc-left">${n} of ${total} left</span></button>`;
  const wcard = (id, title, note) => `<button class="bcard work" id="${id}" ${blocked?"disabled":""}><span class="bc-ico">${id==="bMeet" ? '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12l2 2 4-4"/></svg>'}</span><span class="bc-t">${title}</span><span class="bc-left">${note}</span></button>`;
  return `<section class="panel"><h2>Breaks</h2>
    <div class="bcards">
      ${card("bShort","Short break",S.break_short_min,left.short,S.break_short_count)}
      ${card("bLong","Long break",S.break_long_min,left.long,S.break_long_count)}
      ${card("bWc","WC",S.break_wc_min,left.wc,S.break_wc_count)}
    </div>
    <p class="hint">${edge ? `Breaks are open from ${hm(sStart+S.break_edge_min)} to ${hm(sEnd-S.break_edge_min)}. No breaks in the first or last ${S.break_edge_min} minutes of your shift.` : blocked ? `Wait until a teammate is free. At least ${S.min_available} must stay available.${away.length ? " Away now: "+esc(away.join(", "))+"." : ""}` : `Take them in any order between ${hm(sStart+S.break_edge_min)} and ${hm(sEnd-S.break_edge_min)}. ${others} teammate(s) available now.`}</p>
  </section>
  <section class="panel"><h2>Work away from the queue</h2>
    <div class="bcards two">
      ${wcard("bMeet","Meeting","No time limit. Timer counts up.")}
      ${wcard("bTask","Task / Out of Q","No time limit. Timer counts up.")}
    </div>
    <p class="hint">${blocked ? "Wait until a teammate is free. Someone must stay available for meetings and tasks too." : "These do not use your breaks and have no time limit. At least one teammate must stay available. Switch back to available when you are done."}</p>
  </section>`;
}
async function breakAction(fn, args, btn){
  btn.disabled = true;
  const { error } = await sb.rpc(fn, args);
  if(error){ toast(errMsg(error)); btn.disabled = false; return; }
  const k = args.p_kind;
  toast(fn==="start_break" ? (k==="meeting" ? "Status: Meeting" : k==="task" ? "Status: Task / Out of Q" : "Break started") : "You are available"); await refreshLive();
}
/* ---------- check-in ---------- */
function avatar(name){ const n = String(name||"?"); let h = 0; for(const c of n) h = (h*31 + c.charCodeAt(0)) % 360;
  const ini = n.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  return `<span class="av" style="--h:${h}">${esc(ini)}</span>`; }
const avatarName = n => `<span class="avn">${avatar(n)}<span>${esc(n)}</span></span>`;
const modeChip = m => `<span class="mode-chip ${m}">${m==="remote" ? '<svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/></svg>Remote' : '<svg viewBox="0 0 24 24"><path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-5h6v5"/></svg>Office'}</span>`;
views.checkin = {
  mount(el){ this.el = el; this.update(); },
  update(){
    if(tab!=="checkin" || !me) return;
    const t = now(), k = dkey(t), nowM = mins(t);
    if(mine.ym !== ymOf(k)){ loadMine(ymOf(k)).then(()=>this.update()); }
    const sf = shiftFor(me, k, mine.sched), sh = sf.sh, start = pHM(sh.start), end = pHM(sh.end);
    const rec = mine.att[`${me.id}|${k}`];
    const sum = summarize(me, ymOf(k), mine.att, mine.sched, mine.adj);
    const st = dayFrom(sum, k, dayStatus(me, k, rec, mine.sched));
    const opens = start - S.checkin_open_min;
    const ot = (mine.ot||[]).filter(o => o.day === k).sort((a,b)=>b.id-a.id)[0];
    let state, buttons = "";
    if(st.s==="excused" && !rec){ state = `<b>Excused today.</b> ${st.reason?`<span class="muted">${esc(st.reason)}</span>`:""}`; }
    else if(sf.off && !rec){ state = `<b>Day off.</b> <span class="muted">No shift scheduled today.</span>`; }
    else if(!rec){
      if(nowM < opens){ state = `<b>Check-in opens at ${hm(opens)}.</b> <span class="muted">${S.checkin_open_min} minutes before your shift.</span>`; buttons = `<button class="btn big" disabled>Opens at ${hm(opens)}</button>`; }
      else if(nowM >= end){ state = `<b>Your shift has ended.</b> <span class="muted">No check-in was recorded today.</span>`; }
      else { state = `<b>Not checked in.</b> <span class="muted">Shift starts ${esc(sh.start)}.${sf.mode==="office" ? ` You need to be within ${S.radius_m} m of the office.` : ""}</span>`;
        buttons = `<button class="btn primary big" id="bIn">${sf.mode==="office" ? "Check in at the office" : "Check in remotely"}</button>`; }
    } else if(!rec.check_out){
      state = `<b>Checked in at ${tstr(rec.check_in)}.</b> ${chip(st)}`;
      buttons = `<button class="btn big" id="bOut">Check out</button>`;
    } else state = `<b>Done for today.</b> <span class="muted">${tstr(rec.check_in)} to ${tstr(rec.check_out)}${rec.auto_out?" (automatic check-out)":""}</span> ${chip(st)}`;
    const lo = Math.max(0, start - 45), hi = Math.min(1440, end + (ot && ot.status!=="rejected" ? ot.minutes : 0));
    const pct = m => Math.max(0, Math.min(100, (m-lo)/(hi-lo)*100));
    const otPanel = rec && !rec.check_out ? `<section class="panel"><div class="shift-head"><h2 style="margin:0">Extend shift</h2>${ot ? `<span class="chip c-${ot.status==="approved"?"early":ot.status==="rejected"?"late":"pending"}">${ot.minutes} min, ${ot.status}</span>` : ""}</div>
      ${ot && ot.status==="pending" ? `<p class="small muted" style="margin:0">Waiting for a manager. Your automatic check-out waits until ${hm(end + ot.minutes + 1)}.</p>`
      : ot && ot.status==="approved" ? `<p class="small muted" style="margin:0">Approved by ${esc(ot.decided_by||"a manager")}. Automatic check-out moves to ${hm(end + ot.minutes + 1)}.</p>`
      : `<div class="ot-row"><select class="inl" id="otMin">${[30,60,90,120].map(m=>`<option value="${m}">${fmtMin(m)}</option>`).join("")}</select><input class="inl" id="otWhy" maxlength="120" placeholder="Reason, for example a long customer case"><button class="btn" id="otGo">Request</button></div>
         <p class="hint">Working past ${esc(sh.end)}? Ask before your shift ends. Without approval you are checked out automatically at ${hm(end+1)}.</p>`}</section>` : "";
    this.el.innerHTML = `
      <section class="hero">
        <div class="hero-l">
          <div class="date">${esc(longDate(k))}</div>
          <div class="time" id="clk">--:--:--</div>
          <div class="hero-meta">${sf.off && !rec ? "" : `Shift ${esc(sh.start)} to ${esc(sh.end)} ${modeChip(rec ? rec.mode : sf.mode)}`}</div>
          ${sf.off && !rec ? "" : `<div class="shiftcd" data-sstart="${start}" data-send="${end + (ot && ot.status==="approved" ? ot.minutes : 0)}"><div class="cd-row"><span class="cd-txt"></span><span class="cd-pct"></span></div><div class="cd-bar"><i></i></div></div>`}
        </div>
        <div class="hero-r"><div class="state">${state}</div><div class="hero-btn">${buttons}</div></div>
      </section>
      ${sf.off && !rec ? "" : `<section class="panel">
        <div class="shift-head"><span><b>Today's timeline</b></span><span class="small muted">${sf.planned ? "From this month's schedule" : "Default shift"}, UAE time</span></div>
        <div class="bar" aria-label="Shift timeline">
          ${(rec ? rec.mode : sf.mode)==="office" ? `<div class="z e" style="left:${pct(start-S.early_max)}%;width:${pct(start-S.early_min)-pct(start-S.early_max)}%"></div>` : ""}
          <div class="z l" style="left:${pct(start+S.grace_min)}%;right:0"></div>
          ${rec ? `<div class="mark" style="left:${pct(mins(ts(rec.check_in)))}%"></div>` : ""}
          <div class="needle" id="needle" style="left:${pct(nowM)}%"></div>
        </div>
        <div class="ticks"><span style="left:0">${hm(lo)}</span><span style="left:${pct(start)}%">${hm(start)}</span><span style="left:100%">${hm(hi)}</span></div>
        <div class="rules">
          <span><em style="background:var(--line)"></em>Check-in opens ${hm(opens)}</span>
          ${(rec ? rec.mode : sf.mode)==="office" ? `<span><em style="background:var(--zone-early)"></em>${hm(start-S.early_max)} to ${hm(start-S.early_min)}: early credit</span>` : ""}
          <span><em style="background:var(--zone-ok)"></em>Until ${hm(start+S.grace_min)}: on time</span>
          <span><em style="background:var(--zone-late)"></em>Late: ${S.late_allowance} allowed a month up to ${S.late_hard_min} min, over ${S.late_hard_min} min red, over ${fmtMin(S.late_black_min)} black</span>
        </div>
      </section>`}
      ${otPanel}
      <section class="panel">
        <h2>${esc(monthLabel(ymOf(k)))} so far</h2>
        <div class="tally">
          <div class="t-g"><div class="n">${sum.early}</div><div class="l">Early credits</div></div>
          <div class="t-r"><div class="n">${sum.red}</div><div class="l">Red${sum.cleared?`, ${sum.cleared} cleared`:""}</div></div>
          <div class="t-b"><div class="n">${sum.black}</div><div class="l">Black</div></div>
          <div class="t-a"><div class="n">${sum.penalties}</div><div class="l muted">Total penalties</div></div>
        </div>
        <p class="hint">${sum.lateLeft} allowed late day(s) left this month. ${sum.clearsLeft} early-credit clear(s) left this month. Everything resets on the 1st.</p>
      </section>
      ${streakPanel(streakFor(me, mine.att, mine.sched))}`;
    this.lo = lo; this.hi = hi; tick();
    const bi = $("#bIn"), bo = $("#bOut"), og = $("#otGo");
    if(bi) bi.onclick = () => punch("in", sf.mode, bi);
    if(bo) bo.onclick = () => punch("out", rec.mode, bo);
    if(og) og.onclick = async () => {
      og.disabled = true;
      const { error } = await sb.rpc("request_overtime", { p_minutes:+$("#otMin").value, p_reason:$("#otWhy").value.trim() });
      if(error){ toast(errMsg(error)); og.disabled = false; return; }
      toast("Request sent to the managers"); await loadMine(ymOf(k)); this.update();
    };
  }
};
function cdText(nowM, start, end){
  const f = m => m >= 60 ? `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m` : `${m} min`;
  if(nowM < start) return { t:`Starts in ${f(start-nowM)}`, p:0 };
  if(nowM >= end) return { t:"Shift ended", p:100 };
  return { t:`${f(end-nowM)} left`, p:Math.round((nowM-start)/(end-start)*100) };
}
function tickShift(){
  const nowM = mins(now());
  document.querySelectorAll("[data-sstart]").forEach(el => {
    const r = cdText(nowM, +el.dataset.sstart, +el.dataset.send);
    const t = el.querySelector(".cd-txt"), p = el.querySelector(".cd-pct"), b = el.querySelector(".cd-bar i");
    if(t) t.textContent = r.t; if(p) p.textContent = r.p > 0 && r.p < 100 ? `${r.p}% done` : ""; if(b) b.style.width = r.p + "%";
  });
}
function paintSideShift(){
  const el = $("#sbShift"); if(!el || !me || !me.tracked){ if(el) el.hidden = true; return; }
  const k = dkey(now()), sf = shiftFor(me, k, mine.sched);
  const rec = mine.att[`${me.id}|${k}`];
  if((sf.off && !rec) || (rec && rec.check_out)){ el.hidden = true; return; }
  const ot = (mine.ot||[]).find(o => o.day===k && o.status==="approved");
  el.hidden = false;
  el.innerHTML = `<div class="small muted">Today ${esc(sf.sh.start)} to ${esc(sf.sh.end)}</div><div class="shiftcd mini" data-sstart="${pHM(sf.sh.start)}" data-send="${pHM(sf.sh.end) + (ot ? ot.minutes : 0)}"><div class="cd-row"><span class="cd-txt"></span></div><div class="cd-bar"><i></i></div></div>`;
  tickShift();
}
function tick(){
  tickShift();
  const c = $("#clk"); if(!c) return;
  const p = parts(now());
  c.textContent = `${String(p.h).padStart(2,"0")}:${String(p.mi).padStart(2,"0")}:${String(p.s).padStart(2,"0")}`;
  const v = views[tab], n = $("#needle");
  if(n && v && v.hi) n.style.left = Math.max(0,Math.min(100,(mins(now())-v.lo)/(v.hi-v.lo)*100))+"%";
}
setInterval(() => { tick(); tickBreaks(); }, 1000);

async function punch(kind, mode, btn, onError){
  let label;
  if(btn){ btn.disabled = true; label = btn.textContent; btn.textContent = "Saving"; }
  try{
    let lat = null, lng = null;
    if(mode==="office"){ const p = await getPos(); lat = p.coords.latitude; lng = p.coords.longitude; }
    const { data, error } = kind==="in"
      ? await sb.rpc("check_in", { p_mode:mode, p_lat:lat, p_lng:lng })
      : await sb.rpc("check_out", { p_lat:lat, p_lng:lng });
    if(error) throw error;
    mine.att[`${me.id}|${data.day}`] = data; refreshLive(); paintSideShift();
    toast(kind==="in" ? `Checked in ${mode==="remote"?"remotely":"at the office"} at ${tstr(data.check_in)}` : `Checked out at ${tstr(data.check_out)}`);
    update(); return true;
  }catch(e){
    if(onError) onError(errMsg(e)); else toast(errMsg(e));
    if(btn){ btn.disabled = false; btn.textContent = label; }
    return false;
  }
}

/* ---------- breaks tab ---------- */
views.breaks = {
  mount(el){ this.el = el; this.update(); },
  update(){
    if(tab!=="breaks" || !me) return;
    const k = dkey(now()), rec = mine.att[`${me.id}|${k}`];
    let body;
    if(!rec) body = `<section class="panel"><h2>Status</h2><p class="empty">Check in first. Your status can change after you check in.</p></section>`;
    else if(rec.check_out) body = `<section class="panel"><h2>Status</h2><p class="empty">You checked out for today.</p></section>`;
    else body = breakPanel(rec, rec.mode);
    const others = live.filter(r => r.employee_id !== me.id);
    const away = others.filter(r => isAway(liveState(r).s));
    this.el.innerHTML = `${body}
      <section class="panel"><h2>Team right now</h2>
        <p class="small" style="margin:0 0 8px"><b>${others.filter(r=>liveState(r).s==="available").length}</b> available, <b>${away.length}</b> away.</p>
        ${away.length ? away.map(r => { const busy = liveState(r).s==="busy"; return `<div class="item" ${busy?"":"data-bwrap"}><span>${esc(r.name)}</span><span class="small">${breakName(r)}${busy?" for ":", "}${timerSpan(r)}</span></div>`; }).join("") : `<p class="empty" style="padding:0">Everyone else is available.</p>`}
      </section>`;
    tickBreaks();
    const on = (id, kind) => { const b = $(id); if(b) b.onclick = () => breakAction("start_break", { p_kind:kind }, b); };
    on("#bShort","short"); on("#bLong","long"); on("#bWc","wc"); on("#bMeet","meeting"); on("#bTask","task");
    const be = $("#bEnd"); if(be) be.onclick = () => breakAction("end_break", {}, be);
  }
};

/* ---------- my points ---------- */
views.mine = {
  ym:null,
  mount(el){
    this.el = el; this.ym = this.ym || ymOf(dkey(now()));
    el.innerHTML = `<div class="panel"><label class="f" style="max-width:220px">Month<select id="mSel">${lastMonths(12).map(m=>`<option value="${m}" ${m===this.ym?"selected":""}>${esc(monthLabel(m))}</option>`).join("")}</select></label></div><div id="mBody"><p class="muted">Loading</p></div>`;
    $("#mSel").onchange = async e => { this.ym = e.target.value; await loadMine(this.ym); this.update(); };
    loadMine(this.ym).then(()=>this.update());
  },
  update(){
    if(tab!=="mine" || mine.ym!==this.ym) return;
    const s = summarize(me, this.ym, mine.att, mine.sched, mine.adj);
    const rows = s.rows.slice().reverse();
    $("#mBody").innerHTML = `
      <div class="panel"><div class="tally">
        <div class="t-g"><div class="n">${s.early}</div><div class="l">Early credits</div></div>
        <div class="t-r"><div class="n">${s.red}</div><div class="l">Red</div></div>
        <div class="t-b"><div class="n">${s.black}</div><div class="l">Black</div></div>
        <div class="t-a"><div class="n">${s.penalties}</div><div class="l muted">Total penalties</div></div>
      </div><p class="hint">${s.office} office day(s), ${s.remote} remote day(s). ${s.allowed ? `${s.allowed} allowed late day(s) used. ` : ""}${s.cleared ? `${s.cleared} red point(s) cleared by early credits. ` : ""}${s.toNext ? `${s.toNext} more early office day(s) clears the next red.` : s.red && !s.clearsLeft ? "No early-credit clears left this month." : ""}</p></div>
      ${this.ym===ymOf(dkey(now())) ? streakPanel(streakFor(me, mine.att, mine.sched)) : ""}
      ${mine.adj.length ? `<div class="panel"><h2>Manager adjustments</h2>${mine.adj.map(a=>`<div class="item"><span>${a.delta>0?"+1":"-1"} ${esc(a.type)}</span><span class="muted small">${esc(a.reason)}</span></div>`).join("")}</div>` : ""}
      <div class="panel scroll">${rows.length ? `<table class="rows"><thead><tr><th>Date</th><th>Where</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>
        ${rows.map(r=>{ const d = mine.att[`${me.id}|${r.k}`]; return `<tr><td>${esc(prettyDate(r.k))}</td><td class="small">${d ? (d.mode==="remote"?"Remote":"Office") : ""}</td><td>${tstr(d?.check_in)}</td><td>${tstr(d?.check_out)}${d?.auto_out?' <span class="chip c-off">Auto</span>':""}</td><td>${chip(r)}</td></tr>`; }).join("")}
      </tbody></table>` : `<p class="empty">No working days recorded for this month yet.</p>`}</div>`;
  }
};

/* ---------- admin: team today ---------- */
views.team = {
  mount(el){
    this.el = el;
    el.innerHTML = `<div class="actions" style="margin:0 0 12px"><button class="btn" id="tRef">Refresh</button></div><div id="tBody"><p class="muted">Loading</p></div>`;
    $("#tRef").onclick = () => loadTeam(ymOf(dkey(now())));
    loadTeam(ymOf(dkey(now())));
  },
  update(){
    if(tab!=="team") return;
    const k = dkey(now()), list = tracked();
    if(team.loading || team.ym !== ymOf(k)){ $("#tBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    if(!list.length){ $("#tBody").innerHTML = `<div class="panel"><p class="empty">No tracked employees. Add them in Employees.</p></div>`; return; }
    let off=0, rem=0, late=0, abs=0, early=0;
    const rows = list.map(e => {
      const rec = team.att[`${e.id}|${k}`], sh = shiftFor(e, k, team.sched);
      const st = dayFrom(summarize(e, ymOf(k), team.att, team.sched, team.adj), k, dayStatus(e, k, rec, team.sched));
      if(rec?.mode==="remote") rem++; else if(rec) off++;
      if(st.s==="late"||st.s==="remotelate") late++; if(st.s==="absent") abs++;
      const le = leftEarlyBy(e, k, rec, team.sched); if(le) early++;
      const flags = [];
      if(rec?.in_dist != null) flags.push(`${rec.in_dist} m from office`);
      if(!e.email) flags.push("no email set");
      return `<tr><td>${avatarName(e.name)}</td><td class="small">${sh.off ? "Off" : `${esc(sh.sh.start)} to ${esc(sh.sh.end)}`}</td><td>${sh.off && !rec ? "" : modeChip(rec ? rec.mode : sh.mode)}</td><td>${tstr(rec?.check_in)}</td><td>${tstr(rec?.check_out)}${rec?.auto_out?' <span class="chip c-off">Auto</span>':""}</td><td>${chip(st)}${le?`<div class="flag-red">Left early, ${fmtMin(le)}</div>`:""}${flags.length?`<div class="flag">${esc(flags.join(", "))}</div>`:""}</td></tr>`;
    }).join("");
    const pend = (team.ot||[]).filter(o => o.status==="pending");
    const byId = Object.fromEntries(emps.map(e=>[e.id,e.name]));
    $("#tBody").innerHTML = `
      ${pend.length ? `<div class="panel ot-req"><h2>Overtime requests</h2>${pend.map(o=>`<div class="item"><div>${avatarName(byId[o.employee_id]||"")}<div class="small muted" style="margin-left:40px">${esc(prettyDate(o.day))}: ${fmtMin(o.minutes)} after shift end${o.reason?`. ${esc(o.reason)}`:""}</div></div><div style="display:flex;gap:8px"><button class="btn ok" data-ot="${o.id}" data-ap="1">Approve</button><button class="btn no" data-ot="${o.id}" data-ap="0">Reject</button></div></div>`).join("")}</div>` : ""}
      <div class="panel"><div class="tally">
        <div class="t-a"><div class="n">${off}</div><div class="l muted">At the office</div></div>
        <div class="t-a"><div class="n">${rem}</div><div class="l muted">Remote</div></div>
        <div class="t-r"><div class="n">${late}</div><div class="l">Late</div></div>
        <div class="t-b"><div class="n">${abs}</div><div class="l">Absent</div></div>
        <div class="t-a"><div class="n">${early}</div><div class="l muted">Left early</div></div>
      </div></div>
      <div class="panel scroll"><table class="rows"><thead><tr><th>Employee</th><th>Shift</th><th>Where</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    $("#tBody").querySelectorAll("[data-ot]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.rpc("decide_overtime", { p_id:+b.dataset.ot, p_approve: b.dataset.ap==="1" });
      if(error){ toast(errMsg(error)); b.disabled = false; return; }
      toast(b.dataset.ap==="1" ? "Overtime approved" : "Overtime rejected"); loadTeam(ymOf(k)); refreshLive();
    });
  }
};

/* ---------- admin: points ---------- */
views.points = {
  ym:null,
  mount(el){
    this.el = el; this.ym = this.ym || ymOf(dkey(now()));
    el.innerHTML = `
      <div class="panel" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;justify-content:space-between">
        <label class="f" style="min-width:200px">Month<select id="rSel">${lastMonths(12).map(m=>`<option value="${m}" ${m===this.ym?"selected":""}>${esc(monthLabel(m))}</option>`).join("")}</select></label>
        <div style="display:flex;gap:8px"><button class="btn" id="rRef">Refresh</button><button class="btn primary" id="rCsv">Export CSV</button></div>
      </div>
      <div id="rBody"><p class="muted">Loading</p></div>
      <div class="panel"><h2>Adjust points</h2>
        <div class="grid">
          <label class="f">Employee<select id="jU">${tracked().map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></label>
          <label class="f">Point<select id="jT"><option value="red">Red</option><option value="black">Black</option></select></label>
          <label class="f">Change<select id="jD"><option value="-1">Remove 1</option><option value="1">Add 1</option></select></label>
        </div>
        <label class="f" style="margin-top:12px">Reason (required)<input id="jR" maxlength="200" placeholder="Example: system outage, late check-in excused"></label>
        <div class="actions"><button class="btn primary" id="jSave">Save adjustment</button></div>
        <p class="hint">Applies to the month selected above. The employee sees the adjustment and its reason.</p>
      </div>
      <div class="panel"><h2>Adjustments this month</h2><div id="rAdj"></div></div>`;
    $("#rSel").onchange = e => { this.ym = e.target.value; loadTeam(this.ym); };
    $("#rRef").onclick = () => loadTeam(this.ym);
    $("#rCsv").onclick = () => this.csv();
    $("#jSave").onclick = async e => {
      const reason = $("#jR").value.trim();
      if(!reason){ toast("Add a reason for the adjustment."); return; }
      e.target.disabled = true;
      const { error } = await sb.from("adjustments").insert({ employee_id:$("#jU").value, month:this.ym, type:$("#jT").value, delta:Number($("#jD").value), reason, created_by:me.id });
      e.target.disabled = false;
      if(error){ toast(errMsg(error)); return; }
      $("#jR").value = ""; toast("Adjustment saved"); loadTeam(this.ym);
    };
    loadTeam(this.ym);
  },
  update(){
    if(tab!=="points") return;
    if(team.loading || team.ym !== this.ym){ $("#rBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    const otMin = id => (team.ot||[]).filter(o => o.employee_id===id && o.status==="approved" && o.day.startsWith(this.ym)).reduce((a,o)=>a+o.minutes,0);
    this.rows = tracked().map(e => { const s = summarize(e, this.ym, team.att, team.sched, team.adj); s.ot = otMin(e.id); s.review = s.penalties >= S.review_threshold; s.streak = streakFor(e, team.att, team.sched); return { e, s }; });
    const nReview = this.rows.filter(r=>r.s.review).length;
    $("#rBody").innerHTML = this.rows.length ? `${nReview ? `<div class="alertbar soft">${nReview} employee(s) reached ${S.review_threshold} or more penalties this month and need review.</div>` : ""}<div class="panel scroll"><table class="rows report"><thead><tr><th>Employee</th><th class="num">Office</th><th class="num">Remote</th><th class="num">Early</th><th class="num">Late</th><th class="num">Allowed</th><th class="num">Absent</th><th class="num">Left early</th><th class="num">Overtime</th><th class="num">Cleared</th><th class="num">Red</th><th class="num">Black</th><th class="num">Penalties</th><th class="num">Streak</th></tr></thead><tbody>
      ${this.rows.map(({e,s})=>`<tr class="${s.review?"review":""}"><td>${avatarName(e.name)}${s.review?' <span class="chip c-late">Needs review</span>':""}</td><td class="num">${s.office}</td><td class="num">${s.remote}</td><td class="num">${s.early}</td><td class="num">${s.late}</td><td class="num">${s.allowed}</td><td class="num">${s.absent}</td><td class="num">${s.leftEarly||0}</td><td class="num">${s.ot?fmtMin(s.ot):"0"}</td><td class="num">${s.cleared}</td><td class="num">${s.red}</td><td class="num">${s.black}</td><td class="num"><b>${s.penalties}</b></td><td class="num">${s.streak}${s.streak>=STREAK_GOAL?" ★":""}</td></tr>`).join("")}
      </tbody></table><p class="hint">Up to ${S.late_allowance} late days of ${S.late_hard_min} minutes or less are allowed each month. Later than ${S.late_hard_min} minutes is always red, later than ${fmtMin(S.late_black_min)} is black. Every ${S.early_per_clear} early office days clear 1 red, up to ${S.max_clears} times a month. ${S.review_threshold}+ penalties marks Needs review. Left early and overtime are for managers only. Counts reset on the 1st.</p></div>` : `<div class="panel"><p class="empty">No tracked employees.</p></div>`;
    const byId = Object.fromEntries(emps.map(e=>[e.id,e.name]));
    $("#rAdj").innerHTML = team.adj.length ? team.adj.map(a=>`<div class="item"><span><b>${esc(byId[a.employee_id]||"")}</b> ${a.delta>0?"+1":"-1"} ${esc(a.type)}</span><span class="small muted">${esc(a.reason)}</span><button class="btn small" data-del="${a.id}">Delete</button></div>`).join("") : `<p class="empty">No adjustments.</p>`;
    $("#rAdj").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      b.disabled = true; const { error } = await sb.from("adjustments").delete().eq("id", b.dataset.del);
      if(error){ toast(errMsg(error)); b.disabled = false; return; } toast("Adjustment deleted"); loadTeam(this.ym);
    });
  },
  csv(){
    const r = this.rows || []; if(!r.length){ toast("Nothing to export."); return; }
    const q = x => `"${String(x).replace(/"/g,'""')}"`;
    const lines = [["Employee","Month","Office days","Remote days","Early","On time","Late","Allowed lates","Absent","Left early","Overtime minutes","Reds cleared","Red","Black","Penalties","Needs review","Streak"].map(q).join(",")];
    for(const {e,s} of r) lines.push([e.name,this.ym,s.office,s.remote,s.early,s.ontime,s.late,s.allowed,s.absent,s.leftEarly||0,s.ot,s.cleared,s.red,s.black,s.penalties,s.review?"Yes":"No",s.streak].map(q).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv"}));
    const a = document.createElement("a"); a.href = url; a.download = `opus-points-${this.ym}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
};

/* ---------- excuse dialog ---------- */
function excuseDialog({ name, days, current, onSave, onRemove }){
  const dlg = $("#exDlg");
  $("#exTitle").textContent = current !== undefined ? `${name} is excused` : `Excuse ${name}`;
  $("#exWhen").textContent = days.length === 1 ? longDate(days[0]) : `${days.length} working days, ${prettyDate(days[0])} to ${prettyDate(days[days.length-1])}`;
  $("#exReason").value = current || ""; $("#exErr").textContent = "";
  $("#exRemove").hidden = !onRemove || current === undefined;
  $("#exSave").textContent = current !== undefined ? "Update reason" : "Mark excused";
  const run = async fn => { $("#exSave").disabled = $("#exRemove").disabled = true; try{ await fn(); dlg.close(); }catch(e){ $("#exErr").textContent = errMsg(e); } $("#exSave").disabled = $("#exRemove").disabled = false; };
  $("#exSave").onclick = () => run(() => onSave($("#exReason").value.trim()));
  $("#exRemove").onclick = () => run(onRemove);
  dlg.showModal();
}

/* ---------- admin: activity log ---------- */
views.audit = {
  rows:[],
  async mount(el){
    this.el = el;
    el.innerHTML = `<div class="panel" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;justify-content:space-between">
      <label class="f" style="flex:1;min-width:220px">Search<input id="auQ" placeholder="Manager, employee, action or details"></label>
      <button class="btn" id="auRef">Refresh</button></div><div id="auBody"><p class="muted">Loading</p></div>`;
    $("#auQ").oninput = () => this.update();
    $("#auRef").onclick = () => this.load();
    this.load();
  },
  async load(){
    const { data, error } = await sb.from("audit_log").select("*").order("at",{ascending:false}).limit(500);
    if(error){ toast(errMsg(error)); return; }
    this.rows = data || []; this.update();
  },
  update(){
    if(tab!=="audit") return;
    const q = ($("#auQ").value||"").toLowerCase();
    const rows = this.rows.filter(r => !q || [r.actor_name,r.actor_email,r.action,r.target,r.details].join(" ").toLowerCase().includes(q));
    $("#auBody").innerHTML = rows.length ? `<div class="panel scroll"><table class="rows audit"><thead><tr><th>Date</th><th>Time</th><th>By</th><th>Action</th><th>Employee</th><th>Details</th></tr></thead><tbody>
      ${rows.map(r=>{ const t = Date.parse(r.at); return `<tr><td class="nowrap">${esc(prettyDate(dkey(t)))}</td><td class="nowrap">${tstr(r.at)}</td><td><b>${esc(r.actor_name)}</b>${r.actor_email?`<div class="small muted">${esc(r.actor_email)}</div>`:""}</td><td class="nowrap">${esc(r.action)}</td><td class="nowrap">${esc(r.target||"")}</td><td class="small">${esc(r.details||"")}</td></tr>`; }).join("")}
      </tbody></table><p class="hint">Showing the latest ${rows.length} change(s). Every schedule, excuse, points, employee and settings change is recorded with who made it.</p></div>` : `<div class="panel"><p class="empty">${q ? "No matches." : "No changes recorded yet."}</p></div>`;
  }
};

/* ---------- schedule ---------- */
function monthOptions(sel){
  const now0 = ymOf(dkey(now())), [y,m] = now0.split("-").map(Number), out = [];
  for(let i=-2;i<=2;i++){ const d = new Date(Date.UTC(y, m-1+i, 15)); out.push(d.toISOString().slice(0,7)); }
  return out.map(x=>`<option value="${x}" ${x===sel?"selected":""}>${esc(monthLabel(x))}</option>`).join("");
}
views.schedule = {
  ym:null,
  mount(el){
    this.el = el; this.ym = this.ym || ymOf(dkey(now()));
    el.innerHTML = `
      <div class="panel"><label class="f" style="max-width:220px">Month<select id="scSel">${monthOptions(this.ym)}</select></label></div>
      <div class="panel"><h2>Change shifts</h2><div id="scEdit"></div>
        <p class="hint">Pick a shift, where they work, or both. Keep leaves that part unchanged. Date range applies to working days only; weekends and holidays stay off. One day changes that exact day. Agents cannot change where they work; check-in follows this schedule.</p>
      </div>
      <div class="panel"><h2>Month overview</h2><div id="scBody"><p class="muted">Loading</p></div></div>`;
    $("#scSel").onchange = e => { this.ym = e.target.value; this.renderEdit(); loadTeam(this.ym); };
    this.renderEdit(); loadTeam(this.ym);
  },
  renderEdit(){
    const a = `${this.ym}-01`, b = monthEnd(this.ym);
    const today = dkey(now()), start = today > a && today <= b ? today : a;
    const opts = `<option value="keep">Keep shift</option>${Object.keys(shifts).map(id=>`<option value="${id}">${esc(shiftLabel(id))}</option>`).join("")}<option value="off">Day off</option><option value="excused">Excused</option>`;
    $("#scEdit").innerHTML = `<div class="scroll"><table class="rows edit"><thead><tr><th>Agent</th><th>Shift</th><th>Work from</th><th>Apply to</th><th>From</th><th>To</th><th></th></tr></thead><tbody>
      ${tracked().map(e=>`<tr data-e="${e.id}">
        <td><b>${esc(e.name)}</b></td>
        <td><select class="inl" data-f="shift">${opts.replace(`value="${e.shift_id}"`,`value="${e.shift_id}" selected`)}</select></td>
        <td><select class="inl" data-f="wmode"><option value="">Keep</option><option value="office">Office</option><option value="remote">Remote</option></select></td>
        <td><select class="inl" data-f="mode"><option value="range">Date range</option><option value="day">One day</option></select></td>
        <td><input class="inl" type="date" data-f="from" value="${start}" min="${a}" max="${b}"></td>
        <td><input class="inl" type="date" data-f="to" value="${b}" min="${a}" max="${b}"></td>
        <td><button class="btn primary small" data-f="apply">Apply</button></td></tr>`).join("")}
      </tbody></table></div>`;
    $("#scEdit").querySelectorAll("tr[data-e]").forEach(tr => { const e = emps.find(x=>x.id===tr.dataset.e); tr.querySelector('[data-f="shift"]').value = "keep"; });
    $("#scEdit").querySelectorAll("tr[data-e]").forEach(tr => {
      const g = f => tr.querySelector(`[data-f="${f}"]`);
      g("mode").onchange = () => { const one = g("mode").value==="day"; g("to").style.visibility = one ? "hidden" : "visible"; };
      g("apply").onclick = () => this.apply(tr.dataset.e, g("shift").value, g("mode").value, g("from").value, g("to").value, g("apply"), g("wmode").value || null);
    });
  },
  async apply(eid, shift, mode, from, to, btn, wmode){
    if(mode==="day") to = from;
    if(!from || !to || to < from){ toast("Pick a valid date range."); return; }
    const name = emps.find(e=>e.id===eid)?.name || "";
    if(shift==="excused"){
      const days = monthKeys(this.ym).filter(k => k >= from && k <= to && (mode==="day" || isWorkday(k)));
      excuseDialog({ name, days, onSave: async reason => { for(const k of days){ const { error } = await sb.rpc("set_excused", { p_employee:eid, p_day:k, p_excused:true, p_reason:reason }); if(error) throw error; } toast(`${name}: ${days.length} day(s) excused`); loadTeam(this.ym); } });
      return;
    }
    btn.disabled = true;
    const { error } = await sb.rpc("set_schedule", { p_employee:eid, p_from:from, p_to:to, p_shift:shift, p_working_only: mode==="range", p_mode: wmode });
    btn.disabled = false;
    if(error){ toast(errMsg(error)); return; }
    toast(mode==="day" ? `${name}: ${prettyDate(from)} saved` : `${name}: ${prettyDate(from)} to ${prettyDate(to)} saved`);
    loadTeam(this.ym);
  },
  update(){
    if(tab!=="schedule") return;
    if(team.loading || team.ym !== this.ym){ $("#scBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    const days = monthKeys(this.ym), list = tracked();
    const cell = (e,k) => { const ex = team.sched[`X|${e.id}|${k}`]; const sf = shiftFor(e,k,team.sched); const t = ex !== undefined ? "Exc" : sf.off ? "Off" : sf.sh.start.replace(":00","") + (sf.mode==="remote" ? "<sup>R</sup>" : "");
      return `<td class="num small"><button class="ocell ${ex!==undefined?"exc":sf.off?"off":""} ${sf.planned||ex!==undefined?"":"faded"}" data-e="${e.id}" data-k="${k}" title="${esc(e.name)}, ${esc(prettyDate(k))}${ex?": "+esc(ex):""}">${t}</button></td>`; };
    $("#scBody").innerHTML = list.length ? `<div class="scroll"><table class="rows sched"><thead><tr><th>Agent</th>${days.map(k=>`<th class="num">${DOW[wdOf(k)].slice(0,2)}<br>${+k.slice(8)}</th>`).join("")}</tr></thead><tbody>
      ${list.map(e=>`<tr><td>${esc(e.name)}</td>${days.map(k=>cell(e,k)).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="hint">Faded = not set yet, using the agent's default shift. R = remote day. Exc = excused, no points that day. Click any day to excuse it or remove the excuse.</p>` : `<p class="empty">No tracked employees.</p>`;
    $("#scBody").querySelectorAll(".ocell").forEach(b => b.onclick = () => {
      const e = emps.find(x=>x.id===b.dataset.e), k = b.dataset.k, cur = team.sched[`X|${e.id}|${k}`];
      excuseDialog({ name:e.name, days:[k], current:cur,
        onSave: async reason => { const { error } = await sb.rpc("set_excused", { p_employee:e.id, p_day:k, p_excused:true, p_reason:reason }); if(error) throw error; toast(`${e.name}: ${prettyDate(k)} excused`); loadTeam(this.ym); },
        onRemove: async () => { const { error } = await sb.rpc("set_excused", { p_employee:e.id, p_day:k, p_excused:false }); if(error) throw error; toast(`${e.name}: excuse removed`); loadTeam(this.ym); } });
    });
  }
};
views.myschedule = {
  ym:null,
  async mount(el){
    this.el = el; this.ym = this.ym || ymOf(dkey(now()));
    el.innerHTML = `<div id="msBody"><p class="muted">Loading</p></div>`;
    await this.load(); this.render();
  },
  async load(){
    const a = `${this.ym}-01`, b = monthEnd(this.ym);
    const [sc, att, ex] = await Promise.all([
      sb.from("schedule").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
      sb.from("attendance").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
      sb.from("excused").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b)
    ]);
    this.sched = toMap(sc.data||[], r=>r.shift_id); this.att = toMap(att.data||[], r=>r);
    for(const r of sc.data||[]) if(r.work_mode) this.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
    for(const r of ex.data||[]) this.sched[`X|${r.employee_id}|${r.day}`] = r.reason || "";
  },
  render(){
    if(tab!=="myschedule") return;
    const today = dkey(now()), days = monthKeys(this.ym);
    const ids = Object.keys(shifts);
    const tone = id => `s${(ids.indexOf(id) % 3) + 1}`;
    const info = k => { const sf = shiftFor(me, k, this.sched); return sf.off ? { off:true } : { off:false, sh:sf.sh, id: ids.find(i => shifts[i]===sf.sh) }; };
    const lead = (wdOf(days[0]) + 6) % 7;
    const work = days.filter(k => !info(k).off), left = work.filter(k => k >= today);
    const next = days.find(k => k > today && !info(k).off);
    const todayInfo = days.includes(today) ? info(today) : null;
    const counts = {}; for(const k of work){ const id = info(k).id; counts[id] = (counts[id]||0)+1; }
    const label = sh => `${sh.start}–${sh.end}`;
    const cur = ymOf(today), nextYm = (()=>{ const [y,m] = cur.split("-").map(Number); return new Date(Date.UTC(y,m,15)).toISOString().slice(0,7); })();
    $("#msBody").innerHTML = `
      <div class="ms-top">
        <div class="ms-hero">
          <div class="small muted">${todayInfo ? "Today" : "This month"}</div>
          <div class="ms-big">${todayInfo ? (todayInfo.off ? "Day off" : label(todayInfo.sh)) : esc(monthLabel(this.ym))}</div>
          <div class="small muted">${next ? `Next shift ${esc(prettyDate(next))}, ${label(info(next).sh)}` : "No more shifts this month"}</div>
        </div>
        <div class="ms-stat"><div class="n">${work.length}</div><div class="l muted">Working days</div></div>
        <div class="ms-stat"><div class="n">${left.length}</div><div class="l muted">Still to go</div></div>
        <div class="ms-stat"><div class="n">${days.length - work.length}</div><div class="l muted">Days off</div></div>
      </div>
      <section class="panel">
        <div class="ms-nav">
          <button class="btn small" id="msPrev" ${this.ym===cur?"disabled":""} aria-label="Previous month">‹</button>
          <h2 style="margin:0">${esc(monthLabel(this.ym))}</h2>
          <button class="btn small" id="msNext" ${this.ym===nextYm?"disabled":""} aria-label="Next month">›</button>
        </div>
        <div class="cal">
          ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="cal-h">${d}</div>`).join("")}
          ${Array.from({length:lead},()=>`<div class="cal-d empty"></div>`).join("")}
          ${days.map(k => { const x = info(k), rec = this.att[`${me.id}|${k}`];
            const cls = ["cal-d", k===today?"today":"", k<today?"past":"", x.off?"off":""].join(" ");
            const dot = rec ? `<span class="cal-dot ${rec.mode==="remote"?"rem":"off"}" title="${rec.mode==="remote"?"Worked remote":"Worked at the office"}"></span>` : "";
            const exc = this.sched[`X|${me.id}|${k}`];
            return `<div class="${cls}"><div class="cal-n">${+k.slice(8)}${dot}</div>${exc !== undefined ? `<div class="cal-exc" title="${esc(exc)}">Excused</div>` : x.off ? `<div class="cal-off">Off</div>` : `<div class="cal-pill ${tone(x.id)}"><span>${x.sh.start}</span><span class="to">${x.sh.end}</span></div>${shiftFor(me,k,this.sched).mode==="remote" ? '<div class="cal-mode">Remote</div>' : ""}`}</div>`; }).join("")}
        </div>
        <div class="cal-legend">
          ${ids.filter(id=>counts[id]).map(id=>`<span><i class="cal-sw ${tone(id)}"></i>${label(shifts[id])}, ${counts[id]} day(s)</span>`).join("")}
          <span><i class="cal-sw so"></i>Day off</span>
        </div>
      </section>`;
    $("#msPrev").onclick = async () => { this.ym = cur; await this.load(); this.render(); };
    $("#msNext").onclick = async () => { this.ym = nextYm; await this.load(); this.render(); };
  }
};

/* ---------- admin: employees ---------- */
views.people = {
  mount(el){ this.el = el; this.render(); },
  render(){
    const shOpts = sel => Object.keys(shifts).map(id=>`<option value="${id}" ${sel===id?"selected":""}>${esc(shiftLabel(id))}</option>`).join("");
    this.el.innerHTML = `<div class="panel scroll"><table class="rows"><thead><tr><th>Name</th><th>Work email (login)</th><th>Default shift</th><th>Works from</th><th>Counts from</th><th>Tracked</th><th>Manager</th><th>Active</th><th></th></tr></thead><tbody>
      ${emps.map(e=>`<tr data-id="${e.id}">
        <td><input class="inl" data-f="name" value="${esc(e.name)}" maxlength="60"></td>
        <td><input class="inl" type="email" data-f="email" value="${esc(e.email||"")}" placeholder="name@company.com"></td>
        <td><select class="inl" data-f="shift_id">${shOpts(e.shift_id)}</select></td>
        <td><select class="inl" data-f="default_mode"><option value="office" ${e.default_mode!=="remote"?"selected":""}>Office</option><option value="remote" ${e.default_mode==="remote"?"selected":""}>Remote</option></select></td>
        <td><input class="inl" type="date" data-f="since" value="${esc(e.since||"")}"></td>
        <td><input type="checkbox" data-f="tracked" ${e.tracked?"checked":""}></td>
        <td><input type="checkbox" data-f="is_admin" ${e.is_admin?"checked":""}></td>
        <td><input type="checkbox" data-f="active" ${e.active?"checked":""}></td>
        <td><button class="btn small primary" data-save>Save</button></td></tr>`).join("")}
      </tbody></table>
      <p class="hint">Tracked: gets check-in tabs and points. Manager: sees admin tabs and receives late alerts. A manager who does not check in should be Manager only.</p></div>
      <div class="actions" style="justify-content:flex-start"><button class="btn" id="pAdd">Add employee</button></div>`;
    this.el.querySelectorAll("[data-save]").forEach(b => b.onclick = async () => {
      const tr = b.closest("tr"), g = f => tr.querySelector(`[data-f="${f}"]`);
      const email = g("email").value.trim().toLowerCase();
      if(!g("name").value.trim()){ toast("Name is required."); return; }
      if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("Enter a valid email."); return; }
      if(tr.dataset.id===me.id && (!g("is_admin").checked || !g("active").checked)){ toast("You cannot remove your own manager access."); return; }
      b.disabled = true;
      const row = { name:g("name").value.trim(), email:email||null, shift_id:g("shift_id").value, default_mode:g("default_mode").value, since:g("since").value||null, tracked:g("tracked").checked, is_admin:g("is_admin").checked, active:g("active").checked };
      const { error } = await sb.from("employees").update(row).eq("id", tr.dataset.id);
      b.disabled = false;
      if(error){ toast(error.code==="23505" ? "That email is already used by another employee." : errMsg(error)); return; }
      Object.assign(emps.find(e=>e.id===tr.dataset.id), row); toast("Saved");
    });
    $("#pAdd").onclick = async () => {
      const { data, error } = await sb.from("employees").insert({ name:"New employee", shift_id:S.default_shift, tracked:true }).select().single();
      if(error){ toast(errMsg(error)); return; }
      emps.push(data); this.render();
    };
  }
};

/* ---------- admin: settings ---------- */
views.settings = {
  mount(el){
    this.el = el;
    el.innerHTML = `
      <div class="panel"><h2>Points rules</h2>
        <div class="grid">
          <label class="f">Late after (min from shift start)<input type="number" min="0" max="120" id="sGrace" value="${S.grace_min}"></label>
          <label class="f">Early credit from (min before start)<input type="number" min="1" max="240" id="sEMax" value="${S.early_max}"></label>
          <label class="f">Early credit until (min before start)<input type="number" min="1" max="180" id="sEarly" value="${S.early_min}"></label>
          <label class="f">Early credits to clear 1 red<input type="number" min="1" max="20" id="sPer" value="${S.early_per_clear}"></label>
          <label class="f">Max clears per month<input type="number" min="0" max="31" id="sMaxC" value="${S.max_clears}"></label>
          <label class="f">Late over this is always red (min)<input type="number" min="1" id="sHard" value="${S.late_hard_min}"></label>
          <label class="f">Late over this is black (min)<input type="number" min="1" id="sBlackL" value="${S.late_black_min}"></label>
          <label class="f">Check-in opens before shift (min)<input type="number" min="0" max="120" id="sOpen" value="${S.checkin_open_min}"></label>
          <label class="f">Left early after (min before end)<input type="number" min="0" id="sLeave" value="${S.early_leave_min}"></label>
          <label class="f">Needs review at (penalties)<input type="number" min="1" id="sRev" value="${S.review_threshold}"></label>
          <label class="f">Allowed late days per month<input type="number" min="0" max="31" id="sAllow" value="${S.late_allowance}"></label>
        </div>
        <p class="small muted" style="margin:12px 0 6px">Default working days (used when the schedule has no entry)</p>
        <div class="days">${DOW.map((n,i)=>`<label><input type="checkbox" data-wd="${i}" ${S.workdays.includes(i)?"checked":""}>${n}</label>`).join("")}</div>
        <label class="f" style="margin-top:12px">Public holidays (YYYY-MM-DD, one per line)<textarea id="sHol" rows="3">${esc((S.holidays||[]).join("\n"))}</textarea></label>
      </div>
      <div class="panel"><h2>Breaks</h2>
        <div class="grid">
          <label class="f">Short break (min)<input type="number" min="1" id="sBsm" value="${S.break_short_min}"></label>
          <label class="f">Short breaks per shift<input type="number" min="0" id="sBsc" value="${S.break_short_count}"></label>
          <label class="f">Long break (min)<input type="number" min="1" id="sBlm" value="${S.break_long_min}"></label>
          <label class="f">Long breaks per shift<input type="number" min="0" id="sBlc" value="${S.break_long_count}"></label>
          <label class="f">WC break (min)<input type="number" min="1" id="sBwm" value="${S.break_wc_min}"></label>
          <label class="f">WC breaks per shift<input type="number" min="0" id="sBwc" value="${S.break_wc_count}"></label>
          <label class="f">No breaks at shift start and end (min)<input type="number" min="0" id="sEdge" value="${S.break_edge_min}"></label>
          <label class="f">Must stay available<input type="number" min="0" id="sMinA" value="${S.min_available}"></label>
          <label class="f">Red banner after (min over)<input type="number" min="1" id="sBal" value="${S.break_alert_after_min}"></label>
        </div>
        <p class="hint">All breaks, WC included, need a teammate to stay available. Over the break length shows red on the Live board. Past the alert time, a red banner shows for the employee and all managers.</p>
      </div>
      <div class="panel"><h2>Office location</h2>
        <div class="grid">
          <label class="f">Latitude<input id="sLat" value="${S.office_lat ?? ""}"></label>
          <label class="f">Longitude<input id="sLng" value="${S.office_lng ?? ""}"></label>
          <label class="f">Radius (m)<input type="number" min="50" id="sRad" value="${S.radius_m}"></label>
        </div>
        <div class="actions" style="justify-content:flex-start"><button class="btn" id="sHere">Use my current location</button></div>
        <p class="hint">The server checks the distance on every office check-in. Coordinates are never stored for employees, only the distance.</p>
      </div>
      <div class="actions"><button class="btn primary big" id="sSave">Save settings</button></div>`;
    $("#sHere").onclick = async () => { try{ const p = await getPos(); $("#sLat").value = p.coords.latitude.toFixed(6); $("#sLng").value = p.coords.longitude.toFixed(6); toast("Location set. Save to apply."); }catch(e){ toast(errMsg(e)); } };
    $("#sSave").onclick = async e => {
      const hol = $("#sHol").value.split(/\s+/).map(x=>x.trim()).filter(Boolean);
      if(hol.some(h=>!/^\d{4}-\d{2}-\d{2}$/.test(h))){ toast("Holidays must use YYYY-MM-DD."); return; }
      if(+$("#sEMax").value <= +$("#sEarly").value){ toast("Early credit 'from' must be more minutes than 'until'."); return; }
      const lat = parseFloat($("#sLat").value), lng = parseFloat($("#sLng").value);
      if(isNaN(lat) || isNaN(lng)){ toast("Enter the office latitude and longitude."); return; }
      const row = {
        grace_min: Math.max(0, +$("#sGrace").value||0), early_min: Math.max(1, +$("#sEarly").value||10), early_max: Math.max(2, +$("#sEMax").value||15), early_per_clear: Math.max(1, Math.round(+$("#sPer").value||3)), max_clears: Math.max(0, Math.round(+$("#sMaxC").value||0)), late_allowance: Math.max(0, Math.round(+$("#sAllow").value||0)),
        late_hard_min: Math.max(1, +$("#sHard").value||30), late_black_min: Math.max(1, +$("#sBlackL").value||120), checkin_open_min: Math.max(0, +$("#sOpen").value||0),
        early_leave_min: Math.max(0, +$("#sLeave").value||0), review_threshold: Math.max(1, +$("#sRev").value||3),
        workdays: [...document.querySelectorAll("[data-wd]")].filter(x=>x.checked).map(x=>+x.dataset.wd), holidays: hol,
        office_lat: lat, office_lng: lng, radius_m: Math.max(50, +$("#sRad").value||500),
        break_short_min: Math.max(1, +$("#sBsm").value||15), break_short_count: Math.max(0, Math.round(+$("#sBsc").value||0)),
        break_long_min: Math.max(1, +$("#sBlm").value||30), break_long_count: Math.max(0, Math.round(+$("#sBlc").value||0)),
        break_wc_min: Math.max(1, +$("#sBwm").value||5), break_wc_count: Math.max(0, Math.round(+$("#sBwc").value||0)),
        break_edge_min: Math.max(0, +$("#sEdge").value||0),
        min_available: Math.max(0, Math.round(+$("#sMinA").value||0)), break_alert_after_min: Math.max(1, +$("#sBal").value||15)
      };
      e.target.disabled = true;
      const { error } = await sb.from("settings").update(row).eq("id",1);
      e.target.disabled = false;
      if(error){ toast(errMsg(error)); return; }
      S = { ...S, ...row }; toast("Settings saved");
    };
  }
};

/* ---------- night mode ---------- */
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t==="dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function paintThemeButtons(){ const on = isDark(); document.querySelectorAll("[data-theme-toggle]").forEach(b => { b.setAttribute("aria-pressed", String(on)); b.querySelector(".tl").textContent = on ? "Night mode on" : "Night mode off"; }); }
document.querySelectorAll("[data-theme-toggle]").forEach(b => b.onclick = () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try{ localStorage.setItem("opus-theme", next); }catch{}
  paintThemeButtons();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeButtons);
paintThemeButtons();

/* ---------- report an issue ---------- */
const DEV_EMAIL = "ahmed.kamal@aaico.com";
views.issue = {
  async mount(el){
    this.el = el;
    el.innerHTML = `
      <section class="panel">
        <div class="grid">
          <label class="f">What is it about?<select id="isCat"><option>Check in or check out</option><option>Breaks or status</option><option>Points or report</option><option>Schedule</option><option>Location or office distance</option><option>Sign in</option><option>Something else</option></select></label>
          <label class="f">Where did it happen?<select id="isPage">${tabsFor().filter(x=>x[0]!=="head"&&x[0]!=="issue").map(x=>`<option>${esc(x[1])}</option>`).join("")}<option>Other</option></select></label>
        </div>
        <label class="f" style="margin-top:12px">Describe the problem<textarea id="isMsg" rows="6" maxlength="2000" placeholder="What did you do, what did you expect, and what happened instead? Include the time if you can."></textarea></label>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="small muted">Goes to the developer at <a href="mailto:${DEV_EMAIL}">${DEV_EMAIL}</a></span>
          <button class="btn primary" id="isSend">Send to the developer</button>
        </div>
        <p class="hint">Your name, email, the time and your browser are added automatically. Your email app opens with the message ready; press send there. A copy is also saved in the system.</p>
      </section>
      <section class="panel"><h2>Your reports</h2><div id="isList"><p class="muted">Loading</p></div></section>`;
    $("#isSend").onclick = () => this.send($("#isSend"));
    this.list();
  },
  async list(){
    const { data } = await sb.from("issues").select("*").eq("employee_id", me.id).order("created_at",{ascending:false}).limit(20);
    if(tab!=="issue") return;
    $("#isList").innerHTML = (data||[]).length ? data.map(r=>`<div class="item"><div><b>${esc(r.category)}</b> <span class="small muted">${esc(r.page||"")}</span><div class="small">${esc(r.message)}</div></div><span class="small muted nowrap">${esc(prettyDate(dkey(Date.parse(r.created_at))))}, ${tstr(r.created_at)}</span></div>`).join("") : `<p class="empty">No reports yet.</p>`;
  },
  async send(btn){
    const msg = $("#isMsg").value.trim(), cat = $("#isCat").value, page = $("#isPage").value;
    if(msg.length < 5){ toast("Describe the problem first."); return; }
    btn.disabled = true;
    const { error } = await sb.rpc("report_issue", { p_category:cat, p_message:msg, p_page:page, p_user_agent:navigator.userAgent });
    btn.disabled = false;
    if(error){ toast(errMsg(error)); return; }
    const t = now(), email = (await sb.auth.getUser()).data.user?.email || "";
    const body = `${msg}\n\n---\nFrom: ${me.name} (${email})\nRole: ${me.is_admin?"Manager":"Team member"}\nTopic: ${cat}\nPage: ${page}\nTime: ${longDate(dkey(t))}, ${tstr(new Date(t).toISOString())} UAE\nBrowser: ${navigator.userAgent}`;
    location.href = `mailto:${DEV_EMAIL}?subject=${encodeURIComponent(`[Opus Attendance] ${cat}`)}&body=${encodeURIComponent(body)}`;
    toast("Saved. Your email app is opening.");
    $("#isMsg").value = ""; this.list();
  }
};

/* ---------- auth ---------- */
function showLogin(msg){
  $("#app").hidden = true; $("#login").hidden = false;
  $("#lMsg").textContent = msg || "";
  $("#lStep1").hidden = false; $("#lStep2").hidden = true;
}
$("#lSend").onclick = async () => {
  const email = $("#lEmail").value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $("#lMsg").textContent = "Enter your work email."; return; }
  $("#lSend").disabled = true; $("#lMsg").textContent = "";
  const { error } = await sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:true, emailRedirectTo: location.origin } });
  $("#lSend").disabled = false;
  if(error){ $("#lMsg").textContent = errMsg(error); return; }
  $("#lStep1").hidden = true; $("#lStep2").hidden = false;
  $("#lSent").textContent = email; $("#lCode").value = ""; $("#lCode").focus();
};
$("#lEmail").addEventListener("keydown", e => { if(e.key==="Enter") $("#lSend").click(); });
$("#lCode").addEventListener("keydown", e => { if(e.key==="Enter") $("#lVerify").click(); });
$("#lBack").onclick = () => showLogin("");
$("#lVerify").onclick = async () => {
  const token = $("#lCode").value.replace(/\D/g,"");
  if(token.length < 6){ $("#lMsg2").textContent = "Enter the code from the email."; return; }
  $("#lVerify").disabled = true; $("#lMsg2").textContent = "";
  const { error } = await sb.auth.verifyOtp({ email:$("#lSent").textContent, token, type:"email" });
  $("#lVerify").disabled = false;
  if(error){ $("#lMsg2").textContent = "That code is wrong or expired. Request a new one."; return; }
};
$("#signout").onclick = async () => { await sb.auth.signOut(); };

let started = false, pendingMsg = "", poller = null;
async function startApp(){
  if(started) return; started = true;
  try{
    const { data } = await sb.rpc("server_now");
    if(data) serverOffset = Date.parse(data) - Date.now();
    await loadBase();
  }catch(e){ started = false; showLogin(errMsg(e)); return; }
  if(!me){ started = false; pendingMsg = "This email is not registered. Ask a manager to add it in Employees."; await sb.auth.signOut(); return; }
  $("#login").hidden = true; $("#app").hidden = false;
  $("#who").innerHTML = `${avatar(me.name)}<div><div class="nm">${esc(me.name)}</div><div class="rl">${me.is_admin?"Manager":"Team member"}</div></div>`;
  if(me.tracked) await loadMine(ymOf(dkey(now())));
  await refreshLive();
  renderTabs(); setTab(tab);
  setInterval(() => { if(!document.hidden) refreshLive(); }, 15000);
  if(!poller) poller = setInterval(async () => { if(document.hidden) return; if(me.tracked && ["checkin","breaks","mine"].includes(tab)){ await loadMine(ymOf(dkey(now()))); update(); } }, 60000);
}
sb.auth.onAuthStateChange((ev, session) => {
  if(session) setTimeout(startApp, 0);
  else { started = false; me = null; showLogin(pendingMsg); pendingMsg = ""; }
});
sb.auth.getSession().then(({ data }) => { if(!data.session) showLogin(""); });
