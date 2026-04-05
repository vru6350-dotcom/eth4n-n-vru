process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
process.on('uncaughtException',  e => console.error('Uncaught exception:', e));
process.on('SIGTERM', async () => { console.log('SIGTERM received — flushing coins...'); if (cache.users) { try { await binWrite('users', cache.users); console.log('✅ Coins flushed on shutdown'); } catch(e) { console.error('Flush error:', e.message); } } process.exit(0); });
process.on('SIGINT', async () => { if (cache.users) { try { await binWrite('users', cache.users); } catch {} } process.exit(0); });

const {
  Client, GatewayIntentBits,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const fetch = require('node-fetch');
require('dotenv').config();
// ── Blackjack helpers ──
const _BJS=['♠️','♥️','♦️','♣️'],_BJV=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function bjDraw(){return{suit:_BJS[Math.floor(Math.random()*4)],val:_BJV[Math.floor(Math.random()*13)]};}
function bjFmt(c){return c.val+c.suit;}
function bjTotal(h){let t=h.reduce((s,c)=>s+(['J','Q','K'].includes(c.val)?10:c.val==='A'?11:parseInt(c.val)),0),a=h.filter(c=>c.val==='A').length;while(t>21&&a>0){t-=10;a--;}return t;}
function bjEmbed(game,status){
  
  const pt=bjTotal(game.player),dt=bjTotal(game.dealer);
  const dd=status==='playing'?bjFmt(game.dealer[0])+' 🂠':game.dealer.map(bjFmt).join(' ');
  const dv=status==='playing'?'?':dt;
  const col=status==='win'?0x57F287:status==='push'?0xFEE75C:status==='playing'?0x5865F2:0xED4245;
  const ttl=status==='playing'?'🃏 Blackjack':status==='win'?'🃏 You Win! 🎉':status==='push'?'🃏 Push!':'🃏 You Lose!';
  return new EmbedBuilder().setColor(col).setTitle(ttl).addFields(
    {name:'🏦 Dealer ('+dv+')',value:dd||'—',inline:false},
    {name:'🧑 Your Hand ('+pt+')',value:game.player.map(bjFmt).join(' ')||'—',inline:false},
    {name:'Bet',value:'**'+game.bet.toLocaleString()+'** '+COIN_EMOJI,inline:true}
  );
}
function bjButtons(dis=false){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('👊 Hit').setStyle(ButtonStyle.Primary).setDisabled(dis),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('✋ Stand').setStyle(ButtonStyle.Secondary).setDisabled(dis)
  );
}


async function safeFetch(url, options = {}, retries = 3) {
  try {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return safeFetch(url, options, retries - 1);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return safeFetch(url, options, retries - 1);
    }
    throw err;
  }
}

const STOCK_CHANNEL_ID = '1481026325178220565';
const VOUCH_CHANNEL_ID = '1481321672970735807';
const ALERT_CHANNEL_ID = '1480833457604268154';
const GTN_CHANNEL_ID   = '1482076857321914378';
const DROP_CHANNEL_ID  = '1481582652430483579';
const LOG_CHANNEL_ID   = '1482112291750150214';
const TEST_GUILD_ID    = '1485636323854389360';
const TESTER_ROLE_NAME = 'Tester';

function isTestServer(guildId) { return guildId === TEST_GUILD_ID; }
function hasTesterRole(member) {
  if (!member) return false;
  return member.roles.cache.some(r => r.name === TESTER_ROLE_NAME);
}
// In test server: everyone can run all cmds BUT only testers earn rewards
function canRunAdmin(interaction) {
  if (isTestServer(interaction.guildId)) return true;
  return interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
}
function canEarnRewards(interaction) {
  if (isTestServer(interaction.guildId)) return hasTesterRole(interaction.member);
  return true;
}
const GUILD_ID         = (process.env.GUILD_ID   || '').trim();
const JSONBIN_KEY      =  process.env.JSONBIN_KEY;
const BOT_TOKEN        =  process.env.BOT_TOKEN;
const COIN_EMOJI       = '<:CoinEmoji:1481246827448766526>';
const ROBUX_EMOJI      = '<:robux:1481247240914731109>';
const PREFIX           = 'u!';

const MOD_KEYWORDS = ['moderator', 'mod', 'admin', 'staff', 'helper', 'support'];
function isModerator(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(r => MOD_KEYWORDS.some(kw => r.name.toLowerCase().includes(kw)));
}

// ══════════════════════════════════════════
//  HARDCODED PERMANENT CODES (always exist)
// ══════════════════════════════════════════
const PERMANENT_CODES = {
  'RELEASE': { coins: 25, description: '🎉 Launch reward' },
  // LOOTDROP: special 1-claim mystery box, reset by admin each drop
};

const pendingVouches = new Map();
const activeGTN = new Map();

// ── Active Blackjack games: Map<userId, gameState> ──
const activeBlackjack = new Map();

// ── Blackjack helpers (top-level so both slash + button handler can use them) ──

// ── Game state maps ──
const activeChairGame  = new Map(); // guildId -> state
const activeMafia      = new Map(); // guildId -> state
const activePickNumber = new Map();
const activeSpinWheel  = new Map(); // guildId -> state

// ── Active Loot Drop state ──
// { coins, claimedBy: null|userId }
let activeLootDrop = null;
const activeGiveaways = new Map();


// Letter pools for word games
const LETTER_POOLS = ['B','C','D','F','G','H','J','K','L','M','N','P','R','S','T','W','BR','CH','DR','FL','GR','PL','PR','SC','SK','SL','SM','SN','SP','ST','SW','TH','TR','WR'];

const SHOP = [
  { id: 'robux_25',   name: '25 Robux',   cost: 100,  category: 'Robux', robuxAmt: 25  },
  { id: 'robux_50',   name: '50 Robux',   cost: 200,  category: 'Robux', robuxAmt: 50  },
  { id: 'robux_75',   name: '75 Robux',   cost: 300,  category: 'Robux', robuxAmt: 75  },
  { id: 'robux_100',  name: '100 Robux',  cost: 400,  category: 'Robux', robuxAmt: 100 },
  { id: 'robux_125',  name: '125 Robux',  cost: 500,  category: 'Robux', robuxAmt: 125 },
  { id: 'robux_150',  name: '150 Robux',  cost: 600,  category: 'Robux', robuxAmt: 150 },
  { id: 'robux_175',  name: '175 Robux',  cost: 700,  category: 'Robux', robuxAmt: 175 },
  { id: 'robux_200',  name: '200 Robux',  cost: 800,  category: 'Robux', robuxAmt: 200 },
  { id: 'robux_225',  name: '225 Robux',  cost: 900,  category: 'Robux', robuxAmt: 225 },
  { id: 'robux_250',  name: '250 Robux',  cost: 1000, category: 'Robux', robuxAmt: 250 },
  { id: 'etfb_cel',   name: 'Celestial',  cost: 100,  category: 'ETFB',  robuxAmt: 0   },
  { id: 'etfb_div',   name: 'Divine',     cost: 250,  category: 'ETFB',  robuxAmt: 0   },
  { id: 'nitro',      name: 'Nitro Method',  cost: 1000, category: 'Nitro',       robuxAmt: 0 },
  { id: 'custom_role', name: 'Custom Role',   cost: 100,  category: 'CustomRole',  robuxAmt: 0 },
  // ── TESTING SERVER SHOP ──

  // PS99
  { id: 'ps99_200m',  name: '200M Gems',  cost: 100, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_400m',  name: '400M Gems',  cost: 200, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_600m',  name: '600M Gems',  cost: 300, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_800m',  name: '800M Gems',  cost: 100, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_1b',    name: '1B Gems',    cost: 500, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_1_2b',  name: '1.2B Gems',  cost: 600, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_1_4b',  name: '1.4B Gems',  cost: 700, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_1_6b',  name: '1.6B Gems',  cost: 800, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_1_8b',  name: '1.8B Gems',  cost: 900, category: 'PS99', robuxAmt: 0 },
  { id: 'ps99_2b',    name: '2B Gems',    cost: 1000, category: 'PS99', robuxAmt: 0 },
  // Sailor Piece
  { id: 'sp_sukuna_v1',      name: 'Sukuna v1 Set',       cost: 100, category: 'SailorPiece',    robuxAmt: 0 },
  { id: 'sp_gojo_v1',        name: 'Gojo v1 Set',         cost: 100, category: 'SailorPiece',    robuxAmt: 0 },
  { id: 'sp_race_100',       name: '100 Race Rerolls',    cost: 100, category: 'SailorPiece',    robuxAmt: 0 },
  { id: 'sp_trait_100',      name: '100 Trait Rerolls',   cost: 100, category: 'SailorPiece',    robuxAmt: 0 },
  { id: 'sp_aura_crate',     name: 'Aura Crate',          cost: 600, category: 'SailorPiece',    robuxAmt: 0 },
  { id: 'crunchyroll',     name: 'Crunchyroll Account', cost: 0,   category: 'Crunchyroll',  robuxAmt: 0, inviteOnly: true },
];

// ══════════════════════════════════════════
//  JSONBIN
//  ⚠️  Create a new bin at jsonbin.io and paste the ID for CODES below
// ══════════════════════════════════════════
const BIN_IDS = {
  users:  '69ce11bfaaba882197b9014b',
  store:  '69ce19d4856a682189f0f165',
  meta:   '69ce198036566621a870772b',
  claims: '69ce19d1856a682189f0f13a',
  warns:  '69b13ebbb7ec241ddc5c5b4c',
  codes:   '69ce1996856a682189f0f069',
  roblox:  '69d10a5aaaba882197c4020a',
  sab:     '69d10a5836566621a87b3961',
  giveaway:'69be9ed8b7ec241ddc8c18c5',
  vouches: '69d11234856a682189fbe655',
  crunchyroll: '69d11871aaba882197c4324a'
};
const DEFAULTS = {
  users:  {},
  store:  { robux: 0, divines: 0, celestials: 0 },
  roblox: {},
  sab:    [],
  giveaway: {},
  vouches: {},
  crunchyroll: { stock: 0, redeemed: [] },
  meta:   { stockMsgId: null, claimCounter: 0 },
  claims: [],
  warns:  {},
  codes:  {},
};
const cache     = { users: null, store: null, meta: null, claims: null, warns: null, codes: null, roblox: null, sab: null, giveaway: null, vouches: null, crunchyroll: null };
const cacheTime = { users: 0, store: 0, meta: 0, claims: 0, warns: 0, codes: 0, roblox: 0, sab: 0, giveaway: 0, vouches: 0, crunchyroll: 0 };
const CACHE_TTL = { users: Infinity, store: 0, meta: 30_000, claims: 30_000, warns: 30_000, codes: 60_000, roblox: 30_000, sab: 30_000, giveaway: 30_000, vouches: 30_000, crunchyroll: 30_000 };

async function binRead(name) {
  const res = await safeFetch(`https://api.jsonbin.io/v3/b/${BIN_IDS[name]}/latest`, {
    headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Versioning': 'false' },
  });
  if (!res.ok) throw new Error(`READ ${name} -> ${res.status}: ${await res.text()}`);
  const d = (await res.json()).record;
  if (!d || d.a === 'b') return JSON.parse(JSON.stringify(DEFAULTS[name]));
  if (d._empty) return d._data;
  return d;
}
async function binWrite(name, data) {
  let payload = data;
  if (Array.isArray(data) && data.length === 0) payload = { _empty: true, _data: [] };
  else if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) payload = { _empty: true, _data: {} };
  const res = await safeFetch(`https://api.jsonbin.io/v3/b/${BIN_IDS[name]}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Versioning': 'false' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`WRITE ${name} -> ${res.status}: ${await res.text()}`);
}
async function dbRead(name) {
  const now = Date.now();
  if (cache[name] !== null && now - cacheTime[name] < CACHE_TTL[name]) return cache[name];
  cache[name] = await binRead(name);
  cacheTime[name] = now;
  return cache[name];
}
async function dbWrite(name, data) {
  cache[name] = data; cacheTime[name] = Date.now();
  await binWrite(name, data);
}

// ══════════════════════════════════════════
//  CODES HELPERS
//  Merges permanent hardcoded codes with saved codes from JSONBin
// ══════════════════════════════════════════
async function getCodes() {
  const saved = await dbRead('codes');
  // Purge expired codes from the bin automatically
  let dirty = false;
  for (const [key, code] of Object.entries(saved)) {
    if (code.expiresAt && Date.now() > code.expiresAt) {
      delete saved[key];
      dirty = true;
    }
  }
  if (dirty) await dbWrite('codes', saved);
  // Merge: saved codes override permanent ones if they share a key (shouldn't happen normally)
  return { ...PERMANENT_CODES, ...saved };
}

async function getCode(key) {
  const all = await getCodes();
  return all[key.toUpperCase()] || null;
}

async function saveCode(key, codeObj) {
  const saved = await dbRead('codes');
  saved[key.toUpperCase()] = codeObj;
  await dbWrite('codes', saved);
}

async function deleteCode(key) {
  const saved = await dbRead('codes');
  delete saved[key.toUpperCase()];
  await dbWrite('codes', saved);
}

async function codeExists(key) {
  const all = await getCodes();
  return key.toUpperCase() in all;
}

// DB helpers
async function getUser(userId, username) {
  const users = await dbRead('users');
  if (!users[userId]) {
    users[userId] = { id: userId, username: username || 'Unknown', coins: 0, totalEarned: 0, lastDaily: null, inventory: [], redeemedCodes: [] };
    await dbWrite('users', users);
  }
  if (!users[userId].redeemedCodes) users[userId].redeemedCodes = [];
  if (!users[userId].inventory)     users[userId].inventory     = [];
  return users[userId];
}
async function saveUser(u) { if (u.coins < 0) u.coins = Math.abs(u.coins); const users = await dbRead('users'); users[u.id] = u; cache.users = users; cacheTime.users = Date.now(); await binWrite('users', users); }
async function getLeaderboard(n) { const users = await dbRead('users'); return Object.values(users).sort((a,b)=>b.coins-a.coins).slice(0,n); }
async function getStore()    { return dbRead('store'); }
async function saveStore(s)  { await dbWrite('store', s); cacheTime.store = 0; }
async function getMeta()     { return dbRead('meta'); }
async function saveMeta(m)   { await dbWrite('meta', m); }
async function getClaims()   { cacheTime.claims = 0; return dbRead('claims'); } // always read fresh
async function saveClaims(c) { await dbWrite('claims', c); cacheTime.claims = 0; } // always bust cache after write
async function getWarns(uid) { const w = await dbRead('warns'); return w[uid] || []; }
async function saveWarns(uid, arr) { const w = await dbRead('warns'); w[uid] = arr; await dbWrite('warns', w); }
async function nextClaimId() {
  const meta = await getMeta();
  meta.claimCounter = (meta.claimCounter || 0) + 1;
  await saveMeta(meta);
  return `C${meta.claimCounter}`;
}

function fmt(ms) { const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60); return h>0?`${h}h ${m%60}m`:m>0?`${m}m ${s%60}s`:`${s}s`; }
function ts(unixMs, style='R') { return `<t:${Math.floor(unixMs/1000)}:${style}>`; }
function errEmbed(text) { return new EmbedBuilder().setColor(0xED4245).setDescription(`❌ ${text}`); }
function okEmbed(text)  { return new EmbedBuilder().setColor(0x57F287).setDescription(`✅ ${text}`); }


// ══════════════════════════════════════════
//  LOG HELPER
// ══════════════════════════════════════════
async function sendLog(clientRef, fields) {
  try {
    const ch = await clientRef.channels.fetch(LOG_CHANNEL_ID);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(fields.color || 0x5865F2)
      .setTitle(fields.title || '📋 Log')
      .setTimestamp();
    if (fields.description) embed.setDescription(fields.description);
    if (fields.fields) embed.addFields(...fields.fields);
    if (fields.user) embed.setFooter({ text: `User: ${fields.user}` });
    await ch.send({ embeds: [embed] });
  } catch(e) { console.error('Log send error:', e.message); }
}

function stockEmbed(store) {
  return new EmbedBuilder().setTitle('🏪 Current Stock').setColor(0x5865F2)
    .setDescription('Use `/shop` to see prices and `/redeem` to purchase!')
    .addFields(
      { name: '💎 Robux',      value: store.robux      > 0 ? `**${store.robux}** available`      : '❌ Out of stock', inline: true },
      { name: '✨ Celestials', value: store.celestials > 0 ? `**${store.celestials}x** available` : '❌ Out of stock', inline: true },
      { name: '🌟 Divines',   value: store.divines    > 0 ? `**${store.divines}x** available`    : '❌ Out of stock', inline: true },
      { name: '🛒 SAB',        value: '🔽 Click below to view!', inline: true },
      { name: '🎌 Crunchyroll', value: store.crunchyroll > 0 ? `**${store.crunchyroll}** account(s) available` : '❌ Out of stock', inline: true }
    ).setFooter({ text: 'Stock updated by admins' });
}
function stockComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sab_view').setLabel('🛒 View SAB Stock').setStyle(ButtonStyle.Secondary)
  )];
}

async function updateStockEmbed(clientRef) {
  try {
    const ch = await clientRef.channels.fetch(STOCK_CHANNEL_ID);
    if (!ch) return;
    const store = await getStore(), meta = await getMeta();
    try { const cr = await dbRead('crunchyroll'); store.crunchyroll = cr.stock||0; } catch {}
    const embed = stockEmbed(store);
    if (meta.stockMsgId) {
      try { const m = await ch.messages.fetch(meta.stockMsgId); await m.edit({ embeds: [embed], components: stockComponents() }); return; } catch {}
    }
    const sent = await ch.send({ embeds: [embed], components: stockComponents() });
    meta.stockMsgId = sent.id; await saveMeta(meta);
  } catch (e) { console.error('Stock embed error:', e.message); }
}

// ── Slash command defs ──
const { SlashCommandBuilder: SCB, PermissionFlagsBits: PFB } = require('discord.js');
const slashDefs = [
  new SCB().setName('balance').setDescription('Check your coin balance').addUserOption(o=>o.setName('user').setDescription('Check someone else').setRequired(false)),
  new SCB().setName('daily').setDescription('Claim coins (24h cooldown)'),
  new SCB().setName('rain').setDescription('[ADMIN] Rain coins — react to enter, 2 min timer').setDefaultMemberPermissions(PFB.Administrator).addIntegerOption(o=>o.setName('amount').setDescription('Total coins to rain').setRequired(true).setMinValue(10)),
  new SCB().setName('shop').setDescription('View all items and prices'),
  new SCB().setName('redeem').setDescription('Buy Robux or ETFB from the shop').addStringOption(o=>o.setName('item').setDescription('Item to buy').setRequired(true).addChoices(
    {name:'25 Robux — 100 coins',value:'robux_25'},{name:'50 Robux — 200 coins',value:'robux_50'},
    {name:'75 Robux — 300 coins',value:'robux_75'},{name:'100 Robux — 400 coins',value:'robux_100'},
    {name:'125 Robux — 500 coins',value:'robux_125'},{name:'150 Robux — 600 coins',value:'robux_150'},
    {name:'175 Robux — 700 coins',value:'robux_175'},{name:'200 Robux — 800 coins',value:'robux_200'},
    {name:'225 Robux — 900 coins',value:'robux_225'},{name:'250 Robux — 1000 coins',value:'robux_250'},
    {name:'Celestial ETFB — 100 coins',value:'etfb_cel'},{name:'Divine ETFB — 250 coins',value:'etfb_div'},
    {name:'Nitro Method — 1000 coins',value:'nitro'},{name:'Custom Role — 100 coins',value:'custom_role'}
  )),
  new SCB().setName('redeem-ps99').setDescription('Buy PS99 Gems from the shop').addStringOption(o=>o.setName('item').setDescription('Item to buy').setRequired(true).addChoices(
    {name:'200M Gems — 100 coins',value:'ps99_200m'},{name:'400M Gems — 100 coins',value:'ps99_400m'},
    {name:'600M Gems — 100 coins',value:'ps99_600m'},{name:'800M Gems — 100 coins',value:'ps99_800m'},
    {name:'1B Gems — 100 coins',value:'ps99_1b'},{name:'1.2B Gems — 100 coins',value:'ps99_1_2b'},
    {name:'1.4B Gems — 100 coins',value:'ps99_1_4b'},{name:'1.6B Gems — 100 coins',value:'ps99_1_6b'},
    {name:'1.8B Gems — 100 coins',value:'ps99_1_8b'},{name:'2B Gems — 100 coins',value:'ps99_2b'}
  )),
  new SCB().setName('redeem-sp').setDescription('Buy Sailor Piece items from the shop').addStringOption(o=>o.setName('item').setDescription('Item to buy').setRequired(true).addChoices(
    {name:'Sukuna v1 Set — 100 coins',value:'sp_sukuna_v1'},{name:'Gojo v1 Set — 100 coins',value:'sp_gojo_v1'},
    {name:'100 Race Rerolls — 100 coins',value:'sp_race_100'},{name:'100 Trait Rerolls — 100 coins',value:'sp_trait_100'},
    {name:'Aura Crate — 600 coins',value:'sp_aura_crate'}
  )),
  new SCB().setName('inventory').setDescription('View your unclaimed items'),
  new SCB().setName('claim').setDescription('Submit a delivery claim for an item').addStringOption(o=>o.setName('id').setDescription('Claim ID, e.g. C1').setRequired(true)),
  new SCB().setName('use-code').setDescription('Redeem a code for coins').addStringOption(o=>o.setName('code').setDescription('The code to redeem').setRequired(true)),
  new SCB().setName('leaderboard').setDescription('Top 10 richest members'),
  new SCB().setName('help').setDescription('View all commands'),
  new SCB().setName('adminhelp').setDescription('View admin commands').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('claims').setDescription('[ADMIN] View all pending claims').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('claimed').setDescription('[ADMIN] Mark a claim as fulfilled').setDefaultMemberPermissions(PFB.Administrator).addStringOption(o=>o.setName('id').setDescription('Claim ID').setRequired(true)),
  new SCB().setName('deny-claim').setDescription('[ADMIN] Deny a claim and refund to inventory').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('id').setDescription('Claim ID').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason for denial (optional)').setRequired(false)),
  new SCB().setName('update-robux').setDescription('[ADMIN] Update Robux stock').setDefaultMemberPermissions(PFB.Administrator).addIntegerOption(o=>o.setName('amount').setDescription('New amount').setRequired(true).setMinValue(0)),
  new SCB().setName('update-etfb').setDescription('[ADMIN] Update ETFB stock').setDefaultMemberPermissions(PFB.Administrator).addStringOption(o=>o.setName('type').setDescription('Which item').setRequired(true).addChoices({name:'Divines',value:'divines'},{name:'Celestials',value:'celestials'})).addIntegerOption(o=>o.setName('amount').setDescription('New amount').setRequired(true).setMinValue(0)),
  new SCB().setName('give').setDescription('[ADMIN] Give coins to a user').setDefaultMemberPermissions(PFB.Administrator).addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  new SCB().setName('take').setDescription('[ADMIN] Take coins from a user').setDefaultMemberPermissions(PFB.Administrator).addUserOption(o=>o.setName('user').setDescription('Target').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount (ignored if all=true)').setRequired(false).setMinValue(1)).addBooleanOption(o=>o.setName('all').setDescription('Take ALL coins from the user').setRequired(false)),
  new SCB().setName('remove-inv').setDescription('[ADMIN] Remove an item from a user inventory').setDefaultMemberPermissions(PFB.Administrator).addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true)).addStringOption(o=>o.setName('claim_id').setDescription('Claim ID to remove').setRequired(true)),
  new SCB().setName('check-inventory').setDescription('[ADMIN] View any user inventory').setDefaultMemberPermissions(PFB.Administrator).addUserOption(o=>o.setName('user').setDescription('Target user').setRequired(true)),
  new SCB().setName('backup-coins').setDescription('[ADMIN] Export all user coin balances as a readable list').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('make-code').setDescription('[ADMIN] Create a permanent saved code').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('code').setDescription('The code word').setRequired(true))
    .addIntegerOption(o=>o.setName('coins').setDescription('Coins to reward').setRequired(true).setMinValue(1))
    .addStringOption(o=>o.setName('description').setDescription('Description shown when redeemed').setRequired(false)),
  new SCB().setName('drop-code').setDescription('[ADMIN] Drop a time-limited code everyone can redeem once').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('code').setDescription('The code word').setRequired(true))
    .addIntegerOption(o=>o.setName('coins').setDescription('Coins to reward').setRequired(true).setMinValue(1))
    .addIntegerOption(o=>o.setName('minutes').setDescription('How many minutes until the code expires').setRequired(true).setMinValue(1))
    .addStringOption(o=>o.setName('description').setDescription('Description shown when redeemed').setRequired(false)),
  new SCB().setName('remove-code').setDescription('[ADMIN] Remove/expire a code immediately').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('code').setDescription('The code to remove').setRequired(true)),
  new SCB().setName('list-codes').setDescription('[ADMIN] View all active codes').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('gtn').setDescription('[ADMIN] Start a Guess the Number game').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('min').setDescription('Minimum number').setRequired(true).setMinValue(1))
    .addIntegerOption(o=>o.setName('max').setDescription('Maximum number').setRequired(true).setMinValue(2))
    .addIntegerOption(o=>o.setName('number').setDescription('The winning number').setRequired(true))
    .addIntegerOption(o=>o.setName('prize').setDescription('Coins prize for the winner').setRequired(true).setMinValue(1)),
  new SCB().setName('timeout').setDescription('[MOD] Timeout a user').setDefaultMemberPermissions(PFB.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('User to timeout').setRequired(true))
    .addIntegerOption(o=>o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SCB().setName('untimeout').setDescription('[MOD] Remove timeout from a user').setDefaultMemberPermissions(PFB.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('User to untimeout').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SCB().setName('warn').setDescription('[MOD] Warn a user').setDefaultMemberPermissions(PFB.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
  new SCB().setName('unwarn').setDescription('[MOD] Remove a warn from a user').setDefaultMemberPermissions(PFB.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o=>o.setName('index').setDescription('Warn number to remove (from /warns)').setRequired(true).setMinValue(1)),
  new SCB().setName('warns').setDescription('[MOD] View warns for a user').setDefaultMemberPermissions(PFB.ModerateMembers)
    .addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)),
  new SCB().setName('kick').setDescription('[MOD] Kick a user').setDefaultMemberPermissions(PFB.KickMembers)
    .addUserOption(o=>o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  new SCB().setName('ban').setDescription('[MOD] Ban a user').setDefaultMemberPermissions(PFB.BanMembers)
    .addUserOption(o=>o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(false)),
  // ── GAMBLING (open to everyone) ──
  new SCB().setName('coinflip').setDescription('Flip a coin and bet coins')
    .addIntegerOption(o=>o.setName('bet').setDescription('How many coins to bet').setRequired(true).setMinValue(1))
    .addStringOption(o=>o.setName('side').setDescription('Heads or Tails?').setRequired(true).addChoices({name:'Heads',value:'heads'},{name:'Tails',value:'tails'})),
  new SCB().setName('slots').setDescription('Spin the slot machine')
    .addIntegerOption(o=>o.setName('bet').setDescription('How many coins to bet').setRequired(true).setMinValue(1)),
  new SCB().setName('blackjack').setDescription('Play a hand of Blackjack')
    .addIntegerOption(o=>o.setName('bet').setDescription('How many coins to bet').setRequired(true).setMinValue(1)),
  new SCB().setName('doubleornothing').setDescription('Double your coins or lose them all')
    .addIntegerOption(o=>o.setName('bet').setDescription('How many coins to bet').setRequired(true).setMinValue(1)),
  new SCB().setName('lootdrop').setDescription('[ADMIN] Drop a mystery loot box (10–50 coins, first to claim wins)').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('add-user').setDescription('Link your Roblox username to your Discord account').addStringOption(o=>o.setName('roblox_username').setDescription('Your Roblox username').setRequired(true)),
  new SCB().setName('check-user').setDescription('See all linked Roblox users').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('game-night-start').setDescription('[ADMIN] DM all linked users about a game night starting').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('vouch').setDescription('Leave a vouch for a user')
    .addUserOption(o=>o.setName('user').setDescription('User to vouch for').setRequired(true))
    .addStringOption(o=>o.setName('comment').setDescription('Leave a comment (optional)').setRequired(false)),
  new SCB().setName('vouches').setDescription('View vouches for a user')
    .addUserOption(o=>o.setName('user').setDescription('User to check').setRequired(true)),
  new SCB().setName('find-user').setDescription('[ADMIN] Find a linked user by Roblox or Discord username').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('query').setDescription('Roblox username or @Discord mention').setRequired(true)),
  new SCB().setName('giveaway').setDescription('[ADMIN] Start a coin giveaway').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1))
    .addStringOption(o=>o.setName('prize').setDescription('Prize description e.g. 500 coins').setRequired(true))
    .addIntegerOption(o=>o.setName('coins').setDescription('Coins to give each winner').setRequired(true).setMinValue(1))
    .addIntegerOption(o=>o.setName('winners').setDescription('Number of winners (default 1)').setRequired(false).setMinValue(1).setMaxValue(10)),
  new SCB().setName('update-crunchyroll').setDescription('[ADMIN] Set Crunchyroll account stock').setDefaultMemberPermissions(PFB.Administrator).addIntegerOption(o=>o.setName('amount').setDescription('Number of accounts in stock').setRequired(true).setMinValue(0)),
  new SCB().setName('update-sab').setDescription('[ADMIN] Add/update a SAB stock item').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('item').setDescription('Item name').setRequired(true))
    .addStringOption(o=>o.setName('stock').setDescription('Stock type').setRequired(true).addChoices({name:'M (Multiple)',value:'M'},{name:'S (Single)',value:'S'}))
    .addIntegerOption(o=>o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1))
    .addStringOption(o=>o.setName('making_money').setDescription('Making money rate e.g. 100/s or 100m/s').setRequired(false)),
  new SCB().setName('remove-stock-sab').setDescription('[ADMIN] Remove a SAB item from stock').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('item').setDescription('Item name to remove').setRequired(true)),
  new SCB().setName('redeem-sab').setDescription('Buy a SAB item from stock')
    .addStringOption(o=>o.setName('item').setDescription('Item name to buy').setRequired(true)),
  new SCB().setName('chair-game').setDescription('[ADMIN] Start a Chair Game').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('prize').setDescription('Coins for winner').setRequired(true).setMinValue(1)),
  new SCB().setName('mafia').setDescription('[ADMIN] Start a Mafia game').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('prize').setDescription('Coins for innocents if they win').setRequired(true).setMinValue(1))
    .addIntegerOption(o=>o.setName('murderers').setDescription('Number of murderers (default 1)').setRequired(false).setMinValue(1)),
  new SCB().setName('pick-number').setDescription('[ADMIN] Start a Pick a Number game (1-50 grid)').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('prize').setDescription('Coins for last survivor').setRequired(true).setMinValue(1)),
  new SCB().setName('chair-next').setDescription('[ADMIN] Start next Chair Game round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('mafia-start').setDescription('[ADMIN] Start Mafia after players join').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('mafia-next').setDescription('[ADMIN] Process Mafia round results').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('mafia-kill').setDescription('[MURDERER] Kill a player in Mafia').addUserOption(o=>o.setName('user').setDescription('Player to kill').setRequired(true)),
  new SCB().setName('mafia-vote').setDescription('[INNOCENT] Vote who you think is the murderer').addUserOption(o=>o.setName('user').setDescription('Player to vote out').setRequired(true)),
  new SCB().setName('pick-number-round').setDescription('[ADMIN] Start a Pick a Number round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('spin-wheel').setDescription('[ADMIN] Start a Spin the Wheel event').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1))
    .addIntegerOption(o=>o.setName('max_entries').setDescription('Max number of people who can enter').setRequired(true).setMinValue(2))
    .addIntegerOption(o=>o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
    .addIntegerOption(o=>o.setName('prize_coins').setDescription('Coins each winner receives').setRequired(true).setMinValue(1))
    .addStringOption(o=>o.setName('prize_name').setDescription('Prize description e.g. Nitro Method').setRequired(true)),
  // ── Testing server only cmds ──
  new SCB().setName('test-ping').setDescription('[TEST] Ping pong test'),
  new SCB().setName('test-balance').setDescription('[TEST] Check your balance'),
  new SCB().setName('test-give').setDescription('[TEST] Give yourself coins for testing').addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  new SCB().setName('test-shop').setDescription('[TEST] View the testing server shop'),
  new SCB().setName('test-inv').setDescription('[TEST] View your test server inventory'),
  new SCB().setName('test-redeem').setDescription('[TEST] Buy a testing shop item').addStringOption(o=>o.setName('item').setDescription('Item ID').setRequired(true).addChoices(
    {name:'Custom Role — 100 coins',value:'test_role'},
    {name:'PS99 200M Gems — 100 coins',value:'ps99_200m'},
    {name:'PS99 400M Gems — 100 coins',value:'ps99_400m'},
    {name:'PS99 600M Gems — 100 coins',value:'ps99_600m'},
    {name:'PS99 800M Gems — 100 coins',value:'ps99_800m'},
    {name:'PS99 1B Gems — 100 coins',value:'ps99_1b'},
    {name:'PS99 1.2B Gems — 100 coins',value:'ps99_1_2b'},
    {name:'PS99 1.4B Gems — 100 coins',value:'ps99_1_4b'},
    {name:'PS99 1.6B Gems — 100 coins',value:'ps99_1_6b'},
    {name:'PS99 1.8B Gems — 100 coins',value:'ps99_1_8b'},
    {name:'PS99 2B Gems — 100 coins',value:'ps99_2b'},
    {name:'SP Aura Crate — 600 coins',value:'sp_aura_crate'},
    {name:'SP Sukuna v1 Set — 100 coins',value:'sp_sukuna_v1'},
    {name:'SP Gojo v1 Set — 100 coins',value:'sp_gojo_v1'},
    {name:'SP 100 Race Rerolls — 100 coins',value:'sp_race_100'},
    {name:'SP 100 Trait Rerolls — 100 coins',value:'sp_trait_100'}
  )),
  new SCB().setName('find-claim').setDescription('[ADMIN] Find pending claims by category').setDefaultMemberPermissions(PFB.Administrator)
    .addStringOption(o=>o.setName('category').setDescription('Category to filter').setRequired(true).addChoices(
      {name:'Robux',value:'Robux'},
      {name:'PS99',value:'PS99'},
      {name:'Nitro Method',value:'Nitro'},
      {name:'ETFB',value:'ETFB'},
      {name:'Sailor Piece',value:'SailorPiece'},
      {name:'Custom Role',value:'CustomRole'},
      {name:'All Pending',value:'all'}
    )),
].map(c => c.toJSON());

let coinWriteTimer = null;
function scheduleCoinFlush() {
  if (coinWriteTimer) return;
  coinWriteTimer = setTimeout(async () => {
    coinWriteTimer = null;
    if (!cache.users) return;
    try { await binWrite('users', cache.users); cacheTime.users = Date.now(); }
    catch (e) { console.error('Coin flush error:', e.message); setTimeout(scheduleCoinFlush, 5000); }
  }, 2000);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

const channelLastMsg = new Map();
const spamCooldown   = new Set();
async function handleSpamCheck(msg) {
  const { id: uid, username } = msg.author;
  const cid   = msg.channel.id;
  const state = channelLastMsg.get(cid) || { lastUserId: null, count: 0 };
  if (state.lastUserId === uid) state.count += 1;
  else { state.lastUserId = uid; state.count = 1; }
  channelLastMsg.set(cid, state);
  if (state.count === 15 && !spamCooldown.has(uid)) {
    spamCooldown.add(uid);
    setTimeout(() => spamCooldown.delete(uid), 60_000);
    if (cache.users && cache.users[uid]) { cache.users[uid].coins = Math.max(0,(cache.users[uid].coins||0)-100); scheduleCoinFlush(); }
    else { try { const u=await getUser(uid,username); u.coins=Math.max(0,u.coins-100); await saveUser(u); } catch {} }
    try { await msg.author.send({ embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('⚠️ Spam Warning!').setDescription(`You were caught spamming in <#${cid}>.\n\n**100** ${COIN_EMOJI} deducted.\n\nPlease stop spamming or you will be penalised again!`)] }); } catch {}
    try { const w=await msg.channel.send({ embeds:[new EmbedBuilder().setColor(0xED4245).setDescription(`⚠️ <@${uid}> stop spamming! **100** ${COIN_EMOJI} deducted.`)] }); setTimeout(()=>w.delete().catch(()=>{}),8000); } catch {}
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  if (!GUILD_ID || !JSONBIN_KEY) { console.error('FATAL: missing env vars'); process.exit(1); }
  const CLIENT_ID = (process.env.CLIENT_ID || '').trim();
  if (!CLIENT_ID) {
    console.warn('⚠️  CLIENT_ID not set — skipping slash command registration');
  } else {
    try {
      const { REST, Routes } = require('discord.js');
      const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
      const data  = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),        { body: slashDefs });
      const data2 = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, TEST_GUILD_ID), { body: slashDefs });
      console.log(`✅ Registered ${data.length} cmds to main + ${data2.length} cmds to test server`);
    } catch (e) { console.error('Slash command registration failed:', e.message); }
  }
  try { await dbRead('users'); console.log('✅ Cache warmed'); } catch (e) { console.error('Cache warmup error:', e.message); }
  // ── ONE-TIME COIN RESTORE — remove after first successful deploy ──
  try {
    console.log('🔄 Force-restoring 390 users from backup...');
    if (true) {
      const restored = {
  "1135495327185637486": {"id":"1135495327185637486","username":"redking659","coins":1231,"totalEarned":1231,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1388101359051735080": {"id":"1388101359051735080","username":"mango05173","coins":984,"totalEarned":984,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1399755855221493883": {"id":"1399755855221493883","username":"khevanshgamerz7","coins":943,"totalEarned":943,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1228792731724288182": {"id":"1228792731724288182","username":"yuiblox","coins":933,"totalEarned":933,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1392817884102787164": {"id":"1392817884102787164","username":"shuxdemonslayer","coins":886,"totalEarned":886,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1408969213338583040": {"id":"1408969213338583040","username":"bear5_0","coins":805,"totalEarned":805,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1325232447612518531": {"id":"1325232447612518531","username":"david021527","coins":711,"totalEarned":711,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1294649932761927681": {"id":"1294649932761927681","username":"blaze_rule_deleted","coins":709,"totalEarned":709,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1469970519041511484": {"id":"1469970519041511484","username":"sunnydeol0349","coins":656,"totalEarned":656,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1157960633950679141": {"id":"1157960633950679141","username":"thatvelvetgirl","coins":601,"totalEarned":601,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1426080685323456595": {"id":"1426080685323456595","username":"raghavthegoat","coins":600,"totalEarned":600,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475122689713639506": {"id":"1475122689713639506","username":"himsmsmskw2929why_24119","coins":545,"totalEarned":545,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1462451945804398850": {"id":"1462451945804398850","username":"superganer_7150","coins":544,"totalEarned":544,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1243181977046355999": {"id":"1243181977046355999","username":"opspro861_53247","coins":543,"totalEarned":543,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1405114460141785109": {"id":"1405114460141785109","username":"dedangaming.123","coins":542,"totalEarned":542,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1471221836472778794": {"id":"1471221836472778794","username":"dropkeys","coins":538,"totalEarned":538,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1477286784722407537": {"id":"1477286784722407537","username":"terri00577","coins":502,"totalEarned":502,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1211624814721236992": {"id":"1211624814721236992","username":"duggufreefire","coins":487,"totalEarned":487,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1258138027423699034": {"id":"1258138027423699034","username":"neevishreddy1456_87581","coins":437,"totalEarned":437,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1259709660936671256": {"id":"1259709660936671256","username":"pmgxpeacemind","coins":419,"totalEarned":419,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1441808006038814904": {"id":"1441808006038814904","username":"cowboy0_1","coins":401,"totalEarned":401,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1483751945104658533": {"id":"1483751945104658533","username":"kingkongfanworlds","coins":391,"totalEarned":391,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1317546280800489592": {"id":"1317546280800489592","username":"gojo78601","coins":375,"totalEarned":375,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1028314250646659133": {"id":"1028314250646659133","username":"l2cassab","coins":289,"totalEarned":289,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1114875025292537927": {"id":"1114875025292537927","username":"wmannss","coins":288,"totalEarned":288,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1098191778873622619": {"id":"1098191778873622619","username":".notclassy","coins":260,"totalEarned":260,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1461811533049761837": {"id":"1461811533049761837","username":"itsinsightplays.","coins":251,"totalEarned":251,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1462372516847947781": {"id":"1462372516847947781","username":"sankhlagaming","coins":227,"totalEarned":227,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1133780101490814996": {"id":"1133780101490814996","username":".faisal.","coins":225,"totalEarned":225,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1383728996042281033": {"id":"1383728996042281033","username":"god102030","coins":211,"totalEarned":211,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1277737427296845826": {"id":"1277737427296845826","username":"arthxd._11793","coins":210,"totalEarned":210,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "845212703411798037": {"id":"845212703411798037","username":"unbeatable6783","coins":209,"totalEarned":209,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1460882948894101687": {"id":"1460882948894101687","username":"mad_aditya","coins":205,"totalEarned":205,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1326570255019147387": {"id":"1326570255019147387","username":"you.can_trust_me_28171","coins":200,"totalEarned":200,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1413297966562934905": {"id":"1413297966562934905","username":"ym618.","coins":195,"totalEarned":195,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1443911042743931070": {"id":"1443911042743931070","username":"big_bro0311","coins":194,"totalEarned":194,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1248972948271009887": {"id":"1248972948271009887","username":"hara_0_38487","coins":185,"totalEarned":185,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1451591521269846047": {"id":"1451591521269846047","username":"adamthegost","coins":172,"totalEarned":172,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1454059825368666153": {"id":"1454059825368666153","username":"thor_0734","coins":159,"totalEarned":159,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1328568016098562110": {"id":"1328568016098562110","username":"aarav09698","coins":155,"totalEarned":155,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1350054944367050752": {"id":"1350054944367050752","username":"secertname._17989","coins":153,"totalEarned":153,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1454491944486179081": {"id":"1454491944486179081","username":"gaurav67h","coins":149,"totalEarned":149,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1483124271956889683": {"id":"1483124271956889683","username":"navyahahhaha","coins":149,"totalEarned":149,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1457324903249350710": {"id":"1457324903249350710","username":"headgamer8766","coins":141,"totalEarned":141,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1428422911055892572": {"id":"1428422911055892572","username":"forsaken516","coins":137,"totalEarned":137,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "973780648856813588": {"id":"973780648856813588","username":"gloi_the_winner","coins":137,"totalEarned":137,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1398964310524301433": {"id":"1398964310524301433","username":"max_editz123","coins":134,"totalEarned":134,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1234527459286712320": {"id":"1234527459286712320","username":"boss_gaurav","coins":133,"totalEarned":133,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1294910523984445494": {"id":"1294910523984445494","username":"not_tanushh","coins":133,"totalEarned":133,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1400003150085095536": {"id":"1400003150085095536","username":"itul50","coins":130,"totalEarned":130,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1436051648219971728": {"id":"1436051648219971728","username":"donlorenzo03221","coins":130,"totalEarned":130,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1051087539689226350": {"id":"1051087539689226350","username":"abdulwahab2599","coins":126,"totalEarned":126,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1378085762607878221": {"id":"1378085762607878221","username":"skylr_e","coins":122,"totalEarned":122,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1425844172778242201": {"id":"1425844172778242201","username":"parth_gaming1944","coins":122,"totalEarned":122,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1441818328669622396": {"id":"1441818328669622396","username":"samisab0621","coins":118,"totalEarned":118,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1334884392153124867": {"id":"1334884392153124867","username":"the_king140910","coins":116,"totalEarned":116,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "985795371106197514": {"id":"985795371106197514","username":"makdi_men","coins":114,"totalEarned":114,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1418669321546240201": {"id":"1418669321546240201","username":"schwamkopfoffical","coins":114,"totalEarned":114,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "906050485025406987": {"id":"906050485025406987","username":"moistdingus","coins":110,"totalEarned":110,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1473976956801519627": {"id":"1473976956801519627","username":"tacocpvp","coins":108,"totalEarned":108,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1477666175017160844": {"id":"1477666175017160844","username":"bigbessfkads","coins":107,"totalEarned":107,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1257722847049158767": {"id":"1257722847049158767","username":"indus_farhan","coins":106,"totalEarned":106,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1480868185682219163": {"id":"1480868185682219163","username":"hassan072825","coins":105,"totalEarned":105,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1396657963552211058": {"id":"1396657963552211058","username":"thebestlol900","coins":104,"totalEarned":104,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "909095357357637662": {"id":"909095357357637662","username":"fizzy_0.","coins":101,"totalEarned":101,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1322471289159548940": {"id":"1322471289159548940","username":"sastagamer_9906","coins":100,"totalEarned":100,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1342669795337961566": {"id":"1342669795337961566","username":"zaidin0913","coins":98,"totalEarned":98,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1254277143756800054": {"id":"1254277143756800054","username":"fkc_sameer_53675","coins":95,"totalEarned":95,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1412411073063162017": {"id":"1412411073063162017","username":"king124789.","coins":86,"totalEarned":86,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1227410580801851425": {"id":"1227410580801851425","username":"ohio0680_89706","coins":84,"totalEarned":84,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1416427239506968676": {"id":"1416427239506968676","username":"sercures","coins":82,"totalEarned":82,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1455635417968939183": {"id":"1455635417968939183","username":"_only_spirit","coins":81,"totalEarned":81,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1408631003391721474": {"id":"1408631003391721474","username":"giri00471","coins":79,"totalEarned":79,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1164206305779650661": {"id":"1164206305779650661","username":"1alcon_eresto","coins":77,"totalEarned":77,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "881894738989555803": {"id":"881894738989555803","username":"hotdogiq789","coins":76,"totalEarned":76,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1457420464723984547": {"id":"1457420464723984547","username":"hermit0158","coins":76,"totalEarned":76,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1089852898231468073": {"id":"1089852898231468073","username":"noproblem3612","coins":75,"totalEarned":75,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1461610037368852612": {"id":"1461610037368852612","username":"sanskargamer21isback","coins":75,"totalEarned":75,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1452676118829334549": {"id":"1452676118829334549","username":"pufferfishyt","coins":73,"totalEarned":73,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1325540511448170588": {"id":"1325540511448170588","username":"yfn0618_10217","coins":70,"totalEarned":70,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1430143456197738607": {"id":"1430143456197738607","username":"mustafacools","coins":68,"totalEarned":68,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1326530639440117781": {"id":"1326530639440117781","username":"v4r_1","coins":66,"totalEarned":66,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1197532681676804149": {"id":"1197532681676804149","username":"well4th","coins":65,"totalEarned":65,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1391296792523571230": {"id":"1391296792523571230","username":"sh4dow_onyt","coins":64,"totalEarned":64,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1303278561674657833": {"id":"1303278561674657833","username":"taskgamer_99_81200","coins":64,"totalEarned":64,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1265002036152373371": {"id":"1265002036152373371","username":"ilikecattss","coins":62,"totalEarned":62,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "939887000473972817": {"id":"939887000473972817","username":"benja.0124","coins":56,"totalEarned":56,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1352332229917020170": {"id":"1352332229917020170","username":"rishi.samanyu001","coins":55,"totalEarned":55,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1133554989709660250": {"id":"1133554989709660250","username":"zaidasalman","coins":51,"totalEarned":51,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1330113272480796735": {"id":"1330113272480796735","username":"football_verse7","coins":51,"totalEarned":51,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1454695419883032782": {"id":"1454695419883032782","username":"one_only.galaxy","coins":50,"totalEarned":50,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1128653538675929098": {"id":"1128653538675929098","username":"envexity303","coins":50,"totalEarned":50,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1065715778252456016": {"id":"1065715778252456016","username":"dertyp2201","coins":50,"totalEarned":50,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1442166003155865831": {"id":"1442166003155865831","username":"desidemon0588","coins":50,"totalEarned":50,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1310595456295768075": {"id":"1310595456295768075","username":"smartmind_46763","coins":47,"totalEarned":47,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "911849129905356881": {"id":"911849129905356881","username":"kerxzy.","coins":46,"totalEarned":46,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "916978869259624488": {"id":"916978869259624488","username":"whos_here.1","coins":46,"totalEarned":46,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1398704432702558389": {"id":"1398704432702558389","username":"da_real_foxy","coins":46,"totalEarned":46,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1262471171820224597": {"id":"1262471171820224597","username":"tushar094862","coins":46,"totalEarned":46,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1422649005153976411": {"id":"1422649005153976411","username":"wrwhis","coins":45,"totalEarned":45,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1470690392835100778": {"id":"1470690392835100778","username":"xoy1","coins":44,"totalEarned":44,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1455286823696859249": {"id":"1455286823696859249","username":"thabronx0803","coins":44,"totalEarned":44,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1204906383942885440": {"id":"1204906383942885440","username":"sarkar0714","coins":43,"totalEarned":43,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1464486203087782033": {"id":"1464486203087782033","username":"sushil04262","coins":43,"totalEarned":43,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1487843649579389108": {"id":"1487843649579389108","username":"ghostguy0305","coins":42,"totalEarned":42,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1326197706892509184": {"id":"1326197706892509184","username":"sonic_yt7","coins":41,"totalEarned":41,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1474287058729173094": {"id":"1474287058729173094","username":"speedyxd","coins":41,"totalEarned":41,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1455022355452657855": {"id":"1455022355452657855","username":"heavenly_monkey_23088","coins":41,"totalEarned":41,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1399429266491310190": {"id":"1399429266491310190","username":"mroverkiller","coins":39,"totalEarned":39,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1458364655348220027": {"id":"1458364655348220027","username":"i_am_nathan123","coins":38,"totalEarned":38,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "976647461223428117": {"id":"976647461223428117","username":"harshitdixit0780","coins":38,"totalEarned":38,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1287445126364270672": {"id":"1287445126364270672","username":"vphantex","coins":37,"totalEarned":37,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1438274281485373561": {"id":"1438274281485373561","username":"hashimk0326","coins":37,"totalEarned":37,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1401140684135858227": {"id":"1401140684135858227","username":"xenishan","coins":37,"totalEarned":37,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1481875720765706361": {"id":"1481875720765706361","username":"andheavenknowsimmiserablenoww","coins":37,"totalEarned":37,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1453845180586393833": {"id":"1453845180586393833","username":"shrek06408","coins":36,"totalEarned":36,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "974665827133571072": {"id":"974665827133571072","username":"notmylesxd","coins":36,"totalEarned":36,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1208416200200032271": {"id":"1208416200200032271","username":"newaccount0091_29265","coins":36,"totalEarned":36,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "809816759602642984": {"id":"809816759602642984","username":"makigamer5974","coins":35,"totalEarned":35,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1083264548447998003": {"id":"1083264548447998003","username":"faniel1","coins":35,"totalEarned":35,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1449278381727289347": {"id":"1449278381727289347","username":"asthekingiamaster","coins":35,"totalEarned":35,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1402485115191427082": {"id":"1402485115191427082","username":"sys_e","coins":33,"totalEarned":33,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1457342146431684759": {"id":"1457342146431684759","username":"ishowthemeat0890","coins":33,"totalEarned":33,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1464300394967470161": {"id":"1464300394967470161","username":"yugxroblox24433","coins":33,"totalEarned":33,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1398484691262374017": {"id":"1398484691262374017","username":"fuzzyyt12","coins":33,"totalEarned":33,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1460628171807526922": {"id":"1460628171807526922","username":"yoboy01699","coins":32,"totalEarned":32,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1414261408723501207": {"id":"1414261408723501207","username":"aarav_777sui","coins":31,"totalEarned":31,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1483415255429283882": {"id":"1483415255429283882","username":"idk_clan","coins":31,"totalEarned":31,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1088136900264595476": {"id":"1088136900264595476","username":".ninetyone.","coins":30,"totalEarned":30,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1456553801581596753": {"id":"1456553801581596753","username":"rengoku121346.","coins":30,"totalEarned":30,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1241476813373440032": {"id":"1241476813373440032","username":"9854_0","coins":29,"totalEarned":29,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1066414780279169024": {"id":"1066414780279169024","username":"kittygoofball","coins":29,"totalEarned":29,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1236579707076612140": {"id":"1236579707076612140","username":"vewu0395_70140","coins":29,"totalEarned":29,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1425575308190552326": {"id":"1425575308190552326","username":"flipflop122.","coins":28,"totalEarned":28,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1459949192469549311": {"id":"1459949192469549311","username":"ultsupersaiyan","coins":27,"totalEarned":27,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1049699038305460305": {"id":"1049699038305460305","username":"fruitplz399","coins":27,"totalEarned":27,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1250087532155109438": {"id":"1250087532155109438","username":"thefrostyrblx","coins":27,"totalEarned":27,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1381877949958979664": {"id":"1381877949958979664","username":"sharma_shubham2011","coins":26,"totalEarned":26,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1236522837771026515": {"id":"1236522837771026515","username":"banayad0227","coins":26,"totalEarned":26,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1181985486483501228": {"id":"1181985486483501228","username":"mxseryy._41157","coins":26,"totalEarned":26,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1470180496477524070": {"id":"1470180496477524070","username":"ma.mma","coins":25,"totalEarned":25,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1367899486730322021": {"id":"1367899486730322021","username":"reyansh_19.rg","coins":24,"totalEarned":24,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1478574561460092939": {"id":"1478574561460092939","username":"rajeshkumar0915","coins":24,"totalEarned":24,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1428310572843143178": {"id":"1428310572843143178","username":"ishowibbo","coins":24,"totalEarned":24,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475167317293006988": {"id":"1475167317293006988","username":"dubaidxb2020","coins":23,"totalEarned":23,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1447210705320149144": {"id":"1447210705320149144","username":"faketrustednoxa_39973","coins":23,"totalEarned":23,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1416042449662378165": {"id":"1416042449662378165","username":"bloxy_gamer1","coins":23,"totalEarned":23,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1282938390698000385": {"id":"1282938390698000385","username":"princeopmaster_30131","coins":22,"totalEarned":22,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1390091020724731964": {"id":"1390091020724731964","username":"princegarryx2","coins":22,"totalEarned":22,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1465008759356264613": {"id":"1465008759356264613","username":"prakharr2010_93328","coins":22,"totalEarned":22,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "850245753679249410": {"id":"850245753679249410","username":"ind0lent27","coins":22,"totalEarned":22,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1126434112329240628": {"id":"1126434112329240628","username":"cuayoboy","coins":22,"totalEarned":22,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1422487503239123008": {"id":"1422487503239123008","username":"sigma_x_live","coins":21,"totalEarned":21,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1377625007991296160": {"id":"1377625007991296160","username":"eivind07869","coins":20,"totalEarned":20,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1090741274430156811": {"id":"1090741274430156811","username":"dust_345","coins":20,"totalEarned":20,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1486576383215009853": {"id":"1486576383215009853","username":"monkey910396","coins":20,"totalEarned":20,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1092652332841447496": {"id":"1092652332841447496","username":"saipralaksha","coins":19,"totalEarned":19,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1406057720510939226": {"id":"1406057720510939226","username":"chillh5n2j","coins":19,"totalEarned":19,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1339536756848197665": {"id":"1339536756848197665","username":"saintalv","coins":19,"totalEarned":19,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1443333358569656382": {"id":"1443333358569656382","username":"pro_gamer2011","coins":19,"totalEarned":19,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1393610046784536626": {"id":"1393610046784536626","username":"luffy_plays1234","coins":19,"totalEarned":19,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1389731710693802056": {"id":"1389731710693802056","username":"dx0b","coins":18,"totalEarned":18,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1301693211223265340": {"id":"1301693211223265340","username":"aki097046","coins":18,"totalEarned":18,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1428020925458026596": {"id":"1428020925458026596","username":"kruzok654789555489","coins":17,"totalEarned":17,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1421884819494666413": {"id":"1421884819494666413","username":"fahad063167","coins":17,"totalEarned":17,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1235226832140243016": {"id":"1235226832140243016","username":"bloxfruitpro00122","coins":17,"totalEarned":17,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1336494888883327039": {"id":"1336494888883327039","username":"__12344","coins":16,"totalEarned":16,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1085924992136511568": {"id":"1085924992136511568","username":"raizen_main","coins":16,"totalEarned":16,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1420076445295706254": {"id":"1420076445295706254","username":"nrghahagg_09386","coins":16,"totalEarned":16,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1416084175697477643": {"id":"1416084175697477643","username":"yrash234","coins":16,"totalEarned":16,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1422179921236725790": {"id":"1422179921236725790","username":"mrshadow076239","coins":16,"totalEarned":16,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1391841882144899112": {"id":"1391841882144899112","username":"sungbesthechosenone","coins":15,"totalEarned":15,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1177695859778011186": {"id":"1177695859778011186","username":"gggarden0428","coins":15,"totalEarned":15,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1467547819316478134": {"id":"1467547819316478134","username":"nonchlanteli.","coins":15,"totalEarned":15,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1208010075000545343": {"id":"1208010075000545343","username":"aditya09447","coins":15,"totalEarned":15,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1185967414161195169": {"id":"1185967414161195169","username":"summer16414","coins":15,"totalEarned":15,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475849327455768677": {"id":"1475849327455768677","username":"daring_beetle_55527","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1236744610148253797": {"id":"1236744610148253797","username":"abubakar034828","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1042792530430930996": {"id":"1042792530430930996","username":"belugafanno.1","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1469298249780166747": {"id":"1469298249780166747","username":"yudhavplayz","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1480321340291682416": {"id":"1480321340291682416","username":"gameryt05558","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1476120095666470923": {"id":"1476120095666470923","username":"nishantroblox18","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1433523082383069276": {"id":"1433523082383069276","username":"trey2bov","coins":14,"totalEarned":14,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1418562897180753951": {"id":"1418562897180753951","username":"japmanjot._78931","coins":13,"totalEarned":13,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1185567399513169970": {"id":"1185567399513169970","username":"ares03441","coins":13,"totalEarned":13,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "782695691238768680": {"id":"782695691238768680","username":"sa1259377","coins":13,"totalEarned":13,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1458338726064427153": {"id":"1458338726064427153","username":"abhikillersquad","coins":13,"totalEarned":13,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "733000364487475281": {"id":"733000364487475281","username":"ardakerimyoutube5","coins":13,"totalEarned":13,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "873875544276619335": {"id":"873875544276619335","username":"dev_ddhoni","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1443219149009453198": {"id":"1443219149009453198","username":"greggggoated","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "997039516063903784": {"id":"997039516063903784","username":"seacapisbetter.l2k","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "925377567836483594": {"id":"925377567836483594","username":"mekoae","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1165319029112721460": {"id":"1165319029112721460","username":"killer0550","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1383579917392023796": {"id":"1383579917392023796","username":"yessiritzme_79728","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1037250659541590078": {"id":"1037250659541590078","username":"thechamp132","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1369241674626371618": {"id":"1369241674626371618","username":"rexy10188","coins":12,"totalEarned":12,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1427679025350049802": {"id":"1427679025350049802","username":"shiidkcuzzo","coins":11,"totalEarned":11,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1395454806323368130": {"id":"1395454806323368130","username":"ash10nq","coins":11,"totalEarned":11,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1478192982447358142": {"id":"1478192982447358142","username":"_berry0886","coins":11,"totalEarned":11,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1433751664422031390": {"id":"1433751664422031390","username":"w_steve20","coins":11,"totalEarned":11,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1417519683002830979": {"id":"1417519683002830979","username":"adam_water4","coins":11,"totalEarned":11,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1465678213505093714": {"id":"1465678213505093714","username":"aryab_ieir","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1219875104058638397": {"id":"1219875104058638397","username":"noobeboy._00681","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1438882571038625924": {"id":"1438882571038625924","username":"messi030006","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1396456847497625702": {"id":"1396456847497625702","username":"messithegoat21","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1306803543449276489": {"id":"1306803543449276489","username":"golden_possum_96153","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1453398844397060216": {"id":"1453398844397060216","username":"op101gamer","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1479774501821612102": {"id":"1479774501821612102","username":"celestial_gull_46653","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1451883606359150783": {"id":"1451883606359150783","username":"monkeydluffy09496","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "959971247217848370": {"id":"959971247217848370","username":"wilddragonite2016","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "707301543698759740": {"id":"707301543698759740","username":"marveelisabeth","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1250463847253545082": {"id":"1250463847253545082","username":"devil__ayan","coins":10,"totalEarned":10,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1399753620559237290": {"id":"1399753620559237290","username":"kingkongfanworlds_12825","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1385936087234514964": {"id":"1385936087234514964","username":"ahmedkh0865","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1481718095776317541": {"id":"1481718095776317541","username":"valkryietrader","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1424067375933685960": {"id":"1424067375933685960","username":"wockylol","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1439933526609760286": {"id":"1439933526609760286","username":"sid_1293","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1377107390989864960": {"id":"1377107390989864960","username":"malak096401","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1446828172430540950": {"id":"1446828172430540950","username":"ashborn_rblx","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1291738302227152910": {"id":"1291738302227152910","username":"jjk_goeshard51077","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1487740756608421999": {"id":"1487740756608421999","username":"bonzspider","coins":9,"totalEarned":9,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1103659538399383615": {"id":"1103659538399383615","username":"psg_perfectshot","coins":8,"totalEarned":8,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1482814301289840680": {"id":"1482814301289840680","username":"tv5d","coins":8,"totalEarned":8,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1467194423002534131": {"id":"1467194423002534131","username":"itzreallazo","coins":8,"totalEarned":8,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1164935021287702620": {"id":"1164935021287702620","username":"tsnotantonii","coins":8,"totalEarned":8,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1430052495853355169": {"id":"1430052495853355169","username":"prithvi0430","coins":8,"totalEarned":8,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1106803750292701294": {"id":"1106803750292701294","username":"aarav_6912","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1438466141403091009": {"id":"1438466141403091009","username":"dakesbase_27918","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1469447738461782210": {"id":"1469447738461782210","username":"mohamed5q43","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1467861107095109814": {"id":"1467861107095109814","username":"blade.fire199","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1458953737396551836": {"id":"1458953737396551836","username":"xrayhackerguy","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1327224685687209985": {"id":"1327224685687209985","username":"freds08432_02653","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1455577532924690442": {"id":"1455577532924690442","username":"phantomzonfire","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1444293943075274832": {"id":"1444293943075274832","username":"galcek11_33226","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1360700451363885156": {"id":"1360700451363885156","username":"uttranchal_gamerz","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1473260876273549511": {"id":"1473260876273549511","username":"moosa0503","coins":7,"totalEarned":7,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1441458902209396910": {"id":"1441458902209396910","username":"beni030423","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1400869851622281231": {"id":"1400869851622281231","username":"emperorlegacy","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1397621215853805660": {"id":"1397621215853805660","username":"huntersquad100","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1427298332627304468": {"id":"1427298332627304468","username":"acescout","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1188249757345402962": {"id":"1188249757345402962","username":"anossss","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "999331369614319716": {"id":"999331369614319716","username":"cyborg22","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1432352968707014656": {"id":"1432352968707014656","username":"gurmaan0488","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1389000641363316798": {"id":"1389000641363316798","username":"brett005772","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1311654309674614874": {"id":"1311654309674614874","username":"idk096967","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1382421929759346778": {"id":"1382421929759346778","username":"tunalp_karakaya","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1329908132935372810": {"id":"1329908132935372810","username":"kingahmad0288_76800","coins":6,"totalEarned":6,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1474097345560973332": {"id":"1474097345560973332","username":"arctic_829","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1309277110375940167": {"id":"1309277110375940167","username":"hxpakhi","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1480834266915930164": {"id":"1480834266915930164","username":"akazeno.","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1459973236958695585": {"id":"1459973236958695585","username":"callofduty123.","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1465881129449033750": {"id":"1465881129449033750","username":"dawg08624","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1471402619250409483": {"id":"1471402619250409483","username":"h.k0377","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1355131890193010740": {"id":"1355131890193010740","username":"da0h","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1484991267568881805": {"id":"1484991267568881805","username":"namifywashere","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1439197770413113405": {"id":"1439197770413113405","username":"ahmed8874918","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1409948512182866020": {"id":"1409948512182866020","username":"asiandad0926","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1416318869618032690": {"id":"1416318869618032690","username":"itsabis","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1344714377261088811": {"id":"1344714377261088811","username":"ffgamer0267","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1322962319709311040": {"id":"1322962319709311040","username":"skorpion13911","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1423975694429585499": {"id":"1423975694429585499","username":"kinggod","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1447402565560959038": {"id":"1447402565560959038","username":"justluyy","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1479512788295614597": {"id":"1479512788295614597","username":"rayyanbaba","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1474073671608963183": {"id":"1474073671608963183","username":"hamzamoh573","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "735224854113943663": {"id":"735224854113943663","username":"mamadou07118","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1481597398529736827": {"id":"1481597398529736827","username":"133fxxgcg0","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1433394739234869352": {"id":"1433394739234869352","username":"dbs_aashu","coins":5,"totalEarned":5,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1255565425018929257": {"id":"1255565425018929257","username":"art0o0art","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1467847211575546013": {"id":"1467847211575546013","username":"agentred1121_88432","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1342458554992431146": {"id":"1342458554992431146","username":"aryan080291","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1129726938957758514": {"id":"1129726938957758514","username":"herobrine4878","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1470803656751321302": {"id":"1470803656751321302","username":"immbare","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1474173925561733282": {"id":"1474173925561733282","username":"ayapkarprime","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1047952331318239304": {"id":"1047952331318239304","username":"lylaassss","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1359628491464900611": {"id":"1359628491464900611","username":"ahmed082825","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1470465376855789771": {"id":"1470465376855789771","username":"mmouzzi37vouches_87382","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1476109045587771392": {"id":"1476109045587771392","username":"itz_mepabloooo.xd","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "663836507584331807": {"id":"663836507584331807","username":"seb9am","coins":4,"totalEarned":4,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1197277004010098810": {"id":"1197277004010098810","username":"pigeon.x4","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1412504498949197944": {"id":"1412504498949197944","username":"tn_lakshay","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1290042633640607836": {"id":"1290042633640607836","username":"cyberx73_65390","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1415546159182647367": {"id":"1415546159182647367","username":"6oi7","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1454630193934241842": {"id":"1454630193934241842","username":"itz_yaya2_11688","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475120890155896943": {"id":"1475120890155896943","username":"mxybesoar","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1445798451869777950": {"id":"1445798451869777950","username":"bloxfruitsbuddha_62320","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1471996157491155117": {"id":"1471996157491155117","username":"sandyttd","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1447819090382295113": {"id":"1447819090382295113","username":"vyanbatra","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1323092096734990416": {"id":"1323092096734990416","username":"l.m09._20766","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1482340156282376233": {"id":"1482340156282376233","username":"vac6uw59w","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1483102585765498921": {"id":"1483102585765498921","username":"flamegx467","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1123462336284467271": {"id":"1123462336284467271","username":"moonlighthehe","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1474987094492577853": {"id":"1474987094492577853","username":"aloo90._98035","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1477720013514211377": {"id":"1477720013514211377","username":"2_leodiskord","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1457402854892376114": {"id":"1457402854892376114","username":"viivaann_trader","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1441606730092904548": {"id":"1441606730092904548","username":"goldenpanther0600","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1449754653700128878": {"id":"1449754653700128878","username":"prime_smarth","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1221653750964551800": {"id":"1221653750964551800","username":"aracane.","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1466459587254288520": {"id":"1466459587254288520","username":"noob_alt0460","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1486660926487658639": {"id":"1486660926487658639","username":"benibros.","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1429192760333697204": {"id":"1429192760333697204","username":"pro071450","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1266477360681717935": {"id":"1266477360681717935","username":"er6t78105","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1478423981492142221": {"id":"1478423981492142221","username":"strawberrycat_12_37564","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475922322455007253": {"id":"1475922322455007253","username":"ayeshais67","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1487488945489969236": {"id":"1487488945489969236","username":"cheeseburger4749","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1483772423362056335": {"id":"1483772423362056335","username":"spydersammy678","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1395061033260810425": {"id":"1395061033260810425","username":"mangolover0526_89832","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1454182585033949379": {"id":"1454182585033949379","username":"ttk_gaming4","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1334878230829862923": {"id":"1334878230829862923","username":"4sinan","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "700306043435089970": {"id":"700306043435089970","username":"yunoskiii","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1466084027101610208": {"id":"1466084027101610208","username":"haim0585","coins":3,"totalEarned":3,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1362911203357360158": {"id":"1362911203357360158","username":"hamza_shorza_yt","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1453610983821152287": {"id":"1453610983821152287","username":"rio089307","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1130470180393336882": {"id":"1130470180393336882","username":"jmam88","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1464132331542675507": {"id":"1464132331542675507","username":"middle_man27","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1402197556360118334": {"id":"1402197556360118334","username":"justwantedfr","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1230815638004568095": {"id":"1230815638004568095","username":"tuxynn","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1408543923063754833": {"id":"1408543923063754833","username":"pwrcrafta2000_66074","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1120121149557321748": {"id":"1120121149557321748","username":"zandiboi23","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1470334558770827453": {"id":"1470334558770827453","username":"noob_pro123.","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1395547141778444420": {"id":"1395547141778444420","username":"judepeavy","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1447734881366053000": {"id":"1447734881366053000","username":"yeasirr0192","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1424805033777827924": {"id":"1424805033777827924","username":"ghost_0839","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1175626910181630053": {"id":"1175626910181630053","username":"goatjo0070_26480","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1137666386970300417": {"id":"1137666386970300417","username":"manit_m","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1399299381600977008": {"id":"1399299381600977008","username":"aliking0707_24130","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1440675999585927291": {"id":"1440675999585927291","username":"rimuru_n1","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1286987563671879714": {"id":"1286987563671879714","username":"aadgame","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1466226727536824468": {"id":"1466226727536824468","username":"itsme008727","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1380396440727191662": {"id":"1380396440727191662","username":"tarun_fx","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1387682803487080570": {"id":"1387682803487080570","username":"yz_the_black_dragon","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1481555077218041941": {"id":"1481555077218041941","username":"iamworstsabplayer","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1472249419230609633": {"id":"1472249419230609633","username":"seyar_17.","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1412315441635786883": {"id":"1412315441635786883","username":"ghost_pela007","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "928634115740278854": {"id":"928634115740278854","username":"nick.org.","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1346417432025366611": {"id":"1346417432025366611","username":"jovial_raccoon_25422","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1254386069575569500": {"id":"1254386069575569500","username":"gono0808_88413","coins":2,"totalEarned":2,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1247504567353217057": {"id":"1247504567353217057","username":"divine.01d","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1438912897441992849": {"id":"1438912897441992849","username":"lindseymurphyd89556","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1355147633387241594": {"id":"1355147633387241594","username":"freemanbrandon5313","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1436020585430913135": {"id":"1436020585430913135","username":"jeremycainw17721","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1438931504850927806": {"id":"1438931504850927806","username":"tiffanyjohnsoni69689","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1355148029891706941": {"id":"1355148029891706941","username":"geraldanderson6673","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1355147923024904306": {"id":"1355147923024904306","username":"carlosdouglas9792","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1432002321247633510": {"id":"1432002321247633510","username":"stella.stokes4429","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1407470915545075725": {"id":"1407470915545075725","username":"rashid_ahmad.123","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475067801860440097": {"id":"1475067801860440097","username":"hihello5889","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1241780409659035678": {"id":"1241780409659035678","username":"shauryae..","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "751809097795502201": {"id":"751809097795502201","username":"applery.","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1449821911336091721": {"id":"1449821911336091721","username":"champian_09154936","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1434412140172673024": {"id":"1434412140172673024","username":"654460","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1234715306249683009": {"id":"1234715306249683009","username":"shellshockernoobie","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1440031161383391375": {"id":"1440031161383391375","username":"ily1234.","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1309510690981150792": {"id":"1309510690981150792","username":"hello_1232122","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1407371065373495388": {"id":"1407371065373495388","username":"ironwolfog","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1411744307651809302": {"id":"1411744307651809302","username":"soulaiman0017","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1397215972632301737": {"id":"1397215972632301737","username":"om3r.888","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1326240987915227236": {"id":"1326240987915227236","username":"realmadridfan123.46496","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1443979794739105926": {"id":"1443979794739105926","username":"waveisback","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1469452079922806854": {"id":"1469452079922806854","username":"sungjinwuuthechoosenone","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1092797545715073057": {"id":"1092797545715073057","username":"silentrage_7","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1415707960201580595": {"id":"1415707960201580595","username":"ilovefood_smyeh","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1384936344735973388": {"id":"1384936344735973388","username":"primedevil","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1482243458373648455": {"id":"1482243458373648455","username":"youngoutlaw631","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1465446856887894288": {"id":"1465446856887894288","username":"sweetpotatoes3212006","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1476040212873216030": {"id":"1476040212873216030","username":"hoobstee","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1341708216068870155": {"id":"1341708216068870155","username":"boxedbyrichard.","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1416572988463255592": {"id":"1416572988463255592","username":"anon1378_","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1269325699433496678": {"id":"1269325699433496678","username":"mrmood0862","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1484951780713431141": {"id":"1484951780713431141","username":"kyalt6","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1351683377400385576": {"id":"1351683377400385576","username":"jjdamag_30497","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1444682589355900978": {"id":"1444682589355900978","username":"shayon_gojo.","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1455314979371745343": {"id":"1455314979371745343","username":"sh4dowmyst0768","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1454783498496774232": {"id":"1454783498496774232","username":"needreveenge","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1411402708233097379": {"id":"1411402708233097379","username":"danishx0","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1435424837764907098": {"id":"1435424837764907098","username":"baconhair0822","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1420688194848161812": {"id":"1420688194848161812","username":"rip_era0302","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1443411674345246882": {"id":"1443411674345246882","username":"wild_tuff_ontiktok","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1375809340711112745": {"id":"1375809340711112745","username":"mr_fast_x_trader","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1114658409044779048": {"id":"1114658409044779048","username":"darim3981","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1390353968336474223": {"id":"1390353968336474223","username":"harshveerg12","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1450463597896400897": {"id":"1450463597896400897","username":"i_think_i_am_superman","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1479078051810639986": {"id":"1479078051810639986","username":"noob030030","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1401945142440755220": {"id":"1401945142440755220","username":"64ua","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1429570129368318092": {"id":"1429570129368318092","username":"liam044096","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1420236994075824188": {"id":"1420236994075824188","username":"monkeyblox0450_89898","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1481525230395723887": {"id":"1481525230395723887","username":"zoroy383u4","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1484412792957046856": {"id":"1484412792957046856","username":"lunex_766","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "857483764493582357": {"id":"857483764493582357","username":"krish04329","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1323886851857186836": {"id":"1323886851857186836","username":"cooler06788","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]},
  "1475424837273915452": {"id":"1475424837273915452","username":"defnotarcxx","coins":1,"totalEarned":1,"lastDaily":null,"inventory":[],"redeemedCodes":[]}
};
      await binWrite('users', restored);
      cache.users = restored;
      cacheTime.users = Date.now();
      console.log('✅ Restored 390 users to new bin!');
    } else {
      console.log('✅ Users bin has data — skipping restore');
    }
  } catch(e) { console.error('Restore error:', e.message); }
  // ── END RESTORE ──
  // Purge any old denied/fulfilled claims left over from before the fix
  try {
    const allClaims = await getClaims();
    const cleaned = (Array.isArray(allClaims) ? allClaims : []).filter(c => c.status === 'pending');
    if (cleaned.length !== allClaims.length) {
      await saveClaims(cleaned);
      console.log(`✅ Purged ${allClaims.length - cleaned.length} old non-pending claim(s) from JSONBin`);
    } else {
      console.log('✅ Claims bin is clean');
    }
  } catch (e) { console.error('Claims purge error:', e.message); }
  // Fix any negative coin balances
  try {
    const allUsers = await dbRead('users');
    let fixed = 0;
    for (const uid of Object.keys(allUsers)) {
      if (allUsers[uid] && allUsers[uid].coins < 0) {
        allUsers[uid].coins = Math.abs(allUsers[uid].coins);
        fixed++;
      }
    }
    if (fixed > 0) { await dbWrite('users', allUsers); console.log(`✅ Fixed ${fixed} negative coin balance(s)`); }
    else console.log('✅ No negative balances found');
  } catch(e) { console.error('Balance fix error:', e.message); }
  // Warm codes cache & log how many saved codes exist
  try {
    const codes = await dbRead('codes');
    console.log(`✅ Codes bin loaded — ${Object.keys(codes).length} saved code(s)`);
  } catch (e) { console.error('Codes bin error (did you set the bin ID?):', e.message); }
  await updateStockEmbed(client);
  console.log('✅ Ready');
});

client.on('messageCreate', async msg => {
  if (!msg.guild) return;
  if (msg.author.bot) {
    const s = channelLastMsg.get(msg.channel.id);
    if (s) { s.lastUserId = null; s.count = 0; }
    return;
  }

  // Vouch listener
  if (msg.channel.id === VOUCH_CHANNEL_ID && pendingVouches.has(msg.author.id)) {
    if (/^vouch\s+@\S+\s+.+/i.test(msg.content)) {
      const data = pendingVouches.get(msg.author.id);
      clearTimeout(data.timeout); pendingVouches.delete(msg.author.id);
      try { await msg.react('✅'); } catch {}
      if (data.alertMsg) {
        try { await data.alertMsg.edit({ embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Vouch Received!').setDescription(`<@${msg.author.id}> has now vouched for **${data.itemName}** (\`${data.claimId}\`).\n\n> ${msg.content}`)] }); } catch {}
      }
    }
  }


  // GTN listener
  if (msg.channel.id === GTN_CHANNEL_ID && activeGTN.has(GTN_CHANNEL_ID)) {
    const game = activeGTN.get(GTN_CHANNEL_ID);
    const guess = parseInt(msg.content.trim());
    if (!isNaN(guess) && game.active) {
      if (guess === game.answer) {
        game.active = false; activeGTN.delete(GTN_CHANNEL_ID);
        const winner = await getUser(msg.author.id, msg.author.username);
        winner.coins += game.prize; winner.totalEarned = (winner.totalEarned||0)+game.prize;
        await saveUser(winner);
        sendLog(client,{title:'🎮 GTN Winner!',color:0xF1C40F,fields:[{name:'Winner',value:`<@${msg.author.id}>`,inline:true},{name:'Answer',value:`**${game.answer}**`,inline:true},{name:'Prize',value:`**${game.prize}** ${COIN_EMOJI}`,inline:true},{name:'New Balance',value:`**${winner.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
        try { await msg.channel.send({ embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🎉 We Have a Winner!').setDescription(`<@${msg.author.id}> guessed the number **${game.answer}** correctly! 🏆\n\n**Prize:** **${game.prize}** ${COIN_EMOJI}\n**New balance:** **${winner.coins.toLocaleString()}** ${COIN_EMOJI}`).setFooter({text:`Range was ${game.min}–${game.max}`}).setTimestamp()] }); } catch {}
        return;
      } else if (guess >= game.min && guess <= game.max) {
        try { await msg.react('❌'); } catch {}
      }
    }
  }

  await handleSpamCheck(msg);

  // Only earn coins if allowed (test server = tester role only)
  const canEarn = !isTestServer(msg.guild?.id) || hasTesterRole(msg.member);
  const NO_COIN_CHANNELS = ['1480831806226825308','1481371074309390346','1482076857321914378'];
  const uid = msg.author.id;
  if (canEarn && !NO_COIN_CHANNELS.includes(msg.channel.id)) {
    if (!cache.users) { try { await dbRead('users'); } catch {} }
    if (cache.users) {
      if (!cache.users[uid]) cache.users[uid] = { id:uid, username:msg.author.username, coins:0, totalEarned:0, lastDaily:null, inventory:[], redeemedCodes:[] };
      cache.users[uid]._msgCount = (cache.users[uid]._msgCount || 0) + 1;
      if (cache.users[uid]._msgCount % 2 === 0) {
        cache.users[uid].coins       = (cache.users[uid].coins       || 0) + 1;
        cache.users[uid].totalEarned = (cache.users[uid].totalEarned || 0) + 1;
      }
      cache.users[uid].username    = msg.author.username;
      scheduleCoinFlush();
    } else {
      getUser(uid, msg.author.username).then(u => { u._msgCount=(u._msgCount||0)+1; if(u._msgCount%2===0){u.coins+=1;u.totalEarned=(u.totalEarned||0)+1;} saveUser(u).catch(()=>{}); }).catch(()=>{});
    }
  }

  if (!msg.content.startsWith(PREFIX)) return;
  const args    = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd     = args.shift().toLowerCase();
  const reply   = p => msg.reply(p);
  const isAdmin = msg.member?.permissions.has(PermissionFlagsBits.Administrator);

  try {
    if (cmd==='balance'||cmd==='bal') return await cmdBalance(reply, msg.mentions.users.first()||msg.author);
    if (cmd==='daily')                return await cmdDaily(reply, uid, msg.author.username);
    if (cmd==='shop')                 return await cmdShop(reply);
    if (cmd==='inventory'||cmd==='inv') return await cmdInventory(reply, uid, msg.author.username);
    if (cmd==='lb'||cmd==='leaderboard') return await cmdLeaderboard(reply, msg.guild);
    if (cmd==='help')                 return await cmdHelp(reply);
    if (cmd==='adminhelp'&&isAdmin)   return await cmdAdminHelp(reply);
    if (cmd==='use-code') {
      if (!args[0]) return reply({ embeds:[errEmbed(`Usage: \`${PREFIX}use-code <code>\``)] });
      return await cmdUseCode(reply, uid, msg.author.username, args[0]);
    }
    if (cmd==='rain'&&isAdmin) {
      const amt=parseInt(args[0]);
      if (isNaN(amt)||amt<10) return reply({ embeds:[errEmbed(`Usage: \`${PREFIX}rain <amount>\` (min 10)`)] });
      return await cmdRain(msg, msg.guild, uid, msg.author.username, amt);
    }
    if (cmd==='redeem') {
      if (!args[0]) return reply({ embeds:[errEmbed(`Usage: \`${PREFIX}redeem <itemId>\``)] });
      return await cmdRedeem(reply, uid, msg.author.username, args[0].toLowerCase());
    }
    if (cmd==='give'&&isAdmin) {
      const t=msg.mentions.users.first(), amt=parseInt(args[1]);
      if (!t||isNaN(amt)||amt<1) return reply({ embeds:[errEmbed(`Usage: \`${PREFIX}give @user <amount>\``)] });
      const u=await getUser(t.id,t.username); u.coins+=amt; u.totalEarned=(u.totalEarned||0)+amt; await saveUser(u);
      return reply({ embeds:[okEmbed(`Gave **${amt}** ${COIN_EMOJI} to <@${t.id}>. Balance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`)] });
    }
    if (cmd==='take'&&isAdmin) {
      const t=msg.mentions.users.first(), amt=parseInt(args[1]);
      if (!t||isNaN(amt)||amt<1) return reply({ embeds:[errEmbed(`Usage: \`${PREFIX}take @user <amount>\``)] });
      const u=await getUser(t.id,t.username); u.coins=Math.max(0,u.coins-amt); await saveUser(u);
      return reply({ embeds:[okEmbed(`Took **${amt}** ${COIN_EMOJI} from <@${t.id}>. Balance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`)] });
    }
  } catch(e) {
    console.error(`Prefix ${cmd}:`, e);
    reply({ embeds:[errEmbed('Something went wrong!')] }).catch(()=>{});
  }
});

// ══════════════════════════════════════════
//  COMMAND FUNCTIONS
// ══════════════════════════════════════════
async function cmdBalance(reply, target) {
  const u = await getUser(target.id, target.username);
  return reply({ embeds:[new EmbedBuilder().setColor(0xF1C40F).setAuthor({name:`${target.username}'s Balance`,iconURL:target.displayAvatarURL()}).setDescription(`## ${COIN_EMOJI} ${u.coins.toLocaleString()} coins`).setFooter({text:`Total earned: ${(u.totalEarned||0).toLocaleString()} coins`})] });
}

async function cmdDaily(reply, userId, username) {
  const u=await getUser(userId,username), cd=24*60*60*1000, now=Date.now();
  if (u.lastDaily&&now-u.lastDaily<cd)
    return reply({ embeds:[errEmbed(`Next daily ready ${ts(u.lastDaily+cd)} (${ts(u.lastDaily+cd,'T')})`)] });
  const earned=Math.floor(Math.random()*6)+10;
  u.coins+=earned; u.totalEarned=(u.totalEarned||0)+earned; u.lastDaily=now;
  await saveUser(u);
  sendLog(client,{title:'🎁 Daily Claimed',color:0x57F287,fields:[{name:'User',value:`<@${userId}>`,inline:true},{name:'Reward',value:`+**${earned}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
  return reply({ embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎁 Daily Claimed!').setDescription(`You received **${earned}** ${COIN_EMOJI}!\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`).setFooter({text:'Next daily available'}).setTimestamp(now+cd)] });
}

async function cmdUseCode(reply, userId, username, codeInput) {
  const key  = codeInput.toUpperCase().trim();

  // ── Special: LOOTDROP ──
  if (key === 'LOOTDROP') {
    if (!activeLootDrop || activeLootDrop.claimed)
      return reply({ embeds:[errEmbed(activeLootDrop ? 'This Loot Drop has already been claimed by someone else!' : 'There is no active Loot Drop right now!')] });
    // Mark claimed IMMEDIATELY before any await — prevents race conditions
    activeLootDrop.claimed = true;
    const won = activeLootDrop.coins;
    const dropMsg = activeLootDrop.msg;
    activeLootDrop = null; // fully gone
    // Give coins
    const u = await getUser(userId, username);
    u.coins += won; u.totalEarned = (u.totalEarned||0)+won;
    await saveUser(u);
    // Edit the original drop message to show it's been claimed
    if (dropMsg) {
      try {
        await dropMsg.edit({ embeds:[new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('📦 Loot Drop — CLAIMED!')
          .setDescription(
            `This loot drop has been claimed by **${username}**!\n\n` +
            `🎁 They found **${won}** ${COIN_EMOJI} inside!\n\n` +
            `~~Use \`u!use-code LOOTDROP\` or \`/use-code LOOTDROP\` to claim it!~~`
          )
          .setFooter({ text: 'Better luck next time!' })
          .setTimestamp()] });
      } catch(e) { console.error('Lootdrop edit error:', e.message); }
    }
    sendLog(client,{title:'📦 Loot Drop Claimed!',color:0xF1C40F,fields:[{name:'Winner',value:`<@${userId}>`,inline:true},{name:'Coins Won',value:`**${won}** ${COIN_EMOJI}`,inline:true},{name:'New Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
    return reply({ embeds:[new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('📦 Loot Drop Claimed!')
      .setDescription(`You opened the mystery box and found **${won}** ${COIN_EMOJI}!\n\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}\n\n🎉 You were first!`)] });
  }

  const code = await getCode(key);
  if (!code) return reply({ embeds:[errEmbed(`Code \`${key}\` doesn't exist!`)] });
  if (code.expiresAt && Date.now() > code.expiresAt)
    return reply({ embeds:[errEmbed(`Code \`${key}\` has expired!`)] });
  const u = await getUser(userId, username);
  const alreadyUsed = code.multiUse
    ? (code.redeemedBy || []).includes(userId)
    : u.redeemedCodes.includes(key);
  if (alreadyUsed) return reply({ embeds:[errEmbed(`You've already redeemed \`${key}\`!`)] });

  // Update redemption tracking
  if (code.multiUse) {
    code.redeemedBy = code.redeemedBy || [];
    code.redeemedBy.push(userId);
    // Save updated redeemedBy back (only for non-permanent codes)
    if (!(key in PERMANENT_CODES)) await saveCode(key, code);
  } else {
    u.redeemedCodes.push(key);
  }
  u.coins += code.coins; u.totalEarned = (u.totalEarned||0)+code.coins;
  await saveUser(u);
  sendLog(client,{title:'🎟️ Code Redeemed',color:0x57F287,fields:[{name:'User',value:`<@${userId}>`,inline:true},{name:'Code',value:`\`${key}\``,inline:true},{name:'Coins',value:`+**${code.coins}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
  return reply({ embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎟️ Code Redeemed!').setDescription(`${code.description}\nYou received **${code.coins}** ${COIN_EMOJI}!\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}${code.expiresAt?`\nCode expires ${ts(code.expiresAt)}`:''}`)] });
}

async function cmdShop(reply) {
  const robuxLines=SHOP.filter(i=>i.category==='Robux').map(i=>`${ROBUX_EMOJI} **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const etfbLines=SHOP.filter(i=>i.category==='ETFB').map(i=>`${i.id==='etfb_cel'?'✨':'🌟'} **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const NITRO_EMOJI='<:Nitro:1482656844655624192>';
  const nitroLines=SHOP.filter(i=>i.category==='Nitro').map(i=>`${NITRO_EMOJI} **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const roleLines=SHOP.filter(i=>i.category==='CustomRole').map(i=>`🎨 **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const ps99Lines=SHOP.filter(i=>i.category==='PS99').map(i=>`💎 **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const spLines=SHOP.filter(i=>i.category==='SailorPiece').map(i=>`⚔️ **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const crLines=`🎌 **Crunchyroll Account** — \`6 invites\`  ·  \`crunchyroll\``;
  return reply({ embeds:[new EmbedBuilder().setTitle('🏪 Rewards Shop').setColor(0x9B59B6).addFields({name:'💎 Robux',value:robuxLines,inline:false},{name:'🎮 ETFB',value:etfbLines,inline:false},{name:`<:Nitro:1482656844655624192> Nitro`,value:nitroLines,inline:false},{name:'🎨 Custom Role',value:roleLines||'—',inline:false},{name:'💎 PS99 Gems',value:ps99Lines||'—',inline:false},{name:'⚔️ Sailor Piece',value:spLines||'—',inline:false},{name:'🎌 Crunchyroll',value:crLines,inline:false}).setFooter({text:'Buy: /redeem  |  Then: /claim <id> | Crunchyroll requires 6 invites'})] });
}

async function cmdInventory(reply, userId, username) {
  const u=await getUser(userId,username), inv=u.inventory||[];
  if (!inv.length) return reply({ embeds:[errEmbed('Your inventory is empty! Use `/redeem` to buy items.')] });
  const list=inv.map(item=>{const e=item.category==='Robux'?'💎':item.name==='Divine'?'🌟':'✨'; return `${e} **${item.name}** — \`${item.claimId}\`\n> \`/claim ${item.claimId}\` to submit`;}).join('\n\n');
  return reply({ embeds:[new EmbedBuilder().setTitle(`🎒 ${username}'s Inventory`).setColor(0x9B59B6).setDescription(list).setFooter({text:`${inv.length} item(s) · /claim <id> to submit`})] });
}

async function cmdLeaderboard(reply, guild) {
  const top=await getLeaderboard(50), medals=['🥇','🥈','🥉'], filtered=[];
  for (const u of top) {
    if (filtered.length>=10) break;
    try { const m=await guild.members.fetch(u.id); if(!m.permissions.has(PermissionFlagsBits.Administrator)) filtered.push(u); } catch {}
  }
  const list=filtered.map((u,i)=>`${medals[i]||`**${i+1}.**`} <@${u.id}> — **${u.coins.toLocaleString()}** ${COIN_EMOJI}`).join('\n');
  return reply({ embeds:[new EmbedBuilder().setTitle('🏆 Coin Leaderboard').setColor(0xF1C40F).setDescription(list||'No data yet!')] });
}

async function cmdHelp(reply) {
  return reply({ embeds:[new EmbedBuilder().setTitle(`📖 Help — Prefix: \`${PREFIX}\``).setColor(0x5865F2).addFields(
    {name:'💰 Economy',value:`\`${PREFIX}balance\` — check your ${COIN_EMOJI}\n\`${PREFIX}daily\` — 10–15 ${COIN_EMOJI} every 24h\n\`${PREFIX}leaderboard\` — top 10\n💬 Every message = 1 ${COIN_EMOJI}`,inline:false},
    {name:'🛒 Shop',value:`\`${PREFIX}shop\` — view items & prices\n\`${PREFIX}redeem <id>\` — buy an item\n\`${PREFIX}inventory\` — view your items\n\`/claim <id>\` — submit a delivery claim`,inline:false},
    {name:'🎟️ Codes',value:`\`/use-code <code>\` or \`${PREFIX}use-code <code>\``,inline:false},
    {name:'🎲 Gambling',value:`\`/coinflip <bet> <heads|tails>\` — flip a coin\n\`/slots <bet>\` — spin the slot machine\n\`/blackjack <bet>\` — play blackjack\n\`/doubleornothing <bet>\` — double or lose it all`,inline:false}
  )] });
}

async function cmdAdminHelp(reply) {
  return reply({ embeds:[new EmbedBuilder().setTitle('🔒 Admin Commands').setColor(0xFF6B35).addFields(
    {name:'📦 Stock',value:`/update-robux <amount>\n/update-etfb <type> <amount>`,inline:false},
    {name:'👥 Coins',value:`/give @user <amount>\n/take @user <amount>`,inline:false},
    {name:'🌧️ Rain',value:`/rain <amount> — 2 min reaction rain`,inline:false},
    {name:'📋 Claims',value:`/claims\n/claimed <id>\n/deny-claim <id> [reason]`,inline:false},
    {name:'🎒 Inventory',value:`/check-inventory @user\n/remove-inv @user <id>`,inline:false},
    {name:'🎟️ Codes',value:`/make-code — permanent saved code\n/drop-code — time-limited drop\n/remove-code — delete a code\n/list-codes — see all active codes`,inline:false},
    {name:'🔢 Games',value:`/gtn <min> <max> <number> <prize>`,inline:false},
    {name:'🛡️ Moderation',value:`/timeout /untimeout /warn /unwarn /warns /kick /ban`,inline:false}
  )] });
}

async function cmdRedeem(reply, userId, username, itemId) {
  const item=SHOP.find(i=>i.id===itemId);
  if (!item) return reply({ embeds:[errEmbed('Unknown item ID. Use `/shop` to see valid IDs.')] });
  const u=await getUser(userId,username);
  if (u.coins<item.cost) return reply({ embeds:[errEmbed(`Need **${item.cost}** ${COIN_EMOJI}, you only have **${u.coins}**!`)] });
  const store=await getStore();
  if (item.id==='etfb_cel'&&store.celestials<=0) return reply({ embeds:[errEmbed('Celestials are out of stock!')] });
  if (item.id==='etfb_div'&&store.divines<=0)    return reply({ embeds:[errEmbed('Divines are out of stock!')] });
  if (item.category==='Robux'&&store.robux<item.robuxAmt) return reply({ embeds:[errEmbed(`Only **${store.robux}** Robux in stock!`)] });
  if (item.id==='etfb_cel')      store.celestials=Math.max(0,store.celestials-1);
  else if (item.id==='etfb_div') store.divines=Math.max(0,store.divines-1);
  else                           store.robux=Math.max(0,store.robux-item.robuxAmt);
  await saveStore(store); await updateStockEmbed(client);
  const claimId=await nextClaimId();
  u.coins=Math.max(0,u.coins-item.cost);
  u.inventory.push({claimId,itemId:item.id,name:item.name,category:item.category,robuxAmt:item.robuxAmt,cost:item.cost});
  await saveUser(u);
  sendLog(client,{title:'🛒 Item Redeemed',color:0x9B59B6,fields:[{name:'User',value:`<@${userId}>`,inline:true},{name:'Item',value:item.name,inline:true},{name:'Cost',value:`**${item.cost}** ${COIN_EMOJI}`,inline:true},{name:'Claim ID',value:`\`${claimId}\``,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
  return reply({ embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎒 Added to Inventory!').setDescription(`**${item.name}** is now in your inventory!\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}\n\n📬 Claim ID: \`${claimId}\`\nUse \`/claim ${claimId}\` to submit!`)] });
}

async function cmdRain(msgOrInteraction, guild, senderId, senderName, amount) {
  const isInt=!!msgOrInteraction.deferReply;
  const sender=await getUser(senderId,senderName);
  const errR=t=>{const e=errEmbed(t);return isInt?msgOrInteraction.editReply({embeds:[e]}):msgOrInteraction.reply({embeds:[e]});};
  if (sender.coins<amount) return errR(`You only have **${sender.coins}** ${COIN_EMOJI}!`);
  sendLog(client,{title:'🌧️ Coin Rain Started',color:0x3498DB,fields:[{name:'Admin',value:`<@${senderId}>`,inline:true},{name:'Amount',value:`**${amount}** ${COIN_EMOJI}`,inline:true},{name:'Duration',value:'2 minutes',inline:true}]});
  const endsAt=Date.now()+2*60*1000;
  const rainEmbed=new EmbedBuilder().setColor(0x3498DB).setTitle('🌧️ Coin Rain — React to Enter!').setDescription(`<@${senderId}> is raining **${amount}** ${COIN_EMOJI}!\n\nReact with 🌧️ to enter!\nCoins split equally.\n\n⏰ Ends ${ts(endsAt)} (${ts(endsAt,'T')} your time)`);
  let rainMsg;
  if (isInt) { await msgOrInteraction.editReply({embeds:[rainEmbed]}); rainMsg=await msgOrInteraction.fetchReply(); }
  else rainMsg=await msgOrInteraction.reply({embeds:[rainEmbed]});
  await rainMsg.react('🌧️');
  setTimeout(async()=>{
    try {
      const fresh=await rainMsg.fetch(), reaction=fresh.reactions.cache.get('🌧️');
      let reactors=[];
      if (reaction) { const users=await reaction.users.fetch(); reactors=[...users.values()].filter(u=>!u.bot&&u.id!==senderId); }
      if (!reactors.length) return rainMsg.reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🌧️ Rain Ended').setDescription(`Nobody reacted! **${amount}** ${COIN_EMOJI} refunded to <@${senderId}>.`)]});
      const per=Math.floor(amount/reactors.length);
      if (per<1) return rainMsg.reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🌧️ Rain Ended').setDescription(`Too many reactors! **${amount}** ${COIN_EMOJI} refunded to <@${senderId}>.`)]});
      const totalGiven=per*reactors.length;
      const su=await getUser(senderId,senderName); su.coins=Math.max(0,su.coins-totalGiven); await saveUser(su);
      const names=[];
      for (const r of reactors) { const u=await getUser(r.id,r.username); u.coins+=per; u.totalEarned=(u.totalEarned||0)+per; await saveUser(u); names.push(`<@${r.id}>`); }
      sendLog(client,{title:'🌧️ Rain Finished',color:0x57F287,fields:[{name:'Sender',value:`<@${senderId}>`,inline:true},{name:'Total Paid',value:`**${totalGiven}** ${COIN_EMOJI}`,inline:true},{name:'Winners',value:`${reactors.length} members`,inline:true},{name:'Per Person',value:`**${per}** ${COIN_EMOJI}`,inline:true}]});
      await rainMsg.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🌧️ Rain Finished!').setDescription(`<@${senderId}> rained **${totalGiven}** ${COIN_EMOJI} across **${reactors.length}** members!\nEach got **${per}** ${COIN_EMOJI}\n\n**Winners:** ${names.join(' ')}`)]});
    } catch(e){console.error('Rain end error:',e.message);}
  },2*60*1000);
}

// ══════════════════════════════════════════
//  INTERACTION HANDLER
// ══════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  // ── BLACKJACK BUTTON HANDLER ──
  // ── GAME JOIN / INTERACTION BUTTONS ──
  if (interaction.isButton()) {
    const cid = interaction.customId;

    // Chair Game join
    if (cid.startsWith('cg_join_')) {
      const gwId = cid.replace('cg_join_','');
      const game = [...activeChairGame.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('This lobby has expired.')],flags:MessageFlags.Ephemeral});
      if (game.phase!=='joining') return interaction.reply({embeds:[errEmbed('Game already started!')],flags:MessageFlags.Ephemeral});
      game.players.add(interaction.user.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You joined the Chair Game! **${game.players.size}** player(s) in lobby.`)],flags:MessageFlags.Ephemeral});
    }

    // Chair Game round click
    if (cid.startsWith('cgr_')) {
      const parts = cid.split('_');
      const gwId = parts[1]; const round = parseInt(parts[2]);
      const game = [...activeChairGame.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('Game not found.')],flags:MessageFlags.Ephemeral});
      if (!game.players.has(interaction.user.id)) return interaction.reply({embeds:[errEmbed('You are not in this game!')],flags:MessageFlags.Ephemeral});
      if (game.round!==round) return interaction.reply({embeds:[errEmbed('This round has ended.')],flags:MessageFlags.Ephemeral});
      if (!game.clickedThisRound) game.clickedThisRound = new Set();
      game.clickedThisRound.add(interaction.user.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ You clicked!')],flags:MessageFlags.Ephemeral});
    }

    // Mafia join
    if (cid.startsWith('mf_join_')) {
      const gwId = cid.replace('mf_join_','');
      const game = [...activeMafia.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('This lobby has expired.')],flags:MessageFlags.Ephemeral});
      if (game.phase!=='joining') return interaction.reply({embeds:[errEmbed('Game already started!')],flags:MessageFlags.Ephemeral});
      game.players.add(interaction.user.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You joined Mafia! **${game.players.size}** player(s) in lobby.`)],flags:MessageFlags.Ephemeral});
    }

    // Pick a Number join
    if (cid.startsWith('pn_join_')) {
      const gwId = cid.replace('pn_join_','');
      const game = [...activePickNumber.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('This lobby has expired.')],flags:MessageFlags.Ephemeral});
      if (game.phase!=='joining') return interaction.reply({embeds:[errEmbed('Game already started!')],flags:MessageFlags.Ephemeral});
      game.players.add(interaction.user.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You joined Pick a Number! **${game.players.size}** player(s) in lobby.`)],flags:MessageFlags.Ephemeral});
    }

    // Pick a Number grid pick
    if (cid.startsWith('pn_pick_')) {
      const parts = cid.split('_');
      const gwId = parts[2]; const round = parseInt(parts[3]); const num = parseInt(parts[4]);
      const game = [...activePickNumber.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('Game not found.')],flags:MessageFlags.Ephemeral});
      if (!game.players.has(interaction.user.id)) return interaction.reply({embeds:[errEmbed('You are not in this game!')],flags:MessageFlags.Ephemeral});
      if (game.round!==round) return interaction.reply({embeds:[errEmbed('This round has ended.')],flags:MessageFlags.Ephemeral});
      if (game.picks.has(interaction.user.id)) return interaction.reply({embeds:[errEmbed(`You already picked **${game.picks.get(interaction.user.id)}**!`)],flags:MessageFlags.Ephemeral});
      game.picks.set(interaction.user.id, num);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You picked **${num}**! Wait for the round to end.`)],flags:MessageFlags.Ephemeral});
    }

    // Spin the Wheel enter
    if (cid.startsWith('sw_enter_')) {
      const swId = cid.replace('sw_enter_','');
      const state = [...activeSpinWheel.values()].find(s=>s.swId===swId);
      if (!state) return interaction.reply({embeds:[errEmbed('This event has ended.')],flags:MessageFlags.Ephemeral});
      if (state.entries.has(interaction.user.id)) return interaction.reply({embeds:[errEmbed('You already entered!')],flags:MessageFlags.Ephemeral});
      if (state.entries.size >= state.maxEntries) return interaction.reply({embeds:[errEmbed(`Max entries reached (${state.maxEntries})!`)],flags:MessageFlags.Ephemeral});
      state.entries.add(interaction.user.id);
      try {
        const ch = await client.channels.fetch(state.channelId);
        const msg = await ch.messages.fetch(state.msgId);
        const existingEmbed = msg.embeds[0];
        await msg.edit({embeds:[EmbedBuilder.from(existingEmbed).setFooter({text:`${state.entries.size}/${state.maxEntries} entered`})],components:msg.components});
      } catch {}
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You entered the Spin the Wheel! **${state.entries.size}/${state.maxEntries}** entered.`)],flags:MessageFlags.Ephemeral});
    }

    // ── SAB STOCK VIEW ──
    if (cid === 'sab_view') {
      const sab = await dbRead('sab');
      const items = Array.isArray(sab) ? sab.filter(i => i && i.item) : [];
      if (!items.length) return interaction.reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('🛍️ SAB Stock').setDescription('No SAB items in stock right now.')],flags:MessageFlags.Ephemeral});
      const lines = items.map(i => `**${i.item}**${i.worth ? ` | 💵 ${i.worth}` : ''} | ${i.price.toLocaleString()} ${COIN_EMOJI}`).join('\n');
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle('🛍️ SAB Stock').setDescription(lines).setFooter({text:'💵 = Making Money rate · Buy via /redeem-sab <item name>'})],flags:MessageFlags.Ephemeral});
    }

    return; // no matching button
  }

  // ── CHECK-USER PAGINATION (also inside button handler above via fall-through) ──
  if (interaction.isButton() && (interaction.customId.startsWith('cu_prev_') || interaction.customId.startsWith('cu_next_'))) {
    const [,dir, pageStr] = interaction.customId.split('_');
    const currentPage = parseInt(pageStr);
    const newPage = dir === 'next' ? currentPage + 1 : currentPage - 1;
    const data = await dbRead('roblox');
    const entries = Object.entries(data).filter(([k]) => k !== '_init');
    const perPage = 15;
    const pages = [];
    for (let i = 0; i < entries.length; i += perPage) {
      pages.push(entries.slice(i, i + perPage).map(([uid, d]) => `<@${uid}> — \`${d.robloxUsername}\``).join('\n'));
    }
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🎮 Linked Roblox Users — ${entries.length} total`).setDescription(pages[newPage]).setFooter({text:`Page ${newPage+1} of ${pages.length}`});
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cu_prev_${newPage}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(newPage===0),
      new ButtonBuilder().setCustomId(`cu_next_${newPage}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(newPage===pages.length-1)
    );
    return interaction.update({embeds:[embed], components:[buttons]});
  }
  if (interaction.isButton() && (interaction.customId === 'bj_hit' || interaction.customId === 'bj_stand')) {
    const game = activeBlackjack.get(interaction.user.id);
    if (!game) return interaction.reply({embeds:[errEmbed('No active game! Start one with `/blackjack`.')],flags:MessageFlags.Ephemeral});
    if (game.userId !== interaction.user.id) return interaction.reply({embeds:[errEmbed("This isn't your game!")],flags:MessageFlags.Ephemeral});
    await interaction.deferUpdate();

    if (interaction.customId === 'bj_hit') {
      game.player.push(bjDraw());
      const pt = bjTotal(game.player);
      if (pt > 21) {
        activeBlackjack.delete(interaction.user.id);
        const u = await getUser(interaction.user.id, interaction.user.username);
        u.coins = Math.max(0, u.coins - game.bet);
        await saveUser(u);
        const embed = bjEmbed(game, 'lose');
        embed.addFields({name:'💥 Bust!',value:`Lost **${game.bet.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true});
        return interaction.editReply({embeds:[embed],components:[bjButtons(true)]});
      }
      if (pt === 21) game.standing = true;
      if (game.standing) {
        while(bjTotal(game.dealer) < 17) game.dealer.push(bjDraw());
        const pt2=bjTotal(game.player), dt=bjTotal(game.dealer);
        const win=dt>21||pt2>dt, push=pt2===dt;
        activeBlackjack.delete(interaction.user.id);
        const u = await getUser(interaction.user.id, interaction.user.username);
        if(win){u.coins+=game.bet;u.totalEarned=(u.totalEarned||0)+game.bet;}
        else if(!push){u.coins=Math.max(0,u.coins-game.bet);}
        await saveUser(u);
        const embed = bjEmbed(game, win?'win':push?'push':'lose');
        embed.addFields({name:dt>21?'💥 Dealer Bust!':win?'🎉 Win!':push?'🤝 Push':'🏦 Dealer Wins',value:`${win?'Won':push?'Returned':'Lost'} **${game.bet.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true});
        return interaction.editReply({embeds:[embed],components:[bjButtons(true)]});
      }
      return interaction.editReply({embeds:[bjEmbed(game,'playing')],components:[bjButtons()]});
    }

    if (interaction.customId === 'bj_stand') {
      while(bjTotal(game.dealer) < 17) game.dealer.push(bjDraw());
      const pt=bjTotal(game.player), dt=bjTotal(game.dealer);
      const win=dt>21||pt>dt, push=pt===dt;
      activeBlackjack.delete(interaction.user.id);
      const u = await getUser(interaction.user.id, interaction.user.username);
      if(win){u.coins+=game.bet;u.totalEarned=(u.totalEarned||0)+game.bet;}
      else if(!push){u.coins=Math.max(0,u.coins-game.bet);}
      await saveUser(u);
      sendLog(client,{title:'🃏 Blackjack',color:win?0x57F287:push?0xFEE75C:0xED4245,fields:[{name:'Player',value:`<@${interaction.user.id}>`,inline:true},{name:'Result',value:win?'Win':push?'Push':'Loss',inline:true},{name:win?'Won':push?'Returned':'Lost',value:`**${game.bet.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
      const embed = bjEmbed(game, win?'win':push?'push':'lose');
      embed.addFields({name:dt>21?'💥 Dealer Bust!':win?'🎉 Win!':push?'🤝 Push':'🏦 Dealer Wins',value:`${win?'Won':push?'Returned':'Lost'} **${game.bet.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true});
      return interaction.editReply({embeds:[embed],components:[bjButtons(true)]});
    }
    return;
  }



  // ── CUSTOM ROLE MODAL ──
  if (interaction.isModalSubmit() && interaction.customId.startsWith('role_modal_')) {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const claimId = interaction.customId.replace('role_modal_','');
    const roleName  = interaction.fields.getTextInputValue('role_name').trim();
    const roleColor = interaction.fields.getTextInputValue('role_color').trim();

    // Color name map
    const COLOR_NAMES = {
      red:'#FF0000',orange:'#FF7F00',yellow:'#FFFF00',green:'#00FF00',blue:'#0000FF',
      purple:'#800080',pink:'#FF69B4',cyan:'#00FFFF',white:'#FFFFFF',black:'#000000',
      grey:'#808080',gray:'#808080',brown:'#A52A2A',gold:'#FFD700',silver:'#C0C0C0',
      lime:'#00FF00',teal:'#008080',navy:'#000080',magenta:'#FF00FF',violet:'#EE82EE',
      indigo:'#4B0082',turquoise:'#40E0D0',coral:'#FF7F50',salmon:'#FA8072',
      maroon:'#800000',olive:'#808000',aqua:'#00FFFF',lavender:'#E6E6FA',
    };
    let hexColor = roleColor.startsWith('#') ? roleColor : (COLOR_NAMES[roleColor.toLowerCase()] || null);
    if (!hexColor || !/^#[0-9A-Fa-f]{6}$/.test(hexColor)) {
      return interaction.editReply({embeds:[errEmbed(`Invalid colour **${roleColor}**! Use a hex code like \`#FF5733\` or a colour name like \`Red\`, \`Cyan\`, \`Gold\`, etc.`)]});
    }

    // Inappropriate name check — basic filter
    const BAD_WORDS = ['nigger','nigga','faggot','retard','nazi','hitler','rape','sex','porn','dick','pussy','fuck','shit','bitch','cunt','whore','slut','ass','kkk'];
    const nameLower = roleName.toLowerCase().replace(/[^a-z0-9]/g,'');
    if (BAD_WORDS.some(w => nameLower.includes(w))) {
      // Kick the user
      sendLog(client,{title:'🚨 Inappropriate Role Name — User Kicked',color:0xED4245,fields:[{name:'User',value:`<@${interaction.user.id}>`,inline:true},{name:'Name Attempted',value:roleName,inline:true}]});
      try {
        await interaction.user.send({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('👢 Kicked').setDescription(`You were kicked from **${interaction.guild.name}** for submitting an inappropriate role name: **${roleName}**`)]});
      } catch {}
      try { await interaction.guild.members.kick(interaction.user.id, 'Inappropriate custom role name'); } catch(e){ console.error('Kick failed:',e.message); }
      return interaction.editReply({embeds:[errEmbed('Inappropriate name detected. You have been kicked.')]});
    }

    // Remove item from inventory
    const u = await getUser(interaction.user.id, interaction.user.username);
    const idx = (u.inventory||[]).findIndex(i=>i.claimId===claimId);
    if (idx !== -1) { u.inventory.splice(idx,1); await saveUser(u); }

    // Create the role immediately
    try {
      const hexInt = parseInt(hexColor.replace('#',''), 16);
      const newRole = await interaction.guild.roles.create({
        name: roleName,
        color: hexInt,
        permissions: [],
        reason: `Custom role for ${interaction.user.username}`
      });
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(newRole);
      sendLog(client,{title:'🎨 Custom Role Created',color:0xE91E63,fields:[{name:'User',value:`<@${interaction.user.id}>`,inline:true},{name:'Role',value:`${roleName}`,inline:true},{name:'Colour',value:hexColor,inline:true}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(hexInt).setTitle('🎨 Custom Role Created!').setDescription(`Your custom role has been created and given to you!\n\n**Role:** ${roleName}\n**Colour:** ${hexColor}\n\nYou can see it in your roles now! 🎉`)]});
    } catch(e) {
      console.error('Role create error:', e.message);
      // Fallback to claim if bot lacks permission
      const claimsArr = await getClaims();
      claimsArr.push({claimId,userId:interaction.user.id,username:interaction.user.username,itemId:'custom_role',itemName:'Custom Role',category:'CustomRole',robuxAmt:0,robloxUsername:'N/A',roleDetails:{name:roleName,color:hexColor},claimedAt:Date.now(),status:'pending'});
      await saveClaims(claimsArr);
      sendLog(client,{title:'🎨 Custom Role Claim (manual)',color:0xFEE75C,fields:[{name:'User',value:`<@${interaction.user.id}>`,inline:true},{name:'Role Name',value:roleName,inline:true},{name:'Colour',value:hexColor,inline:true},{name:'Error',value:e.message,inline:false}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('🎨 Custom Role Queued').setDescription(`Could not create automatically — submitted as claim \`${claimId}\`\nAn admin will create your role shortly!\n\n**Name:** ${roleName}\n**Colour:** ${hexColor}`)]});
    }
    const claimsArr_UNUSED = await getClaims();
    claimsArr.push({claimId,userId:interaction.user.id,username:interaction.user.username,itemId:'custom_role',itemName:'Custom Role',category:'CustomRole',robuxAmt:0,robloxUsername:'N/A',roleDetails:{name:roleName,color:hexColor},claimedAt:Date.now(),status:'pending'});
    await saveClaims(claimsArr);
    sendLog(client,{title:'🎨 Custom Role Claim Submitted',color:0xE91E63,fields:[{name:'User',value:`<@${interaction.user.id}>`,inline:true},{name:'Role Name',value:roleName,inline:true},{name:'Colour',value:hexColor,inline:true},{name:'Claim ID',value:`\`${claimId}\``,inline:true}]});
    return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎨 Custom Role Submitted!').setDescription(`Your custom role request has been submitted!\n\n**Name:** ${roleName}\n**Colour:** ${hexColor}\n**Claim ID:** \`${claimId}\`\n\nAn admin will create your role shortly!`)]});
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith('claim_modal_')) return;
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const claimId=interaction.customId.replace('claim_modal_','');
    const u=await getUser(interaction.user.id,interaction.user.username);
    const idx=(u.inventory||[]).findIndex(i=>i.claimId===claimId);
    if (idx===-1) return interaction.editReply({embeds:[errEmbed('Item not found in your inventory.')]});
    const item=u.inventory[idx];
    const robloxUser=interaction.fields.getTextInputValue('roblox_username').trim();
    const gamepassLink=item.category==='Robux'?interaction.fields.getTextInputValue('gamepass_link').trim():null;
    const claims=await getClaims(), claimsArr=Array.isArray(claims)?claims:[];
    claimsArr.push({claimId,userId:interaction.user.id,username:interaction.user.username,itemId:item.itemId||item.id,itemName:item.name,category:item.category,robuxAmt:item.robuxAmt||0,robloxUsername:robloxUser,gamepassLink:gamepassLink||null,claimedAt:Date.now(),status:'pending'});
    await saveClaims(claimsArr);
    sendLog(client,{title:'📋 Claim Submitted',color:0x5865F2,fields:[{name:'User',value:`<@${interaction.user.id}>`,inline:true},{name:'Claim ID',value:`\`${claimId}\``,inline:true},{name:'Item',value:item.name,inline:true},{name:'Roblox Username',value:robloxUser,inline:true},{name:'Category',value:item.category,inline:true}]});
    u.inventory.splice(idx,1); await saveUser(u);
    return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('📬 Claim Submitted!').setDescription(`Your claim for **${item.name}** has been submitted!\n\n**Claim ID:** \`${claimId}\`\n**Roblox:** \`${robloxUser}\`\n${gamepassLink?`**Gamepass:** ${gamepassLink}\n`:''}\nAn admin will process this shortly!`)]});
  }

  if (!interaction.isChatInputCommand()) return;
  const cmd=interaction.commandName, me=interaction.user, reply=p=>interaction.reply(p);
    const isTestSrv = isTestServer(interaction.guildId);
    // Test server: block non-testers with an error
    if (isTestSrv && !hasTesterRole(interaction.member) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      const testerOnly = ['give','take','rain','update-robux','update-etfb','claims','claimed','deny-claim','remove-inv','check-inventory','make-code','drop-code','remove-code','list-codes','gtn','timeout','untimeout','warn','unwarn','warns','kick','ban','lootdrop','check-user','find-user','game-night-start','update-sab','remove-stock-sab','giveaway','chair-game','mafia','pick-number'];
      if (!testerOnly.includes(cmd)) {} // non-admin cmds always allowed
    }

  try {
    if (cmd==='balance')     return await cmdBalance(reply, interaction.options.getUser('user')||me);
    if (cmd==='daily') { if (isTestSrv && !hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role to earn rewards in this server!')],flags:MessageFlags.Ephemeral}); return await cmdDaily(reply, me.id, me.username); }
    if (cmd==='shop')        return await cmdShop(reply);
    if (cmd==='inventory')   return await cmdInventory(reply, me.id, me.username);
    if (cmd==='leaderboard') return await cmdLeaderboard(reply, interaction.guild);
    if (cmd==='help')        return await cmdHelp(reply);
    if (cmd==='adminhelp')   return await cmdAdminHelp(reply);
    if (cmd==='use-code')    return await cmdUseCode(reply, me.id, me.username, interaction.options.getString('code'));
    if (cmd==='rain') { await interaction.deferReply(); return await cmdRain(interaction, interaction.guild, me.id, me.username, interaction.options.getInteger('amount')); }
    if (cmd==='redeem'||cmd==='redeem-ps99'||cmd==='redeem-sp') { await interaction.deferReply(); return await cmdRedeem(p=>interaction.editReply(p), me.id, me.username, interaction.options.getString('item')); }

    if (cmd==='claim') {
      const idArg=interaction.options.getString('id').toUpperCase();
      const u=await getUser(me.id,me.username), item=(u.inventory||[]).find(i=>i.claimId===idArg);
      if (!item) return reply({embeds:[errEmbed(`No item \`${idArg}\` in your inventory.`)],flags:MessageFlags.Ephemeral});

      // Custom Role: special modal with name + colour
      if (item.category==='CustomRole' || item.category==='TestCustomRole') {
        const modal = new ModalBuilder().setCustomId(`role_modal_${item.claimId}`).setTitle('🎨 Custom Role Setup');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role_name').setLabel('Role Name').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Galaxy King').setRequired(true).setMaxLength(32)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role_color').setLabel('Role Colour (hex #RRGGBB or colour name)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. #FF5733 or Cyan or Red').setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // Auto-submit categories (no modal needed)
      const autoCategories = ['Nitro','PS99','SailorPiece','Crunchyroll'];
      if (autoCategories.includes(item.category)) {
        await interaction.deferReply({flags:MessageFlags.Ephemeral});

        // Crunchyroll: check stock
        if (item.category==='Crunchyroll') {
          const cr = await dbRead('crunchyroll');
          if (!cr.stock || cr.stock <= 0) return interaction.editReply({embeds:[errEmbed('Crunchyroll accounts are out of stock!')]});
          cr.stock--;
          await dbWrite('crunchyroll', cr);
        }

        u.inventory.splice(u.inventory.findIndex(i=>i.claimId===idArg),1);
        await saveUser(u);

        // Build instructions per category
        let instructions = '';
        if (item.category==='PS99') instructions = `\n\n📝 **Your username:** \`${me.username}\`\nAn admin will send your gems in-game!`;
        if (item.category==='SailorPiece') instructions = `\n\n📝 Add **vru4447** on Roblox to receive your item!`;
        if (item.category==='Nitro') instructions = `\n\nAn admin will reach out to you shortly!`;
        if (item.category==='Crunchyroll') instructions = `\n\nYou need **6 invites** to redeem this. An admin will DM you the account details!`;

        const claimsArr=await getClaims();
        const arr=Array.isArray(claimsArr)?claimsArr:[];
        arr.push({claimId:idArg,userId:me.id,username:me.username,itemId:item.id,itemName:item.name,category:item.category,robuxAmt:0,robloxUsername:me.username,gamepassLink:null,claimedAt:Date.now(),status:'pending'});
        await saveClaims(arr);
        sendLog(client,{title:'📋 Claim Submitted',color:0x5865F2,fields:[{name:'User',value:`<@${me.id}>`,inline:true},{name:'Claim ID',value:`\`${idArg}\``,inline:true},{name:'Item',value:item.name,inline:true},{name:'Category',value:item.category,inline:true}]});
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('📬 Claim Submitted!').setDescription(`Your claim for **${item.name}** has been submitted!\n\n**Claim ID:** \`${idArg}\`${instructions}`)]});
      }

      const modal=new ModalBuilder().setCustomId(`claim_modal_${item.claimId}`).setTitle(`Claim: ${item.name}`);
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_username').setLabel('Your Roblox Username').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Builderman').setRequired(true)));
      if (item.category==='Robux') modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gamepass_link').setLabel(`Gamepass Link (set price to ${item.robuxAmt||0} Robux)`).setStyle(TextInputStyle.Short).setPlaceholder('https://www.roblox.com/game-pass/...').setRequired(true)));
      return interaction.showModal(modal);
    }

    if (cmd==='claims') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const allClaims=await getClaims(), pending=(Array.isArray(allClaims)?allClaims:[]).filter(c=>c.status==='pending');
      if (!pending.length) return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ No pending claims!')]});
      const fields=pending.map(c=>({name:`${c.claimId} — ${c.itemName}`,value:`👤 **${c.username}** · Roblox: \`${c.robloxUsername}\`\n${c.gamepassLink?`🔗 ${c.gamepassLink}\n`:''}📅 ${ts(c.claimedAt,'R')}`,inline:false}));
      const chunks=[]; for(let i=0;i<fields.length;i+=10) chunks.push(fields.slice(i,i+10));
      for(let i=0;i<chunks.length;i++){
        const e=new EmbedBuilder().setColor(0xF1C40F).setTitle(i===0?`📋 Pending Claims — ${pending.length} total`:'📋 (continued)').addFields(chunks[i]).setFooter({text:'/claimed <id>  ·  /deny-claim <id> [reason]'});
        if(i===0) await interaction.editReply({embeds:[e]}); else await interaction.followUp({embeds:[e],flags:MessageFlags.Ephemeral});
      }
      return;
    }

    if (cmd==='claimed') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const claimId=interaction.options.getString('id').toUpperCase();
      const allClaims=await getClaims(), arr=Array.isArray(allClaims)?allClaims:[];
      const idx=arr.findIndex(c=>c.claimId===claimId);
      if (idx===-1)                    return interaction.editReply({embeds:[errEmbed(`Claim \`${claimId}\` not found.`)]});
      if (arr[idx].status==='fulfilled') return interaction.editReply({embeds:[errEmbed('Already fulfilled.')]});
      if (arr[idx].status==='denied')    return interaction.editReply({embeds:[errEmbed('Already denied.')]});
      const claim=arr[idx];
      // Remove from claims array entirely — fulfilled claims don't need to stay
      arr.splice(idx, 1);
      await saveClaims(arr);
      sendLog(client,{title:'✅ Claim Fulfilled',color:0x57F287,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Claim ID',value:`\`${claimId}\``,inline:true},{name:'User',value:`<@${claim.userId}>`,inline:true},{name:'Item',value:claim.itemName,inline:true}]});
      let dmSent=false;
      try {
        const t=await client.users.fetch(claim.userId);
        const fulfillMsg=claim.category==='Robux'
          ?`Your claim **${claimId}** for **${claim.itemName}** has been fulfilled! Check your Roblox gamepass!`
          :`Your claim **${claimId}** for **${claim.itemName}** has been fulfilled!\n\n**vru4447** has sent you a friend request on Roblox. Accept it and they will join your game to deliver your reward!`;
        await t.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎉 Claim Fulfilled!').setDescription(fulfillMsg)]}); dmSent=true;
      } catch {}
      try { await interaction.channel.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎉 Claim Fulfilled!').setDescription(`<@${claim.userId}> your claim **${claimId}** for **${claim.itemName}** has been fulfilled by <@${me.id}>!\n${claim.category==='Robux'?'Check your Roblox gamepass!':'Accept the friend request from **vru4447** on Roblox!'}`)]}); } catch {}
      try {
        const t=await client.users.fetch(claim.userId);
        try { await t.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('⭐ Please Leave a Vouch!').setDescription(`Hey! You just received **${claim.itemName}** 🎉\n\nPlease leave a vouch in <#${VOUCH_CHANNEL_ID}>!\n\n**Format:** \`Vouch @${me.username} <your feedback>\`\n\nIt only takes a second and helps us a lot! 🙏`).setFooter({text:`Claim ${claimId}`})]}); } catch {}
        // Send ONE reminder after 1 hour, then stop
        const vt=setTimeout(async()=>{
          if (!pendingVouches.has(claim.userId)) return;
          pendingVouches.delete(claim.userId);
          try { const target=await client.users.fetch(claim.userId); await target.send({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('⭐ Reminder: Please Vouch!').setDescription(`Hey! You received **${claim.itemName}** a while ago.\n\nPlease drop a vouch in <#${VOUCH_CHANNEL_ID}>!\n\n**Format:** \`Vouch @${me.username} <your feedback>\`\n\nThis helps us a lot! 🙏`).setFooter({text:`Claim ${claimId}`})]}); } catch {}
        }, 60*60*1000);
        pendingVouches.set(claim.userId,{claimId,itemName:claim.itemName,fulfilledBy:me.username,timeout:vt});
      } catch {}
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Claim Fulfilled').addFields({name:'Claim',value:`\`${claimId}\``,inline:true},{name:'User',value:`<@${claim.userId}>`,inline:true},{name:'Item',value:claim.itemName,inline:true},{name:'DM',value:dmSent?'✅ Sent':'❌ DMs off',inline:true})]});
    }

    if (cmd==='deny-claim') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const claimId=interaction.options.getString('id').toUpperCase(), reason=interaction.options.getString('reason')||null;
      const allClaims=await getClaims(), arr=Array.isArray(allClaims)?allClaims:[];
      const idx=arr.findIndex(c=>c.claimId===claimId);
      if (idx===-1)                    return interaction.editReply({embeds:[errEmbed(`Claim \`${claimId}\` not found.`)]});
      if (arr[idx].status==='fulfilled') return interaction.editReply({embeds:[errEmbed('Already fulfilled.')]});
      if (arr[idx].status==='denied')    return interaction.editReply({embeds:[errEmbed('Already denied.')]});
      const claim=arr[idx];
      // Remove from claims array — denied
      arr.splice(idx, 1);
      await saveClaims(arr);
      sendLog(client,{title:'❌ Claim Denied',color:0xED4245,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Claim ID',value:`\`${claimId}\``,inline:true},{name:'User',value:`<@${claim.userId}>`,inline:true},{name:'Item',value:claim.itemName,inline:true},{name:'Reason',value:reason||'No reason given',inline:false}]});
      const shopItem=SHOP.find(i=>i.id===claim.itemId);
      const u=await getUser(claim.userId,claim.username);
      u.inventory.push({claimId:claim.claimId,itemId:claim.itemId,name:claim.itemName,category:claim.category,robuxAmt:claim.robuxAmt||0,cost:shopItem?shopItem.cost:0});
      await saveUser(u);
      const store=await getStore();
      if (claim.category==='Robux') store.robux+=(claim.robuxAmt||0);
      else if (claim.itemId==='etfb_cel') store.celestials+=1;
      else if (claim.itemId==='etfb_div') store.divines+=1;
      await saveStore(store); await updateStockEmbed(client);
      let dmSent=false;
      try {
        const t=await client.users.fetch(claim.userId);
        await t.send({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('❌ Claim Denied').setDescription(`Your claim \`${claimId}\` for **${claim.itemName}** was denied.\n\n${reason?`**Reason:** ${reason}\n\n`:''}The item has been returned to your inventory.\nUse \`/claim ${claimId}\` to re-submit.`)]});
        dmSent=true;
      } catch {}
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('❌ Claim Denied').addFields({name:'Claim',value:`\`${claimId}\``,inline:true},{name:'User',value:`<@${claim.userId}>`,inline:true},{name:'Item',value:claim.itemName,inline:true},{name:'Reason',value:reason||'No reason given',inline:false},{name:'Refunded',value:'✅ Inventory',inline:true},{name:'Stock',value:'✅ Restored',inline:true},{name:'DM',value:dmSent?'✅ Sent':'❌ DMs off',inline:true})]});
    }


    if (cmd==='backup-coins') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const users = await dbRead('users');
      const entries = Object.values(users).filter(u => u && u.coins > 0).sort((a,b) => b.coins - a.coins);
      if (!entries.length) return interaction.editReply({embeds:[errEmbed('No users with coins found.')]});
      // Build a readable list in chunks (Discord 4096 char limit)
      const lines = entries.map(u => `<@${u.id}> — **${u.coins.toLocaleString()}** coins (${u.username})`);
      const chunks = [];
      let chunk = '';
      for (const line of lines) {
        if ((chunk + '\n' + line).length > 3800) { chunks.push(chunk); chunk = line; }
        else chunk = chunk ? chunk + '\n' + line : line;
      }
      if (chunk) chunks.push(chunk);
      const embeds = chunks.map((ch, i) => new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(i===0 ? `💰 Coin Backup — ${entries.length} users` : '💰 Coin Backup (continued)')
        .setDescription(ch)
        .setFooter(i===0 ? {text:`Total snapshot: ${entries.reduce((s,u)=>s+u.coins,0).toLocaleString()} coins across ${entries.length} users`} : null)
      );
      // Send first as editReply, rest as followUp
      await interaction.editReply({embeds:[embeds[0]]});
      for (let i=1;i<embeds.length;i++) {
        await interaction.followUp({embeds:[embeds[i]],flags:MessageFlags.Ephemeral});
      }
      sendLog(client,{title:'💰 Coin Backup Taken',color:0xF1C40F,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Users',value:`${entries.length}`,inline:true},{name:'Total Coins',value:`${entries.reduce((s,u)=>s+u.coins,0).toLocaleString()}`,inline:true}]});
      return;
    }



    if (cmd==='backup-coins') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const users = await dbRead('users');
      const entries = Object.values(users).filter(u => u && u.coins > 0).sort((a,b) => b.coins - a.coins);
      if (!entries.length) return interaction.editReply({embeds:[errEmbed('No users with coins found.')]});
      const lineList = entries.map(u => `<@${u.id}> — **${u.coins.toLocaleString()}** coins (${u.username})`);
      const chunks = [];
      let chunk = '';
      for (const line of lineList) {
        if ((chunk + '\n' + line).length > 3800) { chunks.push(chunk); chunk = line; }
        else chunk = chunk ? chunk + '\n' + line : line;
      }
      if (chunk) chunks.push(chunk);
      const total = entries.reduce((s,u)=>s+u.coins,0);
      const embeds = chunks.map((ch, i) => new EmbedBuilder().setColor(0xF1C40F)
        .setTitle(i===0 ? `💰 Coin Backup — ${entries.length} users` : '💰 (continued)')
        .setDescription(ch)
      );
      if (embeds[0]) embeds[0].setFooter({text:`${total.toLocaleString()} coins across ${entries.length} users`});
      await interaction.editReply({embeds:[embeds[0]]});
      for (let i=1;i<embeds.length;i++) await interaction.followUp({embeds:[embeds[i]],flags:MessageFlags.Ephemeral});
      sendLog(client,{title:'💰 Coin Backup Taken',color:0xF1C40F,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Users',value:`${entries.length}`,inline:true},{name:'Total',value:`${total.toLocaleString()} coins`,inline:true}]});
      return;
    }

    if (cmd==='give') {
      const t=interaction.options.getUser('user'), amt=interaction.options.getInteger('amount');
      const u=await getUser(t.id,t.username); u.coins+=amt; u.totalEarned=(u.totalEarned||0)+amt; await saveUser(u);
      sendLog(client,{title:'💰 Coins Given',color:0x57F287,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Recipient',value:`<@${t.id}>`,inline:true},{name:'Amount',value:`+**${amt}** ${COIN_EMOJI}`,inline:true},{name:'New Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
      return reply({embeds:[okEmbed(`Gave **${amt}** ${COIN_EMOJI} to <@${t.id}>. Balance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`)]});
    }
    if (cmd==='take') {
      const t=interaction.options.getUser('user');
      const takeAll=interaction.options.getBoolean('all')||false;
      const amt=takeAll?null:interaction.options.getInteger('amount');
      if (!takeAll && !amt) return reply({embeds:[errEmbed('Provide an amount or set `all` to true.')],flags:MessageFlags.Ephemeral});
      const u=await getUser(t.id,t.username);
      const taken=takeAll?u.coins:amt;
      u.coins=takeAll?0:Math.max(0,u.coins-amt);
      await saveUser(u);
      sendLog(client,{title:'💸 Coins Taken',color:0xED4245,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'From',value:`<@${t.id}>`,inline:true},{name:'Amount',value:`-**${taken.toLocaleString()}** ${COIN_EMOJI}${takeAll?' (ALL)':''}`,inline:true},{name:'New Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
      return reply({embeds:[okEmbed(`Took **${taken.toLocaleString()}** ${COIN_EMOJI} from <@${t.id}>. Balance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`)]});
    }

    // ── CODES (all saved to JSONBin now) ──
    if (cmd==='make-code') {
      const code=interaction.options.getString('code').toUpperCase().trim();
      const coins=interaction.options.getInteger('coins');
      const desc=interaction.options.getString('description')||'🎟️ Special code';
      if (await codeExists(code)) return reply({embeds:[errEmbed(`Code \`${code}\` already exists!`)]});
      const codeObj={coins, description:desc, multiUse:false};
      await saveCode(code, codeObj);
      sendLog(client,{title:'🎟️ Code Created',color:0x57F287,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Code',value:`\`${code}\``,inline:true},{name:'Coins',value:`**${coins}** ${COIN_EMOJI}`,inline:true},{name:'Type',value:'One-time',inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎟️ Code Created!')
        .addFields({name:'Code',value:`\`${code}\``,inline:true},{name:'Coins',value:`**${coins}** ${COIN_EMOJI}`,inline:true},{name:'Description',value:desc,inline:true})
        .setFooter({text:'Code created successfully!'})]});
    }

    if (cmd==='drop-code') {
      const code=interaction.options.getString('code').toUpperCase().trim();
      const coins=interaction.options.getInteger('coins');
      const mins=interaction.options.getInteger('minutes');
      const desc=interaction.options.getString('description')||'🎟️ Limited drop';
      if (await codeExists(code)) return reply({embeds:[errEmbed(`Code \`${code}\` already exists!`)]});
      const expiresAt=Date.now()+mins*60*1000;
      const codeObj={coins,description:desc,expiresAt,multiUse:true,redeemedBy:[]};
      await saveCode(code, codeObj);
      let dropMsg=null;
      try {
        const dropCh=await client.channels.fetch(DROP_CHANNEL_ID);
        if (dropCh) dropMsg=await dropCh.send({content:'@here',allowedMentions:{parse:['everyone']},embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🎟️ Code Drop!').setDescription(`A new code has been dropped!\n\nUse \`/use-code ${code}\` to claim **${coins}** ${COIN_EMOJI}!\n\n⏰ Expires ${ts(expiresAt)} — ${ts(expiresAt,'T')} your time`).setFooter({text:desc})]});
      } catch(e){console.error('Drop announce error:',e.message);}
      setTimeout(async()=>{
        const saved=await dbRead('codes').catch(()=>({}));
        const redeemCount=(saved[code]?.redeemedBy||[]).length;
        await deleteCode(code);
        if (dropMsg) {
          try { await dropMsg.edit({content:'',embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🎟️ Code Expired!').setDescription(`The code drop has ended!\n\n**${redeemCount}** member(s) claimed **${coins}** ${COIN_EMOJI} each.\n\nStay active for future drops!`).setFooter({text:`Code was active for ${mins} minute(s)`})]}); } catch(e){console.error('Drop expire edit error:',e.message);}
        }
      },mins*60*1000);
      sendLog(client,{title:'🎟️ Code Dropped',color:0xF1C40F,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Code',value:`\`${code}\``,inline:true},{name:'Coins',value:`**${coins}** ${COIN_EMOJI}`,inline:true},{name:'Expires',value:ts(expiresAt),inline:true},{name:'Type',value:'Multi-use timed',inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🎟️ Code Dropped!').setDescription(`Code \`${code}\` is now live! Expires ${ts(expiresAt)}`).addFields({name:'Code',value:`\`${code}\``,inline:true},{name:'Coins',value:`**${coins}** ${COIN_EMOJI}`,inline:true},{name:'Expires',value:ts(expiresAt),inline:true}).setFooter({text:'Code is live — auto-deleted when expired'})]});
    }

    if (cmd==='remove-code') {
      const code=interaction.options.getString('code').toUpperCase().trim();
      const all=await getCodes();
      if (!(code in all)) return reply({embeds:[errEmbed(`Code \`${code}\` doesn't exist!`)]});
      if (code in PERMANENT_CODES) return reply({embeds:[errEmbed(`\`${code}\` is a permanent hardcoded code — edit PERMANENT_CODES in bot.js to remove it.`)]});
      const {coins, redeemedBy}=all[code];
      const redeemCount=(redeemedBy||[]).length;
      await deleteCode(code);
      sendLog(client,{title:'🗑️ Code Removed',color:0xED4245,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Code',value:`\`${code}\``,inline:true},{name:'Times Redeemed',value:`${redeemCount}`,inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🗑️ Code Removed').setDescription(`Code \`${code}\` has been deleted from the database.`).addFields({name:'Code',value:`\`${code}\``,inline:true},{name:'Redeemed',value:`${redeemCount} time(s)`,inline:true},{name:'Coins/use',value:`**${coins}** ${COIN_EMOJI}`,inline:true})]});
    }

    if (cmd==='list-codes') {
      const all=await getCodes();
      const entries=Object.entries(all);
      if (!entries.length) return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setDescription('No active codes right now.')],flags:MessageFlags.Ephemeral});
      const lines=entries.map(([key,c])=>{
        const isPerm=key in PERMANENT_CODES;
        const type=c.multiUse?'🔄 Multi-use':'1️⃣ One-time';
        const expiry=c.expiresAt?` · Expires ${ts(c.expiresAt)}`:'';
        const perm=isPerm?' · **Permanent**':'';
        return `**\`${key}\`** — **${c.coins}** ${COIN_EMOJI} · ${type}${expiry}${perm}`;
      }).join('\n');
      return reply({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle(`🎟️ Active Codes — ${entries.length} total`).setDescription(lines)],flags:MessageFlags.Ephemeral});
    }

    if (cmd==='remove-inv') {
      const t=interaction.options.getUser('user'), claimId=interaction.options.getString('claim_id').toUpperCase();
      const u=await getUser(t.id,t.username), idx=(u.inventory||[]).findIndex(i=>i.claimId===claimId);
      if (idx===-1) return reply({embeds:[errEmbed(`No item \`${claimId}\` in <@${t.id}>'s inventory.`)],flags:MessageFlags.Ephemeral});
      const removed=u.inventory.splice(idx,1)[0]; await saveUser(u);
      sendLog(client,{title:'🗑️ Inventory Item Removed',color:0xED4245,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Item',value:`${removed.name} (\`${claimId}\`)`,inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🗑️ Removed').setDescription(`Removed **${removed.name}** (\`${claimId}\`) from <@${t.id}>'s inventory.`)]});
    }
    if (cmd==='check-inventory') {
      const t=interaction.options.getUser('user'), u=await getUser(t.id,t.username), inv=u.inventory||[];
      if (!inv.length) return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setDescription(`🎒 <@${t.id}>'s inventory is empty.`)],flags:MessageFlags.Ephemeral});
      const list=inv.map(i=>`${i.category==='Robux'?'💎':i.name==='Divine'?'🌟':'✨'} **${i.name}** — \`${i.claimId}\``).join('\n');
      return reply({embeds:[new EmbedBuilder().setTitle(`🎒 ${t.username}'s Inventory`).setColor(0x9B59B6).setDescription(list).setFooter({text:`${inv.length} item(s)`})],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='update-robux') {
      await interaction.deferReply();
      const store=await getStore(); store.robux=interaction.options.getInteger('amount'); await saveStore(store); await updateStockEmbed(client);
      sendLog(client,{title:'📦 Robux Stock Updated',color:0x57F287,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'New Amount',value:`**${store.robux}** Robux`,inline:true}],user:me.username});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Stock Updated').setDescription(`💎 Robux set to **${store.robux}**.`)]});
    }
    if (cmd==='update-etfb') {
      await interaction.deferReply();
      const type=interaction.options.getString('type'), amt=interaction.options.getInteger('amount');
      const store=await getStore(); store[type]=amt; await saveStore(store); await updateStockEmbed(client);
      sendLog(client,{title:'📦 ETFB Stock Updated',color:0x57F287,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Type',value:type==='divines'?'Divines':'Celestials',inline:true},{name:'New Amount',value:`**${amt}x**`,inline:true}],user:me.username});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Stock Updated').setDescription(`${type==='divines'?'🌟 Divines':'✨ Celestials'} set to **${amt}x**.`)]});
    }

    if (cmd==='gtn') {
      const min=interaction.options.getInteger('min'), max=interaction.options.getInteger('max');
      const answer=interaction.options.getInteger('number'), prize=interaction.options.getInteger('prize');
      if (answer<min||answer>max) return reply({embeds:[errEmbed(`The winning number must be between **${min}** and **${max}**!`)]});
      if (activeGTN.has(GTN_CHANNEL_ID)) return reply({embeds:[errEmbed('A GTN game is already running! Wait for it to end.')]});
      activeGTN.set(GTN_CHANNEL_ID,{answer,prize,min,max,active:true});
      try {
        const gtnCh=await client.channels.fetch(GTN_CHANNEL_ID);
        if(gtnCh) await gtnCh.send({embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle('🎮 Guess the Number!').setDescription(`A new game has started!\n\n> 🔢 **Range:** ${min} – ${max}\n> 🏆 **Prize:** **${prize}** ${COIN_EMOJI}\n\nType a number in this channel to guess!\nFirst correct guess wins!`).setFooter({text:`Hosted by ${me.username}`}).setTimestamp()]});
      } catch(e){console.error('GTN channel send error:',e.message);}
      sendLog(client,{title:'🎮 GTN Game Started',color:0x9B59B6,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Range',value:`${min}–${max}`,inline:true},{name:'Answer',value:`||${answer}||`,inline:true},{name:'Prize',value:`**${prize}** ${COIN_EMOJI}`,inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ GTN Game Started!').addFields({name:'Range',value:`${min} – ${max}`,inline:true},{name:'Answer',value:`**${answer}**`,inline:true},{name:'Prize',value:`**${prize}** ${COIN_EMOJI}`,inline:true}).setFooter({text:'Only you can see this'})],flags:MessageFlags.Ephemeral});
    }

    // ── MODERATION ──
    if (cmd==='timeout') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), mins=interaction.options.getInteger('minutes'), reason=interaction.options.getString('reason')||'No reason given';
      try {
        const member=await interaction.guild.members.fetch(t.id);
        await member.timeout(mins*60*1000, reason);
        try { await t.send({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('⏱️ You have been timed out').addFields({name:'Duration',value:`${mins} minute(s)`,inline:true},{name:'Reason',value:reason,inline:true},{name:'Server',value:interaction.guild.name,inline:true})]}); } catch {}
        sendLog(client,{title:'⏱️ User Timed Out',color:0xED4245,fields:[{name:'Mod',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Duration',value:`${mins} min`,inline:true},{name:'Reason',value:reason,inline:false}],user:me.username});
        return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('⏱️ User Timed Out').addFields({name:'User',value:`<@${t.id}>`,inline:true},{name:'Duration',value:`${mins} min`,inline:true},{name:'Reason',value:reason,inline:false})]});
      } catch(e){return reply({embeds:[errEmbed(`Failed to timeout: ${e.message}`)]}); }
    }
    if (cmd==='untimeout') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), reason=interaction.options.getString('reason')||'No reason given';
      try {
        const member=await interaction.guild.members.fetch(t.id);
        await member.timeout(null, reason);
        try { await t.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Timeout Removed').setDescription(`Your timeout in **${interaction.guild.name}** has been removed.\n**Reason:** ${reason}`)]}); } catch {}
        sendLog(client,{title:'✅ Timeout Removed',color:0x57F287,fields:[{name:'Mod',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Reason',value:reason,inline:false}],user:me.username});
        return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Timeout Removed').addFields({name:'User',value:`<@${t.id}>`,inline:true},{name:'Reason',value:reason,inline:false})]});
      } catch(e){return reply({embeds:[errEmbed(`Failed to untimeout: ${e.message}`)]}); }
    }
    if (cmd==='warn') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), reason=interaction.options.getString('reason')||'No reason given';
      const warns=await getWarns(t.id); warns.push({reason,by:me.username,at:Date.now()}); await saveWarns(t.id,warns);
      try { await t.send({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️ You have been warned').addFields({name:'Reason',value:reason,inline:false},{name:'Total Warns',value:`${warns.length}`,inline:true},{name:'Server',value:interaction.guild.name,inline:true})]}); } catch {}
      sendLog(client,{title:'⚠️ User Warned',color:0xFEE75C,fields:[{name:'Mod',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Warn #',value:`${warns.length}`,inline:true},{name:'Reason',value:reason,inline:false}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️ User Warned').addFields({name:'User',value:`<@${t.id}>`,inline:true},{name:'Warn #',value:`${warns.length}`,inline:true},{name:'Reason',value:reason,inline:false})]});
    }
    if (cmd==='unwarn') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), index=interaction.options.getInteger('index')-1;
      const warns=await getWarns(t.id);
      if (!warns.length) return reply({embeds:[errEmbed(`<@${t.id}> has no warns.`)]});
      if (index<0||index>=warns.length) return reply({embeds:[errEmbed('Invalid warn number. Use /warns to see the list.')]});
      const removed=warns.splice(index,1)[0]; await saveWarns(t.id,warns);
      sendLog(client,{title:'✅ Warn Removed',color:0x57F287,fields:[{name:'Mod',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Removed Warn',value:removed.reason,inline:false},{name:'Remaining',value:`${warns.length} warn(s)`,inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Warn Removed').addFields({name:'User',value:`<@${t.id}>`,inline:true},{name:'Removed Warn',value:removed.reason,inline:false},{name:'Remaining Warns',value:`${warns.length}`,inline:true})]});
    }
    if (cmd==='warns') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), warns=await getWarns(t.id);
      if (!warns.length) return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle(`⚠️ Warns — ${t.username}`).setDescription('This user has no warns! ✅')]});
      const list=warns.map((w,i)=>`**#${i+1}** — ${w.reason}\n> By ${w.by} · ${ts(w.at,'R')}`).join('\n\n');
      return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle(`⚠️ Warns — ${t.username}`).setDescription(list).setFooter({text:`${warns.length} total warn(s)`})]});
    }
    if (cmd==='kick') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), reason=interaction.options.getString('reason')||'No reason given';
      try {
        const member=await interaction.guild.members.fetch(t.id);
        try { await t.send({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('👢 You have been kicked').addFields({name:'Reason',value:reason,inline:false},{name:'Server',value:interaction.guild.name,inline:true})]}); } catch {}
        await member.kick(reason);
        sendLog(client,{title:'👢 User Kicked',color:0xED4245,fields:[{name:'Mod',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Reason',value:reason,inline:false}],user:me.username});
        return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('👢 User Kicked').addFields({name:'User',value:`<@${t.id}>`,inline:true},{name:'Reason',value:reason,inline:false})]});
      } catch(e){return reply({embeds:[errEmbed(`Failed to kick: ${e.message}`)]}); }
    }
    if (cmd==='ban') {
      if (!isModerator(interaction.member)) return reply({embeds:[errEmbed('You need a Moderator or Admin role!')],flags:MessageFlags.Ephemeral});
      const t=interaction.options.getUser('user'), reason=interaction.options.getString('reason')||'No reason given';
      try {
        try { await t.send({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🔨 You have been banned').addFields({name:'Reason',value:reason,inline:false},{name:'Server',value:interaction.guild.name,inline:true})]}); } catch {}
        await interaction.guild.members.ban(t.id,{reason});
        sendLog(client,{title:'🔨 User Banned',color:0xED4245,fields:[{name:'Mod',value:`<@${me.id}>`,inline:true},{name:'User',value:`<@${t.id}>`,inline:true},{name:'Reason',value:reason,inline:false}],user:me.username});
        return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🔨 User Banned').addFields({name:'User',value:`<@${t.id}>`,inline:true},{name:'Reason',value:reason,inline:false})]});
      } catch(e){return reply({embeds:[errEmbed(`Failed to ban: ${e.message}`)]}); }
    }

    // ══════════════════════════════════════════
    //  ROBLOX USER LINKING
    // ══════════════════════════════════════════
    if (cmd==='add-user') {
      const robloxUser = interaction.options.getString('roblox_username').trim();
      const data = await dbRead('roblox');
      // Check if this Roblox username is already taken by someone else
      const takenBy = Object.entries(data).find(([uid, d]) => d.robloxUsername && d.robloxUsername.toLowerCase() === robloxUser.toLowerCase() && uid !== me.id);
      if (takenBy) return reply({embeds:[errEmbed(`The Roblox username \`${robloxUser}\` is already linked to another Discord account!`)],flags:MessageFlags.Ephemeral});
      // Update if already linked
      if (data[me.id]) {
        const prev = data[me.id];
        data[me.id] = { discordName: me.username, robloxUsername: robloxUser, updatedAt: Date.now() };
        await dbWrite('roblox', data);
        sendLog(client,{title:'🎮 Roblox Username Updated',color:0xFEE75C,fields:[{name:'Discord',value:`<@${me.id}>`,inline:true},{name:'Old Roblox',value:prev.robloxUsername,inline:true},{name:'New Roblox',value:robloxUser,inline:true}]});
        return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('🎮 Roblox Username Updated!').setDescription(`Your Roblox username has been updated!

**Discord:** ${me.username}
**Roblox:** \`${robloxUser}\``).setFooter({text:'Updated successfully'})],flags:MessageFlags.Ephemeral});
      }
      // Fresh link
      data[me.id] = { discordName: me.username, robloxUsername: robloxUser, linkedAt: Date.now() };
      await dbWrite('roblox', data);
      sendLog(client,{title:'🎮 Roblox Username Linked',color:0x57F287,fields:[{name:'Discord',value:`<@${me.id}>`,inline:true},{name:'Roblox',value:robloxUser,inline:true}]});
      // DM with friend request instructions
      try {
        await me.send({embeds:[new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🎮 One More Step!')
          .setDescription('To join our game nights, please send a friend request to **EventUser52** on Roblox!\n\n> 👤 **Add:** `EventUser52`\n\nOnce they accept, you\'ll be all set to join game nights! 🎉')
          .setFooter({text:'This is a one-time setup — you only need to do this once!'})
        ]});
      } catch {}
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎮 Roblox Username Linked!').setDescription(`You've been linked successfully!\n\n**Discord:** ${me.username}\n**Roblox:** \`${robloxUser}\`\n\n📬 Check your DMs for next steps!`).setFooter({text:'Use /add-user again to update your username'})],flags:MessageFlags.Ephemeral});
    }

    if (cmd==='check-user') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const data = await dbRead('roblox');
      const entries = Object.entries(data).filter(([k]) => k !== '_init');
      if (!entries.length) return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setDescription('No users linked yet.')]});
      const perPage = 15;
      const pages = [];
      for (let i = 0; i < entries.length; i += perPage) {
        pages.push(entries.slice(i, i + perPage).map(([uid, d]) => `<@${uid}> — \`${d.robloxUsername}\``).join('\n'));
      }
      function cuEmbed(page) {
        return new EmbedBuilder().setColor(0x5865F2).setTitle(`🎮 Linked Roblox Users — ${entries.length} total`).setDescription(pages[page]).setFooter({text:`Page ${page+1} of ${pages.length}`});
      }
      function cuButtons(page) {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`cu_prev_${page}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page===0),
          new ButtonBuilder().setCustomId(`cu_next_${page}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(page===pages.length-1)
        );
      }
      return interaction.editReply({embeds:[cuEmbed(0)], components: pages.length > 1 ? [cuButtons(0)] : []});
    }

    if (cmd==='game-night-start') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const data = await dbRead('roblox');
      const entries = Object.entries(data).filter(([k,v]) => k !== '_init' && v.robloxUsername);
      if (!entries.length) return interaction.editReply({embeds:[errEmbed('No linked users found!')]});

      let sent = 0, failed = 0;
      for (const [uid] of entries) {
        try {
          const user = await client.users.fetch(uid);
          await user.send({embeds:[new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🎮 Game Night is Starting!')
            .setDescription('Hey! A game night is starting **right now**!\n\n> 👤 **Join:** `EventUser52` on Roblox\n\nJoin up and let\'s play! 🎉')
            .setFooter({text:'See you in-game!'})
            .setTimestamp()
          ]});
          sent++;
        } catch { failed++; }
      }

      sendLog(client,{title:'🎮 Game Night Started',color:0x9B59B6,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'DMs Sent',value:`${sent}`,inline:true},{name:'Failed',value:`${failed}`,inline:true}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎮 Game Night Started!').setDescription(`DMs sent to **${sent}** linked user(s)!${failed>0?`\n❌ ${failed} user(s) had DMs closed.`:''}`)]});
    }



    // ══════════════════════════════════════════
    //  SERVER SHOP (Bank & Upgrades)
    // ══════════════════════════════════════════








    if (cmd==='vouch') {
      const target = interaction.options.getUser('user');
      const comment = interaction.options.getString('comment') || null;
      if (target.id === me.id) return reply({embeds:[errEmbed('You cannot vouch for yourself!')],flags:MessageFlags.Ephemeral});
      if (target.bot) return reply({embeds:[errEmbed('You cannot vouch for a bot!')],flags:MessageFlags.Ephemeral});
      const vdata = await dbRead('vouches');
      if (!vdata[target.id]) vdata[target.id] = [];

      vdata[target.id].push({ fromId: me.id, fromName: me.username, comment, at: Date.now() });
      await dbWrite('vouches', vdata);
      sendLog(client,{title:'⭐ Vouch Left',color:0xF1C40F,fields:[{name:'From',value:`<@${me.id}>`,inline:true},{name:'For',value:`<@${target.id}>`,inline:true},{name:'Comment',value:comment||'No comment',inline:false}]});
      return reply({embeds:[new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⭐ Vouch Submitted!')
        .setDescription(`You vouched for <@${target.id}>!${comment ? `\n\n> "${comment}"` : ''}`)
        .setFooter({text:`${target.username} now has ${vdata[target.id].length} vouch(es)`})]});
    }

    if (cmd==='vouches') {
      const target = interaction.options.getUser('user');
      const vdata = await dbRead('vouches');
      const list = vdata[target.id] || [];
      if (!list.length) return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle(`⭐ Vouches — ${target.username}`).setDescription('This user has no vouches yet.')]});
      const lines = list.map((v,i) => `**${i+1}.** <@${v.fromId}>${v.comment ? ` — "${v.comment}"` : ''} · <t:${Math.floor(v.at/1000)}:R>`).join('\n');
      return reply({embeds:[new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`⭐ Vouches — ${target.username}`)
        .setDescription(lines)
        .setThumbnail(target.displayAvatarURL())
        .setFooter({text:`${list.length} total vouch(es)`})]});
    }


    if (cmd==='find-user') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const query = interaction.options.getString('query').replace(/^<@!?(\d+)>$/, '$1').trim().toLowerCase();
      const data = await dbRead('roblox');
      const entries = Object.entries(data).filter(([k]) => k !== '_init');
      const matches = entries.filter(([uid, d]) =>
        uid === query ||
        (d.discordName && d.discordName.toLowerCase().includes(query)) ||
        (d.robloxUsername && d.robloxUsername.toLowerCase().includes(query))
      );
      if (!matches.length) return interaction.editReply({embeds:[errEmbed(`No user found matching **${query}**`)]});
      const lines = matches.map(([uid, d]) => `<@${uid}> — Roblox: \`${d.robloxUsername}\``).join('\n');
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle(`🔍 Found ${matches.length} result(s)`).setDescription(lines)]});
    }


    if (cmd==='update-crunchyroll') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const amount = interaction.options.getInteger('amount');
      const cr = await dbRead('crunchyroll');
      cr.stock = amount;
      await dbWrite('crunchyroll', cr);
      sendLog(client,{title:'🎌 Crunchyroll Stock Updated',color:0xF47521,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'New Stock',value:`${amount}`,inline:true}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Crunchyroll Stock Updated').setDescription(`Stock set to **${amount}** account(s).`)]});
    }

    if (cmd==='update-sab') {
      const item  = interaction.options.getString('item').trim();
      const stock = interaction.options.getString('stock');
      const price = interaction.options.getInteger('price');
      const sab   = await dbRead('sab');
      const arr   = Array.isArray(sab) ? sab.filter(i => i && i.item) : [];
      const idx   = arr.findIndex(i => i.item.toLowerCase() === item.toLowerCase());
      const worth = interaction.options.getString('making_money') || null;
      if (idx >= 0) arr[idx] = { item, stock, price, worth };
      else arr.push({ item, stock, price, worth });
      await dbWrite('sab', arr);
      sendLog(client,{title:'🛍️ SAB Item Updated',color:0x9B59B6,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Item',value:item,inline:true},{name:'Stock',value:stock,inline:true},{name:'Price',value:`${price.toLocaleString()} ${COIN_EMOJI}`,inline:true},{name:'Worth',value:worth||'N/A',inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ SAB Stock Updated').setDescription(`**${item}** | ${stock} | ${price.toLocaleString()} ${COIN_EMOJI}${worth ? ` | Worth: ${worth}` : ''}`)]});
    }



    // ══════════════════════════════════════════
    //  CHAIR GAME
    // ══════════════════════════════════════════
    if (cmd==='chair-game') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      if (activeChairGame.has(interaction.guildId)) return reply({embeds:[errEmbed('A Chair Game is already running!')],flags:MessageFlags.Ephemeral});
      const prize = interaction.options.getInteger('prize');
      const gwId = `CG${Date.now()}`;
      const joinMsg = await interaction.channel.send({
        embeds:[new EmbedBuilder().setColor(0x3498DB).setTitle('🪑 Chair Game — Join Now!').setDescription('Click **Join** to enter the Chair Game!\n\nThe host will start the game when ready.').setFooter({text:`Prize: ${prize.toLocaleString()} coins for the winner`})],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cg_join_${gwId}`).setLabel('🪑 Join').setStyle(ButtonStyle.Primary))]
      });
      activeChairGame.set(interaction.guildId, { gwId, prize, players: new Set(), phase: 'joining', hostId: me.id, channelId: interaction.channelId, joinMsgId: joinMsg.id, round: 0, safeColor: null });
      sendLog(client,{title:'🪑 Chair Game Started',color:0x3498DB,fields:[{name:'Host',value:`<@${me.id}>`,inline:true},{name:'Prize',value:`${prize} coins`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ Chair Game lobby posted! Use `/chair-next` to start rounds.')],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='chair-next') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeChairGame.get(interaction.guildId);
      if (!game) return reply({embeds:[errEmbed('No Chair Game running!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      if (game.players.size < 2) return interaction.editReply({embeds:[errEmbed('Need at least 2 players!')]});
      game.round++;
      const ch = await client.channels.fetch(game.channelId);
      // Randomly decide: green (safe=click) or red (safe=don't click)
      const isGreen = Math.random() < 0.5;
      game.safeColor = isGreen ? 'green' : 'red';
      game.clickedThisRound = new Set();
      const roundId = `cgr_${game.gwId}_${game.round}`;
      const color = isGreen ? 0x57F287 : 0xED4245;
      const label = isGreen ? '✅ Click Me!' : '🛑 DO NOT Click!';
      const desc  = isGreen ? '🟢 **GREEN ROUND** — Click the button to stay safe!\n\nPlayers who **do NOT click** are eliminated!' : '🔴 **RED ROUND** — DO NOT click the button!\n\nPlayers who **DO click** are eliminated!';
      const roundMsg = await ch.send({
        embeds:[new EmbedBuilder().setColor(color).setTitle(`🪑 Chair Game — Round ${game.round}`).setDescription(desc).setFooter({text:`${game.players.size} players remaining · 10 seconds!`})],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(roundId).setLabel(label).setStyle(isGreen?ButtonStyle.Success:ButtonStyle.Danger))]
      });
      game.roundMsgId = roundMsg.id;
      // After 10s, eliminate
      setTimeout(async () => {
        try {
          const g = activeChairGame.get(interaction.guildId);
          if (!g || g.round !== game.round) return;
          const clicked = g.clickedThisRound || new Set();
          let eliminated = new Set();
          if (g.safeColor === 'green') { g.players.forEach(p => { if (!clicked.has(p)) eliminated.add(p); }); }
          else                          { clicked.forEach(p => { if (g.players.has(p)) eliminated.add(p); }); }
          eliminated.forEach(p => g.players.delete(p));
          // Disable button
          try { const m = await ch.messages.fetch(roundMsg.id); await m.edit({components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(roundId+'_done').setLabel(label).setStyle(isGreen?ButtonStyle.Success:ButtonStyle.Danger).setDisabled(true))]}); } catch {}
          if (g.players.size <= 1) {
            // Game over
            activeChairGame.delete(interaction.guildId);
            const winner = g.players.size === 1 ? [...g.players][0] : null;
            if (winner) {
              const u = await getUser(winner, 'unknown');
              u.coins += g.prize; u.totalEarned = (u.totalEarned||0)+g.prize;
              await saveUser(u);
              sendLog(client,{title:'🪑 Chair Game Winner',color:0xF1C40F,fields:[{name:'Winner',value:`<@${winner}>`,inline:true},{name:'Prize',value:`${g.prize} coins`,inline:true},{name:'Rounds',value:`${g.round}`,inline:true}]});
            }
            await ch.send({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🪑 Chair Game Over!').setDescription(winner?`🏆 <@${winner}> wins **${g.prize}** ${COIN_EMOJI}!`:'Everyone was eliminated — no winner!').addFields({name:'Eliminated this round',value:eliminated.size?[...eliminated].map(p=>`<@${p}>`).join(' '):'None',inline:false})]});
          } else {
            const elimList = eliminated.size ? [...eliminated].map(p=>`<@${p}>`).join(' ') : 'Nobody';
            await ch.send({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle(`🪑 Round ${g.round} Results`).setDescription(`**Eliminated:** ${elimList}\n**Remaining:** ${g.players.size} players\n\nHost: use \`/chair-next\` for next round.`)]});
          }
        } catch(e){ console.error('Chair round end error:',e.message); }
      }, 10000);
      return interaction.editReply({embeds:[okEmbed(`Round ${game.round} started! Results in 10 seconds.`)]});
    }

    // ══════════════════════════════════════════
    //  MAFIA
    // ══════════════════════════════════════════
    if (cmd==='mafia') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      if (activeMafia.has(interaction.guildId)) return reply({embeds:[errEmbed('A Mafia game is already running!')],flags:MessageFlags.Ephemeral});
      const prize = interaction.options.getInteger('prize');
      const numMurderers = interaction.options.getInteger('murderers')||1;
      const gwId = `MF${Date.now()}`;
      const joinMsg = await interaction.channel.send({
        embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle('🔪 Mafia — Join Now!').setDescription('Click **Join** to enter Mafia!\n\nYou will be secretly assigned as **Murderer** or **Innocent**.\n\nHost will start when ready.').setFooter({text:`Prize: ${prize.toLocaleString()} coins for winners`})],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mf_join_${gwId}`).setLabel('🔪 Join').setStyle(ButtonStyle.Primary))]
      });
      activeMafia.set(interaction.guildId, { gwId, prize, numMurderers, players: new Set(), phase: 'joining', hostId: me.id, channelId: interaction.channelId, joinMsgId: joinMsg.id, murderers: new Set(), round: 0, votes: new Map(), alive: new Set() });
      sendLog(client,{title:'🔪 Mafia Started',color:0x9B59B6,fields:[{name:'Host',value:`<@${me.id}>`,inline:true},{name:'Prize',value:`${prize} coins`,inline:true},{name:'Murderers',value:`${numMurderers}`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ Mafia lobby posted! Use `/mafia-start` once enough players join.')],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='mafia-start') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeMafia.get(interaction.guildId);
      if (!game) return reply({embeds:[errEmbed('No Mafia game in lobby!')],flags:MessageFlags.Ephemeral});
      if (game.phase !== 'joining') return reply({embeds:[errEmbed('Game already started!')],flags:MessageFlags.Ephemeral});
      if (game.players.size < game.numMurderers+2) return reply({embeds:[errEmbed(`Need at least ${game.numMurderers+2} players!`)],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      // Assign roles
      const playerArr = [...game.players];
      const shuffled = playerArr.sort(()=>Math.random()-0.5);
      const murderers = new Set(shuffled.slice(0, game.numMurderers));
      game.murderers = murderers;
      game.alive = new Set(playerArr);
      game.phase = 'night';
      game.round = 1;
      // DM everyone their role
      for (const pid of playerArr) {
        const isMurd = murderers.has(pid);
        try {
          const u = await client.users.fetch(pid);
          const murdList = isMurd ? [...murderers].filter(m=>m!==pid).map(m=>`<@${m}>`).join(', ')||'Just you' : 'Unknown';
          await u.send({embeds:[new EmbedBuilder()
            .setColor(isMurd?0xED4245:0x57F287)
            .setTitle(isMurd?'🔪 You are a MURDERER!':'😇 You are INNOCENT!')
            .setDescription(isMurd?`You are a murderer! Other murderers: ${murdList}\n\nUse \`/mafia-kill @user\` to kill someone each round.`:'You are innocent! Find and vote out the murderers.\n\nUse \`/mafia-vote @user\` to vote who you think is the murderer.')
          ]});
        } catch {}
      }
      const ch = await client.channels.fetch(game.channelId);
      await ch.send({embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle('🔪 Mafia — Round 1 Begins!').setDescription(`**${playerArr.length} players** have joined!\n\nCheck your DMs for your role!\n\n**Murderers:** Use \`/mafia-kill @user\`\n**Innocents:** Use \`/mafia-vote @user\`\n\nHost will end the round with \`/mafia-next\`.`).setFooter({text:`${murderers.size} murderer(s) among you...`})]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Mafia Started').setDescription(`Roles assigned! Murderers: ${[...murderers].map(m=>`<@${m}>`).join(', ')}`)]});
    }
    if (cmd==='mafia-next') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeMafia.get(interaction.guildId);
      if (!game || game.phase==='joining') return reply({embeds:[errEmbed('No active Mafia game!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const ch = await client.channels.fetch(game.channelId);
      // Process kills
      const kills = game.killVote ? [game.killVote] : [];
      kills.forEach(p => game.alive.delete(p));
      // Process votes — most voted non-murderer gets eliminated
      const voteCounts = new Map();
      game.votes.forEach(v => voteCounts.set(v,(voteCounts.get(v)||0)+1));
      let topVoted = null, topCount = 0;
      voteCounts.forEach((cnt,pid) => { if (cnt>topCount){topCount=cnt;topVoted=pid;} });
      if (topVoted) game.alive.delete(topVoted);
      // Check win conditions
      const aliveMurds  = [...game.alive].filter(p=>game.murderers.has(p));
      const aliveInno   = [...game.alive].filter(p=>!game.murderers.has(p));
      const murdWin     = aliveInno.length===0;
      const innoWin     = aliveMurds.length===0;
      if (murdWin||innoWin||game.alive.size<2) {
        activeMafia.delete(interaction.guildId);
        const winners = innoWin ? aliveInno : [...game.murderers];
        for (const w of winners) {
          try { const u=await getUser(w,'unknown'); u.coins+=game.prize; u.totalEarned=(u.totalEarned||0)+game.prize; await saveUser(u); } catch {}
        }
        sendLog(client,{title:'🔪 Mafia Ended',color:0x9B59B6,fields:[{name:'Result',value:innoWin?'Innocents Win!':'Murderers Win!',inline:true},{name:'Winners',value:winners.map(w=>`<@${w}>`).join(' '),inline:false}]});
        await ch.send({embeds:[new EmbedBuilder().setColor(innoWin?0x57F287:0xED4245).setTitle('🔪 Mafia — Game Over!').setDescription(`${innoWin?'😇 Innocents win! Murderers were caught!':'🔪 Murderers win! They eliminated all innocents!'}\n\n**Winners:** ${winners.map(w=>`<@${w}>`).join(' ')}\n**Prize:** ${game.prize} ${COIN_EMOJI} each!`)]});
        return interaction.editReply({embeds:[okEmbed('Game ended!')]});
      }
      // Continue
      game.round++; game.killVote=null; game.votes=new Map();
      const killedStr = kills.map(k=>`<@${k}>`).join(' ')||'Nobody';
      const votedStr  = topVoted?`<@${topVoted}>`:'Nobody';
      await ch.send({embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle(`🔪 Mafia — Round ${game.round} Results`).setDescription(`**Killed last night:** ${killedStr}\n**Voted out:** ${votedStr}\n\n**Alive:** ${[...game.alive].map(p=>`<@${p}>`).join(' ')}\n\nNew round starts! Use \`/mafia-kill\` or \`/mafia-vote\` then host uses \`/mafia-next\`.`)]});
      return interaction.editReply({embeds:[okEmbed(`Round ${game.round} started!`)]});
    }
    if (cmd==='mafia-kill') {
      const game = activeMafia.get(interaction.guildId);
      if (!game || game.phase==='joining') return reply({embeds:[errEmbed('No active Mafia game!')],flags:MessageFlags.Ephemeral});
      if (!game.murderers.has(me.id)) return reply({embeds:[errEmbed('You are not a murderer!')],flags:MessageFlags.Ephemeral});
      const target = interaction.options.getUser('user');
      if (!game.alive.has(target.id)) return reply({embeds:[errEmbed('That player is already eliminated!')],flags:MessageFlags.Ephemeral});
      if (game.murderers.has(target.id)) return reply({embeds:[errEmbed('You cannot kill a fellow murderer!')],flags:MessageFlags.Ephemeral});
      game.killVote = target.id;
      return reply({embeds:[okEmbed(`You selected <@${target.id}> to be eliminated. Host will process at end of round.`)],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='mafia-vote') {
      const game = activeMafia.get(interaction.guildId);
      if (!game || game.phase==='joining') return reply({embeds:[errEmbed('No active Mafia game!')],flags:MessageFlags.Ephemeral});
      if (!game.alive.has(me.id)) return reply({embeds:[errEmbed('You are eliminated!')],flags:MessageFlags.Ephemeral});
      const target = interaction.options.getUser('user');
      if (target.id===me.id) return reply({embeds:[errEmbed('You cannot vote for yourself!')],flags:MessageFlags.Ephemeral});
      if (!game.alive.has(target.id)) return reply({embeds:[errEmbed('That player is already eliminated!')],flags:MessageFlags.Ephemeral});
      game.votes.set(me.id, target.id);
      return reply({embeds:[okEmbed(`You voted for <@${target.id}>!`)],flags:MessageFlags.Ephemeral});
    }

    // ══════════════════════════════════════════
    //  PICK A NUMBER
    // ══════════════════════════════════════════
    if (cmd==='pick-number') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      if (activePickNumber.has(interaction.guildId)) return reply({embeds:[errEmbed('A Pick a Number game is already running!')],flags:MessageFlags.Ephemeral});
      const prize = interaction.options.getInteger('prize');
      const gwId = `PN${Date.now()}`;
      const joinMsg = await interaction.channel.send({
        embeds:[new EmbedBuilder().setColor(0xF39C12).setTitle('🔢 Pick a Number — Join!').setDescription('Click **Join** to enter Pick a Number!\n\nYou will get a number grid (1–50). Pick one — if others pick the same number as you, you\'re eliminated!\n\nLast one standing wins!').setFooter({text:`Prize: ${prize.toLocaleString()} coins`})],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`pn_join_${gwId}`).setLabel('🔢 Join').setStyle(ButtonStyle.Primary))]
      });
      activePickNumber.set(interaction.guildId, { gwId, prize, players: new Set(), phase: 'joining', hostId: me.id, channelId: interaction.channelId, joinMsgId: joinMsg.id, round: 0, picks: new Map() });
      sendLog(client,{title:'🔢 Pick a Number Started',color:0xF39C12,fields:[{name:'Host',value:`<@${me.id}>`,inline:true},{name:'Prize',value:`${prize} coins`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ Pick a Number lobby posted! Use `/pick-number-round` to start a round.')],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='pick-number-round') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activePickNumber.get(interaction.guildId);
      if (!game) return reply({embeds:[errEmbed('No Pick a Number game running!')],flags:MessageFlags.Ephemeral});
      if (game.players.size < 2) return reply({embeds:[errEmbed('Need at least 2 players!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      game.round++; game.picks = new Map(); game.phase = 'picking';
      const ch = await client.channels.fetch(game.channelId);
      const gwId = game.gwId; const round = game.round;
      // Send number grid as buttons (5 rows of 5 = 25 numbers per message, do 2 messages for 1-50)
      const makeRow = (start, gwId, round) => new ActionRowBuilder().addComponents(
        ...[0,1,2,3,4].map(i => new ButtonBuilder().setCustomId(`pn_pick_${gwId}_${round}_${start+i}`).setLabel(`${start+i}`).setStyle(ButtonStyle.Secondary))
      );
      const rows1 = [1,6,11,16,21].map(s=>makeRow(s,gwId,round));
      const rows2 = [26,31,36,41,46].map(s=>makeRow(s,gwId,round));
      await ch.send({content:`🔢 **Round ${round} — Pick your number! (1-25)**`,components:rows1});
      await ch.send({content:`🔢 **(26-50)**`,components:rows2});
      await ch.send({embeds:[new EmbedBuilder().setColor(0xF39C12).setDescription(`⏰ **30 seconds to pick!** Players: ${[...game.players].map(p=>`<@${p}>`).join(' ')}`)]}); 
      // After 30s process
      setTimeout(async()=>{
        try {
          const g = activePickNumber.get(interaction.guildId);
          if (!g || g.round!==round) return;
          // Find duplicates
          const pickCounts = new Map();
          g.picks.forEach(n => pickCounts.set(n,(pickCounts.get(n)||0)+1));
          const eliminated = new Set();
          g.picks.forEach((n,pid) => { if ((pickCounts.get(n)||0)>1) eliminated.add(pid); });
          // Also eliminate anyone who didn't pick
          g.players.forEach(pid => { if (!g.picks.has(pid)) eliminated.add(pid); });
          eliminated.forEach(p => g.players.delete(p));
          if (g.players.size<=1) {
            const winner = g.players.size===1?[...g.players][0]:null;
            activePickNumber.delete(interaction.guildId);
            if (winner) { const u=await getUser(winner,'unknown'); u.coins+=g.prize; u.totalEarned=(u.totalEarned||0)+g.prize; await saveUser(u); }
            sendLog(client,{title:'🔢 Pick a Number Winner',color:0xF1C40F,fields:[{name:'Winner',value:winner?`<@${winner}>`:'No winner',inline:true},{name:'Prize',value:`${g.prize} coins`,inline:true}]});
            await ch.send({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🔢 Pick a Number — Game Over!').setDescription(winner?`🏆 <@${winner}> wins **${g.prize}** ${COIN_EMOJI}!`:'Everyone was eliminated!')]});
          } else {
            const elimStr = eliminated.size?[...eliminated].map(p=>`<@${p}>`).join(' '):'Nobody';
            await ch.send({embeds:[new EmbedBuilder().setColor(0xF39C12).setTitle(`🔢 Round ${round} Results`).setDescription(`**Eliminated:** ${elimStr}\n**Remaining:** ${[...g.players].map(p=>`<@${p}>`).join(' ')}\n\nHost: use \`/pick-number-round\` for next round!`)]});
          }
        } catch(e){console.error('PN round error:',e.message);}
      },30000);
      return interaction.editReply({embeds:[okEmbed(`Round ${round} started! 30 seconds to pick.`)]});
    }

    // ══════════════════════════════════════════
    //  LOOT DROP
    // ══════════════════════════════════════════

    // ══════════════════════════════════════════
    //  CUSTOM ROLE CLAIM (via modal)
    // ══════════════════════════════════════════
    // Custom role claim is handled in the modal submit section

    // ══════════════════════════════════════════
    //  SPIN THE WHEEL
    // ══════════════════════════════════════════
    if (cmd==='spin-wheel') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      if (!canRunAdmin(interaction)) return interaction.editReply({embeds:[errEmbed('No permission!')]});
      if (activeSpinWheel.has(interaction.guildId)) return interaction.editReply({embeds:[errEmbed('A Spin the Wheel is already running!')]});
      const duration   = interaction.options.getInteger('duration');
      const maxEntries = interaction.options.getInteger('max_entries');
      const numWinners = interaction.options.getInteger('winners');
      const prizeCoins = interaction.options.getInteger('prize_coins');
      const prizeName  = interaction.options.getString('prize_name');
      const endsAt     = Date.now() + duration * 60 * 1000;
      const swId       = `SW${Date.now()}`;
      const swMsg = await interaction.channel.send({
        embeds:[new EmbedBuilder().setColor(0xE91E63).setTitle('🎡 Spin the Wheel!')
          .setDescription(`Click **Enter** to join the wheel!\n\n🏆 **Prize:** ${prizeName}\n💰 **Coins:** ${prizeCoins.toLocaleString()} ${COIN_EMOJI} per winner\n👑 **Winners:** ${numWinners}\n👥 **Max entries:** ${maxEntries}\n\n⏰ Ends ${ts(endsAt)} (${ts(endsAt,'T')} your time)`)
          .setFooter({text:`0/${maxEntries} entered`}).setTimestamp(endsAt)],
        components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sw_enter_${swId}`).setLabel('🎡 Enter').setStyle(ButtonStyle.Primary)
        )]
      });
      const swState = { swId, prize: prizeName, prizeCoins, numWinners, maxEntries, hostId: me.id, endsAt, channelId: interaction.channelId, msgId: swMsg.id, entries: new Set() };
      activeSpinWheel.set(interaction.guildId, swState);
      const swTimeout = setTimeout(async () => {
        try {
          const state = activeSpinWheel.get(interaction.guildId);
          if (!state) return;
          activeSpinWheel.delete(interaction.guildId);
          const ch = await client.channels.fetch(state.channelId);
          const msg = await ch.messages.fetch(state.msgId);
          const entrants = [...state.entries];
          if (!entrants.length) {
            await msg.edit({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🎡 Spin the Wheel — Ended').setDescription('Nobody entered!')],components:[]});
            return;
          }
          // Spin — pick random winners
          const shuffled = entrants.sort(()=>Math.random()-0.5);
          const winners  = shuffled.slice(0, Math.min(state.numWinners, entrants.length));
          for (const w of winners) {
            const u = await getUser(w,'unknown'); u.coins+=state.prizeCoins; u.totalEarned=(u.totalEarned||0)+state.prizeCoins; await saveUser(u);
            try { const usr=await client.users.fetch(w); await usr.send({embeds:[new EmbedBuilder().setColor(0xE91E63).setTitle('🎡 You Won!').setDescription(`You won the Spin the Wheel!\n\n**Prize:** ${state.prize}\n**Coins:** +${state.prizeCoins.toLocaleString()} ${COIN_EMOJI}`)]}); } catch {}
          }
          const winMentions = winners.map(w=>`<@${w}>`).join(' ');
          await msg.edit({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎡 Spin the Wheel — Results!').setDescription(`The wheel has been spun!\n\n🏆 **Winners:** ${winMentions}\n💰 **Prize:** ${state.prize} + ${state.prizeCoins.toLocaleString()} ${COIN_EMOJI} each\n\n👥 ${entrants.length} people entered`).setTimestamp()],components:[]});
          await msg.reply({content:`🎡 Congratulations ${winMentions}! You won **${state.prize}**!`});
          sendLog(client,{title:'🎡 Spin the Wheel Ended',color:0xE91E63,fields:[{name:'Winners',value:winMentions,inline:false},{name:'Prize',value:state.prize,inline:true},{name:'Coins Each',value:`${state.prizeCoins.toLocaleString()} ${COIN_EMOJI}`,inline:true},{name:'Entries',value:`${entrants.length}`,inline:true}]});
        } catch(e){ console.error('Spin wheel end error:',e.message); }
      }, duration * 60 * 1000);
      swState.timeout = swTimeout;
      sendLog(client,{title:'🎡 Spin the Wheel Started',color:0xE91E63,fields:[{name:'Host',value:`<@${me.id}>`,inline:true},{name:'Prize',value:prizeName,inline:true},{name:'Winners',value:`${numWinners}`,inline:true},{name:'Max',value:`${maxEntries}`,inline:true},{name:'Duration',value:`${duration} min`,inline:true}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ Spin the Wheel posted! Ends ${ts(endsAt)}`)]});
    }

    // ══════════════════════════════════════════
    //  TESTING SERVER COMMANDS
    // ══════════════════════════════════════════


    if (cmd==='test-inv') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This is only available in the test server!')],flags:MessageFlags.Ephemeral});
      if (!hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role!')],flags:MessageFlags.Ephemeral});
      const u = await getUser(me.id, me.username);
      const inv = (u.inventory||[]);
      if (!inv.length) return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('🎒 Test Inventory').setDescription('Your inventory is empty! Use `/test-redeem` to buy items.')],flags:MessageFlags.Ephemeral});
      const lines = inv.map(i => {
        const e = i.category==='PS99'?'💎':i.category==='SailorPiece'?'⚔️':i.category==='TestCustomRole'?'🎨':'📦';
        return `${e} **${i.name}** — \`${i.claimId}\` · \`/claim ${i.claimId}\``;
      }).join('\n');
      return reply({embeds:[new EmbedBuilder().setColor(0xE91E63).setTitle('🎒 Test Inventory').setDescription(lines).setFooter({text:`${inv.length} item(s)`})],flags:MessageFlags.Ephemeral});
    }

    if (cmd==='test-shop') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This is only available in the test server!')],flags:MessageFlags.Ephemeral});
      if (!hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role!')],flags:MessageFlags.Ephemeral});
      const roleLines   = `🎨 **Custom Role** — \`100\` ${COIN_EMOJI} · \`test_role\``;
      const ps99Items   = SHOP.filter(i=>i.category==='PS99');
      const spItems     = SHOP.filter(i=>i.category==='SailorPiece');
      const ps99Lines   = ps99Items.map(i=>`💎 **${i.name}** — \`${i.cost}\` ${COIN_EMOJI} · \`${i.id}\``).join('\n');
      const spLines     = spItems.map(i=>`⚔️ **${i.name}** — \`${i.cost}\` ${COIN_EMOJI} · \`${i.id}\``).join('\n');
      return reply({embeds:[new EmbedBuilder().setColor(0xE91E63).setTitle('🧪 Testing Server Shop').addFields(
        {name:'🎨 Custom Role',value:roleLines,inline:false},
        {name:'💎 Pet Simulator 99',value:ps99Lines,inline:false},
        {name:'⚔️ Sailor Piece',value:spLines,inline:false}
      ).setFooter({text:'Buy: /test-redeem <item>'})]});
    }

    if (cmd==='test-redeem') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This is only available in the test server!')],flags:MessageFlags.Ephemeral});
      if (!hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role!')],flags:MessageFlags.Ephemeral});
      const itemId = interaction.options.getString('item');
      const item   = SHOP.find(i=>i.id===itemId);
      if (!item) return reply({embeds:[errEmbed('Item not found!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const u = await getUser(me.id, me.username);
      if (u.coins < item.cost) return interaction.editReply({embeds:[errEmbed(`You need **${item.cost}** ${COIN_EMOJI} but only have **${u.coins.toLocaleString()}**!`)]});
      const claimId = await nextClaimId();
      u.coins = Math.max(0, u.coins - item.cost);
      u.inventory.push({claimId, itemId: item.id, name: item.name, category: item.category, robuxAmt: 0, cost: item.cost});
      await saveUser(u);
      // If custom role — show modal via claim
      sendLog(client,{title:'🧪 Test Item Redeemed',color:0xE91E63,fields:[{name:'User',value:`<@${me.id}>`,inline:true},{name:'Item',value:item.name,inline:true},{name:'Category',value:item.category,inline:true},{name:'Cost',value:`${item.cost} ${COIN_EMOJI}`,inline:true},{name:'Claim ID',value:`\`${claimId}\``,inline:true}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🧪 Item Added to Inventory!').setDescription(`**${item.name}** added!\n\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}\nClaim ID: \`${claimId}\`\n\nUse \`/claim ${claimId}\` to submit!`)]});
    }

    if (cmd==='find-claim') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This is only available in the test server!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const category = interaction.options.getString('category');
      const allClaims = await getClaims();
      const arr = Array.isArray(allClaims) ? allClaims : [];
      const filtered = category === 'all' ? arr : arr.filter(c => c.category === category);
      if (!filtered.length) return interaction.editReply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setDescription(`No pending claims found for **${category}**.`)]});
      const catEmoji = {Robux:'💎',PS99:'💎',Nitro:'💜',ETFB:'✨',SailorPiece:'⚔️',CustomRole:'🎨',all:'📋'};
      const emoji = catEmoji[category] || '📋';
      const fields = filtered.slice(0,25).map(c => ({
        name: `${emoji} ${c.claimId} — ${c.itemName}`,
        value: `👤 **${c.username}** (<@${c.userId}>)\n📅 ${ts(c.claimedAt,'R')}${c.roleDetails?`\n🎨 Role: **${c.roleDetails.name}** | ${c.roleDetails.color}`:''}${c.robloxUsername&&c.robloxUsername!=='N/A'?`\n🎮 Roblox: \`${c.robloxUsername}\``:''}`,
        inline: false
      }));
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 Claims — ${category==='all'?'All':category} (${filtered.length})`).addFields(fields).setFooter({text:'Use /claimed <id> or /deny-claim <id> to process'})]});
    }

    if (cmd==='test-ping') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This command is only available in the test server!')],flags:MessageFlags.Ephemeral});
      if (!hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role!')],flags:MessageFlags.Ephemeral});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🏓 Pong!').setDescription(`Bot is online! Latency: **${client.ws.ping}ms**`)]});
    }
    if (cmd==='test-balance') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This command is only available in the test server!')],flags:MessageFlags.Ephemeral});
      if (!hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role!')],flags:MessageFlags.Ephemeral});
      const u = await getUser(me.id, me.username);
      return reply({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🧪 Test Balance').setDescription(`**${me.username}:** ${u.coins.toLocaleString()} ${COIN_EMOJI}`)]});
    }
    if (cmd==='test-give') {
      if (!isTestSrv) return reply({embeds:[errEmbed('This command is only available in the test server!')],flags:MessageFlags.Ephemeral});
      if (!hasTesterRole(interaction.member)) return reply({embeds:[errEmbed('You need the Tester role!')],flags:MessageFlags.Ephemeral});
      const amt = interaction.options.getInteger('amount');
      const u = await getUser(me.id, me.username);
      u.coins += amt; u.totalEarned=(u.totalEarned||0)+amt;
      await saveUser(u);
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🧪 Test Give').setDescription(`+**${amt}** ${COIN_EMOJI} given to yourself!\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`)]});
    }


    if (cmd==='lootdrop') {
      if (activeLootDrop) return reply({embeds:[errEmbed('A Loot Drop is already active! Someone needs to claim it first.')],flags:MessageFlags.Ephemeral});
      const coins = Math.floor(Math.random()*41)+10; // 10-50, secret until claimed
      // Send the public embed and save the message reference so we can edit it later
      let dropMsg = null;
      try {
        dropMsg = await interaction.channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('📦 Loot Drop!')
            .setDescription(
              'A mystery loot box has appeared!\n\n' +
              '🎁 **Unknown amount of coins inside...**\n\n' +
              'Use `u!use-code LOOTDROP` or `/use-code LOOTDROP` to claim it!\n\n' +
              '⚡ **First person to claim it wins — only 1 winner!**'
            )
            .setFooter({ text: 'Be fast — only one person can claim this!' })
            .setTimestamp()]
        });
      } catch(e){ console.error('Lootdrop send error:', e.message); }
      // Store state with message reference
      activeLootDrop = { coins, claimed: false, msg: dropMsg };
      sendLog(client,{title:'📦 Loot Drop Started',color:0xF1C40F,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Coins Inside',value:`**${coins}** ${COIN_EMOJI}`,inline:true},{name:'Status',value:'🟢 Active — awaiting claim',inline:true}],user:me.username});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('📦 Loot Drop Created!').setDescription(`A loot drop with **${coins}** ${COIN_EMOJI} is now live!\n\nFirst to use \`LOOTDROP\` wins it.`).setFooter({text:'Only you can see the coin amount'})],flags:MessageFlags.Ephemeral});
    }

    // ══════════════════════════════════════════
    //  GAMBLING COMMANDS
    // ══════════════════════════════════════════

    // ── Win chance: 30% normal, 20% if bet >= 500 ──
    function gamblingWinChance(bet) { return bet >= 500 ? 0.20 : 0.30; }
    function gamblingRoll(bet)      { return Math.random() < gamblingWinChance(bet); }

    if (cmd==='coinflip') {
      await interaction.deferReply();
      const bet  = interaction.options.getInteger('bet');
      const side = interaction.options.getString('side');
      const u    = await getUser(me.id, me.username);
      if (u.coins < bet) return interaction.editReply({embeds:[errEmbed(`You only have **${u.coins.toLocaleString()}** ${COIN_EMOJI}!`)]});

      const won    = gamblingRoll(bet);
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      // Determine result
      const actualResult = won ? side : (side==='heads'?'tails':'heads');
      const emoji  = actualResult==='heads' ? '🟡' : '⚫';

      if (won) { u.coins += bet; u.totalEarned=(u.totalEarned||0)+bet; }
      else      { u.coins = Math.max(0, u.coins - bet); }
      await saveUser(u);
      sendLog(client,{title:'🪙 Coinflip',color:won?0x57F287:0xED4245,fields:[{name:'Player',value:`<@${me.id}>`,inline:true},{name:'Result',value:actualResult,inline:true},{name:won?'Won':'Lost',value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});

      const color = won ? 0x57F287 : 0xED4245;
      const title = won ? `${emoji} ${actualResult.toUpperCase()} — You Win!` : `${emoji} ${actualResult.toUpperCase()} — You Lose!`;
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(color).setTitle(`🪙 Coinflip — ${title}`)
        .addFields(
          {name:'Your Pick', value:side.charAt(0).toUpperCase()+side.slice(1), inline:true},
          {name:'Result',    value:actualResult.charAt(0).toUpperCase()+actualResult.slice(1), inline:true},
          {name:'Bet',       value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline:true},
          {name:won?'Won':'Lost', value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline:true},
          {name:'Balance',   value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`, inline:true}
        ).setFooter({text:'Good luck! 🎲'})]});
    }

    if (cmd==='slots') {
      await interaction.deferReply();
      const bet = interaction.options.getInteger('bet');
      const u   = await getUser(me.id, me.username);
      if (u.coins < bet) return interaction.editReply({embeds:[errEmbed(`You only have **${u.coins.toLocaleString()}** ${COIN_EMOJI}!`)]});

      const SYMBOLS = ['🍒','🍋','🍊','🍇','⭐','💎','🎰'];
      // Weight symbols so jackpot (💎💎💎) is very rare
      const WEIGHTED = ['🍒','🍒','🍒','🍋','🍋','🍋','🍊','🍊','🍋','🍇','🍇','⭐','⭐','🎰','💎'];
      function spin() { return WEIGHTED[Math.floor(Math.random()*WEIGHTED.length)]; }

      const won = gamblingRoll(bet);
      let reels;
      if (won) {
        // Win: give them two matching at least (but not jackpot unless very lucky)
        const s = spin();
        reels = Math.random() < 0.1 ? [s,s,s] : [s,s,spin()]; // 10% chance full match on a win
        if (reels[2]===reels[0]) reels[2]=spin(); // prevent accidental jackpot on basic win
      } else {
        // Loss: guarantee no two consecutive match or only allow one pair max
        reels = [spin(),spin(),spin()];
        if (reels[0]===reels[1]&&reels[1]===reels[2]) reels[2]=SYMBOLS.find(s=>s!==reels[0])||'🍒';
        if (reels[0]===reels[1]) reels[1]=SYMBOLS.find(s=>s!==reels[0])||'🍋';
      }

      const isJackpot = reels[0]===reels[1]&&reels[1]===reels[2];
      const isWin     = isJackpot || won;
      const multiplier = isJackpot ? 5 : 1;
      const payout    = bet * multiplier;

      if (isWin)  { u.coins += payout; u.totalEarned=(u.totalEarned||0)+payout; }
      else         { u.coins = Math.max(0, u.coins - bet); }
      await saveUser(u);
      sendLog(client,{title:'🎰 Slots',color:isWin?0x57F287:0xED4245,fields:[{name:'Player',value:`<@${me.id}>`,inline:true},{name:'Reels',value:reels.join(' '),inline:true},{name:isWin?'Won':'Lost',value:`**${(isWin?payout:bet).toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});

      const color = isWin ? 0x57F287 : 0xED4245;
      const resultText = isJackpot ? '🎉 **JACKPOT! 5x payout!**' : isWin ? '✅ **Winner!**' : '❌ **No match — You lose!**';
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(color).setTitle('🎰 Slot Machine')
        .setDescription(`## ${reels.join(' │ ')}\n\n${resultText}`)
        .addFields(
          {name:'Bet',     value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline:true},
          {name:isWin?'Won':'Lost', value:`**${payout.toLocaleString()}** ${COIN_EMOJI}`, inline:true},
          {name:'Balance', value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`, inline:true}
        ).setFooter({text:'Good luck! 🎲'})]});
    }

    if (cmd==='blackjack') {
      await interaction.deferReply();
      const bet = interaction.options.getInteger('bet');
      const u   = await getUser(me.id, me.username);
      if (u.coins < bet) return interaction.editReply({embeds:[errEmbed(`You only have **${u.coins.toLocaleString()}** ${COIN_EMOJI}!`)]});
      if (activeBlackjack.has(me.id)) return interaction.editReply({embeds:[errEmbed('You already have a game in progress!')]});

      const playerHand = [bjDraw(), bjDraw()];
      const dealerHand = [bjDraw(), bjDraw()];
      const game = { player: playerHand, dealer: dealerHand, bet, userId: me.id };
      activeBlackjack.set(me.id, game);

      const pt = bjTotal(playerHand);
      if (pt === 21) {
        activeBlackjack.delete(me.id);
        const dt = bjTotal(dealerHand);
        const push = dt === 21;
        if (!push) { u.coins += Math.floor(bet*1.5); u.totalEarned=(u.totalEarned||0)+Math.floor(bet*1.5); }
        await saveUser(u);
        const embed = bjEmbed(game, push?'push':'win');
        embed.addFields(push
          ? {name:'🤝 Push',value:'Bet returned',inline:true}
          : {name:'🎉 Blackjack!',value:`Won **${Math.floor(bet*1.5).toLocaleString()}** ${COIN_EMOJI} (3:2)`,inline:true}
        );
        return interaction.editReply({embeds:[embed], components:[bjButtons(true)]});
      }
      return interaction.editReply({embeds:[bjEmbed(game,'playing')], components:[bjButtons()]});
    }



    if (cmd==='doubleornothing') {
      await interaction.deferReply();
      const bet = interaction.options.getInteger('bet');
      const u   = await getUser(me.id, me.username);
      if (u.coins < bet) return interaction.editReply({embeds:[errEmbed(`You only have **${u.coins.toLocaleString()}** ${COIN_EMOJI}!`)]});

      const won = gamblingRoll(bet);
      // Dramatic number reveal
      const roll     = won ? Math.floor(Math.random()*50)+51 : Math.floor(Math.random()*50)+1; // 51-100 = win, 1-50 = lose
      const THRESHOLD = 50;

      if (won)  { u.coins += bet; u.totalEarned=(u.totalEarned||0)+bet; }
      else       { u.coins = Math.max(0, u.coins - bet); }
      await saveUser(u);
      sendLog(client,{title:'⚡ Double or Nothing',color:won?0x57F287:0xED4245,fields:[{name:'Player',value:`<@${me.id}>`,inline:true},{name:'Roll',value:`**${roll}**/100`,inline:true},{name:won?'Won':'Lost',value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});

      const color = won ? 0x57F287 : 0xED4245;
      const bar   = won ? '🟩'.repeat(Math.round(roll/10)) : '🟥'.repeat(Math.round(roll/10));

      return interaction.editReply({embeds:[new EmbedBuilder().setColor(color).setTitle('⚡ Double or Nothing')
        .setDescription(`The die was cast...\n\n## ${roll} / 100\n${bar}\n\n${won?`🎉 **DOUBLED!** You needed > ${THRESHOLD}, rolled **${roll}**!`:`💀 **NOTHING!** You needed > ${THRESHOLD}, rolled **${roll}**.`}`)
        .addFields(
          {name:'Bet',     value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline:true},
          {name:won?'Won':'Lost', value:`**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline:true},
          {name:'Balance', value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`, inline:true}
        ).setFooter({text:'Good luck! 🎲'})]});
    }

  } catch(e) {
    console.error(`/${cmd} error:`,e);
    const err={embeds:[errEmbed('Something went wrong!')],flags:MessageFlags.Ephemeral};
    try { interaction.replied||interaction.deferred?await interaction.followUp(err):await interaction.reply(err); } catch {}
  }
});

setInterval(()=>console.log('Heartbeat:',new Date().toISOString()),300_000);
client.login(BOT_TOKEN);
