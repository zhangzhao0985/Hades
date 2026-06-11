// js/sprites.js —— 2.5D 大头 Q 版角色绘制（Mini-Mike 风：粗黑描边/大头短身/夸张表情）
// 主角=希腊英雄向（图一），敌人=怪物向（图二，兜帽/獠牙/发光眼）。全矢量，无贴图。
const Config = require('./config.js');

function capsule(ctx, x1, y1, x2, y2, w, fill, outline, ow) {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.lineWidth = w + ow * 2; ctx.strokeStyle = outline; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.lineWidth = w; ctx.strokeStyle = fill; ctx.stroke();
}

function _eyes(ctx, ex, ey, er, color, n, spread) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * spread;
    ctx.beginPath(); ctx.arc(ex, ey + off, er, 0, Math.PI * 2); ctx.fill();
  }
}

// 发光眼（怪物）
function _glowEyes(ctx, x, eyeY, eyeDX, lean, er, color, alpha) {
  for (const s of [-1, 1]) {
    const ex = x + lean + s * eyeDX;
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(ex, eyeY, er * 2.0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(ex, eyeY, er, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = alpha;
}

// 脸部：愤怒眉 + 眼睛 + 嘴
function _drawFace(ctx, x, headCy, headR, c, o, dir, ow, alpha) {
  const eyeY = headCy + headR * 0.02;
  const eyeDX = headR * 0.34;
  const lean = dir * headR * 0.08;

  // 眉毛（愤怒 V）
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = ow * 0.95;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const bx = x + lean + s * eyeDX;
    ctx.beginPath();
    ctx.moveTo(bx - s * headR * 0.18, eyeY - headR * 0.36);
    ctx.lineTo(bx + s * headR * 0.10, eyeY - headR * 0.14);
    ctx.stroke();
  }

  if (o.glowEyes) {
    _glowEyes(ctx, x, eyeY, eyeDX, lean, headR * 0.14, c.eye, alpha);
  } else {
    for (const s of [-1, 1]) {
      const ex = x + lean + s * eyeDX;
      ctx.fillStyle = '#fbf3e0';
      ctx.beginPath(); ctx.ellipse(ex, eyeY, headR * 0.15, headR * 0.19, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = ow * 0.6; ctx.strokeStyle = c.outline; ctx.stroke();
      ctx.fillStyle = c.eye || '#1b1020';
      ctx.beginPath(); ctx.arc(ex + dir * headR * 0.05, eyeY + headR * 0.03, headR * 0.08, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 嘴
  const my = headCy + headR * 0.46;
  const mouth = o.mouth || c.mouth;
  if (mouth === 'fangs') {
    ctx.fillStyle = '#1a0c10';
    ctx.beginPath(); ctx.ellipse(x, my, headR * 0.26, headR * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff7e0';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * headR * 0.14, my - headR * 0.12);
      ctx.lineTo(x + s * headR * 0.20, my - headR * 0.12);
      ctx.lineTo(x + s * headR * 0.16, my + headR * 0.06);
      ctx.closePath(); ctx.fill();
    }
  } else if (mouth === 'frown') {
    ctx.strokeStyle = c.outline; ctx.lineWidth = ow * 0.8;
    ctx.beginPath(); ctx.arc(x, my + headR * 0.16, headR * 0.2, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
  } else {
    ctx.strokeStyle = c.outline; ctx.lineWidth = ow * 0.7;
    ctx.beginPath(); ctx.moveTo(x - headR * 0.12, my); ctx.lineTo(x + headR * 0.12, my); ctx.stroke();
  }
}

// 兜帽头（亡魂/法师）：兜帽 + 暗面 + 发光眼
function _drawHoodHead(ctx, x, headCy, headR, c, dir, ow, alpha) {
  ctx.fillStyle = c.hood;
  ctx.beginPath();
  ctx.moveTo(x - headR, headCy + headR * 0.55);
  ctx.quadraticCurveTo(x - headR * 1.08, headCy - headR * 0.85, x + dir * headR * 0.12, headCy - headR * 1.18);
  ctx.quadraticCurveTo(x + headR * 1.08, headCy - headR * 0.6, x + headR, headCy + headR * 0.55);
  ctx.quadraticCurveTo(x, headCy + headR * 0.95, x - headR, headCy + headR * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = ow; ctx.strokeStyle = c.outline; ctx.stroke();
  // 暗面
  ctx.fillStyle = '#0a0712';
  ctx.beginPath(); ctx.ellipse(x + dir * headR * 0.05, headCy + headR * 0.2, headR * 0.56, headR * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // 发光眼
  const eyeY = headCy + headR * 0.12;
  _glowEyes(ctx, x, eyeY, headR * 0.26, dir * headR * 0.05, headR * 0.12, c.eye, alpha);
}

function drawCharacter(ctx, o) {
  const P = Config.Palette;
  const x = o.x, y = o.y, r = o.r;
  const c = o.colors;
  const dir = Math.cos(o.facing != null ? o.facing : 0) >= 0 ? 1 : -1;
  const sw = o.moving ? Math.sin(o.walk || 0) : 0;
  const alpha = o.alpha != null ? o.alpha : 1;
  const ow = Math.max(2, r * 0.13);
  const rank = (o.rank != null) ? o.rank : -1;
  const wl = o.weaponLevel || 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 落地阴影
  ctx.save();
  ctx.translate(x, y + r * 1.06);
  ctx.scale(1, 0.4);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  ctx.fillStyle = P.shadow; ctx.fill();
  ctx.restore();

  if (o.shape && o.shape !== 'humanoid') {
    _drawCreature(ctx, o, x, y, r, c, dir, sw, ow);
    ctx.restore();
    return;
  }

  // 大头 Q 版比例
  const headR = r * 0.9;
  const headCy = y - r * 0.5;
  const feetY = y + r * 1.05;
  const hipY = y + r * 0.36;
  const shoulderY = y + r * 0.02;
  const torsoTopW = r * 0.82, torsoBotW = r * 1.2;
  const legW = r * 0.36, armW = r * 0.3;
  const legSpread = r * 0.22, armSpread = r * 0.52;
  const legSwing = sw * r * 0.26, armSwing = sw * r * 0.24;

  // —— 骑士装饰（披风/翅膀，画在最后面）——
  if (rank >= 2) {
    ctx.beginPath();
    ctx.moveTo(x - torsoTopW * 0.5, shoulderY);
    ctx.lineTo(x + torsoTopW * 0.5, shoulderY);
    ctx.lineTo(x + torsoBotW * 0.55, hipY + r * 0.5);
    ctx.lineTo(x, hipY + r * 0.66);
    ctx.lineTo(x - torsoBotW * 0.55, hipY + r * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#24527a'; ctx.fill();
    ctx.lineWidth = ow * 0.8; ctx.strokeStyle = P.olympusGold; ctx.stroke();
  }
  if (rank >= 3) {
    const ws = rank >= 4 ? 1.35 : 1.0;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.3, shoulderY);
      ctx.quadraticCurveTo(x + s * r * 1.4 * ws, shoulderY - r * 1.0 * ws, x + s * r * 1.5 * ws, shoulderY + r * 0.25);
      ctx.quadraticCurveTo(x + s * r * 0.95, shoulderY + r * 0.35, x + s * r * 0.32, shoulderY + r * 0.2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(208,234,255,0.92)'; ctx.fill();
      ctx.lineWidth = ow * 0.7; ctx.strokeStyle = P.olympusGold; ctx.stroke();
    }
  }

  // —— 双腿（短粗）+ 脚 ——
  capsule(ctx, x - legSpread, hipY, x - legSpread - legSwing, feetY, legW, c.limb, c.outline, ow);
  capsule(ctx, x + legSpread, hipY, x + legSpread + legSwing, feetY, legW, c.limb, c.outline, ow);
  ctx.fillStyle = c.outline;
  ctx.beginPath(); ctx.ellipse(x - legSpread - legSwing + dir * r * 0.06, feetY, r * 0.21, r * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + legSpread + legSwing + dir * r * 0.06, feetY, r * 0.21, r * 0.11, 0, 0, Math.PI * 2); ctx.fill();

  // —— 躯干（束腰外袍：上窄下宽梯形）——
  ctx.beginPath();
  ctx.moveTo(x - torsoTopW / 2, shoulderY);
  ctx.lineTo(x + torsoTopW / 2, shoulderY);
  ctx.lineTo(x + torsoBotW / 2, hipY + r * 0.04);
  ctx.lineTo(x - torsoBotW / 2, hipY + r * 0.04);
  ctx.closePath();
  ctx.fillStyle = c.body; ctx.fill();
  ctx.lineWidth = ow; ctx.strokeStyle = c.outline; ctx.stroke();
  // 腰带
  ctx.fillStyle = c.outline;
  ctx.fillRect(x - torsoBotW * 0.46, hipY - r * 0.06, torsoBotW * 0.92, r * 0.12);
  // 斜挎（主角）
  if (o.sash && c.accent) {
    ctx.strokeStyle = c.accent; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.moveTo(x - dir * torsoTopW * 0.5, shoulderY); ctx.lineTo(x + dir * torsoBotW * 0.42, hipY); ctx.stroke();
  }

  // —— 双臂（短粗）——
  capsule(ctx, x - dir * armSpread * 0.55, shoulderY + r * 0.04, x - dir * armSpread * 0.6 - legSwing * 0.3, hipY + armSwing, armW, c.body, c.outline, ow);
  const fSX = x + dir * armSpread * 0.5;
  const fHX = x + dir * armSpread * 0.66;
  const fHY = hipY - armSwing;
  capsule(ctx, fSX, shoulderY + r * 0.04, fHX, fHY, armW, c.bodyLight || c.body, c.outline, ow);

  // 肩甲（铁砧骑士起）
  if (rank >= 1) {
    ctx.fillStyle = c.bodyLight || c.body;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(x + s * torsoTopW * 0.55, shoulderY + r * 0.02, r * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = ow * 0.8; ctx.strokeStyle = c.outline; ctx.stroke();
    }
  }

  // —— 武器（主角）——
  if (o.weapon === 'sword') {
    const wmul = 1 + wl * 0.18;
    const tipx = fHX + dir * r * 1.15 * wmul, tipy = fHY - r * 0.6 * wmul;
    if (wl > 0) capsule(ctx, fHX, fHY, tipx, tipy, r * 0.22, 'rgba(255,224,138,0.4)', 'rgba(255,224,138,0)', 0);
    capsule(ctx, fHX, fHY, tipx, tipy, r * 0.14, wl > 0 ? '#fff2c0' : (c.weapon || '#ffe08a'), c.outline, ow * 0.7);
    capsule(ctx, fHX - dir * r * 0.08, fHY + r * 0.06, fHX + dir * r * 0.12, fHY - r * 0.1, r * 0.1, c.weapon || '#ffe08a', c.outline, ow * 0.6);
  } else if (o.weapon === 'bow') {
    const br = r * 0.72 * (1 + wl * 0.12);
    const bx = fHX + dir * r * 0.18, by = fHY - r * 0.1;
    if (wl > 0) { ctx.beginPath(); ctx.arc(bx, by, br, -Math.PI * 0.55, Math.PI * 0.55, dir < 0); ctx.lineWidth = r * 0.22; ctx.strokeStyle = 'rgba(143,208,255,0.4)'; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(bx, by, br, -Math.PI * 0.55, Math.PI * 0.55, dir < 0); ctx.lineWidth = r * 0.12 + ow; ctx.strokeStyle = c.outline; ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, br, -Math.PI * 0.55, Math.PI * 0.55, dir < 0); ctx.lineWidth = r * 0.12; ctx.strokeStyle = wl > 0 ? '#cfeaff' : (c.weapon || '#8fd0ff'); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx + dir * Math.cos(-Math.PI * 0.55) * br, by + Math.sin(-Math.PI * 0.55) * br);
    ctx.lineTo(bx + dir * Math.cos(Math.PI * 0.55) * br, by + Math.sin(Math.PI * 0.55) * br);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
  }

  // —— 头 ——
  if (c.hood) {
    _drawHoodHead(ctx, x, headCy, headR, c, dir, ow, alpha);
  } else {
    ctx.beginPath(); ctx.arc(x, headCy, headR, 0, Math.PI * 2);
    ctx.fillStyle = c.skin; ctx.fill();
    ctx.lineWidth = ow; ctx.strokeStyle = c.outline; ctx.stroke();
    // 头发
    if (c.hair) {
      ctx.beginPath();
      ctx.arc(x, headCy - headR * 0.12, headR * 0.98, Math.PI * 0.92, Math.PI * 2.08);
      ctx.quadraticCurveTo(x + dir * headR * 0.7, headCy - headR * 0.5, x + dir * headR * 0.55, headCy - headR * 0.1);
      ctx.closePath();
      ctx.fillStyle = c.hair; ctx.fill();
      ctx.lineWidth = ow * 0.7; ctx.strokeStyle = c.outline; ctx.stroke();
    }
    _drawFace(ctx, x, headCy, headR, c, o, dir, ow, alpha);
  }

  // 头部装饰
  _drawHeadFeature(ctx, o.feature, x, headCy, headR, c, ow, P);

  // 神印骑士光环
  if (rank >= 5) {
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = P.olympusGoldLight; ctx.lineWidth = ow;
    ctx.beginPath(); ctx.ellipse(x, headCy - headR * 1.25, headR * 0.95, headR * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  ctx.restore();
}

function _drawHeadFeature(ctx, feature, x, headCy, headR, c, ow, P) {
  if (feature === 'laurel') {
    ctx.strokeStyle = P.olympusGold; ctx.lineWidth = ow * 0.9;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.arc(x + s * headR * 0.7, headCy - headR * 0.3, headR * 0.7, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    }
  } else if (feature === 'horns') {
    ctx.fillStyle = '#f3e2c0';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * headR * 0.55, headCy - headR * 0.7);
      ctx.quadraticCurveTo(x + s * headR * 1.1, headCy - headR * 1.5, x + s * headR * 0.95, headCy - headR * 0.55);
      ctx.closePath();
      ctx.fill(); ctx.lineWidth = ow * 0.7; ctx.strokeStyle = c.outline; ctx.stroke();
    }
  } else if (feature === 'crown') {
    ctx.fillStyle = P.olympusGold;
    const cy0 = headCy - headR * 0.95;
    ctx.beginPath();
    ctx.moveTo(x - headR * 0.85, cy0 + headR * 0.4);
    for (let i = 0; i < 5; i++) {
      const px = x - headR * 0.85 + (i + 0.5) * (headR * 1.7 / 5);
      ctx.lineTo(px, cy0 - headR * 0.45);
      ctx.lineTo(x - headR * 0.85 + (i + 1) * (headR * 1.7 / 5), cy0 + headR * 0.4);
    }
    ctx.closePath();
    ctx.fill(); ctx.lineWidth = ow * 0.7; ctx.strokeStyle = c.outline; ctx.stroke();
  }
}

function _drawCreature(ctx, o, x, y, r, c, dir, sw, ow) {
  if (o.shape === 'beast') {
    const by = y, bodyLen = r * 1.7, bodyH = r * 0.82;
    const backX = x - dir * bodyLen * 0.42, frontX = x + dir * bodyLen * 0.42;
    const feetY = y + r * 0.98;
    capsule(ctx, backX, by, frontX, by, bodyH, c.body, c.outline, ow);
    capsule(ctx, backX, by - bodyH * 0.1, backX - dir * r * 0.7, by - r * 0.5, r * 0.13, c.limb, c.outline, ow * 0.7);
    const legs = [[backX - dir * r * 0.05, 1], [backX + dir * r * 0.35, -1], [frontX - dir * r * 0.25, 1], [frontX + dir * r * 0.05, -1]];
    for (const [lx, sgn] of legs) capsule(ctx, lx, by + bodyH * 0.2, lx + sw * r * 0.32 * sgn, feetY, r * 0.18, c.limb, c.outline, ow * 0.8);
    const hx = frontX + dir * r * 0.45, hy = by - r * 0.28, hr = r * 0.58;
    ctx.fillStyle = c.body;
    for (const s of [-0.2, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(hx - dir * hr * 0.2, hy - hr * 0.7);
      ctx.lineTo(hx - dir * hr * 0.2 + dir * s * hr, hy - hr * 1.5);
      ctx.lineTo(hx + dir * hr * 0.3, hy - hr * 0.5);
      ctx.closePath(); ctx.fill(); ctx.lineWidth = ow * 0.7; ctx.strokeStyle = c.outline; ctx.stroke();
    }
    capsule(ctx, hx, hy + hr * 0.15, hx + dir * hr * 1.0, hy + hr * 0.35, r * 0.24, c.body, c.outline, ow * 0.7);
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fillStyle = c.bodyLight; ctx.fill(); ctx.lineWidth = ow; ctx.strokeStyle = c.outline; ctx.stroke();
    _eyes(ctx, hx + dir * hr * 0.25, hy - hr * 0.1, hr * 0.16, c.eye, 1, 0);
    return;
  }
  if (o.shape === 'spider') {
    const bodyR = r * 0.8;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = i % 4;
      const a = (-0.5 + k * 0.45);
      const reach = r * (1.2 + 0.1 * Math.sin(sw + i));
      const midx = x + side * dir * r * 0.5, midy = y - bodyR * 0.2 - Math.cos(a) * r * 0.3;
      const tipx = x + side * dir * reach, tipy = y + r * 0.9;
      ctx.lineWidth = r * 0.12 + ow; ctx.strokeStyle = c.outline;
      ctx.beginPath(); ctx.moveTo(x + side * dir * bodyR * 0.5, y - bodyR * 0.1); ctx.lineTo(midx, midy); ctx.lineTo(tipx, tipy); ctx.stroke();
      ctx.lineWidth = r * 0.12; ctx.strokeStyle = c.limb;
      ctx.beginPath(); ctx.moveTo(x + side * dir * bodyR * 0.5, y - bodyR * 0.1); ctx.lineTo(midx, midy); ctx.lineTo(tipx, tipy); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, bodyR, 0, Math.PI * 2); ctx.fillStyle = c.body; ctx.fill(); ctx.lineWidth = ow; ctx.strokeStyle = c.outline; ctx.stroke();
    const hx = x + dir * bodyR * 0.85;
    ctx.beginPath(); ctx.arc(hx, y, bodyR * 0.5, 0, Math.PI * 2); ctx.fillStyle = c.bodyLight; ctx.fill(); ctx.stroke();
    _eyes(ctx, hx + dir * bodyR * 0.15, y - bodyR * 0.18, bodyR * 0.12, c.eye, 2, bodyR * 0.34);
    _eyes(ctx, hx + dir * bodyR * 0.35, y, bodyR * 0.09, c.eye, 2, bodyR * 0.22);
    return;
  }
  // blob
  const fuse = o.fuse || 0;
  const inflate = 1 + fuse * 0.28;
  const R = r * 1.08 * inflate;
  const red = fuse > 0 && Math.sin(fuse * 26) > 0;
  ctx.fillStyle = c.outline;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + s * R * 0.45, y + R * 0.92, R * 0.2, R * 0.1, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = red ? '#ff6a4a' : c.body; ctx.fill();
  ctx.lineWidth = ow * 1.2; ctx.strokeStyle = c.outline; ctx.stroke();
  ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.4;
  ctx.beginPath(); ctx.arc(x - R * 0.3, y - R * 0.3, R * 0.45, 0, Math.PI * 2); ctx.fillStyle = c.bodyLight; ctx.fill();
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  _eyes(ctx, x - R * 0.28, y - R * 0.12, R * 0.1, '#1a1a0a', 1, 0);
  _eyes(ctx, x + R * 0.28, y - R * 0.12, R * 0.1, '#1a1a0a', 1, 0);
  ctx.strokeStyle = '#1a1a0a'; ctx.lineWidth = ow;
  ctx.beginPath(); ctx.arc(x, y + R * 0.18, R * 0.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
}

// 颜色预设（主角=希腊英雄；敌人=怪物 图二）
const SKINS = {
  player: { body: '#4f93d6', bodyLight: '#8fd0ff', outline: '#0c2438', skin: '#f0c79a', hair: '#3a2a18', accent: '#d23b2e', eye: '#173049', weapon: '#ffe08a', limb: '#356aa0', mouth: 'frown' },
  // 亡魂术士（紫兜帽，发光金眼）
  melee: { body: '#3a2a55', bodyLight: '#5a4080', outline: '#0c0818', skin: '#3a2a55', hood: '#6a3d8f', accent: null, eye: '#ffd76a', limb: '#241a3a' },
  // 绿哥布林（獠牙）
  shooter: { body: '#2f7a4a', bodyLight: '#4ec77a', outline: '#08160f', skin: '#7fcf7a', hair: null, accent: null, eye: '#aef0d0', limb: '#1d5030', mouth: 'fangs' },
  // 紫蛮兵（獠牙）
  brute: { body: '#4a2a6a', bodyLight: '#7a4ca0', outline: '#0a0418', skin: '#9a6fc0', hair: null, accent: null, eye: '#ff9e3d', limb: '#2e1846', mouth: 'fangs' },
  // 橙魔（犄角獠牙）
  elite: { body: '#b5471f', bodyLight: '#ff8a3d', outline: '#250a05', skin: '#d06a2f', hair: null, accent: null, eye: '#ffe08a', limb: '#7a2e12', mouth: 'fangs' },
  // 紫袍法师（兜帽）
  elite_caster: { body: '#3a2a6a', bodyLight: '#6a5aa0', outline: '#0c0622', skin: '#3a2a6a', hood: '#5a3aa0', accent: null, eye: '#cbb3ff', limb: '#26184a' },
  // 深红恶魔王（王冠獠牙）
  boss: { body: '#7a0e1a', bodyLight: '#e8453a', outline: '#180306', skin: '#b04632', hair: null, accent: null, eye: '#ffd76a', limb: '#4a060e', mouth: 'fangs' },
  // 绿甲魔弓（王冠獠牙）
  boss_archer: { body: '#1f5a2a', bodyLight: '#56c46a', outline: '#06160a', skin: '#56a05a', hair: null, accent: null, eye: '#ffd76a', limb: '#0f3a18', mouth: 'fangs' },
  dog: { body: '#8a5a2a', bodyLight: '#c08a4a', outline: '#1a0e04', skin: '#8a5a2a', hair: null, accent: null, eye: '#ffd76a', limb: '#5a3a18' },
  spider: { body: '#2a2438', bodyLight: '#4a4060', outline: '#080610', skin: '#2a2438', hair: null, accent: null, eye: '#ff5e5e', limb: '#16121f' },
  bloat: { body: '#5a7a2a', bodyLight: '#8fbf3a', outline: '#101a06', skin: '#5a7a2a', hair: null, accent: null, eye: '#1a1a0a', limb: '#3a5018' }
};

module.exports = { drawCharacter, SKINS };
