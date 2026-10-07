"use strict";
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

