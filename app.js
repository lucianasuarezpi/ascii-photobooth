/* ═══════════════════════════════════════════════════════════════
   ASCII PHOTOBOOTH — app.js
   Three modules: asciiStation, photoboothStation, customizeStation
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   CAROUSEL
═══════════════════════════════════════════════════════════════ */
const carousel = (() => {
  const main     = document.querySelector('main');
  const stations = document.querySelectorAll('.station');
  const dots     = document.querySelectorAll('.nav-dot');

  // Set each panel to exact pixel width so scroll snapping works reliably
  function resize() {
    const w = window.innerWidth;
    stations.forEach(s => { s.style.width = w + 'px'; });
  }
  resize();
  window.addEventListener('resize', resize);

  // Update dots as user scrolls
  main.addEventListener('scroll', () => {
    const w = main.offsetWidth;
    const idx = Math.round(main.scrollLeft / w);
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }, { passive: true });

  // Programmatic navigation (used by "Customize →" buttons)
  function goTo(index) {
    const w = main.offsetWidth;
    main.scrollTo({ left: index * w, behavior: 'smooth' });
  }

  // Any element with data-slide attribute scrolls to that panel
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-slide]');
    if (el) {
      e.preventDefault();
      goTo(parseInt(el.dataset.slide));
    }
  });

  return { goTo };
})();

/* ─── App state ─────────────────────────────────────────────── */
const state = {
  asciiStream:       null,
  asciiAnimFrame:    null,
  asciiResult:       null,   // HTMLCanvasElement

  pbStream:          null,
  pbPhotos:          [],     // Array of { canvas, imageData } — processed
  stripResult:       null,   // HTMLCanvasElement

  activeResult:      null,   // { type: 'ascii'|'strip', canvas }
  overlays:          [],     // { el, x, y } for download compositing
};

/* ─── ASCII character ramp (dark → light) ───────────────────── */
const ASCII_RAMP = '@#S%?*+;:,. ';
const COLS = window.innerWidth < 680 ? 70 : 110;
const ROWS = window.innerWidth < 680 ? 35 : 55;

/* ═══════════════════════════════════════════════════════════════
   STATION 1 — LIVE ASCII CAMERA
═══════════════════════════════════════════════════════════════ */
const asciiStation = (() => {
  const video      = document.getElementById('ascii-video');
  const sampleCvs  = document.getElementById('ascii-sample-canvas');
  const pre        = document.getElementById('ascii-pre');
  const countdownEl= document.getElementById('ascii-countdown');
  const errorEl    = document.getElementById('ascii-error');
  const startBtn   = document.getElementById('ascii-start-btn');
  const captureBtn = document.getElementById('ascii-capture-btn');
  const resultDiv  = document.getElementById('ascii-result');
  const resultCvs  = document.getElementById('ascii-result-canvas');
  const downloadBtn= document.getElementById('ascii-download-btn');
  const customizeBtn=document.getElementById('ascii-to-customize-btn');

  sampleCvs.width  = COLS;
  sampleCvs.height = ROWS;
  document.querySelector('.terminal-title').textContent = `ascii-cam — ${COLS}×${ROWS}`;

  const sampleCtx  = sampleCvs.getContext('2d', { willReadFrequently: true });

  let capturing = false;
  let running   = false;

  function pixelToChar(r, g, b) {
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    const idx = Math.floor(brightness / 256 * ASCII_RAMP.length);
    return ASCII_RAMP[Math.min(idx, ASCII_RAMP.length - 1)];
  }

  function renderFrame() {
    if (!running) return;
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      sampleCtx.drawImage(video, 0, 0, COLS, ROWS);
      const { data } = sampleCtx.getImageData(0, 0, COLS, ROWS);
      let text = '';
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const i = (row * COLS + col) * 4;
          text += pixelToChar(data[i], data[i+1], data[i+2]);
        }
        text += '\n';
      }
      pre.textContent = text;
    }
    state.asciiAnimFrame = requestAnimationFrame(renderFrame);
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      state.asciiStream = stream;
      video.srcObject = stream;
      await video.play();
      running = true;
      startBtn.textContent = 'Camera On';
      startBtn.disabled = true;
      captureBtn.disabled = false;
      errorEl.style.display = 'none';
      renderFrame();
    } catch (e) {
      errorEl.style.display = 'flex';
      console.error('Camera error:', e);
    }
  }

  function doCapture() {
    if (capturing) return;
    capturing = true;
    captureBtn.disabled = true;
    let count = 3;
    countdownEl.style.display = 'flex';
    countdownEl.textContent = count;

    const tick = setInterval(() => {
      count--;
      if (count > 0) {
        countdownEl.textContent = count;
      } else if (count === 0) {
        countdownEl.textContent = '📸';
      } else {
        clearInterval(tick);
        countdownEl.style.display = 'none';
        snapshotASCII();
        capturing = false;
        captureBtn.disabled = false;
      }
    }, 1000);
  }

  function snapshotASCII() {
    const charW = 6.0;
    const charH = 10.0;
    const padX  = 16, padY = 16;
    const cvs   = document.createElement('canvas');
    cvs.width   = Math.ceil(COLS * charW) + padX * 2;
    cvs.height  = Math.ceil(ROWS * charH) + padY * 2;
    const ctx   = cvs.getContext('2d');

    const s = STYLES[currentStyle];
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    ctx.fillStyle = s.color;
    ctx.font      = '10px "Courier New", monospace';
    ctx.textBaseline = 'top';

    const lines = pre.textContent.split('\n');
    lines.forEach((line, i) => {
      ctx.fillText(line, padX, padY + i * charH);
    });

    if (s.shadow !== 'none') {
      ctx.globalAlpha = 0.18;
      lines.forEach((line, i) => {
        ctx.fillText(line, padX + 1, padY + i * charH + 1);
      });
      ctx.globalAlpha = 1;
    }

    state.asciiResult = cvs;

    // Show result
    resultCvs.width  = cvs.width;
    resultCvs.height = cvs.height;
    resultCvs.getContext('2d').drawImage(cvs, 0, 0);
    resultDiv.style.display = 'flex';

    // Flash
    document.querySelector('.terminal-frame').classList.add('flash');
    setTimeout(() => document.querySelector('.terminal-frame').classList.remove('flash'), 400);
  }

  function downloadASCII() {
    if (!state.asciiResult) return;
    triggerDownload(state.asciiResult, `ascii-photo-${Date.now()}.png`);
  }

  // Style picker
  const styleButtons = document.querySelectorAll('.ascii-style-btn');
  const STYLES = {
    classic: { color: '#39ff14', shadow: '0 0 4px rgba(57,255,20,0.5)', bg: '#0a0a0a', textColor: '#39ff14' },
    bw:      { color: '#111111', shadow: 'none',                          bg: '#ffffff', textColor: '#111111' },
    blue:    { color: '#5bc8f5', shadow: '0 0 6px rgba(91,200,245,0.5)', bg: '#020c14', textColor: '#5bc8f5' },
  };
  let currentStyle = 'classic';

  function applyStyle(styleName) {
    currentStyle = styleName;
    const s = STYLES[styleName];
    pre.className = `ascii-pre style-${styleName}`;
    document.querySelector('.terminal-frame').style.background = s.bg;
    document.querySelector('.terminal-body').style.background = s.bg;
    styleButtons.forEach(b => b.classList.toggle('active', b.dataset.style === styleName));
    // Update active button color to match style
    styleButtons.forEach(b => {
      if (b.dataset.style === styleName) {
        b.style.color = s.color;
        b.style.borderColor = s.color;
      } else {
        b.style.color = '';
        b.style.borderColor = '';
      }
    });
  }

  styleButtons.forEach(btn => {
    btn.addEventListener('click', () => applyStyle(btn.dataset.style));
  });

  startBtn.addEventListener('click', startCamera);
  captureBtn.addEventListener('click', doCapture);
  downloadBtn.addEventListener('click', downloadASCII);
  customizeBtn.addEventListener('click', () => {
    customizeStation.receive({ type: 'ascii', canvas: state.asciiResult });
  });
})();


/* ═══════════════════════════════════════════════════════════════
   STATION 2 — CLASSIC PHOTOBOOTH STRIP
═══════════════════════════════════════════════════════════════ */
const photoboothStation = (() => {
  const cameraBtn   = document.getElementById('pb-camera-btn');
  const uploadInput = document.getElementById('pb-upload-input');
  const clearBtn    = document.getElementById('pb-clear-btn');
  const slotsEl     = document.getElementById('pb-slots');
  const resultDiv   = document.getElementById('pb-result');
  const stripCvs    = document.getElementById('pb-strip-canvas');
  const downloadBtn = document.getElementById('pb-download-btn');
  const customizeBtn= document.getElementById('pb-to-customize-btn');
  const viewWrap    = document.getElementById('pb-viewfinder-wrap');
  const videoDisplay= document.getElementById('pb-video-display');
  const countdownEl = document.getElementById('pb-countdown');

  const PHOTO_W = 300, PHOTO_H = 400;

  // ── Effect pipeline ──────────────────────────────────────────
  function applyEffect(srcCanvas) {
    const cvs = document.createElement('canvas');
    cvs.width = PHOTO_W; cvs.height = PHOTO_H;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0, PHOTO_W, PHOTO_H);

    const imgData = ctx.getImageData(0, 0, PHOTO_W, PHOTO_H);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      // Grayscale
      let L = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      // Contrast boost
      L = Math.max(0, Math.min(255, (L - 128) * 1.45 + 128));
      // Film grain
      const grain = (Math.random() - 0.5) * 28;
      L = Math.max(0, Math.min(255, L + grain));
      d[i] = d[i+1] = d[i+2] = L;
    }
    ctx.putImageData(imgData, 0, 0);

    // Vignette
    const vgGrad = ctx.createRadialGradient(
      PHOTO_W/2, PHOTO_H/2, PHOTO_H * 0.28,
      PHOTO_W/2, PHOTO_H/2, PHOTO_H * 0.82
    );
    vgGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vgGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vgGrad;
    ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);

    return cvs;
  }

  // ── Slot management ──────────────────────────────────────────
  function addPhoto(processedCanvas) {
    if (state.pbPhotos.length >= 4) return;
    state.pbPhotos.push(processedCanvas);
    renderSlots();
    if (state.pbPhotos.length === 4) assembleStrip();
  }

  function removePhoto(idx) {
    state.pbPhotos.splice(idx, 1);
    state.stripResult = null;
    resultDiv.style.display = 'none';
    renderSlots();
  }

  function renderSlots() {
    const slots = slotsEl.querySelectorAll('.pb-slot');
    slots.forEach((slot, i) => {
      slot.innerHTML = '';
      if (state.pbPhotos[i]) {
        const img = document.createElement('img');
        img.src = state.pbPhotos[i].toDataURL();
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        slot.appendChild(img);
        const rmBtn = document.createElement('button');
        rmBtn.className = 'pb-slot-remove';
        rmBtn.textContent = '✕';
        rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removePhoto(i); });
        slot.appendChild(rmBtn);
      } else {
        const num = document.createElement('span');
        num.className = 'pb-slot-num';
        num.textContent = i + 1;
        slot.appendChild(num);
      }
    });
    cameraBtn.disabled = state.pbPhotos.length >= 4;
    document.getElementById('pb-upload-label').style.opacity = state.pbPhotos.length >= 4 ? '0.4' : '1';
  }

  // ── Strip assembly ───────────────────────────────────────────
  function assembleStrip() {
    const gap = 12, pad = 10;
    const W = PHOTO_W + pad * 2;
    const H = (PHOTO_H * 4) + (gap * 5) + (pad * 2);
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');

    // Strip background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    state.pbPhotos.forEach((photo, i) => {
      const y = pad + gap + i * (PHOTO_H + gap);
      ctx.drawImage(photo, pad, y, PHOTO_W, PHOTO_H);
    });

    state.stripResult = cvs;
    stripCvs.width  = cvs.width;
    stripCvs.height = cvs.height;
    stripCvs.getContext('2d').drawImage(cvs, 0, 0);
    resultDiv.style.display = 'flex';
  }

  // ── Camera capture ───────────────────────────────────────────
  let pbCapturing = false;

  function runCountdown() {
    return new Promise(resolve => {
      let count = 3;
      countdownEl.style.display = 'flex';
      countdownEl.textContent = count;
      const tick = setInterval(() => {
        count--;
        if (count > 0) {
          countdownEl.textContent = count;
        } else if (count === 0) {
          countdownEl.textContent = '📸';
        } else {
          clearInterval(tick);
          countdownEl.style.display = 'none';
          resolve();
        }
      }, 1000);
    });
  }

  function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function startPBCamera() {
    if (state.pbPhotos.length >= 4) return;
    if (pbCapturing) return;
    pbCapturing = true;
    cameraBtn.disabled = true;

    try {
      if (!state.pbStream) {
        state.pbStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
      }
      videoDisplay.srcObject = state.pbStream;
      await videoDisplay.play();
      viewWrap.style.display = 'block';

      // Auto-sequence: take all remaining photos
      const startIdx = state.pbPhotos.length;
      for (let i = startIdx; i < 4; i++) {
        await runCountdown();
        captureFrame();
        // Brief pause so user can see the slot fill before next countdown
        if (i < 3) await pause(700);
      }

      viewWrap.style.display = 'none';
    } catch (e) {
      console.error('PB camera error:', e);
      if (!state.pbStream || e.name === 'NotAllowedError' || e.name === 'NotFoundError') {
        alert('Could not access camera. Try uploading images instead.');
      }
    } finally {
      // Release the stream so the next session starts cleanly
      if (state.pbStream) {
        state.pbStream.getTracks().forEach(t => t.stop());
        state.pbStream = null;
      }
      videoDisplay.srcObject = null;
      pbCapturing = false;
      cameraBtn.disabled = state.pbPhotos.length >= 4;
    }
  }

  function drawCover(ctx, src, srcW, srcH) {
    const targetAspect = PHOTO_W / PHOTO_H;
    const sourceAspect = srcW / srcH;
    let sx, sy, sw, sh;
    if (sourceAspect > targetAspect) {
      sh = srcH; sw = srcH * targetAspect;
      sx = (srcW - sw) / 2; sy = 0;
    } else {
      sw = srcW; sh = srcW / targetAspect;
      sx = 0; sy = (srcH - sh) / 2;
    }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
  }

  function captureFrame() {
    const raw = document.createElement('canvas');
    raw.width = PHOTO_W; raw.height = PHOTO_H;
    drawCover(raw.getContext('2d'), videoDisplay, videoDisplay.videoWidth, videoDisplay.videoHeight);
    addPhoto(applyEffect(raw));
  }

  // ── File upload ───────────────────────────────────────────────
  uploadInput.addEventListener('change', () => {
    const remaining = 4 - state.pbPhotos.length;
    const allFiles = Array.from(uploadInput.files);
    if (allFiles.length > remaining) {
      alert(`Only ${remaining} more photo${remaining === 1 ? '' : 's'} needed. Using the first ${remaining}.`);
    }
    const files = allFiles.slice(0, remaining);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const raw = document.createElement('canvas');
          raw.width = PHOTO_W; raw.height = PHOTO_H;
          drawCover(raw.getContext('2d'), img, img.naturalWidth, img.naturalHeight);
          addPhoto(applyEffect(raw));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
    uploadInput.value = '';
  });

  clearBtn.addEventListener('click', () => {
    state.pbPhotos = [];
    state.stripResult = null;
    resultDiv.style.display = 'none';
    renderSlots();
  });

  cameraBtn.addEventListener('click', startPBCamera);
  downloadBtn.addEventListener('click', () => {
    if (state.stripResult) triggerDownload(state.stripResult, `photobooth-strip-${Date.now()}.png`);
  });
  customizeBtn.addEventListener('click', () => {
    customizeStation.receive({ type: 'strip', canvas: state.stripResult });
  });
})();


/* ═══════════════════════════════════════════════════════════════
   STATION 3 — CUSTOMIZE & DOWNLOAD
═══════════════════════════════════════════════════════════════ */
const customizeStation = (() => {
  const emptyEl   = document.getElementById('customize-empty');
  const uiEl      = document.getElementById('customize-ui');
  const badgeEl   = document.getElementById('customize-badge');
  const canvasWrap= document.getElementById('customize-canvas-wrap');
  const canvas    = document.getElementById('customize-canvas');
  const titleInput= document.getElementById('customize-title');
  const dateToggle= document.getElementById('customize-date-toggle');
  const dlBtn     = document.getElementById('customize-download-btn');
  const stickerPalette = document.getElementById('sticker-palette');
  const tapePalette    = document.getElementById('tape-palette');

  // Emoji stickers (no external images needed)
  const STICKERS = ['⭐','✨','💫','📸','🎞️','🌸','🎀','✂️','📌','🖊️','🗓️','💌'];

  function buildPalette() {
    stickerPalette.innerHTML = '';
    STICKERS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'sticker-btn';
      btn.textContent = emoji;
      btn.title = 'Add sticker';
      btn.addEventListener('click', () => addOverlay('sticker', emoji));
      stickerPalette.appendChild(btn);
    });
  }

  function addOverlay(type, value) {
    const item = document.createElement('div');
    item.className = 'overlay-item' + (type === 'tape' ? ' tape-overlay' : '');
    item.dataset.type  = type;
    item.dataset.value = value;

    if (type === 'sticker') {
      item.style.fontSize = '2rem';
      item.style.lineHeight = '1';
      item.textContent = value;
      item.style.width = '2.5rem';
      item.style.height = '2.5rem';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.justifyContent = 'center';
    } else {
      // washi tape overlay
      const img = document.createElement('img');
      img.src = `assets/washi-tape-${value}.svg`;
      img.alt = '';
      item.appendChild(img);
    }

    // Center in wrap
    const wrapRect = canvasWrap.getBoundingClientRect();
    item.style.left = (canvasWrap.offsetWidth / 2 - 32) + 'px';
    item.style.top  = (canvasWrap.offsetHeight / 2 - 32) + 'px';

    makeDraggable(item);
    canvasWrap.appendChild(item);
    state.overlays.push(item);
  }

  function makeDraggable(el) {
    let startX, startY, origLeft, origTop;
    let rotation = 0;

    // ── Drag ──
    function onDown(e) {
      if (e.target.classList.contains('rotate-handle')) return;
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      startX   = clientX;
      startY   = clientY;
      origLeft = parseInt(el.style.left) || 0;
      origTop  = parseInt(el.style.top)  || 0;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onUp);
    }

    function onMove(e) {
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      el.style.left = (origLeft + clientX - startX) + 'px';
      el.style.top  = (origTop  + clientY - startY) + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend',  onUp);
    }

    el.addEventListener('mousedown',  onDown);
    el.addEventListener('touchstart', onDown, { passive: false });

    // ── Rotate handle ──
    const handle = document.createElement('button');
    handle.className = 'rotate-handle';
    handle.textContent = '↻';
    handle.title = 'Drag to rotate';
    el.appendChild(handle);

    function getAngle(cx, cy, px, py) {
      return Math.atan2(py - cy, px - cx) * 180 / Math.PI;
    }

    function onRotateDown(e) {
      e.stopPropagation();
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const px = e.touches ? e.touches[0].clientX : e.clientX;
      const py = e.touches ? e.touches[0].clientY : e.clientY;
      const startAngle = getAngle(cx, cy, px, py);
      const startRot   = rotation;

      function onRotateMove(e) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        const px = e.touches ? e.touches[0].clientX : e.clientX;
        const py = e.touches ? e.touches[0].clientY : e.clientY;
        rotation = startRot + getAngle(cx, cy, px, py) - startAngle;
        el.style.transform = `rotate(${rotation}deg)`;
        el.dataset.rotation = rotation;
      }

      function onRotateUp() {
        document.removeEventListener('mousemove', onRotateMove);
        document.removeEventListener('mouseup',   onRotateUp);
        document.removeEventListener('touchmove', onRotateMove);
        document.removeEventListener('touchend',  onRotateUp);
      }

      document.addEventListener('mousemove', onRotateMove);
      document.addEventListener('mouseup',   onRotateUp);
      document.addEventListener('touchmove', onRotateMove, { passive: false });
      document.addEventListener('touchend',  onRotateUp);
    }

    handle.addEventListener('mousedown',  onRotateDown);
    handle.addEventListener('touchstart', onRotateDown, { passive: false });
  }

  // ── Draw the base result onto the customize canvas ───────────
  function drawBase(resultCanvas) {
    const pad = 24;
    const W = resultCanvas.width  + pad * 2;
    const H = resultCanvas.height + pad * 2 + 60; // bottom space for title
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Paper background
    ctx.fillStyle = '#f5f0e8';
    ctx.fillRect(0, 0, W, H);

    // Subtle grain
    for (let i = 0; i < W * H * 0.05; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const g = Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgba(${g},${g},${g},0.04)`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Drop shadow under photo
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur  = 12;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(resultCanvas, pad, pad);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
  }

  // ── Public: receive a result from S1 or S2 ───────────────────
  function receive(result) {
    state.activeResult = result;
    // Clear old overlays
    canvasWrap.querySelectorAll('.overlay-item').forEach(el => el.remove());
    state.overlays = [];
    titleInput.value = '';
    dateToggle.checked = false;

    badgeEl.textContent = result.type === 'ascii' ? 'ASCII Photo' : 'Photobooth Strip';
    emptyEl.style.display  = 'none';
    uiEl.style.display     = 'block';

    drawBase(result.canvas);

    carousel.goTo(2);
  }

  // ── Download with compositing ─────────────────────────────────
  dlBtn.addEventListener('click', () => {
    if (!state.activeResult) return;
    const result = state.activeResult;

    const pad = 24;
    const W = result.canvas.width  + pad * 2;
    const H = result.canvas.height + pad * 2 + 60;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');

    // 1. Paper background
    ctx.fillStyle = '#f5f0e8';
    ctx.fillRect(0, 0, W, H);

    // 2. Photo with shadow
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur  = 12;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(result.canvas, pad, pad);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    // 3. Overlays (stickers / tape)
    const wrapRect   = canvasWrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = W / canvas.offsetWidth;
    const scaleY = H / canvas.offsetHeight;

    state.overlays.forEach(el => {
      const elLeft = parseInt(el.style.left) || 0;
      const elTop  = parseInt(el.style.top)  || 0;
      const rot    = parseFloat(el.dataset.rotation || '0') * Math.PI / 180;

      if (el.dataset.type === 'sticker') {
        const size = 40;
        const cx = (elLeft + size / 2) * scaleX;
        const cy = (elTop  + size / 2) * scaleY;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.font = `${Math.round(32 * scaleX)}px serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000';
        ctx.fillText(el.dataset.value, 0, 0);
        ctx.restore();
      } else {
        const tw = 120, th = 28;
        const cx = (elLeft + tw / 2) * scaleX;
        const cy = (elTop  + th / 2) * scaleY;
        const tapeColor = el.dataset.value === '1'
          ? 'rgba(160,200,160,0.65)'
          : 'rgba(210,185,130,0.65)';
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.fillStyle = tapeColor;
        ctx.fillRect(-60 * scaleX, -14 * scaleY, tw * scaleX, th * scaleY);
        ctx.restore();
      }
    });

    // 4. Title
    const title = titleInput.value.trim();
    if (title) {
      ctx.font = `${Math.round(22 * scaleX)}px 'Special Elite', cursive`;
      ctx.fillStyle = '#1a1410';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(title, W / 2, H - 34 * scaleY);
    }

    // 5. Date
    if (dateToggle.checked) {
      const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
      ctx.font = `${Math.round(13 * scaleX)}px 'Courier Prime', monospace`;
      ctx.fillStyle = '#4a3f35';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(dateStr, W / 2, H - 12 * scaleY);
    }

    const filename = result.type === 'ascii'
      ? `ascii-photo-${Date.now()}.png`
      : `photobooth-strip-${Date.now()}.png`;
    triggerDownload(out, filename);
  });

  // Live title/date redraw on canvas
  function redrawLive() {
    if (!state.activeResult) return;
    drawBase(state.activeResult.canvas);

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const title = titleInput.value.trim();
    if (title) {
      ctx.font = '22px "Special Elite", cursive';
      ctx.fillStyle = '#1a1410';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(title, W / 2, H - 34);
    }

    if (dateToggle.checked) {
      const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
      ctx.font = '13px "Courier Prime", monospace';
      ctx.fillStyle = '#4a3f35';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(dateStr, W / 2, H - 12);
    }
  }

  titleInput.addEventListener('input', redrawLive);
  dateToggle.addEventListener('change', redrawLive);

  tapePalette.querySelectorAll('.tape-swatch').forEach(btn => {
    btn.addEventListener('click', () => addOverlay('tape', btn.dataset.tape));
  });

  buildPalette();

  return { receive };
})();


/* ═══════════════════════════════════════════════════════════════
   UTILITY
═══════════════════════════════════════════════════════════════ */
function triggerDownload(canvas, filename) {
  const a = document.createElement('a');
  a.href     = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}

// Footer year
document.getElementById('footer-year').textContent = new Date().getFullYear();

// Cat sticker — remove white background (run once only)
const catEl = document.querySelector('.cat-sticker');
if (catEl) {
  function removeCatWhiteBg() {
    if (catEl.dataset.processed) return;
    catEl.dataset.processed = '1';
    const cvs = document.createElement('canvas');
    cvs.width = catEl.naturalWidth;
    cvs.height = catEl.naturalHeight;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(catEl, 0, 0);
    const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      if (r > 180 && g > 180 && b > 180) {
        const brightness = (r + g + b) / 3;
        d[i+3] = Math.max(0, Math.round((255 - brightness) * 4));
      }
    }
    ctx.putImageData(imgData, 0, 0);
    catEl.removeEventListener('load', removeCatWhiteBg);
    catEl.src = cvs.toDataURL('image/png');
  }
  if (catEl.complete && catEl.naturalWidth) removeCatWhiteBg();
  else catEl.addEventListener('load', removeCatWhiteBg);
}

// Swipe hint — hide on first scroll
const swipeHint = document.getElementById('swipe-hint');
if (swipeHint) {
  document.getElementById('carousel-track').addEventListener('scroll', () => {
    swipeHint.style.transition = 'opacity 0.5s';
    swipeHint.style.opacity = '0';
    setTimeout(() => swipeHint.remove(), 500);
  }, { once: true });
}
