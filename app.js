"use strict";
const SUPABASE_URL = "https://letstuovdrfxihrtrwdy.supabase.co";
const SUPABASE_KEY = "sb_publishable_hY_4KuyHayNUk5vdu_kbrQ_jJXmeD6M";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let serverOffset = 0;
const now = () => Date.now() + serverOffset;
let S = { tz:"Asia/Dubai", grace_min:5, early_min:10, early_max:15, checkin_open_min:15, late_hard_min:30, late_black_min:120, adherence_target:90, early_leave_min:5, break_edge_min:30, review_threshold:3, early_per_clear:3, late_allowance:2, max_clears:2, break_short_min:15, break_short_count:2, break_long_min:30, break_long_count:1, break_wc_min:5, break_wc_count:2, min_available:1, break_alert_after_min:15, workdays:[1,2,3,4,5], holidays:[], default_shift:"s08", radius_m:500 };
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
/* ---------- check-in ---------- */
const photos = {};
function avatar(name, id){ if(id && photos[id]) return `<img class="av" src="${esc(photos[id])}" alt="">`; const n = String(name||"?"); let h = 0; for(const c of n) h = (h*31 + c.charCodeAt(0)) % 360;
  const ini = n.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  return `<span class="av" style="--h:${h}">${esc(ini)}</span>`; }
const avatarName = (n, id) => `<span class="avn">${avatar(n, id)}<span>${esc(n)}</span></span>`;
const modeChip = m => `<span class="mode-chip ${m}">${m==="remote" ? '<svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/></svg>Remote' : '<svg viewBox="0 0 24 24"><path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-5h6v5"/></svg>Office'}</span>`;

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
  if(ex !== undefined) return { s:"excused", reason: ex, lt: schedMap[`XT|${emp.id}|${k}`] || "excused" };
  if(off) return { s:"off" };
  if(!rec){
    if(k < today || mins(now()) >= end) return { s:"absent" };
    return { s:"pending" };
  }
  const m = mins(ts(rec.check_in));
  if(rec.mode === "remote"){
    if(m <= start) return { s:"remote" };
    if(m <= start + S.grace_min) return { s:"remotegrace", by: m - start };
    return { s:"remotelate", by: m - start };
  }
  if(m < start - S.early_min) return m >= start - S.early_max ? { s:"early", ahead: start - m } : { s:"ontime" };
  if(m <= start) return { s:"ontime" };
  if(m <= start + S.grace_min) return { s:"grace", by: m - start };
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
    else if(st.s==="grace"){ c.ontime++; c.grace = (c.grace||0) + 1; c.office++; }
    else if(st.s==="remote") c.remote++;
    else if(st.s==="remotegrace"){ c.grace = (c.grace||0) + 1; c.remote++; }
    else if(st.s==="absent"){ c.absent++; c.black++; }
    else if(st.s==="excused"){ c.excused = (c.excused||0) + 1; c.lv = c.lv || {}; c.lv[st.lt] = (c.lv[st.lt]||0) + 1; }
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
function adherenceFor(emp, ym, att, sm, brk, keys){
  const today = dkey(now()), nowM = mins(now());
  let sched = 0, non = 0;
  for(const k of (keys || monthKeys(ym))){
    if(k > today) break;
    if(emp.since && k < emp.since) continue;
    if(sm[`X|${emp.id}|${k}`] !== undefined) continue;
    const sf = shiftFor(emp, k, sm); if(sf.off) continue;
    const start = pHM(sf.sh.start), end = pHM(sf.sh.end), dEnd = k === today ? Math.min(nowM, end) : end;
    if(dEnd <= start) continue;
    const len = dEnd - start; sched += len;
    const rec = att[`${emp.id}|${k}`];
    if(!rec){ non += len; continue; }
    let miss = Math.max(0, Math.min(len, mins(ts(rec.check_in)) - start));
    if(rec.check_out && !rec.auto_out) miss += Math.max(0, dEnd - Math.max(start, mins(ts(rec.check_out))));
    for(const b of (brk||[])){
      if(b.employee_id !== emp.id || b.day !== k || !["short","long","wc"].includes(b.kind)) continue;
      const dur = ((b.ended_at ? Date.parse(b.ended_at) : now()) - Date.parse(b.started_at)) / 60000;
      const allow = b.kind==="long" ? S.break_long_min : b.kind==="wc" ? S.break_wc_min : S.break_short_min;
      miss += Math.max(0, Math.round(dur - allow));
    }
    non += Math.min(len, miss);
  }
  return sched ? { pct: Math.max(0, Math.round((sched - non) / sched * 1000) / 10), sched, non } : null;
}
const adhClass = p => p == null ? "" : p >= S.adherence_target ? "good" : p >= S.adherence_target - 10 ? "mid" : "bad";
const adhText = a => a ? `${a.pct}%` : "–";
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
const LEAVE = { holiday:["Public holiday","PH"], excused:["Excused","Exc"], paid:["Paid leave","PL"], sick:["Sick leave","SL"], half:["Half day, paid","½"], unpaid:["Unpaid day","UP"] };
const LEAVE_ORDER = ["holiday","paid","sick","half","unpaid","excused"];
function chip(st){
  const map = {
    early:[`Early ${st.ahead||""} min, +1 credit`,"early"], ontime:["On time","ontime"],
    late: st.severe==="black" ? [`Late ${fmtMin(st.by)}, +1 black`,"absent"] : st.allowed ? [`Late ${st.by} min, allowed (${st.allowed} of ${S.late_allowance})`,"pending"] : [`Late ${fmtMin(st.by)}, +1 red${st.severe?` (over ${S.late_hard_min} min)`:""}`,"late"], absent:["Absent, +1 black","absent"],
    remote:["Remote, on time","remote"], grace:[`Late ${st.by} min, within grace`,"pending"], remotegrace:[`Remote, late ${st.by} min, within grace`,"pending"], remotelate: st.severe==="black" ? [`Remote, late ${fmtMin(st.by)}, +1 black`,"absent"] : st.allowed ? [`Remote, late ${st.by} min, allowed (${st.allowed} of ${S.late_allowance})`,"pending"] : [`Remote, late ${fmtMin(st.by)}, +1 red${st.severe?` (over ${S.late_hard_min} min)`:""}`,"late"],
    off:["Day off","off"], pending:["Not checked in","pending"], excused:[`${(LEAVE[st.lt]||LEAVE.excused)[0]}${st.reason ? ": "+st.reason : ""}`,"remote"], na:["Not started","na"], future:["",""]
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
  for(const e of emps) if(e.avatar_url) photos[e.id] = e.avatar_url;
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
    sb.from("overtime").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("breaks").select("*").eq("employee_id",me.id).gte("day",`${ym}-01`).lte("day",b)
  ]).then(r => { mine.ot = r[4].data || []; mine.brk = r[5].data || []; return r; });
  mine.ym = ym;
  mine.att = toMap(att.data||[], r=>r);
  mine.sched = toMap(sc.data||[], r=>r.shift_id);
  for(const r of sc.data||[]) if(r.work_mode) mine.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex.data||[]){ mine.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; mine.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
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
    sb.from("overtime").select("*").gte("day",`${ym}-01`).lte("day",b).order("id",{ascending:false}),
    sb.from("breaks").select("*").gte("day",`${ym}-01`).lte("day",b)
  ]).then(r => { team.ot = r[4].data || []; team.brk = r[5].data || []; return r; });
  team.ym = ym;
  team.att = toMap(att.data||[], r=>r);
  team.sched = toMap(sc.data||[], r=>r.shift_id);
  for(const r of sc.data||[]) if(r.work_mode) team.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex.data||[]){ team.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; team.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
  team.adj = adj.data||[];
  team.loading = false; update();
}
const tracked = () => emps.filter(e => e.active && e.tracked);
const schedPeople = () => emps.filter(e => e.active && (e.tracked || e.scheduled)).sort((a,b) => (a.tracked?0:1) - (b.tracked?0:1) || a.name.localeCompare(b.name));

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
  guide:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 8h8M8 12h5"/>',
  profile:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/><path d="M18.5 4.5l1 1M19.5 4.5l-1 1"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.5"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'
};
/* Sidebar tab -> icon. Section icons are reused from ICONS above. */
const TAB_ICON = { today:"checkin", month:"mine", ops:"live", reports:"points", schedule:"schedule", people:"people", account:"profile" };
function tabsFor(){
  const t = [], both = !!(me?.tracked && me?.is_admin);
  if(me?.tracked){ if(both) t.push(["head","My work"]); t.push(["today","Today"],["month","My month"]); }
  if(me?.is_admin){ if(both) t.push(["head","Manage"]); t.push(["ops", me.tracked ? "Team today" : "Today"],["schedule","Schedule"],["reports","Reports"],["people","People"]); }
  if(me){ if(both) t.push(["head","Account"]); t.push(["account","Account"]); }
  return t;
}
function renderTabs(){
  const t = tabsFor();
  if(!tab || !t.some(x=>x[0]===tab)) tab = t.find(x=>x[0]!=="head")?.[0];
  $("#tabs").innerHTML = t.map(([k,l]) => k==="head" ? `<div class="side-head">${l}</div>` :
    `<button role="tab" aria-selected="${tab===k}" data-t="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[TAB_ICON[k]||k]||""}</svg><span>${l}</span></button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(x => x.onclick = () => setTab(x.dataset.t));
}
const PAGES = {
  today:["Today","Check in, take breaks and see who is available."], month:["My month","Your points and your schedule."],
  ops:["Today","Who is here, live status and overtime requests."], schedule:["Schedule","Shifts, work location and excused days."],
  reports:["Reports","Points, adherence, the Excel report and the activity log."], people:["People","Employees and the team rules."],
  account:["Account","Your profile, how it works and help."] };
/* A page made of sub-sections (pill row on top). subs() returns [[key, label, view], ...]. */
function sectionsView(subs){
  return {
    sub:null, cur:null,
    mount(el){
      this.el = el; const list = subs();
      if(!list.some(s => s[0] === this.sub)) this.sub = list[0][0];
      el.innerHTML = `${list.length > 1 ? `<div class="seg set-tabs" data-subs>${list.map(([k,l]) => `<button type="button" class="seg-b ${k===this.sub?"on":""}" data-v="${k}">${l}</button>`).join("")}</div>` : ""}<div id="subBody"></div>`;
      el.querySelectorAll("[data-subs] .seg-b").forEach(b => b.onclick = () => { this.sub = b.dataset.v; this.mount(el); replay($("#subBody"), "pg-in"); countUp($("#subBody")); });
      this.cur = list.find(s => s[0] === this.sub)[2]; this.cur.mount($("#subBody"));
    },
    update(){ if(this.cur && this.cur.update) this.cur.update(); }
  };
}
function goTo(t, sub){ if(sub && views[t]) views[t].sub = sub; setTab(t); }
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function replay(el, cls){ if(!el || reduceMotion()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function countUp(root){
  if(reduceMotion()) return;
  root.querySelectorAll(".tally .n, .ms-stat .n, .sk-n").forEach(el => {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && /^\s*\d+(\.\d+)?%?\s*$/.test(n.textContent)); if(!node) return;
    const txt = node.textContent.trim(), pct = txt.endsWith("%"), to = parseFloat(txt), dec = (txt.split(".")[1]||"").replace("%","").length;
    if(!to) return; const t0 = performance.now(), dur = 600;
    const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); node.textContent = (to * e).toFixed(dec) + (pct ? "%" : ""); if(p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function setTab(t){
  closeDayEditor(); tab = t; renderTabs(); paintSideShift();
  const p = PAGES[t] || ["",""], lbl = tabsFor().find(x => x[0] === t);
  $("#pgTitle").textContent = lbl ? lbl[1] : p[0]; $("#pgSub").textContent = p[1];
  views[tab].mount($("#main")); window.scrollTo(0,0);
  replay($("#main"), "pg-in"); replay($(".pagehead"), "pg-in"); countUp($("#main"));
}
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
  for(const r of live){ if(r.avatar_url) photos[r.employee_id] = r.avatar_url; else delete photos[r.employee_id]; }
  if(["today","ops"].includes(tab)) update();
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
  if(mineRow){ const st = liveState(mineRow); if(st.s==="over") msgs.push(`You are ${Math.floor((st.el-st.allowed)/60)} min over your break. End it from the Today tab.`); }
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
let boardPrev = {};
/* The live board: counts plus one card per person. Paints into #lvBody, shown on both Today pages. */
function paintBoard(){
    if(!$("#lvBody") || !liveLoaded) return;
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
        return `<div class="pcard st-${c}" data-eid="${r.employee_id}" data-st="${st.s}" ${st.s==="break"||st.s==="over" ? "data-bwrap" : ""}>
          <div class="pc-top"><span class="avn">${avatar(r.name, r.employee_id)}<b>${esc(r.name)}${r.employee_id===me.id?" <span class='muted small'>(you)</span>":""}</b></span><span class="pill p-${c}">${t}</span></div>
          ${r.title ? `<div class="pc-title">${esc(r.title)}</div>` : ""}
          <div class="small muted">${r.is_off && !r.check_in ? "No shift today" : `Shift ${short(r.shift_start)} to ${short(r.shift_end)}`}${me.is_admin && r.check_in && !r.check_out ? `, ${r.mode==="remote"?"remote":"office"} since ${tstr(r.check_in)}` : ""}</div>
          ${st.s==="break"||st.s==="over" ? `<div class="pc-timer">${breakName(r)}, ${timerSpan(r)}</div>` : ""}
          ${st.s==="busy" ? `<div class="pc-timer">${breakName(r)} for ${timerSpan(r)}</div>` : ""}
          ${me.is_admin && r.check_out && !r.auto_out && (pHM(short(r.shift_end)) - mins(ts(r.check_out))) > S.early_leave_min ? `<div class="flag-red">Left early, ${fmtMin(pHM(short(r.shift_end)) - mins(ts(r.check_out)))} before ${short(r.shift_end)}</div>` : ""}
          ${r.check_in && !r.check_out ? breaksLeftHtml(left) : ""}
        </div>`; }).join("")}</div>`;
    tickBreaks();
    const prev = boardPrev; boardPrev = {};
    document.querySelectorAll("#lvBody .pcard").forEach(c => { boardPrev[c.dataset.eid] = c.dataset.st; if(prev[c.dataset.eid] && prev[c.dataset.eid] !== c.dataset.st) replay(c, "changed"); });
}

/* Break and status picker (only shown while available). Running breaks are handled in the Today hero. */
function breakCards(){
  if(!liveLoaded) return `<section class="panel"><h2>Status</h2><p class="muted">Loading</p></section>`;
  const mineRow = live.find(r => r.employee_id === me.id);
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
function timelinePanel({ sf, start, end, rec, nowM, ot, opens, open }){
  const office = (rec ? rec.mode : sf.mode) === "office";
  const extra = ot && ot.status!=="rejected" ? ot.minutes : 0;
  const ev = [];
  ev.push({ t:opens, title:"Check-in opens", sub: office && S.early_max >= S.checkin_open_min ? `Check in by ${hm(start-S.early_min)} for an early credit` : "" });
  if(office && S.early_max < S.checkin_open_min) ev.push({ t:start-S.early_max, title:"Early credit window", sub:`Until ${hm(start-S.early_min)}` });
  ev.push({ t:start, title:"Shift starts", sub:"Check in by now to be on time", key:true });
  ev.push({ t:start+S.grace_min, title:"Late from here", sub:`${S.late_allowance} late days a month are allowed up to ${S.late_hard_min} min. Over ${S.late_hard_min} min is red, over ${fmtMin(S.late_black_min)} is black.`, warn:true });
  if(S.break_edge_min > 0){ ev.push({ t:start+S.break_edge_min, title:"Breaks open" }); ev.push({ t:end-S.break_edge_min, title:"Breaks close" }); }
  ev.push({ t:end, title:"Shift ends", sub: extra ? `Overtime ${ot.status} until ${hm(end+extra)}` : `Automatic check-out at ${hm(end+1)}`, key:true });
  if(rec) ev.push({ t:mins(ts(rec.check_in)), title:"You checked in", you:true, sub:`${rec.mode==="remote"?"Remote":"Office"}${rec.in_dist!=null?`, ${rec.in_dist} m from the office`:""}` });
  if(rec && rec.check_out) ev.push({ t:mins(ts(rec.check_out)), title: rec.auto_out ? "Checked out automatically" : "You checked out", you:true });
  if(!(rec && rec.check_out) && nowM >= opens - 60 && nowM <= end + extra + 60) ev.push({ t:nowM, title:"Now", now:true });
  ev.sort((a,b) => a.t - b.t || (a.now ? 1 : 0) - (b.now ? 1 : 0));
  return `<details class="panel fold" id="tlFold" ${open ? "open" : ""}><summary><h2>Today's timeline</h2><span class="small muted">${sf.planned ? "From this month's schedule" : "Default shift"}, UAE time</span></summary>
    <ol class="tl">${ev.map(e => `<li class="${e.now?"now":""} ${e.you?"you":""} ${e.key?"key":""} ${e.warn?"warn":""} ${!e.now && e.t <= nowM ? "past" : ""}"><span class="tl-t">${hm(Math.max(0,e.t))}</span><span class="tl-d"></span><span class="tl-b"><b>${e.title}</b>${e.sub?`<span>${esc(e.sub)}</span>`:""}</span></li>`).join("")}</ol></details>`;
}
/* Employee home: check in, status and the live board on one page. */
views.today = {
  picker:false, tlOpen:false,
  mount(el){ this.el = el; this.picker = false; refreshLive(); this.update(); },
  update(){
    if(tab!=="today" || !me) return;
    const t = now(), k = dkey(t), nowM = mins(t);
    if(mine.ym !== ymOf(k)){ loadMine(ymOf(k)).then(()=>this.update()); }
    const sf = shiftFor(me, k, mine.sched), sh = sf.sh, start = pHM(sh.start), end = pHM(sh.end);
    const rec = mine.att[`${me.id}|${k}`];
    const sum = summarize(me, ymOf(k), mine.att, mine.sched, mine.adj);
    const st = dayFrom(sum, k, dayStatus(me, k, rec, mine.sched));
    const opens = start - S.checkin_open_min;
    const ot = (mine.ot||[]).filter(o => o.day === k).sort((a,b)=>b.id-a.id)[0];
    const mineRow = live.find(r => r.employee_id === me.id), ls = rec && !rec.check_out && mineRow ? liveState(mineRow) : null;
    const away = !!ls && ["break","over","busy"].includes(ls.s);
    let state, buttons = "", over = false;
    if(st.s==="excused" && !rec){ state = `<b>Excused today.</b> ${st.reason?`<span class="muted">${esc(st.reason)}</span>`:""}`; }
    else if(sf.off && !rec){ state = `<b>Day off.</b> <span class="muted">No shift scheduled today.</span>`; }
    else if(!rec){
      if(nowM < opens){ state = `<b>Check-in opens at ${hm(opens)}.</b> <span class="muted">${S.checkin_open_min} minutes before your shift.</span>`; buttons = `<button class="btn big" disabled>Opens at ${hm(opens)}</button>`; }
      else if(nowM >= end){ state = `<b>Your shift has ended.</b> <span class="muted">No check-in was recorded today.</span>`; }
      else { state = `<b>Not checked in.</b> <span class="muted">Shift starts ${esc(sh.start)}.${sf.mode==="office" ? ` You need to be within ${S.radius_m} m of the office.` : ""}</span>`;
        buttons = `<button class="btn primary big" id="bIn">${sf.mode==="office" ? "Check in at the office" : "Check in remotely"}</button>`; }
    } else if(!rec.check_out){
      const out = `<button class="btn" id="bOut">Check out</button>`;
      if(away){
        const busy = ls.s==="busy"; over = ls.s==="over";
        state = `<b>${esc(breakName(mineRow))}</b> <span class="muted">since ${tstr(mineRow.break_started)}</span><div class="brk-time" ${busy ? `data-bup="${Date.parse(mineRow.break_started)}"` : `data-bstart="${Date.parse(mineRow.break_started)}" data-ballow="${mineRow.break_allowed}"`}></div>`;
        buttons = `<button class="btn primary big" id="bEnd">Back to available</button>${out}`;
      } else {
        state = `<b>Checked in at ${tstr(rec.check_in)}.</b> ${chip(st)}`;
        buttons = `<button class="btn primary big" id="bPick" aria-expanded="${this.picker}">${this.picker ? "Hide breaks" : "Break or status"}</button>${out}`;
      }
    } else state = `<b>Done for today.</b> <span class="muted">${tstr(rec.check_in)} to ${tstr(rec.check_out)}${rec.auto_out?" (automatic check-out)":""}</span> ${chip(st)}`;
    const otPanel = rec && !rec.check_out ? `<section class="panel"><div class="shift-head"><h2 style="margin:0">Extend shift</h2>${ot ? `<span class="chip c-${ot.status==="approved"?"early":ot.status==="rejected"?"late":"pending"}">${ot.minutes} min, ${ot.status}</span>` : ""}</div>
      ${ot && ot.status==="pending" ? `<p class="small muted" style="margin:0">Waiting for a manager. Your automatic check-out waits until ${hm(end + ot.minutes + 1)}.</p>`
      : ot && ot.status==="approved" ? `<p class="small muted" style="margin:0">Approved by ${esc(ot.decided_by||"a manager")}. Automatic check-out moves to ${hm(end + ot.minutes + 1)}.</p>`
      : `<div class="ot-row"><select class="inl" id="otMin">${[30,60,90,120].map(m=>`<option value="${m}">${fmtMin(m)}</option>`).join("")}</select><input class="inl" id="otWhy" maxlength="120" placeholder="Reason, for example a long customer case"><button class="btn" id="otGo">Request</button></div>
         <p class="hint">Working past ${esc(sh.end)}? Ask before your shift ends. Without approval you are checked out automatically at ${hm(end+1)}.</p>`}</section>` : "";
    // keep what the person is typing across the 15 second refresh
    const keep = { why: $("#otWhy")?.value || "", min: $("#otMin")?.value || "" };
    const adh = adherenceFor(me, ymOf(k), mine.att, mine.sched, mine.brk);
    this.el.innerHTML = `
      <section class="hero ${over ? "is-over" : ""}" ${away && ls.s!=="busy" ? "data-bwrap" : ""}>
        <div class="hero-l">
          <div class="date">${esc(longDate(k))}</div>
          <div class="time" id="clk">--:--:--</div>
          <div class="hero-meta">${sf.off && !rec ? "" : `Shift ${esc(sh.start)} to ${esc(sh.end)} ${modeChip(rec ? rec.mode : sf.mode)}`}</div>
          ${sf.off && !rec ? "" : `<div class="shiftcd" data-sstart="${start}" data-send="${end + (ot && ot.status==="approved" ? ot.minutes : 0)}"><div class="cd-row"><span class="cd-txt"></span><span class="cd-pct"></span></div><div class="cd-bar"><i></i></div></div>`}
        </div>
        <div class="hero-r"><div class="state">${state}</div><div class="hero-btn">${buttons}</div></div>
      </section>
      ${this.picker && rec && !rec.check_out && !away ? breakCards() : ""}
      ${otPanel}
      <section class="panel today-month"><div><b>${esc(monthLabel(ymOf(k)))}:</b> ${sum.red} red, ${sum.black} black, adherence ${adhText(adh)}, ${streakFor(me, mine.att, mine.sched)}-day on-time streak</div><button class="btn small" id="tmMore">My month</button></section>
      <h2 class="sec-h">Team right now</h2>
      <div id="lvBody"><p class="muted">Loading</p></div>
      ${sf.off && !rec ? "" : timelinePanel({ sf, start, end, rec, nowM, ot, opens, open:this.tlOpen })}`;
    if($("#otWhy")){ $("#otWhy").value = keep.why; if(keep.min) $("#otMin").value = keep.min; }
    tick(); paintBoard();
    const fold = $("#tlFold"); if(fold) fold.ontoggle = () => { this.tlOpen = fold.open; };
    const bi = $("#bIn"), bo = $("#bOut"), og = $("#otGo"), bp = $("#bPick"), be = $("#bEnd");
    if(bi) bi.onclick = () => punch("in", sf.mode, bi);
    if(bo) bo.onclick = () => punch("out", rec.mode, bo);
    if(bp) bp.onclick = () => { this.picker = !this.picker; this.update(); };
    if(be) be.onclick = () => breakAction("end_break", {}, be);
    $("#tmMore").onclick = () => goTo("month", "points");
    const on = (id, kind) => { const b = $(id); if(b) b.onclick = () => { this.picker = false; breakAction("start_break", { p_kind:kind }, b); }; };
    on("#bShort","short"); on("#bLong","long"); on("#bWc","wc"); on("#bMeet","meeting"); on("#bTask","task");
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

/* ---------- my points ---------- */
views.mine = {
  ym:null,
  mount(el){
    this.el = el; this.ym = this.ym || ymOf(dkey(now()));
    el.innerHTML = `<div class="panel" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;justify-content:space-between"><label class="f" style="min-width:200px">Month<select id="mSel">${lastMonths(12).map(m=>`<option value="${m}" ${m===this.ym?"selected":""}>${esc(monthLabel(m))}</option>`).join("")}</select></label><button class="btn" id="mCsv">Export CSV</button></div><div id="mBody"><p class="muted">Loading</p></div>`;
    $("#mSel").onchange = async e => { this.ym = e.target.value; await loadMine(this.ym); this.update(); };
    $("#mCsv").onclick = () => exportTableCsv($("#mBody table"), `My-points-${this.ym}`);
    loadMine(this.ym).then(()=>this.update());
  },
  update(){
    if(!$("#mBody") || mine.ym!==this.ym) return;
    const s = summarize(me, this.ym, mine.att, mine.sched, mine.adj);
    const rows = s.rows.slice().reverse();
    $("#mBody").innerHTML = `
      <div class="panel"><div class="tally">
        <div class="t-g"><div class="n">${s.early}</div><div class="l">Early credits</div></div>
        <div class="t-r"><div class="n">${s.red}</div><div class="l">Red</div></div>
        <div class="t-b"><div class="n">${s.black}</div><div class="l">Black</div></div>
        <div class="t-a"><div class="n">${s.penalties}</div><div class="l muted">Total penalties</div></div>
        ${(a => `<div class="t-adh ${adhClass(a?.pct)}"><div class="n">${adhText(a)}</div><div class="l">Adherence, target ${S.adherence_target}%</div></div>`)(adherenceFor(me, this.ym, mine.att, mine.sched, this.ym===ymOf(dkey(now())) ? mine.brk : []))}
      </div><p class="hint">Adherence is the share of your scheduled time you were on schedule: late minutes, leaving early, absences and minutes over a break count against it. Breaks within their time, meetings and tasks count as on schedule. ${s.office} office day(s), ${s.remote} remote day(s). ${s.allowed ? `${s.allowed} allowed late day(s) used. ` : ""}${s.cleared ? `${s.cleared} red point(s) cleared by early credits. ` : ""}${s.toNext ? `${s.toNext} more early office day(s) clears the next red.` : s.red && !s.clearsLeft ? "No early-credit clears left this month." : ""}</p></div>
      ${this.ym===ymOf(dkey(now())) ? streakPanel(streakFor(me, mine.att, mine.sched)) : ""}
      ${mine.adj.length ? `<div class="panel"><h2>Manager adjustments</h2>${mine.adj.map(a=>`<div class="item"><span>${a.delta>0?"+1":"-1"} ${esc(a.type)}</span><span class="muted small">${esc(a.reason)}</span></div>`).join("")}</div>` : ""}
      <div class="panel scroll">${rows.length ? `<table class="rows"><thead><tr><th>Date</th><th>Where</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>
        ${rows.map(r=>{ const d = mine.att[`${me.id}|${r.k}`]; return `<tr><td>${esc(prettyDate(r.k))}</td><td class="small">${d ? (d.mode==="remote"?"Remote":"Office") : ""}</td><td>${tstr(d?.check_in)}</td><td>${tstr(d?.check_out)}${d?.auto_out?' <span class="chip c-off">Auto</span>':""}</td><td>${chip(r)}</td></tr>`; }).join("")}
      </tbody></table>` : `<p class="empty">No working days recorded for this month yet.</p>`}</div>`;
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
    for(const r of ex.data||[]){ this.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; this.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
  },
  render(){
    if(!$("#msBody")) return;
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
            return `<div class="${cls}"><div class="cal-n">${+k.slice(8)}${dot}</div>${exc !== undefined ? `<div class="cal-exc lv-${this.sched[`XT|${me.id}|${k}`]||"excused"}" title="${esc(exc)}">${(LEAVE[this.sched[`XT|${me.id}|${k}`]||"excused"])[0]}</div>` : x.off ? `<div class="cal-off">Off</div>` : `<div class="cal-pill ${tone(x.id)}"><span>${x.sh.start}</span><span class="to">${x.sh.end}</span></div>${shiftFor(me,k,this.sched).mode==="remote" ? '<div class="cal-mode">Remote</div>' : ""}`}</div>`; }).join("")}
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


views.month = sectionsView(() => [["points","Points",views.mine],["schedule","Schedule",views.myschedule]]);
/* ---------- admin: team today ---------- */
/* ---------- manager home: needs attention, live board, today's check-ins ---------- */
function attentionItems(k){
  const items = [];
  const issues = checkSchedule(ymOf(k), team.sched).issues.length;
  if(issues) items.push({ text:`${issues} schedule rule problem${issues>1?"s":""} this month`, go:"Open schedule", to:["schedule"] });
  const noMail = emps.filter(e => e.active && (e.tracked || e.scheduled) && !e.email).length;
  if(noMail) items.push({ text:`${noMail} ${noMail>1?"people have":"person has"} no email and cannot sign in`, go:"Open people", to:["people","staff"] });
  const review = tracked().filter(e => summarize(e, ymOf(k), team.att, team.sched, team.adj).penalties >= S.review_threshold).length;
  if(review) items.push({ text:`${review} employee${review>1?"s":""} reached ${S.review_threshold}+ penalties and need review`, go:"Open reports", to:["reports","points"] });
  return items;
}
views.ops = {
  mount(el){
    this.el = el;
    el.innerHTML = `<div id="opsAttn"></div>
      <div class="sec-row"><h2 class="sec-h">Live board</h2><button class="btn small" id="tRef">Refresh</button></div>
      <div id="lvBody"><p class="muted">Loading</p></div>
      <div class="sec-row"><h2 class="sec-h">Check-ins today</h2><button class="btn small" id="tCsv">Export CSV</button></div>
      <div id="tBody"><p class="muted">Loading</p></div>`;
    $("#tRef").onclick = () => { loadTeam(ymOf(dkey(now()))); refreshLive(); };
    $("#tCsv").onclick = () => exportTableCsv($("#tBody table"), `Attendance-${dkey(now())}`);
    refreshLive(); loadTeam(ymOf(dkey(now())));
  },
  update(){
    if(tab!=="ops") return;
    paintBoard();
    const k = dkey(now()), list = tracked();
    if(team.loading || team.ym !== ymOf(k)){ if(!team.ym) $("#tBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    this.attention(k);
    if(!list.length){ $("#tBody").innerHTML = `<div class="panel"><p class="empty">No tracked employees. Add them in People.</p></div>`; return; }
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
      return `<tr><td>${avatarName(e.name, e.id)}</td><td class="small">${sh.off ? "Off" : `${esc(sh.sh.start)} to ${esc(sh.sh.end)}`}</td><td>${sh.off && !rec ? "" : modeChip(rec ? rec.mode : sh.mode)}</td><td>${tstr(rec?.check_in)}</td><td>${tstr(rec?.check_out)}${rec?.auto_out?' <span class="chip c-off">Auto</span>':""}</td><td>${chip(st)}${le?`<div class="flag-red">Left early, ${fmtMin(le)}</div>`:""}${flags.length?`<div class="flag">${esc(flags.join(", "))}</div>`:""}</td></tr>`;
    }).join("");
    $("#tBody").innerHTML = `
      <div class="panel"><div class="tally">
        <div class="t-a"><div class="n">${off}</div><div class="l muted">At the office</div></div>
        <div class="t-a"><div class="n">${rem}</div><div class="l muted">Remote</div></div>
        <div class="t-r"><div class="n">${late}</div><div class="l">Late</div></div>
        <div class="t-b"><div class="n">${abs}</div><div class="l">Absent</div></div>
        <div class="t-a"><div class="n">${early}</div><div class="l muted">Left early</div></div>
      </div></div>
      <div class="panel scroll"><table class="rows"><thead><tr><th>Employee</th><th>Shift</th><th>Where</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  },
  attention(k){
    const pend = (team.ot||[]).filter(o => o.status==="pending"), items = attentionItems(k);
    const byId = Object.fromEntries(emps.map(e=>[e.id,e.name]));
    $("#opsAttn").innerHTML = pend.length || items.length ? `<div class="panel ot-req"><h2>Needs attention</h2>
      ${pend.map(o=>`<div class="item"><div>${avatarName(byId[o.employee_id]||"", o.employee_id)}<div class="small muted" style="margin-left:40px">Overtime: ${esc(prettyDate(o.day))}, ${fmtMin(o.minutes)} after shift end${o.reason?`. ${esc(o.reason)}`:""}</div></div><div style="display:flex;gap:8px"><button class="btn ok" data-ot="${o.id}" data-ap="1">Approve</button><button class="btn no" data-ot="${o.id}" data-ap="0">Reject</button></div></div>`).join("")}
      ${items.map((x,i)=>`<div class="item"><span>${esc(x.text)}</span><button class="btn small" data-go="${i}">${x.go}</button></div>`).join("")}</div>` : "";
    $("#opsAttn").querySelectorAll("[data-go]").forEach(b => b.onclick = () => goTo(...items[+b.dataset.go].to));
    $("#opsAttn").querySelectorAll("[data-ot]").forEach(b => b.onclick = async () => {
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
        <div style="display:flex;gap:8px"><button class="btn" id="rRef">Refresh</button><button class="btn" id="rCsv">Export CSV</button><button class="btn primary" id="rXlsx">Download full report</button></div>
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
    $("#rXlsx").onclick = () => reportDialog();
    $("#rCsv").onclick = () => exportTableCsv($("#rBody table"), `Points-${this.ym}`);
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
    if(!$("#rBody")) return;
    if(team.loading || team.ym !== this.ym){ $("#rBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    const otMin = id => (team.ot||[]).filter(o => o.employee_id===id && o.status==="approved" && o.day.startsWith(this.ym)).reduce((a,o)=>a+o.minutes,0);
    this.rows = tracked().map(e => { const s = summarize(e, this.ym, team.att, team.sched, team.adj); s.ot = otMin(e.id); s.review = s.penalties >= S.review_threshold; s.streak = streakFor(e, team.att, team.sched); s.adh = adherenceFor(e, this.ym, team.att, team.sched, team.brk); return { e, s }; });
    const nReview = this.rows.filter(r=>r.s.review).length;
    $("#rBody").innerHTML = this.rows.length ? `${nReview ? `<div class="alertbar soft">${nReview} employee(s) reached ${S.review_threshold} or more penalties this month and need review.</div>` : ""}<div class="panel scroll"><table class="rows report"><thead><tr><th>Employee</th><th class="num">Office</th><th class="num">Remote</th><th class="num">Early</th><th class="num">Late</th><th class="num">Allowed</th><th class="num">Absent</th><th>Leave</th><th class="num">Left early</th><th class="num">Overtime</th><th class="num">Cleared</th><th class="num">Red</th><th class="num">Black</th><th class="num">Penalties</th><th class="num">Adherence</th><th class="num">Streak</th></tr></thead><tbody>
      ${this.rows.map(({e,s})=>`<tr class="${s.review?"review":""}"><td>${avatarName(e.name, e.id)}${s.review?' <span class="chip c-late">Needs review</span>':""}</td><td class="num">${s.office}</td><td class="num">${s.remote}</td><td class="num">${s.early}</td><td class="num">${s.late}</td><td class="num">${s.allowed}</td><td class="num">${s.absent}</td><td class="nowrap">${LEAVE_ORDER.filter(t=>s.lv?.[t]).map(t=>`<span class="lv-tag lv-${t}" title="${LEAVE[t][0]}">${LEAVE[t][1]} ${s.lv[t]}</span>`).join(" ") || '<span class="muted">0</span>'}</td><td class="num">${s.leftEarly||0}</td><td class="num">${s.ot?fmtMin(s.ot):"0"}</td><td class="num">${s.cleared}</td><td class="num">${s.red}</td><td class="num">${s.black}</td><td class="num"><b>${s.penalties}</b></td><td class="num"><span class="adh ${adhClass(s.adh?.pct)}">${adhText(s.adh)}</span></td><td class="num">${s.streak}${s.streak>=STREAK_GOAL?" ★":""}</td></tr>`).join("")}
      </tbody></table><p class="hint">Up to ${S.late_allowance} late days of ${S.late_hard_min} minutes or less are allowed each month. Later than ${S.late_hard_min} minutes is always red, later than ${fmtMin(S.late_black_min)} is black. Every ${S.early_per_clear} early office days clear 1 red, up to ${S.max_clears} times a month. ${S.review_threshold}+ penalties marks Needs review. Adherence target is ${S.adherence_target}%. Left early and overtime are for managers only. Counts reset on the 1st.</p></div>` : `<div class="panel"><p class="empty">No tracked employees.</p></div>`;
    const byId = Object.fromEntries(emps.map(e=>[e.id,e.name]));
    $("#rAdj").innerHTML = team.adj.length ? team.adj.map(a=>`<div class="item"><span><b>${esc(byId[a.employee_id]||"")}</b> ${a.delta>0?"+1":"-1"} ${esc(a.type)}</span><span class="small muted">${esc(a.reason)}</span><button class="btn small" data-del="${a.id}">Delete</button></div>`).join("") : `<p class="empty">No adjustments.</p>`;
    $("#rAdj").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      b.disabled = true; const { error } = await sb.from("adjustments").delete().eq("id", b.dataset.del);
      if(error){ toast(errMsg(error)); b.disabled = false; return; } toast("Adjustment deleted"); loadTeam(this.ym);
    });
  },

};

/* ---------- admin: activity log ---------- */
views.audit = {
  rows:[],
  async mount(el){
    this.el = el;
    el.innerHTML = `<div class="panel" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;justify-content:space-between">
      <label class="f" style="flex:1;min-width:220px">Search<input id="auQ" placeholder="Manager, employee, action or details"></label>
      <div style="display:flex;gap:8px"><button class="btn" id="auRef">Refresh</button><button class="btn" id="auCsv">Export CSV</button></div></div><div id="auBody"><p class="muted">Loading</p></div>`;
    $("#auQ").oninput = () => this.update();
    $("#auRef").onclick = () => this.load();
    $("#auCsv").onclick = () => exportTableCsv($("#auBody table"), "Activity-log");
    this.load();
  },
  async load(){
    const { data, error } = await sb.from("audit_log").select("*").order("at",{ascending:false}).limit(500);
    if(error){ toast(errMsg(error)); return; }
    this.rows = data || []; this.update();
  },
  update(){
    if(!$("#auBody")) return;
    const q = ($("#auQ").value||"").toLowerCase();
    const rows = this.rows.filter(r => !q || [r.actor_name,r.actor_email,r.action,r.target,r.details].join(" ").toLowerCase().includes(q));
    $("#auBody").innerHTML = rows.length ? `<div class="panel scroll"><table class="rows audit"><thead><tr><th>Date</th><th>Time</th><th>By</th><th>Action</th><th>Employee</th><th>Details</th></tr></thead><tbody>
      ${rows.map(r=>{ const t = Date.parse(r.at); return `<tr><td class="nowrap">${esc(prettyDate(dkey(t)))}</td><td class="nowrap">${tstr(r.at)}</td><td><b>${esc(r.actor_name)}</b>${r.actor_email?`<div class="small muted">${esc(r.actor_email)}</div>`:""}</td><td class="nowrap">${esc(r.action)}</td><td class="nowrap">${esc(r.target||"")}</td><td class="small">${esc(r.details||"")}</td></tr>`; }).join("")}
      </tbody></table><p class="hint">Showing the latest ${rows.length} change(s). Every schedule, excuse, points, employee and settings change is recorded with who made it.</p></div>` : `<div class="panel"><p class="empty">${q ? "No matches." : "No changes recorded yet."}</p></div>`;
  }
};


views.reports = sectionsView(() => [["points","Points",views.points],["log","Activity log",views.audit]]);
/* ---------- management report (Excel) ---------- */
let excelLib = null;
function loadExcel(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return excelLib ||= new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"; sc.onload = () => res(window.ExcelJS); sc.onerror = () => { excelLib = null; rej(new Error("Could not load the Excel library. Check your connection.")); }; document.head.appendChild(sc); });
}
function reportDialog(){
  const dlg = $("#repDlg"), t = dkey(now()), [y, m] = t.split("-").map(Number);
  const wd = (wdOf(t) + 6) % 7, mon = new Date(Date.parse(t+"T12:00:00Z") - wd*864e5).toISOString().slice(0,10), sun = new Date(Date.parse(mon+"T12:00:00Z") + 6*864e5).toISOString().slice(0,10);
  const P = { week:[mon, sun, "This week"], month:[`${t.slice(0,7)}-01`, monthEnd(t.slice(0,7)), monthLabel(t.slice(0,7))], year:[`${y}-01-01`, `${y}-12-31`, String(y)] };
  let pick = "month";
  dlg.innerHTML = `<form method="dialog" class="dlg-x"><button class="btn small" aria-label="Close">Close</button></form>
    <h2>Download full report</h2><p class="small muted" style="margin:-8px 0 14px">Excel workbook with every detail for each person.</p>
    <div class="de-l">Period</div>
    <div class="seg" id="rpSeg"><button type="button" class="seg-b" data-v="week">This week</button><button type="button" class="seg-b on" data-v="month">This month</button><button type="button" class="seg-b" data-v="year">This year</button><button type="button" class="seg-b" data-v="custom">Custom dates</button></div>
    <div class="pl-dates" id="rpCustom" style="margin-top:12px;display:none"><label class="f">From<input type="date" class="inl" id="rpFrom" value="${P.month[0]}"></label><label class="f">To<input type="date" class="inl" id="rpTo" value="${t}"></label></div>
    <p class="hint" id="rpNote"></p>
    <div class="actions"><button class="btn" id="rpCancel">Cancel</button><button class="btn primary" id="rpGo">Download</button></div><p class="err" id="rpErr"></p>`;
  const note = () => { const [a, b] = pick==="custom" ? [$("#rpFrom").value, $("#rpTo").value] : P[pick]; $("#rpNote").textContent = a && b ? `${prettyDate(a)} ${a.slice(0,4)} to ${prettyDate(b)} ${b.slice(0,4)}. Days after today are left out.` : ""; };
  dlg.querySelectorAll("#rpSeg .seg-b").forEach(b => b.onclick = () => { dlg.querySelectorAll("#rpSeg .seg-b").forEach(x=>x.classList.remove("on")); b.classList.add("on"); pick = b.dataset.v; $("#rpCustom").style.display = pick==="custom" ? "flex" : "none"; note(); });
  $("#rpFrom").onchange = note; $("#rpTo").onchange = note; note();
  $("#rpCancel").onclick = () => dlg.close();
  $("#rpGo").onclick = async () => {
    let [a, b, label] = pick==="custom" ? [$("#rpFrom").value, $("#rpTo").value, null] : P[pick];
    if(!a || !b || b < a){ $("#rpErr").textContent = "Pick a valid date range."; return; }
    if(Date.parse(b) - Date.parse(a) > 400*864e5){ $("#rpErr").textContent = "Pick up to about one year."; return; }
    label = label || `${prettyDate(a)} ${a.slice(0,4)} to ${prettyDate(b)} ${b.slice(0,4)}`;
    await exportReport(a, b, label, $("#rpGo")); dlg.close();
  };
  dlg.showModal();
}
async function fetchAll(make){
  const out = []; for(let from = 0; ; from += 1000){ const { data, error } = await make().range(from, from + 999); if(error) throw error; out.push(...(data||[])); if(!data || data.length < 1000) break; } return out;
}
async function loadRange(a, b){
  const ma = `${a.slice(0,7)}-01`, mb = monthEnd(b.slice(0,7)), hist = histStart(a.slice(0,7));
  const months = []; for(let k = ma; k <= mb; ){ months.push(k.slice(0,7)); const [y, m] = k.split("-").map(Number); k = new Date(Date.UTC(y, m, 1)).toISOString().slice(0,10); }
  const [att, sc, ex, adj, ot, brk] = await Promise.all([
    fetchAll(() => sb.from("attendance").select("*").gte("day", hist).lte("day", mb).order("day")),
    fetchAll(() => sb.from("schedule").select("*").gte("day", hist).lte("day", mb).order("day")),
    fetchAll(() => sb.from("excused").select("*").gte("day", hist).lte("day", mb).order("day")),
    fetchAll(() => sb.from("adjustments").select("*").in("month", months).order("created_at")),
    fetchAll(() => sb.from("overtime").select("*").gte("day", a).lte("day", b).order("day")),
    fetchAll(() => sb.from("breaks").select("*").gte("day", a).lte("day", b).order("started_at"))
  ]);
  const d = { months, att:toMap(att, r=>r), sched:toMap(sc, r=>r.shift_id), adj, ot, brk };
  for(const r of sc) if(r.work_mode) d.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex){ d.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; d.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
  return d;
}
async function exportReport(from, to, periodLabel, btn){
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Building report";
  try{
    const XL = await loadExcel();
    const D = await loadRange(from, to);
    const wb = new XL.Workbook(); wb.creator = me.name; wb.created = new Date();
    const FONT = { name:"Arial", size:10 }, HEAD = { name:"Arial", size:10, bold:true, color:{ argb:"FFFFFFFF" } };
    const fill = c => ({ type:"pattern", pattern:"solid", fgColor:{ argb:c } });
    const thin = { style:"thin", color:{ argb:"FFD9DDE3" } }, border = { top:thin, bottom:thin, left:thin, right:thin };
    const firstData = Object.values(D.att).map(r => r.day).sort()[0] || from, start = from > firstData ? from : firstData;
    const today = dkey(now()), keys = rangeKeys(start, to < today ? to : today), allKeys = rangeKeys(start, to);
    D.months = D.months.filter(ym => ym >= start.slice(0,7));
    const people = schedPeople(), agents = people.filter(e => e.tracked);
    const R = RULES(), RN = { senior:"Senior cover", pair:"Not remote together", night:"Morning office cover", consecutive:"No remote days in a row" };
    const accessOf = e => e.is_admin ? "Full access" : "Member access";
    const mins2 = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : 0;
    const allowedOf = k => k==="short" ? S.break_short_min : k==="long" ? S.break_long_min : k==="wc" ? S.break_wc_min : null;
    const brkOf = (eid, k) => D.brk.filter(b => b.employee_id===eid && b.day===k);
    const STATUS_TXT = { early:"Early credit", ontime:"On time", grace:"Late, within grace", late:"Late", remote:"Remote, on time", remotegrace:"Remote, within grace", remotelate:"Remote, late", absent:"Absent", off:"Day off", pending:"Not checked in yet", excused:"Leave", na:"Before start date", future:"Upcoming" };
    const monthSum = {}; for(const ym of D.months) for(const e of agents) monthSum[`${e.id}|${ym}`] = summarize(e, ym, D.att, D.sched, D.adj);
    const dayRow = (e, k) => { const ms = monthSum[`${e.id}|${k.slice(0,7)}`]; return ms?.rows.find(r => r.k === k) || dayStatus(e, k, D.att[`${e.id}|${k}`], D.sched); };
    const sheet = (name, cols, title, xs = 1) => {
      const ws = wb.addWorksheet(name, { views:[{ state:"frozen", xSplit:xs, ySplit:3 }], pageSetup:{ orientation:"landscape", paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0 } });
      ws.columns = cols.map(([, w]) => ({ width:w }));
      ws.getCell("A1").value = title; ws.getCell("A1").font = { name:"Arial", size:14, bold:true };
      ws.getCell("A2").value = `Opus Support Attendance. Period: ${periodLabel}${start > from ? ` (data starts ${prettyDate(start)} ${start.slice(0,4)})` : ""}. Generated ${longDate(today)} ${tstr(new Date(now()).toISOString())} UAE by ${me.name}.`;
      ws.getCell("A2").font = { name:"Arial", size:9, italic:true, color:{ argb:"FF667085" } };
      const hr = ws.getRow(3); cols.forEach(([h], i) => { const c = hr.getCell(i+1); c.value = h; c.font = HEAD; c.fill = fill("FF111827"); c.alignment = { vertical:"middle", horizontal:"center", wrapText:true }; c.border = border; });
      hr.height = 34; ws.autoFilter = { from:{ row:3, column:1 }, to:{ row:3, column:cols.length } };
      return ws;
    };
    const addRow = (ws, vals, opts={}) => { const r = ws.addRow(vals); r.eachCell({ includeEmpty:true }, (c, i) => { c.font = { ...FONT, ...(opts.bold?{bold:true}:{}) }; c.border = border; c.alignment = { vertical:"middle", horizontal: i===1 || opts.leftCols?.includes(i) ? "left" : "center", wrapText:!!opts.wrap }; if(opts.zebra) c.fill = fill("FFF6F7F9"); }); return r; };
    const note = (ws, text, color = "FF667085") => { ws.addRow([]); const r = ws.addRow([text]); r.getCell(1).font = { name:"Arial", size:9, italic:true, color:{ argb:color } }; };

    // 1. Summary for the period
    const sumCols = [["Employee",24],["Title",20],["Access",14],["Email",28],["Usual shift",13],["Scheduled days",10],["Planned office",9],["Planned remote",9],["Worked office",9],["Worked remote",9],["On time",8],["Within grace",9],["Early credits",9],["Late",7],["Late, allowed",9],[`Late over ${S.late_hard_min} min`,10],["Absent",8],["Public holiday",9],["Paid leave",8],["Sick leave",8],["Half day",8],["Unpaid",8],["Excused",8],["Left early (days)",10],["Left early (min)",10],["Overtime approved (min)",11],["Breaks taken",9],["Over-break (times)",10],["Over-break (min)",10],["Meeting (min)",10],["Task (min)",10],["Red (before clears)",10],["Black",8],["Adherence",10],["On-time streak (now)",10]];
    const ws1 = sheet("Summary", sumCols, `Attendance summary, ${periodLabel}`);
    agents.forEach((e, idx) => {
      const c = { sched:0, po:0, pr:0, wo:0, wr:0, ontime:0, grace:0, early:0, late:0, allowed:0, hard:0, absent:0, lv:{}, le:0, leMin:0, ot:0, brk:0, overN:0, overMin:0, meet:0, task:0, red:0, black:0 };
      for(const k of allKeys){ const sf = shiftFor(e, k, D.sched); if(sf.off || D.sched[`X|${e.id}|${k}`] !== undefined) continue; if(e.since && k < e.since) continue; c.sched++; if(sf.mode==="remote") c.pr++; else c.po++; }
      for(const k of keys){
        const rec = D.att[`${e.id}|${k}`], st = dayRow(e, k);
        if(rec){ if(rec.mode==="remote") c.wr++; else c.wo++; }
        if(st.s==="ontime") c.ontime++; if(st.s==="grace"||st.s==="remotegrace") c.grace++; if(st.s==="early") c.early++;
        if(st.s==="late"||st.s==="remotelate"){ c.late++; if(st.allowed) c.allowed++; else if(st.severe==="black") c.black++; else c.red++; if(st.severe) c.hard++; }
        if(st.s==="absent"){ c.absent++; c.black++; }
        if(st.s==="excused") c.lv[st.lt] = (c.lv[st.lt]||0) + 1;
        const le = leftEarlyBy(e, k, rec, D.sched); if(le){ c.le++; c.leMin += le; }
        for(const b of brkOf(e.id, k)){ const d = mins2(b.started_at, b.ended_at || new Date(now()).toISOString()), al = allowedOf(b.kind); if(b.kind==="meeting") c.meet += d; else if(b.kind==="task") c.task += d; else { c.brk++; if(al && d > al){ c.overN++; c.overMin += d - al; } } }
      }
      c.ot = D.ot.filter(o=>o.employee_id===e.id && o.status==="approved").reduce((x,o)=>x+o.minutes,0);
      const adh = adherenceFor(e, null, D.att, D.sched, D.brk, keys), sh = shifts[e.shift_id];
      const row = addRow(ws1, [e.name, e.title||"", accessOf(e), e.email||"", sh?`${sh.start}–${sh.end}`:"", c.sched, c.po, c.pr, c.wo, c.wr, c.ontime, c.grace, c.early, c.late, c.allowed, c.hard, c.absent, c.lv.holiday||0, c.lv.paid||0, c.lv.sick||0, c.lv.half||0, c.lv.unpaid||0, c.lv.excused||0, c.le, c.leMin, c.ot, c.brk, c.overN, c.overMin, c.meet, c.task, c.red, c.black, adh ? adh.pct/100 : null, streakFor(e, D.att, D.sched)], { zebra: idx % 2 === 1, leftCols:[2,3,4] });
      row.getCell(34).numFmt = "0.0%";
      if(adh) row.getCell(34).font = { ...FONT, bold:true, color:{ argb: adh.pct >= S.adherence_target ? "FF12805C" : adh.pct >= S.adherence_target - 10 ? "FF946200" : "FFC2362B" } };
      if(c.red) row.getCell(32).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } };
    });
    note(ws1, `Planned = from the schedule for the whole period. Worked = actual check-ins up to today. Red is counted before monthly early-credit clears and adjustments; the Monthly points sheet has the official totals.`);

    // 2. Monthly points (official)
    const mpCols = [["Month",12],["Employee",24],["Early credits",9],["Late",7],["Late, allowed",9],["Absent",8],["Reds cleared",9],["Adjust red",8],["Adjust black",8],["Red",7],["Black",7],["Penalties",9],["Needs review",9],["Adherence",10]];
    const ws2 = sheet("Monthly points", mpCols, `Official monthly points, ${periodLabel}`, 2);
    let zi = 0;
    for(const ym of D.months) for(const e of agents){
      const s2 = monthSum[`${e.id}|${ym}`], adh = adherenceFor(e, ym, D.att, D.sched, D.brk);
      const aR = D.adj.filter(a=>a.employee_id===e.id && a.month===ym && a.type==="red").reduce((x,a)=>x+a.delta,0), aB = D.adj.filter(a=>a.employee_id===e.id && a.month===ym && a.type==="black").reduce((x,a)=>x+a.delta,0);
      const r = addRow(ws2, [monthLabel(ym), e.name, s2.early, s2.late, s2.allowed, s2.absent, s2.cleared, aR, aB, s2.red, s2.black, s2.penalties, s2.penalties >= S.review_threshold ? "Yes" : "No", adh ? adh.pct/100 : null], { zebra: zi++ % 2 === 1, leftCols:[2] });
      r.getCell(14).numFmt = "0.0%";
      if(s2.penalties >= S.review_threshold){ r.getCell(12).fill = fill("FFFDECEA"); [12,13].forEach(n => r.getCell(n).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } }); }
    }

    // 3. Daily log
    const logCols = [["Date",11],["Day",6],["Employee",24],["Scheduled shift",13],["Scheduled from",12],["Day type",14],["Leave note",22],["Checked in",10],["Checked out",10],["Worked from",11],["Distance from office (m)",12],["Status",22],["Late (min)",9],["Left early (min)",10],["Auto check-out",10],["Breaks",8],["Break (min)",9],["Over-break (min)",10],["Meeting (min)",10],["Task (min)",9],["Overtime approved (min)",11]];
    const ws3 = sheet("Daily log", logCols, `Day-by-day log, ${periodLabel}`, 3);
    zi = 0;
    for(const k of keys) for(const e of agents){
      const sf = shiftFor(e, k, D.sched), ex = D.sched[`X|${e.id}|${k}`], lt = D.sched[`XT|${e.id}|${k}`], rec = D.att[`${e.id}|${k}`];
      if(sf.off && ex === undefined && !rec) continue;
      const st = dayRow(e, k); let bn = 0, bm = 0, ov = 0, mt = 0, tk = 0;
      for(const b of brkOf(e.id, k)){ const d = mins2(b.started_at, b.ended_at || new Date(now()).toISOString()), al = allowedOf(b.kind); if(b.kind==="meeting") mt += d; else if(b.kind==="task") tk += d; else { bn++; bm += d; if(al && d > al) ov += d - al; } }
      const ot = D.ot.filter(o=>o.employee_id===e.id && o.day===k && o.status==="approved").reduce((x,o)=>x+o.minutes,0);
      const late = st.by && ["late","remotelate","grace","remotegrace"].includes(st.s) ? st.by : 0;
      const stTxt = st.s==="excused" ? (LEAVE[st.lt]||LEAVE.excused)[0] : (STATUS_TXT[st.s]||st.s) + (st.severe ? ` (${st.severe})` : st.allowed ? " (allowed)" : "");
      const r = addRow(ws3, [k, DOW[wdOf(k)], e.name, sf.off ? "Off" : `${sf.sh.start}–${sf.sh.end}`, sf.off ? "" : (sf.mode==="remote"?"Remote":"Office"), ex !== undefined ? LEAVE[lt||"excused"][0] : sf.off ? "Day off" : "Working", ex || "", rec ? tstr(rec.check_in) : "", rec?.check_out ? tstr(rec.check_out) : "", rec ? (rec.mode==="remote"?"Remote":"Office") : "", rec?.in_dist ?? "", stTxt, late || "", leftEarlyBy(e, k, rec, D.sched) || "", rec?.auto_out ? "Yes" : "", bn || "", bm || "", ov || "", mt || "", tk || "", ot || ""], { zebra: zi++ % 2 === 1, leftCols:[3,7,12] });
      const sc = r.getCell(12);
      if(["late","remotelate","absent"].includes(st.s)) sc.font = { ...FONT, bold:true, color:{ argb: st.s==="absent" || st.severe==="black" ? "FF1F2937" : "FFC2362B" } };
      if(st.s==="early") sc.font = { ...FONT, bold:true, color:{ argb:"FF12805C" } };
      if(ov) r.getCell(18).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } };
    }

    // 4-6. Breaks, overtime, adjustments
    const KN = { short:"Short break", long:"Long break", wc:"WC", meeting:"Meeting", task:"Task / Out of Q" };
    const ws4 = sheet("Breaks and status", [["Date",11],["Employee",24],["Type",16],["Started",9],["Ended",9],["Minutes",9],["Allowed (min)",10],["Over by (min)",10]], `Every break, meeting and task, ${periodLabel}`);
    D.brk.forEach((b, i) => { const d = mins2(b.started_at, b.ended_at || new Date(now()).toISOString()), al = allowedOf(b.kind), over = al && d > al ? d - al : "";
      const r = addRow(ws4, [b.day, enameOf(b.employee_id), KN[b.kind]||b.kind, tstr(b.started_at), b.ended_at ? tstr(b.ended_at) : "Open", d, al ?? "No limit", over], { zebra:i%2===1, leftCols:[2,3] });
      if(over) r.getCell(8).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } }; });
    const ws5 = sheet("Overtime", [["Date",11],["Employee",24],["Minutes",9],["Reason",36],["Status",11],["Decided by",20],["Decided at",18]], `Overtime requests, ${periodLabel}`);
    D.ot.forEach((o, i) => addRow(ws5, [o.day, enameOf(o.employee_id), o.minutes, o.reason||"", o.status[0].toUpperCase()+o.status.slice(1), o.decided_by||"", o.decided_at ? `${dkey(Date.parse(o.decided_at))} ${tstr(o.decided_at)}` : ""], { zebra:i%2===1, leftCols:[2,4,6], wrap:true }));
    const ws6 = sheet("Adjustments", [["Month",12],["Employee",24],["Point",8],["Change",8],["Reason",44],["By",22],["When",18]], `Manual point adjustments, ${periodLabel}`);
    D.adj.forEach((a, i) => addRow(ws6, [monthLabel(a.month), enameOf(a.employee_id), a.type==="red"?"Red":"Black", a.delta > 0 ? "+1" : "-1", a.reason, enameOf(a.created_by) || "", a.created_at ? `${dkey(Date.parse(a.created_at))} ${tstr(a.created_at)}` : ""], { zebra:i%2===1, leftCols:[2,5,6], wrap:true }));

    // 7. Office and remote by week (everyone in the schedule)
    const weeks = []; for(const k of allKeys){ const wk = new Date(Date.parse(k+"T12:00:00Z") - ((wdOf(k)+6)%7)*864e5).toISOString().slice(0,10); if(!weeks.includes(wk)) weeks.push(wk); }
    const ws7 = sheet("Office and remote", [["Employee",24],["Title",20], ...weeks.flatMap(w => [[`Week of ${prettyDate(w)} office`,10],[`Week of ${prettyDate(w)} remote`,10]]), ["Total office",9],["Total remote",9]], `Office and remote days per week, ${periodLabel}`, 2);
    people.forEach((e, i) => { const per = weeks.map(() => [0,0]); let to = 0, tr = 0;
      for(const k of allKeys){ if(D.sched[`X|${e.id}|${k}`] !== undefined) continue; const sf = shiftFor(e, k, D.sched); if(sf.off) continue; const wi = weeks.indexOf(new Date(Date.parse(k+"T12:00:00Z") - ((wdOf(k)+6)%7)*864e5).toISOString().slice(0,10)); if(sf.mode==="remote"){ per[wi][1]++; tr++; } else { per[wi][0]++; to++; } }
      addRow(ws7, [e.name, e.title||"", ...per.flat(), to, tr], { zebra:i%2===1, leftCols:[2], bold:false }); });
    note(ws7, "Counted from the schedule (planned days), leave and days off excluded. Includes seniors and supervisors.");

    // 8. Schedule grid (up to about two months)
    if(allKeys.length <= 62){
      const gCols = [["Employee",24],["Title",20], ...allKeys.map(k => [`${DOW[wdOf(k)].slice(0,2)} ${+k.slice(8)}/${+k.slice(5,7)}`, 7])];
      const ws8 = sheet("Schedule", gCols, `Schedule, ${periodLabel} (R = remote)`, 2);
      const TONE = ["FFDCE7FF","FFEADFFB","FFD5F1EC"], ids = Object.keys(shifts);
      people.forEach(e => { const vals = allKeys.map(k => { const ex = D.sched[`X|${e.id}|${k}`]; if(ex !== undefined) return LEAVE[D.sched[`XT|${e.id}|${k}`]||"excused"][1]; const sf = shiftFor(e, k, D.sched); return sf.off ? "Off" : sf.sh.start.slice(0,2) + (sf.mode==="remote" ? " R" : ""); });
        const r = addRow(ws8, [e.name, e.title||"", ...vals], { leftCols:[2] });
        allKeys.forEach((k, j) => { const c = r.getCell(j+3), sf = shiftFor(e, k, D.sched), ex = D.sched[`X|${e.id}|${k}`];
          if(ex !== undefined){ c.fill = fill("FFFFF1D6"); c.font = { ...FONT, bold:true }; } else if(sf.off){ c.fill = fill("FFF2F3F5"); c.font = { ...FONT, color:{ argb:"FF98A2B3" } }; } else { c.fill = fill(TONE[ids.findIndex(x=>shifts[x]===sf.sh) % 3] || "FFFFFFFF"); if(sf.mode==="remote") c.font = { ...FONT, bold:true }; } }); });
      const iss = D.months.flatMap(ym => checkSchedule(ym, D.sched).issues).filter(x => x.k >= from && x.k <= to);
      note(ws8, iss.length ? `Rule check: ${iss.length} issue(s). ${iss.slice(0,10).map(x => `${prettyDate(x.k)} ${RN[x.rule]}`).join("; ")}${iss.length > 10 ? "; more in the app." : "."}` : "Rule check: no issues in this period.", iss.length ? "FFC2362B" : "FF12805C");
    }

    // 9. People, 10. Rules
    const ws9 = sheet("People", [["Employee",24],["Title",24],["Access",14],["Role",14],["Email",30],["Usual shift",13],["In schedule",10],["Checks in",10],["Counts from",12],["Active",8]], "Team list");
    emps.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach((e, i) => addRow(ws9, [e.name, e.title||"", accessOf(e), EMP_TYPES[empType(e)].label, e.email||"Not set", shifts[e.shift_id] ? `${shifts[e.shift_id].start}–${shifts[e.shift_id].end}` : "", e.scheduled||e.tracked ? "Yes":"No", e.tracked?"Yes":"No", e.since||"", e.active?"Yes":"No"], { zebra:i%2===1, leftCols:[2,3,4,5] }));
    const ws10 = sheet("Rules", [["Rule",40],["Value",30]], "Rules used for this report");
    [["Time zone", S.tz],["Shifts", Object.keys(shifts).map(id=>`${shifts[id].start}–${shifts[id].end}`).join(", ")],["Check-in opens before shift (min)", S.checkin_open_min],["Grace after shift start (min)", S.grace_min],["Allowed late days per month", S.late_allowance],["Late always red after (min)", S.late_hard_min],["Late counts as black after (min)", S.late_black_min],["Early credit window (min before start)", `${S.early_max} to ${S.early_min}`],["Early credits to clear 1 red", S.early_per_clear],["Max clears per month", S.max_clears],["Needs review at (penalties)", S.review_threshold],["Adherence target", S.adherence_target/100],["Breaks per shift", `${S.break_short_count}×${S.break_short_min}, ${S.break_long_count}×${S.break_long_min}, ${S.break_wc_count}×${S.break_wc_min} WC (min)`],["No breaks at shift start and end (min)", S.break_edge_min],["Must stay available", S.min_available],["Office radius (m)", S.radius_m],["Seniors in the office daily", R.min_senior_office],["Never remote together", (R.remote_pairs||[]).map(([a,b])=>`${enameOf(a)} and ${enameOf(b)}`).join("; ")||"None"],["Morning shift office cover", R.night_needs_morning_office?"On":"Off"],["No remote days in a row", R.no_consecutive_remote?"On":"Off"]]
      .forEach((x, i) => { const r = addRow(ws10, x, { zebra:i%2===1, leftCols:[1,2] }); if(x[0]==="Adherence target") r.getCell(2).numFmt = "0%"; });

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a"); a.href = url; a.download = `Opus-Attendance-Report_${from}_to_${to}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
    toast("Report downloaded");
  }catch(e){ toast(errMsg(e)); }
  btn.disabled = false; btn.textContent = label;
}
const rangeKeys = (a, b) => { const out = []; for(let t = Date.parse(a+"T12:00:00Z"), e = Date.parse(b+"T12:00:00Z"); t <= e; t += 864e5) out.push(new Date(t).toISOString().slice(0,10)); return out; };


/* Quick CSV of any table on screen. Cells that start with = + - @ get a leading quote so spreadsheets never run them as formulas. */
function exportTableCsv(table, name){
  if(!table){ toast("Nothing to export yet."); return; }
  const cell = c => { const n = c.cloneNode(true); n.querySelectorAll(".av").forEach(x => x.remove()); n.querySelectorAll("div, br").forEach(x => x.before(" ")); let v = n.textContent.replace(/\s+/g, " ").trim(); if(/^[=+\-@]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  const csv = [...table.rows].map(r => [...r.cells].map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type:"text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href:url, download:`${name}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("CSV downloaded");
}
/* ---------- schedule rules ---------- */
const RULES = () => ({ min_senior_office:1, night_needs_morning_office:true, no_consecutive_remote:true, remote_pairs:[], ...(S.rules||{}) });
const roleLabel = e => e?.title || (e?.is_admin ? "Full access" : "Member access");
const enameOf = id => emps.find(e=>e.id===id)?.name || "";
function dayPlan(sm, e, k){
  if(e.since && k < e.since) return null;
  if(sm[`X|${e.id}|${k}`] !== undefined) return null;
  const sf = shiftFor(e, k, sm); if(sf.off) return null;
  return { mode: sf.mode, night: pHM(sf.sh.start) >= 12*60 };
}
function checkSchedule(ym, sm){
  const R = RULES(), list = schedPeople(), days = monthKeys(ym), issues = [];
  const work = {};
  for(const k of days) work[k] = list.map(e => ({ e, p: dayPlan(sm, e, k) })).filter(x => x.p);
  let workDays = 0;
  for(const k of days){
    const arr = work[k]; if(!arr.length) continue; workDays++;
    const seniors = arr.filter(x => x.e.senior), need = Math.min(R.min_senior_office||0, seniors.length);
    if(need > 0 && seniors.filter(x => x.p.mode==="office").length < need)
      issues.push({ k, rule:"senior", text:"No senior in the office", people:seniors.map(x=>x.e.id), fixes:seniors.filter(x=>x.p.mode==="remote").map(x=>({ eid:x.e.id, k, mode:"office" })) });
    for(const [a, b] of R.remote_pairs||[]){
      const A = arr.find(x=>x.e.id===a), B = arr.find(x=>x.e.id===b);
      if(A && B && A.p.mode==="remote" && B.p.mode==="remote")
        issues.push({ k, rule:"pair", text:`${enameOf(a)} and ${enameOf(b)} are both remote`, people:[a,b], fixes:[{ eid:a, k, mode:"office" },{ eid:b, k, mode:"office" }] });
    }
    if(R.night_needs_morning_office){
      const morn = arr.filter(x=>!x.p.night);
      if(morn.length && !morn.some(x=>x.p.mode==="office"))
        issues.push({ k, rule:"night", text:"Nobody on the morning shift (08 or 09) is in the office", people:morn.map(x=>x.e.id), fixes:morn.map(x=>({ eid:x.e.id, k, mode:"office" })) });
    }
  }
  if(R.no_consecutive_remote){
    for(const e of list){
      let prev = null, prevK = null;
      const pre = new Date(Date.parse(days[0]+"T12:00:00Z")); 
      for(let i = 1; i <= 7; i++){ const k = new Date(pre - i*864e5).toISOString().slice(0,10); if(sm[`X|${e.id}|${k}`] !== undefined) break; const p = dayPlan(sm, e, k); if(p){ prev = p.mode; prevK = k; break; } }
      for(const k of days){
        if(sm[`X|${e.id}|${k}`] !== undefined){ prev = null; continue; }
        const p = work[k].find(x=>x.e.id===e.id)?.p; if(!p) continue;
        if(p.mode==="remote" && prev==="remote")
          issues.push({ k, rule:"consecutive", text:`${e.name} is remote two working days in a row (${prettyDate(prevK)} and ${prettyDate(k)})`, people:[e.id], fixes:[{ eid:e.id, k, mode:"office" }, ...(prevK >= days[0] ? [{ eid:e.id, k:prevK, mode:"office" }] : [])] });
        prev = p.mode; prevK = k;
      }
    }
  }
  const bad = new Set(issues.map(i=>i.k));
  return { issues, workDays, pct: workDays ? Math.round((workDays - bad.size) / workDays * 100) : 100 };
}
const issueKey = i => `${i.rule}|${i.k}|${[...i.people].sort().join(",")}`;
function applyChangesTo(sm, changes){
  const c = { ...sm };
  for(const x of changes){
    if(x.leave){ c[`X|${x.eid}|${x.k}`] = x.reason || ""; c[`XT|${x.eid}|${x.k}`] = x.leave; continue; }
    if(x.clearLeave){ delete c[`X|${x.eid}|${x.k}`]; delete c[`XT|${x.eid}|${x.k}`]; }
    if(x.shift && x.shift !== "keep") c[`${x.eid}|${x.k}`] = x.shift === "off" ? null : x.shift;
    if(x.mode && x.mode !== "keep"){ if(c[`${x.eid}|${x.k}`] === undefined){ const e = emps.find(y=>y.id===x.eid), sf = shiftFor(e, x.k, c); if(!sf.off) c[`${x.eid}|${x.k}`] = Object.keys(shifts).find(i=>shifts[i]===sf.sh); } c[`M|${x.eid}|${x.k}`] = x.mode; }
  }
  return c;
}
function goodFixes(ym, sm, issue){
  const base = checkSchedule(ym, sm).issues.length;
  return issue.fixes.filter(f => { const r = checkSchedule(ym, applyChangesTo(sm, [f])); return r.issues.length < base; });
}
const fixLabel = f => `Make ${enameOf(f.eid).split(" ")[0]} office on ${prettyDate(f.k)}`;
function newIssuesAfter(ym, changes){
  const before = new Set(checkSchedule(ym, team.sched).issues.map(issueKey));
  const sim = applyChangesTo(team.sched, changes), after = checkSchedule(ym, sim).issues;
  return { sim, fresh: after.filter(i => !before.has(issueKey(i))) };
}
function ruleDialog(ym, changes, issues, onDecide){
  const dlg = $("#ruleDlg"), sim = applyChangesTo(team.sched, changes);
  const RULE_NAMES = { senior:"Senior cover", pair:"Not remote together", night:"Morning office cover", consecutive:"No remote days in a row" };
  const own = f => changes.some(c => c.eid===f.eid && c.k===f.k);
  const fixesFor = i => goodFixes(ym, sim, i).filter(f => !own(f));
  $("#rdList").innerHTML = issues.map((i, n) => { const fx = fixesFor(i);
    return `<div class="rd-item"><div class="rd-h"><span class="rd-rule">${RULE_NAMES[i.rule]}</span><span class="small muted">${esc(prettyDate(i.k))}</span></div><div>${esc(i.text)}</div>
      ${fx.length ? `<div class="rd-fix">${fx.map((f, j) => `<button class="btn small" data-fix="${n}:${j}">${esc(fixLabel(f))}</button>`).join("")}</div>` : `<div class="small muted">No single change fixes this. Adjust the schedule by hand.</div>`}</div>`; }).join("");
  dlg.querySelectorAll("[data-fix]").forEach(b => b.onclick = () => { const [n, j] = b.dataset.fix.split(":").map(Number); const f = fixesFor(issues[n])[j]; dlg.close(); onDecide([f]); });
  $("#rdAnyway").onclick = () => { dlg.close(); onDecide([]); };
  $("#rdCancel").onclick = () => dlg.close();
  dlg.showModal();
}
async function saveModeFixes(fixes){
  for(const f of fixes){ const { error } = await sb.rpc("set_schedule", { p_employee:f.eid, p_from:f.k, p_to:f.k, p_shift:"keep", p_working_only:false, p_mode:f.mode }); if(error) throw error; }
}

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
      <div class="panel"><div class="shift-head"><h2 style="margin:0">Month overview</h2><span id="scScore"></span></div><div id="scCheck"></div><div id="scBody"><p class="muted">Loading</p></div></div>
      <div class="panel"><div class="shift-head"><h2 style="margin:0">Weekly plan</h2><span class="small muted">Set the usual week once, then fix single days in Month overview.</span><button class="btn small" id="scCopy">Copy last month</button></div><div id="scEdit"><p class="muted">Loading</p></div></div>`;
    $("#scSel").onchange = e => { this.ym = e.target.value; this.plan = null; loadTeam(this.ym); };
    $("#scCopy").onclick = e => this.copyLastMonth(e.target);
    this.plan = null; loadTeam(this.ym);
  },
  /* Loads last month's usual shift and remote days into the weekly plan. Nothing is saved until Apply plan. */
  async copyLastMonth(btn){
    const [y, m] = this.ym.split("-").map(Number), prev = new Date(Date.UTC(y, m-2, 15)).toISOString().slice(0,7), a = `${prev}-01`, b = monthEnd(prev);
    btn.disabled = true;
    const [sc, ex] = await Promise.all([sb.from("schedule").select("*").gte("day",a).lte("day",b), sb.from("excused").select("*").gte("day",a).lte("day",b)]);
    btn.disabled = false;
    if(sc.error || ex.error){ toast(errMsg(sc.error || ex.error)); return; }
    if(!(sc.data||[]).length){ toast(`No schedule was saved for ${monthLabel(prev)}.`); return; }
    const sm = toMap(sc.data, r => r.shift_id);
    for(const r of sc.data) if(r.work_mode) sm[`M|${r.employee_id}|${r.day}`] = r.work_mode;
    for(const r of ex.data||[]) sm[`X|${r.employee_id}|${r.day}`] = r.reason || "";
    this.plan = this.buildPlan(prev, sm); this.renderPlan();
    $("#scEdit").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block:"start" });
    toast(`${monthLabel(prev)} loaded into the plan. Review it, then press Apply plan.`);
  },
  dows(){ return [1,2,3,4,5,6,0].filter(d => S.workdays.includes(d)); },
  buildPlan(ym = this.ym, sm = team.sched){
    const days = monthKeys(ym), plan = {};
    for(const e of schedPeople()){
      const cnt = {}, rem = {}, tot = {};
      for(const k of days){ const sf = shiftFor(e, k, sm); if(sf.off || sm[`X|${e.id}|${k}`] !== undefined) continue;
        const id = Object.keys(shifts).find(i=>shifts[i]===sf.sh); cnt[id] = (cnt[id]||0) + 1; const w = wdOf(k); tot[w] = (tot[w]||0) + 1; if(sf.mode==="remote") rem[w] = (rem[w]||0) + 1; }
      const shift = Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0] || e.shift_id || S.default_shift;
      plan[e.id] = { shift, remote: new Set(Object.keys(tot).map(Number).filter(w => (rem[w]||0) * 2 > tot[w])) };
    }
    return plan;
  },
  planRange(){ const a = `${this.ym}-01`, b = monthEnd(this.ym); if(!this.range || this.range.ym !== this.ym) this.range = { ym:this.ym, from:a, to:b }; return [this.range.from, this.range.to]; },
  planChanges(){
    const [a, b] = this.planRange(), out = [];
    for(const [eid, p] of Object.entries(this.plan)) for(const k of monthKeys(this.ym)){
      if(k < a || k > b) continue;
      if(!isWorkday(k)){ out.push({ eid, k, shift:"off" }); continue; }
      out.push({ eid, k, shift:p.shift, mode: p.remote.has(wdOf(k)) ? "remote" : "office" });
    }
    return out;
  },
  renderPlan(){
    if(!this.plan) this.plan = this.buildPlan();
    const dows = this.dows(), DN = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const sim = applyChangesTo(team.sched, this.planChanges()), chk = checkSchedule(this.ym, sim);
    const RN = { senior:"Senior cover", pair:"Not remote together", night:"Morning office cover", consecutive:"No remote days in a row" };
    const seen = new Map();
    for(const i of chk.issues){ const key = `${i.rule}|${i.rule==="consecutive" ? i.people[0] : wdOf(i.k)}`; if(!seen.has(key)) seen.set(key, { ...i, w: wdOf(i.k), n: 0 }); seen.get(key).n++; }
    const badW = new Set([...seen.values()].filter(x=>x.rule!=="consecutive").map(x=>x.w));
    const [a, b] = this.planRange();
    $("#scEdit").innerHTML = `
      <div class="plan-top">
        <div class="pl-dates"><label class="f">From<input type="date" class="inl" id="plFrom" value="${a}" min="${this.ym}-01" max="${monthEnd(this.ym)}"></label><label class="f">To<input type="date" class="inl" id="plTo" value="${b}" min="${this.ym}-01" max="${monthEnd(this.ym)}"></label></div>
        <span class="score ${chk.issues.length ? "bad" : "ok"}">${chk.issues.length ? `${seen.size} rule problem${seen.size>1?"s":""} in this plan` : "This plan passes every rule"}</span>
      </div>
      <div class="scroll"><table class="plan-t"><thead><tr><th>Person</th><th>Shift</th>${dows.map(d=>`<th class="${badW.has(d)?"bad":""}">${DN[d]}</th>`).join("")}</tr></thead><tbody>
      ${schedPeople().map(e => { const p = this.plan[e.id]; return `<tr data-e="${e.id}">
        <td>${avatarName(e.name, e.id)}<div class="mo-cnt">${esc(e.title||"")}</div></td>
        <td><select class="inl pl-sh">${Object.keys(shifts).map(id=>`<option value="${id}" ${p.shift===id?"selected":""}>${shifts[id].start}–${shifts[id].end}</option>`).join("")}</select></td>
        ${dows.map(d => `<td><button type="button" class="pl-d ${p.remote.has(d)?"rem":""}" data-d="${d}" aria-pressed="${p.remote.has(d)}">${p.remote.has(d)?"Remote":"Office"}</button></td>`).join("")}</tr>`; }).join("")}
      </tbody></table></div>
      ${seen.size ? `<div class="pl-issues">${[...seen.values()].map(x=>`<div><span class="rd-rule">${RN[x.rule]}</span> ${x.rule==="consecutive" ? esc(`${enameOf(x.people[0])} is remote on back-to-back working days`) : `${DN[x.w]}s: ${esc(x.text)}`}</div>`).join("")}</div>` : ""}
      <div class="actions" style="justify-content:space-between;align-items:center">
        <span class="small muted">Applies to ${esc(prettyDate(a))} to ${esc(prettyDate(b))}. Leave days stay as they are. Click a weekday to switch Office and Remote.</span>
        <span style="display:flex;gap:8px">${seen.size ? `<button class="btn no" id="plAnyway">Apply anyway</button>` : ""}<button class="btn primary" id="plApply" ${seen.size?"disabled":""}>Apply plan</button></span>
      </div>`;
    const setR = () => { const f = $("#plFrom").value, t = $("#plTo").value; if(!f || !t || t < f){ toast("Pick a valid date range."); return; } this.range = { ym:this.ym, from:f, to:t }; this.renderPlan(); };
    $("#plFrom").onchange = setR; $("#plTo").onchange = setR;
    $("#scEdit").querySelectorAll("tr[data-e]").forEach(tr => {
      const p = this.plan[tr.dataset.e];
      tr.querySelector(".pl-sh").onchange = ev => { p.shift = ev.target.value; this.renderPlan(); };
      tr.querySelectorAll(".pl-d").forEach(btn => btn.onclick = () => { const d = +btn.dataset.d; if(p.remote.has(d)) p.remote.delete(d); else p.remote.add(d); this.renderPlan(); });
    });
    const go = async btn => {
      btn.disabled = true; const [a, b] = this.planRange();
      try{ for(const [eid, p] of Object.entries(this.plan)){ const { error } = await sb.rpc("apply_pattern", { p_employee:eid, p_from:a, p_to:b, p_shift:p.shift, p_remote_dows:[...p.remote] }); if(error) throw error; }
        toast("Plan applied to the month"); this.plan = null; loadTeam(this.ym); }
      catch(e){ toast(errMsg(e)); btn.disabled = false; }
    };
    $("#plApply").onclick = e => go(e.target);
    const an = $("#plAnyway"); if(an) an.onclick = e => go(e.target);
  },
  update(){
    if(tab!=="schedule") return;
    if(team.loading || team.ym !== this.ym){ $("#scBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    const days = monthKeys(this.ym), list = schedPeople();
    const ids = Object.keys(shifts), tone = id => `s${(ids.indexOf(id) % 3) + 1}`, today = dkey(now());
    const chk = checkSchedule(this.ym, team.sched), badCells = new Set(chk.issues.flatMap(i => i.rule==="consecutive" || i.rule==="pair" ? i.people.map(p=>`${p}|${i.k}`) : []));
    const badDays = new Set(chk.issues.map(i=>i.k));
    this.renderCheck(chk);
    this.renderPlan();
    const counts = {};
    const cell = (e,k) => {
      const ex = team.sched[`X|${e.id}|${k}`], sf = shiftFor(e,k,team.sched), id = ids.find(i => shifts[i]===sf.sh);
      const we = !isWorkday(k) ? " we" : "", td = k===today ? " td" : "";
      let cls, txt;
      const lt = team.sched[`XT|${e.id}|${k}`] || "excused";
      if(ex !== undefined){ cls = `exc lv-${lt}`; txt = LEAVE[lt][1]; }
      else if(sf.off){ cls = "off"; txt = ""; }
      else { cls = tone(id) + (sf.planned ? "" : " def"); txt = sf.sh.start.slice(0,2); counts[e.id] = (counts[e.id]||0) + 1; }
      const rem = !sf.off && ex === undefined && sf.mode==="remote" ? `<i class="rm" aria-label="Remote"></i>` : "";
      const tip = `${e.name}, ${prettyDate(k)}: ${ex !== undefined ? LEAVE[lt][0] + (ex ? " ("+ex+")" : "") : sf.off ? "Day off" : sf.sh.start+" to "+sf.sh.end+(sf.mode==="remote"?", remote":", office")+(sf.planned?"":", default")}`;
      return `<td class="mo-c${we}${td}${badCells.has(`${e.id}|${k}`)?" bad":""}"><button class="ocell mo ${cls}" data-e="${e.id}" data-k="${k}" title="${esc(tip)}">${txt}${rem}</button></td>`;
    };
    const body = list.map(e=>{ const cells = days.map(k=>cell(e,k)).join(""); return `<tr><th class="mo-name">${avatarName(e.name, e.id)}<span class="mo-cnt">${esc(e.title||"")}${e.title?" · ":""}${counts[e.id]||0} days</span></th>${cells}</tr>`; }).join("");
    $("#scBody").innerHTML = list.length ? `<div class="scroll"><table class="mo-grid"><thead><tr><th class="mo-name"></th>${days.map(k=>`<th class="mo-h${!isWorkday(k)?" we":""}${k===today?" td":""}${badDays.has(k)?" bad":""}"><span>${DOW[wdOf(k)].slice(0,1)}</span><b>${+k.slice(8)}</b></th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="cal-legend">${ids.map(id=>`<span><i class="cal-sw ${tone(id)}"></i>${esc(shiftLabel(id))}</span>`).join("")}<span><i class="cal-sw so"></i>Day off</span>${LEAVE_ORDER.map(t=>`<span><span class="lv-tag lv-${t}">${LEAVE[t][1]}</span>${LEAVE[t][0]}</span>`).join("")}<span><i class="rm lg"></i>Remote</span><span><i class="cal-sw dflt"></i>Default, not set in schedule</span></div>
      <p class="hint">Rules: at least ${RULES().min_senior_office} senior in the office, ${(RULES().remote_pairs||[]).map(([a,b])=>`${esc(enameOf(a).split(" ")[0])} and ${esc(enameOf(b).split(" ")[0])} not remote together`).join(", ")||"no remote pairs set"}, at least 1 morning shift person in the office, and no remote days in a row (Friday then Monday counts). Change them in People, Team rules.</p>
      <p class="hint">Click a day to edit it. Shift-click another day to select a range, across agents too. Ctrl or ⌘-click to add single days. Esc closes the editor.</p>` : `<p class="empty">No tracked employees.</p>`;
    this.sel = this.sel || new Set();
    this.paintSel();
    $("#scBody").querySelectorAll(".ocell").forEach(b => b.onclick = ev => this.pick(b, ev));
  },
  renderCheck(chk){
    const ok = !chk.issues.length;
    $("#scScore").innerHTML = `<span class="score ${ok?"ok":chk.pct>=90?"mid":"bad"}">${chk.pct}% of days pass the rules</span>`;
    const RULE_NAMES = { senior:"Senior cover", pair:"Not remote together", night:"Morning office cover", consecutive:"No remote days in a row" };
    $("#scCheck").innerHTML = ok ? "" : `<details class="chk" ${chk.issues.length <= 3 ? "open" : ""}><summary>${chk.issues.length} issue${chk.issues.length>1?"s":""} to fix</summary>
      ${chk.issues.map((i, n) => { const fx = goodFixes(this.ym, team.sched, i).slice(0, 3);
        return `<div class="rd-item"><div class="rd-h"><span class="rd-rule">${RULE_NAMES[i.rule]}</span><span class="small muted">${esc(prettyDate(i.k))}</span></div><div class="small">${esc(i.text)}</div>${fx.length ? `<div class="rd-fix">${fx.map((f,j)=>`<button class="btn small" data-qf="${n}:${j}">${esc(fixLabel(f))}</button>`).join("")}</div>` : ""}</div>`; }).join("")}</details>`;
    $("#scCheck").querySelectorAll("[data-qf]").forEach(b => b.onclick = async () => {
      const [n, j] = b.dataset.qf.split(":").map(Number), f = goodFixes(this.ym, team.sched, chk.issues[n])[j];
      b.disabled = true; try{ await saveModeFixes([f]); toast("Fixed"); loadTeam(this.ym); }catch(e){ toast(errMsg(e)); b.disabled = false; }
    });
  },
  key: b => `${b.dataset.e}|${b.dataset.k}`,
  paintSel(){ document.querySelectorAll("#scBody .ocell").forEach(b => b.classList.toggle("sel", this.sel.has(this.key(b)))); },
  pick(b, ev){
    const k = this.key(b);
    if(ev.shiftKey && this.anchor){
      const list = schedPeople().map(e=>e.id), days = monthKeys(this.ym);
      const [ae, ad] = this.anchor.split("|"), [be, bd] = k.split("|");
      const r1 = Math.min(list.indexOf(ae), list.indexOf(be)), r2 = Math.max(list.indexOf(ae), list.indexOf(be));
      const d1 = ad < bd ? ad : bd, d2 = ad < bd ? bd : ad;
      this.sel = new Set();
      for(let r = r1; r <= r2; r++) for(const d of days) if(d >= d1 && d <= d2) this.sel.add(`${list[r]}|${d}`);
    } else if(ev.ctrlKey || ev.metaKey){
      if(this.sel.has(k)) this.sel.delete(k); else this.sel.add(k);
      this.anchor = k;
    } else { this.sel = new Set([k]); this.anchor = k; }
    this.paintSel();
    if(this.sel.size) this.openEditor(b); else closeDayEditor();
  },
  openEditor(cellBtn){
    const sel = [...this.sel].map(x => { const [eid, d] = x.split("|"); return { eid, d }; }).sort((a,b)=>a.eid.localeCompare(b.eid) || a.d.localeCompare(b.d));
    const single = sel.length === 1, e0 = emps.find(x=>x.id===sel[0].eid);
    const agents = [...new Set(sel.map(x=>x.eid))];
    let curType = "working", curShift = null, curMode = null, curReason = "";
    if(single){
      const ex = team.sched[`X|${e0.id}|${sel[0].d}`], sf = shiftFor(e0, sel[0].d, team.sched);
      if(ex !== undefined){ curType = team.sched[`XT|${e0.id}|${sel[0].d}`] || "excused"; curReason = ex; }
      curShift = sf.off ? "off" : Object.keys(shifts).find(i => shifts[i]===sf.sh); curMode = sf.mode;
    }
    const title = single ? `${e0.name}` : `${agents.length} agent${agents.length>1?"s":""}, ${sel.length} day${sel.length>1?"s":""}`;
    const sub = single ? longDate(sel[0].d) : (() => { const ds = sel.map(x=>x.d).sort(); return `${prettyDate(ds[0])} to ${prettyDate(ds[ds.length-1])}`; })();
    const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v,l,cls]) => `<button type="button" class="seg-b ${cls||""} ${v===cur?"on":""}" data-v="${v}">${l}</button>`).join("")}</div>`;
    const pop = $("#dayEd");
    pop.innerHTML = `
      <div class="de-h"><div>${single ? avatarName(e0.name, e0.id) : `<b>${esc(title)}</b>`}<div class="small muted" style="margin-top:2px">${esc(sub)}</div></div><button class="btn small" id="deX" aria-label="Close">Close</button></div>
      <div class="de-sec"><div class="de-l">Day type</div>${seg("type", [["working","Working"], ...LEAVE_ORDER.map(t=>[t, LEAVE[t][0], "lv-"+t])], curType)}</div>
      <div class="de-sec" id="deWork"><div class="de-l">Shift</div>${seg("shift", [...(single?[]:[["keep","Keep"]]), ...Object.keys(shifts).map(id=>[id, `${shifts[id].start}–${shifts[id].end}`]), ["off","Day off"]], single ? curShift : "keep")}
        <div class="de-l" style="margin-top:12px">Work from</div>${seg("mode", [...(single?[]:[["keep","Keep"]]), ["office","Office"], ["remote","Remote"]], single ? curMode : "keep")}</div>
      <div class="de-sec" id="deNote"><div class="de-l">Note (optional)</div><input class="inl" id="deReason" maxlength="120" value="${esc(curReason)}" placeholder="Example: approved by HR, doctor appointment"></div>
      <div class="de-f"><span class="small muted">${single ? "Shift-click another day to select a range." : "Changes apply to every selected day."}</span><button class="btn primary" id="deSave">Save</button></div>
      <p class="err" id="deErr"></p>`;
    const val = n => pop.querySelector(`[data-seg="${n}"] .on`)?.dataset.v;
    const sync = () => { const t = val("type"); pop.querySelector("#deWork").style.display = t==="working" ? "" : "none"; pop.querySelector("#deNote").style.display = t==="working" ? "none" : ""; };
    pop.querySelectorAll(".seg").forEach(g => g.querySelectorAll(".seg-b").forEach(btn => btn.onclick = () => { g.querySelectorAll(".seg-b").forEach(x=>x.classList.remove("on")); btn.classList.add("on"); sync(); }));
    sync();
    $("#deX").onclick = () => { this.sel.clear(); this.paintSel(); closeDayEditor(); };
    $("#deSave").onclick = () => this.saveEditor(sel, val("type"), val("shift"), val("mode"), $("#deReason").value.trim());
    pop.hidden = false;
    const r = cellBtn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    if(innerWidth < 700){ pop.classList.add("sheet"); pop.style.left = pop.style.top = ""; }
    else { pop.classList.remove("sheet");
      let left = r.left + r.width/2 - pw/2; left = Math.max(12, Math.min(innerWidth - pw - 12, left));
      let top = r.bottom + 8; if(top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 8);
      pop.style.left = left + "px"; pop.style.top = top + "px"; }
  },
  async saveEditor(sel, type, shift, mode, reason, extras){
    if(extras === undefined){
      const changes = sel.map(x => type !== "working" ? { eid:x.eid, k:x.d, leave:type, reason } : { eid:x.eid, k:x.d, clearLeave:true, shift:shift||"keep", mode });
      const { fresh } = newIssuesAfter(this.ym, changes);
      if(fresh.length){ ruleDialog(this.ym, changes, fresh, fx => this.saveEditor(sel, type, shift, mode, reason, fx)); return; }
      extras = [];
    }
    const btn = $("#deSave"); btn.disabled = true; $("#deErr").textContent = "";
    try{
      const byEmp = {}; for(const x of sel) (byEmp[x.eid] ||= []).push(x.d);
      for(const [eid, ds] of Object.entries(byEmp)){
        ds.sort();
        if(type !== "working"){
          for(const d of ds){ const { error } = await sb.rpc("set_excused", { p_employee:eid, p_day:d, p_excused:true, p_reason:reason, p_type:type }); if(error) throw error; }
          continue;
        }
        for(const d of ds) if(team.sched[`X|${eid}|${d}`] !== undefined){ const { error } = await sb.rpc("set_excused", { p_employee:eid, p_day:d, p_excused:false }); if(error) throw error; }
        const sh = shift || "keep", md = mode && mode !== "keep" ? mode : null;
        if(sh === "keep" && !md) continue;
        const runs = []; let cur = null;
        for(const d of ds){ if(cur && Date.parse(d+"T12:00:00Z") - Date.parse(cur[1]+"T12:00:00Z") === 864e5) cur[1] = d; else { cur = [d, d]; runs.push(cur); } }
        for(const [a, b] of runs){ const { error } = await sb.rpc("set_schedule", { p_employee:eid, p_from:a, p_to:b, p_shift:sh, p_working_only:false, p_mode:md }); if(error) throw error; }
      }
      await saveModeFixes(extras);
      toast((sel.length === 1 ? "Day updated" : `${sel.length} days updated`) + (extras.length ? ", with the fix" : ""));
      this.sel.clear(); closeDayEditor(); loadTeam(this.ym);
    }catch(e){ $("#deErr").textContent = errMsg(e); btn.disabled = false; }
  }
};
function closeDayEditor(){ const p = $("#dayEd"); if(p) p.hidden = true; }
document.addEventListener("keydown", e => { if(e.key === "Escape"){ closeDayEditor(); if(views.schedule.sel){ views.schedule.sel.clear(); views.schedule.paintSel?.(); } } });
document.addEventListener("mousedown", e => { const p = $("#dayEd"); if(p && !p.hidden && !p.contains(e.target) && !e.target.closest?.(".ocell")) { closeDayEditor(); views.schedule.sel?.clear(); views.schedule.paintSel?.(); } });
/* ---------- admin: employees ---------- */
const EMP_TYPES = {
  agent:      { label:"Agent", note:"Member access. Checks in, takes breaks, earns points. In the schedule.", f:{ tracked:true, scheduled:true, is_admin:false, senior:false } },
  senior:     { label:"Senior", note:"Full access. In the schedule and counts for senior office cover. No check-in or breaks.", f:{ tracked:false, scheduled:true, is_admin:true, senior:true } },
  supervisor: { label:"Supervisor", note:"Full access. In the schedule. No check-in or breaks.", f:{ tracked:false, scheduled:true, is_admin:true, senior:false } },
  manager:    { label:"Manager / Head", note:"Full access. Not in the schedule.", f:{ tracked:false, scheduled:false, is_admin:true, senior:false } }
};
const empType = e => e.tracked ? "agent" : e.scheduled ? (e.senior ? "senior" : "supervisor") : "manager";
views.staff = {
  mount(el){ this.el = el; this.q = ""; this.render(); },
  render(){
    const groups = [["Agents", e => e.active && empType(e)==="agent"], ["Seniors and supervisors", e => e.active && ["senior","supervisor"].includes(empType(e))], ["Managers and heads", e => e.active && empType(e)==="manager"], ["Inactive", e => !e.active]];
    const match = e => !this.q || `${e.name} ${e.title||""} ${e.email||""}`.toLowerCase().includes(this.q);
    const row = e => `<button class="emp-row" data-id="${e.id}">
        ${avatar(e.name, e.id)}
        <span class="emp-main"><b>${esc(e.name)}</b><span class="small muted">${esc(e.title || EMP_TYPES[empType(e)].label)}</span></span>
        <span class="emp-meta">${e.scheduled || e.tracked ? `<span class="chip c-ontime">${esc(shifts[e.shift_id] ? `${shifts[e.shift_id].start}–${shifts[e.shift_id].end}` : "")}</span>${e.default_mode==="remote" ? '<span class="chip c-remote">Remote</span>' : ""}` : ""}${e.senior ? '<span class="chip c-ontime">Senior</span>' : ""}${e.is_admin ? '<span class="chip c-ontime acc-full">Full access</span>' : '<span class="chip c-ontime">Member access</span>'}</span>
        <span class="emp-mail small ${e.email ? "muted" : "warn"}">${esc(e.email || "No email yet")}</span>
        <span class="emp-go" aria-hidden="true">Edit</span>
      </button>`;
    this.el.innerHTML = `
      <div class="panel" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input class="inl" id="emQ" placeholder="Search by name, title or email" value="${esc(this.q)}" style="flex:1;min-width:200px">
        <button class="btn primary" id="emAdd">Add person</button>
      </div>
      ${groups.map(([title, f]) => { const list = emps.filter(e => f(e) && match(e)).sort((a,b)=>a.name.localeCompare(b.name)); return list.length ? `<section class="panel"><h2>${title} <span class="muted small">${list.length}</span></h2><div class="emp-list">${list.map(row).join("")}</div></section>` : ""; }).join("")}`;
    $("#emQ").oninput = ev => { this.q = ev.target.value.trim().toLowerCase(); const pos = ev.target.selectionStart; this.render(); const i = $("#emQ"); i.focus(); i.setSelectionRange(pos, pos); };
    $("#emAdd").onclick = () => this.edit(null);
    this.el.querySelectorAll(".emp-row").forEach(b => b.onclick = () => this.edit(emps.find(e=>e.id===b.dataset.id)));
  },
  edit(e){
    const isNew = !e; e = e || { name:"", title:"", email:"", shift_id:S.default_shift, default_mode:"office", active:true, since:null, ...EMP_TYPES.agent.f };
    let type = empType(e);
    const dlg = $("#empDlg");
    const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v,l])=>`<button type="button" class="seg-b ${v===cur?"on":""}" data-v="${v}">${l}</button>`).join("")}</div>`;
    dlg.innerHTML = `
      <form method="dialog" class="dlg-x"><button class="btn small" aria-label="Close">Close</button></form>
      <h2>${isNew ? "Add a person" : esc(e.name)}</h2>
      <div class="ed-sec"><div class="grid">
        <label class="f">Full name<input class="inl" id="edName" value="${esc(e.name)}" maxlength="60" placeholder="Full name"></label>
        <label class="f">Title<input class="inl" id="edTitle" value="${esc(e.title||"")}" maxlength="60" placeholder="Example: Operations"></label>
      </div>
      <label class="f" style="margin-top:12px">Work email, used to sign in<input class="inl" id="edEmail" type="email" value="${esc(e.email||"")}" placeholder="name@aaico.com"></label></div>
      <div class="ed-sec"><div class="de-l">Role</div>${seg("edType", Object.entries(EMP_TYPES).map(([k,v])=>[k,v.label]), type)}<p class="hint" id="edNote">${EMP_TYPES[type].note}</p></div>
      <div class="ed-sec" id="edSched"><div class="de-l">Usual shift</div>${seg("edShift", Object.keys(shifts).map(id=>[id, `${shifts[id].start}–${shifts[id].end}`]), e.shift_id)}
        <div class="de-l" style="margin-top:12px">Usually works from</div>${seg("edMode", [["office","Office"],["remote","Remote"]], e.default_mode||"office")}</div>
      <div class="ed-sec" id="edStart"><label class="f" style="max-width:220px">Points count from<input class="inl" id="edSince" type="date" value="${esc(e.since||"")}"></label></div>
      <div class="ed-sec"><label class="chk"><input type="checkbox" id="edActive" ${e.active?"checked":""}>Active</label></div>
      <div class="actions"><button class="btn" id="edCancel">Cancel</button><button class="btn primary" id="edSave">${isNew ? "Add person" : "Save"}</button></div>
      <p class="err" id="edErr"></p>`;
    const sync = () => { const f = EMP_TYPES[type].f; $("#edNote").textContent = EMP_TYPES[type].note; $("#edSched").style.display = f.scheduled ? "" : "none"; $("#edStart").style.display = f.tracked ? "" : "none"; };
    const segVal = id => dlg.querySelector(`#${id} .on`)?.dataset.v;
    dlg.querySelectorAll(".seg").forEach(g => g.querySelectorAll(".seg-b").forEach(b => b.onclick = () => { g.querySelectorAll(".seg-b").forEach(x=>x.classList.remove("on")); b.classList.add("on"); if(g.id==="edType"){ type = b.dataset.v; sync(); } }));
    sync();
    $("#edCancel").onclick = () => dlg.close();
    $("#edSave").onclick = async () => {
      const name = $("#edName").value.trim(), email = $("#edEmail").value.trim().toLowerCase();
      if(!name){ $("#edErr").textContent = "Enter a name."; return; }
      if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $("#edErr").textContent = "Enter a valid email."; return; }
      const f = EMP_TYPES[type].f;
      if(!isNew && e.id===me.id && (!f.is_admin || !$("#edActive").checked)){ $("#edErr").textContent = "You cannot remove your own manager access."; return; }
      const row = { name, title:$("#edTitle").value.trim()||null, email:email||null, ...f, shift_id:segVal("edShift")||S.default_shift, default_mode:segVal("edMode")||"office", since:f.tracked ? ($("#edSince").value||null) : null, active:$("#edActive").checked };
      $("#edSave").disabled = true;
      const res = isNew ? await sb.from("employees").insert(row).select().single() : await sb.from("employees").update(row).eq("id", e.id);
      $("#edSave").disabled = false;
      if(res.error){ $("#edErr").textContent = res.error.code==="23505" ? "That email is already used by someone else." : errMsg(res.error); return; }
      if(isNew) emps.push(res.data); else Object.assign(emps.find(x=>x.id===e.id), row);
      dlg.close(); toast(isNew ? `${name} added` : "Saved"); this.render();
    };
    dlg.showModal();
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
          <label class="f">Adherence target (%)<input type="number" min="50" max="100" id="sAdh" value="${S.adherence_target}"></label>
          <label class="f">Needs review at (penalties)<input type="number" min="1" id="sRev" value="${S.review_threshold}"></label>
          <label class="f">Allowed late days per month<input type="number" min="0" max="31" id="sAllow" value="${S.late_allowance}"></label>
        </div>
        <p class="small muted" style="margin:12px 0 6px">Default working days (used when the schedule has no entry)</p>
        <div class="days">${DOW.map((n,i)=>`<label><input type="checkbox" data-wd="${i}" ${S.workdays.includes(i)?"checked":""}>${n}</label>`).join("")}</div>
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
      <div class="panel"><h2>Schedule rules</h2>
        <div class="grid">
          <label class="f">Seniors in the office every working day<input type="number" min="0" max="5" id="rSen" value="${RULES().min_senior_office}"></label>
        </div>
        <div class="stack-12">
          <label class="chk"><input type="checkbox" id="rNight" ${RULES().night_needs_morning_office?"checked":""}>Someone on the morning shift (08 or 09) is in the office every working day</label>
          <label class="chk"><input type="checkbox" id="rCons" ${RULES().no_consecutive_remote?"checked":""}>Nobody works remote two working days in a row (Friday then Monday counts)</label>
        </div>
        <p class="small muted" style="margin:14px 0 6px">Never remote on the same day</p>
        <div id="rPairs"></div>
        <div class="ot-row" style="margin-top:8px"><select class="inl" id="rpA">${schedPeople().map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select><select class="inl" id="rpB">${schedPeople().map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select><button class="btn" id="rpAdd">Add pair</button></div>
        <p class="hint">The schedule shows an error with suggestions whenever a change breaks one of these rules.</p>
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
    this.pairs = (RULES().remote_pairs||[]).map(p=>[...p]);
    const paintPairs = () => { $("#rPairs").innerHTML = this.pairs.length ? this.pairs.map(([x,y],i)=>`<div class="item"><span>${esc(enameOf(x))} and ${esc(enameOf(y))}</span><button class="btn small" data-rp="${i}">Remove</button></div>`).join("") : `<p class="empty" style="padding:0">No pairs.</p>`;
      $("#rPairs").querySelectorAll("[data-rp]").forEach(b => b.onclick = () => { this.pairs.splice(+b.dataset.rp, 1); paintPairs(); }); };
    paintPairs();
    $("#rpAdd").onclick = () => { const x = $("#rpA").value, y = $("#rpB").value; if(x===y){ toast("Pick two different people."); return; } if(this.pairs.some(([p,q])=>(p===x&&q===y)||(p===y&&q===x))){ toast("That pair is already there."); return; } this.pairs.push([x,y]); paintPairs(); toast("Pair added. Save settings to apply."); };
    $("#sHere").onclick = async () => { try{ const p = await getPos(); $("#sLat").value = p.coords.latitude.toFixed(6); $("#sLng").value = p.coords.longitude.toFixed(6); toast("Location set. Save to apply."); }catch(e){ toast(errMsg(e)); } };
    $("#sSave").onclick = async e => {
      if(+$("#sEMax").value <= +$("#sEarly").value){ toast("Early credit 'from' must be more minutes than 'until'."); return; }
      const lat = parseFloat($("#sLat").value), lng = parseFloat($("#sLng").value);
      if(isNaN(lat) || isNaN(lng)){ toast("Enter the office latitude and longitude."); return; }
      const row = {
        grace_min: Math.max(0, +$("#sGrace").value||0), early_min: Math.max(1, +$("#sEarly").value||10), early_max: Math.max(2, +$("#sEMax").value||15), early_per_clear: Math.max(1, Math.round(+$("#sPer").value||3)), max_clears: Math.max(0, Math.round(+$("#sMaxC").value||0)), late_allowance: Math.max(0, Math.round(+$("#sAllow").value||0)),
        late_hard_min: Math.max(1, +$("#sHard").value||30), late_black_min: Math.max(1, +$("#sBlackL").value||120), checkin_open_min: Math.max(0, +$("#sOpen").value||0),
        early_leave_min: Math.max(0, +$("#sLeave").value||0), review_threshold: Math.max(1, +$("#sRev").value||3), adherence_target: Math.min(100, Math.max(50, +$("#sAdh").value||90)),
        workdays: [...document.querySelectorAll("[data-wd]")].filter(x=>x.checked).map(x=>+x.dataset.wd),
        office_lat: lat, office_lng: lng, radius_m: Math.max(50, +$("#sRad").value||500),
        break_short_min: Math.max(1, +$("#sBsm").value||15), break_short_count: Math.max(0, Math.round(+$("#sBsc").value||0)),
        break_long_min: Math.max(1, +$("#sBlm").value||30), break_long_count: Math.max(0, Math.round(+$("#sBlc").value||0)),
        break_wc_min: Math.max(1, +$("#sBwm").value||5), break_wc_count: Math.max(0, Math.round(+$("#sBwc").value||0)),
        break_edge_min: Math.max(0, +$("#sEdge").value||0),
        min_available: Math.max(0, Math.round(+$("#sMinA").value||0)), break_alert_after_min: Math.max(1, +$("#sBal").value||15)
      };
      e.target.disabled = true;
      row.rules = { ...RULES(), min_senior_office: Math.max(0, Math.round(+$("#rSen").value||0)), night_needs_morning_office: $("#rNight").checked, no_consecutive_remote: $("#rCons").checked, remote_pairs: this.pairs };
      const { error } = await sb.from("settings").update(row).eq("id",1);
      e.target.disabled = false;
      if(error){ toast(errMsg(error)); return; }
      S = { ...S, ...row }; toast("Settings saved");
    };
  }
};


views.people = sectionsView(() => [["staff","Employees",views.staff],["rules","Team rules",views.settings]]);
/* ---------- night mode ---------- */
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t==="dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function paintThemeButtons(){ const on = isDark(); document.querySelectorAll("[data-theme-toggle]").forEach(b => { b.setAttribute("aria-pressed", String(on)); b.querySelector(".tl").textContent = on ? "Night mode on" : "Night mode off"; }); }
function toggleTheme(){
  const root = document.documentElement;
  if(!reduceMotion()){ root.classList.add("theme-anim"); clearTimeout(toggleTheme._t); toggleTheme._t = setTimeout(() => root.classList.remove("theme-anim"), 450); }
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try{ localStorage.setItem("opus-theme", next); }catch{}
  paintThemeButtons();
}
document.querySelectorAll("[data-theme-toggle]").forEach(b => b.onclick = toggleTheme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeButtons);
paintThemeButtons();

/* ---------- how it works ---------- */
views.guide = {
  part:"everyone",
  mount(el){
    this.el = el;
    const R = RULES(), sh = Object.keys(shifts).map(id => `${shifts[id].start}–${shifts[id].end}`).join(", ");
    const seniors = schedPeople().filter(e=>e.senior).map(e=>e.name.split(" ")[0]).join(", ") || "none set";
    const pairs = (R.remote_pairs||[]).map(([a,b])=>`${enameOf(a).split(" ")[0]} and ${enameOf(b).split(" ")[0]}`).join("; ") || "none";
    const icon = k => `<span class="tc-i"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg></span>`;
    const topic = (ic, title, lines) => `<article class="tc">${icon(ic)}<h3>${title}</h3><ul>${lines.map(x=>`<li>${x}</li>`).join("")}</ul></article>`;
    const flow = list => `<div class="flow">${list.map(([t,d],i)=>`<div class="fl"><span class="fl-n">${i+1}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div>`;
    const pts = [["0","On time","By shift start","ok"],[S.late_allowance+" free","Late",`Up to ${S.late_hard_min} min, per month`,"mid"],["+1","Red",`Late after that, or over ${S.late_hard_min} min`,"red"],["+1","Black",`Absent, or over ${fmtMin(S.late_black_min)}`,"blk"],["−1 red","Early credit",`${S.early_per_clear} office early days, max ${S.max_clears}/month`,"green"]];
    const everyone = `
      ${flow([["Check in",`Opens ${S.checkin_open_min} min before your shift`],["Break or status","Breaks, meetings, tasks"],["Check out","Or automatic 1 min after"],["Your month","My month: points and schedule"]])}
      <section class="gx"><h2>Points</h2><div class="pts">${pts.map(([b,t,d,c])=>`<div class="pt ${c}"><span class="pt-b">${b}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div>
        <p class="hint">${S.grace_min} min grace at shift start. Resets on the 1st. ${S.review_threshold}+ penalties in a month means a review.</p></section>
      <div class="tcs">
        ${topic("checkin","Check in",[`Shifts: ${sh}`,`Office days: within ${S.radius_m} m of the office`,"Remote days: no location","Your schedule decides office or remote"])}
        ${topic("breaks","Breaks and status",[`${S.break_short_count}×${S.break_short_min} min, ${S.break_long_count}×${S.break_long_min} min, ${S.break_wc_count}×${S.break_wc_min} min WC`,`Not in the first or last ${S.break_edge_min} min`,`${S.min_available} teammate always stays available`,"Meetings and tasks have no limit"])}
        ${topic("team","End of day",["Auto check-out 1 min after your shift","Staying late? Extend shift, a manager approves",`Leaving over ${S.early_leave_min} min early is recorded`])}
        ${topic("schedule","Schedule and leave",["See your days in My month, Schedule",`Leave: ${LEAVE_ORDER.map(t=>LEAVE[t][0]).join(", ")}`,"Leave days carry no points"])}
        ${topic("mine","Adherence and streak",[`Target ${S.adherence_target}% of your time on schedule`,"Late, early leave, absence and over-break count against it","10 on-time days in a row earns the 2-week mark"])}
        ${topic("profile","Privacy",["Team sees: name, photo, title, shift, status","Full access sees: times, distance, points","Every change is in the Activity log"])}
      </div>
      <p class="hint">Something wrong? Open <b>Account → Help</b>. <button type="button" class="linkbtn" id="gdTour" style="margin:0 0 0 8px">Replay the tour</button></p>`;
    const full = me.is_admin ? `
      ${flow([["Weekly plan","Shifts and remote days, pick the dates"],["Fix days","Click a day in Month overview"],["Rule check","Keep it at 100%"],["Review","Download full report: week, month, year or custom dates"]])}
      <div class="tcs">
        ${topic("schedule","Schedule rules",[`${R.min_senior_office} senior in the office daily (${esc(seniors)})`,`Never remote together: ${esc(pairs)}`,R.night_needs_morning_office?"Morning shift (08 or 09): at least 1 in the office daily":"Morning office rule off",R.no_consecutive_remote?"No remote days in a row (Fri then Mon counts)":"Back-to-back remote allowed"])}
        ${topic("checkin","Editing days",["Click a day; Shift-click for a range","Ctrl or ⌘-click adds days","Weekly plan replaces day edits in its dates"])}
        ${topic("people","Access",["<b>Full access</b>: seniors, supervisors, managers, heads","<b>Member access</b>: agents","Seniors and supervisors are in the schedule only","Add people or change roles in People"])}
        ${topic("live","Daily",["Today: live board, check-ins and overtime approvals","Reports: adjust points with a reason, download the Excel report or a quick CSV","Reports, Activity log: every change, by whom and when"])}
        ${topic("settings","Rules",["People → Team rules holds every number","This guide updates itself from it"])}
      </div>` : "";
    el.innerHTML = `
      <div class="g-top">${me.is_admin ? `<div class="seg" id="gdTabs"><button type="button" class="seg-b ${this.part==="everyone"?"on":""}" data-v="everyone">Everyone</button><button type="button" class="seg-b ${this.part==="full"?"on":""}" data-v="full">Full access</button></div>` : ""}
        <input class="inl" id="gdQ" placeholder="Search: late, WC, overtime, remote"></div>
      <div id="gdList">${this.part==="full" && me.is_admin ? full : everyone}</div>`;
    const t = $("#gdTabs"); if(t) t.querySelectorAll(".seg-b").forEach(b => b.onclick = () => { this.part = b.dataset.v; this.mount(el); replay($("#gdList"), "pg-in"); });
    const tr = $("#gdTour"); if(tr) tr.onclick = () => startTour();
    $("#gdQ").oninput = e => { const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll("#gdList .tc, #gdList .gx, #gdList .flow").forEach(d => { d.hidden = !!q && !d.textContent.toLowerCase().includes(q); }); };
  }
};

/* ---------- report an issue ---------- */
const DEV_EMAIL = "ahmed.kamal@aaico.com";
views.help = { mount(el){ el.innerHTML = views.issue.html(); views.issue.wire(); } };
views.issue = {
  html(){ return `
      <section class="panel"><h2>Report a problem</h2>
        <div class="grid">
          <label class="f">What is it about?<select id="isCat"><option>Check in or check out</option><option>Breaks or status</option><option>Points or report</option><option>Schedule</option><option>Location or office distance</option><option>Sign in</option><option>Something else</option></select></label>
          <label class="f">Where did it happen?<select id="isPage">${tabsFor().filter(x=>x[0]!=="head").map(x=>`<option>${esc(x[1])}</option>`).join("")}<option>Other</option></select></label>
        </div>
        <label class="f" style="margin-top:12px">Describe the problem<textarea id="isMsg" rows="6" maxlength="2000" placeholder="What did you do, what did you expect, and what happened instead? Include the time if you can."></textarea></label>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="small muted">Goes to the developer at <a href="mailto:${DEV_EMAIL}">${DEV_EMAIL}</a></span>
          <button class="btn primary" id="isSend">Send to the developer</button>
        </div>
        <p class="hint">Your name, email, the time and your browser are added automatically. Your email app opens with the message ready; press send there. A copy is also saved in the system.</p>
      </section>
      <section class="panel"><h2>Your reports</h2><div id="isList"><p class="muted">Loading</p></div></section>`; },
  wire(){ $("#isSend").onclick = () => this.send($("#isSend")); this.list(); },
  async list(){
    const { data } = await sb.from("issues").select("*").eq("employee_id", me.id).order("created_at",{ascending:false}).limit(20);
    if(!$("#isList")) return;
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
    const body = `${msg}\n\n---\nFrom: ${me.name} (${email})\nTitle: ${roleLabel(me)}\nTopic: ${cat}\nPage: ${page}\nTime: ${longDate(dkey(t))}, ${tstr(new Date(t).toISOString())} UAE\nBrowser: ${navigator.userAgent}`;
    location.href = `mailto:${DEV_EMAIL}?subject=${encodeURIComponent(`[Opus Attendance] ${cat}`)}&body=${encodeURIComponent(body)}`;
    toast("Saved. Your email app is opening.");
    $("#isMsg").value = ""; this.list();
  }
};

/* ---------- my settings ---------- */
async function squarePhoto(file){
  const img = await createImageBitmap(file), side = Math.min(img.width, img.height);
  const c = document.createElement("canvas"); c.width = c.height = 320;
  c.getContext("2d").drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0, 0, 320, 320);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
}
views.profile = {
  mount(el){ this.el = el; this.account(el); },
  account(el){
    const sh = shifts[me.shift_id];
    el.innerHTML = `
      <section class="panel"><h2>Profile photo</h2>
        <div class="pf-row">
          <div class="pf-av" id="pfAv">${avatar(me.name, me.id)}</div>
          <div class="pf-actions">
            <label class="btn primary" for="pfFile">Upload photo</label><input type="file" id="pfFile" accept="image/jpeg,image/png,image/webp" hidden>
            <button class="btn" id="pfDel" ${photos[me.id]?"":"hidden"}>Remove photo</button>
          </div>
        </div>
      </section>
      <section class="panel"><h2>Appearance</h2>
        <div class="pf-line"><div><b>Night mode</b><div class="small muted">Saved on this device.</div></div><button class="btn theme-btn" data-theme-toggle><span class="sw"></span><span class="tl">Night mode</span></button></div>
      </section>
      <section class="panel"><h2>Your details</h2>
        <div class="pf-grid">
          <div><span>Name</span><b>${esc(me.name)}</b></div>
          <div><span>Email</span><b id="pfEmail">…</b></div>
          <div><span>Title</span><b>${esc(roleLabel(me))}</b></div>
          ${me.tracked || me.scheduled ? `<div><span>Default shift</span><b>${sh ? `${sh.start} to ${sh.end}` : "Not set"}</b></div>
          <div><span>Works from</span><b>${me.default_mode==="remote" ? "Remote" : "Office"}</b></div>` : ""}
        </div>
        <p class="hint">To change these, ask a manager.</p>
      </section>`;
    sb.auth.getUser().then(r => { const e = $("#pfEmail"); if(e) e.textContent = r.data.user?.email || ""; });
    document.querySelectorAll("#main [data-theme-toggle]").forEach(b => b.onclick = toggleTheme);
    paintThemeButtons();
    $("#pfFile").onchange = e => this.upload(e.target.files[0]);
    $("#pfDel").onclick = () => this.remove();
  },
  async upload(file){
    if(!file) return;
    try{
      toast("Uploading photo");
      const blob = await squarePhoto(file), path = `${me.id}/${Date.now()}.jpg`;
      const up = await sb.storage.from("avatars").upload(path, blob, { contentType:"image/jpeg", upsert:true });
      if(up.error) throw up.error;
      const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error } = await sb.rpc("set_my_avatar", { p_url:url });
      if(error) throw error;
      photos[me.id] = url; toast("Photo updated"); this.repaint();
    }catch(e){ toast(errMsg(e)); }
    $("#pfFile").value = "";
  },
  async remove(){
    const { error } = await sb.rpc("set_my_avatar", { p_url:null });
    if(error){ toast(errMsg(error)); return; }
    delete photos[me.id]; toast("Photo removed"); this.repaint();
  },
  repaint(){
    $("#pfAv").innerHTML = avatar(me.name, me.id); $("#pfDel").hidden = !photos[me.id];
    $("#who").innerHTML = `${avatar(me.name, me.id)}<div><div class="nm">${esc(me.name)}</div><div class="rl">${esc(roleLabel(me))}</div></div>`;
    refreshLive();
  }
};


/* Account page: profile, my schedule (managers on the schedule), how it works, help. */
views.account = sectionsView(() => [["profile","Profile",views.profile], ...(me.scheduled && !me.tracked ? [["schedule","My schedule",views.myschedule]] : []), ["guide","How it works",views.guide], ["help","Help",views.help]]);
/* ---------- first-login tour (3 short steps) ---------- */
const TOUR_KEY = "opus-tour-v1";
const tourSteps = () => me.tracked ? [
  ["Check in on Today", `Today opens ${S.checkin_open_min} minutes before your shift. Tap the big button. On office days you need to be within ${S.radius_m} m of the office, so allow location access. Remote days need no location.`],
  ["Breaks and status, same page", `After you check in, tap Break or status to start a break, a meeting or a task. ${S.min_available} teammate(s) always stay available, so a break can wait until someone is free. Tap Back to available when you return.`],
  ["Your month", "My month shows your points, adherence and schedule. Check out when you finish. If you forget, it happens automatically one minute after your shift."]
] : [
  ["Today", "Overtime requests and other things that need you appear at the top. Below them are the live board and today's check-ins."],
  ["Schedule", "Set the usual week once with the Weekly plan, or copy last month. Click a day to fix it. Rule problems show up with one-click fixes."],
  ["Reports and People", "Reports has points, adherence, the Excel report and the activity log. People has employees and the team rules."]
];
function startTour(){
  const dlg = $("#tourDlg"), steps = tourSteps(); let i = 0;
  const done = () => { try{ localStorage.setItem(TOUR_KEY, "1"); }catch{} dlg.close(); };
  const paint = () => {
    const [title, text] = steps[i], last = i === steps.length - 1;
    dlg.innerHTML = `<h2>${esc(title)}</h2><p class="tour-text">${esc(text)}</p>
      <div class="tour-dots" aria-hidden="true">${steps.map((_, n) => `<i class="${n===i?"on":""}"></i>`).join("")}</div>
      <div class="actions" style="justify-content:space-between"><button class="btn" id="tSkip">${last ? "Back" : "Skip"}</button><button class="btn primary" id="tNext">${last ? "Done" : "Next"}</button></div>`;
    $("#tSkip").onclick = () => last ? (i--, paint()) : done();
    $("#tNext").onclick = () => last ? done() : (i++, paint());
  };
  dlg.onclose = () => { try{ localStorage.setItem(TOUR_KEY, "1"); }catch{} };
  paint(); if(!dlg.open) dlg.showModal();
}
function maybeTour(){
  try{ if(localStorage.getItem(TOUR_KEY)) return; }catch{ return; }
  if(me) startTour();
}
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
$("#helpBtn").onclick = () => goTo("account", "guide");
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
  $("#who").innerHTML = `${avatar(me.name, me.id)}<div><div class="nm">${esc(me.name)}</div><div class="rl">${esc(roleLabel(me))}</div></div>`;
  if(me.tracked) await loadMine(ymOf(dkey(now())));
  await refreshLive();
  renderTabs(); setTab(tab); maybeTour();
  setInterval(() => { if(!document.hidden) refreshLive(); }, 15000);
  if(!poller) poller = setInterval(async () => { if(document.hidden) return; if(me.tracked && ["today","month"].includes(tab)){ await loadMine(ymOf(dkey(now()))); update(); } }, 60000);
}
sb.auth.onAuthStateChange((ev, session) => {
  if(session) setTimeout(startApp, 0);
  else { started = false; me = null; showLogin(pendingMsg); pendingMsg = ""; }
});
sb.auth.getSession().then(({ data }) => { if(!data.session) showLogin(""); });
