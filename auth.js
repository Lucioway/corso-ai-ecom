/* Lucioway — account module (Skool-style) on Supabase.
   Gate + login + profile + onboarding + account page + per-user progress + levels.
   No-op when unconfigured (config.js gate:false or no keys): classroom stays open
   in dev with localStorage progress. Never hard-locks on error. */
window.LW = (function () {
  const cfg = window.LW_CONFIG || {};
  const configured = () => !!(cfg.gate && cfg.supabaseUrl && cfg.supabaseAnonKey);
  const LS_KEY = "lucioway_corso_progress_v1";
  let sb = null, user = null, profile = null, onGrantedCb = null;
  let doneSet = null;            // authed: Set of completed lesson ids
  let pickedAvatar = null;       // onboarding: uploaded avatar url pending save

  // ---- level thresholds (mirror SQL level_for_points) ----
  const TH = [5, 155, 1000, 3000, 8000, 30000, 100000, 1000000];
  function levelFor(points) { let l = 1; for (const t of TH) if (points >= t) l++; return l; }

  function loadSDK() {
    if (window.supabase) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function screen(inner) {
    document.getElementById("app").innerHTML =
      '<div class="page"><div class="empty">' + inner + "</div></div>";
  }
  const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const initials = s => (s || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

  // ---- gate + profile bootstrap ----
  async function requireAccess(onGranted) {
    onGrantedCb = onGranted;
    if (!configured()) { onGranted(); return; }          // dev/local: open
    try {
      await loadSDK();
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return loginScreen();
      user = session.user;
      const { data: ok } = await sb.rpc("has_access", { p_product: cfg.product || "corso-ai-ecom" });
      if (!ok) return noAccessScreen(session);
      await loadProfile();
      await loadProgress();
      if (!profile || !profile.onboarded) return onboardingScreen();
      refreshNotifBadge();
      onGranted();
    } catch (e) { console.error("LW error:", e); onGranted(); }
  }

  async function loadProfile() {
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
    profile = data || { id: user.id, email: user.email, full_name: "", points: 0, onboarded: false };
  }
  async function loadProgress() {
    const { data } = await sb.from("lesson_progress").select("lesson_id").eq("user_id", user.id);
    doneSet = new Set((data || []).map(r => r.lesson_id));
  }

  const isAuthed = () => !!(sb && user);

  // ---- progress API (used by classroom; authed -> Supabase, else localStorage) ----
  function progressGet() {
    if (isAuthed() && doneSet) { const o = {}; doneSet.forEach(id => o[id] = true); return o; }
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  }
  function progressToggle(id) {
    if (isAuthed() && doneSet) {
      const nowDone = !doneSet.has(id);
      if (nowDone) { doneSet.add(id); sb.from("lesson_progress").upsert({ user_id: user.id, lesson_id: id, completed: true }).then(() => {}); }
      else { doneSet.delete(id); sb.from("lesson_progress").delete().eq("user_id", user.id).eq("lesson_id", id).then(() => {}); }
      return nowDone;
    }
    const o = progressGet(); o[id] = !o[id]; if (!o[id]) delete o[id];
    localStorage.setItem(LS_KEY, JSON.stringify(o)); return !!o[id];
  }

  // ---- login ----
  function loginScreen() {
    screen(
      '<div class="ei">◍</div><h2>Accedi</h2><p>Inserisci la tua email: ti mandiamo un link magico per entrare.</p>' +
      '<div style="margin-top:18px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<input id="lw-email" type="email" placeholder="tu@email.com" style="background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:11px 14px;color:var(--ink);font-family:var(--f-b);font-size:14px">' +
      '<button class="complete" onclick="LW.sendLink()">Invia link</button></div>' +
      '<p id="lw-msg" style="margin-top:14px;color:var(--fog)"></p>'
    );
  }
  async function sendLink() {
    const el = document.getElementById("lw-email"), msg = document.getElementById("lw-msg");
    const email = el && el.value;
    if (!email) { if (msg) msg.textContent = "Inserisci un'email."; return; }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
    if (msg) msg.textContent = error ? ("Errore: " + error.message) : "Controlla la mail e clicca il link.";
  }
  function noAccessScreen(session) {
    const price = cfg.priceLabel || "";
    let link = cfg.stripePaymentLink || "";
    if (link) link += (link.indexOf("?") >= 0 ? "&" : "?") + "prefilled_email=" + encodeURIComponent(session.user.email || "");
    const buy = link
      ? '<a class="complete" href="' + esc(link) + '" style="display:inline-block;text-decoration:none">Acquista l\'accesso' + (price ? " · " + esc(price) : "") + "</a>"
      : '<button class="complete" onclick="alert(\'Checkout non ancora configurato — aggiungi stripePaymentLink in config.js\')">Acquista l\'accesso' + (price ? " · " + esc(price) : "") + "</button>";
    screen('<div class="ei">🔒</div><h2>Sblocca il corso</h2>' +
      "<p>L'account <b>" + esc(session.user.email) + "</b> non ha ancora accesso.</p>" +
      '<div style="max-width:420px;margin:14px auto 0;color:var(--fog);font-size:14px;line-height:1.6">13 lezioni video · materiali scaricabili · community privata · leaderboard · accesso a vita.</div>' +
      '<div style="margin-top:22px">' + buy + "</div>" +
      '<p style="margin-top:18px"><button class="b" onclick="LW.signOut()">Esci</button></p>');
  }

  // ---- onboarding (first login) ----
  // ---- avatar upload (Supabase Storage 'avatars' bucket) ----
  async function uploadAvatar(file) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = user.id + "/avatar_" + Date.now() + "." + ext;
    const { error } = await sb.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    return sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  }
  function avatarHTML(url, name, size) {
    return url
      ? '<img src="' + esc(url) + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;border:1px solid var(--line2)">'
      : '<div class="me" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size / 3) + 'px">' + esc(initials(name)) + '</div>';
  }
  // onboarding pick: upload + preview, keep url for finish
  async function onAvatarPick(ev, prevId) {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const prev = document.getElementById(prevId);
    if (prev) prev.style.opacity = "0.5";
    try { pickedAvatar = await uploadAvatar(file); if (prev) prev.outerHTML = avatarHTML(pickedAvatar, "", 80).replace("<img", '<img id="' + prevId + '"'); }
    catch (e) { const m = document.getElementById("ob-msg") || document.getElementById("ac-msg"); if (m) m.textContent = "Errore upload: " + e.message; if (prev) prev.style.opacity = "1"; }
  }
  // account pick: upload + save immediately
  async function onAvatarPickSave(ev) {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const msg = document.getElementById("ac-msg"); if (msg) msg.textContent = "Caricamento…";
    try {
      const url = await uploadAvatar(file);
      await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      await loadProfile();
      if (window.__lwGo) window.__lwGo("Account"); else if (window.__lwRefreshChip) window.__lwRefreshChip();
    } catch (e) { if (msg) msg.textContent = "Errore: " + e.message; }
  }

  function onboardingScreen() {
    pickedAvatar = null;
    screen(
      '<div class="ei">✺</div><h2>Benvenuto</h2><p>Imposta il tuo profilo per iniziare.</p>' +
      '<div style="max-width:340px;margin:18px auto 0;display:flex;flex-direction:column;gap:12px;align-items:center">' +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:8px">' +
      '<span id="ob-prev">' + avatarHTML(null, profile && profile.email, 80) + '</span>' +
      '<input type="file" id="ob-file" accept="image/*" onchange="LW.onAvatarPick(event,\'ob-prev\')" style="display:none">' +
      '<button class="b" onclick="document.getElementById(\'ob-file\').click()">Carica foto</button></div>' +
      '<input id="ob-name" placeholder="Nome e cognome" value="' + esc(profile && profile.full_name) + '" style="width:100%;background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:11px 14px;color:var(--ink);font-family:var(--f-b)">' +
      '<button class="complete" style="width:100%" onclick="LW.finishOnboarding()">Entra nel corso</button>' +
      '<p id="ob-msg" style="color:var(--fog);font-size:13px"></p></div>'
    );
  }
  async function finishOnboarding() {
    const name = (document.getElementById("ob-name") || {}).value || "";
    const msg = document.getElementById("ob-msg");
    if (!name.trim()) { if (msg) msg.textContent = "Il nome serve."; return; }
    const patch = { full_name: name.trim(), onboarded: true };
    if (pickedAvatar) patch.avatar_url = pickedAvatar;
    const { error } = await sb.from("profiles").update(patch).eq("id", user.id);
    if (error) { if (msg) msg.textContent = "Errore: " + error.message; return; }
    await loadProfile();
    if (onGrantedCb) onGrantedCb();
  }

  // ---- nav profile chip ----
  function profileChipHTML() {
    if (!isAuthed() || !profile) return '<div class="me">LM</div>';
    return avatarHTML(profile.avatar_url, profile.full_name || profile.email, 34);
  }
  function userMenuItems() {
    if (!isAuthed() || !profile) return '';
    const lvl = levelFor(profile.points || 0);
    return '<div class="um-head"><div class="um-name">' + esc(profile.full_name || profile.email) + '</div>' +
      '<div class="um-sub">Livello ' + lvl + ' · ' + (profile.points || 0) + ' punti</div></div>' +
      '<button class="um-item" onclick="LW.openAccount();closeUserMenu()">Profilo</button>' +
      '<button class="um-item" onclick="closeUserMenu();window.__lwGo&&window.__lwGo(\'Account\')">Impostazioni</button>' +
      (profile.role === "admin" ? '<button class="um-item" onclick="closeUserMenu();window.__lwGo&&window.__lwGo(\'Admin\')">Admin</button>' : "") +
      '<button class="um-item um-danger" onclick="LW.signOut()">Esci</button>';
  }
  function openAccount() { if (window.__lwGo) window.__lwGo("Account"); }

  // ---- account / settings view (Skool-style profile) ----
  function field(id, label, val, ph) {
    return '<label style="color:var(--dim);font-size:12px">' + label +
      '<input id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph || "") + '" style="display:block;width:100%;margin-top:5px;background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:10px 13px;color:var(--ink);font-family:var(--f-b)"></label>';
  }
  function renderAccount() {
    if (!isAuthed() || !profile) {
      return '<div class="empty"><div class="ei">◍</div><h2>Account</h2><p>Accedi per gestire il profilo.</p></div>';
    }
    const lvl = levelFor(profile.points || 0);
    const soc = profile.socials || {};
    return '<div class="ph">Profilo</div><div class="psub">Le tue informazioni pubbliche, come su Skool.</div>' +
      '<div style="max-width:540px;display:flex;flex-direction:column;gap:14px">' +
      // avatar block (click to upload)
      '<div style="display:flex;align-items:center;gap:16px">' +
      '<span style="position:relative;cursor:pointer" onclick="document.getElementById(\'ac-file\').click()" title="Cambia foto">' +
      avatarHTML(profile.avatar_url, profile.full_name || profile.email, 72) +
      '<span style="position:absolute;right:-2px;bottom:-2px;background:var(--ink);color:#0a0a0a;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px">✎</span></span>' +
      '<input type="file" id="ac-file" accept="image/*" onchange="LW.onAvatarPickSave(event)" style="display:none">' +
      '<div><div style="font:600 18px var(--f-d)">' + esc(profile.full_name || "—") + '</div>' +
      '<div style="color:var(--dim);font:12px var(--f-m)">Livello ' + lvl + ' · ' + (profile.points || 0) + ' punti · ' + esc(profile.email || "") + '</div>' +
      '<button class="b" style="margin-top:8px" onclick="document.getElementById(\'ac-file\').click()">Carica foto</button></div></div>' +
      field("ac-name", "Nome", profile.full_name) +
      '<label style="color:var(--dim);font-size:12px">Bio<textarea id="ac-bio" rows="3" placeholder="Raccontati in due righe" style="display:block;width:100%;margin-top:5px;background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:10px 13px;color:var(--ink);font-family:var(--f-b)">' + esc(profile.bio) + '</textarea></label>' +
      field("ac-loc", "Località", profile.location, "Città, Paese") +
      '<div style="font:600 12px var(--f-m);color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin-top:4px">Social</div>' +
      field("ac-ig", "Instagram", soc.instagram, "@utente o URL") +
      field("ac-tw", "X / Twitter", soc.twitter, "@utente o URL") +
      field("ac-yt", "YouTube", soc.youtube, "URL canale") +
      field("ac-web", "Sito web", soc.website, "https://…") +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:4px"><button class="complete" onclick="LW.saveAccount()">Salva</button>' +
      '<button class="b" onclick="LW.signOut()">Esci</button><span id="ac-msg" style="color:var(--fog);font-size:13px"></span></div>' +
      '</div>';
  }
  async function saveAccount() {
    const f = id => ((document.getElementById(id) || {}).value || "").trim();
    const msg = document.getElementById("ac-msg");
    const socials = {};
    if (f("ac-ig")) socials.instagram = f("ac-ig");
    if (f("ac-tw")) socials.twitter = f("ac-tw");
    if (f("ac-yt")) socials.youtube = f("ac-yt");
    if (f("ac-web")) socials.website = f("ac-web");
    const { error } = await sb.from("profiles").update({
      full_name: f("ac-name"), bio: f("ac-bio") || null, location: f("ac-loc") || null, socials
    }).eq("id", user.id);
    if (error) { if (msg) msg.textContent = "Errore: " + error.message; return; }
    await loadProfile();
    if (msg) msg.textContent = "Salvato ✓";
    if (window.__lwRefreshChip) window.__lwRefreshChip();
  }

  // ===== Phase 2: members, leaderboard, community feed =====
  function timeAgo(ts) { const s = (Date.now() - new Date(ts).getTime()) / 1000; if (s < 60) return "ora"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "g"; }
  async function profilesMap() { const { data } = await sb.from("profiles").select("id,full_name,avatar_url,points"); const m = {}; (data || []).forEach(p => m[p.id] = p); return m; }

  let openProfileId = null;
  function openProfile(uid) { openProfileId = uid; openPostId = null; if (window.__lwGo) window.__lwGo("Members"); }
  function backToMembers() { openProfileId = null; if (window.__lwGo) window.__lwGo("Members"); }
  function socUrl(k, v) { if (/^https?:/.test(v)) return v; if (k === "instagram") return "https://instagram.com/" + v.replace("@", ""); if (k === "twitter") return "https://x.com/" + v.replace("@", ""); return "https://" + v; }

  async function mountMembers(el) {
    if (!isAuthed()) { el.innerHTML = '<div class="psub">Accedi per vedere i membri.</div>'; return; }
    if (openProfileId) return mountProfile(el, openProfileId);
    const { data } = await sb.from("profiles").select("id,full_name,avatar_url,points").order("points", { ascending: false });
    const cards = (data || []).map(p => '<div class="mcard" style="cursor:pointer" onclick="LW.openProfile(\'' + p.id + '\')">' + avatarHTML(p.avatar_url, p.full_name, 48) +
      '<div><div class="mname">' + esc(p.full_name || "Membro") + '</div><div class="msub">Livello ' + levelFor(p.points || 0) + " · " + (p.points || 0) + ' punti</div></div></div>').join("");
    el.innerHTML = '<div class="members-grid">' + (cards || '<div class="psub">Ancora nessun membro.</div>') + "</div>";
  }
  async function mountProfile(el, uid) {
    const { data: p } = await sb.from("profiles").select("*").eq("id", uid).single();
    if (!p) { openProfileId = null; return mountMembers(el); }
    const lvl = levelFor(p.points || 0);
    const { data: posts } = await sb.from("posts").select("*").eq("author_id", uid).order("created_at", { ascending: false });
    const soc = p.socials || {};
    const socLinks = Object.keys(soc).filter(k => soc[k]).map(k => '<a class="b" href="' + esc(socUrl(k, soc[k])) + '" target="_blank">' + k + "</a>").join("");
    const postList = (posts || []).map(x => postCard(x, p)).join("") || '<div class="psub">Nessun post ancora.</div>';
    el.innerHTML = '<button class="back" onclick="LW.backToMembers()">← Members</button>' +
      '<div class="profhead">' + avatarHTML(p.avatar_url, p.full_name, 88) +
      '<div><div class="profname">' + esc(p.full_name || "Membro") + '</div><div class="profsub">Livello ' + lvl + " · " + (p.points || 0) + " punti" + (p.location ? " · " + esc(p.location) : "") + "</div>" +
      (p.bio ? '<div class="profbio">' + esc(p.bio) + "</div>" : "") + (socLinks ? '<div class="mats" style="margin-top:10px">' + socLinks + "</div>" : "") +
      (uid !== user.id ? '<div style="margin-top:12px"><button class="complete" onclick="LW.openDM(\'' + uid + '\')">Messaggio</button></div>' : "") + "</div></div>" +
      '<div class="ph" style="font-size:18px;margin-top:26px">Post di ' + esc((p.full_name || "Membro").split(" ")[0]) + '</div><div class="feed">' + postList + "</div>";
  }
  const LEVEL_NAMES = ["", "Novizio", "Esordiente", "Praticante", "Esperto", "Veterano", "Maestro", "Élite", "Leggenda", "Mito"];
  let lbWindow = "all";
  function setLbWindow(w) { lbWindow = w; if (window.__lwGo) window.__lwGo("Leaderboard"); }
  function levelProgressHTML() {
    const pts = (profile && profile.points) || 0, lvl = levelFor(pts);
    const next = TH[lvl - 1];
    if (!next) return '<div class="lvlcard"><div class="lvlname">Livello ' + lvl + " · " + LEVEL_NAMES[lvl] + '</div><div class="lvlsub">Livello massimo 🏆</div></div>';
    const prev = lvl >= 2 ? TH[lvl - 2] : 0;
    const pctp = Math.max(0, Math.round((pts - prev) / (next - prev) * 100));
    return '<div class="lvlcard"><div class="lvlname">Livello ' + lvl + " · " + LEVEL_NAMES[lvl] + '</div>' +
      '<div class="lvlbar"><i style="transform:scaleX(' + (pctp / 100) + ')"></i></div>' +
      '<div class="lvlsub">' + (next - pts) + " punti al Livello " + (lvl + 1) + " (" + LEVEL_NAMES[lvl + 1] + ")</div></div>";
  }
  async function mountLeaderboard(el) {
    if (!isAuthed()) { el.innerHTML = '<div class="psub">Accedi per la classifica.</div>'; return; }
    let rows;
    if (lbWindow === "all") {
      const { data } = await sb.from("leaderboard").select("*").limit(50);
      rows = (data || []).filter(p => p.points > 0);
    } else {
      const days = lbWindow === "7" ? 7 : 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data: ev } = await sb.from("point_events").select("user_id,delta").gte("created_at", since);
      const tot = {}; (ev || []).forEach(e => tot[e.user_id] = (tot[e.user_id] || 0) + e.delta);
      const pm = await profilesMap();
      rows = Object.keys(tot).map(uid => ({ id: uid, points: tot[uid], full_name: (pm[uid] || {}).full_name, avatar_url: (pm[uid] || {}).avatar_url, level: levelFor((pm[uid] || {}).points || 0) })).filter(r => r.points > 0).sort((a, b) => b.points - a.points);
    }
    const tabs = '<div class="lbtabs">' + [["7", "7 giorni"], ["30", "30 giorni"], ["all", "Sempre"]].map(([k, l]) => '<button class="' + (lbWindow === k ? "on" : "") + '" onclick="LW.setLbWindow(\'' + k + '\')">' + l + "</button>").join("") + "</div>";
    const list = rows.length ? rows.map((p, i) => '<div class="lbrow" style="cursor:pointer" onclick="LW.openProfile(\'' + p.id + '\')"><span class="lbrank">' + (i + 1) + "</span>" +
      avatarHTML(p.avatar_url, p.full_name, 36) + '<span class="lbname">' + esc(p.full_name || "Membro") + '</span><span class="lbpts">' + (lbWindow === "all" ? "L" + p.level + " · " : "+") + p.points + "</span></div>").join("") : '<div class="psub">Nessun punto in questo periodo.</div>';
    el.innerHTML = levelProgressHTML() + tabs + list;
  }

  let openPostId = null, feedCat = "Tutti", feedSort = "new";
  const FEED_CATS = ["Generale", "Wins", "Domande", "Annunci"];
  const isAdmin = () => !!(profile && profile.role === "admin");
  function setFeedCat(c) { feedCat = c; if (window.__lwGo) window.__lwGo("Community"); }
  function setFeedSort(s) { feedSort = s; if (window.__lwGo) window.__lwGo("Community"); }
  let pendingPostImg = null;
  async function uploadPostImage(file) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = user.id + "/post_" + Date.now() + "." + ext;
    const { error } = await sb.storage.from("post-media").upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    return sb.storage.from("post-media").getPublicUrl(path).data.publicUrl;
  }
  async function onPostImagePick(ev) {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const prev = document.getElementById("np-imgprev");
    if (prev) prev.innerHTML = '<span class="psub">Carico…</span>';
    try { pendingPostImg = await uploadPostImage(file); if (prev) prev.innerHTML = '<img src="' + pendingPostImg + '" style="max-width:220px;border-radius:10px;border:1px solid var(--line2);vertical-align:middle"> <button class="minibtn" onclick="LW.clearPostImg()">rimuovi</button>'; }
    catch (e) { if (prev) prev.textContent = "Errore: " + e.message; }
  }
  function clearPostImg() { pendingPostImg = null; const p = document.getElementById("np-imgprev"); if (p) p.innerHTML = ""; }

  async function mountFeed(el) {
    if (!isAuthed()) { el.innerHTML = '<div class="psub">Accedi per la community.</div>'; return; }
    if (openPostId) return mountPost(el, openPostId);
    const pm = await profilesMap();
    let q = sb.from("posts").select("*");
    if (feedCat !== "Tutti") q = q.eq("category", feedCat);
    q = q.order("pinned", { ascending: false });
    q = feedSort === "top" ? q.order("like_count", { ascending: false }) : q.order("created_at", { ascending: false });
    const { data } = await q;
    const catOpts = FEED_CATS.map(c => '<option value="' + c + '">' + c + "</option>").join("");
    const composer = '<div class="composer"><input id="np-title" placeholder="Scrivi un post…"><textarea id="np-body" rows="2" placeholder="Aggiungi dettagli (opzionale)"></textarea>' +
      '<div id="np-imgprev"></div><input type="file" id="np-imgfile" accept="image/*" onchange="LW.onPostImagePick(event)" style="display:none">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div style="display:flex;gap:8px;align-items:center"><button class="b" onclick="document.getElementById(\'np-imgfile\').click()">📷 Immagine</button><select id="np-cat" class="selc">' + catOpts + '</select></div><button class="complete" onclick="LW.createPost()">Pubblica</button></div></div>';
    const filterRow = '<div class="feedbar"><div class="fcats">' + ["Tutti"].concat(FEED_CATS).map(c => '<button class="fcat ' + (c === feedCat ? "on" : "") + '" onclick="LW.setFeedCat(\'' + c + '\')">' + c + "</button>").join("") +
      '</div><div class="fsort"><button class="' + (feedSort === "new" ? "on" : "") + '" onclick="LW.setFeedSort(\'new\')">Nuovi</button><button class="' + (feedSort === "top" ? "on" : "") + '" onclick="LW.setFeedSort(\'top\')">Top</button></div></div>';
    const posts = (data || []).map(p => postCard(p, pm[p.author_id] || {})).join("") || '<div class="psub">Nessun post in questa categoria.</div>';
    el.innerHTML = '<div class="ph">Community</div>' + composer + filterRow + '<div class="feed">' + posts + "</div>";
  }
  function postCard(p, a) {
    const pin = p.pinned ? ' 📌' : "";
    return '<div class="pcard" onclick="LW.openPost(\'' + p.id + '\')"><div class="phead">' + avatarHTML(a.avatar_url, a.full_name, 38) +
      '<div style="flex:1"><div class="pauthor" onclick="event.stopPropagation();LW.openProfile(\'' + p.author_id + '\')" style="cursor:pointer">' + esc(a.full_name || "Membro") + pin + '</div><div class="ptime">' + timeAgo(p.created_at) + '</div></div><span class="catpill">' + esc(p.category || "Generale") + "</span></div>" +
      '<div class="ptitle">' + esc(p.title) + "</div>" + (p.body ? '<div class="pbody">' + esc(p.body).slice(0, 180) + "</div>" : "") + (p.image_url ? '<img class="pimg" src="' + esc(p.image_url) + '" loading="lazy">' : "") +
      '<div class="pmeta2"><span>♥ ' + p.like_count + "</span><span>💬 " + p.comment_count + "</span></div></div>";
  }
  async function createPost() {
    const t = ((document.getElementById("np-title") || {}).value || "").trim();
    const b = ((document.getElementById("np-body") || {}).value || "").trim();
    const c = (document.getElementById("np-cat") || {}).value || "Generale";
    if (!t) return;
    await sb.from("posts").insert({ author_id: user.id, title: t, body: b, category: c, image_url: pendingPostImg || null });
    pendingPostImg = null;
    if (window.__lwGo) window.__lwGo("Community");
  }
  function openPost(id) { openPostId = id; if (window.__lwGo) window.__lwGo("Community"); }
  function backToFeed() { openPostId = null; if (window.__lwGo) window.__lwGo("Community"); }
  async function mountPost(el, id) {
    const pm = await profilesMap();
    const { data: p } = await sb.from("posts").select("*").eq("id", id).single();
    if (!p) { openPostId = null; return mountFeed(el); }
    const a = pm[p.author_id] || {};
    const { data: liked } = await sb.from("post_likes").select("post_id").eq("post_id", id).eq("user_id", user.id).maybeSingle();
    const { data: cs } = await sb.from("comments").select("*").eq("post_id", id).order("created_at");
    const cids = (cs || []).map(c => c.id);
    const clikes = new Set();
    if (cids.length) { const { data: cl } = await sb.from("comment_likes").select("comment_id").eq("user_id", user.id).in("comment_id", cids); (cl || []).forEach(r => clikes.add(r.comment_id)); }
    const comments = (cs || []).map(c => {
      const ca = pm[c.author_id] || {}, cl = clikes.has(c.id);
      const del = (c.author_id === user.id || isAdmin()) ? '<button class="minibtn" onclick="LW.deleteComment(\'' + c.id + '\')">elimina</button>' : "";
      return '<div class="cmt">' + avatarHTML(ca.avatar_url, ca.full_name, 30) + '<div style="flex:1"><div class="cmt-a">' + esc(ca.full_name || "Membro") + " · " + timeAgo(c.created_at) +
        '</div><div class="cmt-b">' + esc(c.body) + '</div><div class="cmt-act"><button class="likebtn ' + (cl ? "on" : "") + '" onclick="LW.toggleCommentLike(\'' + c.id + "'," + (cl ? "true" : "false") + ')">♥ ' + c.like_count + "</button>" + del + "</div></div></div>";
    }).join("") || '<div class="cempty">Nessun commento. Sii il primo.</div>';
    const owner = p.author_id === user.id || isAdmin();
    const adminBtns = isAdmin() ? '<button class="minibtn" onclick="LW.pinPost(\'' + id + "'," + (p.pinned ? "true" : "false") + ')">' + (p.pinned ? "unpin" : "pin") + "</button>" : "";
    const delBtn = owner ? '<button class="minibtn" onclick="LW.deletePost(\'' + id + '\')">elimina</button>' : "";
    el.innerHTML = '<button class="back" onclick="LW.backToFeed()">← Community</button>' +
      '<div class="pcard pcard-full"><div class="phead">' + avatarHTML(a.avatar_url, a.full_name, 38) + '<div style="flex:1"><div class="pauthor" onclick="LW.openProfile(\'' + p.author_id + '\')" style="cursor:pointer">' + esc(a.full_name || "Membro") + (p.pinned ? " 📌" : "") + '</div><div class="ptime">' + timeAgo(p.created_at) + '</div></div><span class="catpill">' + esc(p.category || "Generale") + "</span></div>" +
      '<div class="ptitle">' + esc(p.title) + "</div>" + (p.body ? '<div class="pbody">' + esc(p.body) + "</div>" : "") + (p.image_url ? '<img class="pimg" src="' + esc(p.image_url) + '" loading="lazy">' : "") +
      '<div class="pmeta2"><button class="likebtn ' + (liked ? "on" : "") + '" onclick="LW.toggleLike(\'' + id + "'," + (liked ? "true" : "false") + ')">♥ ' + p.like_count + "</button><span>💬 " + p.comment_count + "</span>" + adminBtns + delBtn + "</div></div>" +
      '<div class="cbox"><input id="nc-body" placeholder="Scrivi un commento…"><button class="b" onclick="LW.addComment(\'' + id + '\')">Invia</button></div>' +
      '<div class="cmts2">' + comments + "</div>";
  }
  async function toggleLike(postId, isLiked) {
    if (isLiked) await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
    else await sb.from("post_likes").insert({ post_id: postId, user_id: user.id });
    if (window.__lwGo) window.__lwGo("Community");
  }
  async function addComment(postId) {
    const b = ((document.getElementById("nc-body") || {}).value || "").trim();
    if (!b) return;
    await sb.from("comments").insert({ post_id: postId, author_id: user.id, body: b });
    if (window.__lwGo) window.__lwGo("Community");
  }
  async function toggleCommentLike(id, isLiked) {
    if (isLiked) await sb.from("comment_likes").delete().eq("comment_id", id).eq("user_id", user.id);
    else await sb.from("comment_likes").insert({ comment_id: id, user_id: user.id });
    if (window.__lwGo) window.__lwGo("Community");
  }
  async function deletePost(id) { await sb.from("posts").delete().eq("id", id); openPostId = null; if (window.__lwGo) window.__lwGo("Community"); }
  async function deleteComment(id) { await sb.from("comments").delete().eq("id", id); if (window.__lwGo) window.__lwGo("Community"); }
  async function pinPost(id, pinned) { await sb.from("posts").update({ pinned: !pinned }).eq("id", id); if (window.__lwGo) window.__lwGo("Community"); }
  function clearSub() { openPostId = null; openProfileId = null; openDmId = null; }

  // ----- notifications -----
  let unreadNotifs = 0;
  async function refreshNotifBadge() {
    if (!isAuthed()) return;
    const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false);
    unreadNotifs = count || 0;
    if (window.__lwRefreshNotif) window.__lwRefreshNotif(unreadNotifs);
  }
  async function notifPanelHTML() {
    if (!isAuthed()) return '<div class="um-head"><div class="um-name">Notifiche</div></div>';
    const { data } = await sb.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    const pm = await profilesMap();
    const txt = { post_like: "ha messo like al tuo post", comment: "ha commentato il tuo post", comment_like: "ha messo like al tuo commento" };
    const items = (data || []).map(n => { const a = pm[n.actor_id] || {}; return '<button class="notif' + (n.read ? "" : " unread") + '" onclick="LW.openPost(\'' + n.post_id + '\');closeNotifs()">' + avatarHTML(a.avatar_url, a.full_name, 28) + '<div class="ntxt"><span><b>' + esc(a.full_name || "Qualcuno") + "</b> " + (txt[n.type] || "") + '</span><div class="ntime">' + timeAgo(n.created_at) + "</div></div></button>"; }).join("") || '<div class="um-item" style="color:var(--dim)">Nessuna notifica</div>';
    return '<div class="um-head"><div class="um-name">Notifiche</div></div>' + items;
  }
  async function markNotifsRead() {
    if (!isAuthed()) return;
    await sb.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    unreadNotifs = 0; if (window.__lwRefreshNotif) window.__lwRefreshNotif(0);
  }

  // ----- calendar / events -----
  async function mountCalendar(el) {
    if (!isAuthed()) { el.innerHTML = '<div class="psub">Accedi per il calendario.</div>'; return; }
    const { data: events } = await sb.from("events").select("*").order("starts_at", { ascending: true });
    const { data: myr } = await sb.from("event_rsvps").select("event_id").eq("user_id", user.id);
    const mine = new Set((myr || []).map(r => r.event_id));
    const { data: allr } = await sb.from("event_rsvps").select("event_id");
    const cnt = {}; (allr || []).forEach(r => cnt[r.event_id] = (cnt[r.event_id] || 0) + 1);
    const composer = isAdmin() ? '<div class="composer"><input id="ev-title" placeholder="Titolo evento"><input id="ev-date" type="datetime-local"><input id="ev-loc" placeholder="Luogo (opzionale)"><input id="ev-link" placeholder="Link Zoom/Meet (opzionale)"><textarea id="ev-desc" rows="2" placeholder="Descrizione"></textarea><div><button class="complete" onclick="LW.createEvent()">Crea evento</button></div></div>' : "";
    const list = (events || []).map(e => {
      const dt = new Date(e.starts_at), dstr = dt.toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const rsvped = mine.has(e.id);
      const del = isAdmin() ? '<button class="minibtn" onclick="LW.deleteEvent(\'' + e.id + '\')">elimina</button>' : "";
      return '<div class="evcard"><div class="evdate">' + esc(dstr) + '</div><div class="evtitle">' + esc(e.title) + "</div>" + (e.description ? '<div class="evdesc">' + esc(e.description) + "</div>" : "") +
        '<div class="evmeta">' + (e.location ? "<span>📍 " + esc(e.location) + "</span>" : "") + (e.link ? '<a class="b" href="' + esc(e.link) + '" target="_blank">Link</a>' : "") + "</div>" +
        '<div class="evact"><button class="complete ' + (rsvped ? "is-done" : "") + '" onclick="LW.toggleRsvp(\'' + e.id + "'," + (rsvped ? "true" : "false") + ')">' + (rsvped ? "✓ Partecipi" : "Partecipa") + '</button><span class="evcnt">' + (cnt[e.id] || 0) + " partecipanti</span>" + del + "</div></div>";
    }).join("") || '<div class="psub">Nessun evento in programma.</div>';
    el.innerHTML = '<div class="ph">Calendar</div>' + composer + '<div class="evlist">' + list + "</div>";
  }
  async function createEvent() {
    const t = ((document.getElementById("ev-title") || {}).value || "").trim();
    const dt = (document.getElementById("ev-date") || {}).value;
    if (!t || !dt) return;
    await sb.from("events").insert({ title: t, starts_at: new Date(dt).toISOString(), location: ((document.getElementById("ev-loc") || {}).value || "").trim() || null, link: ((document.getElementById("ev-link") || {}).value || "").trim() || null, description: ((document.getElementById("ev-desc") || {}).value || "").trim(), created_by: user.id });
    if (window.__lwGo) window.__lwGo("Calendar");
  }
  async function toggleRsvp(id, on) { if (on) await sb.from("event_rsvps").delete().eq("event_id", id).eq("user_id", user.id); else await sb.from("event_rsvps").insert({ event_id: id, user_id: user.id }); if (window.__lwGo) window.__lwGo("Calendar"); }
  async function deleteEvent(id) { await sb.from("events").delete().eq("id", id); if (window.__lwGo) window.__lwGo("Calendar"); }

  // ----- global search -----
  async function searchData(q) {
    if (!isAuthed()) return { posts: [], members: [] };
    const s = q.replace(/[,()%*]/g, " ").trim(); if (!s) return { posts: [], members: [] };
    const like = "%" + s + "%";
    const [pr, mr] = await Promise.all([
      sb.from("posts").select("id,title").or("title.ilike." + like + ",body.ilike." + like).limit(6),
      sb.from("profiles").select("id,full_name").ilike("full_name", like).limit(6),
    ]);
    return { posts: pr.data || [], members: mr.data || [] };
  }

  // ----- direct messages -----
  let openDmId = null;
  function openDM(uid) { openDmId = uid; if (window.__lwGo) window.__lwGo("Messaggi"); }
  function backToDMs() { openDmId = null; if (window.__lwGo) window.__lwGo("Messaggi"); }
  async function mountDM(el) {
    if (!isAuthed()) { el.innerHTML = '<div class="psub">Accedi per i messaggi.</div>'; return; }
    if (openDmId) return mountThread(el, openDmId);
    const { data } = await sb.from("direct_messages").select("*").or("sender_id.eq." + user.id + ",recipient_id.eq." + user.id).order("created_at", { ascending: false });
    const pm = await profilesMap();
    const seen = new Set(), convs = [];
    (data || []).forEach(m => { const other = m.sender_id === user.id ? m.recipient_id : m.sender_id; if (!seen.has(other)) { seen.add(other); convs.push({ other, last: m }); } });
    const list = convs.map(c => { const a = pm[c.other] || {}; return '<button class="convrow" onclick="LW.openDM(\'' + c.other + '\')">' + avatarHTML(a.avatar_url, a.full_name, 40) + '<div style="flex:1;min-width:0"><div class="convname">' + esc(a.full_name || "Membro") + '</div><div class="convlast">' + esc(c.last.body).slice(0, 60) + "</div></div></button>"; }).join("") || '<div class="psub">Nessun messaggio. Apri il profilo di un membro e scrivigli.</div>';
    el.innerHTML = '<div class="ph">Messaggi</div><div class="convlist">' + list + "</div>";
  }
  async function mountThread(el, otherId) {
    const { data: other } = await sb.from("profiles").select("*").eq("id", otherId).single();
    const { data: msgs } = await sb.from("direct_messages").select("*").or("and(sender_id.eq." + user.id + ",recipient_id.eq." + otherId + "),and(sender_id.eq." + otherId + ",recipient_id.eq." + user.id + ")").order("created_at", { ascending: true });
    const bubbles = (msgs || []).map(m => '<div class="bubble ' + (m.sender_id === user.id ? "me" : "them") + '">' + esc(m.body) + "</div>").join("") || '<div class="cempty">Inizia la conversazione.</div>';
    el.innerHTML = '<button class="back" onclick="LW.backToDMs()">← Messaggi</button>' +
      '<div class="threadhead">' + avatarHTML(other && other.avatar_url, other && other.full_name, 40) + '<div class="convname">' + esc((other && other.full_name) || "Membro") + "</div></div>" +
      '<div class="thread">' + bubbles + "</div>" +
      '<div class="cbox"><input id="dm-body" placeholder="Scrivi un messaggio…" onkeydown="if(event.key===\'Enter\')LW.sendDM(\'' + otherId + '\')"><button class="b" onclick="LW.sendDM(\'' + otherId + '\')">Invia</button></div>';
    const t = el.querySelector(".thread"); if (t) t.scrollTop = t.scrollHeight;
  }
  async function sendDM(otherId) {
    const b = ((document.getElementById("dm-body") || {}).value || "").trim(); if (!b) return;
    await sb.from("direct_messages").insert({ sender_id: user.id, recipient_id: otherId, body: b });
    if (window.__lwGo) window.__lwGo("Messaggi");
  }

  // ----- about / admin / settings -----
  async function mountAbout(el) {
    const { data: g } = await sb.from("group_settings").select("*").eq("id", 1).single();
    el.innerHTML = '<div class="ph">' + esc((g && g.name) || "Lucioway") + '</div><div class="psub">' + esc((g && g.tagline) || "") + "</div>" +
      '<div class="profbio" style="max-width:640px">' + esc((g && g.about) || "Nessuna descrizione ancora.") + "</div>";
  }
  async function mountAdmin(el) {
    if (!isAdmin()) { el.innerHTML = '<div class="psub">Area riservata agli admin.</div>'; return; }
    const { data: g } = await sb.from("group_settings").select("*").eq("id", 1).single();
    const { data: members } = await sb.from("profiles").select("id,full_name,email,role,points,avatar_url").order("points", { ascending: false });
    const settings = '<div class="ph">Admin</div><div class="psub">Impostazioni gruppo e membri.</div>' +
      '<div style="max-width:560px;display:flex;flex-direction:column;gap:12px"><div style="font:600 12px var(--f-m);color:var(--dim);text-transform:uppercase;letter-spacing:.1em">Gruppo</div>' +
      field("gs-name", "Nome", (g && g.name) || "") + field("gs-tag", "Tagline", (g && g.tagline) || "") +
      '<label style="color:var(--dim);font-size:12px">About<textarea id="gs-about" rows="4" style="display:block;width:100%;margin-top:5px;background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:10px 13px;color:var(--ink);font-family:var(--f-b)">' + esc((g && g.about) || "") + "</textarea></label>" +
      '<div><button class="complete" onclick="LW.saveGroupSettings()">Salva gruppo</button> <span id="gs-msg" style="color:var(--fog);font-size:13px"></span></div></div>';
    const memList = '<div style="font:600 12px var(--f-m);color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin:26px 0 10px">Membri (' + (members || []).length + ")</div>" +
      (members || []).map(m => '<div class="admrow">' + avatarHTML(m.avatar_url, m.full_name, 34) + '<div style="flex:1;min-width:0"><div class="convname">' + esc(m.full_name || m.email || "Membro") + " " + (m.role === "admin" ? '<span class="catpill">admin</span>' : "") + '</div><div class="convlast">' + (m.points || 0) + " punti</div></div>" + (m.id === user.id ? "" : '<button class="b" onclick="LW.setMemberRole(\'' + m.id + "','" + (m.role === "admin" ? "member" : "admin") + '\')">' + (m.role === "admin" ? "rimuovi admin" : "rendi admin") + "</button>") + "</div>").join("");
    const pricing = '<div style="font:600 12px var(--f-m);color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin:26px 0 10px">Pricing / Membership</div><div class="evcard"><div class="evtitle">Vendi l\'accesso</div><div class="evdesc">Collega Stripe per attivare membership a pagamento (free / paid). La struttura entitlement è già pronta — da configurare quando vendi.</div></div>';
    el.innerHTML = settings + memList + pricing;
  }
  async function saveGroupSettings() {
    const f = id => ((document.getElementById(id) || {}).value || "").trim();
    const msg = document.getElementById("gs-msg");
    const { error } = await sb.from("group_settings").update({ name: f("gs-name") || "Lucioway", tagline: f("gs-tag"), about: f("gs-about") }).eq("id", 1);
    if (msg) msg.textContent = error ? ("Errore: " + error.message) : "Salvato ✓";
  }
  async function setMemberRole(uid, role) { await sb.from("profiles").update({ role }).eq("id", uid); if (window.__lwGo) window.__lwGo("Admin"); }

  async function signOut() { if (sb) { await sb.auth.signOut(); location.reload(); } }

  return {
    configured, requireAccess, isAuthed, sendLink, signOut, finishOnboarding,
    openAccount, saveAccount, renderAccount, profileChipHTML, userMenuItems, progressGet, progressToggle,
    onAvatarPick, onAvatarPickSave, levelFor,
    mountMembers, mountLeaderboard, mountFeed, createPost, openPost, backToFeed, toggleLike, addComment,
    setFeedCat, setFeedSort, toggleCommentLike, deletePost, deleteComment, pinPost,
    onPostImagePick, clearPostImg,
    openProfile, backToMembers, clearSub, setLbWindow,
    refreshNotifBadge, notifPanelHTML, markNotifsRead,
    mountCalendar, createEvent, toggleRsvp, deleteEvent, searchData,
    mountDM, openDM, backToDMs, sendDM,
    mountAbout, mountAdmin, saveGroupSettings, setMemberRole,
    get profile() { return profile; }, client: () => sb,
  };
})();
