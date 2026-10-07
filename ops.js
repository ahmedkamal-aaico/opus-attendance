"use strict";
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
