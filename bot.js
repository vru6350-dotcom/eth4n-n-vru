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

function canRunAdmin(interaction) {
  if (isTestServer(interaction.guildId)) return true;
  return interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
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

const PERMANENT_CODES = {
  'RELEASE': { coins: 25, description: '🎉 Launch reward' },
};

const pendingVouches = new Map();
const activeGTN = new Map();
const activeBlackjack = new Map();
const activeChairGame  = new Map(); 
const activeMafia      = new Map(); 
const activePickNumber = new Map(); 
const activeGreentea   = new Map(); 
const activeBlacktea   = new Map(); 
let activeLootDrop = null;
const activeGiveaways = new Map();

const BANK_TIERS = [
  { id: 'bank_basic',  name: 'Basic Bank',    cost: 500,  capacity: 500  },
  { id: 'bank_t2',     name: 'Bank Tier 2',   cost: 750,  capacity: 750  },
  { id: 'bank_t3',     name: 'Bank Tier 3',   cost: 1000, capacity: 1000 },
  { id: 'bank_t4',     name: 'Bank Tier 4',   cost: 1250, capacity: 1250 },
  { id: 'bank_t5',     name: 'Bank Tier 5',   cost: 1500, capacity: 1500 },
  { id: 'bank_t6',     name: 'Bank Tier 6',   cost: 2000, capacity: 2000 },
  { id: 'bank_t7',     name: 'Bank Tier 7',   cost: 2500, capacity: 2500 },
];

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

async function getCodes() {
  const saved = await dbRead('codes');
  let dirty = false;
  for (const [key, code] of Object.entries(saved)) {
    if (code.expiresAt && Date.now() > code.expiresAt) {
      delete saved[key];
      dirty = true;
    }
  }
  if (dirty) await dbWrite('codes', saved);
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
async function getClaims()   { cacheTime.claims = 0; return dbRead('claims'); }
async function saveClaims(c) { await dbWrite('claims', c); cacheTime.claims = 0; }
async function getWarns(uid) { const w = await dbRead('warns'); return w[uid] || []; }
async function saveWarns(uid, arr) { const w = await dbRead('warns'); w[uid] = arr; await dbWrite('warns', w); }
async function nextClaimId() {
  const meta = await getMeta();
  meta.claimCounter = (meta.claimCounter || 0) + 1;
  await saveMeta(meta);
  return `C${meta.claimCounter}`;
}

function ts(unixMs, style='R') { return `<t:${Math.floor(unixMs/1000)}:${style}>`; }
function errEmbed(text) { return new EmbedBuilder().setColor(0xED4245).setDescription(`❌ ${text}`); }
function okEmbed(text)  { return new EmbedBuilder().setColor(0x57F287).setDescription(`✅ ${text}`); }

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
  const CLIENT_ID = (process.env.CLIENT_ID || '').trim();
  if (!CLIENT_ID) {
    console.warn('⚠️  CLIENT_ID not set');
  } else {
    try {
      const { REST, Routes } = require('discord.js');
      const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: slashDefs });
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, TEST_GUILD_ID), { body: slashDefs });
      console.log(`✅ Slash commands registered to Main & Test Server`);
    } catch (e) { console.error('Registration failed:', e.message); }
  }
  try { await dbRead('users'); console.log('✅ Cache warmed'); } catch (e) { console.error('Cache warmup error:', e.message); }
  await updateStockEmbed(client);
  console.log('✅ Ready');
});

client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;

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
    }
  }

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

  if (msg.channel.id === GTN_CHANNEL_ID && activeGTN.has(GTN_CHANNEL_ID)) {
    const game = activeGTN.get(GTN_CHANNEL_ID);
    const guess = parseInt(msg.content.trim());
    if (!isNaN(guess) && game.active) {
      if (guess === game.answer) {
        game.active = false; activeGTN.delete(GTN_CHANNEL_ID);
        const winner = await getUser(msg.author.id, msg.author.username);
        winner.coins += game.prize; winner.totalEarned = (winner.totalEarned||0)+game.prize;
        await saveUser(winner);
        sendLog(client,{title:'🎮 GTN Winner!',color:0xF1C40F,fields:[{name:'Winner',value:`<@${msg.author.id}>`,inline:true},{name:'Answer',value:`**${game.answer}**`,inline:true},{name:'Prize',value:`**${game.prize}** ${COIN_EMOJI}`,inline:true}]});
        try { await msg.channel.send({ embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('🎉 We Have a Winner!').setDescription(`<@${msg.author.id}> guessed the number **${game.answer}** correctly! 🏆\n\n**Prize:** **${game.prize}** ${COIN_EMOJI}\n**New balance:** **${winner.coins.toLocaleString()}** ${COIN_EMOJI}`)] }); } catch {}
      } else if (guess >= game.min && guess <= game.max) { try { await msg.react('❌'); } catch {} }
    }
  }

  await handleSpamCheck(msg);

  const uid = msg.author.id;
  if (!cache.users) { try { await dbRead('users'); } catch {} }
  if (cache.users) {
    if (!cache.users[uid]) cache.users[uid] = { id:uid, username:msg.author.username, coins:0, totalEarned:0, lastDaily:null, inventory:[], redeemedCodes:[] };
    cache.users[uid].coins++; cache.users[uid].totalEarned++; scheduleCoinFlush();
  }

  if (!msg.content.startsWith(PREFIX)) return;
  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();
  const isAdmin = msg.member?.permissions.has(PermissionFlagsBits.Administrator);

  try {
    if (cmd==='balance'||cmd==='bal') return await cmdBalance(p=>msg.reply(p), msg.mentions.users.first()||msg.author);
    if (cmd==='daily')                return await cmdDaily(p=>msg.reply(p), uid, msg.author.username);
    if (cmd==='shop')                 return await cmdShop(p=>msg.reply(p));
    if (cmd==='inventory'||cmd==='inv') return await cmdInventory(p=>msg.reply(p), uid, msg.author.username);
    if (cmd==='lb'||cmd==='leaderboard') return await cmdLeaderboard(p=>msg.reply(p), msg.guild);
    if (cmd==='help')                 return await cmdHelp(p=>msg.reply(p));
    if (cmd==='adminhelp'&&isAdmin)   return await cmdAdminHelp(p=>msg.reply(p));
    if (cmd==='use-code')             return await cmdUseCode(p=>msg.reply(p), uid, msg.author.username, args[0]);
  } catch(e) {}
});

async function cmdBalance(reply, target) {
  const u = await getUser(target.id, target.username);
  return reply({ embeds:[new EmbedBuilder().setColor(0xF1C40F).setAuthor({name:`${target.username}'s Balance`,iconURL:target.displayAvatarURL()}).setDescription(`## ${COIN_EMOJI} ${u.coins.toLocaleString()} coins`)] });
}

async function cmdDaily(reply, userId, username) {
  const u=await getUser(userId,username), cd=24*60*60*1000, now=Date.now();
  if (u.lastDaily&&now-u.lastDaily<cd) return reply({ embeds:[errEmbed(`Next daily ready ${ts(u.lastDaily+cd)}`)] });
  const earned=Math.floor(Math.random()*6)+10;
  u.coins+=earned; u.totalEarned=(u.totalEarned||0)+earned; u.lastDaily=now; await saveUser(u);
  return reply({ embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎁 Daily Claimed!').setDescription(`You received **${earned}** ${COIN_EMOJI}!\nBalance: **${u.coins.toLocaleString()}** ${COIN_EMOJI}`)] });
}

async function cmdUseCode(reply, userId, username, codeInput) {
  if (!codeInput) return reply({ embeds:[errEmbed(`Usage: \`${PREFIX}use-code <code>\``)] });
  const key = codeInput.toUpperCase().trim();
  if (key === 'LOOTDROP') {
    if (!activeLootDrop || activeLootDrop.claimed) return reply({ embeds:[errEmbed('Loot Drop not active / already claimed!')] });
    activeLootDrop.claimed = true;
    const won = activeLootDrop.coins, dropMsg = activeLootDrop.msg; activeLootDrop = null;
    const u = await getUser(userId, username); u.coins += won; u.totalEarned+=won; await saveUser(u);
    if (dropMsg) try { await dropMsg.edit({ embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('📦 Loot Drop — CLAIMED!').setDescription(`Claimed by **${username}**!\nFound **${won}** ${COIN_EMOJI}!`)] }); } catch {}
    return reply({ embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle('📦 Loot Drop Claimed!').setDescription(`You found **${won}** ${COIN_EMOJI}!`)] });
  }
  const code = await getCode(key);
  if (!code) return reply({ embeds:[errEmbed('Invalid code!')] });
  const u = await getUser(userId, username);
  if (u.redeemedCodes.includes(key) || (code.multiUse && (code.redeemedBy||[]).includes(userId))) return reply({ embeds:[errEmbed('Already used!')] });
  if (code.multiUse) { code.redeemedBy = (code.redeemedBy||[]); code.redeemedBy.push(userId); if (!(key in PERMANENT_CODES)) await saveCode(key, code); } else u.redeemedCodes.push(key);
  u.coins += code.coins; await saveUser(u);
  return reply({ embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🎟️ Code Redeemed!').setDescription(`${code.description}\nReceived **${code.coins}** ${COIN_EMOJI}!`)] });
}

async function cmdShop(reply) {
  const robuxLines=SHOP.filter(i=>i.category==='Robux').map(i=>`${ROBUX_EMOJI} **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const etfbLines=SHOP.filter(i=>i.category==='ETFB').map(i=>`${i.id==='etfb_cel'?'✨':'🌟'} **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  const nitroLines=SHOP.filter(i=>i.category==='Nitro').map(i=>`<:Nitro:1482656844655624192> **${i.name}** — \`${i.cost}\` ${COIN_EMOJI}  ·  \`${i.id}\``).join('\n');
  return reply({ embeds:[new EmbedBuilder().setTitle('🏪 Rewards Shop').setColor(0x9B59B6).addFields({name:'💎 Robux',value:robuxLines,inline:false},{name:'🎮 ETFB',value:etfbLines,inline:false},{name:`<:Nitro:1482656844655624192> Nitro`,value:nitroLines,inline:false}).setFooter({text:'Buy: /redeem  |  Then: /claim <id>'})] });
}

async function cmdInventory(reply, userId, username) {
  const u=await getUser(userId,username), inv=u.inventory||[];
  if (!inv.length) return reply({ embeds:[errEmbed('Inventory empty!')] });
  const list=inv.map(i=>`${i.category==='Robux'?'💎':i.name==='Divine'?'🌟':'✨'} **${i.name}** — \`${i.claimId}\``).join('\n');
  return reply({ embeds:[new EmbedBuilder().setTitle(`🎒 ${username}'s Inventory`).setColor(0x9B59B6).setDescription(list)] });
}

async function cmdLeaderboard(reply, guild) {
  const top=await getLeaderboard(10);
  const list=top.map((u,i)=>`${i+1}. <@${u.id}> — **${u.coins.toLocaleString()}** ${COIN_EMOJI}`).join('\n');
  return reply({ embeds:[new EmbedBuilder().setTitle('🏆 Coin Leaderboard').setColor(0xF1C40F).setDescription(list||'No data yet!')] });
}

async function cmdHelp(reply) {
  return reply({ embeds:[new EmbedBuilder().setTitle(`📖 Help — Prefix: \`${PREFIX}\``).setColor(0x5865F2).addFields(
    {name:'💰 Economy',value:`\`/balance\`, \`/daily\`, \`/leaderboard\``,inline:true},
    {name:'🛒 Shop',value:`\`/shop\`, \`/redeem\`, \`/inventory\`, \`/claim\``,inline:true},
    {name:'🎲 Games',value:`\`/coinflip\`, \`/slots\`, \`/blackjack\`, \`/doubleornothing\``,inline:true}
  )] });
}

async function cmdAdminHelp(reply) {
  return reply({ embeds:[new EmbedBuilder().setTitle('🔒 Admin Commands Full List').setColor(0xFF6B35).addFields(
    {name:'📦 Stock & Shop',value:`\`update-robux\`, \`update-etfb\`, \`update-sab\`, \`remove-stock-sab\``,inline:false},
    {name:'👥 User & Coins',value:`\`give\`, \`take\`, \`check-inventory\`, \`remove-inv\`, \`check-user\`, \`find-user\``,inline:false},
    {name:'📋 Delivery Claims',value:`\`claims\`, \`claimed\`, \`deny-claim\``,inline:false},
    {name:'🎟️ Codes & Event Tools',value:`\`make-code\`, \`drop-code\`, \`remove-code\`, \`list-codes\`, \`lootdrop\`, \`rain\`, \`giveaway\`, \`gtn\``,inline:false},
    {name:'🎮 Round-Based Games',value:`\`chair-game\`, \`mafia\`, \`pick-number\`, \`greentea\`, \`blacktea\``,inline:false},
    {name:'🛠️ Game Execution',value:`\`chair-next\`, \`mafia-start\`, \`mafia-next\`, \`pick-number-round\`, \`greentea-round\`, \`greentea-next\`, \`blacktea-round\`, \`blacktea-next\`, \`game-night-start\``,inline:false},
    {name:'🛡️ Moderation',value:`\`timeout\`, \`untimeout\`, \`warn\`, \`unwarn\`, \`warns\`, \`kick\`, \`ban\``,inline:false}
  )] });
}

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const cid = interaction.customId;

    if (cid.startsWith('cg_join_')) {
      const game = [...activeChairGame.values()].find(g=>g.gwId===cid.replace('cg_join_',''));
      if (game && game.phase==='joining') { game.players.add(interaction.user.id); return interaction.reply({content:'Joined!',flags:64}); }
    }
    
    if (cid.startsWith('cgr_')) {
      const game = [...activeChairGame.values()].find(g=>g.gwId===cid.split('_')[1]);
      if (game && game.round===parseInt(cid.split('_')[2])) { game.clickedThisRound.add(interaction.user.id); return interaction.reply({content:'Clicked!',flags:64}); }
    }

    // BLACKJACK BUTTONS
    if (cid === 'bj_hit' || cid === 'bj_stand') {
      const game = activeBlackjack.get(interaction.user.id);
      if (!game) return interaction.reply({embeds:[errEmbed('No active game found.')],flags:64});
      await interaction.deferUpdate();
      
      const { drawCard, cardVal, handTotal, fmtCard, bet } = game;
      const calc = (h) => { let t=h.reduce((s,c)=>s+(['J','Q','K'].includes(c.val)?10:c.val==='A'?11:parseInt(c.val)),0), a=h.filter(c=>c.val==='A').length; while(t>21&&a>0){t-=10;a--;} return t; };
      
      if (cid === 'bj_hit') {
        game.player.push(drawCard());
        if (calc(game.player) > 21) {
          activeBlackjack.delete(interaction.user.id);
          const u=await getUser(interaction.user.id); u.coins=Math.max(0,u.coins-bet); await saveUser(u);
          return interaction.editReply({embeds:[errEmbed(`Bust! Lost **${bet}** ${COIN_EMOJI}`)],components:[]});
        }
      } else {
        while(calc(game.dealer)<17) game.dealer.push(drawCard());
        const pt=calc(game.player), dt=calc(game.dealer);
        const win = dt>21||pt>dt, push = pt===dt;
        activeBlackjack.delete(interaction.user.id);
        const u=await getUser(interaction.user.id); if(win) u.coins+=bet; else if(!push) u.coins=Math.max(0,u.coins-bet); await saveUser(u);
        return interaction.editReply({embeds:[new EmbedBuilder().setColor(win?0x57F287:push?0xFEE75C:0xED4245).setTitle(win?'Win!':push?'Push':'Lost').setDescription(`You: ${pt} | Dealer: ${dt}`)],components:[]});
      }
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('Blackjack').setDescription(`Total: ${calc(game.player)}`)]});
    }

    if (cid === 'sab_view') {
        const sab = await dbRead('sab');
        const items = sab.filter(i => i && i.item);
        if(!items.length) return interaction.reply({content:'No stock',flags:64});
        return interaction.reply({embeds:[new EmbedBuilder().setTitle('SAB Stock').setDescription(items.map(i=>`**${i.item}** — ${i.price} ${COIN_EMOJI}`).join('\n'))],flags:64});
    }
  }

  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;
    const isTest = isTestServer(interaction.guildId);

    // FIX: Testing server restriction logic
    if (isTest && !hasTesterRole(interaction.member) && !interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
       const testerOnly = ['give','take','rain','update-robux','update-etfb','claims','claimed','deny-claim','remove-inv','check-inventory','make-code','drop-code','remove-code','list-codes','gtn','timeout','untimeout','warn','unwarn','warns','kick','ban','lootdrop','check-user','find-user','game-night-start','update-sab','remove-stock-sab','giveaway','chair-game','mafia','pick-number','greentea','blacktea'];
       if (testerOnly.includes(cmd)) return interaction.reply({embeds:[errEmbed('Tester role required in this server')],flags:64});
    }

    if (cmd === 'balance') return cmdBalance(p=>interaction.reply(p), interaction.options.getUser('user')||interaction.user);
    if (cmd === 'daily')   return cmdDaily(p=>interaction.reply(p), interaction.user.id, interaction.user.username);
    if (cmd === 'blackjack') {
        const bet = interaction.options.getInteger('bet');
        const u = await getUser(interaction.user.id);
        if (u.coins < bet) return interaction.reply({embeds:[errEmbed('Not enough coins')],flags:64});
        const SUITS=['♠️','♥️','♦️','♣️'],VALS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
        const draw=()=>({suit:SUITS[Math.floor(Math.random()*4)],val:VALS[Math.floor(Math.random()*13)]});
        const game={player:[draw(),draw()],dealer:[draw(),draw()],bet,drawCard:draw};
        activeBlackjack.set(interaction.user.id, game);
        return interaction.reply({embeds:[new EmbedBuilder().setTitle('Blackjack Started').setDescription(`Bet: **${bet}** ${COIN_EMOJI}`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary))]});
    }
    if (cmd === 'adminhelp') return cmdAdminHelp(p=>interaction.reply(p));
  }
});

client.login(BOT_TOKEN);
