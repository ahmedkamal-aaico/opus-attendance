"use strict";
/* ---------- first-login tour (3 short steps) ---------- */
const TOUR_KEY = "opus-tour-v1";
const tourSteps = () => me.tracked ? [
  ["Check in on Today", `Today opens ${S.checkin_open_min} minutes before your shift. Tap the big button. On office days you need to be within ${S.radius_m} m of the office, so allow location access. Remote days need no location.`],
  ["Breaks and status, same page", `After you check in, tap Break or status to start a break, a meeting or a task. ${S.min_available} teammate(s) always stay available, so a break can wait until someone is free. Tap Back to available when you return.`],
  ["Your month", "My month shows your points, adherence and schedule. Check out when you finish. If you forget, it happens automatically one minute after your shift."]
] : [
  ["Today", "Overtime requests and other things that need you appear at the top. Below them are the live board and today's check-ins."],
  ["Schedule", "Set the usual week once with the Weekly plan, or copy last month. Click a day to fix it. Rule problems show up with one-click fixes."],
  ["Reports and People", "Reports has points, adherence, the Excel report and the activity log. People has employees and the team rules."]
];
function startTour(){
  const dlg = $("#tourDlg"), steps = tourSteps(); let i = 0;
  const done = () => { try{ localStorage.setItem(TOUR_KEY, "1"); }catch{} dlg.close(); };
  const paint = () => {
    const [title, text] = steps[i], last = i === steps.length - 1;
    dlg.innerHTML = `<h2>${esc(title)}</h2><p class="tour-text">${esc(text)}</p>
      <div class="tour-dots" aria-hidden="true">${steps.map((_, n) => `<i class="${n===i?"on":""}"></i>`).join("")}</div>
      <div class="actions" style="justify-content:space-between"><button class="btn" id="tSkip">${last ? "Back" : "Skip"}</button><button class="btn primary" id="tNext">${last ? "Done" : "Next"}</button></div>`;
    $("#tSkip").onclick = () => last ? (i--, paint()) : done();
    $("#tNext").onclick = () => last ? done() : (i++, paint());
  };
  dlg.onclose = () => { try{ localStorage.setItem(TOUR_KEY, "1"); }catch{} };
  paint(); if(!dlg.open) dlg.showModal();
}
function maybeTour(){
  try{ if(localStorage.getItem(TOUR_KEY)) return; }catch{ return; }
  if(me) startTour();
}
