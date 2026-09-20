/* ──────────────────────────────────────────────
   VidFetch — Frontend Logic
   ────────────────────────────────────────────── */

let selectedFormat  = 'mp4';
let selectedQuality = '1080';
let videoMeta       = null;
let isDownloading   = false;

// ── Format selector ───────────────────────────
function setFormat(fmt) {
  selectedFormat = fmt;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + fmt).classList.add('active');

  const qRow  = document.getElementById('qualityRow');
  const pills = document.getElementById('qualityPills');

  if (fmt === 'mp3') {
    qRow.style.display = 'none';
  } else {
    qRow.style.display = 'flex';
    pills.innerHTML = `
      <button class="pill" onclick="setQuality(this,'2160')">4K</button>
      <button class="pill active" onclick="setQuality(this,'1080')">1080p</button>
      <button class="pill" onclick="setQuality(this,'720')">720p</button>
      <button class="pill" onclick="setQuality(this,'480')">480p</button>
      <button class="pill" onclick="setQuality(this,'360')">360p</button>
    `;
    selectedQuality = '1080';
  }

  resetResult();
}

function setQuality(el, q) {
  selectedQuality = q;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
}

// ── Status helper ─────────────────────────────
function showStatus(msg, type) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className   = 'status-msg visible ' + type;
}
function hideStatus() {
  document.getElementById('statusMsg').className = 'status-msg';
}
function resetResult() {
  document.getElementById('resultArea').classList.remove('visible');
  document.getElementById('progressWrap').style.display = 'none';
  hideStatus();
  videoMeta = null;
}

// ── Fetch video info ──────────────────────────
async function fetchInfo() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) { showStatus('⚠ Please paste a video URL.', 'error'); return; }

  resetResult();
  showStatus('🔍 Fetching video info…', 'info');

  try {
    const res  = await fetch('/info', {
      method:  'POST',
      headers: {'Content-Type': 'application/json'},
      body:    JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showStatus('❌ ' + (data.error || 'Could not fetch info.'), 'error');
      return;
    }

    videoMeta = data;

    // Populate preview
    const thumb = document.getElementById('thumbImg');
    const icon  = document.getElementById('thumbIcon');
    if (data.thumbnail) {
      thumb.src = data.thumbnail;
      thumb.style.display = 'block';
      icon.style.display  = 'none';
    }

    document.getElementById('videoTitle').textContent = data.title || 'Unknown Title';
    document.getElementById('videoSub').textContent   =
      [data.platform, data.uploader, data.duration]
        .filter(Boolean).join(' · ');

    showStatus('✅ Video found. Click Download Now to proceed.', 'success');
    document.getElementById('resultArea').classList.add('visible');
    document.getElementById('progressWrap').style.display  = 'none';
    resetDownloadBtn();

  } catch (err) {
    showStatus('❌ Network error: ' + err.message, 'error');
  }
}

// ── Download ──────────────────────────────────
async function startDownload() {
  if (!videoMeta || isDownloading) return;

  const url = document.getElementById('urlInput').value.trim();
  isDownloading = true;

  const btn = document.getElementById('downloadBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ Processing…';

  const progWrap = document.getElementById('progressWrap');
  progWrap.style.display = 'block';
  setProgress(0, 'Sending request to server…');
  showStatus(`📡 Downloading ${selectedFormat.toUpperCase()}${selectedFormat !== 'mp3' ? ' ' + selectedQuality + 'p' : ''}…`, 'info');

  try {
    const res = await fetch('/download', {
      method:  'POST',
      headers: {'Content-Type': 'application/json'},
      body:    JSON.stringify({
        url,
        format:  selectedFormat,
        quality: selectedQuality,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || 'Download failed.');
    }

    // Stream blob
    setProgress(90, 'Receiving file from server…');

    const contentDisposition = res.headers.get('Content-Disposition') || '';
    let filename = 'download.' + selectedFormat;
    const match  = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    if (match) filename = decodeURIComponent(match[1].replace(/"/g, ''));

    const blob    = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href         = blobUrl;
    a.download     = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    setProgress(100, 'Complete!');
    showStatus('✅ Download started! Check your downloads folder.', 'success');
    btn.textContent = '✅ Downloaded';
    btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
    setTimeout(() => { resetDownloadBtn(); isDownloading = false; }, 4000);

  } catch (err) {
    showStatus('❌ ' + err.message, 'error');
    resetDownloadBtn();
    isDownloading = false;
  }
}

function setProgress(pct, label, sub) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent  = pct + '%';
  document.getElementById('progressLabel').textContent = label || '';
  document.getElementById('progressSub').textContent  = sub  || '';
}

function resetDownloadBtn() {
  const btn = document.getElementById('downloadBtn');
  btn.disabled         = false;
  btn.textContent      = '⬇️ Download Now';
  btn.style.background = '';
}

// ── Enter key on URL input ────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('urlInput')
    .addEventListener('keydown', e => { if (e.key === 'Enter') fetchInfo(); });
});
