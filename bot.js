const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// GANTI ID ADMIN UTAMA DI SINI
const MAIN_ADMIN_ID = 5406507431; // Ganti dengan ID Telegram Anda

// Konfigurasi Bot
const TOKEN = '7508883526:AAEqe2f48tCzwtlCjbUyEBJMzTDg7J6jPME'; // Ganti dengan token bot Anda
const bot = new TelegramBot(TOKEN, { polling: true });

// Database sederhana menggunakan file JSON
const DATA_DIR = './bot_data';
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Inisialisasi database
async function initDatabase() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        
        // Cek file groups
        try {
            await fs.access(GROUPS_FILE);
        } catch {
            await fs.writeFile(GROUPS_FILE, JSON.stringify([], null, 2));
        }
        
        // Cek file admins
        try {
            await fs.access(ADMINS_FILE);
        } catch {
            await fs.writeFile(ADMINS_FILE, JSON.stringify({
                mainAdmin: MAIN_ADMIN_ID,
                admins: []
            }, null, 2));
        }
        
        // Cek file settings
        try {
            await fs.access(SETTINGS_FILE);
        } catch {
            await fs.writeFile(SETTINGS_FILE, JSON.stringify({
                protectionEnabled: true
            }, null, 2));
        }
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Helper functions untuk database
async function getGroups() {
    const data = await fs.readFile(GROUPS_FILE, 'utf8');
    return JSON.parse(data);
}

async function saveGroups(groups) {
    await fs.writeFile(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

async function getAdmins() {
    const data = await fs.readFile(ADMINS_FILE, 'utf8');
    return JSON.parse(data);
}

async function saveAdmins(admins) {
    await fs.writeFile(ADMINS_FILE, JSON.stringify(admins, null, 2));
}

async function getSettings() {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(data);
}

async function saveSettings(settings) {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Fungsi untuk menampilkan main menu
function getMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '➕ Tambah Grup', callback_data: 'add_group' },
                { text: '➖ Hapus Grup', callback_data: 'remove_group' }
            ],
            [
                { text: '📋 List Grup', callback_data: 'list_groups' },
                { text: '🆔 Cek ID', callback_data: 'check_id' }
            ],
            [
                { text: '👤 Add Admin', callback_data: 'add_admin' },
                { text: '📄 List Admin', callback_data: 'list_admins' }
            ],
            [
                { text: '❌ Remove Admin', callback_data: 'remove_admin' },
                { text: '🛡 On/Off Proteksi', callback_data: 'toggle_protection' }
            ]
        ]
    };
}

// Fungsi untuk keyboard kembali
function getBackKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'back_to_main' }]
        ]
    };
}

// Pattern detector untuk bahasa Indonesia - DIPERBANYAK
const riskyPatterns = [
    // Kata kasar umum
    /\b(anjing|bangsat|tolol|kontol|memek|ngentot|babi|asu|jancok|taek|kampret|bajingan|brengsek|keparat|tai|tahi|pantek|pukimak|jembut|bego|goblok|idiot|dungu|sinting|gila|edan|kntl|mmk|bgst|ajg|njir|njing|njer)\b/i,
    
    // Kata kasar daerah
    /\b(cuki|cukimai|lonte|jablay|perek|bispak|ayam|jancuk|cuk|matamu|cocot|bacot|pepek|peler|tempik|tempe|tetek|toket|itil|kimak|dancok|mbokne|ndasmu|raimu)\b/i,
    
    // Investasi bodong & money game
    /\b(profit\s*(100|200|300|400|500|1000)%|jamin\s*untung|modal\s*kecil.*hasil\s*besar|bisnis\s*tanpa\s*resiko|income\s*jutaan|passive\s*income.*mudah|cuan\s*cepat|auto\s*cuan|guaranteed\s*profit|forex\s*autopilot|robot\s*trading.*profit|mining.*passive|staking.*guaranteed|yield.*tinggi|apy.*fantastis|money\s*game|skema\s*ponzi|mlm.*cepat\s*kaya)\b/i,
    
    // Trading & investasi scam
    /\b(signal\s*trading.*akurat|bot\s*trading.*profit|copy\s*trade.*untung|mentor\s*trading.*jamin|kursus\s*trading.*cepat\s*kaya|webinar.*langsung\s*profit|binary\s*option|olymp\s*trade|binomo|quotex|iq\s*option|expert\s*option)\b/i,
    
    // Penipuan umum
    /\b(transfer\s*dulu|kirim\s*uang.*dapat\s*hadiah|menang\s*undian|klik\s*link.*hadiah|wa\s*admin.*hadiah|anda\s*terpilih|selamat\s*anda\s*menang|claim\s*hadiah|voucher\s*gratis.*transfer|pulsa\s*gratis.*kirim|saldo\s*gratis)\b/i,
    
    // Judi online
    /\b(slot\s*gacor|slot\s*online|maxwin|jackpot|scatter|pragmatic|pg\s*soft|habanero|microgaming|situs\s*judi|agen\s*judi|bandar\s*judi|togel|toto|bola\s*online|poker\s*online|casino\s*online|live\s*casino|sabung\s*ayam|cock\s*fight|gaple|domino\s*qq|pkv|dewa\s*poker|raja\s*poker)\b/i,
    
    // Spam promosi
    /\b(open\s*(bo|slot)|daftar\s*sekarang.*bonus|promo\s*hari\s*ini|buruan\s*join|link\s*grup|gabung\s*channel|follow\s*ig|subscribe|like\s*dan\s*share|klik\s*disini|daftar\s*disini|join\s*now|limited\s*offer|flash\s*sale.*slot)\b/i,
    
    // Phishing & scam link
    /\b(verifikasi\s*akun.*klik|update\s*data.*link|konfirmasi\s*password|kadaluarsa.*verifikasi|suspended.*klik|blokir.*verifikasi|claim.*linktr|bit\.ly.*hadiah|shortlink.*duit|tinyurl.*bonus)\b/i,
    
    // Crypto scam
    /\b(airdrop\s*legit|presale.*100x|gem\s*crypto|pump\s*coin|dump\s*coin|rug\s*pull|honeypot|scam\s*coin|shit\s*coin|fake\s*token|free\s*crypto.*claim|giveaway\s*btc|giveaway\s*eth|double\s*bitcoin|bitcoin\s*generator|crypto\s*gratis)\b/i,
    
    // Pinjaman ilegal
    /\b(pinjol|pinjaman\s*online.*cepat|dana\s*cepat|kredit\s*tanpa\s*agunan|pinjaman\s*5\s*menit|ktp\s*langsung\s*cair|tenor.*bunga\s*rendah|dc\s*lapangan|debt\s*collector|tagih\s*hutang|sita\s*aset)\b/i,
    
    // Adult content
    /\b(bokep|porn|hentai|jav|sex|ngentod|ngewe|mesum|telanjang|bugil|nude|toge|memek|kontol|coli|paha\s*mulus|bodi\s*seksi|vcs|video\s*call\s*sex|open\s*vcs|jual\s*video|konten\s*dewasa)\b/i,
    
    // Obat & produk ilegal
    /\b(obat\s*kuat|viagra|cialis|levitra|obat\s*aborsi|cytotec|jual\s*ganja|jual\s*sabu|narkoba|ekstasi|inex|pil\s*koplo|dumolid|tramadol|obat\s*tidur|obat\s*penenang)\b/i,
    
    // Penipuan marketplace
    /\b(cod\s*fiktif|orderan\s*fiktif|joki\s*rating|jasa\s*review|beli\s*rating|jual\s*akun.*verified|akun\s*clone|akun\s*bajakan|hack\s*akun|jual\s*data|database\s*bocor|kartu\s*kredit.*jual)\b/i,
    
    // Provokasi & SARA
    /\b(kafir|sesat|bid\'ah|syiah|wahabi|liberal|antek\s*aseng|aseng|cina\s*babi|pribumi.*asli|anti\s*islam|anti\s*kristen|kristenisasi|islamisasi|jihad|khilafah|radikal|teroris|bom\s*bunuh\s*diri|sweeping|bakar\s*gereja|bakar\s*masjid)\b/i,
    
    // Hoax & misinformasi
    /\b(sebarkan\s*ke.*grup|forward\s*ke.*kontak|viralkan|wajib\s*share|harus\s*disebarkan|copas\s*share|broadcast\s*ini|pesan\s*berantai|chain\s*message|kalau\s*tidak.*sial|tidak\s*forward.*celaka)\b/i,
    
    // Social engineering
    /\b(minta\s*otp|kode\s*otp|verifikasi\s*otp|6\s*digit\s*kode|pin\s*atm|password\s*bank|sandi\s*akun|data\s*pribadi|nomor\s*kk|foto\s*ktp|selfie\s*ktp|data\s*keluarga)\b/i,
    
    // Spam mention
    /@everyone|@all|@here|@admin/i,
    
    // Link shortener mencurigakan
    /\b(bit\.ly|tinyurl|short\.link|t\.me\/[a-zA-Z0-9_]{5,}|linktr\.ee|rebrand\.ly|ow\.ly|goo\.gl|adf\.ly|bc\.vc|ouo\.io|za\.gl|linkshrink|shorte\.st|adfoc\.us)\b/i,
    
    // Nomor WA & kontak mencurigakan
    /(\+62|62|0)[0-9]{9,13}.*(wa|whatsapp|kontak|hubungi|chat)/i,
    
    // Ancaman & intimidasi
    /\b(bunuh\s*kamu|mati\s*kau|gue\s*hajar|lu\s*tunggu|awas\s*lu|bacok|tikam|cekik|gantung\s*diri|potong\s*leher|mutilasi|bakar\s*hidup|kubur\s*hidup|santet|guna-guna|pelet|dukun)\b/i
];

// Cache untuk tracking
const messageCache = new Map();
const userRateLimit = new Map();
const imageHashes = new Map();
const forwardCache = new Map();
let lockdownGroups = new Set();

// Storage untuk pending operations
const pendingOperations = new Map();

// Fungsi untuk hash gambar
function hashImage(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Fungsi untuk cek pattern berbahaya
function containsRiskyContent(text) {
    if (!text) return false;
    return riskyPatterns.some(pattern => pattern.test(text));
}

// Fungsi untuk cek rate limit
function checkRateLimit(userId) {
    const now = Date.now();
    const userLimits = userRateLimit.get(userId) || [];
    
    // Filter pesan dalam 1 menit terakhir
    const recentMessages = userLimits.filter(time => now - time < 60000);
    
    if (recentMessages.length >= 10) {
        return false; // Rate limit exceeded
    }
    
    recentMessages.push(now);
    userRateLimit.set(userId, recentMessages);
    return true;
}

// Fungsi untuk cek duplikat pesan
function checkDuplicateMessage(chatId, userId, text) {
    const key = `${chatId}-${userId}`;
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    
    const cached = messageCache.get(key);
    if (cached && cached.text === text && cached.minute === minute) {
        return true; // Duplikat
    }
    
    messageCache.set(key, { text, minute });
    return false;
}

// Fungsi untuk cek duplikat gambar
async function checkDuplicateImage(chatId, imageBuffer) {
    const hash = hashImage(imageBuffer);
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `${chatId}-${minute}`;
    
    const cached = imageHashes.get(key) || new Set();
    if (cached.has(hash)) {
        return true; // Duplikat
    }
    
    cached.add(hash);
    imageHashes.set(key, cached);
    
    // Cleanup cache lama
    setTimeout(() => {
        imageHashes.delete(key);
    }, 120000); // Hapus setelah 2 menit
    
    return false;
}

// Fungsi untuk cek lockdown
function checkLockdown(chatId) {
    const key = `lockdown-${chatId}`;
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    
    const messages = messageCache.get(key) || [];
    const recentMessages = messages.filter(time => Math.floor(time / 60000) === minute);
    
    if (recentMessages.length >= 100 && !lockdownGroups.has(chatId)) {
        lockdownGroups.add(chatId);
        setTimeout(() => {
            lockdownGroups.delete(chatId);
        }, 300000); // 5 menit lockdown
        return true;
    }
    
    messages.push(now);
    messageCache.set(key, messages);
    
    // Cleanup
    if (messages.length > 200) {
        messageCache.set(key, messages.slice(-100));
    }
    
    return false;
}

// Fungsi pembersihan otomatis
async function autoCleanup() {
    const now = Date.now();
    
    // Cleanup message cache
    for (const [key, value] of messageCache.entries()) {
        if (Array.isArray(value)) {
            const filtered = value.filter(time => now - time < 120000);
            if (filtered.length === 0) {
                messageCache.delete(key);
            } else {
                messageCache.set(key, filtered);
            }
        } else if (value.minute && Math.floor(now / 60000) - value.minute > 2) {
            messageCache.delete(key);
        }
    }
    
    // Cleanup rate limit
    for (const [userId, times] of userRateLimit.entries()) {
        const filtered = times.filter(time => now - time < 60000);
        if (filtered.length === 0) {
            userRateLimit.delete(userId);
        } else {
            userRateLimit.set(userId, filtered);
        }
    }
    
    // Cleanup pending operations
    for (const [userId, data] of pendingOperations.entries()) {
        if (now - data.timestamp > 300000) { // 5 menit
            pendingOperations.delete(userId);
        }
    }
}

// Auto cleanup setiap 5 menit
setInterval(autoCleanup, 300000);

// Fungsi untuk cek apakah user adalah admin bot
async function isBotAdmin(userId) {
    const admins = await getAdmins();
    return userId === admins.mainAdmin || admins.admins.includes(userId);
}

// Fungsi untuk mendapatkan username atau nama user
async function getUserInfo(userId) {
    try {
        const userInfo = await bot.getChat(userId);
        return {
            name: userInfo.first_name + (userInfo.last_name ? ` ${userInfo.last_name}` : ''),
            username: userInfo.username ? `@${userInfo.username}` : null
        };
    } catch (error) {
        return {
            name: 'Unknown User',
            username: null
        };
    }
}

// Handler untuk pesan
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const settings = await getSettings();
        
        // Cek pending operation
        const pending = pendingOperations.get(userId);
        if (pending && msg.chat.type === 'private') {
            await handlePendingOperation(userId, msg, pending);
            return;
        }
        
        // Skip jika proteksi tidak aktif
        if (!settings.protectionEnabled) return;
        
        // Skip untuk chat private atau channel
        if (msg.chat.type === 'private' || msg.chat.type === 'channel') return;
        
        // Cek apakah grup terdaftar
        const groups = await getGroups();
        if (!groups.includes(chatId.toString())) return;
        
        // Skip untuk admin grup
        const member = await bot.getChatMember(chatId, userId);
        if (['creator', 'administrator'].includes(member.status)) return;
        
        // Cek lockdown
        if (lockdownGroups.has(chatId)) {
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            return;
        }
        
        // Trigger lockdown jika perlu
        if (checkLockdown(chatId)) {
            await bot.sendMessage(chatId, 
                '🚨 <b>MODE LOCKDOWN AKTIF!</b>\n\n' +
                'Grup terlalu ramai (>100 pesan/menit).\n' +
                'Semua pesan akan dihapus selama 5 menit.\n\n' +
                '⏱ Lockdown akan berakhir dalam 5 menit.',
                { parse_mode: 'HTML' }
            );
        }
        
        // Cek rate limit
        if (!checkRateLimit(userId)) {
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            return;
        }
        
        // Cek teks pesan
        if (msg.text) {
            // Cek pattern berbahaya
            if (containsRiskyContent(msg.text)) {
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                return;
            }
            
            // Cek duplikat
            if (checkDuplicateMessage(chatId, userId, msg.text)) {
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                return;
            }
        }
        
        // Cek forward
        if (msg.forward_from || msg.forward_from_chat) {
            const forwardText = msg.text || msg.caption || '';
            if (containsRiskyContent(forwardText)) {
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                return;
            }
        }
        
        // Cek gambar
        if (msg.photo) {
            try {
                const fileId = msg.photo[msg.photo.length - 1].file_id;
                const file = await bot.getFile(fileId);
                const buffer = await bot.downloadFile(file.file_path);
                
                if (await checkDuplicateImage(chatId, buffer)) {
                    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                    return;
                }
                
                // Cek caption gambar
                if (msg.caption && containsRiskyContent(msg.caption)) {
                    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                    return;
                }
            } catch (error) {
                console.error('Error processing image:', error);
            }
        }
        
        // Cek caption video, document, dll
        if (msg.caption && containsRiskyContent(msg.caption)) {
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            return;
        }
        
    } catch (error) {
        console.error('Error in message handler:', error);
    }
});

// Handler untuk pending operations
async function handlePendingOperation(userId, msg, pending) {
    const chatId = msg.chat.id;
    
    if (msg.text === '/cancel') {
        pendingOperations.delete(userId);
        await bot.sendMessage(chatId, '❌ Operasi dibatalkan.', {
            reply_markup: getBackKeyboard()
        });
        return;
    }
    
    switch (pending.type) {
        case 'add_group':
            const groupIds = msg.text.split('\n').map(id => id.trim()).filter(id => id);
            const groups = await getGroups();
            let added = 0;
            
            for (const groupId of groupIds) {
                if (!groups.includes(groupId)) {
                    groups.push(groupId);
                    added++;
                }
            }
            
            await saveGroups(groups);
            await bot.sendMessage(chatId, 
                `✅ Berhasil menambahkan ${added} grup baru.`,
                { 
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            break;
            
        case 'remove_group':
            const groupId = msg.text.trim();
            let groupsList = await getGroups();
            const index = groupsList.indexOf(groupId);
            
            if (index > -1) {
                groupsList.splice(index, 1);
                await saveGroups(groupsList);
                await bot.sendMessage(chatId, '✅ Grup berhasil dihapus.', {
                    reply_markup: getBackKeyboard()
                });
            } else {
                await bot.sendMessage(chatId, '❌ Grup tidak ditemukan.', {
                    reply_markup: getBackKeyboard()
                });
            }
            break;
            
        case 'add_admin':
            const newAdminId = parseInt(msg.text.trim());
            if (isNaN(newAdminId)) {
                await bot.sendMessage(chatId, '❌ ID tidak valid. Masukkan ID berupa angka.', {
                    reply_markup: getBackKeyboard()
                });
                break;
            }
            
            const adminData = await getAdmins();
            
            if (newAdminId === adminData.mainAdmin) {
                await bot.sendMessage(chatId, '❌ User tersebut adalah admin utama.', {
                    reply_markup: getBackKeyboard()
                });
            } else if (!adminData.admins.includes(newAdminId)) {
                adminData.admins.push(newAdminId);
                await saveAdmins(adminData);
                
                // Dapatkan info user
                const userInfo = await getUserInfo(newAdminId);
                await bot.sendMessage(chatId, 
                    `✅ Admin baru berhasil ditambahkan!\n\n` +
                    `👤 Nama: ${userInfo.name}\n` +
                    `🆔 ID: <code>${newAdminId}</code>` +
                    (userInfo.username ? `\n📱 Username: ${userInfo.username}` : ''),
                    { 
                        parse_mode: 'HTML',
                        reply_markup: getBackKeyboard()
                    }
                );
            } else {
                await bot.sendMessage(chatId, '❌ User sudah menjadi admin.', {
                    reply_markup: getBackKeyboard()
                });
            }
            break;
            
        case 'remove_admin':
            const removeAdminId = parseInt(msg.text.trim());
            if (isNaN(removeAdminId)) {
                await bot.sendMessage(chatId, '❌ ID tidak valid. Masukkan ID berupa angka.', {
                    reply_markup: getBackKeyboard()
                });
                break;
            }
            
            const adminsData = await getAdmins();
            
            if (removeAdminId === adminsData.mainAdmin) {
                await bot.sendMessage(chatId, '❌ Tidak dapat menghapus admin utama.', {
                    reply_markup: getBackKeyboard()
                });
            } else {
                const adminIndex = adminsData.admins.indexOf(removeAdminId);
                if (adminIndex > -1) {
                    adminsData.admins.splice(adminIndex, 1);
                    await saveAdmins(adminsData);
                    
                    // Dapatkan info user
                    const userInfo = await getUserInfo(removeAdminId);
                    await bot.sendMessage(chatId, 
                        `✅ Admin berhasil dihapus!\n\n` +
                        `👤 Nama: ${userInfo.name}\n` +
                        `🆔 ID: <code>${removeAdminId}</code>` +
                        (userInfo.username ? `\n📱 Username: ${userInfo.username}` : ''),
                        { 
                            parse_mode: 'HTML',
                            reply_markup: getBackKeyboard()
                        }
                    );
                } else {
                    await bot.sendMessage(chatId, '❌ User bukan admin.', {
                        reply_markup: getBackKeyboard()
                    });
                }
            }
            break;
    }
    
    pendingOperations.delete(userId);
}

// Handler untuk bot ditambahkan ke grup
bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    const newMembers = msg.new_chat_members;
    
    for (const member of newMembers) {
        if (member.id === bot.me.id) {
            // Bot ditambahkan ke grup
            const groups = await getGroups();
            
            if (!groups.includes(chatId.toString())) {
                // Grup tidak terdaftar
                await bot.sendMessage(chatId,
                    '❌ <b>Grup Tidak Terdaftar!</b>\n\n' +
                    'Grup ini tidak terdaftar dalam sistem.\n' +
                    'Silakan hubungi admin bot untuk mendaftarkan grup.\n\n' +
                    '⏱ Bot akan keluar dalam 10 detik...',
                    { parse_mode: 'HTML' }
                );
                
                setTimeout(async () => {
                    try {
                        await bot.leaveChat(chatId);
                    } catch (error) {
                        console.error('Error leaving chat:', error);
                    }
                }, 10000);
            } else {
                // Cek apakah bot adalah admin
                try {
                    const botMember = await bot.getChatMember(chatId, bot.me.id);
                    if (botMember.status !== 'administrator' || !botMember.can_delete_messages) {
                        await bot.sendMessage(chatId,
                            '⚠️ <b>Perizinan Admin Diperlukan!</b>\n\n' +
                            'Bot memerlukan hak admin dengan perizinan:\n' +
                            '• Hapus pesan\n' +
                            '• Kelola grup\n' +
                            '• Lihat pesan\n\n' +
                            'Silakan berikan hak admin penuh agar bot dapat berfungsi dengan baik.',
                            { parse_mode: 'HTML' }
                        );
                    } else {
                        await bot.sendMessage(chatId,
                            '✅ <b>Bot Berhasil Ditambahkan!</b>\n\n' +
                            '🛡 Proteksi grup aktif dengan fitur:\n' +
                            '• Deteksi konten berbahaya\n' +
                            '• Rate limiting (10 pesan/menit)\n' +
                            '• Filter duplikat\n' +
                            '• Mode lockdown otomatis\n' +
                            '• Dan fitur keamanan lainnya\n\n' +
                            'Grup Anda sekarang terlindungi! 🔒',
                            { parse_mode: 'HTML' }
                        );
                    }
                } catch (error) {
                    console.error('Error checking bot permissions:', error);
                }
            }
        }
    }
});

// Command /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (msg.chat.type !== 'private') return;
    
    const isAdmin = await isBotAdmin(userId);
    
    if (!isAdmin) {
        await bot.sendMessage(chatId,
            '❌ <b>Akses Ditolak!</b>\n\n' +
            'Anda bukan admin bot.\n' +
            'Hubungi admin utama untuk mendapatkan akses.',
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    await bot.sendMessage(chatId,
        '🤖 <b>Bot Keamanan Grup Premium</b>\n\n' +
        '🛡 Fitur Keamanan:\n' +
        '• Deteksi konten berbahaya AI\n' +
        '• Rate limiting canggih\n' +
        '• Filter duplikat pesan & gambar\n' +
        '• Analisis forward berbahaya\n' +
        '• Mode lockdown otomatis\n' +
        '• Auto-recovery & cleanup\n\n' +
        'Pilih menu di bawah:',
        { 
            parse_mode: 'HTML',
            reply_markup: getMainMenuKeyboard()
        }
    );
});

// Command /id
bot.onText(/\/id/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    let response = '';
    
    if (msg.chat.type === 'private') {
        response = `🆔 <b>ID Anda:</b> <code>${userId}</code>`;
    } else {
        response = `👥 <b>ID Grup:</b> <code>${chatId}</code>\n`;
        response += `🆔 <b>ID Anda:</b> <code>${userId}</code>`;
        
        if (msg.reply_to_message) {
            const repliedUserId = msg.reply_to_message.from.id;
            const repliedUserName = msg.reply_to_message.from.first_name;
            response += `\n\n💬 <b>Reply to:</b>\n`;
            response += `👤 ${repliedUserName}\n`;
            response += `🆔 ID: <code>${repliedUserId}</code>`;
        }
    }
    
    await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
});

// Callback query handler
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    const isAdmin = await isBotAdmin(userId);
    
    if (!isAdmin) {
        await bot.answerCallbackQuery(query.id, '❌ Anda bukan admin bot!');
        return;
    }
    
    switch (data) {
        case 'back_to_main':
            await bot.editMessageText(
                '🤖 <b>Bot Keamanan Grup Premium</b>\n\n' +
                '🛡 Fitur Keamanan:\n' +
                '• Deteksi konten berbahaya AI\n' +
                '• Rate limiting canggih\n' +
                '• Filter duplikat pesan & gambar\n' +
                '• Analisis forward berbahaya\n' +
                '• Mode lockdown otomatis\n' +
                '• Auto-recovery & cleanup\n\n' +
                'Pilih menu di bawah:',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getMainMenuKeyboard()
                }
            );
            break;
            
        case 'add_group':
            await bot.editMessageText(
                '➕ <b>Tambah Grup</b>\n\n' +
                'Kirim ID grup yang ingin ditambahkan.\n' +
                'Format: Satu ID per baris\n\n' +
                'Contoh:\n' +
                '<code>-1001234567890</code>\n' +
                '<code>-1009876543210</code>\n\n' +
                '/cancel untuk membatalkan',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            
            pendingOperations.set(userId, {
                type: 'add_group',
                timestamp: Date.now()
            });
            break;
            
        case 'remove_group':
            await bot.editMessageText(
                '➖ <b>Hapus Grup</b>\n\n' +
                'Kirim ID grup yang ingin dihapus.\n\n' +
                '/cancel untuk membatalkan',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            
            pendingOperations.set(userId, {
                type: 'remove_group',
                timestamp: Date.now()
            });
            break;
            
        case 'list_groups':
            const groups = await getGroups();
            let groupList = '📋 <b>Daftar Grup Terdaftar:</b>\n\n';
            
            if (groups.length === 0) {
                groupList += '<i>Belum ada grup terdaftar</i>';
            } else {
                for (let i = 0; i < groups.length; i++) {
                    groupList += `${i + 1}. <code>${groups[i]}</code>\n`;
                }
                groupList += `\n<b>Total:</b> ${groups.length} grup`;
            }
            
            await bot.editMessageText(groupList, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: getBackKeyboard()
            });
            break;
            
        case 'add_admin':
            const admins = await getAdmins();
            if (userId !== admins.mainAdmin) {
                await bot.answerCallbackQuery(query.id, '❌ Hanya admin utama yang bisa menambah admin!');
                return;
            }
            
            await bot.editMessageText(
                '👤 <b>Tambah Admin</b>\n\n' +
                'Kirim ID user yang ingin dijadikan admin.\n\n' +
                'Contoh: <code>123456789</code>\n\n' +
                '/cancel untuk membatalkan',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            
            pendingOperations.set(userId, {
                type: 'add_admin',
                timestamp: Date.now()
            });
            break;
            
        case 'list_admins':
            const adminsList = await getAdmins();
            let adminText = '📄 <b>Daftar Admin Bot:</b>\n\n';
            
            // Admin utama
            const mainAdminInfo = await getUserInfo(adminsList.mainAdmin);
            adminText += `👑 <b>Admin Utama:</b>\n`;
            adminText += `👤 ${mainAdminInfo.name}\n`;
            adminText += `🆔 <code>${adminsList.mainAdmin}</code>\n`;
            if (mainAdminInfo.username) {
                adminText += `📱 ${mainAdminInfo.username}\n`;
            }
            
            // Admin biasa
            if (adminsList.admins.length > 0) {
                adminText += `\n👥 <b>Admin Lainnya:</b>\n\n`;
                for (let i = 0; i < adminsList.admins.length; i++) {
                    const adminInfo = await getUserInfo(adminsList.admins[i]);
                    adminText += `${i + 1}. ${adminInfo.name}\n`;
                    adminText += `🆔 <code>${adminsList.admins[i]}</code>\n`;
                    if (adminInfo.username) {
                        adminText += `📱 ${adminInfo.username}\n`;
                    }
                    adminText += '\n';
                }
            } else {
                adminText += '\n<i>Tidak ada admin lain</i>';
            }
            
            adminText += `\n<b>Total Admin:</b> ${adminsList.admins.length + 1}`;
            
            await bot.editMessageText(adminText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: getBackKeyboard()
            });
            break;
            
        case 'remove_admin':
            const adminsData = await getAdmins();
            if (userId !== adminsData.mainAdmin) {
                await bot.answerCallbackQuery(query.id, '❌ Hanya admin utama yang bisa menghapus admin!');
                return;
            }
            
            if (adminsData.admins.length === 0) {
                await bot.editMessageText(
                    '❌ <b>Tidak Ada Admin untuk Dihapus</b>\n\n' +
                    'Saat ini tidak ada admin lain selain admin utama.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'HTML',
                        reply_markup: getBackKeyboard()
                    }
                );
                break;
            }
            
            await bot.editMessageText(
                '❌ <b>Hapus Admin</b>\n\n' +
                'Kirim ID admin yang ingin dihapus.\n\n' +
                'Contoh: <code>123456789</code>\n\n' +
                '⚠️ <i>Hanya admin biasa yang bisa dihapus, bukan admin utama.</i>\n\n' +
                '/cancel untuk membatalkan',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            
            pendingOperations.set(userId, {
                type: 'remove_admin',
                timestamp: Date.now()
            });
            break;
            
        case 'toggle_protection':
            const settings = await getSettings();
            settings.protectionEnabled = !settings.protectionEnabled;
            await saveSettings(settings);
            
            await bot.editMessageText(
                `🛡 <b>Status Proteksi:</b> ${settings.protectionEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}\n\n` +
                `Proteksi telah ${settings.protectionEnabled ? 'diaktifkan' : 'dinonaktifkan'} untuk semua grup.\n\n` +
                `${settings.protectionEnabled ? 
                    '🔒 Semua fitur keamanan sekarang aktif dan melindungi grup-grup terdaftar.' : 
                    '🔓 Fitur keamanan dinonaktifkan sementara. Bot tidak akan memproses pesan grup.'}`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            break;
            
        case 'check_id':
            await bot.editMessageText(
                '🆔 <b>Cek ID</b>\n\n' +
                'Gunakan perintah /id di:\n' +
                '• Chat pribadi untuk melihat ID Anda\n' +
                '• Grup untuk melihat ID grup\n' +
                '• Reply pesan user untuk melihat ID mereka\n\n' +
                '💡 <b>Tips:</b>\n' +
                '• ID grup biasanya dimulai dengan -100\n' +
                '• ID user adalah angka positif\n' +
                '• Salin ID dengan tap & hold pada kode',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: getBackKeyboard()
                }
            );
            break;
    }
    
    await bot.answerCallbackQuery(query.id);
});

// Error handler
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Inisialisasi bot
(async () => {
    await initDatabase();
    console.log('Bot started successfully!');
    console.log(`Main Admin ID: ${MAIN_ADMIN_ID}`);
    
    // Dapatkan info bot
    bot.getMe().then(me => {
        bot.me = me;
        console.log(`Bot username: @${me.username}`);
    });
})();
