"use strict";
/* ---------- check-in ---------- */
const photos = {};
function avatar(name, id){ if(id && photos[id]) return `<img class="av" src="${esc(photos[id])}" alt="">`; const n = String(name||"?"); let h = 0; for(const c of n) h = (h*31 + c.charCodeAt(0)) % 360;
  const ini = n.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  return `<span class="av" style="--h:${h}">${esc(ini)}</span>`; }
const avatarName = (n, id) => `<span class="avn">${avatar(n, id)}<span>${esc(n)}</span></span>`;
const modeChip = m => `<span class="mode-chip ${m}">${m==="remote" ? '<svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/></svg>Remote' : '<svg viewBox="0 0 24 24"><path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-5h6v5"/></svg>Office'}</span>`;
