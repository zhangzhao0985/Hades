// js/boons.js —— 祝福系统（God Boons）：神祇、祝福定义、可叠加的 BoonManager
// 设计为数据驱动：新增祝福只需往 BOON_DEFS 加一条，并在 recompute() 里描述其聚合效果。

// 神祇主题色（用于卡片与 Build 图标）
const GODS = {
  zeus:      { name: '宙斯',     color: '#ffe08a', accent: '#f5c542' },
  poseidon:  { name: '波塞冬',   color: '#8fd0ff', accent: '#4ea3ff' },
  athena:    { name: '雅典娜',   color: '#cfe8ff', accent: '#9ec9ff' },
  ares:      { name: '阿瑞斯',   color: '#ff6f5e', accent: '#d23b2e' },
  aphrodite: { name: '阿芙洛狄忒', color: '#ff9ed2', accent: '#e86bb0' },
  artemis:   { name: '阿尔忒弥斯', color: '#9fe6a0', accent: '#4eae5a' },
  demeter:   { name: '得墨忒耳', color: '#bfe9ff', accent: '#7fc6e6' },
  dionysus:  { name: '狄俄尼索斯', color: '#c79bff', accent: '#8a5fd0' },
  hermes:    { name: '赫尔墨斯', color: '#ffe9a8', accent: '#f5c542' },
  hestia:    { name: '赫斯提亚', color: '#ffb070', accent: '#ff6a2b' },
  styx:      { name: '冥河之力', color: '#c9a8ff', accent: '#8a5fd0' } // 被动增益
};

// 祝福定义。desc(lv) 描述「升到该等级后」的效果。
const BOON_DEFS = [
  {
    id: 'zeus_chain', god: 'zeus', name: '雷霆万钧', short: '雷', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中时引发连锁闪电，跳跃 ${1 + lv} 次，每次 ${8 + lv * 4} 点伤害`
  },
  {
    id: 'poseidon_strike', god: 'poseidon', name: '惊涛裂岸', short: '涛', slot: '普攻', maxLevel: 3, gold: true,
    desc: (lv) => `攻击击退大幅增强，并附加 ${6 + lv * 4} 点撞击伤害`
  },
  {
    id: 'ares_bleed', god: 'ares', name: '血怒', short: '怒', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中使敌人流血，每秒 ${6 + lv * 4} 点，持续 3 秒`
  },
  {
    id: 'aphrodite_weak', god: 'aphrodite', name: '魅惑', short: '媚', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中使敌人虚弱，伤害降低 ${Math.round((1 - Math.max(0.4, 0.75 - 0.1 * lv)) * 100)}%，持续 4 秒`
  },
  {
    id: 'athena_deflect', god: 'athena', name: '神圣冲刺', short: '盾', slot: '闪避', maxLevel: 3,
    desc: (lv) => `闪避无敌时撞击敌人将其击退，并造成 ${14 + lv * 8} 点伤害`
  },
  {
    id: 'artemis_crit', god: 'artemis', name: '猎手印记', short: '猎', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中有 ${15 + lv * 8}% 概率暴击，造成 ${Math.round((1.5 + lv * 0.25) * 100)}% 伤害`
  },
  {
    id: 'demeter_chill', god: 'demeter', name: '凛冬之触', short: '凛', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中冰缓，敌人移速降低 ${Math.round((1 - Math.max(0.4, 0.8 - 0.12 * lv)) * 100)}%，持续 3 秒`
  },
  {
    id: 'dionysus_poison', god: 'dionysus', name: '宿醉毒雾', short: '醉', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中中毒，每秒 ${5 + lv * 4} 点，持续 4 秒`
  },
  {
    id: 'hestia_burn', god: 'hestia', name: '不灭灶火', short: '焰', slot: '普攻', maxLevel: 3,
    desc: (lv) => `命中点燃，每秒 ${8 + lv * 5} 点，持续 3 秒`
  },
  {
    id: 'hermes_swift', god: 'hermes', name: '疾风之足', short: '疾', slot: '被动', maxLevel: 3,
    desc: (lv) => `移动速度 +${10 + lv * 6}%、攻击速度 +${8 + lv * 7}%`
  },
  {
    id: 'styx_reaper', god: 'styx', name: '收割之契', short: '割', slot: '被动', maxLevel: 3,
    desc: (lv) => `击杀敌人回复 ${4 + lv * 3} 点生命`
  },
  {
    id: 'styx_vitality', god: 'styx', name: '不灭血脉', short: '命', slot: '被动', maxLevel: 4,
    desc: (lv) => `最大生命 +${25 * lv}（获得时回复等量生命）`
  },
  {
    id: 'styx_strength', god: 'styx', name: '冥王之力', short: '力', slot: '被动', maxLevel: 4, gold: true,
    desc: (lv) => `普通攻击伤害 +${6 * lv}`
  },
  {
    id: 'styx_stamina', god: 'styx', name: '不竭之息', short: '耐', slot: '被动', maxLevel: 4,
    desc: (lv) => `最大体力 +${25 * lv}`
  }
];

const DEF_BY_ID = {};
for (const d of BOON_DEFS) DEF_BY_ID[d.id] = d;

function baseMods() {
  return {
    bonusAttackDamage: 0,
    bonusMaxHp: 0,
    bonusMaxStamina: 0,
    killHeal: 0,
    zeus: { active: false, jumps: 0, damage: 0, range: 0 },
    poseidon: { active: false, knockbackMul: 1, impactDamage: 0 },
    ares: { active: false, dps: 0, duration: 0 },
    aphrodite: { active: false, weakMul: 1, duration: 0 },
    athena: { active: false, damage: 0, knockback: 0 },
    artemis: { active: false, chance: 0, mult: 1.5 },
    demeter: { active: false, slowMul: 1, duration: 0 },
    dionysus: { active: false, dps: 0, duration: 0 },
    hestia: { active: false, dps: 0, duration: 0 },
    hermes: { active: false, moveMul: 1, atkMul: 1 }
  };
}

class BoonManager {
  constructor() {
    this.owned = {};       // id -> level
    this.order = [];       // 获得顺序（用于 Build 图标展示）
    this.mods = baseMods();
  }

  reset() {
    this.owned = {};
    this.order = [];
    this.recompute();
  }

  has(id) { return !!this.owned[id]; }
  level(id) { return this.owned[id] || 0; }
  def(id) { return DEF_BY_ID[id]; }

  add(id) {
    const def = DEF_BY_ID[id];
    if (!def) return;
    const cur = this.owned[id] || 0;
    if (cur === 0) this.order.push(id);
    this.owned[id] = Math.min(def.maxLevel, cur + 1);
    this.recompute();
  }

  // 随机抽取 n 个可选祝福（未拥有或未满级），返回 { def, nextLevel }
  getChoices(n) {
    const pool = BOON_DEFS.filter((d) => (this.owned[d.id] || 0) < d.maxLevel);
    // Fisher-Yates 洗牌
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, Math.min(n, pool.length)).map((d) => ({
      def: d,
      nextLevel: (this.owned[d.id] || 0) + 1
    }));
  }

  // 依据已拥有祝福聚合出战斗用的 mods
  recompute() {
    const m = baseMods();
    for (const id in this.owned) {
      const lv = this.owned[id];
      switch (id) {
        case 'zeus_chain':
          m.zeus.active = true; m.zeus.jumps = 1 + lv; m.zeus.damage = 8 + lv * 4; m.zeus.range = 280; break;
        case 'poseidon_strike':
          m.poseidon.active = true; m.poseidon.knockbackMul = 1.6 + 0.3 * (lv - 1); m.poseidon.impactDamage = 6 + lv * 4; break;
        case 'ares_bleed':
          m.ares.active = true; m.ares.dps = 6 + lv * 4; m.ares.duration = 3; break;
        case 'aphrodite_weak':
          m.aphrodite.active = true; m.aphrodite.weakMul = Math.max(0.4, 0.75 - 0.1 * lv); m.aphrodite.duration = 4; break;
        case 'athena_deflect':
          m.athena.active = true; m.athena.damage = 14 + lv * 8; m.athena.knockback = 300; break;
        case 'styx_vitality':
          m.bonusMaxHp += 25 * lv; break;
        case 'styx_strength':
          m.bonusAttackDamage += 6 * lv; break;
        case 'styx_stamina':
          m.bonusMaxStamina += 25 * lv; break;
        case 'artemis_crit':
          m.artemis.active = true; m.artemis.chance = 0.15 + lv * 0.08; m.artemis.mult = 1.5 + lv * 0.25; break;
        case 'demeter_chill':
          m.demeter.active = true; m.demeter.slowMul = Math.max(0.4, 0.8 - 0.12 * lv); m.demeter.duration = 3; break;
        case 'dionysus_poison':
          m.dionysus.active = true; m.dionysus.dps = 5 + lv * 4; m.dionysus.duration = 4; break;
        case 'hestia_burn':
          m.hestia.active = true; m.hestia.dps = 8 + lv * 5; m.hestia.duration = 3; break;
        case 'hermes_swift':
          m.hermes.active = true; m.hermes.moveMul = 1 + (0.10 + lv * 0.06); m.hermes.atkMul = 1 + (0.08 + lv * 0.07); break;
        case 'styx_reaper':
          m.killHeal += 4 + lv * 3; break;
      }
    }
    this.mods = m;
  }
}

module.exports = { BoonManager, BOON_DEFS, GODS };
