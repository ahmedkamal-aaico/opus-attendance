"use strict";
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

