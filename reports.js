"use strict";
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
