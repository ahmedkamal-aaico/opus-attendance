"use strict";
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
