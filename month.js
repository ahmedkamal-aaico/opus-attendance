"use strict";
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
