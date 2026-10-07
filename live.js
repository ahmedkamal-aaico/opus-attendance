"use strict";
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
