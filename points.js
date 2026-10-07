"use strict";

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

