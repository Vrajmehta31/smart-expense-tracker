require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 300 }));
app.use("/auth", rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many attempts. Try again in 15 minutes." } }));

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
// Wraps a route so any error becomes a clean JSON response instead of crashing the server
const h = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

/* ================= MODELS ================= */
const User = mongoose.model("User", new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true, trim: true },
  password: String, // bcrypt hash, never plain text
}));
const Transaction = mongoose.model("Transaction", new mongoose.Schema({
  userId: { type: String, index: true },
  type: { type: String, default: "personal" }, // personal | business
  amount: Number, merchant: String, description: String,
  category: String, categorySource: String, // rule | learned | user
  isAnomaly: { type: Boolean, default: false }, anomalyReason: String,
  date: { type: Date, default: Date.now },
}));
const MerchantRule = mongoose.model("MerchantRule", new mongoose.Schema({
  userId: String, merchant: String, category: String }));
const Budget = mongoose.model("Budget", new mongoose.Schema({
  userId: String, category: String, limit: Number }));
// NEW: seller mode
const Product = mongoose.model("Product", new mongoose.Schema({
  userId: { type: String, index: true }, name: String, cost: Number, price: Number }));
const Sale = mongoose.model("Sale", new mongoose.Schema({
  userId: { type: String, index: true }, productId: mongoose.Schema.Types.ObjectId,
  productName: String, qty: Number, unitPrice: Number, unitCost: Number, // price/cost saved at time of sale
  customer: String, paid: Number, date: { type: Date, default: Date.now } }));

/* ================= AUTH ================= */
const sign = (u) => jwt.sign({ id: String(u._id) }, SECRET, { expiresIn: "7d" });

app.post("/auth/register", h(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6 || !/^\S+@\S+\.\S+$/.test(email))
    return res.status(400).json({ error: "Valid name, email and a password of 6+ characters are required" });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: "This email is already registered" });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(user), user: { name: user.name, email: user.email } });
}));

app.post("/auth/login", h(async (req, res) => {
  const { email = "", password = "" } = req.body;
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !(await bcrypt.compare(String(password), user.password)))
    return res.status(400).json({ error: "Invalid email or password" });
  res.json({ token: sign(user), user: { name: user.name, email: user.email } });
}));

// Every route below this line needs a valid token
app.use((req, res, next) => {
  try {
    const token = (req.header("authorization") || "").replace("Bearer ", "");
    req.userId = jwt.verify(token, SECRET).id;
    next();
  } catch {
    res.status(401).json({ error: "Please log in" });
  }
});
const uid = (req) => req.userId;
const PERSONAL = { type: { $ne: "business" } }; // personal charts ignore business spending

// NEW: delete my account and all my data
app.delete("/account", h(async (req, res) => {
  const userId = uid(req);
  await Promise.all([Transaction, MerchantRule, Budget, Product, Sale].map((M) => M.deleteMany({ userId })));
  await User.deleteOne({ _id: userId });
  res.json({ ok: true });
}));

/* ============ CATEGORIZER (English + Hindi + Gujarati words) ============ */
const KEYWORDS = {
  Food: ["zomato", "swiggy", "restaurant", "cafe", "pizza", "grocery", "chai", "tea", "coffee", "nashta", "sabzi", "sabji",
    "dudh", "kirana", "bhaji", "thali", "lunch", "dinner", "ચા", "નાસ્તો", "શાકભાજી", "દૂધ", "જમવાનું", "चाय", "नाश्ता", "सब्ज़ी", "दूध"],
  Transport: ["uber", "ola", "metro", "petrol", "fuel", "rapido", "rickshaw", "auto", "bus", "train", "taxi",
    "પેટ્રોલ", "રિક્ષા", "ઓટો", "पेट्रोल", "रिक्शा", "ऑटो"],
  Shopping: ["amazon", "flipkart", "myntra", "mall", "kapda", "kapde", "કપડાં", "कपड़े"],
  Bills: ["electricity", "jio", "airtel", "recharge", "rent", "wifi", "bijli", "bill", "kiraya", "gas", "બિલ", "ભાડું", "बिजली", "किराया"],
  Entertainment: ["netflix", "spotify", "movie", "bookmyshow", "film", "cinema", "picture"],
  Health: ["pharmacy", "hospital", "clinic", "medic", "dawai", "dawa", "doctor", "દવા", "ડૉક્ટર", "दवा", "डॉक्टर"],
};
async function categorize(userId, merchant = "", description = "") {
  const m = merchant.toLowerCase();
  const learned = await MerchantRule.findOne({ userId, merchant: m });
  if (learned) return { category: learned.category, source: "learned" };
  // compare whole words so "ola" does not match "chocolate"
  const tokens = `${m} ${description.toLowerCase()}`.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const [cat, words] of Object.entries(KEYWORDS))
    if (words.some((w) => tokens.some((t) => t === w || t.startsWith(w)))) return { category: cat, source: "rule" };
  return { category: "Other", source: "rule" };
}

/* ---- PARSERS ---- */
// Turns Hindi/Gujarati digits into 0-9
const toAscii = (s) => String(s)
  .replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d))
  .replace(/[૦-૯]/g, (d) => "૦૧૨૩૪૫૬૭૮૯".indexOf(d));
const FILLER = new Set(["rs", "rs.", "inr", "₹", "rupees", "rupee", "rupiya", "rupaye", "spent", "paid", "on", "for", "at", "to",
  "ka", "ki", "ke", "ne", "રૂપિયા", "રૂ", "રૂ.", "रुपये", "रुपया", "खर्च", "ખર્ચ"]);

// "chai 20", "chai 20 rupees", "ચા 20", "kal zomato 450" -> { amount, merchant, date }
function parseQuick(text) {
  let t = toAscii(text).toLowerCase();
  let date = new Date();
  if (/yesterday|\bkal\b|ગઈકાલે|ગઈકાલ|कल/.test(t)) {
    date = new Date(Date.now() - 86400000);
    t = t.replace(/yesterday|\bkal\b|ગઈકાલે|ગઈકાલ|कल/g, " ");
  }
  const m = t.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const amount = parseFloat(m[0].replace(/,/g, ""));
  const merchant = t.replace(m[0], " ").split(/\s+/).filter((w) => w && !FILLER.has(w)).join(" ") || "misc";
  return { amount, merchant, date };
}

// Reads a pasted bank / UPI SMS
function parseSms(text) {
  const s = toAscii(text);
  const a = s.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  const amount = a ? parseFloat(a[1].replace(/,/g, "")) : null;
  const credit = /credited|received|deposited|refund/i.test(s);
  const debit = /debited|spent|paid|sent|purchase|withdrawn/i.test(s);
  const isCredit = credit && !debit;
  const stop = "(?=\\s+(?:on|via|ref\\w*|upi|avl|bal|using|from|a\\/c)\\b|[.,;]|$)";
  const pick = new RegExp((isCredit ? "(?:\\bfrom\\b)" : "(?:\\bat\\b|\\bto\\b|towards|@)") + "\\s+([A-Za-z0-9][A-Za-z0-9 &._-]{1,30}?)" + stop, "i");
  const m1 = s.match(pick);
  const m2 = s.match(/VPA\s+([\w.-]+)@/i);
  let merchant = "";
  if (m1) merchant = m1[1]; else if (m2) merchant = m2[1];
  return { amount, merchant: merchant.trim().toLowerCase(), kind: isCredit ? "credit" : "debit" };
}
/* ---- END PARSERS ---- */

/* ============ ANOMALY DETECTION ============ */
async function detectAnomaly(userId, { amount, merchant, category }) {
  const dup = await Transaction.findOne({
    userId, merchant, amount, date: { $gte: new Date(Date.now() - 10 * 60000) } });
  if (dup) return "Possible duplicate charge";
  const past = await Transaction.find({
    userId, category, ...PERSONAL, date: { $gte: new Date(Date.now() - 90 * 86400000) } });
  if (past.length >= 5) {
    const v = past.map((t) => t.amount);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const std = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
    if (std > 0 && (amount - mean) / std > 2.5)
      return `${(amount / mean).toFixed(1)}x higher than your usual ${category} spend`;
  }
  return null;
}

/* ================= TRANSACTIONS ================= */
async function createTx(userId, { amount, merchant = "", description, date, type = "personal" }) {
  const m = merchant.toLowerCase().trim();
  let category = "Business", source = "rule", reason = null;
  if (type !== "business") {
    ({ category, source } = await categorize(userId, m, description));
    reason = await detectAnomaly(userId, { amount, merchant: m, category });
  }
  return Transaction.create({ userId, type, amount, merchant: m, description, category,
    categorySource: source, date, isAnomaly: !!reason, anomalyReason: reason });
}

app.post("/transactions", h(async (req, res) => {
  const { amount, type } = req.body;
  if (!(amount > 0)) return res.status(400).json({ error: "Amount must be positive" });
  res.status(201).json(await createTx(uid(req), { ...req.body, type: type === "business" ? "business" : "personal" }));
}));

// NEW: type "chai 20" or "ચા 20" and the expense is created
app.post("/quick-add", h(async (req, res) => {
  const p = parseQuick(req.body.text || "");
  if (!p || !(p.amount > 0)) return res.status(400).json({ error: "Could not find an amount. Try: chai 20" });
  res.status(201).json(await createTx(uid(req), p));
}));

// NEW: paste a bank SMS and get amount + merchant back
app.post("/parse-sms", h(async (req, res) => {
  const p = parseSms(req.body.text || "");
  if (!p.amount) return res.status(400).json({ error: "Could not find an amount in this message" });
  res.json(p);
}));

app.get("/transactions", h(async (req, res) =>
  res.json(await Transaction.find({ userId: uid(req) }).sort({ date: -1 }).limit(100))));

app.get("/transactions/export", h(async (req, res) => {
  const txs = await Transaction.find({ userId: uid(req) }).sort({ date: -1 });
  const rows = ["Date,Type,Merchant,Amount,Category,Flagged"];
  txs.forEach((t) => rows.push([t.date.toISOString().slice(0, 10), t.type, t.merchant, t.amount,
    t.category, t.isAnomaly ? "Yes" : "No"].join(",")));
  res.setHeader("Content-Type", "text/csv");
  res.send(rows.join("\n"));
}));

app.delete("/transactions/:id", h(async (req, res) => {
  await Transaction.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ ok: true });
}));

app.patch("/transactions/:id/category", h(async (req, res) => {
  const userId = uid(req);
  const tx = await Transaction.findOneAndUpdate({ _id: req.params.id, userId },
    { category: req.body.category, categorySource: "user" }, { new: true });
  if (!tx) return res.status(404).json({ error: "Not found" });
  await MerchantRule.findOneAndUpdate({ userId, merchant: tx.merchant },
    { category: req.body.category }, { upsert: true });
  res.json(tx);
}));

/* ================= INSIGHTS (personal spending only) ================= */
const monthStart = (d = new Date(), offset = 0) => new Date(d.getFullYear(), d.getMonth() + offset, 1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

app.get("/insights/anomalies", h(async (req, res) =>
  res.json(await Transaction.find({ userId: uid(req), isAnomaly: true, ...PERSONAL }).sort({ date: -1 }).limit(20))));

async function monthSpend(userId) {
  const rows = await Transaction.aggregate([
    { $match: { userId, ...PERSONAL, date: { $gte: monthStart() } } },
    { $group: { _id: "$category", total: { $sum: "$amount" } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.total]));
}
app.get("/insights/summary", h(async (req, res) => {
  const spend = await monthSpend(uid(req));
  res.json({ total: Object.values(spend).reduce((a, b) => a + b, 0),
    byCategory: Object.entries(spend).map(([name, value]) => ({ name, value })) });
}));

app.get("/insights/forecast", h(async (req, res) => {
  const userId = uid(req), now = new Date();
  const rows = await Transaction.aggregate([
    { $match: { userId, ...PERSONAL, date: { $gte: monthStart(now, -3), $lt: monthStart(now) } } },
    { $group: { _id: { cat: "$category", m: { $month: "$date" }, y: { $year: "$date" } },
        total: { $sum: "$amount" } } }]);
  const w = [0.2, 0.3, 0.5], byCat = {};
  rows.forEach((r) => {
    const ago = (now.getFullYear() - r._id.y) * 12 + (now.getMonth() + 1 - r._id.m);
    (byCat[r._id.cat] ||= [0, 0, 0])[3 - ago] = r.total;
  });
  const list = Object.entries(byCat).map(([category, t]) =>
    ({ category, predicted: Math.round(t.reduce((s, v, i) => s + v * w[i], 0)) }));
  res.json({ nextMonthTotal: list.reduce((s, f) => s + f.predicted, 0), byCategory: list });
}));

app.get("/insights/trend", h(async (req, res) => {
  const rows = await Transaction.aggregate([
    { $match: { userId: uid(req), ...PERSONAL, date: { $gte: monthStart(new Date(), -5) } } },
    { $group: { _id: { y: { $year: "$date" }, m: { $month: "$date" } }, total: { $sum: "$amount" } } },
    { $sort: { "_id.y": 1, "_id.m": 1 } }]);
  res.json(rows.map((r) => ({ month: MONTHS[r._id.m - 1], total: r.total })));
}));

app.get("/insights/subscriptions", h(async (req, res) => {
  const rows = await Transaction.aggregate([
    { $match: { userId: uid(req), ...PERSONAL, date: { $gte: new Date(Date.now() - 150 * 86400000) } } },
    { $group: { _id: { merchant: "$merchant", amount: "$amount" },
        months: { $addToSet: { $month: "$date" } } } },
    { $match: { "months.1": { $exists: true } } }]);
  const subs = rows.map((r) => ({ merchant: r._id.merchant, amount: r._id.amount, months: r.months.length }));
  res.json({ monthlyCost: subs.reduce((s, x) => s + x.amount, 0), subscriptions: subs });
}));

// NEW: how much you can spend per day for the rest of the month
app.get("/insights/safe-to-spend", h(async (req, res) => {
  const userId = uid(req);
  const budgets = await Budget.find({ userId });
  if (!budgets.length) return res.json({ hasBudget: false });
  const spend = await monthSpend(userId), now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const limit = budgets.reduce((s, b) => s + b.limit, 0);
  const spent = budgets.reduce((s, b) => s + (spend[b.category] || 0), 0);
  const remaining = limit - spent;
  res.json({ hasBudget: true, limit, spent, remaining, daysLeft, perDay: Math.max(0, Math.floor(remaining / daysLeft)) });
}));

/* ================= BUDGETS ================= */
app.put("/budgets", h(async (req, res) => {
  const { category, limit } = req.body;
  res.json(await Budget.findOneAndUpdate({ userId: uid(req), category }, { limit }, { upsert: true, new: true }));
}));
app.get("/budgets/status", h(async (req, res) => {
  const userId = uid(req), spend = await monthSpend(userId);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const budgets = await Budget.find({ userId });
  res.json(budgets.map((b) => {
    const spent = spend[b.category] || 0;
    const projected = Math.round((spent / now.getDate()) * daysInMonth);
    return { category: b.category, limit: b.limit, spent, projected,
      alert: projected > b.limit ? `On pace to exceed by ₹${projected - b.limit}` : null };
  }));
}));

/* ================= SELLER MODE ================= */
app.post("/products", h(async (req, res) => {
  const { name, cost, price } = req.body;
  if (!name || !(Number(cost) >= 0) || !(Number(price) >= 0))
    return res.status(400).json({ error: "Name, cost and price are required" });
  res.status(201).json(await Product.create({ userId: uid(req), name, cost: Number(cost), price: Number(price) }));
}));
app.get("/products", h(async (req, res) => res.json(await Product.find({ userId: uid(req) }).sort({ name: 1 }))));
app.delete("/products/:id", h(async (req, res) => {
  await Product.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ ok: true });
}));

// Record a sale. Price and cost are copied into the sale so old sales never change.
app.post("/sales", h(async (req, res) => {
  const userId = uid(req);
  const { productId, qty = 1, customer = "", paid } = req.body;
  const p = await Product.findOne({ _id: productId, userId });
  if (!p) return res.status(404).json({ error: "Product not found" });
  const q = Number(qty);
  if (!(q > 0)) return res.status(400).json({ error: "Quantity must be positive" });
  const total = q * p.price;
  const paidNow = paid === undefined || paid === "" ? total : Math.min(Math.max(Number(paid) || 0, 0), total);
  res.status(201).json(await Sale.create({ userId, productId: p._id, productName: p.name, qty: q,
    unitPrice: p.price, unitCost: p.cost, customer: String(customer).trim(), paid: paidNow }));
}));
app.get("/sales", h(async (req, res) => res.json(await Sale.find({ userId: uid(req) }).sort({ date: -1 }).limit(50))));
app.post("/sales/:id/pay", h(async (req, res) => {
  const sale = await Sale.findOne({ _id: req.params.id, userId: uid(req) });
  if (!sale) return res.status(404).json({ error: "Not found" });
  sale.paid = Math.min(sale.qty * sale.unitPrice, sale.paid + (Number(req.body.amount) || 0));
  await sale.save();
  res.json(sale);
}));
app.delete("/sales/:id", h(async (req, res) => {
  await Sale.deleteOne({ _id: req.params.id, userId: uid(req) });
  res.json({ ok: true });
}));

// This month's profit and loss, pending customer payments, profit per product
app.get("/business/summary", h(async (req, res) => {
  const userId = uid(req);
  const [monthSales, open, exp] = await Promise.all([
    Sale.find({ userId, date: { $gte: monthStart() } }),
    Sale.find({ userId, $expr: { $lt: ["$paid", { $multiply: ["$qty", "$unitPrice"] }] } }),
    Transaction.aggregate([{ $match: { userId, type: "business", date: { $gte: monthStart() } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);
  let revenue = 0, cogs = 0, collected = 0;
  const by = {};
  monthSales.forEach((s) => {
    const rev = s.qty * s.unitPrice, cost = s.qty * s.unitCost;
    revenue += rev; cogs += cost; collected += s.paid;
    const b = (by[s.productName] ||= { name: s.productName, qty: 0, revenue: 0, profit: 0 });
    b.qty += s.qty; b.revenue += rev; b.profit += rev - cost;
  });
  const expenses = exp[0]?.total || 0;
  const owed = {};
  open.forEach((s) => { const k = s.customer || "Unknown"; owed[k] = (owed[k] || 0) + (s.qty * s.unitPrice - s.paid); });
  const pending = Object.entries(owed).map(([customer, amount]) => ({ customer, amount })).sort((a, b) => b.amount - a.amount);
  res.json({ revenue, cogs, grossProfit: revenue - cogs, expenses, netProfit: revenue - cogs - expenses, collected,
    margin: revenue ? Math.round(((revenue - cogs) / revenue) * 100) : 0,
    pendingTotal: pending.reduce((s, p) => s + p.amount, 0), pending,
    byProduct: Object.values(by).sort((a, b) => b.profit - a.profit) });
}));

/* ================= DEMO DATA ================= */
app.post("/demo/seed", h(async (req, res) => {
  const userId = uid(req);
  if (await Transaction.countDocuments({ userId }))
    return res.status(400).json({ error: "Demo data loads only into an empty account. Clear your data first." });
  const now = new Date(), docs = [];
  const add = (merchant, amount, ago, day) => docs.push({ merchant, amount,
    date: new Date(now.getFullYear(), now.getMonth() - ago, ago === 0 ? Math.min(day, now.getDate()) : day, 12) });
  for (let m = 0; m <= 3; m++) {
    add("netflix", 499, m, 5);  add("spotify", 119, m, 8);  add("jio", 299, m, 10);
    add("zomato", 250 + m * 20, m, 12);  add("zomato", 310 + m * 15, m, 20);
    add("swiggy", 280 + m * 10, m, 15);  add("uber", 180 + m * 10, m, 7);
    add("uber", 220 + m * 5, m, 18);     add("amazon", 1200 + m * 150, m, 22);
    add("pharmacy", 350 + m * 25, m, 3);
  }
  const ready = [];
  for (const d of docs) {
    const { category, source } = await categorize(userId, d.merchant);
    ready.push({ ...d, userId, category, categorySource: source });
  }
  ready.push({ userId, merchant: "zomato", amount: 4800, category: "Food", categorySource: "rule",
    date: now, isAnomaly: true, anomalyReason: "Much higher than your usual Food spend" });
  await Transaction.insertMany(ready);
  res.json({ added: ready.length });
}));

app.post("/demo/seed-business", h(async (req, res) => {
  const userId = uid(req);
  if (await Product.countDocuments({ userId }))
    return res.status(400).json({ error: "Seller demo loads only when you have no products yet." });
  const [a, b, c] = await Product.insertMany([
    { userId, name: "Necklace set", cost: 150, price: 400 },
    { userId, name: "Earrings", cost: 60, price: 180 },
    { userId, name: "Envelope pack", cost: 20, price: 60 }]);
  const now = new Date();
  const mk = (p, qty, customer, frac, day) => ({ userId, productId: p._id, productName: p.name, qty,
    unitPrice: p.price, unitCost: p.cost, customer, paid: Math.round(qty * p.price * frac),
    date: new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate()), 12) });
  await Sale.insertMany([mk(a, 2, "Riya", 1, 2), mk(b, 5, "Meera", 1, 4), mk(c, 10, "Kinjal", 0.5, 6),
    mk(a, 1, "Pooja", 0, 8), mk(b, 3, "Riya", 1, 10), mk(c, 20, "Shop A", 0.25, 12)]);
  const biz = (merchant, amount) => ({ userId, type: "business", merchant, amount, category: "Business",
    categorySource: "rule", date: new Date(now.getFullYear(), now.getMonth(), Math.min(3, now.getDate()), 12) });
  await Transaction.insertMany([biz("raw materials", 1500), biz("packaging", 400), biz("instagram ads", 600)]);
  res.json({ ok: true });
}));

app.delete("/demo/clear", h(async (req, res) => {
  await Transaction.deleteMany({ userId: uid(req) });
  res.json({ ok: true });
}));

/* ================= START ================= */
const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/expense-tracker";
mongoose.connect(MONGO)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(process.env.PORT || 5000, () => console.log("API running on port 5000"));
  })
  .catch((err) => console.error("MongoDB connection failed:", err.message));