// js/utils.js —— 通用数学工具

// 把数值限制在 [min, max] 区间
function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

// 线性插值
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 向量长度
function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

// 两点距离
function dist(ax, ay, bx, by) {
  return len(bx - ax, by - ay);
}

// 与帧率无关的指数平滑（damp）：lambda 越大越快逼近目标
function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

module.exports = { clamp, lerp, len, dist, damp };
