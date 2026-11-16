// HUD: every DOM write goes through here. The module caches element handles
// once; updates only touch text when the value actually changed.
import { WEAPONS, GRENADE_PRICE } from './state.js';
import { fmtMoney, fmtTime } from './util.js';

export function createHud(onBuy, onPlay) {
  const $ = (id) => document.getElementById(id);
  const el = {
    hp: $('hp-val'), hpBar: $('hp-bar'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    money: $('money-val'), timer: $('timer-val'), score: $('score-val'),
    teamAtk: $('team-atk'), teamDef: $('team-def'), feed: $('feed'),
    msg: $('message'), cross: $('crosshair'), hit: $('hitmarker'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buyMenu: $('buy-menu'), buyList: $('buy-list'), buyMoney: $('buy-money'),
    bombStatus: $('bomb-status'), roundLabel: $('round-label'), damage: $('damage-flash'),
    weaponName: $('weapon-name'), grenades: $('grenades-val'), plantBar: $('plant-bar'),
    plantFill: $('plant-fill'), plantLabel: $('plant-label'),
  };
  const cache = {};
  function set(key, node, text) {
    if (cache[key] !== text) { cache[key] = text; node.textContent = text; }
  }

  // Build the buy menu once, in hotkey order (1-6), from the weapon catalogue.
  const items = [];
  for (const id of ['ar77', 'vk9', 'm590', 'lr50']) {
    const w = WEAPONS[id];
    items.push({ id, name: w.name + ' — ' + w.kind, price: w.price });
  }
  items.push({ id: 'he', name: 'HE grenade', price: GRENADE_PRICE });
  items.push({ id: 'smoke', name: 'Smoke grenade', price: GRENADE_PRICE });
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'buy-item';
    b.innerHTML = '<span></span><b></b>';
    b.querySelector('span').textContent = it.name;
    b.querySelector('b').textContent = fmtMoney(it.price);
    b.addEventListener('click', () => onBuy(it.id));
    el.buyList.appendChild(b);
  }

  el.play.addEventListener('click', onPlay);

  return {
    setHealth(hp) {
      set('hp', el.hp, String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, hp) + '%';
      if (cache.hpBar !== pct) { cache.hpBar = pct; el.hpBar.style.width = pct; }
      el.hpBar.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, name, he, smoke) {
      set('ammo', el.ammoMag, String(mag));
      set('res', el.ammoRes, '/ ' + reserve);
      set('wname', el.weaponName, name);
      set('gr', el.grenades, 'HE ×' + he + '   Smoke ×' + smoke);
    },
    setMoney(m) { set('money', el.money, fmtMoney(m)); set('buymoney', el.buyMoney, fmtMoney(m)); },
    setTimer(t, label) {
      set('timer', el.timer, fmtTime(t));
      set('round', el.roundLabel, label);
      el.timer.classList.toggle('urgent', t <= 10 && label === 'ROUND');
    },
    setScore(atk, def, round) {
      const html = '<span class="atk">Vanguard ' + atk + '</span> — <span class="def">' + def + ' Sentinel</span>';
      if (cache.score !== html) { cache.score = html; el.score.innerHTML = html; }
      set('roundnum', el.roundLabel, 'ROUND ' + round);
    },
    setTeams(atkAlive, atkTotal, defAlive, defTotal) {
      set('ta', el.teamAtk, '◆'.repeat(atkAlive) + '◇'.repeat(atkTotal - atkAlive));
      set('td', el.teamDef, '◆'.repeat(defAlive) + '◇'.repeat(defTotal - defAlive));
    },
    setBomb(text) { set('bomb', el.bombStatus, text); },
    message(text, seconds) {
      set('msg', el.msg, text);
      el.msg.style.opacity = text ? '1' : '0';
      if (text) {
        clearTimeout(this._msgT);
        this._msgT = setTimeout(() => { el.msg.style.opacity = '0'; cache.msg = ''; }, seconds * 1000);
      }
    },
    hitMarker(head, ms) {
      el.hit.classList.add('on');
      el.hit.classList.toggle('head', head);
      clearTimeout(this._hitT);
      this._hitT = setTimeout(() => el.hit.classList.remove('on'), ms);
    },
    damageFlash() {
      el.damage.classList.add('on');
      setTimeout(() => el.damage.classList.remove('on'), 140);
    },
    setCrosshair(spreadPx) {
      const v = Math.round(6 + spreadPx * 900);
      if (cache.cross !== v) { cache.cross = v; el.cross.style.setProperty('--gap', v + 'px'); }
    },
    setFeed(entries) {
      const html = entries.map((e) => '<div>' + e.text + '</div>').join('');
      if (cache.feed !== html) { cache.feed = html; el.feed.innerHTML = html; }
    },
    showBuy(show) { el.buyMenu.hidden = !show; document.body.classList.toggle('buying', show); },
    setPlant(progress, label) {
      if (progress == null) { el.plantBar.hidden = true; return; }
      el.plantBar.hidden = false;
      el.plantFill.style.width = Math.round(progress * 100) + '%';
      set('plant', el.plantLabel, label);
    },
    showOverlay(kind, title, copy, button) {
      el.overlay.hidden = false;
      el.overlayTitle.textContent = title;
      el.overlayCopy.textContent = copy;
      el.play.textContent = button;
      el.play.dataset.kind = kind;
    },
    hideOverlay() { el.overlay.hidden = true; },
    overlayKind() { return el.play.dataset.kind || ''; },
  };
}
