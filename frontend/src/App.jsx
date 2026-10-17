import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, LineChart, Line, CartesianGrid, ResponsiveContainer } from "recharts";
import Login from "./Login.jsx";
import { call, json } from "./api";

const CATS = ["Food", "Transport", "Shopping", "Bills", "Entertainment", "Health", "Other", "Business"];
const COLORS = ["#4f46e5", "#06b6d4", "#f59e0b", "#ef4444", "#10b981", "#ec4899", "#94a3b8", "#7c3aed"];
const rs = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

/* ---------- App decides: show login page or dashboard ---------- */
export default function App() {
  const [user, setUser] = useState(() =>
    localStorage.getItem("token") ? JSON.parse(localStorage.getItem("user") || "null") : null);
  const [dark, setDark] = useState(localStorage.getItem("theme") === "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const logout = () => { localStorage.clear(); localStorage.setItem("theme", dark ? "dark" : "light"); setUser(null); };

  if (!user) return <Login onAuth={setUser} />;
  return <Dashboard user={user} dark={dark} setDark={setDark} logout={logout} />;
}

/* ---------- Shell: header + tabs ---------- */
function Dashboard({ user, dark, setDark, logout }) {
  const [tab, setTab] = useState("personal");

  const deleteAccount = async () => {
    if (confirm("Permanently delete your account and ALL your data? This cannot be undone.")) {
      await call("/account", { method: "DELETE" });
      logout();
    }
  };

  return (
    <div className="wrap">
      <div className="top">
        <h1>💸 SpendSense</h1>
        <div className="tabs">
          <button className={`tab ${tab === "personal" ? "on" : ""}`} onClick={() => setTab("personal")}>Personal</button>
          <button className={`tab ${tab === "business" ? "on" : ""}`} onClick={() => setTab("business")}>Seller / Business</button>
        </div>
        <div className="actions">
          <span>Hi, <b>{user.name}</b></span>
          <button className="ghost" onClick={() => setDark(!dark)}>{dark ? "☀️" : "🌙"}</button>
          <button className="ghost" onClick={deleteAccount}>Delete account</button>
          <button onClick={logout}>Logout</button>
        </div>
      </div>
      {tab === "personal" ? <Personal /> : <Business />}
    </div>
  );
}

/* ================= PERSONAL TAB ================= */
function Personal() {
  const [txs, setTxs] = useState([]);
  const [summary, setSummary] = useState({ total: 0, byCategory: [] });
  const [forecast, setForecast] = useState({ nextMonthTotal: 0, byCategory: [] });
  const [anoms, setAnoms] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [subs, setSubs] = useState({ monthlyCost: 0, subscriptions: [] });
  const [trend, setTrend] = useState([]);
  const [safe, setSafe] = useState({ hasBudget: false });
  const [form, setForm] = useState({ amount: "", merchant: "", type: "personal" });
  const [bf, setBf] = useState({ category: "Food", limit: "" });
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState("");
  const [sms, setSms] = useState("");
  const [note, setNote] = useState("");

  const load = async () => {
    const [t, s, f, a, b, u, tr, sf] = await Promise.all([
      json("/transactions"), json("/insights/summary"), json("/insights/forecast"),
      json("/insights/anomalies"), json("/budgets/status"), json("/insights/subscriptions"),
      json("/insights/trend"), json("/insights/safe-to-spend"),
    ]);
    setTxs(t); setSummary(s); setForecast(f); setAnoms(a); setBudgets(b); setSubs(u); setTrend(tr); setSafe(sf);
  };
  useEffect(() => { load(); }, []);

  const addTx = async (e) => {
    e.preventDefault();
    await call("/transactions", { method: "POST",
      body: JSON.stringify({ amount: Number(form.amount), merchant: form.merchant, type: form.type }) });
    setForm({ ...form, amount: "", merchant: "" }); load();
  };
  // "chai 20" / "ચા 20" / "kal zomato 450"
  const quickAdd = async (e) => {
    e.preventDefault();
    const res = await call("/quick-add", { method: "POST", body: JSON.stringify({ text: quick }) });
    const data = await res.json();
    if (!res.ok) return setNote(data.error);
    setNote(`Added ₹${data.amount} at ${data.merchant} as ${data.category}`);
    setQuick(""); load();
  };
  // paste a bank SMS -> fills the manual form
  const readSms = async () => {
    const res = await call("/parse-sms", { method: "POST", body: JSON.stringify({ text: sms }) });
    const data = await res.json();
    if (!res.ok) return setNote(data.error);
    setForm({ ...form, amount: String(data.amount), merchant: data.merchant });
    setNote(data.kind === "credit"
      ? "This looks like money RECEIVED, not an expense. Check before adding."
      : "SMS read. Check the details in the form below and click Add expense.");
    setSms("");
  };
  const fixCategory = async (id, category) => {
    await call(`/transactions/${id}/category`, { method: "PATCH", body: JSON.stringify({ category }) });
    load();
  };
  const remove = async (id) => { await call(`/transactions/${id}`, { method: "DELETE" }); load(); };
  const saveBudget = async (e) => {
    e.preventDefault();
    await call("/budgets", { method: "PUT", body: JSON.stringify({ category: bf.category, limit: Number(bf.limit) }) });
    setBf({ ...bf, limit: "" }); load();
  };
  const seed = async () => {
    const res = await call("/demo/seed", { method: "POST" });
    if (!res.ok) alert((await res.json()).error);
    load();
  };
  const clearAll = async () => {
    if (confirm("Delete ALL your transactions?")) { await call("/demo/clear", { method: "DELETE" }); load(); }
  };
  const exportCsv = async () => {
    const blob = await (await call("/transactions/export")).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "expenses.csv";
    a.click();
  };

  const shown = txs.filter((t) =>
    `${t.merchant} ${t.category} ${t.type}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="ghost" onClick={exportCsv}>⬇ CSV</button>
        <button className="ghost" onClick={seed}>Load demo data</button>
        <button className="ghost" onClick={clearAll}>Clear data</button>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>⚡ Quick add (English, Hindi, Gujarati)</h3>
          <form onSubmit={quickAdd}>
            <input style={{ flex: 1 }} placeholder="chai 20  |  ચા 20  |  kal zomato 450" value={quick}
              onChange={(e) => setQuick(e.target.value)} required />
            <button>Add</button>
          </form>
        </div>
        <div className="card">
          <h3>📩 Paste a bank / UPI SMS</h3>
          <form onSubmit={(e) => { e.preventDefault(); readSms(); }}>
            <input style={{ flex: 1 }} placeholder="Rs.450 debited ... trf to ZOMATO ..." value={sms}
              onChange={(e) => setSms(e.target.value)} required />
            <button>Read SMS</button>
          </form>
        </div>
      </div>
      {note && <div className="note">{note}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={addTx}>
          <input type="number" placeholder="Amount ₹" value={form.amount} required
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input placeholder="Merchant (e.g. Zomato)" value={form.merchant} required
            onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="personal">Personal</option><option value="business">Business</option>
          </select>
          <button>Add expense</button>
        </form>
      </div>

      <div className="grid">
        <div className="card">
          <h3>✅ Safe to spend today</h3>
          {!safe.hasBudget && <p className="muted">Set a budget (Budgets card) to see your daily limit.</p>}
          {safe.hasBudget && (<>
            <div className={`big ${safe.remaining < 0 ? "bad" : "good"}`}>{rs(safe.perDay)} / day</div>
            <p className="muted">{rs(safe.remaining)} left of {rs(safe.limit)} for the next {safe.daysLeft} days</p>
            {safe.remaining < 0 && <div className="alert">You are over your total budget this month.</div>}
          </>)}
        </div>

        <div className="card">
          <h3>This month (personal)</h3>
          <div className="big">₹{summary.total}</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart><Pie data={summary.byCategory} dataKey="value" nameKey="name" outerRadius={80}>
              {summary.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip /></PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>📈 6-month trend</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
              <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
              <Line type="monotone" dataKey="total" stroke="#4f46e5" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>🔮 Next month forecast</h3>
          <div className="big">₹{forecast.nextMonthTotal}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={forecast.byCategory}>
              <XAxis dataKey="category" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
              <Bar dataKey="predicted" fill="#4f46e5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>🚨 Unusual transactions</h3>
          {anoms.length === 0 && <p className="muted">Nothing suspicious 🎉</p>}
          {anoms.map((a) => (
            <div className="alert" key={a._id}>₹{a.amount} at {a.merchant} — {a.anomalyReason}</div>
          ))}
        </div>

        <div className="card">
          <h3>🎯 Budgets</h3>
          <form onSubmit={saveBudget} style={{ marginBottom: 10 }}>
            <select value={bf.category} onChange={(e) => setBf({ ...bf, category: e.target.value })}>
              {CATS.filter((c) => c !== "Business").map((c) => <option key={c}>{c}</option>)}</select>
            <input type="number" placeholder="Limit ₹" value={bf.limit} required
              onChange={(e) => setBf({ ...bf, limit: e.target.value })} style={{ width: 90 }} />
            <button>Set</button>
          </form>
          {budgets.map((b) => (
            <div key={b.category} style={{ marginBottom: 10 }}>
              <small>{b.category}: ₹{b.spent} / ₹{b.limit}</small>
              <div className={`bar ${b.alert ? "over" : ""}`}>
                <div style={{ width: `${Math.min(100, (b.spent / b.limit) * 100)}%` }} /></div>
              {b.alert && <div className="alert">{b.alert}</div>}
            </div>
          ))}
        </div>

        <div className="card">
          <h3>🔁 Subscriptions found</h3>
          <p>Recurring cost: <b>₹{subs.monthlyCost}/month</b></p>
          {subs.subscriptions.map((s, i) => <div key={i}>{s.merchant} — ₹{s.amount}</div>)}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        <div className="top" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Recent transactions</h3>
          <input placeholder="🔍 Search merchant, category or type" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table>
          <thead><tr><th>Merchant</th><th>₹</th><th>Category</th><th>Type</th><th>Source</th><th></th></tr></thead>
          <tbody>{shown.map((t) => (
            <tr key={t._id}>
              <td>{t.merchant}{t.isAnomaly && " ⚠️"}</td><td>{t.amount}</td>
              <td><select value={t.category} onChange={(e) => fixCategory(t._id, e.target.value)}>
                {CATS.map((c) => <option key={c}>{c}</option>)}</select></td>
              <td><span className="tag">{t.type || "personal"}</span></td>
              <td><span className="tag">{t.categorySource}</span></td>
              <td><span className="del" onClick={() => remove(t._id)}>✕</span></td>
            </tr>))}</tbody>
        </table>
      </div>
    </>
  );
}

/* ================= SELLER / BUSINESS TAB ================= */
function Business() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [sum, setSum] = useState({ pending: [], byProduct: [] });
  const [pf, setPf] = useState({ name: "", cost: "", price: "" });
  const [sf, setSf] = useState({ productId: "", qty: 1, customer: "", paid: "" });

  const load = async () => {
    const [p, s, m] = await Promise.all([json("/products"), json("/sales"), json("/business/summary")]);
    setProducts(p); setSales(s); setSum(m);
    setSf((f) => ({ ...f, productId: f.productId || (p[0] ? p[0]._id : "") }));
  };
  useEffect(() => { load(); }, []);

  const addProduct = async (e) => {
    e.preventDefault();
    await call("/products", { method: "POST", body: JSON.stringify(pf) });
    setPf({ name: "", cost: "", price: "" }); load();
  };
  const addSale = async (e) => {
    e.preventDefault();
    const res = await call("/sales", { method: "POST", body: JSON.stringify(sf) });
    if (!res.ok) alert((await res.json()).error);
    setSf({ ...sf, qty: 1, customer: "", paid: "" }); load();
  };
  const receive = async (id) => {
    const amount = prompt("Amount received (₹)");
    if (amount) { await call(`/sales/${id}/pay`, { method: "POST", body: JSON.stringify({ amount: Number(amount) }) }); load(); }
  };
  const delSale = async (id) => { await call(`/sales/${id}`, { method: "DELETE" }); load(); };
  const delProduct = async (id) => { await call(`/products/${id}`, { method: "DELETE" }); load(); };
  const seed = async () => {
    const res = await call("/demo/seed-business", { method: "POST" });
    if (!res.ok) alert((await res.json()).error);
    load();
  };

  const stats = [["Revenue", rs(sum.revenue), ""], ["Gross profit", rs(sum.grossProfit), `${sum.margin || 0}% margin`],
    ["Business expenses", rs(sum.expenses), ""], ["Net profit", rs(sum.netProfit), sum.netProfit < 0 ? "bad" : "good"],
    ["Pending from customers", rs(sum.pendingTotal), sum.pendingTotal > 0 ? "bad" : ""]];

  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="ghost" onClick={seed}>Load seller demo data</button>
        <span className="muted">Business expenses: add them in the Personal tab with type "Business".</span>
      </div>

      <div className="stats">
        {stats.map(([label, value, cls]) => (
          <div className="card stat" key={label}>
            <small>{label}</small>
            <div className={`big ${["good", "bad"].includes(cls) ? cls : ""}`}>{value}</div>
            {cls && !["good", "bad"].includes(cls) && <small>{cls}</small>}
          </div>
        ))}
      </div>

      <div className="grid">
        <div className="card">
          <h3>📦 Add a product</h3>
          <form onSubmit={addProduct}>
            <input placeholder="Name (e.g. Necklace)" value={pf.name} required style={{ flex: 1 }}
              onChange={(e) => setPf({ ...pf, name: e.target.value })} />
            <input type="number" placeholder="Cost ₹" value={pf.cost} required style={{ width: 90 }}
              onChange={(e) => setPf({ ...pf, cost: e.target.value })} />
            <input type="number" placeholder="Price ₹" value={pf.price} required style={{ width: 90 }}
              onChange={(e) => setPf({ ...pf, price: e.target.value })} />
            <button>Add</button>
          </form>
          <table style={{ marginTop: 10 }}>
            <tbody>{products.map((p) => (
              <tr key={p._id}><td>{p.name}</td><td>cost {rs(p.cost)}</td><td>price {rs(p.price)}</td>
                <td className="good">+{rs(p.price - p.cost)}</td>
                <td><span className="del" onClick={() => delProduct(p._id)}>✕</span></td></tr>))}</tbody>
          </table>
        </div>

        <div className="card">
          <h3>🧾 Record a sale</h3>
          {products.length === 0 ? <p className="muted">Add a product first.</p> : (
            <form onSubmit={addSale}>
              <select value={sf.productId} onChange={(e) => setSf({ ...sf, productId: e.target.value })}>
                {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
              <input type="number" min="1" value={sf.qty} style={{ width: 70 }}
                onChange={(e) => setSf({ ...sf, qty: e.target.value })} />
              <input placeholder="Customer" value={sf.customer} style={{ width: 120 }}
                onChange={(e) => setSf({ ...sf, customer: e.target.value })} />
              <input type="number" placeholder="Paid ₹ (blank = full)" value={sf.paid} style={{ width: 150 }}
                onChange={(e) => setSf({ ...sf, paid: e.target.value })} />
              <button>Save sale</button>
            </form>
          )}
        </div>

        <div className="card">
          <h3>💰 Customers who owe you</h3>
          {sum.pending.length === 0 && <p className="muted">Nobody owes you anything 🎉</p>}
          {sum.pending.map((p) => (
            <div className="alert" key={p.customer}>{p.customer}: {rs(p.amount)}</div>))}
        </div>

        <div className="card">
          <h3>🏆 Profit by product (this month)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sum.byProduct}>
              <XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
              <Bar dataKey="profit" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
        <h3>Recent sales</h3>
        <table>
          <thead><tr><th>Product</th><th>Qty</th><th>Customer</th><th>Total</th><th>Paid</th><th>Pending</th><th></th></tr></thead>
          <tbody>{sales.map((s) => {
            const total = s.qty * s.unitPrice, pending = total - s.paid;
            return (
              <tr key={s._id}>
                <td>{s.productName}</td><td>{s.qty}</td><td>{s.customer || "-"}</td>
                <td>{rs(total)}</td><td>{rs(s.paid)}</td>
                <td className={pending > 0 ? "bad" : ""}>{rs(pending)}</td>
                <td>{pending > 0 && <button className="ghost" onClick={() => receive(s._id)}>Receive</button>}{" "}
                  <span className="del" onClick={() => delSale(s._id)}>✕</span></td>
              </tr>);
          })}</tbody>
        </table>
      </div>
    </>
  );
}