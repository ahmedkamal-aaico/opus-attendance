"use strict";
const SUPABASE_URL = "https://letstuovdrfxihrtrwdy.supabase.co";
const SUPABASE_KEY = "sb_publishable_hY_4KuyHayNUk5vdu_kbrQ_jJXmeD6M";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let serverOffset = 0;
const now = () => Date.now() + serverOffset;
let S = { tz:"Asia/Dubai", grace_min:5, early_min:10, early_max:60, early_per_clear:3, late_allowance:2, max_clears:2, break_short_min:15, break_short_count:2, break_long_min:30, break_long_count:1, break_wc_min:5, break_wc_count:2, min_available:1, break_alert_after_min:15, workdays:[1,2,3,4,5], holidays:[], default_shift:"s08", radius_m:500 };
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
  const base = shifts[emp.shift_id] || shifts[S.default_shift] || Object.values(shifts)[0] || {start:"08:00",end:"17:00"};
  if(row !== undefined){
    if(row === null) return { off:true, sh:base, planned:true };
    if(shifts[row]) return { off:false, sh:shifts[row], planned:true };
  }
  return { off:!isWorkday(k), sh:base, planned:false };
}
function dayStatus(emp, k, rec, schedMap){
  const today = dkey(now());
  if(k > today) return { s:"future" };
  if(emp.since && k < emp.since) return { s:"na" };
  const { off, sh } = shiftFor(emp, k, schedMap), start = pHM(sh.start), end = pHM(sh.end);
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
      if(c.late <= S.late_allowance){ st.allowed = c.late; c.allowed++; } else c.red++;
      if(st.s==="late") c.office++; else c.remote++;
    }
    else if(st.s==="early"){ c.early++; c.office++; }
    else if(st.s==="ontime"){ c.ontime++; c.office++; }
    else if(st.s==="remote") c.remote++;
    else if(st.s==="absent"){ c.absent++; c.black++; }
    c.rows.push({ k, ...st });
  }
  for(const a of adj) if(a.employee_id===emp.id && a.month===ym){ if(a.type==="red") c.red += a.delta; else if(a.type==="black") c.black += a.delta; }
  c.red = Math.max(0, c.red); c.black = Math.max(0, c.black);
  const per = Math.max(1, S.early_per_clear||3), cap = Math.max(0, S.max_clears ?? 2);
  c.cleared = Math.min(c.red, Math.floor(c.early / per), cap);
  c.red -= c.cleared;
  c.clearsLeft = cap - c.cleared;
  c.toNext = c.red > 0 && c.clearsLeft > 0 ? per - (c.early - c.cleared*per) : 0;
  c.lateLeft = Math.max(0, S.late_allowance - c.late);
  c.penalties = c.red + c.black;
  return c;
}
const dayFrom = (sum, k, fallback) => sum.rows.find(r => r.k === k) || fallback;
function chip(st){
  const map = {
    early:[`Early ${st.ahead||""} min, +1 credit`,"early"], ontime:["On time","ontime"],
    late: st.allowed ? [`Late ${st.by||""} min, allowed (${st.allowed} of ${S.late_allowance})`,"pending"] : [`Late ${st.by||""} min, +1 red`,"late"], absent:["Absent, +1 black","absent"],
    remote:["Remote, on time","remote"], remotelate: st.allowed ? [`Remote, late ${st.by||""} min, allowed (${st.allowed} of ${S.late_allowance})`,"pending"] : [`Remote, late ${st.by||""} min, +1 red`,"late"],
    off:["Day off","off"], pending:["Not checked in","pending"], na:["Not started","na"], future:["",""]
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
async function loadMine(ym){
  if(!me) return;
  const a = `${ym}-01`, b = monthEnd(ym);
  const [att, sc, adj] = await Promise.all([
    sb.from("attendance").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("schedule").select("*").eq("employee_id",me.id).gte("day",a).lte("day",b),
    sb.from("adjustments").select("*").eq("employee_id",me.id).eq("month",ym)
  ]);
  mine.ym = ym;
  mine.att = toMap(att.data||[], r=>r);
  mine.sched = toMap(sc.data||[], r=>r.shift_id);
  mine.adj = adj.data||[];
}
async function loadTeam(ym){
  team.loading = true; update();
  const a = `${ym}-01`, b = monthEnd(ym);
  const [att, sc, adj, al] = await Promise.all([
    sb.from("attendance").select("*").gte("day",a).lte("day",b),
    sb.from("schedule").select("*").gte("day",a).lte("day",b),
    sb.from("adjustments").select("*").eq("month",ym).order("created_at",{ascending:false}),
    sb.from("alerts_sent").select("*").gte("day",a).lte("day",b)
  ]);
  team.ym = ym;
  team.att = toMap(att.data||[], r=>r);
  team.sched = toMap(sc.data||[], r=>r.shift_id);
  team.adj = adj.data||[];
  team.alerts = toMap(al.data||[], r=>r);
  team.loading = false; update();
}
const tracked = () => emps.filter(e => e.active && e.tracked);

/* ---------- shell ---------- */
let tab = null;
const views = {};
function tabsFor(){
  const t = [];
  if(me?.tracked) t.push(["office","Office"],["remote","Remote"],["live","Live board"],["mine","My points"],["myschedule","My schedule"]);
  if(me?.is_admin){ if(t.length) t.push(["sep"]); else t.push(["live","Live board"]); t.push(["team","Attendance today"],["points","Points report"],["schedule","Schedule"],["people","Employees"],["settings","Settings"]); }
  return t;
}
function renderTabs(){
  const t = tabsFor();
  if(!tab || !t.some(x=>x[0]===tab)) tab = t[0]?.[0];
  $("#tabs").innerHTML = t.map(([k,l]) => k==="sep" ? `<span class="sep"></span>` : `<button role="tab" aria-selected="${tab===k}" data-t="${k}">${l}</button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(x => x.onclick = () => setTab(x.dataset.t));
}
function setTab(t){ tab = t; renderTabs(); views[tab].mount($("#main")); }
function update(){ const v = views[tab]; if(v && v.update) v.update(); }

/* ---------- live board & breaks ---------- */
let live = [], liveLoaded = false;
const fmtClock = sec => { const a = Math.abs(Math.round(sec)); return `${Math.floor(a/60)}m ${String(a%60).padStart(2,"0")}s`; };
function liveState(r){
  if(!r.check_in) return r.is_off ? { s:"off" } : { s:"notin" };
  if(r.check_out) return { s:"done" };
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
  if(["live","office","remote"].includes(tab)) update();
  paintAlerts();
}
function breaksLeft(r){ return { short: Math.max(0, S.break_short_count - (r?.short_used||0)), long: Math.max(0, S.break_long_count - (r?.long_used||0)), wc: Math.max(0, S.break_wc_count - (r?.wc_used||0)) }; }
const breakName = r => r.break_kind==="wc" ? "WC break" : `${r.break_allowed}-min break`;
function paintAlerts(){
  const bar = $("#alertbar"); if(!bar) return;
  const msgs = [];
  const mineRow = live.find(r => r.employee_id === me?.id);
  if(mineRow){ const st = liveState(mineRow); if(st.s==="over") msgs.push(`You are ${Math.floor((st.el-st.allowed)/60)} min over your break. End it from the ${mineRow.mode==="remote"?"Remote":"Office"} tab.`); }
  if(me?.is_admin) for(const r of live){ if(r.employee_id===me.id) continue; const st = liveState(r); if(st.alert) msgs.push(`${r.name} is ${Math.floor((st.el-st.allowed)/60)} min over break.`); }
  bar.hidden = !msgs.length; bar.innerHTML = msgs.map(m=>`<div>${esc(m)}</div>`).join("");
  document.title = msgs.length ? "Over break | Opus Support Attendance" : "Opus Support Attendance | Applied AI";
}
function tickBreaks(){
  document.querySelectorAll("[data-bstart]").forEach(el => {
    const el2 = (now() - Number(el.dataset.bstart)) / 1000, allowed = Number(el.dataset.ballow) * 60;
    const over = el2 > allowed;
    el.textContent = over ? `${fmtClock(el2-allowed)} over` : `${fmtClock(allowed-el2)} left`;
    el.closest("[data-bwrap]")?.classList.toggle("is-over", over);
  });
  paintAlerts();
}
const STATUS = { available:["Available","available"], break:["On break","break"], over:["Over break","over"], notin:["Not checked in","notin"], done:["Checked out","done"], off:["Day off","off"] };
views.live = {
  mount(el){ this.el = el; el.innerHTML = `<div id="lvBody"><p class="muted">Loading</p></div>`; refreshLive(); this.update(); },
  update(){
    if(tab!=="live" || !liveLoaded) return;
    const rows = live.map(r => ({ r, st: liveState(r) }));
    const n = s => rows.filter(x=>x.st.s===s).length;
    const order = { over:0, break:1, available:2, notin:3, done:4, off:5 };
    rows.sort((a,b)=>order[a.st.s]-order[b.st.s] || a.r.name.localeCompare(b.r.name));
    $("#lvBody").innerHTML = `
      <div class="panel"><div class="tally">
        <div class="t-g"><div class="n">${n("available")}</div><div class="l">Available</div></div>
        <div class="t-a"><div class="n">${n("break")}</div><div class="l muted">On break</div></div>
        <div class="t-r"><div class="n">${n("over")}</div><div class="l">Over break</div></div>
        <div class="t-b"><div class="n">${n("notin")}</div><div class="l">Not checked in</div></div>
      </div><p class="hint">Updates on its own every 15 seconds. At least ${S.min_available} teammate(s) must stay available, so a break can only start when someone else is free.</p></div>
      <div class="board">${rows.map(({r,st}) => { const [t,c] = STATUS[st.s]; const left = breaksLeft(r);
        return `<div class="pcard st-${c}" ${st.s==="break"||st.s==="over" ? "data-bwrap" : ""}>
          <div class="pc-top"><b>${esc(r.name)}${r.employee_id===me.id?" <span class='muted small'>(you)</span>":""}</b><span class="pill p-${c}">${t}</span></div>
          <div class="small muted">${r.is_off && !r.check_in ? "No shift today" : `Shift ${short(r.shift_start)} to ${short(r.shift_end)}`}${me.is_admin && r.check_in && !r.check_out ? `, ${r.mode==="remote"?"remote":"office"} since ${tstr(r.check_in)}` : ""}</div>
          ${st.s==="break"||st.s==="over" ? `<div class="pc-timer">${breakName(r)}, <span data-bstart="${Date.parse(r.break_started)}" data-ballow="${r.break_allowed}"></span></div>` : ""}
          ${r.check_in && !r.check_out ? `<div class="small muted">Breaks left: ${left.short} × ${S.break_short_min} min, ${left.long} × ${S.break_long_min} min, ${left.wc} × WC</div>` : ""}
        </div>`; }).join("")}</div>`;
    tickBreaks();
  }
};
function breakPanel(rec, mode){
  if(!rec || rec.check_out || rec.mode !== mode) return "";
  if(!liveLoaded) return `<section class="panel"><h2>Breaks</h2><p class="muted">Loading</p></section>`;
  const mineRow = live.find(r => r.employee_id === me.id);
  const st = mineRow ? liveState(mineRow) : { s:"available" };
  if(st.s==="break" || st.s==="over"){
    return `<section class="panel brk" data-bwrap><div class="punch"><div><div class="small muted">On a ${breakName(mineRow)} since ${tstr(mineRow.break_started)}</div>
      <div class="brk-time" data-bstart="${Date.parse(mineRow.break_started)}" data-ballow="${mineRow.break_allowed}"></div></div>
      <button class="btn primary big" id="bEnd">End break</button></div></section>`;
  }
  const left = breaksLeft(mineRow);
  const others = live.filter(r => r.employee_id !== me.id && liveState(r).s === "available").length;
  const blocked = others < S.min_available;
  const away = live.filter(r => ["break","over"].includes(liveState(r).s)).map(r => { const x = liveState(r); return `${r.name} (${x.s==="over" ? "over" : Math.ceil((x.allowed-x.el)/60)+" min left"})`; });
  return `<section class="panel"><h2>Breaks</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="bShort" ${!left.short||blocked?"disabled":""}>Start ${S.break_short_min}-min break (${left.short} left)</button>
      <button class="btn" id="bLong" ${!left.long||blocked?"disabled":""}>Start ${S.break_long_min}-min break (${left.long} left)</button>
      <button class="btn" id="bWc" ${!left.wc||blocked?"disabled":""}>${S.break_wc_min}Min/WC (${left.wc} left)</button>
    </div>
    <p class="hint">${blocked ? `Wait until a teammate is free. At least ${S.min_available} must stay available.${away.length ? " On break now: "+esc(away.join(", "))+"." : ""}` : `Take them in any order during your shift. ${others} teammate(s) available now.`}</p>
  </section>`;
}
async function breakAction(fn, args, btn){
  btn.disabled = true;
  const { error } = await sb.rpc(fn, args);
  if(error){ toast(errMsg(error)); btn.disabled = false; return; }
  toast(fn==="start_break" ? "Break started" : "Welcome back"); await refreshLive();
}

/* ---------- check-in ---------- */
function checkinView(mode){
  return {
    mount(el){ this.el = el; this.update(); },
    update(){
      if(tab!==mode || !me) return;
      const t = now(), k = dkey(t);
      if(mine.ym !== ymOf(k)){ loadMine(ymOf(k)).then(()=>this.update()); }
      const sf = shiftFor(me, k, mine.sched), sh = sf.sh, start = pHM(sh.start), end = pHM(sh.end);
      const rec = mine.att[`${me.id}|${k}`];
      const sum = summarize(me, ymOf(k), mine.att, mine.sched, mine.adj);
      const st = dayFrom(sum, k, dayStatus(me, k, rec, mine.sched));
      const other = mode==="office" ? "Remote" : "Office";
      let state, buttons = "";
      if(sf.off) state = `<b>Day off.</b> <span class="muted">No shift scheduled today.</span>`;
      else if(!rec){
        state = mode==="office"
          ? `<b>Not checked in.</b> <span class="muted">Shift starts ${esc(sh.start)}. You need to be within ${S.radius_m} m of the office.</span>`
          : `<b>Working from home today?</b> <span class="muted">Shift starts ${esc(sh.start)}. A late check-in still gets a red point.</span>`;
        buttons = `<button class="btn primary big" id="bIn">Check in ${mode==="office"?"at the office":"remotely"}</button>`;
      } else if(rec.mode !== mode){
        state = `<b>You checked in ${rec.mode==="remote"?"remotely":"at the office"} at ${tstr(rec.check_in)}.</b> <span class="muted">Use the ${other} tab to check out.</span>`;
      } else if(!rec.check_out){
        state = `<b>Checked in at ${tstr(rec.check_in)}.</b> ${chip(st)}`;
        buttons = `<button class="btn big" id="bOut">Check out</button>`;
      } else state = `<b>Done for today.</b> <span class="muted">${tstr(rec.check_in)} to ${tstr(rec.check_out)}</span> ${chip(st)}`;
      const lo = Math.max(0, start - Math.max(60, S.early_max + 10)), hi = Math.min(1440, end);
      const pct = m => Math.max(0, Math.min(100, (m-lo)/(hi-lo)*100));
      this.el.innerHTML = `
        <section class="clock">
          <div class="date">${esc(longDate(k))}, UAE time</div>
          <div class="time" id="clk">--:--:--</div>
          <div class="src"><i></i>Server time</div>
        </section>
        <section class="panel">
          <div class="shift-head"><span><b>Today's shift ${esc(sh.start)} to ${esc(sh.end)}</b></span><span class="small muted">${sf.planned ? "From this month's schedule" : "Default shift"}</span></div>
          <div class="bar" aria-label="Shift timeline">
            ${mode==="office" ? `<div class="z e" style="left:${pct(start-S.early_max)}%;width:${pct(start-S.early_min)-pct(start-S.early_max)}%"></div>` : ""}
            <div class="z l" style="left:${pct(start+S.grace_min)}%;right:0"></div>
            ${rec && rec.mode===mode ? `<div class="mark" style="left:${pct(mins(ts(rec.check_in)))}%"></div>` : ""}
            <div class="needle" id="needle" style="left:${pct(mins(t))}%"></div>
          </div>
          <div class="ticks"><span style="left:0">${hm(lo)}</span><span style="left:${pct(start)}%">${hm(start)}</span><span style="left:100%">${hm(hi)}</span></div>
          <div class="rules">
            ${mode==="office" ? `<span><em style="background:var(--zone-early)"></em>${hm(start-S.early_max)} to ${hm(start-S.early_min)}: early credit (${S.early_per_clear} clear 1 red)</span>` : ""}
            <span><em style="background:var(--zone-ok)"></em>Until ${hm(start+S.grace_min)}: on time</span>
            <span><em style="background:var(--zone-late)"></em>After ${hm(start+S.grace_min)}: late (${S.late_allowance} allowed per month, then +1 red)</span>
            <span><em style="background:var(--blk-bg)"></em>No check-in: +1 black</span>
          </div>
        </section>
        <section class="panel punch"><div class="state">${state}</div><div>${buttons}</div></section>
        ${breakPanel(rec, mode)}
        <section class="panel">
          <h2>${esc(monthLabel(ymOf(k)))} so far</h2>
          <div class="tally">
            <div class="t-g"><div class="n">${sum.early}</div><div class="l">Early credits</div></div>
            <div class="t-r"><div class="n">${sum.red}</div><div class="l">Red${sum.cleared?`, ${sum.cleared} cleared`:""}</div></div>
            <div class="t-b"><div class="n">${sum.black}</div><div class="l">Black</div></div>
            <div class="t-a"><div class="n">${sum.penalties}</div><div class="l muted">Total penalties</div></div>
          </div>
          <p class="hint">${sum.lateLeft} allowed late day(s) left this month. ${sum.clearsLeft} early-credit clear(s) left this month. Everything resets on the 1st.</p>
        </section>`;
      this.lo = lo; this.hi = hi; tick(); tickBreaks();
      const bs = $("#bShort"), bl = $("#bLong"), be = $("#bEnd");
      if(bs) bs.onclick = () => breakAction("start_break", { p_kind:"short" }, bs);
      if(bl) bl.onclick = () => breakAction("start_break", { p_kind:"long" }, bl);
      const bw = $("#bWc"); if(bw) bw.onclick = () => breakAction("start_break", { p_kind:"wc" }, bw);
      if(be) be.onclick = () => breakAction("end_break", {}, be);
      const bi = $("#bIn"), bo = $("#bOut");
      if(bi) bi.onclick = () => punch("in", mode, bi);
      if(bo) bo.onclick = () => punch("out", mode, bo);
    }
  };
}
views.office = checkinView("office");
views.remote = checkinView("remote");
function tick(){
  const c = $("#clk"); if(!c) return;
  const p = parts(now());
  c.textContent = `${String(p.h).padStart(2,"0")}:${String(p.mi).padStart(2,"0")}:${String(p.s).padStart(2,"0")}`;
  const v = views[tab], n = $("#needle");
  if(n && v && v.hi) n.style.left = Math.max(0,Math.min(100,(mins(now())-v.lo)/(v.hi-v.lo)*100))+"%";
}
setInterval(() => { tick(); tickBreaks(); }, 1000);

async function punch(kind, mode, btn){
  btn.disabled = true; const label = btn.textContent; btn.textContent = mode==="office" ? "Checking location" : "Saving";
  try{
    let lat = null, lng = null;
    if(mode==="office"){ const p = await getPos(); lat = p.coords.latitude; lng = p.coords.longitude; }
    const { data, error } = kind==="in"
      ? await sb.rpc("check_in", { p_mode:mode, p_lat:lat, p_lng:lng })
      : await sb.rpc("check_out", { p_lat:lat, p_lng:lng });
    if(error) throw error;
    mine.att[`${me.id}|${data.day}`] = data; refreshLive();
    toast(kind==="in" ? `Checked in at ${tstr(data.check_in)}` : `Checked out at ${tstr(data.check_out)}`);
    update();
  }catch(e){ toast(errMsg(e)); btn.disabled = false; btn.textContent = label; }
}

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
      ${mine.adj.length ? `<div class="panel"><h2>Manager adjustments</h2>${mine.adj.map(a=>`<div class="item"><span>${a.delta>0?"+1":"-1"} ${esc(a.type)}</span><span class="muted small">${esc(a.reason)}</span></div>`).join("")}</div>` : ""}
      <div class="panel scroll">${rows.length ? `<table class="rows"><thead><tr><th>Date</th><th>Where</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>
        ${rows.map(r=>{ const d = mine.att[`${me.id}|${r.k}`]; return `<tr><td>${esc(prettyDate(r.k))}</td><td class="small">${d ? (d.mode==="remote"?"Remote":"Office") : ""}</td><td>${tstr(d?.check_in)}</td><td>${tstr(d?.check_out)}</td><td>${chip(r)}</td></tr>`; }).join("")}
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
    let off=0, rem=0, late=0, abs=0;
    const rows = list.map(e => {
      const rec = team.att[`${e.id}|${k}`], sh = shiftFor(e, k, team.sched);
      const st = dayFrom(summarize(e, ymOf(k), team.att, team.sched, team.adj), k, dayStatus(e, k, rec, team.sched));
      if(rec?.mode==="remote") rem++; else if(rec) off++;
      if(st.s==="late"||st.s==="remotelate") late++; if(st.s==="absent") abs++;
      const flags = [];
      if(rec?.in_dist != null) flags.push(`${rec.in_dist} m from office`);
      if(team.alerts[`${e.id}|${k}`]) flags.push("late alert emailed");
      if(!e.email) flags.push("no email set");
      return `<tr><td>${esc(e.name)}</td><td class="small">${sh.off ? "Off" : `${esc(sh.sh.start)} to ${esc(sh.sh.end)}`}</td><td class="small">${rec ? (rec.mode==="remote"?"Remote":"Office") : ""}</td><td>${tstr(rec?.check_in)}</td><td>${tstr(rec?.check_out)}</td><td>${chip(st)}${flags.length?`<div class="flag">${esc(flags.join(", "))}</div>`:""}</td></tr>`;
    }).join("");
    $("#tBody").innerHTML = `
      <div class="panel"><div class="tally">
        <div class="t-a"><div class="n">${off}</div><div class="l muted">At the office</div></div>
        <div class="t-a"><div class="n">${rem}</div><div class="l muted">Remote</div></div>
        <div class="t-r"><div class="n">${late}</div><div class="l">Late</div></div>
        <div class="t-b"><div class="n">${abs}</div><div class="l">Absent</div></div>
      </div></div>
      <div class="panel scroll"><table class="rows"><thead><tr><th>Employee</th><th>Shift</th><th>Where</th><th>In</th><th>Out</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
    this.rows = tracked().map(e => ({ e, s: summarize(e, this.ym, team.att, team.sched, team.adj) }));
    $("#rBody").innerHTML = this.rows.length ? `<div class="panel scroll"><table class="rows"><thead><tr><th>Employee</th><th class="num">Office</th><th class="num">Remote</th><th class="num">Early</th><th class="num">Late</th><th class="num">Allowed</th><th class="num">Absent</th><th class="num">Cleared</th><th class="num">Red</th><th class="num">Black</th><th class="num">Penalties</th></tr></thead><tbody>
      ${this.rows.map(({e,s})=>`<tr><td>${esc(e.name)}</td><td class="num">${s.office}</td><td class="num">${s.remote}</td><td class="num">${s.early}</td><td class="num">${s.late}</td><td class="num">${s.allowed}</td><td class="num">${s.absent}</td><td class="num">${s.cleared}</td><td class="num">${s.red}</td><td class="num">${s.black}</td><td class="num"><b>${s.penalties}</b></td></tr>`).join("")}
      </tbody></table><p class="hint">The first ${S.late_allowance} late days each month are allowed with no red. Every ${S.early_per_clear} early office days clear 1 red, up to ${S.max_clears} times a month. Counts reset on the 1st. Red and black include manager adjustments.</p></div>` : `<div class="panel"><p class="empty">No tracked employees.</p></div>`;
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
    const lines = [["Employee","Month","Office days","Remote days","Early","On time","Late","Allowed lates","Absent","Reds cleared","Red","Black","Penalties"].map(q).join(",")];
    for(const {e,s} of r) lines.push([e.name,this.ym,s.office,s.remote,s.early,s.ontime,s.late,s.allowed,s.absent,s.cleared,s.red,s.black,s.penalties].map(q).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv"}));
    const a = document.createElement("a"); a.href = url; a.download = `opus-points-${this.ym}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
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
        <p class="hint">Date range applies to working days only. Weekends and holidays stay off. One day changes that exact day, weekends included.</p>
      </div>
      <div class="panel"><h2>Month overview</h2><div id="scBody"><p class="muted">Loading</p></div></div>`;
    $("#scSel").onchange = e => { this.ym = e.target.value; this.renderEdit(); loadTeam(this.ym); };
    this.renderEdit(); loadTeam(this.ym);
  },
  renderEdit(){
    const a = `${this.ym}-01`, b = monthEnd(this.ym);
    const today = dkey(now()), start = today > a && today <= b ? today : a;
    const opts = `${Object.keys(shifts).map(id=>`<option value="${id}">${esc(shiftLabel(id))}</option>`).join("")}<option value="off">Day off</option>`;
    $("#scEdit").innerHTML = `<div class="scroll"><table class="rows edit"><thead><tr><th>Agent</th><th>Shift</th><th>Apply to</th><th>From</th><th>To</th><th></th></tr></thead><tbody>
      ${tracked().map(e=>`<tr data-e="${e.id}">
        <td><b>${esc(e.name)}</b></td>
        <td><select class="inl" data-f="shift">${opts.replace(`value="${e.shift_id}"`,`value="${e.shift_id}" selected`)}</select></td>
        <td><select class="inl" data-f="mode"><option value="range">Date range</option><option value="day">One day</option></select></td>
        <td><input class="inl" type="date" data-f="from" value="${start}" min="${a}" max="${b}"></td>
        <td><input class="inl" type="date" data-f="to" value="${b}" min="${a}" max="${b}"></td>
        <td><button class="btn primary small" data-f="apply">Apply</button></td></tr>`).join("")}
      </tbody></table></div>`;
    $("#scEdit").querySelectorAll("tr[data-e]").forEach(tr => {
      const g = f => tr.querySelector(`[data-f="${f}"]`);
      g("mode").onchange = () => { const one = g("mode").value==="day"; g("to").style.visibility = one ? "hidden" : "visible"; };
      g("apply").onclick = () => this.apply(tr.dataset.e, g("shift").value, g("mode").value, g("from").value, g("to").value, g("apply"));
    });
  },
  async apply(eid, shift, mode, from, to, btn){
    if(mode==="day") to = from;
    if(!from || !to || to < from){ toast("Pick a valid date range."); return; }
    const rows = [];
    for(const k of monthKeys(this.ym)){
      if(k < from || k > to) continue;
      const v = shift==="off" ? null : shift;
      rows.push({ employee_id:eid, day:k, shift_id: mode==="range" && !isWorkday(k) ? null : v });
    }
    btn.disabled = true;
    const { error } = await sb.from("schedule").upsert(rows, { onConflict:"employee_id,day" });
    btn.disabled = false;
    if(error){ toast(errMsg(error)); return; }
    const name = emps.find(e=>e.id===eid)?.name || "";
    toast(mode==="day" ? `${name}: ${prettyDate(from)} saved` : `${name}: ${prettyDate(from)} to ${prettyDate(to)} saved`);
    loadTeam(this.ym);
  },
  update(){
    if(tab!=="schedule") return;
    if(team.loading || team.ym !== this.ym){ $("#scBody").innerHTML = `<p class="muted">Loading</p>`; return; }
    const days = monthKeys(this.ym), list = tracked();
    const cell = (e,k) => { const sf = shiftFor(e,k,team.sched); const t = sf.off ? "Off" : sf.sh.start.replace(":00",""); return `<td class="num small ${sf.off?"muted":""}" ${sf.planned?"":'style="opacity:.55"'}>${t}</td>`; };
    $("#scBody").innerHTML = list.length ? `<div class="scroll"><table class="rows sched"><thead><tr><th>Agent</th>${days.map(k=>`<th class="num">${DOW[wdOf(k)].slice(0,2)}<br>${+k.slice(8)}</th>`).join("")}</tr></thead><tbody>
      ${list.map(e=>`<tr><td>${esc(e.name)}</td>${days.map(k=>cell(e,k)).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="hint">Faded = not set yet, using the agent's default shift.</p>` : `<p class="empty">No tracked employees.</p>`;
  }
};
views.myschedule = {
  mount(el){
    this.el = el; const ym = ymOf(dkey(now()));
    el.innerHTML = `<div class="panel"><h2>My shifts, ${esc(monthLabel(ym))}</h2><div id="msList"><p class="muted">Loading</p></div></div>`;
    (mine.ym===ym ? Promise.resolve() : loadMine(ym)).then(()=>{
      if(tab!=="myschedule") return;
      const today = dkey(now());
      $("#msList").innerHTML = `<div class="scroll"><table class="rows"><tbody>${monthKeys(ym).filter(k=>k>=today).map(k=>{ const sf = shiftFor(me,k,mine.sched); return `<tr><td>${esc(prettyDate(k))}${k===today?" <span class='chip c-pending'>Today</span>":""}</td><td>${sf.off?`<span class="muted">Off</span>`:`${esc(sf.sh.start)} to ${esc(sf.sh.end)}`}</td></tr>`; }).join("")}</tbody></table></div>`;
    });
  }
};

/* ---------- admin: employees ---------- */
views.people = {
  mount(el){ this.el = el; this.render(); },
  render(){
    const shOpts = sel => Object.keys(shifts).map(id=>`<option value="${id}" ${sel===id?"selected":""}>${esc(shiftLabel(id))}</option>`).join("");
    this.el.innerHTML = `<div class="panel scroll"><table class="rows"><thead><tr><th>Name</th><th>Work email (login)</th><th>Default shift</th><th>Counts from</th><th>Tracked</th><th>Manager</th><th>Active</th><th></th></tr></thead><tbody>
      ${emps.map(e=>`<tr data-id="${e.id}">
        <td><input class="inl" data-f="name" value="${esc(e.name)}" maxlength="60"></td>
        <td><input class="inl" type="email" data-f="email" value="${esc(e.email||"")}" placeholder="name@company.com"></td>
        <td><select class="inl" data-f="shift_id">${shOpts(e.shift_id)}</select></td>
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
      const row = { name:g("name").value.trim(), email:email||null, shift_id:g("shift_id").value, since:g("since").value||null, tracked:g("tracked").checked, is_admin:g("is_admin").checked, active:g("active").checked };
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
          <label class="f">Must stay available<input type="number" min="0" id="sMinA" value="${S.min_available}"></label>
          <label class="f">Alert after (min over)<input type="number" min="1" id="sBal" value="${S.break_alert_after_min}"></label>
        </div>
        <p class="hint">All breaks, WC included, need a teammate to stay available. Over the break length shows red on the Live board. Past the alert time, the employee and all managers get an email.</p>
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
      <div class="panel"><h2>Late alerts by email</h2>
        <label class="chk"><input type="checkbox" id="sAl" ${S.alerts_enabled?"checked":""}>Email the employee and all managers when nobody checks in within the late threshold</label>
        <label class="f" style="margin-top:12px">Sender address (verified in Resend)<input id="sFrom" value="${esc(S.alert_from||"")}" placeholder="Opus Attendance &lt;attendance@yourdomain.com&gt;"></label>
        <p class="hint">Alerts stop being sent 2 hours after the shift starts. One alert per employee per day.</p>
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
        grace_min: Math.max(0, +$("#sGrace").value||0), early_min: Math.max(1, +$("#sEarly").value||10), early_max: Math.max(2, +$("#sEMax").value||60), early_per_clear: Math.max(1, Math.round(+$("#sPer").value||3)), max_clears: Math.max(0, Math.round(+$("#sMaxC").value||0)), late_allowance: Math.max(0, Math.round(+$("#sAllow").value||0)),
        workdays: [...document.querySelectorAll("[data-wd]")].filter(x=>x.checked).map(x=>+x.dataset.wd), holidays: hol,
        office_lat: lat, office_lng: lng, radius_m: Math.max(50, +$("#sRad").value||500),
        alerts_enabled: $("#sAl").checked,
        break_short_min: Math.max(1, +$("#sBsm").value||15), break_short_count: Math.max(0, Math.round(+$("#sBsc").value||0)),
        break_long_min: Math.max(1, +$("#sBlm").value||30), break_long_count: Math.max(0, Math.round(+$("#sBlc").value||0)),
        break_wc_min: Math.max(1, +$("#sBwm").value||5), break_wc_count: Math.max(0, Math.round(+$("#sBwc").value||0)),
        min_available: Math.max(0, Math.round(+$("#sMinA").value||0)), break_alert_after_min: Math.max(1, +$("#sBal").value||15), alert_from: $("#sFrom").value.trim() || null
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
  $("#who").innerHTML = `<span>${esc(me.name)}</span><span class="role">${me.is_admin?"Manager":"Team member"}</span>`;
  if(me.tracked) await loadMine(ymOf(dkey(now())));
  await refreshLive();
  renderTabs(); setTab(tab);
  setInterval(() => { if(!document.hidden) refreshLive(); }, 15000);
  if(!poller) poller = setInterval(async () => { if(document.hidden) return; if(me.tracked && ["office","remote"].includes(tab)){ await loadMine(ymOf(dkey(now()))); update(); } }, 60000);
}
sb.auth.onAuthStateChange((ev, session) => {
  if(session) setTimeout(startApp, 0);
  else { started = false; me = null; showLogin(pendingMsg); pendingMsg = ""; }
});
sb.auth.getSession().then(({ data }) => { if(!data.session) showLogin(""); });
