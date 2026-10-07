"use strict";
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
