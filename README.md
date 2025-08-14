# WPlaceBot – Automated Pixel Drawing for wplace.live

## Overview
WPlaceBot is a single-file JavaScript tool you paste into your browser’s **Developer Console** to automate pixel placement on [wplace.live](https://wplace.live). It converts images to pixel data, picks the closest palette color, and clicks pixels one by one.

### Features
- Pixel-by-pixel drawing with adjustable delay  
- Color matching to the nearest palette color  
- Load from pixel data or from an image URL (with resizing)  
- **Save & resume progress** via `localStorage` (close your tab or PC and continue later)  

---

## How to Run (No install)
1. Open **https://wplace.live** in your browser.  
2. Press **F12** (Developer Tools) → **Console** tab.  
3. Paste the entire bot code file and press **Enter**.  
4. In the console, follow the printed help to load an image and start.  

The bot will expose a global object: `wplaceBot`.

---

## Basic Commands
```js
wplaceBot.setStartPosition(x, y)           // top-left of your image on the current view
wplaceBot.setDelay(ms)                     // e.g. 300..1000 ms
wplaceBot.loadImageFromData(data, name)    // data = [{x,y,color:"#RRGGBB"}, ...]
wplaceBot.loadImageFromUrl(url, maxW, maxH, name)
wplaceBot.start()                          // begin drawing
wplaceBot.stop()                           // stop and save
wplaceBot.resume()                         // resume from saved progress
wplaceBot.clearState()                     // clear saved progress
```

### Quick Example
```js
// Build a 5×5 red square
const data = [];
for (let y=0; y<5; y++) for (let x=0; x<5; x++) data.push({x, y, color:'#FF0000'});

wplaceBot.loadImageFromData(data, 'Red 5x5');
wplaceBot.setStartPosition(120, 300);
wplaceBot.setDelay(300);
wplaceBot.start();
```

---

## Saving & Resuming
- Progress is stored in **`localStorage`** under the key `WPLACE_BOT_STATE_V1`.  
- What gets saved:  
  - `imageName`, `startX`, `startY`, `delay`  
  - The **remaining** pixels (memory-efficient)  
- Autosaves every **20** pixels (configurable via `wplaceBot.autosaveEvery`).  
- `stop()` saves and exits; finishing all pixels clears the save.  

To resume:
```js
// Paste the code again, then:
wplaceBot.resume();
```
**Make sure you’re viewing the same area/zoom** you used when you started.

---

## Safety & Verification
This code is **safe by design**:
- **No network calls**: it does not use `fetch`, `XMLHttpRequest`, `WebSocket`, or `navigator.sendBeacon`.  
- **No credential access**: it does not read or send cookies, tokens, or localStorage (except its own save key).  
- **No obfuscation or eval**: all logic is plain, readable JavaScript; no `eval`, no dynamic code loading.  

**Verify it yourself** in any way you like:
- Search the source for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, `Function(`, `import(` — they aren’t there.  
- Keep **Network** tab open in DevTools while running: you’ll see **no outbound requests** made by this bot.  
- Scan the code for any DOM selectors that target inputs or secrets — they only target the canvas/palette.

> Note: Using automation may violate wplace.live’s Terms of Service. Use responsibly and at your own risk.

---

## Tips
- Don’t change zoom/pan while the bot runs (positions are screen-relative).  
- If you must adjust, stop the bot, call `setStartPosition()` again, and `resume()`.  
- Use a **reasonable delay** (≥ 250ms) to avoid rate-limits or bans.  
- Cross-origin image URLs need proper **CORS**; otherwise, the canvas will be tainted and pixel reading will fail. Prefer Data URLs or images you host with CORS enabled.

---

## Donate (Optional)
If this bot helps you, consider supporting the developer ❤️  
**PayPal:** https://paypal.me/wibuwonderland  

Donors can request a **“Pro” build** that supports:
- Multi-section / multiple-queue drawing  
- Quality-of-life improvements and ongoing updates  

---

## Contact
- **Facebook:** [https://www.facebook.com/wbwmakoto](https://www.facebook.com/wbwmakoto)  
- **Discord:** `makoto_sama`  

---

## License
Personal use permitted. Provided “as is”, without warranty. You’re responsible for any ToS or rate-limit issues that arise from use.

