// js/weapons.js —— 武器定义：改变普攻与特殊的攻击模式、范围、速度与基础属性
// 数据驱动：新增武器加一条即可；引擎按 type（melee/ranged）与 special 分支执行。
const WEAPONS = {
  sword: {
    id: 'sword', name: '冥钢之剑', short: '剑', type: 'melee',
    color: '#ffe08a',
    basicDamage: 18,
    bonusHp: 30, bonusArmor: 3,   // 选剑：+30 生命、+3 护甲
    // 近战扇形 + 三连击时序（攻击距离 +50%）
    reach: 150, halfAngle: Math.PI / 3,
    windup: 0.05, active: 0.12, recover: 0.15, gap: 0.02, comboWindow: 0.45,
    knockback: 230, hitstun: 0.3, moveScale: 0.45,
    thirdHitDamageBonus: 12, thirdHitReachBonus: 26, thirdHitKnockbackBonus: 170,
    special: { name: '旋斩', cooldown: 3.0, damage: 34, radius: 165, knockback: 340 },
    desc: '近身扇形三连斩。特殊·旋斩：环身范围斩击并击退。'
  },

  bow: {
    id: 'bow', name: '夜枭之弓', short: '弓', type: 'ranged',
    color: '#8fd0ff',
    basicDamage: 13,
    bonusHp: 0, bonusArmor: 0,
    // 远程速射
    fireInterval: 0.26,            // 连射间隔（按住普攻的射速）
    windup: 0.02, active: 0.05, recover: 0.06, moveScale: 0.7,
    arrowSpeed: 780, arrowRange: 820, arrowRadius: 7,
    arrowKnockback: 120, hitstun: 0.12,
    special: { name: '散射', cooldown: 2.6, arrows: 5, spread: Math.PI / 3.2, damage: 12, arrowKnockback: 150 },
    desc: '远程速射。特殊·散射：扇形齐射多支利箭。'
  }
};

const WEAPON_LIST = ['sword', 'bow'];

module.exports = { WEAPONS, WEAPON_LIST };
