/**
 * WPlaceBot — automated pixel drawing for wplace.live
 *
 * HOW TO RUN (no build, no install):
 * 1) Open https://wplace.live in your browser
 * 2) Press F12 → Console
 * 3) Paste THIS WHOLE FILE and press Enter
 * 4) Use commands printed by: wplaceBot.printHelp()
 *
 * DONATION (optional):
 *   PayPal: https://paypal.me/wibuwonderland
 *   Donors can request a “Pro” build (multi-section queues, QoL upgrades).
 *
 * ABOUT / CREDITS:
 *   English version with improvements, partially inspired by ideas and concepts from https://wplacebot.online
 *   No need to keep your PC on 24/7 — progress auto-saves (see help).
 */

class WPlaceBot {
  constructor() {
    // ---------- STATE ----------
    this.isRunning = false;
    this.delay = 600;                 // ms per pixel (tune as needed)
    this.currentPixel = 0;
    this.pixels = [];                 // [{x,y,color:"#RRGGBB"}, ...]
    this.startX = 0;
    this.startY = 0;
    this.canvas = null;

    // Color palette entries: { element, color:'rgb(r,g,b)', locked:boolean }
    this.colorPalette = [];
    this.selectedColor = '#000000';
    this.useAutoPalette = true;       // if false → manual color mode (you pick in UI)
    this.lockedColorMode = 'map';     // 'skip' | 'map' | 'manual'

    // Grid cell (screen px) — MUST calibrate once per zoom for contiguous pixels
    this.cellW = null;                // e.g. 14
    this.cellH = null;                // e.g. 14

    // ---------- PERSISTENCE ----------
    this.imageName = 'Custom Image';
    this.stateKey = 'WPLACE_BOT_STATE_V1';
    this.autosaveEvery = 20;          // save every N pixels
    this.largeSaveCap = 50000;        // cap remaining array saved to localStorage

    // ---------- VERSION ----------
    this.version = '1.5.0';

    // warnings
    this._warnedNoCell = false;
    this._skipWarned = false;
    this._manualWarned = false;
    this._autoWarned = false;
  }

  // ===== INIT =====
  init() {
    console.log('🎨 WPlace Bot initialized! v' + this.version);
    this.findCanvas();
    this.findColorPalette();
    const restored = this.loadState();
    if (restored) console.log('🔁 Found previous session. Use wplaceBot.resume() to continue.');
    this.printHelp();
    this.printDonation();
  }

  // ===== CANVAS =====
  findCanvas() {
    const sels = [
      '[data-testid="canvas"]',
      'canvas',
      '#canvas',
      '.canvas',
      'canvas[width]',
      'canvas[height]'
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) { this.canvas = el; console.log('✅ Canvas found via:', s); return; }
    }
    console.error('❌ Canvas not found. Make sure the board is visible.');
  }

  // ===== PALETTE (LOCK-AWARE) =====
  findColorPalette() {
    this.colorPalette = [];
    const root =
      document.querySelector('[data-testid*="palette"]') ||
      document.querySelector('.palette, .color-palette') ||
      document;

    const candidates = Array.from(
      root.querySelectorAll('[data-color], [role="radio"], button, [role="button"]')
    );

    const looksLocked = (el) => {
      if (el.matches('[disabled],[aria-disabled="true"]')) return true;
      if (el.getAttribute('data-locked') === 'true') return true;
      if (el.querySelector('[class*="lock"],[aria-label*="lock"],[data-locked]')) return true;
      const cs = getComputedStyle(el);
      if (cs.cursor === 'not-allowed') return true;
      return false;
    };

    for (const el of candidates) {
      const cs = getComputedStyle(el);
      if (!cs) continue;
      const bg = cs.backgroundColor;
      const visible = el.offsetParent !== null && cs.display !== 'none' && cs.visibility !== 'hidden';
      const sizeOK = (parseFloat(cs.width) >= 16 && parseFloat(cs.height) >= 16);
      const isColor = bg && bg !== 'rgba(0, 0, 0, 0)';
      if (visible && sizeOK && isColor) {
        this.colorPalette.push({ element: el, color: bg, locked: looksLocked(el) });
      }
    }

    const unlocked = this.colorPalette.filter(c => !c.locked).length;
    const locked = this.colorPalette.length - unlocked;
    console.log(`🎨 Palette detected: ${this.colorPalette.length} (unlocked: ${unlocked}, locked: ${locked})`);
    if (!this.colorPalette.length) {
      console.warn('ℹ️ No palette detected. Open the color picker in the UI, then run: wplaceBot.refreshPalette()');
    }
  }
  refreshPalette(){ this.findColorPalette(); }

  // ===== COLOR HELPERS =====
  rgbToHex(rgb) {
    const m = rgb?.match?.(/\d+/g); if (!m) return '#000000';
    const [r,g,b] = m.map(n=>parseInt(n,10));
    return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
  }
  hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? {r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16)} : null;
  }
  rgbStringToObject(rgb) {
    const m = rgb?.match?.(/\d+/g); if (!m || m.length < 3) return null;
    return { r:parseInt(m[0],10), g:parseInt(m[1],10), b:parseInt(m[2],10) };
  }
  _dist(a,b){ return Math.hypot(a.r-b.r, a.g-b.g, a.b-b.b); }

  // nearest palette entry (optionally restrict to unlocked colors)
  findClosestEntry(targetHex, {onlyUnlocked=false} = {}) {
    const target = this.hexToRgb(targetHex) || {r:0,g:0,b:0};
    let best=null, bestD=Infinity;
    for (const e of this.colorPalette) {
      if (onlyUnlocked && e.locked) continue;
      const rgb = this.rgbStringToObject(e.color);
      if (!rgb) continue;
      const d = this._dist(target, rgb);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // select color with locked handling
  selectColorSmart(targetHex) {
    if (!this.colorPalette.length) return false;

    const closest = this.findClosestEntry(targetHex, {onlyUnlocked:false});
    if (!closest) return false;

    if (closest.locked) {
      if (this.lockedColorMode === 'skip') {
        if (!this._skipWarned){ console.warn('🔒 Some colors are locked → skipping those pixels'); this._skipWarned = true; }
        return 'SKIP';
      }
      if (this.lockedColorMode === 'manual') {
        if (!this._manualWarned){ console.warn('🔒 Locked color → MANUAL mode (pick a color yourself).'); this._manualWarned = true; }
        this.useAutoPalette = false;
        return false;
      }
      // 'map' → map to nearest UNLOCKED
      const unlocked = this.findClosestEntry(targetHex, {onlyUnlocked:true});
      if (unlocked) {
        unlocked.element.click();
        this.selectedColor = this.rgbToHex(unlocked.color);
        return true;
      }
      if (!this._manualWarned){ console.warn('🔒 No unlocked replacement → MANUAL mode.'); this._manualWarned = true; }
      this.useAutoPalette = false;
      return false;
    }

    closest.element.click();
    this.selectedColor = this.rgbToHex(closest.color);
    return true;
  }

  setLockedColorMode(mode='map'){
    if (!['skip','map','manual'].includes(mode)) {
      console.warn('lockedColorMode must be one of: skip | map | manual'); return;
    }
    this.lockedColorMode = mode;
    console.log('🔧 lockedColorMode =', mode);
  }
  setManualColorMode(on=true){
    this.useAutoPalette = !on;
    console.log(`🎛️ Manual color mode: ${on?'ON':'OFF'}`);
  }

  // ===== INPUT / POSITION =====
  setStartPosition(x,y){
    this.startX = x|0;
    this.startY = y|0;
    console.log(`📍 Start position set to (${this.startX}, ${this.startY})`);
    this.saveState();
  }
  setDelay(ms){
    this.delay = Math.max(0, ms|0);
    console.log(`⏱️ Delay set to ${this.delay} ms`);
    this.saveState();
  }

  // ===== GRID CALIBRATION (for contiguous pixels) =====
  setCellSize(w,h){
    const ok = (v)=> typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!ok(w) || !ok(h)) { console.warn('cell size must be positive numbers'); return; }
    this.cellW = Math.round(w);
    this.cellH = Math.round(h);
    console.log(`📏 Cell size set → ${this.cellW}×${this.cellH} px`);
    this.saveState();
  }
  calibrate(){ // click 2 adjacent cells horizontally
    console.log('🧪 Calibrate X: Click TWO adjacent cells horizontally…');
    let first = null;
    const handler = (ev) => {
      if (!first) {
        first = {x: ev.clientX, y: ev.clientY};
        console.log('1/2 captured. Click the next cell horizontally…');
      } else {
        const dx = Math.abs(ev.clientX - first.x);
        if (dx < 1) console.warn('Clicks overlapped. Try again.');
        else { this.cellW = Math.round(dx); console.log(`✅ Calibrated cellW = ${this.cellW}px`); this.saveState(); }
        cleanup();
      }
      ev.preventDefault(); ev.stopPropagation();
    };
    const cleanup = () => window.removeEventListener('click', handler, true);
    window.addEventListener('click', handler, true);
  }
  calibrateY(){ // click 2 adjacent cells vertically
    console.log('🧪 Calibrate Y: Click TWO adjacent cells vertically…');
    let first = null;
    const handler = (ev) => {
      if (!first) {
        first = {x: ev.clientX, y: ev.clientY};
        console.log('1/2 captured. Click the next cell vertically…');
      } else {
        const dy = Math.abs(ev.clientY - first.y);
        if (dy < 1) console.warn('Clicks overlapped. Try again.');
        else { this.cellH = Math.round(dy); console.log(`✅ Calibrated cellH = ${this.cellH}px`); this.saveState(); }
        cleanup();
      }
      ev.preventDefault(); ev.stopPropagation();
    };
    const cleanup = () => window.removeEventListener('click', handler, true);
    window.addEventListener('click', handler, true);
  }

  // ===== CLICK =====
  clickCanvas(x,y){
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const clientX = rect.left + x;
    const clientY = rect.top + y;

    // Pointer & mouse events (covers most canvases)
    const seq = ['pointerdown','mousedown','pointerup','mouseup','click'];
    for (const type of seq) {
      try {
        this.canvas.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX, clientY, button: 0
        }));
      } catch {}
    }
    return true;
  }

  // ===== IMAGE LOADERS =====
  async loadImageFromBase64(dataUrl, maxW=50, maxH=50, name='Base64 Image'){
    return this._loadImageViaTag(dataUrl, maxW, maxH, name, {forceNoCORS:true});
  }
  proxyUrl(url){ return url; } // override if you own a proxy server that adds CORS
  async loadImageFromUrl(url, maxW=50, maxH=50, name='Image from URL', {tryProxy=true}={}){
    try {
      const ok = await this._loadImageViaTag(url, maxW, maxH, name, {crossOrigin:'anonymous'});
      if (ok) return true;
      throw new Error('Direct load failed');
    } catch (e1) {
      console.warn('⚠️ Direct load failed:', e1?.message || e1);
      if (!tryProxy) return false;
      const proxied = this.proxyUrl(url);
      if (!proxied || proxied === url) {
        console.warn('ℹ️ No proxy configured. Consider pickLocalImage()/loadImageFromBase64().');
        return false;
      }
      console.log('🔁 Retrying via proxy:', proxied);
      try {
        return await this._loadImageViaTag(proxied, maxW, maxH, name, {crossOrigin:'anonymous'});
      } catch(e2){
        console.error('❌ Proxy load failed:', e2);
        return false;
      }
    }
  }
  async _loadImageViaTag(src, maxW, maxH, name, options={}){
    const img = new Image();
    if (options.forceNoCORS) { /* data URL case */ }
    else if (options.crossOrigin) { img.crossOrigin = options.crossOrigin; }
    await new Promise((res,rej)=>{ img.onload=()=>res(); img.onerror=()=>rej(new Error('Image load error')); img.src = src; });

    const scale = Math.min(maxW/img.width, maxH/img.height, 1);
    const w = Math.max(1, Math.floor(img.width*scale));
    const h = Math.max(1, Math.floor(img.height*scale));

    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);

    // If CORS taints this canvas, getImageData will throw:
    const { data } = ctx.getImageData(0,0,w,h);

    const pixels=[];
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i=(y*w+x)*4;
        const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
        if(a<128) continue;
        const hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
        pixels.push({x,y,color:hex});
      }
    }
    this.loadImageFromData(pixels, name);
    return true;
  }
  async pickLocalImage(maxW=50, maxH=50, name='Picked Image'){
    return new Promise((resolve)=>{
      const input=document.createElement('input');
      input.type='file'; input.accept='image/*';
      input.onchange=async (e)=>{
        const f=e.target.files?.[0]; if(!f) return resolve(false);
        const r=new FileReader();
        r.onload=async()=>resolve(await this.loadImageFromBase64(r.result, maxW, maxH, name));
        r.readAsDataURL(f);
      };
      input.click();
    });
  }
  async pasteImageFromClipboard(maxW=50, maxH=50, name='Pasted Image'){
    if(!navigator.clipboard?.read) { console.warn('Clipboard read() not supported'); return false; }
    try{
      const items = await navigator.clipboard.read();
      for(const item of items){
        for(const type of item.types){
          if(type.startsWith('image/')){
            const blob = await item.getType(type);
            const r = new FileReader();
            const ok = await new Promise(res=>{
              r.onload=async()=>res(await this.loadImageFromBase64(r.result, maxW, maxH, name));
              r.readAsDataURL(blob);
            });
            return ok;
          }
        }
      }
      console.warn('No image in clipboard');
      return false;
    }catch(e){ console.warn('Clipboard error:', e); return false; }
  }

  // ===== LOAD FROM DATA =====
  loadImageFromData(pixelData, name='Custom Image'){
    if (!Array.isArray(pixelData)) { console.error('❌ pixelData must be an array'); return false; }
    const norm=[];
    for(const p of pixelData){
      if(!p || typeof p.x!=='number' || typeof p.y!=='number' || typeof p.color!=='string'){
        console.error('❌ Bad item in pixelData (expected {x:number, y:number, color:string})', p);
        return false;
      }
      let color=p.color.trim();
      if (/^#([0-9a-f]{6})$/i.test(color)) { /* ok */ }
      else if (/^rgb\s*\(/i.test(color)) {
        const rgb=this.rgbStringToObject(color);
        if(!rgb){console.error('❌ invalid rgb()',color); return false;}
        color=this.rgbToHex(`rgb(${rgb.r},${rgb.g},${rgb.b})`);
      } else {
        console.error('❌ color must be #RRGGBB or rgb(r,g,b)'); return false;
      }
      const x=Math.floor(p.x), y=Math.floor(p.y);
      if(x<0||y<0||!Number.isFinite(x)||!Number.isFinite(y)){ console.error('❌ x/y invalid'); return false; }
      norm.push({x,y,color});
    }
    // deduplicate & sort
    const map=new Map(); for(const p of norm) map.set(`${p.x},${p.y}`, p);
    const dedup=[...map.values()].sort((a,b)=>(a.y-b.y)||(a.x-b.x));

    this.pixels = dedup;
    this.currentPixel = 0;
    this.imageName = name;

    // safe size calc
    let maxX=-Infinity,maxY=-Infinity; for(const p of dedup){ if(p.x>maxX) maxX=p.x; if(p.y>maxY) maxY=p.y; }
    if(maxX===-Infinity) maxX=0; if(maxY===-Infinity) maxY=0;
    console.log(`✅ ${name} loaded: ${dedup.length} px | approx size: ${maxX+1}×${maxY+1}`);

    if (dedup.length <= this.largeSaveCap) this.saveState();
    else console.log('💾 Large image → initial save skipped; will autosave while drawing.');
    return true;
  }

  // ===== MAIN LOOP =====
  async start(){
    if (this.isRunning) { console.log('⚠️ Bot already running'); return; }
    if (!this.pixels.length) { console.log('⚠️ Load an image first'); return; }
    if (!this.canvas) { console.log('⚠️ Canvas not found'); return; }

    if (this.useAutoPalette && this.colorPalette.length===0) {
      if(!this._autoWarned){
        console.warn('🎨 No palette detected → MANUAL color mode. Pick a color in the UI, then wplaceBot.refreshPalette() to re-enable auto.');
        this._autoWarned=true;
      }
      this.useAutoPalette=false;
    }

    // Grid/checks
    const W = (typeof this.cellW==='number' && this.cellW>0) ? this.cellW : 1;
    const H = (typeof this.cellH==='number' && this.cellH>0) ? this.cellH : W;
    if ((W===1 || H===1) && !this._warnedNoCell) {
      console.warn('⚠️ Cell size not calibrated. Pixels may not be contiguous. Use wplaceBot.calibrate() and wplaceBot.calibrateY() for perfect grid alignment.');
      this._warnedNoCell = true;
    }

    this.isRunning = true;
    console.log(`🚀 Bot started (${this.imageName}) from pixel #${this.currentPixel+1}/${this.pixels.length}`);

    while (this.isRunning && this.currentPixel < this.pixels.length) {
      const p = this.pixels[this.currentPixel];

      // click at the CENTER of the target cell on screen space
      const x = this.startX + p.x * W + Math.floor(W/2);
      const y = this.startY + p.y * H + Math.floor(H/2);

      if (this.useAutoPalette) {
        const res = this.selectColorSmart(p.color);
        if (res === 'SKIP') {
          this.currentPixel++;
          await this.sleep(1);
          continue;
        }
        if (res === true) {
          await this.sleep(180); // small pause after switching color
        }
      }

      this.clickCanvas(x, y);
      this.currentPixel++;

      if (this.currentPixel % this.autosaveEvery === 0) this.saveState();
      await this.sleep(this.delay);
    }

    this.isRunning = false;
    if (this.currentPixel >= this.pixels.length) { console.log('✅ Bot finished. Clearing saved state.'); this.clearState(); }
    else { console.log('⏸️ Bot stopped mid-way. Progress saved.'); this.saveState(); }
  }

  stop(){ if(!this.isRunning) console.log('ℹ️ Not running'); this.isRunning=false; this.saveState(); console.log('⏹️ Stopped (state saved).'); }
  resume(){ if(!this.pixels.length){ if(!this.loadState()){ console.log('ℹ️ No saved session'); return; } } this.start(); }
  sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  // ===== PERSISTENCE =====
  saveState(){
    try{
      const remaining=this.pixels.slice(this.currentPixel);
      const state={
        version:1,
        imageName:this.imageName,
        startX:this.startX, startY:this.startY,
        delay:this.delay,
        currentPixel:this.currentPixel,
        totalPixels:this.pixels.length,
        remaining: remaining.length>this.largeSaveCap ? remaining.slice(0,this.largeSaveCap) : remaining,
        cellW:this.cellW, cellH:this.cellH,
        savedAt: Date.now()
      };
      localStorage.setItem(this.stateKey, JSON.stringify(state));
    }catch(e){ console.warn('⚠️ saveState failed:', e); }
  }
  loadState(){
    try{
      const raw=localStorage.getItem(this.stateKey); if(!raw) return false;
      const s=JSON.parse(raw); if(!s || s.version!==1 || !Array.isArray(s.remaining)) return false;
      this.imageName=s.imageName||'Custom Image';
      this.startX=Number.isFinite(s.startX)?s.startX:this.startX;
      this.startY=Number.isFinite(s.startY)?s.startY:this.startY;
      this.delay =Number.isFinite(s.delay )?s.delay :this.delay;
      this.cellW =Number.isFinite(s.cellW )?s.cellW :this.cellW;
      this.cellH =Number.isFinite(s.cellH )?s.cellH :this.cellH;
      this.pixels=s.remaining; this.currentPixel=0;
      console.log(`🔄 Loaded saved session: ${this.imageName} | remaining ${this.pixels.length} px`);
      return true;
    }catch(e){ console.warn('⚠️ loadState failed:', e); return false; }
  }
  clearState(){ try{ localStorage.removeItem(this.stateKey); }catch{} }

  // ===== HELP & EXTRAS =====
  test5x5(){
    const data=[]; for(let y=0;y<5;y++) for(let x=0;x<5;x++) data.push({x,y,color:'#000000'});
    this.loadImageFromData(data,'Test 5×5');
    console.log('👉 Set start position and run: wplaceBot.start()');
  }

  printHelp(){
    console.log(`
📚 WPlaceBot Commands
---------------------
wplaceBot.setStartPosition(x, y)             // top-left of your image (screen space)
wplaceBot.setDelay(ms)                        // e.g. 300..1000
wplaceBot.setManualColorMode(true|false)      // manual = bot won't change color
wplaceBot.setLockedColorMode('skip'|'map'|'manual')

wplaceBot.setCellSize(w, h)                   // set grid cell size (screen px)
wplaceBot.calibrate()                         // click TWO adjacent cells horizontally
wplaceBot.calibrateY()                        // click TWO adjacent cells vertically

wplaceBot.loadImageFromData(data, name)       // data = [{x,y,color:"#RRGGBB"}, ...]
wplaceBot.loadImageFromUrl(url, maxW, maxH, name)           // may need CORS/proxy
wplaceBot.loadImageFromBase64(dataUrl, maxW, maxH, name)    // safe for CORS/CF
wplaceBot.pickLocalImage(maxW, maxH, name)    // open file picker (safest)
wplaceBot.pasteImageFromClipboard(maxW, maxH, name) // paste image (if supported)
// Optional proxy if you have one:
// wplaceBot.proxyUrl = (u)=> 'https://YOUR-PROXY?url='+encodeURIComponent(u)

wplaceBot.refreshPalette()                    // re-scan palette after opening the picker
wplaceBot.start()
wplaceBot.stop()
wplaceBot.resume()
wplaceBot.clearState()

💾 localStorage key: ${this.stateKey}

Quick test:
wplaceBot.setStartPosition(120, 300);
wplaceBot.setDelay(300);
wplaceBot.test5x5();
wplaceBot.start();

// For contiguous pixels: calibrate grid first
wplaceBot.calibrate();  // then click 2 adjacent cells (horizontal)
wplaceBot.calibrateY(); // (optional) 2 adjacent (vertical)
`);
  }

  printDonation(){
    console.log(`
💖 LIKE THIS BOT?
Donate: https://paypal.me/wibuwonderland
Donors can request a "Pro" build (multi-section queues, QoL upgrades) and help support ongoing improvements. Thank you!
`);
  }
}

// Expose globally
window.wplaceBot = new WPlaceBot();
window.wplaceBot.init();
