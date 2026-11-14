// TaterCam ⇄ Streamlabs: when someone subs / donates / cheers / raids, change what the tater is wearing.
// Uses the Streamlabs Socket API (your "Socket API Token" from Streamlabs → Settings → API Tokens).
// No extra packages: speaks the socket.io wire protocol over a plain WebSocket.

const EVENT_TYPES = [
  { id: 'subscription', name: 'Subscription / resub', amount: 'months' },
  { id: 'giftsub', name: 'Gifted sub(s)', amount: 'gifts' },
  { id: 'donation', name: 'Donation / tip', amount: '$' },
  { id: 'bits', name: 'Bits / cheer', amount: 'bits' },
  { id: 'follow', name: 'Follow', amount: null },
  { id: 'raid', name: 'Raid', amount: 'viewers' },
  { id: 'superchat', name: 'YouTube Super Chat', amount: '$' },
  { id: 'member', name: 'YouTube membership', amount: 'months' },
];
const ACTIONS = [
  { id: 'outfit', name: '🎲 Random full outfit' },
  { id: 'item', name: '🎲 Random item (any slot)' },
  { id: 'slot', name: '🎲 Random item in a slot…' },
  { id: 'preset', name: '⭐ One of my saved outfits…' },
  { id: 'viewer', name: '💬 Viewer picks it in their message' },
  { id: 'none', name: 'Don\'t change outfit (reaction only)' },
];
const REACTIONS = [['none', 'No reaction'], ['hop', 'Hop'], ['spin', 'Spin'], ['steam', 'Steam'], ['party', 'Hop + spin + steam']];

const DEFAULT_RULES = [
  { type: 'subscription', min: 0, action: 'outfit', arg: '', secs: 60, react: 'hop' },
  { type: 'giftsub', min: 5, action: 'outfit', arg: '', secs: 120, react: 'party' },
  { type: 'giftsub', min: 1, action: 'item', arg: '', secs: 60, react: 'hop' },
  { type: 'donation', min: 5, action: 'viewer', arg: '', secs: 90, react: 'spin' },
  { type: 'donation', min: 1, action: 'item', arg: '', secs: 45, react: 'hop' },
  { type: 'bits', min: 500, action: 'viewer', arg: '', secs: 90, react: 'spin' },
  { type: 'bits', min: 100, action: 'slot', arg: 'head', secs: 45, react: 'hop' },
  { type: 'follow', min: 0, action: 'none', arg: '', secs: 0, react: 'hop' },
  { type: 'raid', min: 0, action: 'outfit', arg: '', secs: 120, react: 'party' },
  { type: 'superchat', min: 5, action: 'viewer', arg: '', secs: 90, react: 'spin' },
  { type: 'member', min: 0, action: 'outfit', arg: '', secs: 60, react: 'hop' },
];
// slots a "random full outfit" fills (some only sometimes, so it doesn't look like a costume box exploded)
const OUTFIT_PLAN = [['head', 1], ['eyes', 0.45], ['beard', 0.4], ['stache', 0.25], ['body', 0.85], ['back', 0.6], ['kit', 0.4], ['neck', 0.25], ['ears', 0.3], ['face', 0.15], ['pack', 0.25], ['hair', 0.2], ['belt', 0.2]];

const css = `
#alerts { left: 304px; width: 360px; max-height: calc(100% - 24px); overflow-y: auto; padding: 14px 16px; }
#alerts h2 { font-size: 15px; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: center; }
#alerts .x { background: none; border: 0; color: #aaa; font-size: 18px; cursor: pointer; }
#alerts input[type=password], #alerts input[type=text], #alerts input[type=number], #alerts select {
  background: #2c2c34; color: #fff; border: 1px solid #3a3a44; border-radius: 7px; padding: 6px 7px; font-size: 12px; min-width: 0; }
#alerts .btn { border: 0; border-radius: 8px; padding: 7px 10px; font-size: 12px; font-weight: 700; cursor: pointer; background: #f0b84a; color: #2a1a05; }
#alerts .btn.ghost { background: #2c2c34; color: #eee; font-weight: 500; }
#alerts .btn.small { padding: 4px 7px; font-size: 11px; }
#alerts .sec { margin: 12px 0 6px; font-weight: 700; color: #f0b84a; text-transform: uppercase; letter-spacing: .06em; font-size: 11px; }
#alerts .help { color: #999; font-size: 11px; line-height: 1.45; }
#alerts .rule { background: #1f1f26; border: 1px solid #2f2f38; border-radius: 9px; padding: 7px; margin-bottom: 6px; display: grid; gap: 5px; }
#alerts .rule .r { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
#alerts .rule .r > * { flex: 1 1 auto; }
#alerts .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #666; margin-right: 6px; }
#alerts .dot.on { background: #3ddc84; } #alerts .dot.wait { background: #f0b84a; } #alerts .dot.err { background: #ff5a5a; }
#alerts .log { font-size: 11px; color: #bbb; max-height: 110px; overflow-y: auto; background: #15151a; border-radius: 7px; padding: 6px; }
#alerts label.chk { display: flex; gap: 6px; align-items: center; color: #ccc; font-size: 12px; margin: 4px 0; }
#alertBanner { position: fixed; left: 50%; top: 7%; transform: translate(-50%, -30px); opacity: 0; z-index: 4; pointer-events: none;
  background: rgba(20,14,8,.88); color: #fff; border: 3px solid #f0b84a; border-radius: 16px; padding: 12px 22px; text-align: center;
  font: 800 26px/1.25 system-ui, Segoe UI, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.45); transition: opacity .35s, transform .35s; max-width: 80vw; }
#alertBanner small { display: block; font-size: 17px; font-weight: 600; color: #ffd98a; margin-top: 3px; }
#alertBanner.show { opacity: 1; transform: translate(-50%, 0); }
`;

export function initStreamAlerts({ ITEMS, SLOTS, getOutfit, setOutfit, react, store, openButton }) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const panel = document.createElement('div'); panel.id = 'alerts'; panel.className = 'panel hidden'; document.body.appendChild(panel);
  const banner = document.createElement('div'); banner.id = 'alertBanner'; document.body.appendChild(banner);

  let token = store.get('sl.token', '');
  let rules = store.get('sl.rules', null) || DEFAULT_RULES.map(r => ({ ...r }));
  let presets = store.get('sl.presets', []);
  let opts = Object.assign({ banner: true, auto: true, revert: true }, store.get('sl.opts', {}));
  const saveRules = () => store.set('sl.rules', rules), savePresets = () => store.set('sl.presets', presets), saveOpts = () => store.set('sl.opts', opts);
  const itemName = id => (ITEMS.find(i => i.id === id) || {}).name || id;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- picking outfits ----------
  const rand = a => a[Math.floor(Math.random() * a.length)];
  const inSlot = s => ITEMS.filter(i => i.slot === s);
  function randomOutfit() {
    const o = Object.fromEntries(SLOTS.map(s => [s.id, 'none']));
    for (const [s, p] of OUTFIT_PLAN) { const list = inSlot(s); if (list.length && Math.random() < p) o[s] = rand(list).id; }
    if (o.beard !== 'none' && o.stache !== 'none' && Math.random() < 0.7) o.stache = 'none';
    return o;
  }
  // score every item name against the words in the viewer's message ("put a cowboy hat on him!" → Cowboy Hat)
  const STOP = new Set(['the', 'and', 'for', 'you', 'him', 'her', 'his', 'put', 'wear', 'with', 'this', 'that', 'give', 'love', 'stream', 'tater', 'potato', 'real', 'model', 'please', 'pls', 'lol', 'from', 'your', 'have', 'some']);
  function pickFromMessage(msg) {
    const words = String(msg || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w));
    if (!words.length) return null;
    let best = null, bestScore = 0;
    for (const it of ITEMS) {
      const hay = (it.name + ' ' + it.id).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
      const hw = hay.split(/[\s_-]+/);
      let sc = 0; for (const w of words) { if (hw.includes(w)) sc += 3; else if (hw.some(h => h.length >= 4 && (h.startsWith(w) || w.startsWith(h)))) sc += 1.5; }
      if (sc > bestScore) { bestScore = sc; best = it; }
    }
    return bestScore >= 2.5 ? best : null;
  }
  function planFor(rule, ev) {
    const cur = getOutfit();
    switch (rule.action) {
      case 'outfit': return { outfit: randomOutfit(), label: 'a random fit' };
      case 'item': { const it = rand(ITEMS); return { outfit: { ...cur, [it.slot]: it.id }, label: it.name }; }
      case 'slot': { const list = inSlot(rule.arg || 'head'); if (!list.length) return null; const it = rand(list); return { outfit: { ...cur, [it.slot]: it.id }, label: it.name }; }
      case 'preset': { const p = presets.find(p => p.name === rule.arg) || rand(presets); if (!p) return { outfit: randomOutfit(), label: 'a random fit' }; return { outfit: { ...cur, ...p.outfit }, label: p.name }; }
      case 'viewer': { const it = pickFromMessage(ev.message) || rand(ITEMS); return { outfit: { ...cur, [it.slot]: it.id }, label: it.name }; }
      default: return null;
    }
  }

  // ---------- applying: each alert shows right away; your own outfit comes back after the last one ----------
  let base = null, active = null, timer = 0, until = 0;
  function showBanner(top, sub) {
    if (!opts.banner) return;
    banner.innerHTML = esc(top) + (sub ? '<small>' + esc(sub) + '</small>' : '');
    banner.classList.add('show'); clearTimeout(banner._t); banner._t = setTimeout(() => banner.classList.remove('show'), 6500);
  }
  function headline(ev) {
    const n = ev.name || 'Someone';
    return { subscription: ev.amount > 1 ? `${n} resubbed! (${ev.amount} months)` : `${n} subscribed!`, giftsub: `${n} gifted ${ev.amount > 1 ? ev.amount + ' subs' : 'a sub'}!`,
      donation: `${n} tipped ${ev.display || '$' + ev.amount}!`, bits: `${n} cheered ${ev.amount} bits!`, follow: `${n} followed!`, raid: `${n} is raiding with ${ev.amount}!`,
      superchat: `${n} sent a Super Chat ${ev.display || ''}!`, member: `${n} became a member!` }[ev.type] || `${n}!`;
  }
  function apply(job) {
    if (job.rule.react && job.rule.react !== 'none') react(job.rule.react);
    showBanner(headline(job.ev), job.plan ? '🥔 Tater is now wearing ' + job.plan.label : '');
    if (!job.plan) return;
    const secs = Math.max(0, +job.rule.secs || 0);
    if (secs === 0) { setOutfit(job.plan.outfit); if (!active) base = null; else base = getOutfit(); return; }   // keep it: becomes your new normal
    if (base === null) base = getOutfit();
    setOutfit(job.plan.outfit); active = job;
    // stay on screen for this alert's time, or longer if an earlier alert still had more time left
    until = Math.max(until, Date.now() + secs * 1000);
    clearTimeout(timer); timer = setTimeout(() => { active = null; until = 0; finish(); }, until - Date.now());
    renderStatus();
  }
  function finish() { if (base && opts.revert) setOutfit(base); base = null; renderStatus(); }
  function handle(ev, isTest = false) {
    const cands = rules.filter(r => r.type === ev.type && (+ev.amount || 0) >= (+r.min || 0)).sort((a, b) => (+b.min || 0) - (+a.min || 0));
    const rule = cands[0];
    log(`${isTest ? '[test] ' : ''}${headline(ev)}${ev.message ? ' “' + String(ev.message).slice(0, 60) + '”' : ''}${rule ? '' : ' — no rule matches'}`);
    if (!rule) return;
    apply({ ev, rule, plan: planFor(rule, ev) });
  }
  function skip() { clearTimeout(timer); active = null; until = 0; finish(); log('Cleared alerts — back to your outfit.'); }

  // ---------- Streamlabs socket (socket.io over WebSocket) ----------
  let ws = null, pingT = 0, retryT = 0, retries = 0, wantOpen = false, state = 'off', seen = new Set();
  function setState(s, msg) { state = s; renderStatus(msg); }
  function connect() {
    if (!token) { setState('err', 'Paste your Socket API token first.'); return; }
    wantOpen = true; clearTimeout(retryT); if (ws) try { ws.close(); } catch {}
    setState('wait', 'Connecting…');
    const url = 'wss://sockets.streamlabs.com/socket.io/?EIO=3&transport=websocket&token=' + encodeURIComponent(token);
    const sock = ws = new WebSocket(url);
    sock.onmessage = e => {
      const d = String(e.data);
      if (d[0] === '0') { const o = JSON.parse(d.slice(1)); clearInterval(pingT); pingT = setInterval(() => sock.readyState === 1 && sock.send('2'), o.pingInterval || 25000); }
      else if (d === '2') sock.send('3');
      else if (d.startsWith('40')) { retries = 0; setState('on', 'Connected to Streamlabs ✔'); log('Connected — waiting for subs and tips.'); }
      else if (d.startsWith('44')) { setState('err', 'Streamlabs refused the token. Copy the Socket API Token again.'); wantOpen = false; }
      else if (d.startsWith('42')) { try { const [name, payload] = JSON.parse(d.slice(2)); if (name === 'event') onSlEvent(payload); } catch (err) { console.warn('bad alert', err); } }
    };
    sock.onclose = () => {
      clearInterval(pingT); if (ws !== sock) return;
      if (!wantOpen) { setState('off', 'Not connected'); return; }
      retries++; const wait = Math.min(30, 2 ** retries); setState('wait', `Lost connection — retrying in ${wait}s…`);
      retryT = setTimeout(connect, wait * 1000);
    };
    sock.onerror = () => {};
  }
  function disconnect() { wantOpen = false; clearTimeout(retryT); clearInterval(pingT); if (ws) try { ws.close(); } catch {} ws = null; setState('off', 'Not connected'); }

  // turn Streamlabs' many event shapes into one simple shape
  function onSlEvent(p) {
    if (!p || !p.type) return;
    const msgs = Array.isArray(p.message) ? p.message : [p.message || {}];
    for (const m of msgs) {
      const key = m._id || m.event_id || m.id || (p.type + ':' + m.name + ':' + (m.amount || '') + ':' + (m.months || ''));
      if (seen.has(key)) continue; seen.add(key); if (seen.size > 500) seen = new Set([...seen].slice(-200));
      const name = m.display_name || m.from || m.name || 'Someone';
      let ev = null;
      if (p.type === 'donation') ev = { type: 'donation', name, amount: +m.amount || 0, display: m.formatted_amount || m.formattedAmount, message: m.message };
      else if (p.type === 'superchat') ev = { type: 'superchat', name, amount: (+m.amount || 0) / (m.amount > 10000 ? 1e6 : 1), display: m.displayString, message: m.comment || m.message };
      else if (p.type === 'bits') ev = { type: 'bits', name, amount: +m.amount || 0, message: m.message };
      else if (p.type === 'follow') ev = { type: 'follow', name };
      else if (p.type === 'raid') ev = { type: 'raid', name, amount: +m.raiders || +m.viewers || 0 };
      else if (p.type === 'subMysteryGift') ev = { type: 'giftsub', name: m.gifter_display_name || m.gifter || name, amount: +m.amount || +m.sub_count || 1 };
      else if (p.type === 'subscription' || p.type === 'resub') {
        if (p.for === 'youtube_account') ev = { type: 'member', name, amount: +m.months || 1 };
        else if (m.gifter || m.gifter_display_name) { if (m.mysteryGift || m._isMysteryGiftChild) continue; ev = { type: 'giftsub', name: m.gifter_display_name || m.gifter, amount: 1 }; }
        else ev = { type: 'subscription', name, amount: +m.months || 1, message: m.message };
      }
      if (ev) handle(ev);
    }
  }

  // ---------- UI ----------
  let logLines = [];
  function log(s) { logLines.unshift(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '  ' + s); logLines = logLines.slice(0, 40); const el = panel.querySelector('.log'); if (el) el.innerHTML = logLines.map(esc).join('<br>') || 'Nothing yet.'; }
  function renderStatus(msg) {
    const el = panel.querySelector('#slStatus'); if (!el) return;
    const left = active ? Math.max(0, Math.round((until - Date.now()) / 1000)) : 0;
    el.innerHTML = `<span class="dot ${state}"></span>${esc(msg || { on: 'Connected to Streamlabs ✔', wait: 'Connecting…', err: 'Problem connecting', off: 'Not connected' }[state])}${left ? ` · alert outfit for ${left}s more` : ''}`;
    if (openButton) openButton.textContent = state === 'on' ? '📡 Stream alerts (on)' : '📡 Stream alerts';
  }
  function ruleArgHtml(r, i) {
    if (r.action === 'slot') return `<select data-i="${i}" data-k="arg">${SLOTS.map(s => `<option value="${s.id}" ${r.arg === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
    if (r.action === 'preset') return presets.length ? `<select data-i="${i}" data-k="arg"><option value="">Any saved outfit</option>${presets.map(p => `<option ${r.arg === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : '<span class="help">Save an outfit below first</span>';
    return '';
  }
  function render() {
    panel.innerHTML = `
      <h2>📡 Stream alerts <button class="x" title="Close (A)">×</button></h2>
      <div class="help">When someone subs, tips, cheers or raids, Streamlabs tells TaterCam and the tater changes clothes on stream.</div>
      <div class="sec">1 · Connect Streamlabs</div>
      <div class="help">Streamlabs dashboard → <b>Settings → API Tokens → Your Socket API Token</b> → copy and paste it here. Keep it secret (hide this panel with <kbd>H</kbd> before going live).</div>
      <div class="r" style="display:flex;gap:6px;margin-top:6px"><input id="slTok" type="password" placeholder="Socket API token" value="${esc(token)}" style="flex:1">
        <button class="btn" id="slConn">${state === 'on' || state === 'wait' ? 'Disconnect' : 'Connect'}</button></div>
      <div id="slStatus" style="margin-top:6px"></div>
      <label class="chk"><input type="checkbox" id="slAuto" ${opts.auto ? 'checked' : ''}> Connect automatically when TaterCam opens</label>
      <div class="sec">2 · What each alert does</div>
      <div class="help">The rule with the biggest minimum that the alert reaches wins. Time = how long before your own outfit comes back (0 = keep it).</div>
      <div id="slRules" style="margin-top:6px">${rules.map((r, i) => {
        const et = EVENT_TYPES.find(e => e.id === r.type) || EVENT_TYPES[0];
        return `<div class="rule">
          <div class="r"><select data-i="${i}" data-k="type">${EVENT_TYPES.map(e => `<option value="${e.id}" ${e.id === r.type ? 'selected' : ''}>${e.name}</option>`).join('')}</select>
            ${et.amount ? `<span class="help">min</span><input type="number" min="0" step="any" data-i="${i}" data-k="min" value="${+r.min || 0}" style="width:64px;flex:0 0 64px" title="Minimum ${et.amount}">` : ''}</div>
          <div class="r"><select data-i="${i}" data-k="action">${ACTIONS.map(a => `<option value="${a.id}" ${a.id === r.action ? 'selected' : ''}>${a.name}</option>`).join('')}</select>${ruleArgHtml(r, i)}</div>
          <div class="r"><select data-i="${i}" data-k="react">${REACTIONS.map(([v, n]) => `<option value="${v}" ${v === r.react ? 'selected' : ''}>${n}</option>`).join('')}</select>
            <span class="help">for</span><input type="number" min="0" data-i="${i}" data-k="secs" value="${+r.secs || 0}" style="width:56px;flex:0 0 56px"><span class="help">sec</span>
            <button class="btn ghost small" data-test="${i}">Test</button><button class="btn ghost small" data-del="${i}" title="Delete rule">🗑</button></div>
        </div>`; }).join('')}</div>
      <div style="display:flex;gap:6px"><button class="btn ghost" id="slAdd">+ Add rule</button><button class="btn ghost" id="slReset">Reset to defaults</button></div>
      <div class="sec">3 · Saved outfits</div>
      <div class="help">Dress the tater in the Wardrobe, then save it here. Rules set to “One of my saved outfits” use these.</div>
      <div style="display:flex;gap:6px;margin-top:6px"><input id="slPName" type="text" placeholder="Name, e.g. Full Tarkov" style="flex:1"><button class="btn" id="slPSave">Save current</button></div>
      <div style="margin-top:6px">${presets.map((p, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin:3px 0">
        <span>⭐ ${esc(p.name)} <span class="help">(${Object.values(p.outfit).filter(v => v !== 'none').length} items)</span></span>
        <span><button class="btn ghost small" data-pwear="${i}">Wear</button> <button class="btn ghost small" data-pdel="${i}">🗑</button></span></div>`).join('') || '<span class="help">None yet.</span>'}</div>
      <div class="sec">4 · Options</div>
      <label class="chk"><input type="checkbox" id="slBanner" ${opts.banner ? 'checked' : ''}> Show a thank-you banner on stream</label>
      <label class="chk"><input type="checkbox" id="slRevert" ${opts.revert ? 'checked' : ''}> Put my outfit back when alerts finish</label>
      <div style="display:flex;gap:6px;margin:6px 0"><button class="btn ghost" id="slSkip">Stop alerts &amp; restore outfit</button></div>
      <div class="sec">Recent alerts</div>
      <div class="log"></div>
      <div class="help" style="margin-top:6px">Tip for viewers: with “Viewer picks it”, a tip message like <i>“cowboy hat!”</i> or <i>“give him the viking helmet”</i> puts that item on.</div>`;
    renderStatus(); panel.querySelector('.log').innerHTML = logLines.map(esc).join('<br>') || 'Nothing yet.';
  }
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.i !== undefined) { const r = rules[+t.dataset.i], k = t.dataset.k; r[k] = t.type === 'number' ? +t.value : t.value;
      if (k === 'action' && r.action === 'slot' && !SLOTS.some(s => s.id === r.arg)) r.arg = 'head'; if (k === 'action' && r.action === 'preset') r.arg = '';
      saveRules(); if (k === 'type' || k === 'action') render(); return; }
    if (t.id === 'slTok') { token = t.value.trim(); store.set('sl.token', token); }
    if (t.id === 'slAuto') { opts.auto = t.checked; saveOpts(); }
    if (t.id === 'slBanner') { opts.banner = t.checked; saveOpts(); }
    if (t.id === 'slRevert') { opts.revert = t.checked; saveOpts(); }
  });
  panel.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.classList.contains('x')) toggle(false);
    else if (t.id === 'slConn') { token = panel.querySelector('#slTok').value.trim(); store.set('sl.token', token); (state === 'on' || state === 'wait') ? disconnect() : connect(); render(); }
    else if (t.id === 'slAdd') { rules.push({ type: 'donation', min: 0, action: 'item', arg: '', secs: 60, react: 'hop' }); saveRules(); render(); }
    else if (t.id === 'slReset') { rules = DEFAULT_RULES.map(r => ({ ...r })); saveRules(); render(); }
    else if (t.id === 'slSkip') skip();
    else if (t.id === 'slPSave') { const nm = panel.querySelector('#slPName').value.trim() || 'Outfit ' + (presets.length + 1);
      presets = presets.filter(p => p.name !== nm).concat([{ name: nm, outfit: getOutfit() }]); savePresets(); render(); }
    else if (t.dataset.pwear !== undefined) setOutfit({ ...getOutfit(), ...presets[+t.dataset.pwear].outfit });
    else if (t.dataset.pdel !== undefined) { presets.splice(+t.dataset.pdel, 1); savePresets(); render(); }
    else if (t.dataset.del !== undefined) { rules.splice(+t.dataset.del, 1); saveRules(); render(); }
    else if (t.dataset.test !== undefined) {
      const r = rules[+t.dataset.test], names = ['MulletMan', 'BurntBurrito', 'SpudLord99', 'HashBrownHank', 'TotTheMighty'];
      const samples = ['cowboy hat please', 'put the viking helmet on him', 'give him a mullet', 'fishbowl!!', 'miner helmet lol', 'aviators'];
      handle({ type: r.type, name: rand(names), amount: Math.max(+r.min || 0, r.type === 'bits' ? 100 : 1), display: '$' + Math.max(+r.min || 0, 1).toFixed(2), message: rand(samples) }, true);
    }
  });
  function toggle(show) { panel.classList.toggle('hidden', show === undefined ? !panel.classList.contains('hidden') : !show); if (!panel.classList.contains('hidden')) render(); }
  render();
  if (openButton) openButton.addEventListener('click', () => toggle());
  if (token && opts.auto) connect();
  return { toggle, panel, handle, connect, disconnect, skip };
}
