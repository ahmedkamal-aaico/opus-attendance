"use strict";
/* ---------- shell ---------- */
let tab = null;
const views = {};
const ICONS = {
  checkin:'<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>',
  breaks:'<path d="M5 10h11v4a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 4v3M12 4v3"/>',
  live:'<circle cx="8" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3 19c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M13.5 18c.4-2 1.6-3 3-3s2.6 1 3 3"/>',
  mine:'<path d="M5 19V11M10 19V6M15 19v-5M20 19V9"/>',
  myschedule:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  team:'<path d="M4 6h16M4 12h16M4 18h10"/>',
  points:'<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.5L12 16.2 7 19l1.2-5.5L4 9.6 9.6 9z"/>',
  schedule:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 14h3M13 14h3M8 17h3"/>',
  people:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  audit:'<path d="M12 8v4l2.5 1.5"/><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/>',
  guide:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 8h8M8 12h5"/>',
  profile:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/><path d="M18.5 4.5l1 1M19.5 4.5l-1 1"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.5"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'
};
/* Sidebar tab -> icon. Section icons are reused from ICONS above. */
const TAB_ICON = { today:"checkin", month:"mine", ops:"live", reports:"points", schedule:"schedule", people:"people", account:"profile" };
function tabsFor(){
  const t = [], both = !!(me?.tracked && me?.is_admin);
  if(me?.tracked){ if(both) t.push(["head","My work"]); t.push(["today","Today"],["month","My month"]); }
  if(me?.is_admin){ if(both) t.push(["head","Manage"]); t.push(["ops", me.tracked ? "Team today" : "Today"],["schedule","Schedule"],["reports","Reports"],["people","People"]); }
  if(me){ if(both) t.push(["head","Account"]); t.push(["account","Account"]); }
  return t;
}
function renderTabs(){
  const t = tabsFor();
  if(!tab || !t.some(x=>x[0]===tab)) tab = t.find(x=>x[0]!=="head")?.[0];
  $("#tabs").innerHTML = t.map(([k,l]) => k==="head" ? `<div class="side-head">${l}</div>` :
    `<button role="tab" aria-selected="${tab===k}" data-t="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[TAB_ICON[k]||k]||""}</svg><span>${l}</span></button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(x => x.onclick = () => setTab(x.dataset.t));
}
const PAGES = {
  today:["Today","Check in, take breaks and see who is available."], month:["My month","Your points and your schedule."],
  ops:["Today","Who is here, live status and overtime requests."], schedule:["Schedule","Shifts, work location and excused days."],
  reports:["Reports","Points, adherence, the Excel report and the activity log."], people:["People","Employees and the team rules."],
  account:["Account","Your profile, how it works and help."] };
/* A page made of sub-sections (pill row on top). subs() returns [[key, label, view], ...]. */
function sectionsView(subs){
  return {
    sub:null, cur:null,
    mount(el){
      this.el = el; const list = subs();
      if(!list.some(s => s[0] === this.sub)) this.sub = list[0][0];
      el.innerHTML = `${list.length > 1 ? `<div class="seg set-tabs" data-subs>${list.map(([k,l]) => `<button type="button" class="seg-b ${k===this.sub?"on":""}" data-v="${k}">${l}</button>`).join("")}</div>` : ""}<div id="subBody"></div>`;
      el.querySelectorAll("[data-subs] .seg-b").forEach(b => b.onclick = () => { this.sub = b.dataset.v; this.mount(el); replay($("#subBody"), "pg-in"); countUp($("#subBody")); });
      this.cur = list.find(s => s[0] === this.sub)[2]; this.cur.mount($("#subBody"));
    },
    update(){ if(this.cur && this.cur.update) this.cur.update(); }
  };
}
function goTo(t, sub){ if(sub && views[t]) views[t].sub = sub; setTab(t); }
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function replay(el, cls){ if(!el || reduceMotion()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function countUp(root){
  if(reduceMotion()) return;
  root.querySelectorAll(".tally .n, .ms-stat .n, .sk-n").forEach(el => {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && /^\s*\d+(\.\d+)?%?\s*$/.test(n.textContent)); if(!node) return;
    const txt = node.textContent.trim(), pct = txt.endsWith("%"), to = parseFloat(txt), dec = (txt.split(".")[1]||"").replace("%","").length;
    if(!to) return; const t0 = performance.now(), dur = 600;
    const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); node.textContent = (to * e).toFixed(dec) + (pct ? "%" : ""); if(p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function setTab(t){
  closeDayEditor(); tab = t; renderTabs(); paintSideShift();
  const p = PAGES[t] || ["",""], lbl = tabsFor().find(x => x[0] === t);
  $("#pgTitle").textContent = lbl ? lbl[1] : p[0]; $("#pgSub").textContent = p[1];
  views[tab].mount($("#main")); window.scrollTo(0,0);
  replay($("#main"), "pg-in"); replay($(".pagehead"), "pg-in"); countUp($("#main"));
}
function update(){ const v = views[tab]; if(v && v.update) v.update(); }

