"use strict";
/* ---------- auth ---------- */
function showLogin(msg){
  $("#app").hidden = true; $("#login").hidden = false;
  $("#lMsg").textContent = msg || "";
  $("#lStep1").hidden = false; $("#lStep2").hidden = true;
}
$("#lSend").onclick = async () => {
  const email = $("#lEmail").value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $("#lMsg").textContent = "Enter your work email."; return; }
  $("#lSend").disabled = true; $("#lMsg").textContent = "";
  const { error } = await sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:true, emailRedirectTo: location.origin } });
  $("#lSend").disabled = false;
  if(error){ $("#lMsg").textContent = errMsg(error); return; }
  $("#lStep1").hidden = true; $("#lStep2").hidden = false;
  $("#lSent").textContent = email; $("#lCode").value = ""; $("#lCode").focus();
};
$("#lEmail").addEventListener("keydown", e => { if(e.key==="Enter") $("#lSend").click(); });
$("#lCode").addEventListener("keydown", e => { if(e.key==="Enter") $("#lVerify").click(); });
$("#lBack").onclick = () => showLogin("");
$("#lVerify").onclick = async () => {
  const token = $("#lCode").value.replace(/\D/g,"");
  if(token.length < 6){ $("#lMsg2").textContent = "Enter the code from the email."; return; }
  $("#lVerify").disabled = true; $("#lMsg2").textContent = "";
  const { error } = await sb.auth.verifyOtp({ email:$("#lSent").textContent, token, type:"email" });
  $("#lVerify").disabled = false;
  if(error){ $("#lMsg2").textContent = "That code is wrong or expired. Request a new one."; return; }
};
$("#helpBtn").onclick = () => goTo("account", "guide");
$("#signout").onclick = async () => { await sb.auth.signOut(); };

let started = false, pendingMsg = "", poller = null;
async function startApp(){
  if(started) return; started = true;
  try{
    const { data } = await sb.rpc("server_now");
    if(data) serverOffset = Date.parse(data) - Date.now();
    await loadBase();
  }catch(e){ started = false; showLogin(errMsg(e)); return; }
  if(!me){ started = false; pendingMsg = "This email is not registered. Ask a manager to add it in Employees."; await sb.auth.signOut(); return; }
  $("#login").hidden = true; $("#app").hidden = false;
  $("#who").innerHTML = `${avatar(me.name, me.id)}<div><div class="nm">${esc(me.name)}</div><div class="rl">${esc(roleLabel(me))}</div></div>`;
  if(me.tracked) await loadMine(ymOf(dkey(now())));
  await refreshLive();
  renderTabs(); setTab(tab); maybeTour();
  setInterval(() => { if(!document.hidden) refreshLive(); }, 15000);
  if(!poller) poller = setInterval(async () => { if(document.hidden) return; if(me.tracked && ["today","month"].includes(tab)){ await loadMine(ymOf(dkey(now()))); update(); } }, 60000);
}
sb.auth.onAuthStateChange((ev, session) => {
  if(session) setTimeout(startApp, 0);
  else { started = false; me = null; showLogin(pendingMsg); pendingMsg = ""; }
});
sb.auth.getSession().then(({ data }) => { if(!data.session) showLogin(""); });
