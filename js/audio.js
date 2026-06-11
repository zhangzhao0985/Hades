// js/audio.js —— 音效接口（wx.createInnerAudioContext）预留封装
// 默认所有音效未绑定文件即静默；放入音频文件并 register(name, path) 即可启用。
class AudioManager {
  constructor() {
    this.enabled = true;
    this.volume = 0.7;
    this._ctx = {};   // name -> InnerAudioContext（懒创建复用）
    this.srcs = {};   // name -> 文件路径
    this.bgm = null;
    this._supported = (typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function');
    this._registerDefaults();
  }

  // 预留音效键；要启用就在此填路径，或外部调用 register()
  _registerDefaults() {
    const keys = ['attack', 'hit', 'dash', 'special', 'ultimate', 'boon', 'buy',
      'bossSpawn', 'bossDown', 'hurt', 'revive', 'depart', 'select', 'die',
      'pickup', 'explode', 'web'];
    for (const k of keys) this.srcs[k] = null;
    // 示例（放入文件后取消注释即可）：
    // this.register('hit', 'audio/hit.mp3');
    // this.register('bossSpawn', 'audio/boss.mp3');
  }

  register(name, src) { this.srcs[name] = src; }
  setEnabled(b) { this.enabled = b; if (!b) this.stopBgm(); }

  play(name) {
    if (!this.enabled || !this._supported) return;
    const src = this.srcs[name];
    if (!src) return;
    let a = this._ctx[name];
    if (!a) {
      a = wx.createInnerAudioContext();
      a.src = src;
      a.volume = this.volume;
      this._ctx[name] = a;
    }
    try { a.stop(); } catch (e) { /* ignore */ }
    try { a.seek(0); } catch (e) { /* ignore */ }
    a.play();
  }

  playBgm(src, loop) {
    if (!this._supported || !src) return;
    this.stopBgm();
    const a = wx.createInnerAudioContext();
    a.src = src;
    a.loop = loop !== false;
    a.volume = this.volume * 0.6;
    a.play();
    this.bgm = a;
  }

  stopBgm() {
    if (this.bgm) { try { this.bgm.stop(); } catch (e) { /* ignore */ } this.bgm = null; }
  }

  destroy() {
    for (const k in this._ctx) { try { this._ctx[k].destroy(); } catch (e) { /* ignore */ } }
    this._ctx = {};
    this.stopBgm();
  }
}

module.exports = AudioManager;
