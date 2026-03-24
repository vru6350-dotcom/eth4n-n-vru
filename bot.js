
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
process.on('uncaughtException',  e => console.error('Uncaught exception:', e));

const {
  Client, GatewayIntentBits,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const fetch = require('node-fetch');
require('dotenv').config();

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

// ── Game state maps ──
const activeChairGame  = new Map(); // guildId -> state
const activeMafia      = new Map(); // guildId -> state
const activePickNumber = new Map(); // guildId -> state
const activeGreentea   = new Map(); // guildId -> state
const activeBlacktea   = new Map(); // guildId -> state

// ── Active Loot Drop state ──
// { coins, claimedBy: null|userId }
let activeLootDrop = null;
const activeGiveaways = new Map();

// Bank tiers: { id, name, cost, capacity }
const BANK_TIERS = [
  { id: 'bank_basic',  name: 'Basic Bank',    cost: 500,  capacity: 500  },
  { id: 'bank_t2',     name: 'Bank Tier 2',   cost: 750,  capacity: 750  },
  { id: 'bank_t3',     name: 'Bank Tier 3',   cost: 1000, capacity: 1000 },
  { id: 'bank_t4',     name: 'Bank Tier 4',   cost: 1250, capacity: 1250 },
  { id: 'bank_t5',     name: 'Bank Tier 5',   cost: 1500, capacity: 1500 },
  { id: 'bank_t6',     name: 'Bank Tier 6',   cost: 2000, capacity: 2000 },
  { id: 'bank_t7',     name: 'Bank Tier 7',   cost: 2500, capacity: 2500 },
];

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
  { id: 'nitro',      name: 'Nitro Method', cost: 1000, category: 'Nitro', robuxAmt: 0   },
];

// ══════════════════════════════════════════
//  JSONBIN
//  ⚠️  Create a new bin at jsonbin.io and paste the ID for CODES below
// ══════════════════════════════════════════
const BIN_IDS = {
  users:  '69b13ea5c3097a1dd516fe70',
  store:  '69b13e7dc3097a1dd516fdc5',
  meta:   '69b13e8fb7ec241ddc5c5aa3',
  claims: '69b13ebbb7ec241ddc5c5b4b',
  warns:  '69b13ebbb7ec241ddc5c5b4c',
  codes:   '69b3f981b7ec241ddc65e003',
  roblox:  '69b663fab7ec241ddc6d458d',
  sab:     '69be9ee7c3097a1dd546d40a',
  giveaway:'69be9ed8b7ec241ddc8c18c5',
  vouches: '69bea2d3b7ec241ddc8c282e',
  banks:   '69c27ce0b7ec241ddc9ac304',
};
const DEFAULTS = {
  users:  {},
  store:  { robux: 0, divines: 0, celestials: 0 },
  roblox: {},
  sab:    [],
  giveaway: {},
  vouches: {},
  banks:   {},
  meta:   { stockMsgId: null, claimCounter: 0 },
  claims: [],
  warns:  {},
  codes:  {},
};
const cache     = { users: null, store: null, meta: null, claims: null, warns: null, codes: null, roblox: null, sab: null, giveaway: null, vouches: null, banks: null };
const cacheTime = { users: 0, store: 0, meta: 0, claims: 0, warns: 0, codes: 0, roblox: 0, sab: 0, giveaway: 0, vouches: 0, banks: 0 };
const CACHE_TTL = { users: Infinity, store: 0, meta: 30_000, claims: 30_000, warns: 30_000, codes: 60_000, roblox: 30_000, sab: 30_000, giveaway: 30_000, vouches: 30_000, banks: 0 };

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
async function saveUser(u) { const users = await dbRead('users'); users[u.id] = u; await dbWrite('users', users); }
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
      { name: '🛒 SAB',        value: '🔽 Click below to view!', inline: true }
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
    const store = await getStore(), embed = stockEmbed(store), meta = await getMeta();
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
  new SCB().setName('redeem').setDescription('Buy an item from the shop').addStringOption(o=>o.setName('item').setDescription('Item to buy').setRequired(true).addChoices(
    {name:'25 Robux — 100 coins',value:'robux_25'},{name:'50 Robux — 200 coins',value:'robux_50'},
    {name:'75 Robux — 300 coins',value:'robux_75'},{name:'100 Robux — 400 coins',value:'robux_100'},
    {name:'125 Robux — 500 coins',value:'robux_125'},{name:'150 Robux — 600 coins',value:'robux_150'},
    {name:'175 Robux — 700 coins',value:'robux_175'},{name:'200 Robux — 800 coins',value:'robux_200'},
    {name:'225 Robux — 900 coins',value:'robux_225'},{name:'250 Robux — 1000 coins',value:'robux_250'},
    {name:'Celestial ETFB — 100 coins',value:'etfb_cel'},{name:'Divine ETFB — 250 coins',value:'etfb_div'},{name:'Nitro Method — 1000 coins',value:'nitro'}
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
  new SCB().setName('greentea').setDescription('[ADMIN] Start a Greentea word game').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('prize').setDescription('Coins for winner').setRequired(true).setMinValue(1)),
  new SCB().setName('blacktea').setDescription('[ADMIN] Start a Blacktea word game (5 rounds)').setDefaultMemberPermissions(PFB.Administrator)
    .addIntegerOption(o=>o.setName('prize').setDescription('Coins for winner').setRequired(true).setMinValue(1)),
  new SCB().setName('chair-next').setDescription('[ADMIN] Start next Chair Game round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('mafia-start').setDescription('[ADMIN] Start Mafia after players join').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('mafia-next').setDescription('[ADMIN] Process Mafia round results').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('mafia-kill').setDescription('[MURDERER] Kill a player in Mafia').addUserOption(o=>o.setName('user').setDescription('Player to kill').setRequired(true)),
  new SCB().setName('mafia-vote').setDescription('[INNOCENT] Vote who you think is the murderer').addUserOption(o=>o.setName('user').setDescription('Player to vote out').setRequired(true)),
  new SCB().setName('pick-number-round').setDescription('[ADMIN] Start a Pick a Number round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('greentea-round').setDescription('[ADMIN] Start a Greentea round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('greentea-next').setDescription('[ADMIN] End Greentea round and eliminate').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('blacktea-round').setDescription('[ADMIN] Start a Blacktea round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('blacktea-next').setDescription('[ADMIN] Score Blacktea round').setDefaultMemberPermissions(PFB.Administrator),
  new SCB().setName('server-shop').setDescription('View the server shop (bank & upgrades)'),
  new SCB().setName('deposit').setDescription('Deposit coins into your bank').addIntegerOption(o=>o.setName('amount').setDescription('Amount to deposit (or 0 for max)').setRequired(true).setMinValue(0)),
  new SCB().setName('withdraw').setDescription('Withdraw coins from your bank').addIntegerOption(o=>o.setName('amount').setDescription('Amount to withdraw (or 0 for all)').setRequired(true).setMinValue(0)),
  new SCB().setName('rob').setDescription('Rob another user (if they have no bank)').addUserOption(o=>o.setName('user').setDescription('User to rob').setRequired(true)),
  new SCB().setName('bank').setDescription('Check your bank balance'),
  new SCB().setName('buy-bank').setDescription('Buy a bank from the server shop'),
  new SCB().setName('upgrade-bank').setDescription('Upgrade your bank to the next tier'),
].map(c => c.toJSON());

let coinWriteTimer = null;
function scheduleCoinFlush() {
  if (coinWriteTimer) return;
  coinWriteTimer = setTimeout(async () => {
    coinWriteTimer = null;
    if (!cache.users) return;
    try { await binWrite('users', cache.users); cacheTime.users = Date.now(); }
    catch (e) { console.error('Coin flush error:', e.message); setTimeout(scheduleCoinFlush, 5000); }
  }, 5000);
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

  // --- START: MODIFIED SLASH COMMAND REGISTRATION ---
  if (!CLIENT_ID) {
    console.warn('⚠️  CLIENT_ID not set — skipping slash command registration');
  } else {
    try {
      const { REST, Routes } = require('discord.js');
      const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
      
      const guildsToUpdate = [GUILD_ID];
      if (TEST_GUILD_ID && !guildsToUpdate.includes(TEST_GUILD_ID)) {
        guildsToUpdate.push(TEST_GUILD_ID);
      }

      for (const guildId of guildsToUpdate) {
        if (!guildId) continue;
        const data = await rest.put(
          Routes.applicationGuildCommands(CLIENT_ID, guildId),
          { body: slashDefs },
        );
        console.log(`✅ Registered ${data.length} slash commands for guild ${guildId}`);
      }
    } catch (e) { console.error('Slash command registration failed:', e.message); }
  }
  // --- END: MODIFIED SLASH COMMAND REGISTRATION ---

  try { await dbRead('users'); console.log('✅ Cache warmed'); } catch (e) { console.error('Cache warmup error:', e.message); }
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

  // ── GREENTEA word listener ──
  const gtGame = activeGreentea.get(msg.guild?.id);
  if (gtGame && gtGame.phase==='answering' && gtGame.players.has(msg.author.id) && msg.channel.id===gtGame.channelId) {
    const word = msg.content.trim().toUpperCase();
    const alreadyAnswered = gtGame.answers.has(msg.author.id);
    const wordUsed = gtGame.usedWords.has(word);
    const startsOk = word.startsWith(gtGame.letters);
    if (startsOk && !wordUsed && !alreadyAnswered) {
      gtGame.answers.set(msg.author.id, { word, at: Date.now() });
      gtGame.usedWords.add(word);
      try { await msg.react('✅'); } catch {}
    } else {
      const curChances = (gtGame.chances.get(msg.author.id)||3) - 1;
      gtGame.chances.set(msg.author.id, curChances);
      try { await msg.react('❌'); } catch {}
      if (curChances <= 0) {
        try { await msg.reply({embeds:[new EmbedBuilder().setColor(0xED4245).setDescription(`<@${msg.author.id}> used all 3 chances and will be eliminated this round!`)]}); } catch {}
      }
    }
  }

  // ── BLACKTEA word listener ──
  const btGame = activeBlacktea.get(msg.guild?.id);
  if (btGame && btGame.phase==='answering' && btGame.players.has(msg.author.id) && msg.channel.id===btGame.channelId) {
    const word = msg.content.trim().toUpperCase();
    if (!btGame.usedWords.has(word) && word.startsWith(btGame.letters) && !btGame.answers.has(msg.author.id)) {
      btGame.answers.set(msg.author.id, { word, at: Date.now() });
      btGame.usedWords.add(word);
      try { await msg.react('✅'); } catch {}
    } else {
      try { await msg.react(btGame.answers.has(msg.author.id) ? '⚠️' : '❌'); } catch {}
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

  const NO_COIN_CHANNELS = ['1480831806226825308','1481371074309390346','1482076857321914378'];
  const uid = msg.author.id;
  if (!NO_COIN_CHANNELS.includes(msg.channel.id)) {
    if (!cache.users) { try { await dbRead('users'); } catch {} }
    if (cache.users) {
      if (!cache.users[uid]) cache.users[uid] = { id:uid, username:msg.author.username, coins:0, totalEarned:0, lastDaily:null, inventory:[], redeemedCodes:[] };
      cache.users[uid].coins       = (cache.users[uid].coins       || 0) + 1;
      cache.users[uid].totalEarned = (cache.users[uid].totalEarned || 0) + 1;
      cache.users[uid].username    = msg.author.username;
      scheduleCoinFlush();
    } else {
      getUser(uid, msg.author.username).then(u => { u.coins++; u.totalEarned=(u.totalEarned||0)+1; saveUser(u).catch(()=>{}); }).catch(()=>{});
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
  return reply({ embeds:[new EmbedBuilder().setTitle('🏪 Rewards Shop').setColor(0x9B59B6).addFields({name:'💎 Robux',value:robuxLines,inline:false},{name:'🎮 ETFB',value:etfbLines,inline:false},{name:`<:Nitro:1482656844655624192> Nitro`,value:nitroLines,inline:false}).setFooter({text:'Buy: /redeem  |  Then: /claim <id>'})] });
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

// --- START: MODIFIED ADMIN HELP COMMAND ---
async function cmdAdminHelp(reply) {
  return reply({ embeds:[new EmbedBuilder().setTitle('🔒 Admin Commands').setColor(0xFF6B35).addFields(
    {name:'📦 Stock Management',value:'`/update-robux` `/update-etfb`\n`/update-sab` `/remove-stock-sab`',inline:false},
    {name:'👥 User & Coin Management',value:'`/give` `/take`\n`/check-inventory` `/remove-inv`\n`/check-user` `/find-user`',inline:false},
    {name:'🎟️ Codes & Drops',value:'`/make-code` `/drop-code`\n`/remove-code` `/list-codes`\n`/lootdrop` `/rain` `/giveaway`',inline:false},
    {name:'📋 Claims',value:'`/claims`\n`/claimed <id>`\n`/deny-claim <id> [reason]`',inline:false},
    {name:'🎮 Game Hosting',value:'`/gtn` `/game-night-start`\n`/chair-game` `/chair-next`\n`/mafia` `/mafia-start` `/mafia-next`\n`/pick-number` `/pick-number-round`\n`/greentea` `/greentea-round` `/greentea-next`\n`/blacktea` `/blacktea-round` `/blacktea-next`',inline:false},
    {name:'🛡️ Moderation',value:'`/timeout` `/untimeout` `/warn` `/unwarn` `/warns` `/kick` `/ban`',inline:false}
  )] });
}
// --- END: MODIFIED ADMIN HELP COMMAND ---

async function cmdRedeem(reply, userId, username, itemId) {
  const item=SHOP.find(i=>i.id===itemId);
  if (!item) return reply({ embeds:[errEmbed('Unknown item ID. Use `/shop` to see valid IDs.')] });
  const u=await getUser(userId,username);
  const banks=await dbRead('banks'); const uBank=banks[userId];
  if (uBank&&uBank.balance>0) return reply({ embeds:[errEmbed(`You have **${uBank.balance}** ${COIN_EMOJI} in your bank! Withdraw first before buying.`)] });
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
  u.coins-=item.cost;
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

    // Greentea join
    if (cid.startsWith('gt_join_')) {
      const gwId = cid.replace('gt_join_','');
      const game = [...activeGreentea.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('This lobby has expired.')],flags:MessageFlags.Ephemeral});
      if (game.phase!=='joining') return interaction.reply({embeds:[errEmbed('Game already started!')],flags:MessageFlags.Ephemeral});
      game.players.add(interaction.user.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You joined Greentea! **${game.players.size}** player(s) in lobby.`)],flags:MessageFlags.Ephemeral});
    }

    // Blacktea join
    if (cid.startsWith('bt_join_')) {
      const gwId = cid.replace('bt_join_','');
      const game = [...activeBlacktea.values()].find(g=>g.gwId===gwId);
      if (!game) return interaction.reply({embeds:[errEmbed('This lobby has expired.')],flags:MessageFlags.Ephemeral});
      if (game.phase!=='joining') return interaction.reply({embeds:[errEmbed('Game already started!')],flags:MessageFlags.Ephemeral});
      game.players.add(interaction.user.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription(`✅ You joined Blacktea! **${game.players.size}** player(s) in lobby.`)],flags:MessageFlags.Ephemeral});
    }
  }

  // ── SAB STOCK VIEW BUTTON ──
  if (interaction.isButton() && interaction.customId === 'sab_view') {
    const sab = await dbRead('sab');
    const items = Array.isArray(sab) ? sab.filter(i => i && i.item) : [];
    if (!items.length) return interaction.reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('🛍️ SAB Stock').setDescription('No SAB items in stock right now.')],flags:MessageFlags.Ephemeral});
    const lines = items.map(i => `**${i.item}**${i.worth ? ` | 💵 ${i.worth}` : ''} | ${i.price.toLocaleString()} ${COIN_EMOJI}`).join('\n');
    return interaction.reply({embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle('🛍️ SAB Stock').setDescription(lines).setFooter({text:'💵 = Making Money rate · Buy via /redeem-sab <item name>'})],flags:MessageFlags.Ephemeral});
  }

  // ── CHECK-USER PAGINATION ──
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

  // --- START: MODIFIED BLACKJACK BUTTON HANDLER ---
  if (interaction.isButton() && (interaction.customId === 'bj_hit' || interaction.customId === 'bj_stand')) {
    try {
        const game = activeBlackjack.get(interaction.user.id);
        if (!game) return interaction.reply({ embeds: [errEmbed('No active game found. Start one with `/blackjack`.')], flags: MessageFlags.Ephemeral });
        if (game.userId !== interaction.user.id) return interaction.reply({ embeds: [errEmbed("This isn't your game!")], flags: MessageFlags.Ephemeral });

        await interaction.deferUpdate();

        const { drawCard, cardVal, bet } = game;

        function fmtC(c) { return `${c.val}${c.suit}`; }
        function total(hand) { let t = hand.reduce((s, c) => s + cardVal(c), 0), a = hand.filter(c => c.val === 'A').length; while (t > 21 && a > 0) { t -= 10; a--; } return t; }

        function bjButtons(disabled = false) {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bj_hit').setLabel('👊 Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
                new ButtonBuilder().setCustomId('bj_stand').setLabel('✋ Stand').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
            );
        }
        
        async function resolveGame(outcome) {
            activeBlackjack.delete(interaction.user.id);
            const u = await getUser(interaction.user.id, interaction.user.username);
            let resultText = '';
            let winAmount = 0;

            if (outcome === 'win') {
                u.coins += bet; u.totalEarned = (u.totalEarned || 0) + bet;
                resultText = `🎉 You Win!`; winAmount = bet;
            } else if (outcome === 'lose') {
                u.coins = Math.max(0, u.coins - bet);
                resultText = '🏦 Dealer Wins'; winAmount = -bet;
            } else if (outcome === 'bust') {
                u.coins = Math.max(0, u.coins - bet);
                resultText = '💥 Bust!'; winAmount = -bet;
            } else { // push
                resultText = '🤝 Push'; winAmount = 0;
            }
            await saveUser(u);

            const color = outcome === 'win' ? 0x57F287 : outcome === 'push' ? 0xFEE75C : 0xED4245;
            const title = `🃏 Blackjack — ${outcome === 'win' ? 'You Win! 🎉' : outcome === 'push' ? 'Push!' : 'You Lose!'}`;

            const embed = new EmbedBuilder().setColor(color).setTitle(title)
                .addFields(
                    { name: `🏦 Dealer (${total(game.dealer)})`, value: game.dealer.map(fmtC).join(' '), inline: false },
                    { name: `🧑 Your Hand (${total(game.player)})`, value: game.player.map(fmtC).join(' '), inline: false },
                    { name: 'Bet', value: `**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline: true },
                    { name: resultText, value: `${winAmount >= 0 ? 'Won' : 'Lost'} **${Math.abs(winAmount).toLocaleString()}** ${COIN_EMOJI}`, inline: true },
                    { name: 'Balance', value: `**${u.coins.toLocaleString()}** ${COIN_EMOJI}`, inline: true }
                );
            await interaction.editReply({ embeds: [embed], components: [bjButtons(true)] });
        }

        if (interaction.customId === 'bj_hit') {
            game.player.push(drawCard());
            const playerTotal = total(game.player);

            if (playerTotal > 21) {
                return resolveGame('bust');
            }
            
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🃏 Blackjack')
                .addFields(
                    { name: `🏦 Dealer (${cardVal(game.dealer[0])})`, value: `${fmtC(game.dealer[0])} 🂠`, inline: false },
                    { name: `🧑 Your Hand (${playerTotal})`, value: game.player.map(fmtC).join(' '), inline: false },
                    { name: 'Bet', value: `**${bet.toLocaleString()}** ${COIN_EMOJI}`, inline: true }
                );
            return interaction.editReply({ embeds: [embed], components: [bjButtons()] });
        }

        if (interaction.customId === 'bj_stand') {
            while (total(game.dealer) < 17) game.dealer.push(drawCard());
            
            const playerTotal = total(game.player);
            const dealerTotal = total(game.dealer);

            if (dealerTotal > 21 || playerTotal > dealerTotal) {
                return resolveGame('win');
            } else if (playerTotal < dealerTotal) {
                return resolveGame('lose');
            } else {
                return resolveGame('push');
            }
        }
    } catch (e) {
        console.error('Blackjack interaction error:', e);
        try { await interaction.followUp({ embeds: [errEmbed('An error occurred during the game.')], flags: MessageFlags.Ephemeral }); } catch {}
    }
    return;
  }
  // --- END: MODIFIED BLACKJACK BUTTON HANDLER ---


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
      const testerOnly = ['give','take','rain','update-robux','update-etfb','claims','claimed','deny-claim','remove-inv','check-inventory','make-code','drop-code','remove-code','list-codes','gtn','timeout','untimeout','warn','unwarn','warns','kick','ban','lootdrop','check-user','find-user','game-night-start','update-sab','remove-stock-sab','giveaway','chair-game','mafia','pick-number','greentea','blacktea'];
      if (!testerOnly.includes(cmd)) {} // non-admin cmds always allowed
    }

  try {
    if (cmd==='balance')     return await cmdBalance(reply, interaction.options.getUser('user')||me);
    if (cmd==='daily')       return await cmdDaily(reply, me.id, me.username);
    if (cmd==='shop')        return await cmdShop(reply);
    if (cmd==='inventory')   return await cmdInventory(reply, me.id, me.username);
    if (cmd==='leaderboard') return await cmdLeaderboard(reply, interaction.guild);
    if (cmd==='help')        return await cmdHelp(reply);
    if (cmd==='adminhelp')   return await cmdAdminHelp(reply);
    if (cmd==='use-code')    return await cmdUseCode(reply, me.id, me.username, interaction.options.getString('code'));
    if (cmd==='rain') { await interaction.deferReply(); return await cmdRain(interaction, interaction.guild, me.id, me.username, interaction.options.getInteger('amount')); }
    if (cmd==='redeem') { await interaction.deferReply(); return await cmdRedeem(p=>interaction.editReply(p), me.id, me.username, interaction.options.getString('item')); }

    if (cmd==='claim') {
      const idArg=interaction.options.getString('id').toUpperCase();
      const u=await getUser(me.id,me.username), item=(u.inventory||[]).find(i=>i.claimId===idArg);
      if (!item) return reply({embeds:[errEmbed(`No item \`${idArg}\` in your inventory.`)],flags:MessageFlags.Ephemeral});

      // Nitro: no modal needed — auto-submit immediately
      if (item.category==='Nitro') {
        await interaction.deferReply({flags:MessageFlags.Ephemeral});
        u.inventory.splice(u.inventory.findIndex(i=>i.claimId===idArg),1);
        await saveUser(u);
        const claimsArr=await getClaims();
        const arr=Array.isArray(claimsArr)?claimsArr:[];
        arr.push({claimId:idArg,userId:me.id,username:me.username,itemId:'nitro',itemName:'Nitro Method',category:'Nitro',robuxAmt:0,robloxUsername:'N/A',gamepassLink:null,claimedAt:Date.now(),status:'pending'});
        await saveClaims(arr);
        sendLog(client,{title:'📋 Claim Submitted',color:0x5865F2,fields:[{name:'User',value:`<@${me.id}>`,inline:true},{name:'Claim ID',value:`\`${idArg}\``,inline:true},{name:'Item',value:'Nitro Method',inline:true}]});
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('📬 Claim Submitted!').setDescription(`Your claim for **Nitro Method** has been submitted!\n\n**Claim ID:** \`${idArg}\`\n\nAn admin will reach out to you shortly!`)]});
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
    if (cmd==='server-shop') {
      const banks = await dbRead('banks');
      const userBank = banks[me.id] || null;
      const currentTier = userBank ? BANK_TIERS.findIndex(t=>t.id===userBank.tierId) : -1;
      const NITRO_EMOJI = '<:Nitro:1482656844655624192>';
      const lines = BANK_TIERS.map((t,i) => {
        if (i === 0 && !userBank) return `🏦 **${t.name}** — \`${t.cost.toLocaleString()}\` ${COIN_EMOJI} · Capacity: **${t.capacity}** coins ← Buy with \`/buy-bank\``;
        if (i === currentTier+1 && userBank) return `⬆️ **${t.name}** — \`${t.cost.toLocaleString()}\` ${COIN_EMOJI} · Capacity: **${t.capacity}** coins ← Upgrade with \`/upgrade-bank\``;
        if (i <= currentTier) return `✅ **${t.name}** — Capacity: **${t.capacity}** coins (owned)`;
        return `🔒 **${t.name}** — \`${t.cost.toLocaleString()}\` ${COIN_EMOJI} · Capacity: **${t.capacity}** coins`;
      }).join('\n');
      const statusLine = userBank ? `Your bank: **${userBank.tierId ? BANK_TIERS.find(t=>t.id===userBank.tierId)?.name : 'Basic Bank'}** · Balance: **${userBank.balance}/${userBank.capacity}** ${COIN_EMOJI}` : 'You don\'t have a bank yet!';
      return reply({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🏪 Server Shop — Bank').setDescription(`${statusLine}\n\n${lines}`).setFooter({text:'Buy: /buy-bank | Upgrade: /upgrade-bank | Deposit: /deposit | Withdraw: /withdraw'})]});
    }

    if (cmd==='buy-bank') {
      const banks = await dbRead('banks');
      if (banks[me.id]) return reply({embeds:[errEmbed('You already have a bank! Use `/upgrade-bank` to upgrade.')],flags:MessageFlags.Ephemeral});
      const tier = BANK_TIERS[0];
      const u = await getUser(me.id, me.username);
      if (u.coins < tier.cost) return reply({embeds:[errEmbed(`You need **${tier.cost.toLocaleString()}** ${COIN_EMOJI} to buy a bank!`)],flags:MessageFlags.Ephemeral});
      u.coins -= tier.cost;
      await saveUser(u);
      banks[me.id] = { tierId: tier.id, capacity: tier.capacity, balance: 0, boughtAt: Date.now() };
      await dbWrite('banks', banks);
      sendLog(client,{title:'🏦 Bank Purchased',color:0xF1C40F,fields:[{name:'User',value:`<@${me.id}>`,inline:true},{name:'Tier',value:tier.name,inline:true},{name:'Cost',value:`${tier.cost} ${COIN_EMOJI}`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🏦 Bank Purchased!').setDescription(`You now have a **${tier.name}**!\n\nCapacity: **${tier.capacity}** ${COIN_EMOJI}\nBalance: **0** ${COIN_EMOJI}\n\nDeposit with \`/deposit <amount>\``)]});
    }

    if (cmd==='upgrade-bank') {
      const banks = await dbRead('banks');
      if (!banks[me.id]) return reply({embeds:[errEmbed('You don\'t have a bank yet! Use `/buy-bank` first.')],flags:MessageFlags.Ephemeral});
      const currentIdx = BANK_TIERS.findIndex(t=>t.id===banks[me.id].tierId);
      if (currentIdx === BANK_TIERS.length-1) return reply({embeds:[errEmbed('Your bank is already at max tier!')],flags:MessageFlags.Ephemeral});
      const nextTier = BANK_TIERS[currentIdx+1];
      const u = await getUser(me.id, me.username);
      if (u.coins < nextTier.cost) return reply({embeds:[errEmbed(`You need **${nextTier.cost.toLocaleString()}** ${COIN_EMOJI} to upgrade!`)],flags:MessageFlags.Ephemeral});
      u.coins -= nextTier.cost;
      await saveUser(u);
      banks[me.id].tierId = nextTier.id;
      banks[me.id].capacity = nextTier.capacity;
      await dbWrite('banks', banks);
      sendLog(client,{title:'🏦 Bank Upgraded',color:0xF1C40F,fields:[{name:'User',value:`<@${me.id}>`,inline:true},{name:'New Tier',value:nextTier.name,inline:true},{name:'New Capacity',value:`${nextTier.capacity} ${COIN_EMOJI}`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🏦 Bank Upgraded!').setDescription(`Your bank is now **${nextTier.name}**!\n\nNew Capacity: **${nextTier.capacity}** ${COIN_EMOJI}\nCurrent Balance: **${banks[me.id].balance}** ${COIN_EMOJI}`)]});
    }

    if (cmd==='deposit') {
      const banks = await dbRead('banks');
      if (!banks[me.id]) return reply({embeds:[errEmbed('You don\'t have a bank! Buy one with `/buy-bank`.')],flags:MessageFlags.Ephemeral});
      const bank = banks[me.id];
      const u = await getUser(me.id, me.username);
      if (u.coins <= 0) return reply({embeds:[errEmbed('You have no coins to deposit!')],flags:MessageFlags.Ephemeral});
      const space = bank.capacity - bank.balance;
      if (space <= 0) return reply({embeds:[errEmbed(`Your bank is full! (${bank.balance}/${bank.capacity})`)],flags:MessageFlags.Ephemeral});
      const reqAmt = interaction.options.getInteger('amount');
      const amount = reqAmt === 0 ? Math.min(u.coins, space) : Math.min(reqAmt, u.coins, space);
      if (amount <= 0) return reply({embeds:[errEmbed('Invalid amount.')],flags:MessageFlags.Ephemeral});
      u.coins -= amount;
      bank.balance += amount;
      await saveUser(u);
      await dbWrite('banks', banks);
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🏦 Deposited!').addFields({name:'Deposited',value:`**${amount.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Bank Balance',value:`**${bank.balance}/${bank.capacity}** ${COIN_EMOJI}`,inline:true},{name:'Wallet',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true})]});
    }

    if (cmd==='withdraw') {
      const banks = await dbRead('banks');
      if (!banks[me.id]) return reply({embeds:[errEmbed('You don\'t have a bank!')],flags:MessageFlags.Ephemeral});
      const bank = banks[me.id];
      if (bank.balance <= 0) return reply({embeds:[errEmbed('Your bank is empty!')],flags:MessageFlags.Ephemeral});
      const reqAmt = interaction.options.getInteger('amount');
      const amount = reqAmt === 0 ? bank.balance : Math.min(reqAmt, bank.balance);
      if (amount <= 0) return reply({embeds:[errEmbed('Invalid amount.')],flags:MessageFlags.Ephemeral});
      const u = await getUser(me.id, me.username);
      bank.balance -= amount;
      u.coins += amount;
      await saveUser(u);
      await dbWrite('banks', banks);
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🏦 Withdrawn!').addFields({name:'Withdrawn',value:`**${amount.toLocaleString()}** ${COIN_EMOJI}`,inline:true},{name:'Bank Balance',value:`**${bank.balance}/${bank.capacity}** ${COIN_EMOJI}`,inline:true},{name:'Wallet',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true})]});
    }

    if (cmd==='bank') {
      const banks = await dbRead('banks');
      if (!banks[me.id]) return reply({embeds:[new EmbedBuilder().setColor(0xFEE75C).setTitle('🏦 No Bank').setDescription('You don\'t have a bank yet!\n\nBuy one from `/server-shop` with `/buy-bank`.')]});
      const bank = banks[me.id];
      const tier = BANK_TIERS.find(t=>t.id===bank.tierId)||BANK_TIERS[0];
      return reply({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🏦 Your Bank').addFields({name:'Tier',value:tier.name,inline:true},{name:'Balance',value:`**${bank.balance.toLocaleString()}/${bank.capacity}** ${COIN_EMOJI}`,inline:true},{name:'Wallet',value:`**${((await getUser(me.id,me.username)).coins).toLocaleString()}** ${COIN_EMOJI}`,inline:true})]});
    }

    if (cmd==='rob') {
      const target = interaction.options.getUser('user');
      if (target.id===me.id) return reply({embeds:[errEmbed('You can\'t rob yourself!')],flags:MessageFlags.Ephemeral});
      if (target.bot) return reply({embeds:[errEmbed('You can\'t rob a bot!')],flags:MessageFlags.Ephemeral});
      // Can't rob admins
      const targetMember = await interaction.guild.members.fetch(target.id).catch(()=>null);
      if (targetMember?.permissions.has(PermissionFlagsBits.Administrator)) return reply({embeds:[errEmbed('You can\'t rob an admin!')],flags:MessageFlags.Ephemeral});
      // Check if target has a bank
      const banks = await dbRead('banks');
      if (banks[target.id]) return reply({embeds:[errEmbed(`<@${target.id}> has a bank — you can't rob them!`)],flags:MessageFlags.Ephemeral});
      const victim = await getUser(target.id, target.username);
      if (victim.coins <= 0) return reply({embeds:[errEmbed(`<@${target.id}> has no coins to steal!`)],flags:MessageFlags.Ephemeral});
      // 60% success chance
      const success = Math.random() < 0.60;
      if (!success) {
        sendLog(client,{title:'🔫 Rob Failed',color:0xED4245,fields:[{name:'Robber',value:`<@${me.id}>`,inline:true},{name:'Target',value:`<@${target.id}>`,inline:true},{name:'Result',value:'Failed — caught!',inline:true}]});
        return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🚔 Caught!').setDescription(`You tried to rob <@${target.id}> but got caught! Better luck next time.`)]});
      }
      const stolen = Math.floor(victim.coins * 0.20);
      if (stolen < 1) return reply({embeds:[errEmbed(`<@${target.id}> doesn't have enough coins to steal!`)],flags:MessageFlags.Ephemeral});
      victim.coins -= stolen;
      await saveUser(victim);
      const robber = await getUser(me.id, me.username);
      robber.coins += stolen;
      await saveUser(robber);
      sendLog(client,{title:'🔫 Rob Successful',color:0xF1C40F,fields:[{name:'Robber',value:`<@${me.id}>`,inline:true},{name:'Target',value:`<@${target.id}>`,inline:true},{name:'Stolen',value:`${stolen.toLocaleString()} ${COIN_EMOJI}`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('💰 Successful Rob!').setDescription(`You stole **${stolen.toLocaleString()}** ${COIN_EMOJI} from <@${target.id}>! (20% of their wallet)`).addFields({name:'Your Wallet',value:`**${robber.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true})]});
    }


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
    //  GREENTEA (3 chances per person, 3 rounds)
    // ══════════════════════════════════════════
    if (cmd==='greentea') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      if (activeGreentea.has(interaction.guildId)) return reply({embeds:[errEmbed('A Greentea game is already running!')],flags:MessageFlags.Ephemeral});
      const letters = LETTER_POOLS[Math.floor(Math.random()*LETTER_POOLS.length)];
      const prize   = interaction.options.getInteger('prize');
      const gwId    = `GT${Date.now()}`;
      const joinMsg = await interaction.channel.send({
        embeds:[new EmbedBuilder().setColor(0x2ECC71).setTitle('🍵 Greentea — Join!').setDescription(`Click **Join** to enter Greentea!\n\n📝 Name something starting with **"${letters}"**\nYou get **3 chances** per round.\nIf you can't name one — you're eliminated!`).setFooter({text:`Prize: ${prize.toLocaleString()} coins for winner`})],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gt_join_${gwId}`).setLabel('🍵 Join').setStyle(ButtonStyle.Primary))]
      });
      activeGreentea.set(interaction.guildId, { gwId, letters, prize, players: new Set(), phase: 'joining', hostId: me.id, channelId: interaction.channelId, round: 0, answers: new Map(), chances: new Map(), usedWords: new Set() });
      sendLog(client,{title:'🍵 Greentea Started',color:0x2ECC71,fields:[{name:'Host',value:`<@${me.id}>`,inline:true},{name:'Letters',value:letters,inline:true},{name:'Prize',value:`${prize} coins`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ Greentea lobby posted! Use `/greentea-round` to start.')],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='greentea-round') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeGreentea.get(interaction.guildId);
      if (!game) return reply({embeds:[errEmbed('No Greentea game running!')],flags:MessageFlags.Ephemeral});
      if (game.players.size < 2) return reply({embeds:[errEmbed('Need at least 2 players!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      game.round++; game.answers = new Map(); game.chances = new Map();
      game.players.forEach(p => game.chances.set(p, 3));
      game.phase = 'answering';
      const ch = await client.channels.fetch(game.channelId);
      await ch.send({embeds:[new EmbedBuilder().setColor(0x2ECC71).setTitle(`🍵 Greentea — Round ${game.round}`).setDescription(`Name something starting with **"${game.letters}"**!\n\nType your answer in this channel.\nYou have **3 chances** — repeated or invalid words don't count!\n\nPlayers: ${[...game.players].map(p=>`<@${p}>`).join(' ')}`).setFooter({text:'Host: /greentea-next to end round and eliminate those who failed'})]});
      return interaction.editReply({embeds:[okEmbed(`Round ${game.round} started!`)]});
    }
    if (cmd==='greentea-next') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeGreentea.get(interaction.guildId);
      if (!game || game.phase!=='answering') return reply({embeds:[errEmbed('No active Greentea round!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const ch = await client.channels.fetch(game.channelId);
      // Eliminate players who used all chances without a valid answer
      const eliminated = new Set();
      game.players.forEach(p => { if (!game.answers.has(p)) eliminated.add(p); });
      eliminated.forEach(p => game.players.delete(p));
      game.phase = 'waiting';
      if (game.players.size <= 1) {
        const winner = game.players.size===1?[...game.players][0]:null;
        activeGreentea.delete(interaction.guildId);
        if (winner) { const u=await getUser(winner,'unknown'); u.coins+=game.prize; u.totalEarned=(u.totalEarned||0)+game.prize; await saveUser(u); }
        sendLog(client,{title:'🍵 Greentea Winner',color:0x2ECC71,fields:[{name:'Winner',value:winner?`<@${winner}>`:'No winner',inline:true},{name:'Prize',value:`${game.prize} coins`,inline:true}]});
        await ch.send({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🍵 Greentea — Game Over!').setDescription(winner?`🏆 <@${winner}> wins **${game.prize}** ${COIN_EMOJI}!`:'Everyone was eliminated!')]});
      } else {
        const elimStr = eliminated.size?[...eliminated].map(p=>`<@${p}>`).join(' '):'Nobody';
        await ch.send({embeds:[new EmbedBuilder().setColor(0x2ECC71).setTitle(`🍵 Round ${game.round} Results`).setDescription(`**Eliminated:** ${elimStr}\n**Still in:** ${[...game.players].map(p=>`<@${p}>`).join(' ')}\n\nHost: \`/greentea-round\` for next round!`)]});
      }
      return interaction.editReply({embeds:[okEmbed('Round ended!')]});
    }

    // ══════════════════════════════════════════
    //  BLACKTEA (5 rounds, points system)
    // ══════════════════════════════════════════
    if (cmd==='blacktea') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      if (activeBlacktea.has(interaction.guildId)) return reply({embeds:[errEmbed('A Blacktea game is already running!')],flags:MessageFlags.Ephemeral});
      const letters = LETTER_POOLS[Math.floor(Math.random()*LETTER_POOLS.length)];
      const prize   = interaction.options.getInteger('prize');
      const gwId    = `BT${Date.now()}`;
      const joinMsg = await interaction.channel.send({
        embeds:[new EmbedBuilder().setColor(0x1A1A2E).setTitle('🖤 Blacktea — Join!').setDescription(`Click **Join** to enter Blacktea!\n\n📝 **Everyone** must name something starting with **"${letters}"**\n🏆 1st = 3pts | 2nd = 2pts | 3rd = 1pt\n5 rounds — most points wins the prize!`).setFooter({text:`Prize: ${prize.toLocaleString()} coins for winner`})],
        components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bt_join_${gwId}`).setLabel('🖤 Join').setStyle(ButtonStyle.Primary))]
      });
      activeBlacktea.set(interaction.guildId, { gwId, letters, prize, players: new Set(), phase: 'joining', hostId: me.id, channelId: interaction.channelId, round: 0, maxRounds: 5, answers: new Map(), points: new Map(), usedWords: new Set() });
      sendLog(client,{title:'🖤 Blacktea Started',color:0x1A1A2E,fields:[{name:'Host',value:`<@${me.id}>`,inline:true},{name:'Letters',value:letters,inline:true},{name:'Prize',value:`${prize} coins`,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0x57F287).setDescription('✅ Blacktea lobby posted! Use `/blacktea-round` to start.')],flags:MessageFlags.Ephemeral});
    }
    if (cmd==='blacktea-round') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeBlacktea.get(interaction.guildId);
      if (!game) return reply({embeds:[errEmbed('No Blacktea game running!')],flags:MessageFlags.Ephemeral});
      if (game.players.size < 2) return reply({embeds:[errEmbed('Need at least 2 players!')],flags:MessageFlags.Ephemeral});
      if (game.round >= game.maxRounds) return reply({embeds:[errEmbed('All 5 rounds done! Use `/blacktea-end`.')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      game.round++; game.answers = new Map(); game.phase = 'answering';
      game.players.forEach(p => { if (!game.points.has(p)) game.points.set(p,0); });
      const ch = await client.channels.fetch(game.channelId);
      await ch.send({embeds:[new EmbedBuilder().setColor(0x1A1A2E).setTitle(`🖤 Blacktea — Round ${game.round}/5`).setDescription(`Name something starting with **"${game.letters}"**!\n\nEveryone must answer — type in this channel!\n🥇 1st = 3pts | 🥈 2nd = 2pts | 🥉 3rd = 1pt\n\nPlayers: ${[...game.players].map(p=>`<@${p}>`).join(' ')}`).setFooter({text:'Host: /blacktea-next to score this round'})]});
      return interaction.editReply({embeds:[okEmbed(`Round ${game.round} started!`)]});
    }
    if (cmd==='blacktea-next') {
      if (!canRunAdmin(interaction)) return reply({embeds:[errEmbed('No permission!')],flags:MessageFlags.Ephemeral});
      const game = activeBlacktea.get(interaction.guildId);
      if (!game || game.phase!=='answering') return reply({embeds:[errEmbed('No active Blacktea round!')],flags:MessageFlags.Ephemeral});
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const ch = await client.channels.fetch(game.channelId);
      game.phase = 'waiting';
      // Award points: order answers were submitted
      const ordered = [...game.answers.entries()].sort((a,b)=>a[1].at-b[1].at);
      const pts = [3,2,1];
      const roundResults = [];
      ordered.slice(0,3).forEach(([pid,ans],i) => {
        const cur = game.points.get(pid)||0;
        game.points.set(pid, cur+pts[i]);
        roundResults.push(`${['🥇','🥈','🥉'][i]} <@${pid}> — "${ans.word}" (+${pts[i]}pts)`);
      });
      // No answer = 0 pts (already handled)
      const scoreBoard = [...game.points.entries()].sort((a,b)=>b[1]-a[1]).map(([pid,pts],i)=>`**${i+1}.** <@${pid}> — ${pts}pts`).join('\n');
      if (game.round >= game.maxRounds) {
        // Final round — end game
        const winner = [...game.points.entries()].sort((a,b)=>b[1]-a[1])[0];
        activeBlacktea.delete(interaction.guildId);
        if (winner) { const u=await getUser(winner[0],'unknown'); u.coins+=game.prize; u.totalEarned=(u.totalEarned||0)+game.prize; await saveUser(u); }
        sendLog(client,{title:'🖤 Blacktea Winner',color:0x1A1A2E,fields:[{name:'Winner',value:winner?`<@${winner[0]}>`: 'No winner',inline:true},{name:'Prize',value:`${game.prize} coins`,inline:true}]});
        await ch.send({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🖤 Blacktea — Game Over!').setDescription(`**Round ${game.round} Results:**\n${roundResults.join('\n')||'Nobody answered!'}\n\n**Final Scoreboard:**\n${scoreBoard}\n\n🏆 ${winner?`<@${winner[0]}> wins **${game.prize}** ${COIN_EMOJI}!`:'No winner!'}`)]});
      } else {
        await ch.send({embeds:[new EmbedBuilder().setColor(0x1A1A2E).setTitle(`🖤 Round ${game.round}/5 Results`).setDescription(`**Answers:**\n${roundResults.join('\n')||'Nobody answered!'}\n\n**Scoreboard:**\n${scoreBoard}\n\nHost: \`/blacktea-round\` for round ${game.round+1}!`)]});
      }
      return interaction.editReply({embeds:[okEmbed(`Round ${game.round} scored!`)]});
    }


    if (cmd==='redeem-sab') {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const itemName = interaction.options.getString('item').trim().toLowerCase();
      const sab = await dbRead('sab');
      const arr = Array.isArray(sab) ? sab.filter(i => i && i.item) : [];
      const idx = arr.findIndex(i => i.item.toLowerCase() === itemName);
      if (idx === -1) return interaction.editReply({embeds:[errEmbed(`**${interaction.options.getString('item')}** not found in SAB stock. Use the 🛒 button on the stock embed to see available items.`)]});
      const sabItem = arr[idx];
      const u = await getUser(me.id, me.username);
      if (u.coins < sabItem.price) return interaction.editReply({embeds:[errEmbed(`You need **${sabItem.price.toLocaleString()}** ${COIN_EMOJI} but only have **${u.coins.toLocaleString()}** ${COIN_EMOJI}!`)]});
      // Deduct coins
      u.coins -= sabItem.price;
      await saveUser(u);
      // If single stock, remove from SAB after purchase
      if (sabItem.stock === 'S') {
        arr.splice(idx, 1);
        await dbWrite('sab', arr);
      }
      sendLog(client,{title:'🛍️ SAB Item Purchased',color:0x9B59B6,fields:[{name:'User',value:`<@${me.id}>`,inline:true},{name:'Item',value:sabItem.item,inline:true},{name:'Price',value:`${sabItem.price.toLocaleString()} ${COIN_EMOJI}`,inline:true},{name:'Stock Type',value:sabItem.stock==='S'?'Single (removed from stock)':'Multiple',inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true}]});
      // Alert admins
      try {
        const alertCh = await client.channels.fetch(ALERT_CHANNEL_ID);
        if (alertCh) await alertCh.send({embeds:[new EmbedBuilder().setColor(0x9B59B6).setTitle('🛍️ SAB Purchase').setDescription(`<@${me.id}> purchased **${sabItem.item}** for **${sabItem.price.toLocaleString()}** ${COIN_EMOJI}.\n\nPlease deliver their item!`)]});
      } catch {}
      return interaction.editReply({embeds:[new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🛍️ SAB Purchase Successful!')
        .setDescription(`You bought **${sabItem.item}** for **${sabItem.price.toLocaleString()}** ${COIN_EMOJI}!\n\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}\n\nAn admin will deliver your item shortly! Check <#${ALERT_CHANNEL_ID}> for updates.`)
        .setFooter({text:sabItem.stock==='S'?'This was the last one — now out of stock!':'More stock available'})]});
    }


    if (cmd==='remove-stock-sab') {
      const item = interaction.options.getString('item').trim();
      const sab  = await dbRead('sab');
      const arr  = Array.isArray(sab) ? sab.filter(i => i && i.item) : [];
      const idx  = arr.findIndex(i => i.item.toLowerCase() === item.toLowerCase());
      if (idx === -1) return reply({embeds:[errEmbed(`**${item}** not found in SAB stock.`)]});
      arr.splice(idx, 1);
      await dbWrite('sab', arr);
      sendLog(client,{title:'🛍️ SAB Item Removed',color:0xED4245,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Item',value:item,inline:true}]});
      return reply({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🗑️ SAB Item Removed').setDescription(`**${item}** removed from SAB stock.`)]});
    }

    if (cmd==='giveaway') {
      const durationMins = interaction.options.getInteger('duration');
      const prize        = interaction.options.getString('prize');
      const numWinners   = interaction.options.getInteger('winners') || 1;
      const coins        = interaction.options.getInteger('coins');
      const endsAt       = Date.now() + durationMins * 60 * 1000;
      const gwId         = `GW${Date.now()}`;
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      let gwMsg = null;
      try {
        gwMsg = await interaction.channel.send({
          embeds:[new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🎉 GIVEAWAY!')
            .setDescription(`**Prize:** ${prize}\n**Coins:** ${coins.toLocaleString()} ${COIN_EMOJI} per winner\n**Winners:** ${numWinners}\n**Host:** <@${me.id}>\n\nReact with 🎉 to enter!\n\n⏰ Ends ${ts(endsAt)} (${ts(endsAt,'T')} your time)`)
            .setFooter({text:`ID: ${gwId}`})
            .setTimestamp(endsAt)]
        });
        await gwMsg.react('🎉');
      } catch(e){ console.error('Giveaway send error:',e.message); }
      if (!gwMsg) return interaction.editReply({embeds:[errEmbed('Failed to post giveaway!')]});
      const gwData = { channelId: interaction.channelId, messageId: gwMsg.id, prize, coins, numWinners, hostId: me.id, endsAt, gwId };
      activeGiveaways.set(gwId, gwData);
      const gwTimeout = setTimeout(async () => {
        try {
          const gwState = activeGiveaways.get(gwId);
          if (!gwState) return;
          activeGiveaways.delete(gwId);
          const ch  = await client.channels.fetch(gwState.channelId);
          const msg = await ch.messages.fetch(gwState.messageId);
          const reaction = msg.reactions.cache.get('🎉');
          let entrants = [];
          if (reaction) { const users = await reaction.users.fetch(); entrants = [...users.values()].filter(u => !u.bot); }
          if (!entrants.length) {
            await msg.edit({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🎉 Giveaway Ended').setDescription(`No one entered!\n\n**Prize:** ${gwState.prize}`)]});
            return;
          }
          const shuffled = entrants.sort(() => Math.random() - 0.5);
          const winners  = shuffled.slice(0, Math.min(gwState.numWinners, entrants.length));
          for (const w of winners) {
            const u = await getUser(w.id, w.username);
            u.coins += gwState.coins; u.totalEarned = (u.totalEarned||0) + gwState.coins;
            await saveUser(u);
            try { await w.send({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🎉 You Won a Giveaway!').setDescription(`You won **${gwState.prize}** and received **${gwState.coins.toLocaleString()}** ${COIN_EMOJI}!`)]}); } catch {}
          }
          const winMentions = winners.map(w => `<@${w.id}>`).join(' ');
          await msg.edit({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎉 Giveaway Ended!').setDescription(`**Prize:** ${gwState.prize}\n**Coins:** ${gwState.coins.toLocaleString()} ${COIN_EMOJI} each\n\n🏆 **Winners:** ${winMentions}\n\nHosted by <@${gwState.hostId}>`).setTimestamp()]});
          await msg.reply({content:`🎉 Congratulations ${winMentions}! You won **${gwState.prize}**!`});
          sendLog(client,{title:'🎉 Giveaway Ended',color:0xF1C40F,fields:[{name:'Prize',value:gwState.prize,inline:true},{name:'Winners',value:winMentions,inline:true},{name:'Coins Each',value:`${gwState.coins.toLocaleString()} ${COIN_EMOJI}`,inline:true},{name:'Entrants',value:`${entrants.length}`,inline:true}]});
        } catch(e){ console.error('Giveaway end error:',e.message); }
      }, durationMins * 60 * 1000);
      gwData.timeout = gwTimeout;
      sendLog(client,{title:'🎉 Giveaway Started',color:0xF1C40F,fields:[{name:'Admin',value:`<@${me.id}>`,inline:true},{name:'Prize',value:prize,inline:true},{name:'Coins Each',value:`${coins.toLocaleString()} ${COIN_EMOJI}`,inline:true},{name:'Winners',value:`${numWinners}`,inline:true},{name:'Duration',value:`${durationMins} min`,inline:true}]});
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Giveaway Started!').setDescription(`Giveaway posted! Ends ${ts(endsAt)} (${ts(endsAt,'T')} your time)`)]});
    }


    // ══════════════════════════════════════════
    //  LOOT DROP
    // ══════════════════════════════════════════
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
      const bet = interaction.options.getInteger('bet');
      const u   = await getUser(me.id, me.username);
      if (u.coins < bet) return reply({embeds:[errEmbed(`You only have **${u.coins.toLocaleString()}** ${COIN_EMOJI}!`)],flags:MessageFlags.Ephemeral});
      if (activeBlackjack.has(me.id)) return reply({embeds:[errEmbed('You already have a game in progress!')],flags:MessageFlags.Ephemeral});

      const SUITS  = ['♠️','♥️','♦️','♣️'];
      const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
      function drawCard() { return {suit:SUITS[Math.floor(Math.random()*4)],val:VALUES[Math.floor(Math.random()*13)]}; }
      function cardVal(c) { return ['J','Q','K'].includes(c.val)?10:c.val==='A'?11:parseInt(c.val); }
      function handTotal(hand) {
        let total=hand.reduce((s,c)=>s+cardVal(c),0), aces=hand.filter(c=>c.val==='A').length;
        while(total>21&&aces>0){total-=10;aces--;}
        return total;
      }
      function fmtCard(c){return `${c.val}${c.suit}`;}
      function bjEmbed(game, status='playing') {
        const pt=handTotal(game.player), dt=handTotal(game.dealer);
        const dealerDisplay = status==='playing'
          ? `${fmtCard(game.dealer[0])} 🂠` // hide second card
          : game.dealer.map(fmtCard).join(' ');
        const dealerVal = status==='playing' ? cardVal(game.dealer[0]) : dt;
        const color = status==='win'?0x57F287:status==='push'?0xFEE75C:status==='playing'?0x5865F2:0xED4245;
        const title = status==='playing'?'🃏 Blackjack':status==='win'?'🃏 Blackjack — You Win! 🎉':status==='push'?'🃏 Blackjack — Push!':'🃏 Blackjack — You Lose!';
        return new EmbedBuilder().setColor(color).setTitle(title)
          .addFields(
            {name:`🏦 Dealer (${dealerVal})`, value:dealerDisplay, inline:false},
            {name:`🧑 Your Hand (${pt})`,     value:game.player.map(fmtCard).join(' '), inline:false},
            {name:'Bet', value:`**${game.bet.toLocaleString()}** ${COIN_EMOJI}`, inline:true}
          );
      }
      function bjButtons(disabled=false) {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('bj_hit').setLabel('👊 Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
          new ButtonBuilder().setCustomId('bj_stand').setLabel('✋ Stand').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
        );
      }

      const playerHand = [drawCard(), drawCard()];
      const dealerHand = [drawCard(), drawCard()];
      const game = { player: playerHand, dealer: dealerHand, bet, userId: me.id, drawCard, cardVal, handTotal, fmtCard };
      activeBlackjack.set(me.id, game);

      const pt = handTotal(playerHand);

      // Natural blackjack check
      if (pt === 21) {
        activeBlackjack.delete(me.id);
        const dt = handTotal(dealerHand);
        const push = dt === 21;
        if (!push) { u.coins += Math.floor(bet*1.5); u.totalEarned=(u.totalEarned||0)+Math.floor(bet*1.5); }
        await saveUser(u);
        const finalEmbed = bjEmbed(game, push?'push':'win');
        if (!push) finalEmbed.addFields({name:'🎉 Blackjack!',value:`Won **${Math.floor(bet*1.5).toLocaleString()}** ${COIN_EMOJI} (3:2 payout!)`,inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true});
        else finalEmbed.addFields({name:'Result',value:'Push — bet returned',inline:true},{name:'Balance',value:`**${u.coins.toLocaleString()}** ${COIN_EMOJI}`,inline:true});
        return reply({embeds:[finalEmbed], components:[bjButtons(true)]});
      }

      return reply({embeds:[bjEmbed(game,'playing')], components:[bjButtons()]});
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
```
