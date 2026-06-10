// js/meta.js —— 永久成长（黑暗精华 + 永久升级），用 wx.setStorageSync 持久化
const KEY = 'hades_meta_v1';

// 永久升级定义：base + level*step 为升下一级所需精华
const UPGRADES = [
  { id: 'hp', name: '不灭血脉', max: 10, base: 12, step: 8, effect: (lv) => '最大生命 +' + (lv * 20) },
  { id: 'atk', name: '冥王之握', max: 8, base: 15, step: 12, effect: (lv) => '攻击力 +' + (lv * 3) },
  { id: 'stam', name: '不竭之力', max: 8, base: 10, step: 6, effect: (lv) => '最大体力 +' + (lv * 15) },
  { id: 'revive', name: '卡戎的契约', max: 3, base: 50, step: 60, effect: (lv) => '每局额外复活 ' + lv + ' 次' },
  { id: 'boon', name: '神谕恩泽', max: 2, base: 60, step: 80, effect: (lv) => '祝福可选项 +' + lv }
];
const UP_BY_ID = {};
UPGRADES.forEach((u) => { UP_BY_ID[u.id] = u; });

function safeGet() {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const d = wx.getStorageSync(KEY);
      if (d && typeof d === 'object') return d;
    }
  } catch (e) { /* ignore */ }
  return null;
}
function safeSet(o) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(KEY, o);
  } catch (e) { /* ignore */ }
}

class MetaProgress {
  constructor(data) {
    data = data || {};
    this.essence = data.essence || 0;
    this.best = { kills: (data.best && data.best.kills) || 0, time: (data.best && data.best.time) || 0 };
    this.up = {};
    for (const u of UPGRADES) this.up[u.id] = (data.up && data.up[u.id]) || 0;
  }

  static load() { return new MetaProgress(safeGet()); }
  toJSON() { return { essence: this.essence, best: this.best, up: this.up }; }
  save() { safeSet(this.toJSON()); }

  level(id) { return this.up[id] || 0; }
  def(id) { return UP_BY_ID[id]; }
  isMax(id) { return this.level(id) >= UP_BY_ID[id].max; }
  costNext(id) { const u = UP_BY_ID[id]; return u.base + this.level(id) * u.step; }
  canBuy(id) { return !this.isMax(id) && this.essence >= this.costNext(id); }
  buy(id) {
    if (!this.canBuy(id)) return false;
    this.essence -= this.costNext(id);
    this.up[id]++;
    this.save();
    return true;
  }

  addEssence(n) { this.essence += n; }
  recordRun(kills, time) {
    let nb = false;
    if (kills > this.best.kills) { this.best.kills = kills; nb = true; }
    if (time > this.best.time) this.best.time = time;
    return nb;
  }

  hpBonus() { return this.level('hp') * 20; }
  atkBonus() { return this.level('atk') * 3; }
  stamBonus() { return this.level('stam') * 15; }
  revives() { return this.level('revive'); }
  boonExtra() { return this.level('boon'); }
}

module.exports = { MetaProgress, UPGRADES };
