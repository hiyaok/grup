const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, makeInMemoryStore, PHONENUMBER_MCC, proto, getAggregateVotesInPollMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const crypto = require('crypto');
const NodeCache = require('node-cache');

// Global crypto
global.crypto = crypto;

// Konfigurasi
const BOT_TOKEN = '7562673828:AAH30pGum6eDekjt_DSY3zKLiP0Udwj9kOo'; // Token bot Telegram
const WHATSAPP_SUPPORT = '15517868423@s.whatsapp.net'; // WhatsApp support number
const ADMINS_FILE = path.join(__dirname, 'admins.json');
const PREMIUM_FILE = path.join(__dirname, 'premium.json');
const SESSION_DIR = path.join(__dirname, 'hiyaok_sessions'); // Updated session directory name

// Inisialisasi bot Telegram
const bot = new Telegraf(BOT_TOKEN);

// Storage untuk koneksi WhatsApp per user
const waConnections = new Map();
const connectingUsers = new Set();
const userSessions = new Map();
const msgRetryCounterCache = new NodeCache();
const stores = new Map();

// Tambahkan storage untuk tracking QR state
const qrState = new Map();

// Pastikan direktori session ada
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Load admins dari file
let admins = [];
if (fs.existsSync(ADMINS_FILE)) {
    admins = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
} else {
    admins = [5988451717]; // Ganti dengan ID admin pertama
    saveAdmins();
}

// Load premium users dari file
let premiumUsers = [];
if (fs.existsSync(PREMIUM_FILE)) {
    premiumUsers = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
} else {
    premiumUsers = [];
    savePremium();
}

// Simpan admins ke file
function saveAdmins() {
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
}

// Simpan premium users ke file
function savePremium() {
    fs.writeFileSync(PREMIUM_FILE, JSON.stringify(premiumUsers, null, 2));
}

// Cek apakah user adalah admin
function isAdmin(userId) {
    return admins.includes(userId);
}

// Cek apakah user adalah premium
function isPremium(userId) {
    return premiumUsers.includes(userId);
}

// Cek apakah user punya akses (admin atau premium)
function hasAccess(userId) {
    return isAdmin(userId) || isPremium(userId);
}

// Middleware untuk cek akses
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    
    // Skip untuk callback queries
    if (ctx.updateType === 'callback_query') {
        return next();
    }
    
    if (!userId || !hasAccess(userId)) {
        return ctx.reply('❌ Anda tidak memiliki akses ke bot ini. Silakan hubungi admin untuk mendapatkan akses.');
    }
    
    return next();
});

// Command /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    const userType = isAdmin(userId) ? 'Admin' : 'Premium User';
    
    let commands = '👋 Selamat datang di Bot WhatsApp Manager!\n\n' +
                  `🔑 Status Anda: ${userType}\n\n` +
                  'Perintah yang tersedia:\n' +
                  '/connect - Hubungkan dengan WhatsApp\n' +
                  '/status - Cek status koneksi\n' +
                  '/logout - Putuskan koneksi WhatsApp\n' +
                  '/unban - Kirim permintaan unban grup\n' +
                  '/namagrup - Lihat daftar nama grup WhatsApp\n';
    
    // Tambah command admin jika user adalah admin
    if (isAdmin(userId)) {
        commands += '\n📛 *Command Admin:*\n' +
                   '/addadmin - Tambah admin baru\n' +
                   '/addprem - Tambah premium user\n' +
                   '/listadmin - Lihat daftar admin\n' +
                   '/listprem - Lihat daftar premium user\n';
    }
    
    commands += '\nGunakan /connect untuk memulai.';
    
    ctx.reply(commands, { parse_mode: 'Markdown' });
});

// Command /status - Cek status koneksi
bot.command('status', async (ctx) => {
    const userId = ctx.from.id;
    const sock = waConnections.get(userId);
    
    if (!sock) {
        return ctx.reply('❌ Anda belum terhubung dengan WhatsApp.\nGunakan /connect untuk menghubungkan.');
    }
    
    try {
        const user = sock.user;
        ctx.reply(
            '✅ Status: Terhubung\n\n' +
            `📱 Nomor: ${user.id.split(':')[0]}\n` +
            `👤 Nama: ${user.name || 'Tidak diketahui'}`
        );
    } catch (error) {
        ctx.reply('⚠️ Koneksi aktif tetapi tidak dapat mengambil info user.');
    }
});

// Helper function untuk create socket dengan konfigurasi yang benar
async function createWhatsAppSocket(userId, state, saveCreds, ctx) {
    // Create store untuk menyimpan messages
    const store = makeInMemoryStore({
        logger: pino({ level: 'silent' })
    });
    
    // Bind store ke multi file auth state
    const storeFile = path.join(SESSION_DIR, `hiyaok_${userId}`, 'store.json');
    
    // Load store dari file jika ada
    if (fs.existsSync(storeFile)) {
        try {
            const storeData = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
            store.fromJSON(storeData);
        } catch (e) {
            console.log('Failed to load store:', e);
        }
    }
    
    // Save store setiap 10 detik
    setInterval(() => {
        try {
            const storeDir = path.dirname(storeFile);
            if (!fs.existsSync(storeDir)) {
                fs.mkdirSync(storeDir, { recursive: true });
            }
            fs.writeFileSync(storeFile, JSON.stringify(store.toJSON()));
        } catch (e) {
            console.log('Failed to save store:', e);
        }
    }, 10000);
    
    stores.set(userId, store);
    
    // Get latest version dengan retry
    let version, isLatest;
    let retries = 3;
    while (retries > 0) {
        try {
            ({ version, isLatest } = await fetchLatestBaileysVersion());
            console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);
            break;
        } catch (error) {
            console.log(`Failed to fetch version, retries left: ${retries - 1}`);
            retries--;
            if (retries === 0) {
                // Use default version if fetch fails
                version = [2, 3000, 1019707846];
                isLatest = false;
            } else {
                await delay(1000);
            }
        }
    }
    
    // Buat koneksi WhatsApp dengan konfigurasi desktop
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        browser: ['Mac OS', 'Safari', '15.0'], // Konfigurasi untuk MacBook/iOS
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        qrTimeout: 40000,
        emitOwnEvents: true,
        fireInitQueries: true,
        shouldSyncHistoryMessage: () => true,
        // Mobile/Desktop specific options
        mobile: false, // Set false untuk desktop
        // Additional stability options
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        // Connection options untuk stability
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return proto.Message.fromObject({});
        },
        // Custom socket options
        options: {
            // Tambahan opsi untuk koneksi yang lebih stabil
            agent: undefined,
            fetchAgent: undefined,
            tls: {
                rejectUnauthorized: false
            }
        }
    });
    
    // Bind store to socket
    store.bind(sock.ev);
    
    // Handle connection update dengan retry logic
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isOnline, isNewLogin } = update;
        
        if (qr) {
            console.log('QR Code received');
            const state = qrState.get(userId) || {};
            state.currentQR = qr;
            qrState.set(userId, state);
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            
            // Cleanup
            connectingUsers.delete(userId);
            waConnections.delete(userId);
            stores.delete(userId);
            
            // Hapus QR message jika ada
            const state = qrState.get(userId);
            if (state && state.messageId) {
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, state.messageId);
                } catch (e) {
                    console.error('Error deleting QR message:', e);
                }
            }
            
            qrState.delete(userId);
            
            // Handle reconnection dengan delay
            if (shouldReconnect && statusCode !== DisconnectReason.restartRequired) {
                setTimeout(async () => {
                    console.log('Attempting to reconnect...');
                    try {
                        // Re-create socket dengan state yang sama
                        const newSock = await createWhatsAppSocket(userId, state, saveCreds, ctx);
                        waConnections.set(userId, newSock);
                    } catch (error) {
                        console.error('Reconnection failed:', error);
                        ctx.reply('❌ Gagal reconnect. Silakan gunakan /connect untuk menghubungkan kembali.');
                    }
                }, 3000);
            } else {
                // Notify user berdasarkan disconnect reason
                let message = '';
                switch (statusCode) {
                    case DisconnectReason.badSession:
                        message = '❌ Session bermasalah. Silakan /logout dan /connect lagi.';
                        break;
                    case DisconnectReason.connectionClosed:
                        message = '🔄 Koneksi terputus. Silakan /connect untuk menghubungkan kembali.';
                        break;
                    case DisconnectReason.connectionLost:
                        message = '📶 Koneksi internet terputus. Silakan /connect lagi setelah koneksi stabil.';
                        break;
                    case DisconnectReason.connectionReplaced:
                        message = '⚠️ WhatsApp dibuka di perangkat lain. Silakan /connect lagi.';
                        break;
                    case DisconnectReason.loggedOut:
                        message = '📱 Logout berhasil.';
                        break;
                    case DisconnectReason.restartRequired:
                        message = '🔄 Perlu restart. Silakan /connect lagi.';
                        break;
                    case DisconnectReason.timedOut:
                        message = '⏱️ Timeout. QR Code kedaluwarsa. Silakan /connect lagi.';
                        break;
                    case DisconnectReason.multideviceMismatch:
                        message = '⚠️ Versi multi-device tidak cocok. Update WhatsApp Anda.';
                        break;
                    default:
                        message = '🔄 Koneksi terputus. Gunakan /connect untuk menghubungkan kembali.';
                }
                
                ctx.reply(message);
            }
            
        } else if (connection === 'open') {
            console.log('Connection opened successfully');
            
            // Koneksi berhasil
            waConnections.set(userId, sock);
            connectingUsers.delete(userId);
            
            // Hapus QR message
            const state = qrState.get(userId);
            if (state && state.messageId) {
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, state.messageId);
                } catch (e) {
                    console.error('Error deleting QR message:', e);
                }
            }
            
            qrState.delete(userId);
            
            // Dapatkan info user
            try {
                const user = sock.user;
                await ctx.reply(
                    '✅ Berhasil terhubung dengan WhatsApp!\n\n' +
                    `📱 Nomor: ${user.id.split(':')[0]}\n` +
                    `👤 Nama: ${user.name || 'Tidak diketahui'}\n` +
                    `💻 Mode: Desktop/MacBook\n\n` +
                    'Gunakan /namagrup untuk melihat daftar grup.'
                );
            } catch (e) {
                await ctx.reply('✅ Berhasil terhubung dengan WhatsApp!');
            }
        } else if (connection === 'connecting') {
            console.log('Connecting to WhatsApp...');
        }
    });
    
    // Handle credentials update
    sock.ev.on('creds.update', saveCreds);
    
    // Handle messages untuk debugging
    sock.ev.on('messages.upsert', async (m) => {
        console.log('Received message');
    });
    
    // Handle call events
    sock.ev.on('call', async (calls) => {
        console.log('Received call event');
    });
    
    // Error handling untuk socket
    sock.ev.on('error', (error) => {
        console.error('Socket error:', error);
    });
    
    return sock;
}

// Command /connect
bot.command('connect', async (ctx) => {
    const userId = ctx.from.id;
    
    // Cek apakah sudah terkoneksi
    if (waConnections.has(userId)) {
        return ctx.reply('✅ Anda sudah terkoneksi dengan WhatsApp. Gunakan /logout untuk memutuskan koneksi.');
    }
    
    // Cek apakah sedang dalam proses koneksi
    if (connectingUsers.has(userId)) {
        return ctx.reply('⏳ Proses koneksi sedang berlangsung...');
    }
    
    connectingUsers.add(userId);
    
    // Variable untuk menyimpan message ID QR dan interval
    let qrMessageId = null;
    let qrInterval = null;
    
    // Inisialisasi QR state
    qrState.set(userId, {
        currentQR: null,
        lastQR: null,
        messageId: null,
        updateInProgress: false,
        errorCount: 0
    });
    
    try {
        // Buat direktori session dengan nama hiyaok
        const userSessionDir = path.join(SESSION_DIR, `hiyaok_${userId}`);
        if (!fs.existsSync(userSessionDir)) {
            fs.mkdirSync(userSessionDir, { recursive: true });
        }
        
        // Setup auth state
        const { state, saveCreds } = await useMultiFileAuthState(userSessionDir);
        
        // Create socket dengan helper function
        const sock = await createWhatsAppSocket(userId, state, saveCreds, ctx);
        
        // Update QR dengan debouncing dan error handling
        qrInterval = setInterval(async () => {
            const state = qrState.get(userId);
            if (!state || !connectingUsers.has(userId)) {
                clearInterval(qrInterval);
                return;
            }
            
            // Cek apakah ada QR baru dan tidak sedang dalam proses update
            if (state.currentQR && state.currentQR !== state.lastQR && !state.updateInProgress) {
                state.updateInProgress = true;
                state.lastQR = state.currentQR;
                qrState.set(userId, state);
                
                try {
                    // Validasi QR code sebelum generate
                    if (!state.currentQR || typeof state.currentQR !== 'string' || state.currentQR.length < 10) {
                        throw new Error('Invalid QR code data');
                    }
                    
                    const qrBuffer = await qrcode.toBuffer(state.currentQR, { 
                        width: 400,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        },
                        errorCorrectionLevel: 'M'
                    });
                    
                    const caption = '📱 *Scan QR Code dengan WhatsApp Desktop/iOS*\n\n' +
                                  '💻 *Untuk Desktop/MacBook:*\n' +
                                  '1. Buka WhatsApp Web di browser\n' +
                                  '2. Atau gunakan WhatsApp Desktop app\n' +
                                  '3. Pilih "Link a Device"\n' +
                                  '4. Scan QR code ini\n\n' +
                                  '📱 *Untuk iOS:*\n' +
                                  '1. Buka WhatsApp di iPhone/iPad\n' +
                                  '2. Ketuk Setelan > Perangkat Tertaut\n' +
                                  '3. Ketuk "Tautkan Perangkat"\n' +
                                  '4. Scan QR code ini\n\n' +
                                  '⏱️ QR akan diperbarui otomatis\n' +
                                  '⚠️ Jika QR tidak muncul, klik Batal dan coba lagi';
                    
                    if (state.messageId) {
                        // Hapus pesan QR lama
                        try {
                            await ctx.telegram.deleteMessage(ctx.chat.id, state.messageId);
                        } catch (e) {
                            console.log('Could not delete old QR message');
                        }
                    }
                    
                    // Kirim QR baru
                    const message = await ctx.replyWithPhoto(
                        { source: qrBuffer },
                        {
                            caption: caption,
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('❌ Batal', `cancel_${userId}`)]
                            ])
                        }
                    );
                    
                    state.messageId = message.message_id;
                    state.updateInProgress = false;
                    state.errorCount = 0;
                    qrState.set(userId, state);
                    
                } catch (error) {
                    console.error('Error updating QR:', error);
                    state.updateInProgress = false;
                    state.errorCount = (state.errorCount || 0) + 1;
                    qrState.set(userId, state);
                    
                    // Jika error terjadi beberapa kali, notify user
                    if (state.errorCount >= 3) {
                        await ctx.reply('⚠️ Terjadi kesalahan saat generate QR Code. Silakan klik batal dan coba lagi.');
                        state.errorCount = 0;
                        qrState.set(userId, state);
                    }
                }
            }
        }, 2000); // Cek setiap 2 detik
        
        // Store QR interval untuk cleanup
        if (!qrState.has(userId)) {
            qrState.set(userId, {});
        }
        const state = qrState.get(userId);
        state.qrInterval = qrInterval;
        qrState.set(userId, state);
        
        // Send waiting message
        await ctx.reply('⏳ Memulai proses koneksi untuk Desktop/MacBook...\nQR Code akan muncul dalam beberapa detik.');
        
    } catch (error) {
        console.error('Error connecting:', error);
        connectingUsers.delete(userId);
        qrState.delete(userId);
        
        // Clear interval jika ada error
        if (qrInterval) {
            clearInterval(qrInterval);
        }
        
        let errorMessage = '❌ Terjadi kesalahan saat menghubungkan dengan WhatsApp.\n';
        
        // Handle specific errors
        if (error.message.includes('ENOTFOUND')) {
            errorMessage += 'Masalah koneksi internet. Pastikan koneksi internet stabil.';
        } else if (error.message.includes('ETIMEDOUT')) {
            errorMessage += 'Koneksi timeout. Silakan coba lagi.';
        } else if (error.message.includes('405')) {
            errorMessage += 'WhatsApp menolak koneksi. Coba lagi dalam beberapa saat.';
        } else {
            errorMessage += 'Error: ' + error.message;
        }
        
        ctx.reply(errorMessage);
    }
});

// Handle cancel button
bot.action(/cancel_(\d+)/, async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const callbackUserId = ctx.from.id;
    
    // Pastikan yang menekan adalah user yang sama
    if (userId !== callbackUserId) {
        return ctx.answerCbQuery('❌ Anda tidak dapat membatalkan koneksi orang lain!');
    }
    
    // Clear QR interval
    const state = qrState.get(userId);
    if (state && state.qrInterval) {
        clearInterval(state.qrInterval);
    }
    
    // Batalkan koneksi
    connectingUsers.delete(userId);
    qrState.delete(userId);
    const sock = waConnections.get(userId);
    if (sock) {
        sock.end();
        waConnections.delete(userId);
    }
    
    // Hapus pesan QR
    try {
        await ctx.deleteMessage();
    } catch (e) {}
    
    ctx.reply('❌ Proses koneksi dibatalkan.');
    ctx.answerCbQuery('Dibatalkan');
});

// Command /logout
bot.command('logout', async (ctx) => {
    const userId = ctx.from.id;
    const sock = waConnections.get(userId);
    
    if (!sock) {
        return ctx.reply('❌ Anda belum terhubung dengan WhatsApp.');
    }
    
    try {
        await sock.logout();
        waConnections.delete(userId);
        stores.delete(userId);
        
        // Hapus session files
        const userSessionDir = path.join(SESSION_DIR, `hiyaok_${userId}`);
        if (fs.existsSync(userSessionDir)) {
            fs.rmSync(userSessionDir, { recursive: true, force: true });
        }
        
        ctx.reply('✅ Berhasil logout dari WhatsApp.');
    } catch (error) {
        console.error('Error logout:', error);
        ctx.reply('❌ Terjadi kesalahan saat logout.');
    }
});

// Command /namagrup - Menampilkan daftar nama grup saja
bot.command('namagrup', async (ctx) => {
    const userId = ctx.from.id;
    const sock = waConnections.get(userId);
    
    if (!sock) {
        return ctx.reply('❌ Anda harus login terlebih dahulu dengan /connect');
    }
    
    try {
        ctx.reply('🔄 Mengambil daftar grup...');
        
        // Dapatkan semua chat dengan error handling
        let chats;
        try {
            chats = await sock.groupFetchAllParticipating();
        } catch (error) {
            console.error('Error fetching groups:', error);
            return ctx.reply('❌ Gagal mengambil daftar grup. Pastikan koneksi WhatsApp stabil.');
        }
        
        const groups = Object.values(chats).filter(chat => chat.id.endsWith('@g.us'));
        
        if (groups.length === 0) {
            return ctx.reply('📭 Anda tidak tergabung dalam grup WhatsApp manapun.');
        }
        
        // Sort berdasarkan nama
        groups.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
        
        // Buat pesan dengan hanya nama grup
        let message = `📱 *Daftar Grup WhatsApp Anda*\n`;
        message += `Total: ${groups.length} grup\n\n`;
        
        groups.forEach((group, index) => {
            message += `${index + 1}. ${group.subject || 'Tanpa Nama'}\n`;
        });
        
        // Kirim pesan
        ctx.replyWithMarkdown(message);
        
    } catch (error) {
        console.error('Error getting groups:', error);
        ctx.reply('❌ Gagal mendapatkan daftar grup. Error: ' + error.message);
    }
});

// Command /unban dengan skema baru
bot.command('unban', async (ctx) => {
    const userId = ctx.from.id;
    const sock = waConnections.get(userId);
    
    if (!sock) {
        return ctx.reply('❌ Anda harus login terlebih dahulu dengan /connect');
    }
    
    // Set state untuk menunggu input list grup
    const session = userSessions.get(userId) || {};
    session.waitingFor = 'group_list';
    userSessions.set(userId, session);
    
    ctx.reply('📋 Silakan kirim list nama grup yang ingin di-unban:\n\n' +
              'Contoh:\n' +
              'Grup A\n' +
              'Grup B\n' +
              'Grup C');
});

// Command /addadmin - Hanya untuk admin
bot.command('addadmin', (ctx) => {
    const userId = ctx.from.id;
    
    // Cek apakah user adalah admin
    if (!isAdmin(userId)) {
        return ctx.reply('❌ Perintah ini hanya untuk admin!');
    }
    
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
        return ctx.reply(
            '📖 Cara menggunakan /addadmin:\n\n' +
            '/addadmin [ID_USER]\n\n' +
            'Contoh: /addadmin 123456789\n\n' +
            'ID user bisa didapatkan dengan meminta user tersebut mengirim pesan ke @userinfobot'
        );
    }
    
    const newAdminId = parseInt(args[0]);
    
    if (isNaN(newAdminId)) {
        return ctx.reply('❌ ID user harus berupa angka!');
    }
    
    if (admins.includes(newAdminId)) {
        return ctx.reply('ℹ️ User tersebut sudah menjadi admin.');
    }
    
    // Hapus dari premium jika ada
    if (premiumUsers.includes(newAdminId)) {
        premiumUsers = premiumUsers.filter(id => id !== newAdminId);
        savePremium();
    }
    
    admins.push(newAdminId);
    saveAdmins();
    
    ctx.reply(`✅ Berhasil menambahkan admin baru dengan ID: ${newAdminId}`);
});

// Command /addprem - Hanya untuk admin
bot.command('addprem', (ctx) => {
    const userId = ctx.from.id;
    
    // Cek apakah user adalah admin
    if (!isAdmin(userId)) {
        return ctx.reply('❌ Perintah ini hanya untuk admin!');
    }
    
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
        return ctx.reply(
            '📖 Cara menggunakan /addprem:\n\n' +
            '/addprem [ID_USER]\n\n' +
            'Contoh: /addprem 123456789\n\n' +
            'ID user bisa didapatkan dengan meminta user tersebut mengirim pesan ke @userinfobot'
        );
    }
    
    const newPremiumId = parseInt(args[0]);
    
    if (isNaN(newPremiumId)) {
        return ctx.reply('❌ ID user harus berupa angka!');
    }
    
    if (admins.includes(newPremiumId)) {
        return ctx.reply('ℹ️ User tersebut adalah admin. Admin memiliki semua akses premium.');
    }
    
    if (premiumUsers.includes(newPremiumId)) {
        return ctx.reply('ℹ️ User tersebut sudah menjadi premium user.');
    }
    
    premiumUsers.push(newPremiumId);
    savePremium();
    
    ctx.reply(`✅ Berhasil menambahkan premium user baru dengan ID: ${newPremiumId}`);
});

// Command /listadmin - Hanya untuk admin
bot.command('listadmin', (ctx) => {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        return ctx.reply('❌ Perintah ini hanya untuk admin!');
    }
    
    if (admins.length === 0) {
        return ctx.reply('📭 Tidak ada admin yang terdaftar.');
    }
    
    let message = '👥 *Daftar Admin:*\n\n';
    admins.forEach((adminId, index) => {
        message += `${index + 1}. ${adminId}\n`;
    });
    
    ctx.replyWithMarkdown(message);
});

// Command /listprem - Hanya untuk admin
bot.command('listprem', (ctx) => {
    const userId = ctx.from.id;
    
    if (!isAdmin(userId)) {
        return ctx.reply('❌ Perintah ini hanya untuk admin!');
    }
    
    if (premiumUsers.length === 0) {
        return ctx.reply('📭 Tidak ada premium user yang terdaftar.');
    }
    
    let message = '⭐ *Daftar Premium User:*\n\n';
    premiumUsers.forEach((premId, index) => {
        message += `${index + 1}. ${premId}\n`;
    });
    
    ctx.replyWithMarkdown(message);
});

// Handle text messages
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    
    // Skip jika pesan adalah command
    if (text.startsWith('/')) return;
    
    // Ambil session
    const session = userSessions.get(userId) || {};
    
    if (session.waitingFor === 'group_list') {
        // Simpan list grup
        session.groupList = text;
        session.waitingFor = 'unban_message';
        userSessions.set(userId, session);
        
        ctx.reply('📝 List grup diterima. Sekarang kirim pesan yang ingin dikirim ke WhatsApp support untuk tinjauan:');
        
    } else if (session.waitingFor === 'unban_message') {
        const sock = waConnections.get(userId);
        
        if (!sock) {
            userSessions.delete(userId);
            return ctx.reply('❌ Koneksi WhatsApp terputus. Silakan /connect lagi.');
        }
        
        try {
            // Kirim HANYA pesan tinjau ke WhatsApp support
            await sock.sendMessage(WHATSAPP_SUPPORT, { 
                text: text  // Hanya kirim teks tinjau yang diinput user
            });
            
            // Konfirmasi ke user dengan menampilkan apa yang dikirim
            ctx.reply(
                '✅ Pesan berhasil dikirim ke WhatsApp support untuk ditinjau!\n\n' +
                '📋 Grup yang diminta untuk di-unban:\n' +
                `${session.groupList}\n\n` +
                '📨 Pesan yang dikirim ke support:\n' +
                `"${text}"\n\n` +
                '⏱️ Biasanya proses tinjauan memakan waktu 24-48 jam.'
            );
            
            // Reset session
            userSessions.delete(userId);
            
        } catch (error) {
            console.error('Error sending message:', error);
            
            let errorMessage = '❌ Gagal mengirim pesan. ';
            
            // Handle specific errors
            if (error.message.includes('not authorized')) {
                errorMessage += 'WhatsApp belum terverifikasi atau nomor support tidak valid.';
            } else if (error.message.includes('Connection')) {
                errorMessage += 'Koneksi WhatsApp terputus. Silakan /connect lagi.';
            } else {
                errorMessage += 'Error: ' + error.message;
            }
            
            ctx.reply(errorMessage);
            userSessions.delete(userId);
        }
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    try {
        ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    } catch (e) {
        console.error('Error sending error message:', e);
    }
});

// Launch bot
console.log('🚀 Starting WhatsApp Manager Bot v2.0...');
console.log('💻 Mode: Desktop/MacBook/iOS');
console.log('📁 Session Directory: hiyaok_sessions');

bot.launch({
    dropPendingUpdates: true
}).then(() => {
    console.log('✅ Bot started successfully!');
    console.log('📱 Bot is running...');
    console.log('👥 Initial admins:', admins);
    console.log('⭐ Premium users:', premiumUsers);
}).catch((err) => {
    console.error('Failed to start bot:', err);
    process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => {
    console.log('Stopping bot...');
    bot.stop('SIGINT');
    
    // Cleanup all connections
    waConnections.forEach((sock, userId) => {
        try {
            sock.end();
        } catch (e) {}
    });
    
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('Stopping bot...');
    bot.stop('SIGTERM');
    
    // Cleanup all connections
    waConnections.forEach((sock, userId) => {
        try {
            sock.end();
        } catch (e) {}
    });
    
    process.exit(0);
});
