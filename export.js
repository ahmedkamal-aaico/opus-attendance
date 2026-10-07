"use strict";
/* ---------- management report (Excel) ---------- */
let excelLib = null;
function loadExcel(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return excelLib ||= new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"; sc.onload = () => res(window.ExcelJS); sc.onerror = () => { excelLib = null; rej(new Error("Could not load the Excel library. Check your connection.")); }; document.head.appendChild(sc); });
}
function reportDialog(){
  const dlg = $("#repDlg"), t = dkey(now()), [y, m] = t.split("-").map(Number);
  const wd = (wdOf(t) + 6) % 7, mon = new Date(Date.parse(t+"T12:00:00Z") - wd*864e5).toISOString().slice(0,10), sun = new Date(Date.parse(mon+"T12:00:00Z") + 6*864e5).toISOString().slice(0,10);
  const P = { week:[mon, sun, "This week"], month:[`${t.slice(0,7)}-01`, monthEnd(t.slice(0,7)), monthLabel(t.slice(0,7))], year:[`${y}-01-01`, `${y}-12-31`, String(y)] };
  let pick = "month";
  dlg.innerHTML = `<form method="dialog" class="dlg-x"><button class="btn small" aria-label="Close">Close</button></form>
    <h2>Download full report</h2><p class="small muted" style="margin:-8px 0 14px">Excel workbook with every detail for each person.</p>
    <div class="de-l">Period</div>
    <div class="seg" id="rpSeg"><button type="button" class="seg-b" data-v="week">This week</button><button type="button" class="seg-b on" data-v="month">This month</button><button type="button" class="seg-b" data-v="year">This year</button><button type="button" class="seg-b" data-v="custom">Custom dates</button></div>
    <div class="pl-dates" id="rpCustom" style="margin-top:12px;display:none"><label class="f">From<input type="date" class="inl" id="rpFrom" value="${P.month[0]}"></label><label class="f">To<input type="date" class="inl" id="rpTo" value="${t}"></label></div>
    <p class="hint" id="rpNote"></p>
    <div class="actions"><button class="btn" id="rpCancel">Cancel</button><button class="btn primary" id="rpGo">Download</button></div><p class="err" id="rpErr"></p>`;
  const note = () => { const [a, b] = pick==="custom" ? [$("#rpFrom").value, $("#rpTo").value] : P[pick]; $("#rpNote").textContent = a && b ? `${prettyDate(a)} ${a.slice(0,4)} to ${prettyDate(b)} ${b.slice(0,4)}. Days after today are left out.` : ""; };
  dlg.querySelectorAll("#rpSeg .seg-b").forEach(b => b.onclick = () => { dlg.querySelectorAll("#rpSeg .seg-b").forEach(x=>x.classList.remove("on")); b.classList.add("on"); pick = b.dataset.v; $("#rpCustom").style.display = pick==="custom" ? "flex" : "none"; note(); });
  $("#rpFrom").onchange = note; $("#rpTo").onchange = note; note();
  $("#rpCancel").onclick = () => dlg.close();
  $("#rpGo").onclick = async () => {
    let [a, b, label] = pick==="custom" ? [$("#rpFrom").value, $("#rpTo").value, null] : P[pick];
    if(!a || !b || b < a){ $("#rpErr").textContent = "Pick a valid date range."; return; }
    if(Date.parse(b) - Date.parse(a) > 400*864e5){ $("#rpErr").textContent = "Pick up to about one year."; return; }
    label = label || `${prettyDate(a)} ${a.slice(0,4)} to ${prettyDate(b)} ${b.slice(0,4)}`;
    await exportReport(a, b, label, $("#rpGo")); dlg.close();
  };
  dlg.showModal();
}
async function fetchAll(make){
  const out = []; for(let from = 0; ; from += 1000){ const { data, error } = await make().range(from, from + 999); if(error) throw error; out.push(...(data||[])); if(!data || data.length < 1000) break; } return out;
}
async function loadRange(a, b){
  const ma = `${a.slice(0,7)}-01`, mb = monthEnd(b.slice(0,7)), hist = histStart(a.slice(0,7));
  const months = []; for(let k = ma; k <= mb; ){ months.push(k.slice(0,7)); const [y, m] = k.split("-").map(Number); k = new Date(Date.UTC(y, m, 1)).toISOString().slice(0,10); }
  const [att, sc, ex, adj, ot, brk] = await Promise.all([
    fetchAll(() => sb.from("attendance").select("*").gte("day", hist).lte("day", mb).order("day")),
    fetchAll(() => sb.from("schedule").select("*").gte("day", hist).lte("day", mb).order("day")),
    fetchAll(() => sb.from("excused").select("*").gte("day", hist).lte("day", mb).order("day")),
    fetchAll(() => sb.from("adjustments").select("*").in("month", months).order("created_at")),
    fetchAll(() => sb.from("overtime").select("*").gte("day", a).lte("day", b).order("day")),
    fetchAll(() => sb.from("breaks").select("*").gte("day", a).lte("day", b).order("started_at"))
  ]);
  const d = { months, att:toMap(att, r=>r), sched:toMap(sc, r=>r.shift_id), adj, ot, brk };
  for(const r of sc) if(r.work_mode) d.sched[`M|${r.employee_id}|${r.day}`] = r.work_mode;
  for(const r of ex){ d.sched[`X|${r.employee_id}|${r.day}`] = r.reason || ""; d.sched[`XT|${r.employee_id}|${r.day}`] = r.leave_type || "excused"; }
  return d;
}
async function exportReport(from, to, periodLabel, btn){
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Building report";
  try{
    const XL = await loadExcel();
    const D = await loadRange(from, to);
    const wb = new XL.Workbook(); wb.creator = me.name; wb.created = new Date();
    const FONT = { name:"Arial", size:10 }, HEAD = { name:"Arial", size:10, bold:true, color:{ argb:"FFFFFFFF" } };
    const fill = c => ({ type:"pattern", pattern:"solid", fgColor:{ argb:c } });
    const thin = { style:"thin", color:{ argb:"FFD9DDE3" } }, border = { top:thin, bottom:thin, left:thin, right:thin };
    const firstData = Object.values(D.att).map(r => r.day).sort()[0] || from, start = from > firstData ? from : firstData;
    const today = dkey(now()), keys = rangeKeys(start, to < today ? to : today), allKeys = rangeKeys(start, to);
    D.months = D.months.filter(ym => ym >= start.slice(0,7));
    const people = schedPeople(), agents = people.filter(e => e.tracked);
    const R = RULES(), RN = { senior:"Senior cover", pair:"Not remote together", night:"Morning office cover", consecutive:"No remote days in a row" };
    const accessOf = e => e.is_admin ? "Full access" : "Member access";
    const mins2 = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : 0;
    const allowedOf = k => k==="short" ? S.break_short_min : k==="long" ? S.break_long_min : k==="wc" ? S.break_wc_min : null;
    const brkOf = (eid, k) => D.brk.filter(b => b.employee_id===eid && b.day===k);
    const STATUS_TXT = { early:"Early credit", ontime:"On time", grace:"Late, within grace", late:"Late", remote:"Remote, on time", remotegrace:"Remote, within grace", remotelate:"Remote, late", absent:"Absent", off:"Day off", pending:"Not checked in yet", excused:"Leave", na:"Before start date", future:"Upcoming" };
    const monthSum = {}; for(const ym of D.months) for(const e of agents) monthSum[`${e.id}|${ym}`] = summarize(e, ym, D.att, D.sched, D.adj);
    const dayRow = (e, k) => { const ms = monthSum[`${e.id}|${k.slice(0,7)}`]; return ms?.rows.find(r => r.k === k) || dayStatus(e, k, D.att[`${e.id}|${k}`], D.sched); };
    const sheet = (name, cols, title, xs = 1) => {
      const ws = wb.addWorksheet(name, { views:[{ state:"frozen", xSplit:xs, ySplit:3 }], pageSetup:{ orientation:"landscape", paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0 } });
      ws.columns = cols.map(([, w]) => ({ width:w }));
      ws.getCell("A1").value = title; ws.getCell("A1").font = { name:"Arial", size:14, bold:true };
      ws.getCell("A2").value = `Opus Support Attendance. Period: ${periodLabel}${start > from ? ` (data starts ${prettyDate(start)} ${start.slice(0,4)})` : ""}. Generated ${longDate(today)} ${tstr(new Date(now()).toISOString())} UAE by ${me.name}.`;
      ws.getCell("A2").font = { name:"Arial", size:9, italic:true, color:{ argb:"FF667085" } };
      const hr = ws.getRow(3); cols.forEach(([h], i) => { const c = hr.getCell(i+1); c.value = h; c.font = HEAD; c.fill = fill("FF111827"); c.alignment = { vertical:"middle", horizontal:"center", wrapText:true }; c.border = border; });
      hr.height = 34; ws.autoFilter = { from:{ row:3, column:1 }, to:{ row:3, column:cols.length } };
      return ws;
    };
    const addRow = (ws, vals, opts={}) => { const r = ws.addRow(vals); r.eachCell({ includeEmpty:true }, (c, i) => { c.font = { ...FONT, ...(opts.bold?{bold:true}:{}) }; c.border = border; c.alignment = { vertical:"middle", horizontal: i===1 || opts.leftCols?.includes(i) ? "left" : "center", wrapText:!!opts.wrap }; if(opts.zebra) c.fill = fill("FFF6F7F9"); }); return r; };
    const note = (ws, text, color = "FF667085") => { ws.addRow([]); const r = ws.addRow([text]); r.getCell(1).font = { name:"Arial", size:9, italic:true, color:{ argb:color } }; };

    // 1. Summary for the period
    const sumCols = [["Employee",24],["Title",20],["Access",14],["Email",28],["Usual shift",13],["Scheduled days",10],["Planned office",9],["Planned remote",9],["Worked office",9],["Worked remote",9],["On time",8],["Within grace",9],["Early credits",9],["Late",7],["Late, allowed",9],[`Late over ${S.late_hard_min} min`,10],["Absent",8],["Public holiday",9],["Paid leave",8],["Sick leave",8],["Half day",8],["Unpaid",8],["Excused",8],["Left early (days)",10],["Left early (min)",10],["Overtime approved (min)",11],["Breaks taken",9],["Over-break (times)",10],["Over-break (min)",10],["Meeting (min)",10],["Task (min)",10],["Red (before clears)",10],["Black",8],["Adherence",10],["On-time streak (now)",10]];
    const ws1 = sheet("Summary", sumCols, `Attendance summary, ${periodLabel}`);
    agents.forEach((e, idx) => {
      const c = { sched:0, po:0, pr:0, wo:0, wr:0, ontime:0, grace:0, early:0, late:0, allowed:0, hard:0, absent:0, lv:{}, le:0, leMin:0, ot:0, brk:0, overN:0, overMin:0, meet:0, task:0, red:0, black:0 };
      for(const k of allKeys){ const sf = shiftFor(e, k, D.sched); if(sf.off || D.sched[`X|${e.id}|${k}`] !== undefined) continue; if(e.since && k < e.since) continue; c.sched++; if(sf.mode==="remote") c.pr++; else c.po++; }
      for(const k of keys){
        const rec = D.att[`${e.id}|${k}`], st = dayRow(e, k);
        if(rec){ if(rec.mode==="remote") c.wr++; else c.wo++; }
        if(st.s==="ontime") c.ontime++; if(st.s==="grace"||st.s==="remotegrace") c.grace++; if(st.s==="early") c.early++;
        if(st.s==="late"||st.s==="remotelate"){ c.late++; if(st.allowed) c.allowed++; else if(st.severe==="black") c.black++; else c.red++; if(st.severe) c.hard++; }
        if(st.s==="absent"){ c.absent++; c.black++; }
        if(st.s==="excused") c.lv[st.lt] = (c.lv[st.lt]||0) + 1;
        const le = leftEarlyBy(e, k, rec, D.sched); if(le){ c.le++; c.leMin += le; }
        for(const b of brkOf(e.id, k)){ const d = mins2(b.started_at, b.ended_at || new Date(now()).toISOString()), al = allowedOf(b.kind); if(b.kind==="meeting") c.meet += d; else if(b.kind==="task") c.task += d; else { c.brk++; if(al && d > al){ c.overN++; c.overMin += d - al; } } }
      }
      c.ot = D.ot.filter(o=>o.employee_id===e.id && o.status==="approved").reduce((x,o)=>x+o.minutes,0);
      const adh = adherenceFor(e, null, D.att, D.sched, D.brk, keys), sh = shifts[e.shift_id];
      const row = addRow(ws1, [e.name, e.title||"", accessOf(e), e.email||"", sh?`${sh.start}–${sh.end}`:"", c.sched, c.po, c.pr, c.wo, c.wr, c.ontime, c.grace, c.early, c.late, c.allowed, c.hard, c.absent, c.lv.holiday||0, c.lv.paid||0, c.lv.sick||0, c.lv.half||0, c.lv.unpaid||0, c.lv.excused||0, c.le, c.leMin, c.ot, c.brk, c.overN, c.overMin, c.meet, c.task, c.red, c.black, adh ? adh.pct/100 : null, streakFor(e, D.att, D.sched)], { zebra: idx % 2 === 1, leftCols:[2,3,4] });
      row.getCell(34).numFmt = "0.0%";
      if(adh) row.getCell(34).font = { ...FONT, bold:true, color:{ argb: adh.pct >= S.adherence_target ? "FF12805C" : adh.pct >= S.adherence_target - 10 ? "FF946200" : "FFC2362B" } };
      if(c.red) row.getCell(32).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } };
    });
    note(ws1, `Planned = from the schedule for the whole period. Worked = actual check-ins up to today. Red is counted before monthly early-credit clears and adjustments; the Monthly points sheet has the official totals.`);

    // 2. Monthly points (official)
    const mpCols = [["Month",12],["Employee",24],["Early credits",9],["Late",7],["Late, allowed",9],["Absent",8],["Reds cleared",9],["Adjust red",8],["Adjust black",8],["Red",7],["Black",7],["Penalties",9],["Needs review",9],["Adherence",10]];
    const ws2 = sheet("Monthly points", mpCols, `Official monthly points, ${periodLabel}`, 2);
    let zi = 0;
    for(const ym of D.months) for(const e of agents){
      const s2 = monthSum[`${e.id}|${ym}`], adh = adherenceFor(e, ym, D.att, D.sched, D.brk);
      const aR = D.adj.filter(a=>a.employee_id===e.id && a.month===ym && a.type==="red").reduce((x,a)=>x+a.delta,0), aB = D.adj.filter(a=>a.employee_id===e.id && a.month===ym && a.type==="black").reduce((x,a)=>x+a.delta,0);
      const r = addRow(ws2, [monthLabel(ym), e.name, s2.early, s2.late, s2.allowed, s2.absent, s2.cleared, aR, aB, s2.red, s2.black, s2.penalties, s2.penalties >= S.review_threshold ? "Yes" : "No", adh ? adh.pct/100 : null], { zebra: zi++ % 2 === 1, leftCols:[2] });
      r.getCell(14).numFmt = "0.0%";
      if(s2.penalties >= S.review_threshold){ r.getCell(12).fill = fill("FFFDECEA"); [12,13].forEach(n => r.getCell(n).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } }); }
    }

    // 3. Daily log
    const logCols = [["Date",11],["Day",6],["Employee",24],["Scheduled shift",13],["Scheduled from",12],["Day type",14],["Leave note",22],["Checked in",10],["Checked out",10],["Worked from",11],["Distance from office (m)",12],["Status",22],["Late (min)",9],["Left early (min)",10],["Auto check-out",10],["Breaks",8],["Break (min)",9],["Over-break (min)",10],["Meeting (min)",10],["Task (min)",9],["Overtime approved (min)",11]];
    const ws3 = sheet("Daily log", logCols, `Day-by-day log, ${periodLabel}`, 3);
    zi = 0;
    for(const k of keys) for(const e of agents){
      const sf = shiftFor(e, k, D.sched), ex = D.sched[`X|${e.id}|${k}`], lt = D.sched[`XT|${e.id}|${k}`], rec = D.att[`${e.id}|${k}`];
      if(sf.off && ex === undefined && !rec) continue;
      const st = dayRow(e, k); let bn = 0, bm = 0, ov = 0, mt = 0, tk = 0;
      for(const b of brkOf(e.id, k)){ const d = mins2(b.started_at, b.ended_at || new Date(now()).toISOString()), al = allowedOf(b.kind); if(b.kind==="meeting") mt += d; else if(b.kind==="task") tk += d; else { bn++; bm += d; if(al && d > al) ov += d - al; } }
      const ot = D.ot.filter(o=>o.employee_id===e.id && o.day===k && o.status==="approved").reduce((x,o)=>x+o.minutes,0);
      const late = st.by && ["late","remotelate","grace","remotegrace"].includes(st.s) ? st.by : 0;
      const stTxt = st.s==="excused" ? (LEAVE[st.lt]||LEAVE.excused)[0] : (STATUS_TXT[st.s]||st.s) + (st.severe ? ` (${st.severe})` : st.allowed ? " (allowed)" : "");
      const r = addRow(ws3, [k, DOW[wdOf(k)], e.name, sf.off ? "Off" : `${sf.sh.start}–${sf.sh.end}`, sf.off ? "" : (sf.mode==="remote"?"Remote":"Office"), ex !== undefined ? LEAVE[lt||"excused"][0] : sf.off ? "Day off" : "Working", ex || "", rec ? tstr(rec.check_in) : "", rec?.check_out ? tstr(rec.check_out) : "", rec ? (rec.mode==="remote"?"Remote":"Office") : "", rec?.in_dist ?? "", stTxt, late || "", leftEarlyBy(e, k, rec, D.sched) || "", rec?.auto_out ? "Yes" : "", bn || "", bm || "", ov || "", mt || "", tk || "", ot || ""], { zebra: zi++ % 2 === 1, leftCols:[3,7,12] });
      const sc = r.getCell(12);
      if(["late","remotelate","absent"].includes(st.s)) sc.font = { ...FONT, bold:true, color:{ argb: st.s==="absent" || st.severe==="black" ? "FF1F2937" : "FFC2362B" } };
      if(st.s==="early") sc.font = { ...FONT, bold:true, color:{ argb:"FF12805C" } };
      if(ov) r.getCell(18).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } };
    }

    // 4-6. Breaks, overtime, adjustments
    const KN = { short:"Short break", long:"Long break", wc:"WC", meeting:"Meeting", task:"Task / Out of Q" };
    const ws4 = sheet("Breaks and status", [["Date",11],["Employee",24],["Type",16],["Started",9],["Ended",9],["Minutes",9],["Allowed (min)",10],["Over by (min)",10]], `Every break, meeting and task, ${periodLabel}`);
    D.brk.forEach((b, i) => { const d = mins2(b.started_at, b.ended_at || new Date(now()).toISOString()), al = allowedOf(b.kind), over = al && d > al ? d - al : "";
      const r = addRow(ws4, [b.day, enameOf(b.employee_id), KN[b.kind]||b.kind, tstr(b.started_at), b.ended_at ? tstr(b.ended_at) : "Open", d, al ?? "No limit", over], { zebra:i%2===1, leftCols:[2,3] });
      if(over) r.getCell(8).font = { ...FONT, bold:true, color:{ argb:"FFC2362B" } }; });
    const ws5 = sheet("Overtime", [["Date",11],["Employee",24],["Minutes",9],["Reason",36],["Status",11],["Decided by",20],["Decided at",18]], `Overtime requests, ${periodLabel}`);
    D.ot.forEach((o, i) => addRow(ws5, [o.day, enameOf(o.employee_id), o.minutes, o.reason||"", o.status[0].toUpperCase()+o.status.slice(1), o.decided_by||"", o.decided_at ? `${dkey(Date.parse(o.decided_at))} ${tstr(o.decided_at)}` : ""], { zebra:i%2===1, leftCols:[2,4,6], wrap:true }));
    const ws6 = sheet("Adjustments", [["Month",12],["Employee",24],["Point",8],["Change",8],["Reason",44],["By",22],["When",18]], `Manual point adjustments, ${periodLabel}`);
    D.adj.forEach((a, i) => addRow(ws6, [monthLabel(a.month), enameOf(a.employee_id), a.type==="red"?"Red":"Black", a.delta > 0 ? "+1" : "-1", a.reason, enameOf(a.created_by) || "", a.created_at ? `${dkey(Date.parse(a.created_at))} ${tstr(a.created_at)}` : ""], { zebra:i%2===1, leftCols:[2,5,6], wrap:true }));

    // 7. Office and remote by week (everyone in the schedule)
    const weeks = []; for(const k of allKeys){ const wk = new Date(Date.parse(k+"T12:00:00Z") - ((wdOf(k)+6)%7)*864e5).toISOString().slice(0,10); if(!weeks.includes(wk)) weeks.push(wk); }
    const ws7 = sheet("Office and remote", [["Employee",24],["Title",20], ...weeks.flatMap(w => [[`Week of ${prettyDate(w)} office`,10],[`Week of ${prettyDate(w)} remote`,10]]), ["Total office",9],["Total remote",9]], `Office and remote days per week, ${periodLabel}`, 2);
    people.forEach((e, i) => { const per = weeks.map(() => [0,0]); let to = 0, tr = 0;
      for(const k of allKeys){ if(D.sched[`X|${e.id}|${k}`] !== undefined) continue; const sf = shiftFor(e, k, D.sched); if(sf.off) continue; const wi = weeks.indexOf(new Date(Date.parse(k+"T12:00:00Z") - ((wdOf(k)+6)%7)*864e5).toISOString().slice(0,10)); if(sf.mode==="remote"){ per[wi][1]++; tr++; } else { per[wi][0]++; to++; } }
      addRow(ws7, [e.name, e.title||"", ...per.flat(), to, tr], { zebra:i%2===1, leftCols:[2], bold:false }); });
    note(ws7, "Counted from the schedule (planned days), leave and days off excluded. Includes seniors and supervisors.");

    // 8. Schedule grid (up to about two months)
    if(allKeys.length <= 62){
      const gCols = [["Employee",24],["Title",20], ...allKeys.map(k => [`${DOW[wdOf(k)].slice(0,2)} ${+k.slice(8)}/${+k.slice(5,7)}`, 7])];
      const ws8 = sheet("Schedule", gCols, `Schedule, ${periodLabel} (R = remote)`, 2);
      const TONE = ["FFDCE7FF","FFEADFFB","FFD5F1EC"], ids = Object.keys(shifts);
      people.forEach(e => { const vals = allKeys.map(k => { const ex = D.sched[`X|${e.id}|${k}`]; if(ex !== undefined) return LEAVE[D.sched[`XT|${e.id}|${k}`]||"excused"][1]; const sf = shiftFor(e, k, D.sched); return sf.off ? "Off" : sf.sh.start.slice(0,2) + (sf.mode==="remote" ? " R" : ""); });
        const r = addRow(ws8, [e.name, e.title||"", ...vals], { leftCols:[2] });
        allKeys.forEach((k, j) => { const c = r.getCell(j+3), sf = shiftFor(e, k, D.sched), ex = D.sched[`X|${e.id}|${k}`];
          if(ex !== undefined){ c.fill = fill("FFFFF1D6"); c.font = { ...FONT, bold:true }; } else if(sf.off){ c.fill = fill("FFF2F3F5"); c.font = { ...FONT, color:{ argb:"FF98A2B3" } }; } else { c.fill = fill(TONE[ids.findIndex(x=>shifts[x]===sf.sh) % 3] || "FFFFFFFF"); if(sf.mode==="remote") c.font = { ...FONT, bold:true }; } }); });
      const iss = D.months.flatMap(ym => checkSchedule(ym, D.sched).issues).filter(x => x.k >= from && x.k <= to);
      note(ws8, iss.length ? `Rule check: ${iss.length} issue(s). ${iss.slice(0,10).map(x => `${prettyDate(x.k)} ${RN[x.rule]}`).join("; ")}${iss.length > 10 ? "; more in the app." : "."}` : "Rule check: no issues in this period.", iss.length ? "FFC2362B" : "FF12805C");
    }

    // 9. People, 10. Rules
    const ws9 = sheet("People", [["Employee",24],["Title",24],["Access",14],["Role",14],["Email",30],["Usual shift",13],["In schedule",10],["Checks in",10],["Counts from",12],["Active",8]], "Team list");
    emps.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach((e, i) => addRow(ws9, [e.name, e.title||"", accessOf(e), EMP_TYPES[empType(e)].label, e.email||"Not set", shifts[e.shift_id] ? `${shifts[e.shift_id].start}–${shifts[e.shift_id].end}` : "", e.scheduled||e.tracked ? "Yes":"No", e.tracked?"Yes":"No", e.since||"", e.active?"Yes":"No"], { zebra:i%2===1, leftCols:[2,3,4,5] }));
    const ws10 = sheet("Rules", [["Rule",40],["Value",30]], "Rules used for this report");
    [["Time zone", S.tz],["Shifts", Object.keys(shifts).map(id=>`${shifts[id].start}–${shifts[id].end}`).join(", ")],["Check-in opens before shift (min)", S.checkin_open_min],["Grace after shift start (min)", S.grace_min],["Allowed late days per month", S.late_allowance],["Late always red after (min)", S.late_hard_min],["Late counts as black after (min)", S.late_black_min],["Early credit window (min before start)", `${S.early_max} to ${S.early_min}`],["Early credits to clear 1 red", S.early_per_clear],["Max clears per month", S.max_clears],["Needs review at (penalties)", S.review_threshold],["Adherence target", S.adherence_target/100],["Breaks per shift", `${S.break_short_count}×${S.break_short_min}, ${S.break_long_count}×${S.break_long_min}, ${S.break_wc_count}×${S.break_wc_min} WC (min)`],["No breaks at shift start and end (min)", S.break_edge_min],["Must stay available", S.min_available],["Office radius (m)", S.radius_m],["Seniors in the office daily", R.min_senior_office],["Never remote together", (R.remote_pairs||[]).map(([a,b])=>`${enameOf(a)} and ${enameOf(b)}`).join("; ")||"None"],["Morning shift office cover", R.night_needs_morning_office?"On":"Off"],["No remote days in a row", R.no_consecutive_remote?"On":"Off"]]
      .forEach((x, i) => { const r = addRow(ws10, x, { zebra:i%2===1, leftCols:[1,2] }); if(x[0]==="Adherence target") r.getCell(2).numFmt = "0%"; });

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a"); a.href = url; a.download = `Opus-Attendance-Report_${from}_to_${to}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
    toast("Report downloaded");
  }catch(e){ toast(errMsg(e)); }
  btn.disabled = false; btn.textContent = label;
}
const rangeKeys = (a, b) => { const out = []; for(let t = Date.parse(a+"T12:00:00Z"), e = Date.parse(b+"T12:00:00Z"); t <= e; t += 864e5) out.push(new Date(t).toISOString().slice(0,10)); return out; };


/* Quick CSV of any table on screen. Cells that start with = + - @ get a leading quote so spreadsheets never run them as formulas. */
function exportTableCsv(table, name){
  if(!table){ toast("Nothing to export yet."); return; }
  const cell = c => { const n = c.cloneNode(true); n.querySelectorAll(".av").forEach(x => x.remove()); n.querySelectorAll("div, br").forEach(x => x.before(" ")); let v = n.textContent.replace(/\s+/g, " ").trim(); if(/^[=+\-@]/.test(v)) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; };
  const csv = [...table.rows].map(r => [...r.cells].map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type:"text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href:url, download:`${name}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("CSV downloaded");
}
