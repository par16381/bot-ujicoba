require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");
const express = require("express");
const cors = require("cors");

// ─── EXPRESS ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── DATABASE ──────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      code          TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      data          JSONB NOT NULL,
      owner_id      BIGINT,
      download_count INT DEFAULT 0,
      created_at    TIMESTAMP DEFAULT NOW(),
      expires_at    TIMESTAMP DEFAULT NULL
    )
  `);

  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS owner_id BIGINT`).catch(() => {});
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS download_count INT DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT NULL`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_sessions (
      id         SERIAL PRIMARY KEY,
      code       TEXT NOT NULL,
      user_id    BIGINT NOT NULL,
      verified   BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '30 minutes'
    )
  `);

  console.log("✅ Database siap.");
}

async function saveLink(data, ownerId) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code;
  let exists = true;

  while (exists) {
    const length = Math.floor(Math.random() * 3) + 6;
    code = Array.from({ length }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
    const result = await pool.query("SELECT code FROM links WHERE code = $1", [code]);
    exists = result.rows.length > 0;
  }

  const expireDays = parseInt(process.env.LINK_EXPIRE_DAYS) || 0;
  const expiresAt = expireDays > 0
    ? new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000)
    : null;

  await pool.query(
    "INSERT INTO links (code, type, data, owner_id, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [code, data.type, JSON.stringify(data), ownerId || null, expiresAt]
  );

  return code;
}

async function getLink(code) {
  const result = await pool.query(
    "SELECT data, expires_at, download_count FROM links WHERE code = $1",
    [code]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  if (row.expires_at && new Date() > new Date(row.expires_at)) {
    return { expired: true };
  }

  return { ...row.data, download_count: row.download_count };
}

async function incrementDownload(code) {
  await pool.query(
    "UPDATE links SET download_count = download_count + 1 WHERE code = $1",
    [code]
  );
}

async function deleteLink(code, ownerId) {
  const result = await pool.query(
    "SELECT owner_id FROM links WHERE code = $1",
    [code]
  );
  if (result.rows.length === 0) return "not_found";

  const isAdmin = ADMIN_IDS.includes(ownerId);
  if (result.rows[0].owner_id !== ownerId && !isAdmin) return "forbidden";

  await pool.query("DELETE FROM links WHERE code = $1", [code]);
  return "deleted";
}

async function getStats(userId) {
  const isAdmin = ADMIN_IDS.includes(userId);

  if (isAdmin) {
    const total = await pool.query("SELECT COUNT(*) FROM links");
    const totalDl = await pool.query("SELECT COALESCE(SUM(download_count), 0) as total FROM links");
    const today = await pool.query(
      "SELECT COUNT(*) FROM links WHERE created_at >= NOW() - INTERVAL '1 day'"
    );
    return {
      type: "admin",
      totalLinks: parseInt(total.rows[0].count),
      totalDownloads: parseInt(totalDl.rows[0].total),
      todayLinks: parseInt(today.rows[0].count),
    };
  } else {
    const result = await pool.query(
      "SELECT code, type, download_count, created_at, expires_at FROM links WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 10",
      [userId]
    );
    const totalDl = await pool.query(
      "SELECT COALESCE(SUM(download_count), 0) as total FROM links WHERE owner_id = $1",
      [userId]
    );
    return {
      type: "user",
      links: result.rows,
      totalDownloads: parseInt(totalDl.rows[0].total),
    };
  }
}

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;
const BOT_USERNAME = process.env.BOT_USERNAME;
const AD_URL = process.env.AD_URL || "https://your-ad-link.com";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const WEBAPP_BACKEND_URL = process.env.WEBAPP_BACKEND_URL || "";
const WHITELIST_USERS = process.env.WHITELIST_USERS
  ? process.env.WHITELIST_USERS.split(",").map((id) => parseInt(id.trim()))
  : [];
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",").map((id) => parseInt(id.trim()))
  : [];

const AD_WAIT_SECONDS = parseInt(process.env.AD_WAIT_SECONDS) || 20;
const PORT = parseInt(process.env.PORT) || 3000;

if (!BOT_TOKEN || !STORAGE_CHANNEL_ID || !BOT_USERNAME) {
  console.error("❌ ERROR: BOT_TOKEN, STORAGE_CHANNEL_ID, dan BOT_USERNAME wajib diisi di .env");
  process.exit(1);
}

if (!WEBAPP_URL) {
  console.warn("⚠️  WEBAPP_URL belum diset di .env — tombol WebApp tidak akan berfungsi.");
}

if (!WEBAPP_BACKEND_URL) {
  console.warn("⚠️  WEBAPP_BACKEND_URL belum diset di .env — klaim file tidak akan berfungsi.");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── IN-MEMORY STORE ───────────────────────────────────────────────────────
const multiMode = new Map();

// ─── HELPER ────────────────────────────────────────────────────────────────
function isAllowed(userId) {
  if (WHITELIST_USERS.length === 0) return true;
  return WHITELIST_USERS.includes(userId) || ADMIN_IDS.includes(userId);
}

function makeShareLink(code) {
  return `https://t.me/${BOT_USERNAME}?start=${code}`;
}

function getMediaType(msg) {
  if (msg.photo)      return "photo";
  if (msg.video)      return "video";
  if (msg.document)   return "document";
  if (msg.audio)      return "audio";
  if (msg.voice)      return "voice";
  if (msg.video_note) return "video_note";
  if (msg.animation)  return "animation";
  return null;
}

async function forwardToStorage(fromChatId, messageId) {
  const forwarded = await bot.forwardMessage(STORAGE_CHANNEL_ID, fromChatId, messageId);
  return forwarded.message_id;
}

async function sendFromStorage(chatId, storedMessageId) {
  await bot.copyMessage(chatId, STORAGE_CHANNEL_ID, storedMessageId, {
    protect_content: true,
  });
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return "♾️ Tidak ada";
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return "⛔ Sudah expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `⏳ ${days} hari ${hours} jam lagi`;
  return `⏳ ${hours} jam lagi`;
}

// ─── HTTP ENDPOINT: /claim ─────────────────────────────────────────────────
app.post("/claim", async (req, res) => {
  const { code, user_id } = req.body;

  if (!code || !user_id) {
    return res.json({ ok: false, error: "Parameter tidak lengkap." });
  }

  const userId = parseInt(user_id);

  try {
    // Cek session di DB
    const sessionResult = await pool.query(
      `SELECT id, verified, expires_at FROM ad_sessions
       WHERE code = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [code, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.json({ ok: false, error: "Session tidak ditemukan. Coba buka link lagi." });
    }

    const session = sessionResult.rows[0];

    if (session.verified) {
      return res.json({ ok: false, error: "File sudah pernah diambil untuk link ini." });
    }

    if (new Date() > new Date(session.expires_at)) {
      return res.json({ ok: false, error: "Session kadaluarsa. Silakan buka link lagi." });
    }

    // Tandai session sudah digunakan
    await pool.query(
      `UPDATE ad_sessions SET verified = TRUE WHERE id = $1`,
      [session.id]
    );

    // Ambil data link
    const linkData = await getLink(code);
    if (!linkData || linkData.expired) {
      return res.json({ ok: false, error: "Link tidak valid atau sudah kadaluarsa." });
    }

    // Kirim file ke user via bot
    if (linkData.type === "multi") {
      for (const id of linkData.ids) {
        await sendFromStorage(userId, id);
      }
    } else {
      await sendFromStorage(userId, linkData.id);
    }

    await incrementDownload(code);
    console.log(`[${new Date().toISOString()}] Code ${code} diambil via WebApp oleh ${userId}`);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Claim error:", err.message);
    return res.json({ ok: false, error: "Terjadi kesalahan server." });
  }
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok" }));

// ─── /start ────────────────────────────────────────────────────────────────
bot.onText(/\/start(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const param = match[1];

  if (param) {
    const linkData = await getLink(param);

    if (!linkData) {
      return bot.sendMessage(chatId, "❌ Link tidak valid atau tidak ditemukan.");
    }

    if (linkData.expired) {
      return bot.sendMessage(
        chatId,
        "⛔ *Link sudah kadaluarsa!*\n\nMinta link baru kepada pengirim.",
        { parse_mode: "Markdown" }
      );
    }

    const fileCount = linkData.type === "multi" ? linkData.ids.length : 1;
    const fileLabel = fileCount > 1 ? `${fileCount} file` : "1 file";

    // Simpan session ke DB
    await pool.query(
      `INSERT INTO ad_sessions (code, user_id) VALUES ($1, $2)`,
      [param, userId]
    );

    // Bangun URL WebApp — sertakan backend URL agar webapp tahu ke mana kirim claim
    const webAppUrl = `${WEBAPP_URL}?code=${param}&wait=${AD_WAIT_SECONDS}&ad=${encodeURIComponent(AD_URL)}&backend=${encodeURIComponent(WEBAPP_BACKEND_URL)}`;

    return bot.sendMessage(
      chatId,
      `📦 *${fileLabel} siap diakses!*\n\n` +
      `Klik tombol di bawah, iklan akan terbuka otomatis.\n` +
      `Tunggu timer selesai lalu klik *Ambil File*.\n\n` +
      `⚠️ _Proses ini tidak bisa dilewati._`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            {
              text: "🎁 Buka & Ambil File",
              web_app: { url: webAppUrl }
            }
          ]]
        }
      }
    );
  }

  await bot.sendMessage(
    chatId,
    `👋 *Selamat datang di File Share Bot!*\n\n` +
    `📌 *Cara upload:*\n` +
    `• *1 file:* Kirim langsung ke bot\n` +
    `• *Multi file:* Ketik /multi → kirim file → /done\n\n` +
    `📌 *Media didukung:*\n` +
    `🖼 Foto · 🎬 Video · 📄 Dokumen · 🎵 Audio · 🎤 Voice · 🎞 GIF\n\n` +
    `📋 *Perintah lengkap:* /help`,
    { parse_mode: "Markdown" }
  );
});

// ─── /help ─────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `📖 *Bantuan - File Share Bot*\n\n` +
    `*Perintah Upload:*\n` +
    `• /multi — Mulai mode multi file\n` +
    `• /done — Selesai & buat link\n` +
    `• /cancel — Batalkan mode multi\n\n` +
    `*Perintah Info:*\n` +
    `• /stats — Statistik link kamu\n` +
    `• /myid — Lihat User ID kamu\n` +
    `• /help — Bantuan ini\n\n` +
    `*Perintah Kelola Link:*\n` +
    `• /delete \\[code\\] — Hapus link\n` +
    `  _Contoh: /delete AbCd1234_\n\n` +
    `*Cara buat link:*\n` +
    `1\\. Kirim file langsung → link otomatis\n` +
    `2\\. /multi → kirim beberapa file → /done`,
    { parse_mode: "MarkdownV2" }
  );
});

// ─── /myid ─────────────────────────────────────────────────────────────────
bot.onText(/\/myid/, async (msg) => {
  const username = msg.from.username ? `@${msg.from.username}` : "tidak ada";
  await bot.sendMessage(
    msg.chat.id,
    `🪪 *Info Akun Kamu*\n\n` +
    `👤 Nama: ${msg.from.first_name}\n` +
    `🔖 Username: ${username}\n` +
    `🆔 User ID: \`${msg.from.id}\``,
    { parse_mode: "Markdown" }
  );
});

// ─── /stats ────────────────────────────────────────────────────────────────
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const stats = await getStats(userId);

    if (stats.type === "admin") {
      await bot.sendMessage(
        chatId,
        `📊 *Statistik Global (Admin)*\n\n` +
        `🔗 Total link aktif: *${stats.totalLinks}*\n` +
        `⬇️ Total download: *${stats.totalDownloads}*\n` +
        `📅 Link dibuat hari ini: *${stats.todayLinks}*`,
        { parse_mode: "Markdown" }
      );
    } else {
      if (stats.links.length === 0) {
        return bot.sendMessage(chatId, "📂 Kamu belum membuat link apapun.");
      }

      let text = `📊 *Statistik Link Kamu*\n`;
      text += `⬇️ Total download: *${stats.totalDownloads}*\n\n`;
      text += `*10 link terbaru:*\n`;
      text += `━━━━━━━━━━━━━━━━\n`;

      stats.links.forEach((row, i) => {
        const shareLink = makeShareLink(row.code);
        const typeLabel = row.type === "multi" ? "📦 Multi" : "📄 Single";
        text += `*${i + 1}.* \`${row.code}\` ${typeLabel}\n`;
        text += `   ⬇️ ${row.download_count}x · ${formatExpiry(row.expires_at)}\n`;
        text += `   🔗 ${shareLink}\n`;
        if (i < stats.links.length - 1) text += `\n`;
      });

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
    }
  } catch (err) {
    console.error("Stats error:", err.message);
    bot.sendMessage(chatId, "❌ Gagal mengambil statistik.");
  }
});

// ─── /delete ───────────────────────────────────────────────────────────────
bot.onText(/\/delete(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const code = match[1];

  if (!code) {
    return bot.sendMessage(
      chatId,
      "⚠️ Sertakan kode link yang ingin dihapus.\n\n_Contoh:_ /delete AbCd1234",
      { parse_mode: "Markdown" }
    );
  }

  const result = await deleteLink(code, userId);

  const messages = {
    deleted:   `✅ Link \`${code}\` berhasil dihapus.`,
    not_found: `❌ Link \`${code}\` tidak ditemukan.`,
    forbidden: `⛔ Kamu tidak memiliki izin untuk menghapus link ini.`,
  };

  await bot.sendMessage(chatId, messages[result] || "❌ Terjadi kesalahan.", {
    parse_mode: "Markdown",
  });
});

// ─── /multi ────────────────────────────────────────────────────────────────
bot.onText(/\/multi/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowed(userId)) {
    return bot.sendMessage(chatId, "⛔ Kamu tidak memiliki izin untuk menggunakan bot ini.");
  }

  multiMode.set(userId, { storedIds: [], mediaGroups: new Map() });

  await bot.sendMessage(
    chatId,
    `📦 *Mode Multi File Aktif!*\n\n` +
    `Kirimkan file satu-satu atau dalam bentuk album.\n` +
    `Setelah selesai, ketik /done untuk membuat link.\n` +
    `Ketik /cancel untuk membatalkan.`,
    { parse_mode: "Markdown" }
  );
});

// ─── /done ─────────────────────────────────────────────────────────────────
bot.onText(/\/done/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!multiMode.has(userId)) {
    return bot.sendMessage(chatId, "⚠️ Kamu tidak sedang dalam mode multi file.\nKetik /multi untuk memulai.");
  }

  const session = multiMode.get(userId);
  multiMode.delete(userId);

  if (session.storedIds.length === 0) {
    return bot.sendMessage(chatId, "⚠️ Belum ada file yang dikirim. Sesi dibatalkan.");
  }

  const loadingMsg = await bot.sendMessage(chatId, "⏳ Membuat link...");

  try {
    const linkData = session.storedIds.length === 1
      ? { type: "single", id: session.storedIds[0] }
      : { type: "multi", ids: session.storedIds };

    const code = await saveLink(linkData, userId);
    const shareLink = makeShareLink(code);
    const expireDays = parseInt(process.env.LINK_EXPIRE_DAYS) || 0;

    await bot.deleteMessage(chatId, loadingMsg.message_id);
    await bot.sendMessage(
      chatId,
      `✅ *${session.storedIds.length} file berhasil diupload!*\n\n` +
      `🔑 Kode: \`${code}\`\n` +
      `🔗 *Link Share:*\n\`${shareLink}\`\n\n` +
      `⏳ Expired: ${expireDays > 0 ? `${expireDays} hari` : "Tidak ada"}\n\n` +
      `_Penerima perlu membuka iklan sebelum mengakses file._`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "📤 Bagikan Link", url: shareLink }]],
        },
      }
    );

    console.log(`[${new Date().toISOString()}] Multi ${session.storedIds.length} file oleh ${userId} → code: ${code}`);
  } catch (err) {
    console.error("Error membuat link:", err.message);
    await bot.editMessageText("❌ Gagal membuat link.", {
      chat_id: chatId, message_id: loadingMsg.message_id,
    });
  }
});

// ─── /cancel ───────────────────────────────────────────────────────────────
bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!multiMode.has(userId)) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada sesi aktif yang bisa dibatalkan.");
  }

  multiMode.delete(userId);
  await bot.sendMessage(chatId, "❌ Sesi multi file dibatalkan.");
});

// ─── CALLBACK QUERY ────────────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  if (query.data === "noop") {
    await bot.answerCallbackQuery(query.id);
  }
});

// ─── HANDLER PESAN (upload file) ───────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Abaikan web_app_data (tidak digunakan lagi, digantikan HTTP endpoint)
  if (msg.web_app_data) return;

  // Abaikan perintah
  if (msg.text && msg.text.startsWith("/")) return;

  if (!isAllowed(userId)) {
    return bot.sendMessage(chatId, "⛔ Kamu tidak memiliki izin untuk menggunakan bot ini.");
  }

  const mediaType = getMediaType(msg);
  if (!mediaType) {
    return bot.sendMessage(
      chatId,
      "ℹ️ Kirimkan *file, foto, video, audio, atau dokumen*.",
      { parse_mode: "Markdown" }
    );
  }

  const mediaEmoji = {
    photo: "🖼", video: "🎬", document: "📄",
    audio: "🎵", voice: "🎤", video_note: "📹", animation: "🎞",
  };
  const emoji = mediaEmoji[mediaType] || "📁";

  // ── MODE MULTI FILE ──────────────────────────────────────────────────────
  if (multiMode.has(userId)) {
    const session = multiMode.get(userId);

    if (msg.media_group_id) {
      const groupId = msg.media_group_id;
      if (!session.mediaGroups.has(groupId)) {
        session.mediaGroups.set(groupId, { msgs: [], timer: null });
      }
      const group = session.mediaGroups.get(groupId);
      group.msgs.push(msg);

      if (group.timer) clearTimeout(group.timer);
      group.timer = setTimeout(async () => {
        session.mediaGroups.delete(groupId);
        const processingMsg = await bot.sendMessage(chatId, `⏳ Memproses ${group.msgs.length} file dari album...`);
        try {
          for (const m of group.msgs) {
            const storedId = await forwardToStorage(chatId, m.message_id);
            session.storedIds.push(storedId);
          }
          await bot.editMessageText(
            `✅ *${group.msgs.length} file* dari album ditambahkan!\n` +
            `📦 Total: *${session.storedIds.length} file* — Ketik /done jika selesai.`,
            { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: "Markdown" }
          );
        } catch (err) {
          console.error("Error forward album:", err.message);
          await bot.editMessageText("❌ Gagal memproses album.", {
            chat_id: chatId, message_id: processingMsg.message_id,
          });
        }
      }, 1500);
      return;
    }

    try {
      const storedId = await forwardToStorage(chatId, msg.message_id);
      session.storedIds.push(storedId);
      await bot.sendMessage(
        chatId,
        `${emoji} File ke-*${session.storedIds.length}* ditambahkan!\n_Kirim lagi atau ketik /done untuk selesai._`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Error forward file:", err.message);
      await bot.sendMessage(chatId, "❌ Gagal memproses file.");
    }
    return;
  }

  // ── SINGLE FILE ──────────────────────────────────────────────────────────
  const loadingMsg = await bot.sendMessage(chatId, "⏳ Sedang memproses file...");

  try {
    const storedMessageId = await forwardToStorage(chatId, msg.message_id);
    const code = await saveLink({ type: "single", id: storedMessageId }, userId);
    const shareLink = makeShareLink(code);
    const expireDays = parseInt(process.env.LINK_EXPIRE_DAYS) || 0;

    const fileName =
      msg.document?.file_name ||
      msg.audio?.title ||
      msg.audio?.file_name ||
      (mediaType.charAt(0).toUpperCase() + mediaType.slice(1));

    await bot.deleteMessage(chatId, loadingMsg.message_id);
    await bot.sendMessage(
      chatId,
      `✅ *File berhasil diupload!*\n\n` +
      `${emoji} *Nama:* ${fileName}\n` +
      `🔑 *Kode:* \`${code}\`\n` +
      `⏳ *Expired:* ${expireDays > 0 ? `${expireDays} hari` : "Tidak ada"}\n\n` +
      `🔗 *Link Share:*\n\`${shareLink}\`\n\n` +
      `_Penerima perlu membuka iklan sebelum mengakses file._`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "📤 Bagikan Link", url: shareLink }]],
        },
      }
    );

    console.log(`[${new Date().toISOString()}] Upload oleh ${userId} → code: ${code}`);
  } catch (err) {
    console.error("Error memproses file:", err.message);
    await bot.editMessageText(
      "❌ Gagal memproses file. Pastikan bot sudah menjadi admin di channel penyimpanan.",
      { chat_id: chatId, message_id: loadingMsg.message_id }
    );
  }
});

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

// ─── INIT ──────────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🌐 HTTP server berjalan di port ${PORT}`);
      console.log(`🤖 Bot berjalan... Tekan Ctrl+C untuk berhenti.`);
    });
  })
  .catch((err) => {
    console.error("❌ Gagal koneksi database:", err.message);
    process.exit(1);
  });
