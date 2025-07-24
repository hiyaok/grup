const { Telegraf, Markup } = require('telegraf');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const crypto = require('crypto'); 
//
global.crypto = crypto;

// Konfigurasi
const BOT_TOKEN = '8081458964:AAG_FR3DwQEFbU3KJA5R8oI8rnM6fjK3VV0'; // Ganti dengan token bot Telegram Anda
const WHATSAPP_SUPPORT = '15517868423@s.whatsapp.net'; // WhatsApp support number
const ADMINS_FILE = path.join(__dirname, 'admins.json');
const PREMIUM_FILE = path.join(__dirname, 'premium.json');
const SESSION_DIR = path.join(__dirname, 'wa_sessions');

// Inisialisasi bot Telegram
const bot = new Telegraf(BOT_TOKEN);

// Storage untuk koneksi WhatsApp per user
const waConnections = new Map();
const connectingUsers = new Set();
const userSessions = new Map();

// Pastikan direktori session ada
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Load admins dari file
let admins = [];
if (fs.existsSync(ADMINS_FILE)) {
    admins = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
} else {
    // Admin pertama (ganti dengan ID Telegram Anda)
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
                  '/logout - Putuskan koneksi WhatsApp\n' +
                  '/unban - Kirim permintaan unban grup\n' +
                  '/namagrup - Lihat daftar nama grup WhatsApp\n';
    
    // Tambah command admin jika user adalah admin
    if (isAdmin(userId)) {
        commands += '\n📛 *Command Admin:*\n' +
                   '/addadmin - Tambah admin baru\n' +
                   '/addprem - Tambah premium user\n';
    }
    
    commands += '\nGunakan /connect untuk memulai.';
    
    ctx.reply(commands, { parse_mode: 'Markdown' });
});

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
    
    try {
        // Buat direktori session jika belum ada
        const userSessionDir = path.join(SESSION_DIR, userId.toString());
        if (!fs.existsSync(userSessionDir)) {
            fs.mkdirSync(userSessionDir, { recursive: true });
        }
        
        // Setup auth state
        const { state, saveCreds } = await useMultiFileAuthState(userSessionDir);
        
        // Buat koneksi WhatsApp dengan konfigurasi yang lebih stabil
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['WhatsApp Manager Bot', 'Chrome', '3.0'],
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false
        });
        
        // Variable untuk menyimpan message ID QR
        let qrMessageId = null;
        let qrTimeout = null;
        
        // Handle connection update
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                // Clear timeout lama
                if (qrTimeout) {
                    clearTimeout(qrTimeout);
                }
                
                // Generate QR code image
                try {
                    const qrBuffer = await qrcode.toBuffer(qr, { 
                        width: 300,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });
                    
                    // Kirim atau update QR code
                    if (qrMessageId) {
                        // Update QR yang sudah ada
                        try {
                            await ctx.telegram.editMessageMedia(
                                ctx.chat.id,
                                qrMessageId,
                                null,
                                {
                                    type: 'photo',
                                    media: { source: qrBuffer },
                                    caption: '📱 Scan QR code ini dengan WhatsApp Anda:\n\n' +
                                            '1. Buka WhatsApp di HP\n' +
                                            '2. Ketuk Menu > Perangkat tertaut\n' +
                                            '3. Ketuk "Tautkan perangkat"\n' +
                                            '4. Scan QR code ini\n\n' +
                                            '⏱️ QR akan expired dalam 60 detik'
                                },
                                Markup.inlineKeyboard([
                                    [Markup.button.callback('❌ Batal', `cancel_${userId}`)]
                                ])
                            );
                        } catch (e) {
                            // Jika gagal edit, kirim yang baru
                            const message = await ctx.replyWithPhoto(
                                { source: qrBuffer },
                                {
                                    caption: '📱 Scan QR code ini dengan WhatsApp Anda:\n\n' +
                                            '1. Buka WhatsApp di HP\n' +
                                            '2. Ketuk Menu > Perangkat tertaut\n' +
                                            '3. Ketuk "Tautkan perangkat"\n' +
                                            '4. Scan QR code ini\n\n' +
                                            '⏱️ QR akan expired dalam 60 detik',
                                    ...Markup.inlineKeyboard([
                                        [Markup.button.callback('❌ Batal', `cancel_${userId}`)]
                                    ])
                                }
                            );
                            qrMessageId = message.message_id;
                        }
                    } else {
                        const message = await ctx.replyWithPhoto(
                            { source: qrBuffer },
                            {
                                caption: '📱 Scan QR code ini dengan WhatsApp Anda:\n\n' +
                                        '1. Buka WhatsApp di HP\n' +
                                        '2. Ketuk Menu > Perangkat tertaut\n' +
                                        '3. Ketuk "Tautkan perangkat"\n' +
                                        '4. Scan QR code ini\n\n' +
                                        '⏱️ QR akan expired dalam 60 detik',
                                ...Markup.inlineKeyboard([
                                    [Markup.button.callback('❌ Batal', `cancel_${userId}`)]
                                ])
                            }
                        );
                        qrMessageId = message.message_id;
                    }
                    
                    // Set timeout untuk QR expired
                    qrTimeout = setTimeout(() => {
                        if (connectingUsers.has(userId)) {
                            connectingUsers.delete(userId);
                            sock.end();
                            ctx.reply('⏱️ QR code expired. Silakan gunakan /connect lagi untuk mendapatkan QR baru.');
                            
                            if (qrMessageId) {
                                try {
                                    ctx.deleteMessage(qrMessageId);
                                } catch (e) {}
                            }
                        }
                    }, 60000); // 60 detik
                } catch (error) {
                    console.error('Error generating QR:', error);
                    ctx.reply('❌ Gagal generate QR code. Silakan coba lagi.');
                }
            }
            
            if (connection === 'close') {
                // Clear timeout
                if (qrTimeout) {
                    clearTimeout(qrTimeout);
                }
                
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect && !connectingUsers.has(userId)) {
                    // Jika bukan logout dan bukan sedang connecting, coba reconnect
                    console.log('Connection closed, attempting to reconnect...');
                    setTimeout(() => {
                        if (!waConnections.has(userId) && !connectingUsers.has(userId)) {
                            ctx.reply('🔄 Koneksi terputus. Gunakan /connect untuk menghubungkan kembali.');
                        }
                    }, 3000);
                }
                
                connectingUsers.delete(userId);
                waConnections.delete(userId);
                
                // Hapus QR message jika ada
                if (qrMessageId) {
                    try {
                        await ctx.deleteMessage(qrMessageId);
                    } catch (e) {}
                }
            } else if (connection === 'open') {
                // Clear timeout
                if (qrTimeout) {
                    clearTimeout(qrTimeout);
                }
                
                // Koneksi berhasil
                waConnections.set(userId, sock);
                connectingUsers.delete(userId);
                
                // Hapus QR message
                if (qrMessageId) {
                    try {
                        await ctx.deleteMessage(qrMessageId);
                    } catch (e) {}
                }
                
                // Dapatkan info user
                try {
                    const user = sock.user;
                    ctx.reply(
                        '✅ Berhasil terhubung dengan WhatsApp!\n\n' +
                        `📱 Nomor: ${user.id.split(':')[0]}\n` +
                        `👤 Nama: ${user.name || 'Tidak diketahui'}\n\n` +
                        'Gunakan /namagrup untuk melihat daftar grup.'
                    );
                } catch (e) {
                    ctx.reply('✅ Berhasil terhubung dengan WhatsApp!');
                }
            }
        });
        
        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);
        
        // Handle messages (untuk debugging)
        sock.ev.on('messages.upsert', async (m) => {
            console.log('Received message:', JSON.stringify(m, undefined, 2));
        });
        
    } catch (error) {
        console.error('Error connecting:', error);
        connectingUsers.delete(userId);
        ctx.reply('❌ Terjadi kesalahan saat menghubungkan dengan WhatsApp. Error: ' + error.message);
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
    
    // Batalkan koneksi
    connectingUsers.delete(userId);
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
        
        // Hapus session files
        const userSessionDir = path.join(SESSION_DIR, userId.toString());
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
        
        // Dapatkan semua chat
        const chats = await sock.groupFetchAllParticipating();
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
            // Kirim HANYA pesan tinjauan dari user ke WhatsApp support
            await sock.sendMessage(WHATSAPP_SUPPORT, { 
                text: text 
            });
            
            ctx.reply(
                '✅ Pesan berhasil dikirim ke WhatsApp support untuk ditinjau!\n\n' +
                '📋 Grup yang diminta untuk di-unban:\n' +
                `${session.groupList}\n\n` +
                'Status: Menunggu tinjauan'
            );
            
            // Reset session
            userSessions.delete(userId);
            
        } catch (error) {
            console.error('Error sending message:', error);
            ctx.reply('❌ Gagal mengirim pesan. Error: ' + error.message);
            userSessions.delete(userId);
        }
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi.\nError: ' + err.message);
});

// Launch bot
bot.launch({
    dropPendingUpdates: true
}).then(() => {
    console.log('✅ Bot started successfully!');
    console.log('📱 Bot username: @your_bot_username');
    console.log('👥 Initial admins:', admins);
    console.log('⭐ Premium users:', premiumUsers);
}).catch((err) => {
    console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
