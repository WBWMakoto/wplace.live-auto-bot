/**
 * WPlaceBot — automated pixel drawing for wplace.live
 *
 * HOW TO RUN (no build, no install):
 * 1) Open https://wplace.live in your browser
 * 2) Press F12 → Console
 * 3) Paste THIS ENTIRE FILE and press Enter
 * 4) In the same console, use the commands it prints (see wplaceBot.printHelp())
 *
 * NOTES:
 * - Keep your zoom/pan fixed while the bot is running.
 * - Set start position to the top-left corner where your image should begin.
 *
 * DONATION (optional):
 * If this helps you, consider buying the dev a coffee ❤️
 * PayPal: https://paypal.me/wibuwonderland
 * Donors can request a “Pro” build (multi-section/queues, QoL upgrades) and support ongoing improvements.
 *
 * ABOUT / CREDITS:
 * English version with improvements, partially inspired by ideas and concepts from https://wplacebot.online
 * No need to run 24/7 for large images — the bot saves progress automatically (see printHelp / README).
 */

class WPlaceBot {
  constructor() {
    // ---------- STATE ----------
    this.isRunning = false;
    this.delay = 1000;            // ms delay between pixels
    this.currentPixel = 0;        // index into this.pixels
    this.pixels = [];             // [{x, y, color:"#RRGGBB"}, ...]
    this.startX = 0;              // screen-space (relative to current canvas viewport)
    this.startY = 0;
    this.canvas = null;           // HTMLCanvasElement
    this.colorPalette = [];       // [{element, color:"rgb(r,g,b)"}...]
    this.selectedColor = '#000000';

    // Color mode
    this.useAutoPalette = true;   // try to auto-pick closest color
    this._autoWarned = false;     // internal: warn once when palette missing

    // ---------- PERSISTENCE ----------
    this.imageName = 'Custom Image';
    this.stateKey = 'WPLACE_BOT_STATE_V1'; // change if you want a different “profile”
    this.autosaveEvery = 20;               // autosave progress every N pixels
    this.largeSaveCap = 50000;             // cap saved pixels to keep JSON reasonable

    // ---------- VERSION ----------
    this.version = '1.3.0';
  }

  // Initialize: find canvas/palette, optionally restore previous session, print help
  init() {
    console.log('🎨 WPlace Bot initialized! v' + this.version);
    this.findCanvas();
    this.findColorPalette();

    // Try restoring a saved session (if any)
    const restored = this.loadState();
    if (restored) {
      console.log('🔁 Found previous session. Use wplaceBot.resume() to continue.');
    }

    // Print quick help + donation note
    this.printHelp();
    this.printDonation();
  }

  // ---------- CANVAS & PALETTE ----------
  findCanvas() {
    const possibleSelectors = [
      'canvas', '#canvas', '.canvas', '[data-testid="canvas"]', 'canvas[width]', 'canvas[height]'
    ];
    for (const selector of possibleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        this.canvas = el;
        console.log('✅ Canvas found via selector:', selector);
        return;
      }
    }
    console.error('❌ Canvas not found. Make sure you are on wplace.live and the board is visible.');
  }

  /**
   * Safe palette discovery: prefer elements that explicitly carry a color attribute.
   * Call this again after you open the color picker/palette in the UI.
   */
  findColorPalette() {
    this.colorPalette = [];
    const root =
      document.querySelector('[data-testid="palette"]') ||
      document.querySelector('.palette, .color-palette') ||
      document; // fallback

    // Prefer explicit color-bearing nodes
    const strict = root.querySelectorAll('[data-color], button[data-color], [role="radio"][data-color]');
    if (strict.length > 0) {
      strict.forEach(el => {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0,0,0,0)') this.colorPalette.push({ element: el, color: bg });
      });
    } else {
      // Fallback: broader (still filtered by bg color so it's not crazy-wide)
      const candidates = root.querySelectorAll('[style*="background-color"], .color, .palette-color');
      candidates.forEach(el => {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0,0,0,0)') this.colorPalette.push({ element: el, color: bg });
      });
    }

    console.log(`🎨 Palette entries found: ${this.colorPalette.length}`);
    if (this.colorPalette.length === 0) {
      console.warn('ℹ️ No palette detected. Open the color picker/palette in the UI, then run: wplaceBot.refreshPalette()');
    }
  }

  refreshPalette() {
    this.findColorPalette();
  }

  // ---------- COLOR HELPERS ----------
  rgbToHex(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m) return '#000000';
    const [r, g, b] = m.map(n => parseInt(n, 10));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  rgbStringToObject(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return null;
    return { r: parseInt(m[0], 10), g: parseInt(m[1], 10), b: parseInt(m[2], 10) };
  }

  findClosestColor(targetHex) {
    if (!this.colorPalette.length) return null;
    const target = this.hexToRgb(targetHex) || { r: 0, g: 0, b: 0 };
    let best = this.colorPalette[0], min = Infinity;
    for (const entry of this.colorPalette) {
      const rgb = this.rgbStringToObject(entry.color);
      if (!rgb) continue;
      const d = Math.hypot(target.r - rgb.r, target.g - rgb.g, target.b - rgb.b);
      if (d < min) { min = d; best = entry; }
    }
    return best;
  }

  selectColor(colorHex) {
    const entry = this.findClosestColor(colorHex);
    if (entry?.element) {
      entry.element.click();
      this.selectedColor = colorHex;
      return true;
    }
    return false;
  }

  // ---------- INPUT & POSITION ----------
  /**
   * Set the top-left position where your image starts (screen-space, relative to visible canvas)
   */
  setStartPosition(x, y) {
    this.startX = x | 0;
    this.startY = y | 0;
    console.log(`📍 Start position set to (${this.startX}, ${this.startY})`);
    this.saveState();
  }

  /**
   * Set delay between pixels (ms)
   */
  setDelay(ms) {
    this.delay = Math.max(0, ms | 0);
    console.log(`⏱️ Delay set to ${this.delay} ms`);
    this.saveState();
  }

  setManualColorMode(on = true) {
    this.useAutoPalette = !on;
    console.log(`🎛️ Manual color mode: ${on ? 'ON' : 'OFF'}`);
  }

  // ---------- CLICK ----------
  /**
   * Clicks a position on the visible canvas (uses current viewport/zoom).
   * x/y are screen-space offsets from canvas top-left.
   */
  clickCanvas(x, y) {
    if (!this.canvas) return false;
    const rect = this.canvas.getBoundingClientRect();
    const clientX = rect.left + x;
    const clientY = rect.top + y;

    for (const type of ['mousedown', 'mouseup', 'click']) {
      this.canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX, clientY, button: 0
      }));
    }
    return true;
  }

  // ---------- IMAGE LOADERS ----------
  /**
   * Loads a (width x height) color matrix into this.pixels
   */
  loadSimpleImage(flatColorArray, width, height) {
    const out = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (i < flatColorArray.length) out.push({ x, y, color: flatColorArray[i] });
      }
    }
    this.pixels = out;
    this.currentPixel = 0;
    this.imageName = 'Simple Image';
    console.log(`📷 Image loaded: ${width}×${height} (${out.length} px)`);
    this.saveStateLight();
    return true;
  }

  /**
   * Load an image from raw pixel data: [{x, y, color:"#RRGGBB" | "rgb(r,g,b)"}]
   */
  loadImageFromData(pixelData, name = 'Custom Image') {
    if (!Array.isArray(pixelData)) {
      console.error('❌ pixelData must be an array of {x, y, color}');
      return false;
    }

    // Validate & normalize
    const norm = [];
    for (const p of pixelData) {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.color !== 'string') {
        console.error('❌ Bad item in pixelData (expected {x:number, y:number, color:string})');
        return false;
      }

      let color = p.color.trim();
      if (/^#([0-9a-f]{6})$/i.test(color)) {
        // ok
      } else if (/^rgb\s*\(/i.test(color)) {
        const rgb = this.rgbStringToObject(color);
        if (!rgb) { console.error('❌ Invalid rgb() color:', color); return false; }
        color = this.rgbToHex(`rgb(${rgb.r},${rgb.g},${rgb.b})`);
      } else {
        console.error('❌ Color must be #RRGGBB or rgb(r,g,b). Got:', color);
        return false;
      }

      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
        console.error('❌ x/y must be non-negative finite integers');
        return false;
      }
      norm.push({ x, y, color });
    }

    // Deduplicate by (x,y), keep last definition
    const map = new Map();
    for (const p of norm) map.set(`${p.x},${p.y}`, p);
    const dedup = [...map.values()].sort((a, b) => (a.y - b.y) || (a.x - b.x));

    this.pixels = dedup;
    this.currentPixel = 0;
    this.imageName = name;

    // SAFE maxX/maxY (no giant spread)
    let maxX = -Infinity, maxY = -Infinity;
    for (const p of dedup) { if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
    maxX = (maxX === -Infinity) ? 0 : maxX;
    maxY = (maxY === -Infinity) ? 0 : maxY;

    console.log(`✅ ${name} loaded: ${dedup.length} px | approx size: ${maxX + 1}×${maxY + 1}`);

    // For huge images, avoid heavy initial save. Autosave will happen during drawing.
    if (dedup.length <= this.largeSaveCap) {
      this.saveState();
    } else {
      console.log('💾 Large image detected — skipping initial save to keep things responsive. Progress will autosave as you draw.');
    }
    return true;
  }

  /**
   * Load image from URL or Data URL and convert to pixel data.
   * - Keeps aspect ratio
   * - Resizes to fit within maxWidth × maxHeight
   * - Skips transparent pixels (alpha < 128)
   * NOTE: For cross-origin images, the server must allow CORS, otherwise
   *       the canvas becomes “tainted” and pixel reading will fail.
   */
  async loadImageFromUrl(imageUrl, maxWidth = 50, maxHeight = 50, name = 'Image from URL') {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // only works if the remote server allows it

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image: ' + imageUrl));
        img.src = imageUrl;
      });

      // Compute target size (no upscale by default)
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      const w = Math.max(1, Math.floor(img.width * scale));
      const h = Math.max(1, Math.floor(img.height * scale));

      // Draw onto a temp canvas
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      const ctx = cvs.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);

      // Read pixels
      const { data } = ctx.getImageData(0, 0, w, h);
      const pixels = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue; // ignore transparent
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
          pixels.push({ x, y, color: hex });
        }
      }

      this.loadImageFromData(pixels, name);
      return true;
    } catch (err) {
      console.error('❌ loadImageFromUrl error:', err);
      return false;
    }
  }

  // ---------- MAIN LOOP ----------
  async start() {
    if (this.isRunning) { console.log('⚠️ Bot already running'); return; }
    if (!this.pixels.length) { console.log('⚠️ Load an image first'); return; }
    if (!this.canvas) { console.log('⚠️ Canvas not found'); return; }

    // Palette handling
    if (this.useAutoPalette && this.colorPalette.length === 0) {
      if (!this._autoWarned) {
        console.warn('🎨 No palette detected. Switching to Manual Color Mode. Select a color in the UI; the bot will not attempt to change colors automatically.');
        this._autoWarned = true;
      }
      this.useAutoPalette = false; // fallback to manual
    }

    this.isRunning = true;
    console.log(`🚀 Bot started (${this.imageName}) from pixel #${this.currentPixel + 1}/${this.pixels.length}`);

    while (this.isRunning && this.currentPixel < this.pixels.length) {
      const p = this.pixels[this.currentPixel];
      const x = this.startX + p.x, y = this.startY + p.y;

      if (this.useAutoPalette) {
        const ok = this.selectColor(p.color);
        if (!ok && !this._autoWarned) {
          console.warn('🎨 Could not select color automatically. Switching to Manual Color Mode. Pick a color in the UI.');
          this._autoWarned = true;
          this.useAutoPalette = false;
        }
        if (!this.useAutoPalette) {
          // falls through to manual click below
        } else {
          await this.sleep(200); // small pause after color pick
        }
      }

      // Manual mode or after auto pick
      this.clickCanvas(x, y);

      this.currentPixel++;

      // autosave progress
      if (this.currentPixel % this.autosaveEvery === 0) this.saveState();

      await this.sleep(this.delay);
    }

    this.isRunning = false;

    if (this.currentPixel >= this.pixels.length) {
      console.log('✅ Bot finished. Clearing saved state.');
      this.clearState();
    } else {
      console.log('⏸️ Bot stopped mid-way. Progress saved.');
      this.saveState();
    }
  }

  stop() {
    if (!this.isRunning) { console.log('ℹ️ Bot is not running.'); }
    this.isRunning = false;
    this.saveState();
    console.log('⏹️ Bot stopped (state saved).');
  }

  resume() {
    if (!this.pixels.length) {
      const ok = this.loadState();
      if (!ok) { console.log('ℹ️ No saved session to resume.'); return; }
    }
    this.start();
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- PERSISTENCE ----------
  saveState() {
    try {
      const remaining = this.pixels.slice(this.currentPixel);
      const state = {
        version: 1,
        imageName: this.imageName,
        startX: this.startX,
        startY: this.startY,
        delay: this.delay,
        currentPixel: this.currentPixel,
        totalPixels: this.pixels.length,
        // Cap remaining to avoid massive JSON on huge images;
        // it's okay because we keep autosaving while drawing.
        remaining: remaining.length > this.largeSaveCap ? remaining.slice(0, this.largeSaveCap) : remaining,
        savedAt: Date.now()
      };
      localStorage.setItem(this.stateKey, JSON.stringify(state));
    } catch (e) {
      console.warn('⚠️ saveState failed:', e);
    }
  }

  // Lighter save (for small images / initial logs)
  saveStateLight() {
    try {
      const state = {
        version: 1,
        imageName: this.imageName,
        startX: this.startX,
        startY: this.startY,
        delay: this.delay,
        currentPixel: this.currentPixel,
        totalPixels: this.pixels.length,
        remaining: this.pixels.slice(this.currentPixel, this.currentPixel + Math.min(this.largeSaveCap, this.pixels.length)),
        savedAt: Date.now()
      };
      localStorage.setItem(this.stateKey, JSON.stringify(state));
    } catch (e) {
      console.warn('⚠️ saveStateLight failed:', e);
    }
  }

  loadState() {
    try {
      const raw = localStorage.getItem(this.stateKey);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || s.version !== 1 || !Array.isArray(s.remaining)) return false;

      this.imageName = s.imageName || 'Custom Image';
      this.startX = Number.isFinite(s.startX) ? s.startX : this.startX;
      this.startY = Number.isFinite(s.startY) ? s.startY : this.startY;
      this.delay  = Number.isFinite(s.delay)  ? s.delay  : this.delay;

      // restore from "remaining"
      this.pixels = s.remaining;
      this.currentPixel = 0;

      console.log(`🔄 Loaded saved session: ${this.imageName} | remaining ${this.pixels.length} px`);
      return true;
    } catch (e) {
      console.warn('⚠️ loadState failed:', e);
      return false;
    }
  }

  clearState() {
    try { localStorage.removeItem(this.stateKey); } catch {}
  }

  // ---------- HELPERS ----------
  printHelp() {
    console.log(`
📚 WPlaceBot Quick Commands
---------------------------
wplaceBot.setStartPosition(x, y)       // set top-left where the image will start
wplaceBot.setDelay(ms)                 // e.g. 300..1000; slower is safer
wplaceBot.loadImageFromData(data, name)// data = [{x,y,color:"#RRGGBB"|rgb()}...]
wplaceBot.loadImageFromUrl(url, maxW, maxH, name)
wplaceBot.refreshPalette()             // re-scan palette after opening color picker
wplaceBot.setManualColorMode(true)     // manual mode: bot won't change color
wplaceBot.start()                      // start drawing
wplaceBot.stop()                       // stop & save
wplaceBot.resume()                     // continue from saved progress
wplaceBot.clearState()                 // wipe saved progress

Example:
const data = [];
for (let y=0; y<5; y++) for (let x=0; x<5; x++) data.push({x,y,color:'#FF0000'});
wplaceBot.loadImageFromData(data, 'Red 5x5');
wplaceBot.setStartPosition(120,300);
wplaceBot.setDelay(300);
wplaceBot.start();

ℹ️ If you see "Palette entries found: 0", open the color picker on the page, then run:
wplaceBot.refreshPalette();
(Or switch to manual color mode: wplaceBot.setManualColorMode(true) and select a color yourself.)

💾 Progress is saved in localStorage under key: ${this.stateKey}
`);
  }

  printDonation() {
    console.log(`
💖 LIKE THIS BOT?
Donate: https://paypal.me/wibuwonderland
Donors can request a "Pro" build (multi-section queues, QoL upgrades) and help support ongoing improvements. Thank you!
`);
  }
}

// ---------- INSTANTIATE + INIT ----------
// Expose globally so you can call it from the console.
window.wplaceBot = new WPlaceBot();
window.wplaceBot.init();
