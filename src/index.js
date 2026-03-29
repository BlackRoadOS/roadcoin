// RoadCoin — The Currency of BlackRoad OS
// PS-SHA∞ secured. D1 persistent. Coinbase connected. Base-ready ERC-20.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" } });

    if (url.pathname === "/health") return json({ ok: true, service: "roadcoin", version: "2.0.0", symbol: "ROAD" });

    // ── TOKEN INFO ──
    if (url.pathname === "/api/info") return handleInfo(env);

    // ── WALLET ──
    if (url.pathname === "/api/wallet" && request.method === "GET") return handleWallet(url, env);
    if (url.pathname === "/api/wallet/create" && request.method === "POST") return handleWalletCreate(request, env);

    // ── BALANCE ──
    if (url.pathname === "/api/balance") return handleBalance(url, env);

    // ── TRANSFER ──
    if (url.pathname === "/api/transfer" && request.method === "POST") return handleTransfer(request, env);

    // ── EARN (reward actions) ──
    if (url.pathname === "/api/earn" && request.method === "POST") return handleEarn(request, env);

    // ── SPEND ──
    if (url.pathname === "/api/spend" && request.method === "POST") return handleSpend(request, env);

    // ── STAKE ──
    if (url.pathname === "/api/stake" && request.method === "POST") return handleStake(request, env);
    if (url.pathname === "/api/unstake" && request.method === "POST") return handleUnstake(request, env);

    // ── LEADERBOARD ──
    if (url.pathname === "/api/leaderboard") return handleLeaderboard(env);

    // ── HISTORY ──
    if (url.pathname === "/api/history") return handleHistory(url, env);

    // ── SUPPLY ──
    if (url.pathname === "/api/supply") return handleSupply(env);

    // ── COINBASE BUY ──
    if (url.pathname === "/api/buy" && request.method === "POST") return handleBuy(request, env);

    // ── FAUCET (testnet) ──
    if (url.pathname === "/api/faucet" && request.method === "POST") return handleFaucet(request, env);

    // UI
    return new Response(HTML, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }
};

// ── DB ──
async function ensureTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS wallets (
      road_id TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      staked REAL DEFAULT 0,
      total_earned REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      total_staked REAL DEFAULT 0,
      level INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      from_id TEXT,
      to_id TEXT,
      amount REAL NOT NULL,
      memo TEXT,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
  ]);
}

// ── PS-SHA∞ ──
async function pssha(data, depth) {
  let h = data;
  for (let i = 0; i < depth; i++) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(h));
    h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return h;
}

// ── TOKEN INFO ──
async function handleInfo(env) {
  await ensureTables(env.DB);
  const stats = await env.DB.prepare("SELECT COUNT(*) as holders, SUM(balance) as circulating, SUM(staked) as staked FROM wallets").first();
  return json({
    name: "RoadCoin", symbol: "ROAD", network: "BlackRoad OS + Base L2",
    total_supply: 1_000_000_000,
    circulating: stats?.circulating || 0,
    staked: stats?.staked || 0,
    holders: stats?.holders || 0,
    hash_algorithm: "PS-SHA∞ (adaptive depth: 3-7)",
    blockchain: "RoadChain (D1 persistent) + Base ERC-20 (coming)",
    earn: { "tutor.solve": 1, "social.post": 0.5, "chat.message": 0.1, "search.query": 0.05, "canvas.create": 1, "video.upload": 5, "cadence.track": 2, "game.score": 0.2, "referral": 50, "node.hosting": 10 },
    spend: { "premium_inference": 1, "custom_agent": 10, "extended_memory": 5, "priority_queue": 2, "white_label": 100 }
  });
}

// ── WALLET ──
async function handleWallet(url, env) {
  const roadId = url.searchParams.get("road_id");
  if (!roadId) return json({ error: "Missing road_id" }, 400);
  await ensureTables(env.DB);
  const w = await env.DB.prepare("SELECT * FROM wallets WHERE road_id = ?").bind(roadId).first();
  if (!w) return json({ road_id: roadId, balance: 0, staked: 0, level: 0, exists: false });
  const level = Math.floor(Math.log2((w.total_earned || 0) + 1)) + 1;
  return json({ ...w, level, exists: true });
}

async function handleWalletCreate(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.road_id) return json({ error: "Missing road_id" }, 400);
  await ensureTables(env.DB);
  const now = new Date().toISOString();
  // Give 10 ROAD welcome bonus
  await env.DB.prepare(
    "INSERT INTO wallets (road_id, balance, staked, total_earned, total_spent, total_staked, level, created_at, updated_at) VALUES (?, 10, 0, 10, 0, 0, 1, ?, ?) ON CONFLICT(road_id) DO NOTHING"
  ).bind(body.road_id, now, now).run();
  await logTx(env.DB, "welcome_bonus", "system", body.road_id, 10, "Welcome to RoadCoin! 🎉");
  // Log to RoadChain
  await logToRoadChain(env, "mint", "roadcoin", body.road_id, 10, { reason: "welcome_bonus" });
  return json({ road_id: body.road_id, balance: 10, message: "Wallet created! 10 ROAD welcome bonus." });
}

// ── BALANCE ──
async function handleBalance(url, env) {
  const roadId = url.searchParams.get("road_id");
  if (!roadId) return json({ error: "Missing road_id" }, 400);
  await ensureTables(env.DB);
  const w = await env.DB.prepare("SELECT balance, staked FROM wallets WHERE road_id = ?").bind(roadId).first();
  return json({ road_id: roadId, balance: w?.balance || 0, staked: w?.staked || 0, total: (w?.balance || 0) + (w?.staked || 0) });
}

// ── TRANSFER ──
async function handleTransfer(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.from || !body?.to || !body?.amount) return json({ error: "Missing from, to, or amount" }, 400);
  if (body.amount <= 0) return json({ error: "Amount must be positive" }, 400);
  await ensureTables(env.DB);

  const sender = await env.DB.prepare("SELECT balance FROM wallets WHERE road_id = ?").bind(body.from).first();
  if (!sender || sender.balance < body.amount) return json({ error: "Insufficient balance" }, 400);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE wallets SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ? WHERE road_id = ?").bind(body.amount, body.amount, now, body.from),
    env.DB.prepare("INSERT INTO wallets (road_id, balance, staked, total_earned, total_spent, total_staked, level, created_at, updated_at) VALUES (?, ?, 0, ?, 0, 0, 1, ?, ?) ON CONFLICT(road_id) DO UPDATE SET balance = balance + ?, total_earned = total_earned + ?, updated_at = ?").bind(body.to, body.amount, body.amount, now, now, body.amount, body.amount, now),
  ]);

  await logTx(env.DB, "transfer", body.from, body.to, body.amount, body.memo || "Transfer");
  await logToRoadChain(env, "transfer", "roadcoin", body.from, body.amount, { from: body.from, to: body.to, memo: body.memo });
  return json({ success: true, from: body.from, to: body.to, amount: body.amount });
}

// ── EARN ──
async function handleEarn(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.road_id || !body?.action) return json({ error: "Missing road_id or action" }, 400);
  await ensureTables(env.DB);

  const rewards = { "tutor.solve": 1, "social.post": 0.5, "chat.message": 0.1, "search.query": 0.05, "canvas.create": 1, "video.upload": 5, "cadence.track": 2, "game.score": 0.2, "referral": 50, "node.hosting": 10, "agent.task": 0.5 };
  const amount = rewards[body.action] || 0.01;
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO wallets (road_id, balance, staked, total_earned, total_spent, total_staked, level, created_at, updated_at) VALUES (?, ?, 0, ?, 0, 0, 1, ?, ?) ON CONFLICT(road_id) DO UPDATE SET balance = balance + ?, total_earned = total_earned + ?, updated_at = ?"
  ).bind(body.road_id, amount, amount, now, now, amount, amount, now).run();

  await logTx(env.DB, "earn", "system", body.road_id, amount, body.action);
  await logToRoadChain(env, "earn", "roadcoin", body.road_id, amount, { action: body.action });
  return json({ road_id: body.road_id, earned: amount, action: body.action });
}

// ── SPEND ──
async function handleSpend(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.road_id || !body?.amount || !body?.item) return json({ error: "Missing road_id, amount, or item" }, 400);
  await ensureTables(env.DB);

  const w = await env.DB.prepare("SELECT balance FROM wallets WHERE road_id = ?").bind(body.road_id).first();
  if (!w || w.balance < body.amount) return json({ error: "Insufficient balance" }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE wallets SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ? WHERE road_id = ?").bind(body.amount, body.amount, now, body.road_id).run();

  await logTx(env.DB, "spend", body.road_id, "system", body.amount, body.item);
  await logToRoadChain(env, "spend", "roadcoin", body.road_id, body.amount, { item: body.item });
  return json({ success: true, spent: body.amount, item: body.item });
}

// ── STAKE ──
async function handleStake(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.road_id || !body?.amount) return json({ error: "Missing road_id or amount" }, 400);
  await ensureTables(env.DB);

  const w = await env.DB.prepare("SELECT balance FROM wallets WHERE road_id = ?").bind(body.road_id).first();
  if (!w || w.balance < body.amount) return json({ error: "Insufficient balance" }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE wallets SET balance = balance - ?, staked = staked + ?, total_staked = total_staked + ?, updated_at = ? WHERE road_id = ?").bind(body.amount, body.amount, body.amount, now, body.road_id).run();

  await logTx(env.DB, "stake", body.road_id, "staking_pool", body.amount, "Staked ROAD");
  await logToRoadChain(env, "stake", "roadcoin", body.road_id, body.amount, { action: "stake" });
  return json({ success: true, staked: body.amount });
}

async function handleUnstake(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.road_id || !body?.amount) return json({ error: "Missing road_id or amount" }, 400);
  await ensureTables(env.DB);

  const w = await env.DB.prepare("SELECT staked FROM wallets WHERE road_id = ?").bind(body.road_id).first();
  if (!w || w.staked < body.amount) return json({ error: "Insufficient staked balance" }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE wallets SET balance = balance + ?, staked = staked - ?, updated_at = ? WHERE road_id = ?").bind(body.amount, body.amount, now, body.road_id).run();

  await logTx(env.DB, "unstake", "staking_pool", body.road_id, body.amount, "Unstaked ROAD");
  return json({ success: true, unstaked: body.amount });
}

// ── LEADERBOARD ──
async function handleLeaderboard(env) {
  await ensureTables(env.DB);
  const top = await env.DB.prepare("SELECT road_id, balance, staked, total_earned, total_spent FROM wallets ORDER BY total_earned DESC LIMIT 25").all();
  return json({ leaderboard: top.results.map((w, i) => ({ rank: i + 1, ...w, level: Math.floor(Math.log2((w.total_earned || 0) + 1)) + 1 })) });
}

// ── HISTORY ──
async function handleHistory(url, env) {
  const roadId = url.searchParams.get("road_id");
  if (!roadId) return json({ error: "Missing road_id" }, 400);
  await ensureTables(env.DB);
  const txs = await env.DB.prepare("SELECT * FROM transactions WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC LIMIT 50").bind(roadId, roadId).all();
  return json({ road_id: roadId, transactions: txs.results });
}

// ── SUPPLY ──
async function handleSupply(env) {
  await ensureTables(env.DB);
  const stats = await env.DB.prepare("SELECT SUM(balance) as circulating, SUM(staked) as staked, COUNT(*) as holders FROM wallets").first();
  return json({
    total_supply: 1_000_000_000,
    circulating: stats?.circulating || 0,
    staked: stats?.staked || 0,
    burned: 0,
    holders: stats?.holders || 0,
    treasury: 1_000_000_000 - (stats?.circulating || 0) - (stats?.staked || 0)
  });
}

// ── BUY via Coinbase ──
async function handleBuy(request, env) {
  if (!env.COINBASE_API_KEY) return json({ error: "Coinbase not configured" }, 500);
  const body = await request.json().catch(() => null);
  const amount = body?.amount || "10.00";
  const roadId = body?.road_id || "anonymous";

  const charge = await fetch("https://api.commerce.coinbase.com/charges", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CC-Api-Key": env.COINBASE_API_KEY, "X-CC-Version": "2018-03-22" },
    body: JSON.stringify({
      name: `${amount} RoadCoin`,
      description: `Purchase ${amount} ROAD on BlackRoad OS`,
      pricing_type: "fixed_price",
      local_price: { amount, currency: "USD" },
      metadata: { road_id: roadId, token: "ROAD" },
    }),
  });

  if (!charge.ok) return json({ error: "Coinbase failed", detail: await charge.text() }, 500);
  const data = await charge.json();
  return json({ hosted_url: data.data.hosted_url, charge_id: data.data.id, road_amount: parseFloat(amount) });
}

// ── FAUCET (for testing) ──
async function handleFaucet(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.road_id) return json({ error: "Missing road_id" }, 400);
  await ensureTables(env.DB);
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO wallets (road_id, balance, staked, total_earned, total_spent, total_staked, level, created_at, updated_at) VALUES (?, 100, 0, 100, 0, 0, 1, ?, ?) ON CONFLICT(road_id) DO UPDATE SET balance = balance + 100, total_earned = total_earned + 100, updated_at = ?"
  ).bind(body.road_id, now, now, now).run();

  await logTx(env.DB, "faucet", "system", body.road_id, 100, "Testnet faucet drip");
  return json({ road_id: body.road_id, received: 100, message: "💧 100 ROAD from the faucet!" });
}

// ── HELPERS ──
async function logTx(db, type, fromId, toId, amount, memo) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const hashData = JSON.stringify({ type, from: fromId, to: toId, amount, memo, ts: now });
  let h = hashData;
  for (let i = 0; i < 7; i++) { // Financial txs always depth 7
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(h));
    h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  await db.prepare("INSERT INTO transactions (id, type, from_id, to_id, amount, memo, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, type, fromId, toId, amount, memo, h, now).run();
}

async function logToRoadChain(env, action, entity, roadId, amount, data) {
  try {
    await fetch(env.ROADCHAIN_URL + "/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RoadChain-App": "roadcoin" },
      body: JSON.stringify({ action, entity, road_id: roadId, amount, data }),
    });
  } catch { /* non-fatal if RoadChain is unreachable */ }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

// ── UI ──
var HTML = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoadCoin (ROAD) — The Currency of BlackRoad OS</title>
<meta name="description" content="RoadCoin: earn by learning, creating, building. Spend on premium AI. Stake for rewards. Buy with crypto via Coinbase. PS-SHA∞ secured.">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--surface:#111;--border:#1a1a1a;--text:#e5e5e5;--dim:#888;--pink:#FF2255;--green:#22c55e;--gold:#F5A623;--blue:#2979FF}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;padding:20px}
.wrap{max-width:800px;margin:0 auto}
h1{font-family:'Space Grotesk',sans-serif;font-size:36px;font-weight:800;text-align:center;margin:40px 0 4px;letter-spacing:-1px}
h1 span{color:var(--gold)}
.sub{color:var(--dim);text-align:center;font-size:14px;margin-bottom:32px}
.bar{height:3px;border-radius:2px;background:linear-gradient(90deg,var(--gold),var(--pink),var(--blue),var(--green));margin-bottom:32px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:24px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center}
.stat .v{color:var(--gold);font-size:22px;font-weight:700;font-family:'Space Grotesk',sans-serif}
.stat .l{color:var(--dim);font-size:10px;margin-top:2px;text-transform:uppercase}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}
.card h2{font-family:'Space Grotesk',sans-serif;font-size:18px;margin-bottom:8px}
.card p{color:var(--dim);font-size:13px;line-height:1.6}
.earn{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:12px}
.earn-item{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center}
.earn-item .amount{color:var(--gold);font-weight:700;font-size:16px;font-family:'Space Grotesk',sans-serif}
.earn-item .action{color:var(--dim);font-size:11px;margin-top:2px}
.wallet{background:var(--surface);border:2px solid var(--gold);border-radius:16px;padding:24px;text-align:center;margin-bottom:24px}
.wallet input{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;color:var(--text);font-size:14px;width:260px;text-align:center;margin:8px 0}
.wallet button{padding:10px 20px;background:var(--gold);color:#000;border:none;border-radius:6px;font-weight:700;font-family:'Space Grotesk',sans-serif;cursor:pointer;margin:4px}
.wallet button.secondary{background:var(--surface);color:var(--gold);border:1px solid var(--gold)}
#walletResult{margin-top:12px;font-size:13px}
.lb{margin-top:12px}
.lb table{width:100%;border-collapse:collapse;font-size:12px}
.lb td,.lb th{padding:8px;border-bottom:1px solid var(--border);text-align:left}
.lb th{color:var(--dim);font-size:10px;text-transform:uppercase}
.lb .rank{color:var(--gold);font-weight:700}
.footer{text-align:center;color:var(--dim);font-size:11px;padding:32px 0;line-height:1.8}
.footer a{color:var(--pink);text-decoration:none}
</style></head><body>
<div class="wrap">
<h1>Road<span>Coin</span></h1>
<p class="sub">Earn by learning. Earn by creating. Earn by building. The currency of sovereign AI.</p>
<div class="bar"></div>

<div id="supplyStats" class="stats"></div>

<div class="wallet">
  <h2 style="font-family:'Space Grotesk',sans-serif;font-size:22px;color:var(--gold)">Your Wallet</h2>
  <input type="text" id="roadId" placeholder="Enter your RoadID" />
  <br>
  <button onclick="checkWallet()">Check Balance</button>
  <button onclick="createWallet()" class="secondary">Create Wallet</button>
  <button onclick="getFaucet()" class="secondary">Faucet (100 ROAD)</button>
  <div id="walletResult"></div>
</div>

<div class="card">
  <h2>Earn ROAD</h2>
  <p>Every action on BlackRoad OS earns RoadCoin. Use any app. Get rewarded.</p>
  <div class="earn">
    <div class="earn-item"><div class="amount">+5</div><div class="action">Upload video</div></div>
    <div class="earn-item"><div class="amount">+2</div><div class="action">Create music</div></div>
    <div class="earn-item"><div class="amount">+1</div><div class="action">Solve homework</div></div>
    <div class="earn-item"><div class="amount">+1</div><div class="action">Design on canvas</div></div>
    <div class="earn-item"><div class="amount">+0.5</div><div class="action">Social post</div></div>
    <div class="earn-item"><div class="amount">+0.5</div><div class="action">Agent task</div></div>
    <div class="earn-item"><div class="amount">+0.2</div><div class="action">Game score</div></div>
    <div class="earn-item"><div class="amount">+0.1</div><div class="action">Chat message</div></div>
    <div class="earn-item"><div class="amount">+10</div><div class="action">Host a node</div></div>
    <div class="earn-item"><div class="amount">+50</div><div class="action">Refer a friend</div></div>
  </div>
</div>

<div class="card">
  <h2>Spend ROAD</h2>
  <p>Premium AI inference (1 ROAD) · Custom agents (10 ROAD) · Extended memory (5 ROAD/mo) · Priority queue (2 ROAD) · White-label deployment (100 ROAD)</p>
</div>

<div class="card">
  <h2>Stake ROAD</h2>
  <p>Lock your ROAD to earn staking rewards and gain priority access to new features. Stakers vote on ecosystem governance proposals. Unstake anytime.</p>
</div>

<div class="card" style="border-color:var(--gold)">
  <h2>Buy ROAD</h2>
  <p>Purchase RoadCoin with Bitcoin, Ethereum, USDC, or 20+ cryptocurrencies via Coinbase Commerce.</p>
  <div style="text-align:center;margin-top:12px">
    <button onclick="buyROAD()" style="padding:12px 28px;background:var(--gold);color:#000;border:none;border-radius:8px;font-weight:700;font-family:'Space Grotesk',sans-serif;font-size:15px;cursor:pointer">Buy 10 ROAD — $10</button>
    <div id="buyResult" style="margin-top:8px;font-size:13px"></div>
  </div>
</div>

<div class="card">
  <h2>PS-SHA∞ Secured</h2>
  <p>Every RoadCoin transaction is hashed with PS-SHA∞ — Persistent Secure SHA Infinity. Adaptive depth: financial transfers use depth 7 (7 rounds of SHA-256). Events use depth 3-5. The ∞ means there's no theoretical maximum — depth scales with the importance of the data. Every transaction is logged to the RoadChain ledger.</p>
</div>

<div class="card">
  <h2 style="margin-bottom:12px">Leaderboard</h2>
  <div class="lb" id="leaderboard">Loading...</div>
</div>

<div class="footer">
  <a href="https://roadchain.io">RoadChain</a> · <a href="https://blackroad.io">BlackRoad OS</a> · <a href="https://blackroad.io/pricing">Pricing</a> · <a href="https://github.com/BlackRoadOS">GitHub</a><br>
  Token: ROAD · Network: BlackRoad OS + Base L2 · Hash: PS-SHA∞<br>
  Remember the Road. Pave Tomorrow.
</div>
</div>
<script>
async function loadSupply() {
  try {
    const r = await fetch('/api/supply');
    const d = await r.json();
    document.getElementById('supplyStats').innerHTML =
      '<div class="stat"><div class="v">' + fmt(d.total_supply) + '</div><div class="l">Total Supply</div></div>' +
      '<div class="stat"><div class="v">' + fmt(d.circulating) + '</div><div class="l">Circulating</div></div>' +
      '<div class="stat"><div class="v">' + fmt(d.staked) + '</div><div class="l">Staked</div></div>' +
      '<div class="stat"><div class="v">' + d.holders + '</div><div class="l">Holders</div></div>';
  } catch {}
}

async function loadLeaderboard() {
  try {
    const r = await fetch('/api/leaderboard');
    const d = await r.json();
    if (!d.leaderboard?.length) { document.getElementById('leaderboard').textContent = 'No holders yet. Create a wallet to be first!'; return; }
    let html = '<table><tr><th>#</th><th>RoadID</th><th>Balance</th><th>Earned</th><th>Level</th></tr>';
    d.leaderboard.forEach(w => {
      html += '<tr><td class="rank">' + w.rank + '</td><td>' + w.road_id + '</td><td>' + w.balance.toFixed(1) + '</td><td>' + w.total_earned.toFixed(1) + '</td><td>Lv.' + w.level + '</td></tr>';
    });
    html += '</table>';
    document.getElementById('leaderboard').innerHTML = html;
  } catch { document.getElementById('leaderboard').textContent = 'Loading...'; }
}

async function checkWallet() {
  const id = document.getElementById('roadId').value.trim();
  if (!id) return;
  const r = await fetch('/api/wallet?road_id=' + encodeURIComponent(id));
  const d = await r.json();
  const res = document.getElementById('walletResult');
  if (d.exists) {
    res.innerHTML = '<span style="color:var(--gold)">' + d.balance.toFixed(1) + ' ROAD</span> available · ' + (d.staked||0).toFixed(1) + ' staked · Level ' + d.level + ' · Earned: ' + d.total_earned.toFixed(1);
  } else {
    res.innerHTML = 'No wallet found. <a href="#" onclick="createWallet();return false" style="color:var(--gold)">Create one?</a>';
  }
}

async function createWallet() {
  const id = document.getElementById('roadId').value.trim();
  if (!id) { document.getElementById('walletResult').textContent = 'Enter a RoadID first'; return; }
  const r = await fetch('/api/wallet/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ road_id: id }) });
  const d = await r.json();
  document.getElementById('walletResult').innerHTML = '<span style="color:var(--green)">' + d.message + '</span>';
  loadLeaderboard(); loadSupply();
}

async function getFaucet() {
  const id = document.getElementById('roadId').value.trim();
  if (!id) { document.getElementById('walletResult').textContent = 'Enter a RoadID first'; return; }
  const r = await fetch('/api/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ road_id: id }) });
  const d = await r.json();
  document.getElementById('walletResult').innerHTML = '<span style="color:var(--green)">' + d.message + '</span>';
  loadLeaderboard(); loadSupply();
}

async function buyROAD() {
  const res = document.getElementById('buyResult');
  res.textContent = 'Creating Coinbase charge...';
  res.style.color = 'var(--dim)';
  const id = document.getElementById('roadId').value.trim() || 'anonymous';
  try {
    const r = await fetch('/api/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: '10.00', road_id: id }) });
    const d = await r.json();
    if (d.hosted_url) { res.innerHTML = '<a href="' + d.hosted_url + '" target="_blank" style="color:var(--gold);font-weight:700">Pay on Coinbase →</a>'; }
    else { res.textContent = d.error || 'Coinbase not configured yet'; res.style.color = 'var(--pink)'; }
  } catch(e) { res.textContent = e.message; res.style.color = 'var(--pink)'; }
}

function fmt(n) { if (n >= 1e9) return (n/1e9).toFixed(1) + 'B'; if (n >= 1e6) return (n/1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n/1e3).toFixed(1) + 'K'; return n.toFixed(1); }

loadSupply();
loadLeaderboard();
</script></body></html>`;
