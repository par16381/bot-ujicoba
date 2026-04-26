<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ambil File</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--tg-theme-bg-color, #ffffff);
      color: var(--tg-theme-text-color, #000000);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }

    .card {
      width: 100%;
      max-width: 380px;
      text-align: center;
    }

    h2 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .subtitle {
      font-size: 14px;
      opacity: 0.55;
      margin-bottom: 28px;
      line-height: 1.4;
    }

    .timer {
      font-size: 64px;
      font-weight: 800;
      color: var(--tg-theme-button-color, #2b5ce6);
      margin-bottom: 6px;
      min-height: 76px;
      line-height: 1;
      letter-spacing: -2px;
    }

    .status {
      font-size: 13px;
      opacity: 0.55;
      margin-bottom: 28px;
      min-height: 18px;
      line-height: 1.4;
    }

    .btn {
      width: 100%;
      padding: 15px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      background: var(--tg-theme-button-color, #2b5ce6);
      color: var(--tg-theme-button-text-color, #ffffff);
      transition: opacity 0.2s, transform 0.1s;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .btn:active:not(:disabled) { transform: scale(0.98); }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }

    .steps { margin-bottom: 24px; }

    .step {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--tg-theme-secondary-bg-color, #f5f5f5);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 8px;
      text-align: left;
      font-size: 13px;
      line-height: 1.4;
    }

    .step-num {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--tg-theme-button-color, #2b5ce6);
      color: var(--tg-theme-button-text-color, #ffffff);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      flex-shrink: 0;
    }

    .progress-wrap {
      background: var(--tg-theme-secondary-bg-color, #f0f0f0);
      border-radius: 999px;
      height: 6px;
      margin-bottom: 28px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      background: var(--tg-theme-button-color, #2b5ce6);
      border-radius: 999px;
      width: 0%;
    }

    .note {
      font-size: 11px;
      opacity: 0.35;
      margin-top: 14px;
      line-height: 1.4;
    }

    .error-box {
      background: #fee2e2;
      color: #991b1b;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 13px;
      margin-bottom: 16px;
      display: none;
      text-align: left;
      line-height: 1.4;
    }

    .phase { display: none; }
    .phase.active { display: block; }

    @keyframes popIn {
      0%   { transform: scale(0.5); opacity: 0; }
      80%  { transform: scale(1.1); }
      100% { transform: scale(1); opacity: 1; }
    }
    .success-icon {
      font-size: 64px;
      margin-bottom: 6px;
      animation: popIn 0.4s ease forwards;
    }
  </style>
</head>
<body>
<div class="card">

  <!-- FASE 1 -->
  <div class="phase active" id="phase1">
    <h2>📥 Ambil File</h2>
    <p class="subtitle">Ikuti 3 langkah berikut untuk mendapatkan file</p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div>Klik tombol di bawah untuk membuka iklan</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div>Tunggu timer countdown selesai</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div>Klik <strong>Ambil File</strong> untuk menerima file di chat</div>
      </div>
    </div>
    <button class="btn" id="btn-open-ad">🚀 Buka Iklan Sekarang</button>
    <p class="note">Proses ini mendukung tersedianya konten gratis</p>
  </div>

  <!-- FASE 2 -->
  <div class="phase" id="phase2">
    <h2>⏳ Tunggu Sebentar</h2>
    <p class="subtitle">Jangan tutup halaman ini sampai timer selesai</p>
    <div class="timer" id="timer">--</div>
    <div class="progress-wrap">
      <div class="progress-bar" id="progress-bar"></div>
    </div>
    <div class="status" id="status">Timer sedang berjalan...</div>
    <div class="error-box" id="error-box"></div>
    <button class="btn" id="btn-claim" disabled>⏳ Tunggu timer selesai...</button>
    <p class="note">Proses ini mendukung tersedianya konten gratis</p>
  </div>

  <!-- FASE 3 -->
  <div class="phase" id="phase3">
    <div class="success-icon">✅</div>
    <h2>File Dikirim!</h2>
    <p class="subtitle">Kembali ke Telegram untuk melihat file yang sudah dikirim ke chat kamu</p>
    <br>
    <button class="btn" id="btn-back">← Kembali ke Telegram</button>
    <p class="note">Terima kasih sudah mendukung konten gratis</p>
  </div>

</div>
<script>
  // =====================================================================
  // GANTI URL INI DENGAN URL RAILWAY BOT KAMU
  // Cek di Railway → Settings → Networking → Public Domain
  const BACKEND_URL = "https://bot-ujicoba-production.up.railway.app";
  // =====================================================================

  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();

  const params = new URLSearchParams(location.search);
  const code   = params.get('code');
  const wait   = parseInt(params.get('wait')) || 20;
  const adUrl  = params.get('ad') ? decodeURIComponent(params.get('ad')) : null;

  const timerEl    = document.getElementById('timer');
  const statusEl   = document.getElementById('status');
  const progressEl = document.getElementById('progress-bar');
  const errorBox   = document.getElementById('error-box');
  const btnOpenAd  = document.getElementById('btn-open-ad');
  const btnClaim   = document.getElementById('btn-claim');
  const btnBack    = document.getElementById('btn-back');

  function showPhase(n) {
    document.querySelectorAll('.phase').forEach(el => el.classList.remove('active'));
    document.getElementById('phase' + n).classList.add('active');
  }

  function showError(msg) {
    errorBox.textContent = '❌ ' + msg;
    errorBox.style.display = 'block';
  }

  function hideError() {
    errorBox.style.display = 'none';
  }

  // Validasi code
  if (!code) {
    btnOpenAd.textContent = '❌ Link tidak valid';
    btnOpenAd.disabled = true;
  }

  // ── Fase 1: Buka iklan ─────────────────────────────────────────────────
  btnOpenAd.addEventListener('click', () => {
    if (adUrl) tg.openLink(adUrl);
    showPhase(2);
    startTimer();
  });

  // ── Timer countdown ────────────────────────────────────────────────────
  function startTimer() {
    let remaining = wait;
    timerEl.textContent = remaining + 's';

    // Animasi progress bar
    progressEl.style.transition = 'none';
    progressEl.style.width = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        progressEl.style.transition = `width ${wait}s linear`;
        progressEl.style.width = '100%';
      });
    });

    const interval = setInterval(() => {
      remaining--;
      timerEl.textContent = remaining > 0 ? remaining + 's' : '🎉';
      if (remaining <= 0) {
        clearInterval(interval);
        statusEl.textContent = 'Timer selesai! Klik tombol untuk mengambil file.';
        btnClaim.disabled = false;
        btnClaim.textContent = '📥 Ambil File Sekarang';
      }
    }, 1000);
  }

  // ── Fase 2: Klaim file ─────────────────────────────────────────────────
  btnClaim.addEventListener('click', async () => {
    if (btnClaim.disabled) return;

    hideError();
    btnClaim.disabled = true;
    btnClaim.textContent = '⏳ Memproses...';
    statusEl.textContent = 'Menghubungi server...';

    const userId = tg.initDataUnsafe?.user?.id;

    if (!userId) {
      showError('Gagal mendapatkan ID pengguna. Tutup dan buka kembali WebApp ini.');
      btnClaim.disabled = false;
      btnClaim.textContent = '📥 Coba Lagi';
      statusEl.textContent = '';
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, user_id: userId })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();

      if (result.ok) {
        showPhase(3);
      } else {
        showError(result.error || 'Terjadi kesalahan. Silakan coba lagi.');
        btnClaim.disabled = false;
        btnClaim.textContent = '📥 Coba Lagi';
        statusEl.textContent = '';
      }
    } catch (err) {
      console.error('Claim error:', err);
      showError('Gagal terhubung ke server. Periksa koneksi internet kamu. (' + err.message + ')');
      btnClaim.disabled = false;
      btnClaim.textContent = '📥 Coba Lagi';
      statusEl.textContent = '';
    }
  });

  // ── Fase 3: Kembali ────────────────────────────────────────────────────
  btnBack.addEventListener('click', () => tg.close());
</script>
</body>
</html>
