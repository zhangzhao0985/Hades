// js/sprites.js —— 2.5D 角色绘制（带手脚的小人，参考《饥荒》造型 + 《Hades》粗描边戏剧化画风）
// 全部用 Canvas 2D 矢量绘制，无贴图。所有实体共用 drawCharacter。
const Config = require('./config.js');

// 胶囊形肢体：先描边后填充，得到“粗黑描边”的手绘感
function capsule(ctx, x1, y1, x2, y2, w, fill, outline, ow) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w + ow * 2;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w;
  ctx.strokeStyle = fill;
  ctx.stroke();
}

/**
 * 绘制一个带头/躯干/双臂/双腿的 2.5D 小人。
 * o: { x, y(实体中心), r(半径=体型), facing, walk(步态相位), moving,
 *      colors:{ body, bodyLight, outline, skin, hair, accent, eye, weapon },
 *      feature:'laurel'|'horns'|'crown'|null, glowEyes, weapon:'sword'|'bow'|null,
 *      sash, alpha }
 */
function drawCharacter(ctx, o) {
  const P = Config.Palette;
  const x = o.x, y = o.y, r = o.r;
  const c = o.colors;
  const dir = Math.cos(o.facing != null ? o.facing : 0) >= 0 ? 1 : -1;
  const sw = o.moving ? Math.sin(o.walk || 0) : 0;
  const alpha = o.alpha != null ? o.alpha : 1;
  const ow = Math.max(1.5, r * 0.10);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 落地阴影
  ctx.save();
  ctx.translate(x, y + r * 0.98);
  ctx.scale(1, 0.42);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = P.shadow;
  ctx.fill();
  ctx.restore();

  // 关键点
  const feetY = y + r * 1.02;
  const hipY = y + r * 0.30;
  const shoulderY = y - r * 0.30;
  const headCy = y - r * 0.92;
  const headR = r * 0.6;

  const legW = r * 0.30, armW = r * 0.24, torsoW = r * 0.92;
  const legSpread = r * 0.26, armSpread = r * 0.5;
  const legSwing = sw * r * 0.42;
  const armSwing = sw * r * 0.40;

  // 双腿（步态摆动）
  capsule(ctx, x - legSpread, hipY, x - legSpread - legSwing, feetY, legW, c.limb, c.outline, ow);
  capsule(ctx, x + legSpread, hipY, x + legSpread + legSwing, feetY, legW, c.limb, c.outline, ow);
  // 脚
  ctx.fillStyle = c.outline;
  ctx.beginPath(); ctx.ellipse(x - legSpread - legSwing + dir * r * 0.06, feetY, r * 0.20, r * 0.10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + legSpread + legSwing + dir * r * 0.06, feetY, r * 0.20, r * 0.10, 0, 0, Math.PI * 2); ctx.fill();

  // 躯干
  capsule(ctx, x, hipY + r * 0.04, x, shoulderY, torsoW, c.body, c.outline, ow);
  // 斜挎腰带（主角）
  if (o.sash && c.accent) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - dir * torsoW * 0.45, shoulderY + r * 0.08);
    ctx.lineTo(x + dir * torsoW * 0.45, hipY);
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = c.accent;
    ctx.stroke();
    ctx.restore();
  }

  // 后臂（与前腿同摆）
  capsule(ctx, x - dir * armSpread * 0.55, shoulderY + r * 0.02, x - dir * armSpread * 0.55 - legSwing * 0.4, hipY + armSwing, armW, c.body, c.outline, ow);

  // 前臂（持武器，反向摆）
  const fSX = x + dir * armSpread * 0.5;
  const fHX = x + dir * (armSpread * 0.62);
  const fHY = hipY - armSwing;
  capsule(ctx, fSX, shoulderY + r * 0.02, fHX, fHY, armW, c.bodyLight || c.body, c.outline, ow);

  // 武器（主角）
  if (o.weapon === 'sword') {
    const tipx = fHX + dir * r * 1.15, tipy = fHY - r * 0.55;
    capsule(ctx, fHX, fHY, tipx, tipy, r * 0.14, c.weapon || '#ffe08a', c.outline, ow * 0.7);
    // 护手
    capsule(ctx, fHX - dir * r * 0.08, fHY + r * 0.06, fHX + dir * r * 0.12, fHY - r * 0.1, r * 0.1, c.weapon || '#ffe08a', c.outline, ow * 0.6);
  } else if (o.weapon === 'bow') {
    const bx = fHX + dir * r * 0.18, by = fHY - r * 0.1;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.7, -Math.PI * 0.55, Math.PI * 0.55, dir < 0);
    ctx.lineWidth = r * 0.12 + ow;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.7, -Math.PI * 0.55, Math.PI * 0.55, dir < 0);
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = c.weapon || '#8fd0ff';
    ctx.stroke();
    // 弓弦
    ctx.beginPath();
    ctx.moveTo(bx + dir * Math.cos(-Math.PI * 0.55) * r * 0.7, by + Math.sin(-Math.PI * 0.55) * r * 0.7);
    ctx.lineTo(bx + dir * Math.cos(Math.PI * 0.55) * r * 0.7, by + Math.sin(Math.PI * 0.55) * r * 0.7);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }

  // 头
  ctx.beginPath();
  ctx.arc(x, headCy, headR, 0, Math.PI * 2);
  ctx.fillStyle = c.skin;
  ctx.fill();
  ctx.lineWidth = ow;
  ctx.strokeStyle = c.outline;
  ctx.stroke();

  // 头发（主角：盖住头顶与后脑）
  if (c.hair) {
    ctx.beginPath();
    ctx.arc(x - dir * headR * 0.12, headCy - headR * 0.12, headR * 0.96, Math.PI * 0.86, Math.PI * 2.05);
    ctx.lineTo(x - dir * headR * 0.6, headCy);
    ctx.closePath();
    ctx.fillStyle = c.hair;
    ctx.fill();
  }

  // 眼睛
  const eyeY = headCy + headR * 0.06;
  const eyeOff = headR * 0.30;
  const eyeLean = dir * headR * 0.12;
  if (o.glowEyes) {
    // 发光眼（亡魂/精英/Boss）：外晕 + 亮核
    for (const s of [-1, 1]) {
      const ex = x + eyeLean + s * eyeOff;
      ctx.globalAlpha = alpha * 0.45;
      ctx.fillStyle = c.eye;
      ctx.beginPath(); ctx.arc(ex, eyeY, headR * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(ex, eyeY, headR * 0.13, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    // 普通眼（主角）
    ctx.fillStyle = c.eye || '#1b1020';
    for (const s of [-1, 1]) {
      const ex = x + eyeLean + s * eyeOff * 0.85;
      ctx.beginPath(); ctx.arc(ex, eyeY, headR * 0.12, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = alpha;

  // 头部装饰
  if (o.feature === 'laurel') {
    // 金桂冠
    ctx.strokeStyle = P.olympusGold;
    ctx.lineWidth = ow * 0.9;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + s * headR * 0.7, headCy - headR * 0.2, headR * 0.7, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    }
  } else if (o.feature === 'horns') {
    ctx.fillStyle = '#f3e2c0';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * headR * 0.6, headCy - headR * 0.5);
      ctx.lineTo(x + s * headR * 1.05, headCy - headR * 1.25);
      ctx.lineTo(x + s * headR * 0.95, headCy - headR * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = ow * 0.7; ctx.strokeStyle = c.outline; ctx.stroke();
    }
  } else if (o.feature === 'crown') {
    ctx.fillStyle = P.olympusGold;
    const cy0 = headCy - headR * 0.85;
    ctx.beginPath();
    ctx.moveTo(x - headR * 0.9, cy0 + headR * 0.4);
    for (let i = 0; i < 5; i++) {
      const px = x - headR * 0.9 + (i + 0.5) * (headR * 1.8 / 5);
      ctx.lineTo(px, cy0 - headR * 0.5);
      ctx.lineTo(x - headR * 0.9 + (i + 1) * (headR * 1.8 / 5), cy0 + headR * 0.4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = ow * 0.7; ctx.strokeStyle = c.outline; ctx.stroke();
  }

  ctx.restore();
}

// 颜色预设
const SKINS = {
  player: { body: '#3a1430', bodyLight: '#5a2240', outline: '#0c0610', skin: '#d89a72', hair: '#1b1020', accent: '#d23b2e', eye: '#1b1020', weapon: '#ffe08a', limb: '#2a0f24' },
  melee: { body: '#6a3d8f', bodyLight: '#9b6fc4', outline: '#140a20', skin: '#7a4c9e', hair: null, accent: null, eye: '#ffd76a', limb: '#4a2a6a' },
  elite: { body: '#b5471f', bodyLight: '#ff8a3d', outline: '#250a05', skin: '#c4561f', hair: null, accent: null, eye: '#ffe08a', limb: '#7a2e12' },
  boss: { body: '#7a0e1a', bodyLight: '#e8453a', outline: '#180306', skin: '#8a1320', hair: null, accent: null, eye: '#ffd76a', limb: '#4a060e' }
};

module.exports = { drawCharacter, SKINS };
