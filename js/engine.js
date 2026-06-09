// js/engine.js —— 游戏核心：单一竞技场 + 不定时刷怪（普通/精英/Boss）+ 战斗/祝福 + 渲染
// 同时兼容小游戏（全局 requestAnimationFrame）与小程序 Canvas 2D（canvas.requestAnimationFrame）
const Config = require('./config.js');
const InputManager = require('./input.js');
const Player = require('./player.js');
const Room = require('./room.js');
const Camera = require('./camera.js');
const Enemy = require('./enemy.js');
const EffectsManager = require('./effects.js');
const { BoonManager, GODS } = require('./boons.js');
const { clamp, len, dist } = require('./utils.js');

function rnd(a, b) { return a + Math.random() * (b - a); }
function rndInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

class Game {
  constructor(canvas, cssW, cssH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const info = wx.getSystemInfoSync();
    this.dpr = info.pixelRatio || 1;
    this.cssW = cssW;
    this.cssH = cssH;

    canvas.width = Math.round(cssW * this.dpr);
    canvas.height = Math.round(cssH * this.dpr);

    this.scale = cssW / Config.DESIGN_WIDTH;
    this.renderScale = this.scale * this.dpr;
    this.viewWorldW = canvas.width / this.renderScale;
    this.viewWorldH = canvas.height / this.renderScale;

    this.input = new InputManager(cssW, cssH);
    this.effects = new EffectsManager(Config.effects.poolSize);
    this.player = new Player(0, 0);
    this.camera = new Camera(0, 0);
    this.camera.setViewport(this.viewWorldW, this.viewWorldH);

    this.boons = new BoonManager();
    this.boonChoices = null;
    this.pendingBoons = 0;
    this.enemies = [];
    this.shake = 0;
    this.state = 'playing';   // playing | boon | dead
    this.deathPromptT = 0;

    this._initRun();

    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this._loop = this._loop.bind(this);

    this.fps = 0;
    this._fpsCount = 0;
    this._fpsTimer = 0;
  }

  _initRun() {
    // 单一竞技场（复用 Room 绘制，无门）
    this.arena = new Room(0, 0, 'arena');
    this.arena.x = 0;
    this.arena.y = 0;
    this.arena.width = Config.arena.width;
    this.arena.height = Config.arena.height;
    this.arena.wallThickness = Config.arena.wallThickness;
    this.arena.doors = { N: false, E: false, S: false, W: false };

    this.enemies.length = 0;
    this.effects.clear();
    this.boons.reset();
    this.boonChoices = null;
    this.pendingBoons = 0;
    this.shake = 0;

    this.player.reset(this.arena.centerX(), this.arena.centerY());
    this.camera.snapTo(this.player, this.arena);

    // 刷怪导演计时器
    const sp = Config.spawn;
    this.normalTimer = rnd(sp.normalIntervalMin, sp.normalIntervalMax);
    this.eliteTimer = rnd(sp.eliteIntervalMin, sp.eliteIntervalMax);
    this.bossTimer = rnd(sp.bossIntervalMin, sp.bossIntervalMax);
    this.bossAlive = false;
    this.bossWarnT = 0;

    // 统计
    this.kills = 0;
    this.elapsed = 0;

    for (let i = 0; i < sp.initialNormals; i++) this._spawnEnemy('melee');
  }

  _raf(cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    if (this.canvas && this.canvas.requestAnimationFrame) return this.canvas.requestAnimationFrame(cb);
    return setTimeout(() => cb(Date.now()), 16);
  }
  _caf(id) {
    if (id == null) return;
    if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame(id);
    if (this.canvas && this.canvas.cancelAnimationFrame) return this.canvas.cancelAnimationFrame(id);
    clearTimeout(id);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    this._render();
    this.rafId = this._raf(this._loop);
  }
  stop() {
    this.running = false;
    this._caf(this.rafId);
    this.rafId = null;
  }

  _loop(timestamp) {
    if (!this.running) return;
    this.rafId = this._raf(this._loop);

    if (!this.lastTime) this.lastTime = timestamp;
    let frameTime = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    if (frameTime > Config.MAX_FRAME_TIME) frameTime = Config.MAX_FRAME_TIME;

    this.accumulator += frameTime;
    let steps = 0;
    while (this.accumulator >= Config.FIXED_DT && steps < Config.MAX_STEPS_PER_FRAME) {
      this._update(Config.FIXED_DT);
      this.accumulator -= Config.FIXED_DT;
      steps++;
    }

    this._fpsCount++;
    this._fpsTimer += frameTime;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._fpsCount / this._fpsTimer);
      this._fpsCount = 0;
      this._fpsTimer = 0;
    }

    this._render();
  }

  // ============ 逻辑更新 ============
  _update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * Config.camera.shakeDecay);

    if (this.state === 'dead') {
      this.deathPromptT += dt;
      this.effects.update(dt);
      if (this.deathPromptT > 0.8 && this.input.consumeAnyTap()) this._restart();
      return;
    }

    if (this.state === 'boon') {
      this.effects.update(dt);
      const tap = this.input.consumeTap();
      if (tap) {
        for (const c of this.boonChoices) {
          if (this._pointInRect(tap, c.rect)) { this._applyBoon(c.def.id); break; }
        }
      }
      return;
    }

    this.elapsed += dt;
    if (this.bossWarnT > 0) this.bossWarnT -= dt;

    if (this.input.consumePress('dash')) {
      if (this.player.tryDash(this.input)) {
        this.effects.spawn('dashtrail', { x: this.player.x, y: this.player.y, reach: this.player.radius, dur: 0.18 });
        this.addShake(0.1);
      }
    }
    if (this.input.isPressed('attack')) {
      if (this.player.tryAttack(this.input)) {
        const isThird = this.player.comboIndex === 2;
        this.effects.spawn('slash', {
          x: this.player.x, y: this.player.y, angle: this.player.attackFacing,
          reach: Config.attack.reach + this.player.radius + (isThird ? Config.attack.thirdHitReachBonus : 0),
          half: Config.attack.halfAngle * (isThird ? 1.15 : 1),
          dur: 0.22, color: Config.Palette.slash
        });
      }
    }

    this.player.update(dt, this.input, this.arena);

    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt, this.player, this.arena);
    }
    this._separateEnemies();
    this._updateStatusEffects(dt);
    this._resolvePlayerAttack();
    this._resolveEnemyContact();
    this._handleKills();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].isGone()) this.enemies.splice(i, 1);
    }

    this._updateSpawns(dt);

    if (this.player.dead) {
      this.state = 'dead';
      this.deathPromptT = 0;
      this.input.consumeAnyTap();
      this.addShake(0.6);
    }

    this.effects.update(dt);
    this.camera.follow(this.player, this.arena, dt, Config.camera.smooth);
  }

  addShake(a) { this.shake = clamp(this.shake + a, 0, 1); }

  // ---- 刷怪导演 ----
  _updateSpawns(dt) {
    const sp = Config.spawn;

    this.normalTimer -= dt;
    if (this.normalTimer <= 0) {
      this.normalTimer = rnd(sp.normalIntervalMin, sp.normalIntervalMax);
      if (this._countKind('melee') < sp.normalCap && this._nonBossCount() < Config.enemy.maxOnScreen) {
        const n = rndInt(sp.normalBatchMin, sp.normalBatchMax);
        for (let i = 0; i < n; i++) this._spawnEnemy('melee');
      }
    }

    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.eliteTimer = rnd(sp.eliteIntervalMin, sp.eliteIntervalMax);
      if (this._countKind('elite') < sp.eliteCap && this._nonBossCount() < Config.enemy.maxOnScreen) {
        this._spawnEnemy('elite');
      }
    }

    this.bossTimer -= dt;
    if (this.bossTimer <= 0) {
      this.bossTimer = rnd(sp.bossIntervalMin, sp.bossIntervalMax);
      if (!this.bossAlive) this._spawnEnemy('boss');
    }
  }

  _spawnEnemy(kind) {
    const p = this._arenaSpawnPos();
    const e = new Enemy(p.x, p.y, kind);
    this.enemies.push(e);
    if (kind === 'boss') {
      this.bossAlive = true;
      this.bossWarnT = 2.5;
      this.effects.spawn('death', { x: p.x, y: p.y, dur: 0.6, color: Config.Palette.bloodRedLight });
      this.addShake(0.5);
    } else {
      this.effects.spawn('death', { x: p.x, y: p.y, dur: 0.3, color: kind === 'elite' ? Config.Palette.lavaGlow : Config.Palette.enemyBodyLight });
    }
    return e;
  }

  _arenaSpawnPos() {
    const a = this.arena, wt = a.wallThickness, m = Config.spawn.edgeMargin;
    const minX = a.x + wt + m, maxX = a.x + a.width - wt - m;
    const minY = a.y + wt + m, maxY = a.y + a.height - wt - m;
    let x = 0, y = 0, tries = 0;
    do {
      x = rnd(minX, maxX);
      y = rnd(minY, maxY);
      tries++;
    } while (dist(x, y, this.player.x, this.player.y) < Config.spawn.safeDist && tries < 30);
    return { x, y };
  }

  _countKind(kind) {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isAlive() && this.enemies[i].kind === kind) n++;
    return n;
  }
  _nonBossCount() {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isAlive() && this.enemies[i].kind !== 'boss') n++;
    return n;
  }
  _aliveBoss() {
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isBoss() && this.enemies[i].isAlive()) return this.enemies[i];
    return null;
  }
  _aliveEnemies() {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isAlive()) n++;
    return n;
  }

  // ---- 战斗结算 ----
  _resolvePlayerAttack() {
    const hb = this.player.getAttackHitbox();
    if (!hb) return;
    const m = this.boons.mods;
    for (let i = 0; i < this.enemies.length; i++) {
      const en = this.enemies[i];
      if (!en.isAlive()) continue;
      if (en.lastHitSwingId === hb.swingId) continue;

      const dx = en.x - hb.x;
      const dy = en.y - hb.y;
      const d = len(dx, dy);
      if (d > hb.reach + en.radius) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(this._angleDiff(ang, hb.facing)) > hb.halfAngle) continue;

      let dmg = hb.damage + m.bonusAttackDamage;
      let kb = hb.knockback;
      if (m.poseidon.active) { dmg += m.poseidon.impactDamage; kb *= m.poseidon.knockbackMul; }

      en.lastHitSwingId = hb.swingId;
      en.takeDamage(dmg, hb.x, hb.y, kb, hb.hitstun);
      if (m.ares.active) en.applyBleed(m.ares.dps, m.ares.duration);
      if (m.aphrodite.active) en.applyWeak(m.aphrodite.weakMul, m.aphrodite.duration);

      this.effects.spawn('hit', { x: en.x, y: en.y, angle: ang, dur: 0.22, color: Config.Palette.spark });
      this.effects.spawn('dmg', { x: en.x, y: en.y - en.radius - 6, text: Math.round(dmg), vy: -70, dur: 0.6, color: Config.Palette.olympusGoldLight });
      this.addShake(0.16);

      if (m.zeus.active) this._chainLightning(en, m.zeus);
    }
  }

  _chainLightning(source, z) {
    const hitSet = { [source.id]: true };
    let from = source;
    for (let j = 0; j < z.jumps; j++) {
      let best = null, bestD = z.range;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e.isAlive() || hitSet[e.id]) continue;
        const dd = dist(from.x, from.y, e.x, e.y);
        if (dd < bestD) { bestD = dd; best = e; }
      }
      if (!best) break;
      hitSet[best.id] = true;
      this.effects.spawn('lightning', { x: from.x, y: from.y, x2: best.x, y2: best.y, dur: 0.18, color: Config.Palette.olympusBlueLight });
      best.takeDamage(z.damage, from.x, from.y, 40, 0.05);
      this.effects.spawn('dmg', { x: best.x, y: best.y - best.radius - 6, text: Math.round(z.damage), vy: -60, dur: 0.5, color: Config.Palette.olympusBlueLight });
      from = best;
    }
  }

  _updateStatusEffects(dt) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.isAlive()) continue;
      if (e.bleedTimer > 0) {
        e._bleedTick = (e._bleedTick || 0) + dt;
        if (e._bleedTick >= 0.3) {
          e._bleedTick = 0;
          this.effects.spawn('dmg', { x: e.x + (Math.random() * 16 - 8), y: e.y - e.radius, text: '·', vy: -28, dur: 0.4, color: Config.Palette.bloodRedLight });
        }
      }
      e.updateStatus(dt); // 死亡统一在 _handleKills 处理
    }
  }

  _resolveEnemyContact() {
    const m = this.boons.mods;
    for (let i = 0; i < this.enemies.length; i++) {
      const en = this.enemies[i];
      const dx = this.player.x - en.x;
      const dy = this.player.y - en.y;
      const d = len(dx, dy);
      if (d > this.player.radius + en.radius) continue;

      if (this.player.isInvincible()) {
        // 雅典娜：闪避无敌中撞击敌人
        if (m.athena.active && this.player.dashing && en.canBeDeflected()) {
          en.deflectCd = 0.3;
          en.takeDamage(m.athena.damage, this.player.x, this.player.y, m.athena.knockback, 0.2);
          this.effects.spawn('hit', { x: en.x, y: en.y, angle: Math.atan2(dy, dx), dur: 0.2, color: Config.Palette.olympusBlueLight });
          this.effects.spawn('dmg', { x: en.x, y: en.y - en.radius - 6, text: Math.round(m.athena.damage), vy: -60, dur: 0.5, color: Config.Palette.olympusBlueLight });
          this.addShake(0.2);
        }
        continue;
      }

      if (en.canDamagePlayer()) {
        if (this.player.takeDamage(en.contactDamage(), en.x, en.y)) {
          en.contactCd = en.stats.contactCooldown;
          const l = d || 1;
          en.vx = -dx / l * 120 * en.stats.knockbackResist;
          en.vy = -dy / l * 120 * en.stats.knockbackResist;
          this.addShake(en.isBoss() ? 0.6 : 0.4);
          this.effects.spawn('hit', { x: this.player.x, y: this.player.y, angle: Math.atan2(dy, dx), dur: 0.2, color: Config.Palette.bloodRedLight });
        }
      }
    }
  }

  // 统一处理本帧新死亡的敌人（任何伤害来源）
  _handleKills() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.state !== 'dead' || e._killHandled) continue;
      e._killHandled = true;
      this.kills++;

      const col = e.isBoss() ? Config.Palette.bloodRedLight : (e.kind === 'elite' ? Config.Palette.lavaGlow : Config.Palette.spark);
      this.effects.spawn('death', { x: e.x, y: e.y, dur: e.isBoss() ? 0.7 : 0.35, color: col });
      this.addShake(e.isBoss() ? 0.7 : (e.kind === 'elite' ? 0.4 : 0.28));

      // 击败精英 / Boss → 获得祝福；Boss 额外回血
      if (e.kind === 'elite' || e.isBoss()) this.pendingBoons++;
      if (e.isBoss()) {
        this.bossAlive = false;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 40);
      }
    }
    if (this.pendingBoons > 0 && this.state === 'playing') this._openBoonSelection();
  }

  _separateEnemies() {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.isAlive() || a.isBoss()) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (!b.isAlive() || b.isBoss()) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = len(dx, dy);
        const min = a.radius + b.radius;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          dx /= d; dy /= d;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }

  _angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ---- 祝福 ----
  _openBoonSelection() {
    const choices = this.boons.getChoices(3);
    if (choices.length === 0) { this.pendingBoons = 0; return; }
    this.boonChoices = this._layoutBoonCards(choices);
    this.state = 'boon';
    this.input.resetAll();
  }

  _layoutBoonCards(choices) {
    const cw = this.cssW, ch = this.cssH;
    const cardW = Math.min(cw - 56, 360);
    const cardH = 132;
    const gap = 18;
    const total = choices.length * cardH + (choices.length - 1) * gap;
    const startY = (ch - total) / 2 + 20;
    const x = (cw - cardW) / 2;
    return choices.map((c, i) => ({
      def: c.def,
      nextLevel: c.nextLevel,
      rect: { x, y: startY + i * (cardH + gap), w: cardW, h: cardH }
    }));
  }

  _applyBoon(id) {
    const prevMaxHp = this.player.maxHp;
    this.boons.add(id);
    const m = this.boons.mods;
    this.player.maxHp = Config.player.maxHp + m.bonusMaxHp;
    this.player.maxStamina = Config.player.maxStamina + m.bonusMaxStamina;
    const heal = this.player.maxHp - prevMaxHp;
    if (heal > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);

    this.effects.spawn('death', { x: this.player.x, y: this.player.y, dur: 0.5, color: Config.Palette.olympusGoldLight });
    this.boonChoices = null;
    this.pendingBoons = Math.max(0, this.pendingBoons - 1);
    this.input.resetAll();
    if (this.pendingBoons > 0) this._openBoonSelection();
    else this.state = 'playing';
  }

  _pointInRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  _restart() {
    this.state = 'playing';
    this._initRun();
  }

  // ============ 渲染 ============
  _render() {
    const ctx = this.ctx;
    const cam = this.camera;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Config.Palette.bgDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let ox = 0, oy = 0;
    if (this.shake > 0) {
      const mm = this.shake * this.shake * Config.camera.shakeMax;
      ox = (Math.random() * 2 - 1) * mm;
      oy = (Math.random() * 2 - 1) * mm;
    }

    const rs = this.renderScale;
    ctx.setTransform(rs, 0, 0, rs,
      this.canvas.width / 2 - (cam.x + ox) * rs,
      this.canvas.height / 2 - (cam.y + oy) * rs);

    this.arena.draw(ctx);
    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].draw(ctx);
    this.player.draw(ctx);
    this.effects.draw(ctx);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._renderUI(ctx);
  }

  _renderUI(ctx) {
    if (this.state !== 'boon') {
      this._drawJoystick(ctx);
      this._drawActionButtons(ctx);
    }
    this._drawHud(ctx);
    this._drawBoonBar(ctx);
    this._drawBossBar(ctx);
    if (this.bossWarnT > 0 && this.state === 'playing') this._drawBossWarn(ctx);
    if (this.state === 'boon') this._drawBoonOverlay(ctx);
    if (this.state === 'dead') this._drawDeathOverlay(ctx);
  }

  _drawJoystick(ctx) {
    const js = this.input.joystick;
    if (!js.active) return;
    const P = Config.Palette;
    const R = this.input.maxRadius;
    ctx.beginPath();
    ctx.arc(js.baseX, js.baseY, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,12,30,0.35)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(245,197,66,0.5)';
    ctx.stroke();
    const kr = R * 0.42;
    const g = ctx.createRadialGradient(js.knobX, js.knobY, 4, js.knobX, js.knobY, kr);
    g.addColorStop(0, P.olympusGoldLight);
    g.addColorStop(1, P.olympusGold);
    ctx.beginPath();
    ctx.arc(js.knobX, js.knobY, kr, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  _drawActionButtons(ctx) {
    const P = Config.Palette;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const key in this.input.buttons) {
      const b = this.input.buttons[key];
      let avail = b.enabled;
      if (key === 'dash') {
        avail = this.player.stamina >= Config.dash.staminaCost && this.player.dashCd <= 0 && !this.player.dashing && !this.player.dead;
      } else if (key === 'attack') {
        avail = !this.player.dead;
      }
      const baseAlpha = b.enabled ? (avail ? (b.pressed ? 0.95 : 0.6) : 0.32) : 0.26;
      const rr = b.r * (b.pressed ? 0.92 : 1);
      ctx.globalAlpha = baseAlpha;
      ctx.beginPath();
      ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
      ctx.fillStyle = b.pressed ? 'rgba(40,24,60,0.7)' : 'rgba(20,12,30,0.5)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = b.color;
      ctx.stroke();
      ctx.globalAlpha = b.enabled ? (avail ? 1 : 0.5) : 0.4;
      ctx.fillStyle = P.textLight;
      ctx.font = Math.round(b.r * 0.7) + 'px sans-serif';
      ctx.fillText(b.label, b.x, b.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  _drawBar(ctx, x, y, w, h, frac, colFill, colLight) {
    frac = clamp(frac, 0, 1);
    ctx.fillStyle = Config.Palette.hpBack;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, colLight);
    g.addColorStop(1, colFill);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w * frac, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(245,197,66,0.5)';
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }

  _drawHud(ctx) {
    const P = Config.Palette;
    const cw = this.cssW;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 22px serif';
    ctx.fillText('HADES · 冥府竞技场', 20, 18);

    const bx = 20, bw = 240;
    this._drawBar(ctx, bx, 50, bw, 18, this.player.hp / this.player.maxHp, P.hpFill, P.hpFillLight);
    ctx.fillStyle = P.textLight;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + Math.ceil(this.player.hp) + ' / ' + this.player.maxHp, bx + 8, 50 + 9);
    this._drawBar(ctx, bx, 74, bw, 12, this.player.stamina / this.player.maxStamina, P.staminaFill, P.staminaFillLight);

    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText('左摇杆移动 · ⚔ 按住连击 · » 闪避 · 击败精英/BOSS 获得祝福', bx, 92);

    // 存活时间 / 击杀（右上）
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.85)';
    ctx.font = '14px sans-serif';
    ctx.fillText('存活 ' + fmtTime(this.elapsed) + ' · 击杀 ' + this.kills, cw - 16, 20);
    ctx.fillStyle = 'rgba(243,233,210,0.45)';
    ctx.fillText('FPS ' + this.fps, cw - 16, 40);
  }

  _drawBoonBar(ctx) {
    const order = this.boons.order;
    if (order.length === 0) return;
    const x0 = 20, y0 = 112, s = 26, gap = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const def = this.boons.def(id);
      const lv = this.boons.level(id);
      const g = GODS[def.god];
      const x = x0 + i * (s + gap);
      ctx.beginPath();
      ctx.arc(x + s / 2, y0 + s / 2, s / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,12,30,0.7)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = g.accent;
      ctx.stroke();
      ctx.fillStyle = g.color;
      ctx.font = 'bold 15px serif';
      ctx.fillText(def.short, x + s / 2, y0 + s / 2 + 1);
      ctx.fillStyle = Config.Palette.olympusGoldLight;
      for (let k = 0; k < lv; k++) {
        ctx.beginPath();
        ctx.arc(x + 4 + k * 5, y0 + s + 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawBossBar(ctx) {
    const boss = this._aliveBoss();
    if (!boss) return;
    const P = Config.Palette;
    const cw = this.cssW;
    const w = Math.min(cw - 80, 420), h = 16, x = (cw - w) / 2, y = 50;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = P.bloodRedLight;
    ctx.font = 'bold 14px serif';
    ctx.fillText('冥府守卫 · BOSS' + (boss.bossPhase === 2 ? '  【狂暴】' : ''), cw / 2, y - 4);
    this._drawBar(ctx, x, y, w, h, boss.hp / boss.maxHp, P.bloodRed, P.bloodRedLight);
  }

  _drawBossWarn(ctx) {
    const cw = this.cssW, ch = this.cssH;
    if (Math.floor(this.bossWarnT * 4) % 2 === 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = Config.Palette.bloodRedLight;
      ctx.font = 'bold 34px serif';
      ctx.fillText('⚠ BOSS 降临 ⚠', cw / 2, ch * 0.32);
    }
  }

  _wrapText(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (let i = 0; i < text.length; i++) {
      const test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = text[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  _drawBoonOverlay(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    ctx.fillStyle = 'rgba(8,4,16,0.82)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 26px serif';
    const topY = this.boonChoices[0].rect.y - 44;
    ctx.fillText('诸 神 的 馈 赠', cw / 2, topY);
    ctx.fillStyle = 'rgba(243,233,210,0.6)';
    ctx.font = '14px sans-serif';
    ctx.fillText('选择一项祝福（可叠加）' + (this.pendingBoons > 1 ? '  · 剩余 ' + this.pendingBoons : ''), cw / 2, topY + 24);
    for (const c of this.boonChoices) this._drawBoonCard(ctx, c);
  }

  _drawBoonCard(ctx, c) {
    const P = Config.Palette;
    const r = c.rect;
    const def = c.def;
    const g = GODS[def.god];

    ctx.fillStyle = 'rgba(24,14,38,0.96)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = g.accent;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    const badgeX = r.x + 40, badgeY = r.y + r.h / 2;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,6,18,0.9)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = g.accent;
    ctx.stroke();
    ctx.fillStyle = g.color;
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.short, badgeX, badgeY + 1);

    const tx = r.x + 78;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = g.color;
    ctx.font = 'bold 19px serif';
    ctx.fillText(def.name + '  Lv.' + c.nextLevel, tx, r.y + 16);
    ctx.fillStyle = 'rgba(243,233,210,0.55)';
    ctx.font = '12px sans-serif';
    ctx.fillText(g.name + ' · ' + def.slot, tx, r.y + 40);
    ctx.fillStyle = P.textLight;
    ctx.font = '13px sans-serif';
    const lines = this._wrapText(ctx, def.desc(c.nextLevel), r.w - 92);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], tx, r.y + 62 + i * 18);
  }

  _drawDeathOverlay(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    ctx.fillStyle = 'rgba(10,4,18,0.72)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.bloodRedLight;
    ctx.font = 'bold 46px serif';
    ctx.fillText('你 已 陨 落', cw / 2, ch / 2 - 50);
    ctx.fillStyle = P.textLight;
    ctx.font = '18px sans-serif';
    ctx.fillText('存活 ' + fmtTime(this.elapsed) + '   击杀 ' + this.kills, cw / 2, ch / 2 - 6);
    if (this.deathPromptT > 0.8 && Math.floor(this.deathPromptT * 2) % 2 === 0) {
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = '20px serif';
      ctx.fillText('轻触重新开始', cw / 2, ch / 2 + 50);
    }
  }
}

module.exports = Game;
