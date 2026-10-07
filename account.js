"use strict";
/* ---------- night mode ---------- */
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t==="dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
function paintThemeButtons(){ const on = isDark(); document.querySelectorAll("[data-theme-toggle]").forEach(b => { b.setAttribute("aria-pressed", String(on)); b.querySelector(".tl").textContent = on ? "Night mode on" : "Night mode off"; }); }
function toggleTheme(){
  const root = document.documentElement;
  if(!reduceMotion()){ root.classList.add("theme-anim"); clearTimeout(toggleTheme._t); toggleTheme._t = setTimeout(() => root.classList.remove("theme-anim"), 450); }
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try{ localStorage.setItem("opus-theme", next); }catch{}
  paintThemeButtons();
}
document.querySelectorAll("[data-theme-toggle]").forEach(b => b.onclick = toggleTheme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintThemeButtons);
paintThemeButtons();

/* ---------- how it works ---------- */
views.guide = {
  part:"everyone",
  mount(el){
    this.el = el;
    const R = RULES(), sh = Object.keys(shifts).map(id => `${shifts[id].start}–${shifts[id].end}`).join(", ");
    const seniors = schedPeople().filter(e=>e.senior).map(e=>e.name.split(" ")[0]).join(", ") || "none set";
    const pairs = (R.remote_pairs||[]).map(([a,b])=>`${enameOf(a).split(" ")[0]} and ${enameOf(b).split(" ")[0]}`).join("; ") || "none";
    const icon = k => `<span class="tc-i"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg></span>`;
    const topic = (ic, title, lines) => `<article class="tc">${icon(ic)}<h3>${title}</h3><ul>${lines.map(x=>`<li>${x}</li>`).join("")}</ul></article>`;
    const flow = list => `<div class="flow">${list.map(([t,d],i)=>`<div class="fl"><span class="fl-n">${i+1}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div>`;
    const pts = [["0","On time","By shift start","ok"],[S.late_allowance+" free","Late",`Up to ${S.late_hard_min} min, per month`,"mid"],["+1","Red",`Late after that, or over ${S.late_hard_min} min`,"red"],["+1","Black",`Absent, or over ${fmtMin(S.late_black_min)}`,"blk"],["−1 red","Early credit",`${S.early_per_clear} office early days, max ${S.max_clears}/month`,"green"]];
    const everyone = `
      ${flow([["Check in",`Opens ${S.checkin_open_min} min before your shift`],["Break or status","Breaks, meetings, tasks"],["Check out","Or automatic 1 min after"],["Your month","My month: points and schedule"]])}
      <section class="gx"><h2>Points</h2><div class="pts">${pts.map(([b,t,d,c])=>`<div class="pt ${c}"><span class="pt-b">${b}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div>
        <p class="hint">${S.grace_min} min grace at shift start. Resets on the 1st. ${S.review_threshold}+ penalties in a month means a review.</p></section>
      <div class="tcs">
        ${topic("checkin","Check in",[`Shifts: ${sh}`,`Office days: within ${S.radius_m} m of the office`,"Remote days: no location","Your schedule decides office or remote"])}
        ${topic("breaks","Breaks and status",[`${S.break_short_count}×${S.break_short_min} min, ${S.break_long_count}×${S.break_long_min} min, ${S.break_wc_count}×${S.break_wc_min} min WC`,`Not in the first or last ${S.break_edge_min} min`,`${S.min_available} teammate always stays available`,"Meetings and tasks have no limit"])}
        ${topic("team","End of day",["Auto check-out 1 min after your shift","Staying late? Extend shift, a manager approves",`Leaving over ${S.early_leave_min} min early is recorded`])}
        ${topic("schedule","Schedule and leave",["See your days in My month, Schedule",`Leave: ${LEAVE_ORDER.map(t=>LEAVE[t][0]).join(", ")}`,"Leave days carry no points"])}
        ${topic("mine","Adherence and streak",[`Target ${S.adherence_target}% of your time on schedule`,"Late, early leave, absence and over-break count against it","10 on-time days in a row earns the 2-week mark"])}
        ${topic("profile","Privacy",["Team sees: name, photo, title, shift, status","Full access sees: times, distance, points","Every change is in the Activity log"])}
      </div>
      <p class="hint">Something wrong? Open <b>Account → Help</b>. <button type="button" class="linkbtn" id="gdTour" style="margin:0 0 0 8px">Replay the tour</button></p>`;
    const full = me.is_admin ? `
      ${flow([["Weekly plan","Shifts and remote days, pick the dates"],["Fix days","Click a day in Month overview"],["Rule check","Keep it at 100%"],["Review","Download full report: week, month, year or custom dates"]])}
      <div class="tcs">
        ${topic("schedule","Schedule rules",[`${R.min_senior_office} senior in the office daily (${esc(seniors)})`,`Never remote together: ${esc(pairs)}`,R.night_needs_morning_office?"Morning shift (08 or 09): at least 1 in the office daily":"Morning office rule off",R.no_consecutive_remote?"No remote days in a row (Fri then Mon counts)":"Back-to-back remote allowed"])}
        ${topic("checkin","Editing days",["Click a day; Shift-click for a range","Ctrl or ⌘-click adds days","Weekly plan replaces day edits in its dates"])}
        ${topic("people","Access",["<b>Full access</b>: seniors, supervisors, managers, heads","<b>Member access</b>: agents","Seniors and supervisors are in the schedule only","Add people or change roles in People"])}
        ${topic("live","Daily",["Today: live board, check-ins and overtime approvals","Reports: adjust points with a reason, download the Excel report or a quick CSV","Reports, Activity log: every change, by whom and when"])}
        ${topic("settings","Rules",["People → Team rules holds every number","This guide updates itself from it"])}
      </div>` : "";
    el.innerHTML = `
      <div class="g-top">${me.is_admin ? `<div class="seg" id="gdTabs"><button type="button" class="seg-b ${this.part==="everyone"?"on":""}" data-v="everyone">Everyone</button><button type="button" class="seg-b ${this.part==="full"?"on":""}" data-v="full">Full access</button></div>` : ""}
        <input class="inl" id="gdQ" placeholder="Search: late, WC, overtime, remote"></div>
      <div id="gdList">${this.part==="full" && me.is_admin ? full : everyone}</div>`;
    const t = $("#gdTabs"); if(t) t.querySelectorAll(".seg-b").forEach(b => b.onclick = () => { this.part = b.dataset.v; this.mount(el); replay($("#gdList"), "pg-in"); });
    const tr = $("#gdTour"); if(tr) tr.onclick = () => startTour();
    $("#gdQ").oninput = e => { const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll("#gdList .tc, #gdList .gx, #gdList .flow").forEach(d => { d.hidden = !!q && !d.textContent.toLowerCase().includes(q); }); };
  }
};

/* ---------- report an issue ---------- */
const DEV_EMAIL = "ahmed.kamal@aaico.com";
views.help = { mount(el){ el.innerHTML = views.issue.html(); views.issue.wire(); } };
views.issue = {
  html(){ return `
      <section class="panel"><h2>Report a problem</h2>
        <div class="grid">
          <label class="f">What is it about?<select id="isCat"><option>Check in or check out</option><option>Breaks or status</option><option>Points or report</option><option>Schedule</option><option>Location or office distance</option><option>Sign in</option><option>Something else</option></select></label>
          <label class="f">Where did it happen?<select id="isPage">${tabsFor().filter(x=>x[0]!=="head").map(x=>`<option>${esc(x[1])}</option>`).join("")}<option>Other</option></select></label>
        </div>
        <label class="f" style="margin-top:12px">Describe the problem<textarea id="isMsg" rows="6" maxlength="2000" placeholder="What did you do, what did you expect, and what happened instead? Include the time if you can."></textarea></label>
        <div class="actions" style="justify-content:space-between;align-items:center">
          <span class="small muted">Goes to the developer at <a href="mailto:${DEV_EMAIL}">${DEV_EMAIL}</a></span>
          <button class="btn primary" id="isSend">Send to the developer</button>
        </div>
        <p class="hint">Your name, email, the time and your browser are added automatically. Your email app opens with the message ready; press send there. A copy is also saved in the system.</p>
      </section>
      <section class="panel"><h2>Your reports</h2><div id="isList"><p class="muted">Loading</p></div></section>`; },
  wire(){ $("#isSend").onclick = () => this.send($("#isSend")); this.list(); },
  async list(){
    const { data } = await sb.from("issues").select("*").eq("employee_id", me.id).order("created_at",{ascending:false}).limit(20);
    if(!$("#isList")) return;
    $("#isList").innerHTML = (data||[]).length ? data.map(r=>`<div class="item"><div><b>${esc(r.category)}</b> <span class="small muted">${esc(r.page||"")}</span><div class="small">${esc(r.message)}</div></div><span class="small muted nowrap">${esc(prettyDate(dkey(Date.parse(r.created_at))))}, ${tstr(r.created_at)}</span></div>`).join("") : `<p class="empty">No reports yet.</p>`;
  },
  async send(btn){
    const msg = $("#isMsg").value.trim(), cat = $("#isCat").value, page = $("#isPage").value;
    if(msg.length < 5){ toast("Describe the problem first."); return; }
    btn.disabled = true;
    const { error } = await sb.rpc("report_issue", { p_category:cat, p_message:msg, p_page:page, p_user_agent:navigator.userAgent });
    btn.disabled = false;
    if(error){ toast(errMsg(error)); return; }
    const t = now(), email = (await sb.auth.getUser()).data.user?.email || "";
    const body = `${msg}\n\n---\nFrom: ${me.name} (${email})\nTitle: ${roleLabel(me)}\nTopic: ${cat}\nPage: ${page}\nTime: ${longDate(dkey(t))}, ${tstr(new Date(t).toISOString())} UAE\nBrowser: ${navigator.userAgent}`;
    location.href = `mailto:${DEV_EMAIL}?subject=${encodeURIComponent(`[Opus Attendance] ${cat}`)}&body=${encodeURIComponent(body)}`;
    toast("Saved. Your email app is opening.");
    $("#isMsg").value = ""; this.list();
  }
};

/* ---------- my settings ---------- */
async function squarePhoto(file){
  const img = await createImageBitmap(file), side = Math.min(img.width, img.height);
  const c = document.createElement("canvas"); c.width = c.height = 320;
  c.getContext("2d").drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0, 0, 320, 320);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
}
views.profile = {
  mount(el){ this.el = el; this.account(el); },
  account(el){
    const sh = shifts[me.shift_id];
    el.innerHTML = `
      <section class="panel"><h2>Profile photo</h2>
        <div class="pf-row">
          <div class="pf-av" id="pfAv">${avatar(me.name, me.id)}</div>
          <div class="pf-actions">
            <label class="btn primary" for="pfFile">Upload photo</label><input type="file" id="pfFile" accept="image/jpeg,image/png,image/webp" hidden>
            <button class="btn" id="pfDel" ${photos[me.id]?"":"hidden"}>Remove photo</button>
          </div>
        </div>
      </section>
      <section class="panel"><h2>Appearance</h2>
        <div class="pf-line"><div><b>Night mode</b><div class="small muted">Saved on this device.</div></div><button class="btn theme-btn" data-theme-toggle><span class="sw"></span><span class="tl">Night mode</span></button></div>
      </section>
      <section class="panel"><h2>Your details</h2>
        <div class="pf-grid">
          <div><span>Name</span><b>${esc(me.name)}</b></div>
          <div><span>Email</span><b id="pfEmail">…</b></div>
          <div><span>Title</span><b>${esc(roleLabel(me))}</b></div>
          ${me.tracked || me.scheduled ? `<div><span>Default shift</span><b>${sh ? `${sh.start} to ${sh.end}` : "Not set"}</b></div>
          <div><span>Works from</span><b>${me.default_mode==="remote" ? "Remote" : "Office"}</b></div>` : ""}
        </div>
        <p class="hint">To change these, ask a manager.</p>
      </section>`;
    sb.auth.getUser().then(r => { const e = $("#pfEmail"); if(e) e.textContent = r.data.user?.email || ""; });
    document.querySelectorAll("#main [data-theme-toggle]").forEach(b => b.onclick = toggleTheme);
    paintThemeButtons();
    $("#pfFile").onchange = e => this.upload(e.target.files[0]);
    $("#pfDel").onclick = () => this.remove();
  },
  async upload(file){
    if(!file) return;
    try{
      toast("Uploading photo");
      const blob = await squarePhoto(file), path = `${me.id}/${Date.now()}.jpg`;
      const up = await sb.storage.from("avatars").upload(path, blob, { contentType:"image/jpeg", upsert:true });
      if(up.error) throw up.error;
      const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error } = await sb.rpc("set_my_avatar", { p_url:url });
      if(error) throw error;
      photos[me.id] = url; toast("Photo updated"); this.repaint();
    }catch(e){ toast(errMsg(e)); }
    $("#pfFile").value = "";
  },
  async remove(){
    const { error } = await sb.rpc("set_my_avatar", { p_url:null });
    if(error){ toast(errMsg(error)); return; }
    delete photos[me.id]; toast("Photo removed"); this.repaint();
  },
  repaint(){
    $("#pfAv").innerHTML = avatar(me.name, me.id); $("#pfDel").hidden = !photos[me.id];
    $("#who").innerHTML = `${avatar(me.name, me.id)}<div><div class="nm">${esc(me.name)}</div><div class="rl">${esc(roleLabel(me))}</div></div>`;
    refreshLive();
  }
};


/* Account page: profile, my schedule (managers on the schedule), how it works, help. */
views.account = sectionsView(() => [["profile","Profile",views.profile], ...(me.scheduled && !me.tracked ? [["schedule","My schedule",views.myschedule]] : []), ["guide","How it works",views.guide], ["help","Help",views.help]]);
