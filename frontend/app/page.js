'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown,
  CircleHelp, Clock3, Download, FileText, Filter, LayoutDashboard, LogOut,
  Menu, Plus, Search, Settings, Shield, ShieldAlert, Sparkles, Users, X,
} from 'lucide-react';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const riskClass = (risk) => risk === 'high_risk' ? 'high' : risk === 'medium_risk' ? 'medium' : 'low';

async function downloadTransactionReport(rows, vendorName) {
  const { downloadTransactionReport: download } = await import('../lib/transaction-report.mjs');
  download(rows, vendorName);
}

async function loadAllTransactions(token) {
  const rows = [];
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await request(`/transactions?${query.toString()}`, token);
    rows.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

async function downloadEvidence(url, token, transactionId) {
  const response = await fetch(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Could not retrieve this transaction evidence.');
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `payment-evidence-${transactionId.slice(0, 8)}`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function request(path, token, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options.body && !(typeof FormData !== 'undefined' && options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Can't reach the API at ${API}. Start the backend and database, then try again.`);
    }
    throw error;
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message || json.message || 'Request failed. Please try again.');
  return json;
}

function Logo() { return <div className="brand"><span className="brand-mark"><Shield size={17} strokeWidth={2.4} /></span><span>ledgerly<span className="brand-dot">.</span></span></div>; }

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [fields, setFields] = useState({ name: '', identifier: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const payload = mode === 'login'
        ? { identifier: fields.identifier, password: fields.password }
        : { name: fields.name, email: fields.email, phone: fields.phone || undefined, password: fields.password };
      const result = await request(`/auth/${mode === 'login' ? 'login' : 'register'}`, null, { method: 'POST', body: JSON.stringify(payload) });
      onAuth(result.data);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <div className="auth-left"><Logo /><div className="auth-hero"><div className="eyebrow light"><span className="pulse" /> TRUST, AT A GLANCE</div><h1>Good business<br />starts with <em>good trust.</em></h1><p>One calm place to track every payment, spot what feels off, and know your customers better.</p><div className="auth-proof"><div className="proof-icon"><Shield size={19} /></div><span><b>Your business, protected.</b><small>Private by design. Built for the way you work.</small></span></div></div><div className="auth-footer">MADE FOR INDEPENDENT BUSINESSES <span>© 2026 Ledgerly</span></div></div>
    <div className="auth-right"><div className="auth-card"><div className="auth-card-head"><div className="eyebrow">WELCOME TO LEDGERLY</div><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{mode === 'login' ? 'Sign in to see how your business is doing.' : 'Start with your business details.'}</p></div>
      <form onSubmit={submit} className="form-stack">{mode === 'register' && <><label>Business name<input required maxLength="160" placeholder="e.g. Sunday Market" value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} /></label><label>Email address<input required type="email" placeholder="you@business.com" value={fields.email} onChange={(e) => setFields({ ...fields, email: e.target.value })} /></label><label>Phone <span className="optional">OPTIONAL</span><input type="tel" placeholder="+91 98765 43210" value={fields.phone} onChange={(e) => setFields({ ...fields, phone: e.target.value })} /></label></>}
        {mode === 'login' && <label>Email or phone<input required autoComplete="username" placeholder="you@business.com" value={fields.identifier} onChange={(e) => setFields({ ...fields, identifier: e.target.value })} /> </label>}
        <label>Password<input required type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} placeholder={mode === 'login' ? 'Enter your password' : 'At least 12 characters'} value={fields.password} onChange={(e) => setFields({ ...fields, password: e.target.value })} /></label>
        {error && <div className="inline-error">{error}</div>}<button className="btn btn-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button>
      </form><div className="auth-switch">{mode === 'login' ? 'New to Ledgerly?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div><div className="auth-secure"><Shield size={14} /> Your information stays private and secure</div></div></div>
  </main>;
}

function AppShell({ auth, onLogout }) {
  const [page, setPage] = useState('Overview');
  const [transactions, setTransactions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [notificationSettings, setNotificationSettings] = useState(null);
  const [billing, setBilling] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [form, setForm] = useState({ utr: '', amount: '', expected_amount: '', date: new Date().toISOString().slice(0, 16), customer_id: '', evidence: null, name: '', phone: '', email: '' });

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [tx, al, cu, notifications, billingStatus] = await Promise.all([
        request('/transactions?limit=100', auth.accessToken),
        request('/alerts?limit=100', auth.accessToken),
        request('/customers?limit=100', auth.accessToken),
        request('/notification-settings', auth.accessToken),
        request('/billing', auth.accessToken),
      ]);
      setTransactions(tx.data || []); setAlerts(al.data || []); setCustomers(cu.data || []);
      setNotificationSettings(notifications.data); setBilling(billingStatus.data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [auth.accessToken]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  const pendingAlerts = alerts.filter((item) => !item.reviewedAt);
  const stats = useMemo(() => {
    const paid = transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const flagged = transactions.filter((item) => item.status !== 'valid').length;
    const averageTrust = customers.length ? Math.round(customers.reduce((sum, item) => sum + item.reputationScore, 0) / customers.length) : 100;
    return { paid, flagged, averageTrust };
  }, [transactions, customers]);
  const recentTransactions = transactions.filter((item) => {
    const matches = `${item.utr} ${item.status} ${item.riskLevel}`.toLowerCase().includes(query.toLowerCase());
    return matches && (filter === 'all' || (filter === 'flagged' ? item.status !== 'valid' : item.status === 'valid'));
  });
  const showPage = (next) => { setPage(next); setSidebarOpen(false); setQuery(''); };
  const exportTransactions = async () => {
    try {
      const all = await loadAllTransactions(auth.accessToken);
      const filtered = all.filter((item) => {
        const matches = `${item.utr} ${item.status} ${item.riskLevel}`.toLowerCase().includes(query.toLowerCase());
        return matches && (filter === 'all' || (filter === 'flagged' ? item.status !== 'valid' : item.status === 'valid'));
      });
      await downloadTransactionReport(filtered, auth.vendor.name);
    } catch (err) { setError(err.message); }
  };
  const submitTransaction = async (event) => {
    event.preventDefault(); setError('');
    try {
      const payload = form.evidence ? new FormData() : { utr: form.utr, amount: form.amount, date: new Date(form.date).toISOString() };
      if (form.evidence) { payload.append('utr', form.utr); payload.append('amount', form.amount); payload.append('date', new Date(form.date).toISOString()); payload.append('evidence', form.evidence); }
      if (form.expected_amount) form.evidence ? payload.append('expected_amount', form.expected_amount) : payload.expected_amount = form.expected_amount;
      if (form.customer_id) form.evidence ? payload.append('customer_id', form.customer_id) : payload.customer_id = form.customer_id;
      const result = await request('/transaction/validate', auth.accessToken, { method: 'POST', body: form.evidence ? payload : JSON.stringify(payload) });
      setModal(''); setForm({ ...form, utr: '', amount: '', expected_amount: '', customer_id: '', evidence: null });
      setNotice(result.data?.validation?.isDuplicate ? 'Duplicate UTR saved and flagged for review.' : 'Transaction added and scored.'); await refresh(true);
    } catch (err) { setError(err.message); }
  };
  const submitCustomer = async (event) => {
    event.preventDefault(); setError('');
    try { await request('/customers', auth.accessToken, { method: 'POST', body: JSON.stringify({ name: form.name, phone: form.phone || undefined, email: form.email || undefined }) }); setModal(''); setForm({ ...form, name: '', phone: '', email: '' }); setNotice('Customer added.'); await refresh(true); }
    catch (err) { setError(err.message); }
  };
  const acknowledge = async (id) => {
    try { await request(`/alerts/${id}/acknowledge`, auth.accessToken, { method: 'POST' }); setNotice('Alert marked as reviewed.'); await refresh(true); }
    catch (err) { setError(err.message); }
  };

  const requestPhoneOtp = async (event) => {
    event.preventDefault(); setError('');
    try { const result = await request('/auth/phone-otp/request', auth.accessToken, { method: 'POST', body: JSON.stringify({ phone: phoneNumber }) }); setOtpChallengeId(result.data.challengeId); setNotice(`Verification code requested using ${result.data.provider} mode.`); }
    catch (err) { setError(err.message); }
  };
  const verifyPhoneOtp = async (event) => {
    event.preventDefault(); setError('');
    try { await request('/auth/phone-otp/verify', auth.accessToken, { method: 'POST', body: JSON.stringify({ challenge_id: otpChallengeId, code: otpCode }) }); setOtpChallengeId(''); setOtpCode(''); setNotice('Phone number verified.'); await refresh(true); }
    catch (err) { setError(err.message); }
  };
  const setWhatsAppConsent = async (enabled) => {
    setError('');
    try { await request('/notification-settings', auth.accessToken, { method: 'PATCH', body: JSON.stringify({ whatsapp_alerts_enabled: enabled }) }); setNotice(enabled ? 'WhatsApp alert consent enabled.' : 'WhatsApp alert consent withdrawn.'); await refresh(true); }
    catch (err) { setError(err.message); }
  };
  const choosePlan = async (plan) => {
    setError('');
    try { const result = await request('/billing/subscription', auth.accessToken, { method: 'POST', body: JSON.stringify({ plan }) }); if (result.data.checkoutUrl) window.location.assign(result.data.checkoutUrl); else { setNotice('Local mock subscription created. It has no paid access until you simulate verified provider activation.'); await refresh(true); } }
    catch (err) { setError(err.message); }
  };
  const simulatePlanActivation = async () => {
    try { await request('/billing/dev/simulate-subscription-activation', auth.accessToken, { method: 'POST' }); setNotice('Mock signed activation event processed.'); await refresh(true); }
    catch (err) { setError(err.message); }
  };
  const cancelPlan = async () => {
    try { await request('/billing/subscription/cancel', auth.accessToken, { method: 'POST' }); setNotice('Cancellation requested at the end of the billing period.'); await refresh(true); }
    catch (err) { setError(err.message); }
  };

  const navGroups = [
    { label: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Transactions', icon: Activity, count: transactions.length }, { name: 'Alerts', icon: Bell, count: pendingAlerts.length, alert: true }] },
    { label: 'RELATIONSHIPS', items: [{ name: 'Customers', icon: Users, count: customers.length }] },
    { label: 'ACCOUNT', items: [{ name: 'Settings', icon: Settings }] },
  ];
  return <div className="app-frame">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}><div className="side-brand"><Logo /><button className="icon-btn mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><X size={18} /></button></div><div className="workspace-switch"><div className="workspace-avatar">{auth.vendor.name.slice(0, 1).toUpperCase()}</div><div><b>{auth.vendor.name}</b><small>MY BUSINESS</small></div><ChevronDown size={15} /></div>
      <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(({ name, icon: Icon, count, alert }) => <button key={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => showPage(name)}><Icon size={17} /><span>{name}</span>{count > 0 && <span className={`nav-count ${alert ? 'nav-alert' : ''}`}>{alert && count > 9 ? '9+' : count}</span>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={17} /></div><b>Need a hand?</b><p>We’re here to help you stay on top of things.</p><button onClick={() => setNotice('Help center will be available soon.')}>Visit help center <ArrowRight size={14} /></button></div><button className="profile-button"><div className="profile-avatar">{auth.vendor.name.slice(0, 1).toUpperCase()}</div><div className="profile-info"><b>{auth.vendor.name}</b><small>{auth.vendor.email}</small></div><button className="logout-icon" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></button></div>
    </aside>
    {sidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
    <main className="main-panel"><header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={19} /></button><span className="breadcrumb">Pages</span><span className="crumb-slash">/</span><b>{page}</b></div><div className="topbar-right"><div className="topbar-date">{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div><button className="topbar-bell" onClick={() => showPage('Alerts')} aria-label={`${pendingAlerts.length} pending alerts`}><Bell size={18} />{pendingAlerts.length > 0 && <i />}</button><div className="topbar-avatar">{auth.vendor.name.slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content-wrap"><div className="page-heading"><div><div className="eyebrow">{page === 'Overview' ? 'YOUR BUSINESS AT A GLANCE' : 'BUSINESS MANAGEMENT'}</div><h1>{page === 'Overview' ? <>Good morning, {auth.vendor.name.split(' ')[0]} <span className="wave">✳</span></> : page}</h1><p>{page === 'Overview' ? 'Here’s what’s happening with your business today.' : page === 'Transactions' ? 'Every payment, together in one clear view.' : page === 'Alerts' ? 'A closer look at anything that needs your attention.' : 'The people who make your business what it is.'}</p></div><div className="heading-actions">{page === 'Transactions' && <button className="btn btn-primary" onClick={() => { setError(''); setModal('transaction'); }}><Plus size={16} /> Add transaction</button>}{page === 'Customers' && <button className="btn btn-primary" onClick={() => { setError(''); setModal('customer'); }}><Plus size={16} /> Add customer</button>}{page === 'Overview' && <button className="btn btn-primary" onClick={() => { setError(''); setModal('transaction'); }}><Plus size={16} /> Add transaction</button>}</div></div>
        {error && <div className="notice notice-error"><ShieldAlert size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}
        {notice && <div className="notice notice-success"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={15} /></button></div>}
        {loading && <div className="loading-line"><span /> Syncing your business data…</div>}
        {page === 'Overview' && <>
          <div className="welcome-card"><div className="welcome-copy"><div className="welcome-tag"><Sparkles size={13} /> YOUR DAILY SNAPSHOT</div><h2>A clearer picture.<br /><em>A little more peace of mind.</em></h2><p>Every payment tells a story. We’ll help you notice what matters.</p><button className="welcome-link" onClick={() => showPage('Transactions')}>Explore your transactions <ArrowRight size={15} /></button></div><div className="welcome-illustration"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-shield"><Shield size={55} strokeWidth={1.35} /></div><div className="float-card float-card-top"><span className="mini-dot green" /> All systems clear</div><div className="float-card float-card-bottom"><span className="float-icon"><Activity size={15} /></span><span><b>{transactions.length} payments</b><small>in your ledger</small></span></div></div></div>
          <section className="metrics-grid"><Metric title="TOTAL PAYMENTS" value={money(stats.paid)} icon={<ArrowDownLeft size={17} />} tone="mint" caption={`${transactions.length} transactions recorded`} /><Metric title="NEEDS A LOOK" value={String(stats.flagged).padStart(2, '0')} icon={<ShieldAlert size={17} />} tone="peach" caption={`${pendingAlerts.length} alerts still open`} /><Metric title="CUSTOMERS" value={String(customers.length).padStart(2, '0')} icon={<Users size={17} />} tone="lavender" caption={`Average trust score ${stats.averageTrust}`} /><Metric title="YOUR TRUST SCORE" value={`${stats.averageTrust}`} suffix="/ 100" icon={<Shield size={17} />} tone="sky" caption="Based on your customer base" /> </section>
          <div className="dashboard-grid"><section className="panel transactions-panel"><div className="panel-heading"><div><h3>Recent transactions</h3><p>Your latest activity, all in one place.</p></div><button className="text-button" onClick={() => showPage('Transactions')}>View all <ArrowRight size={14} /></button></div><TransactionTable rows={transactions.slice(0, 5)} empty={loading ? 'Loading activity…' : 'Your first transaction will show up here.'} /></section>
            <section className="panel alerts-panel"><div className="panel-heading"><div><h3>Needs a look</h3><p>A few things to keep in mind.</p></div><span className="count-pill">{pendingAlerts.length} open</span></div>{pendingAlerts.length === 0 ? <div className="empty-alert"><div className="empty-check"><Check size={20} /></div><b>All caught up</b><p>No open alerts to review.</p></div> : <div className="mini-alert-list">{pendingAlerts.slice(0, 4).map((alert) => <AlertRow key={alert.id} alert={alert} onAcknowledge={acknowledge} compact />)}<button className="text-button see-alerts" onClick={() => showPage('Alerts')}>See all alerts <ArrowRight size={14} /></button></div>}</section></div>
        </>}
        {page === 'Transactions' && <section className="panel full-panel"><div className="list-toolbar"><div className="search-box"><Search size={16} /><input placeholder="Search by UTR or status" value={query} onChange={(e) => setQuery(e.target.value)} /></div><div className="toolbar-actions"><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter transactions"><option value="all">All transactions</option><option value="flagged">Flagged</option><option value="valid">Clear</option></select><button className="btn btn-soft" onClick={exportTransactions}><FileText size={15} /> Download report PDF</button></div></div><TransactionTable rows={recentTransactions} detailed empty={loading ? 'Loading transactions…' : 'No transactions match this view.'} token={auth.accessToken} onEvidenceError={setError} /></section>}
        {page === 'Alerts' && <section className="panel full-panel"><div className="panel-heading alerts-heading"><div><h3>Review queue</h3><p>{pendingAlerts.length} open alert{pendingAlerts.length === 1 ? '' : 's'} across your transactions</p></div><button className="btn btn-soft" onClick={() => setFilter(filter === 'all' ? 'open' : 'all')}><Filter size={15} /> {filter === 'all' ? 'All alerts' : 'Open alerts'}</button></div><div className="alert-table">{(filter === 'open' ? pendingAlerts : alerts).length === 0 ? <div className="empty-state"><div className="empty-check"><Check size={20} /></div><b>You’re all caught up</b><p>New alerts will appear here when a transaction needs a closer look.</p></div> : (filter === 'open' ? pendingAlerts : alerts).map((alert) => <AlertRow key={alert.id} alert={alert} onAcknowledge={acknowledge} />)}</div></section>}
        {page === 'Customers' && <section className="panel full-panel"><div className="list-toolbar"><div className="search-box"><Search size={16} /><input placeholder="Search customers" value={query} onChange={(e) => setQuery(e.target.value)} /></div><span className="toolbar-total">{customers.filter((c) => `${c.name} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(query.toLowerCase())).length} customers</span></div><div className="customer-grid">{customers.filter((c) => `${c.name} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(query.toLowerCase())).map((customer, i) => <CustomerCard key={customer.id} customer={customer} index={i} />)}{!loading && customers.length === 0 && <div className="empty-state"><div className="empty-check"><Users size={19} /></div><b>Your customer list starts here</b><p>Add a customer when you record a payment.</p></div>}</div></section>}
        {page === 'Settings' && <div className="dashboard-grid">
          <section className="panel full-panel"><div className="panel-heading"><div><h3>Phone verification</h3><p>Verify your business phone before enabling WhatsApp alerts.</p></div><span className="count-pill">{notificationSettings?.phoneVerified ? 'Verified' : 'Not verified'}</span></div>
            {notificationSettings?.phoneVerified ? <p className="form-note">Verified phone: {notificationSettings.phone}</p> : <form className="form-stack" onSubmit={otpChallengeId ? verifyPhoneOtp : requestPhoneOtp}><label>Business phone in international format<input type="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} /></label>{otpChallengeId && <label>Verification code<input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{4,8}" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} /></label>}<button className="btn btn-primary" type="submit">{otpChallengeId ? 'Verify code' : 'Send code'}</button>{notificationSettings?.provider === 'mock' && <p className="form-note">Development mock code: 123456. Mock mode is unavailable in production.</p>}</form>}
          </section>
          <section className="panel full-panel"><div className="panel-heading"><div><h3>WhatsApp alerts</h3><p>Receive high-risk alert notices on your verified business number.</p></div></div><p className="form-note">Messages are sent only after phone verification and your explicit opt-in. Provider mode: {notificationSettings?.provider || 'loading'}.</p><button className="btn btn-soft" disabled={!notificationSettings?.phoneVerified} onClick={() => setWhatsAppConsent(!notificationSettings?.whatsappAlertsEnabled)}>{notificationSettings?.whatsappAlertsEnabled ? 'Turn WhatsApp alerts off' : 'Opt in to WhatsApp alerts'}</button></section>
          <section className="panel full-panel"><div className="panel-heading"><div><h3>Plan and billing</h3><p>Payment notifications from Razorpay control paid access; browser callbacks do not.</p></div><span className="count-pill">{billing?.subscription?.planCode || 'free'} · {billing?.subscription?.status || 'loading'}</span></div><p className="form-note">Current limit: {billing?.transactionLimit ?? 100} transactions per month. Payment references entered in the ledger remain unverified unless a payment-provider integration explicitly confirms them.</p><div className="toolbar-actions">{(billing?.plans || []).map((plan) => <button className="btn btn-soft" key={plan.code} onClick={() => choosePlan(plan.code)}>{plan.name} · ₹{plan.monthlyPriceInr}/mo</button>)}</div>{billing?.subscription?.status === 'created' && billing?.providerMode === 'mock' && <button className="btn btn-primary" onClick={simulatePlanActivation}>Simulate signed provider activation</button>}{billing?.subscription?.status === 'active' && <button className="btn btn-soft" onClick={cancelPlan}>Cancel at period end</button>}</section>
        </div>}
        <footer className="page-footer"><span>© 2026 Ledgerly</span><span><Shield size={13} /> Private by design</span></footer>
      </div>
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(''); }}><section className="modal-card"><div className="modal-head"><div><div className="eyebrow">{modal === 'transaction' ? 'RECORD A PAYMENT' : 'GROW YOUR RELATIONSHIPS'}</div><h2>{modal === 'transaction' ? 'Add a transaction' : 'Add a customer'}</h2></div><button className="icon-btn" onClick={() => setModal('')} aria-label="Close"><X size={18} /></button></div>
      {modal === 'transaction' ? <form className="form-stack" onSubmit={submitTransaction}><label>UTR / reference number<input required minLength="12" maxLength="22" pattern="[A-Za-z0-9]+" placeholder="12–22 letters or numbers" value={form.utr} onChange={(e) => setForm({ ...form, utr: e.target.value })} /></label><div className="form-row"><label>Amount paid<input required type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label><label>Expected amount <span className="optional">OPTIONAL</span><input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} /></label></div><label>Date and time<input required type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>Customer <span className="optional">OPTIONAL</span><select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}><option value="">Unlinked transaction</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>Payment screenshot <span className="optional">OPTIONAL · MAX 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setForm({ ...form, evidence: e.target.files?.[0] || null })} /></label><p className="form-note"><Shield size={14} /> Fraud checks apply to configured rules; screenshot metadata is extracted on the server when available.</p><button className="btn btn-primary auth-submit"><Plus size={16} /> Save & review</button></form> : <form className="form-stack" onSubmit={submitCustomer}><label>Customer name<input required maxLength="160" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Phone number <span className="optional">OPTIONAL</span><input type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label><label>Email address <span className="optional">OPTIONAL</span><input type="email" placeholder="customer@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><button className="btn btn-primary auth-submit"><Plus size={16} /> Add customer</button></form>}</section></div>}
  </div>;
}

function Metric({ title, value, suffix, icon, tone, caption }) { return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}<small>{suffix}</small></div><div className="metric-caption">{caption}</div></article>; }

function TransactionTable({ rows, detailed = false, empty, token, onEvidenceError }) {
  return <div className="table-scroll"><table><thead><tr><th>REFERENCE</th><th>AMOUNT</th><th>DATE</th><th>RISK</th><th>RISK REVIEW</th>{detailed && <><th>PAYMENT STATUS</th><th>ALERTS</th><th>EVIDENCE</th></>}</tr></thead><tbody>{rows.length ? rows.map((item) => <tr key={item.id}><td><div className="ref-cell"><span className={`pay-icon ${item.status === 'valid' ? 'pay-ok' : 'pay-warn'}`}>{item.status === 'valid' ? <ArrowDownLeft size={15} /> : <ShieldAlert size={15} />}</span><span><b>{item.utr}</b><small>#{item.id.slice(0, 8)}</small></span></div></td><td className="amount-cell">{money(item.amount)}</td><td>{dateTime(item.occurredAt)}</td><td><span className={`risk-label ${riskClass(item.riskLevel)}`}><i />{item.riskLevel?.replace('_risk', '') || 'low'}</span></td><td><span className={`status-pill ${item.status === 'valid' ? 'status-clear' : 'status-review'}`}>{item.status === 'valid' ? 'Clear' : 'Review'}</span></td>{detailed && <><td>{item.paymentVerificationStatus || 'unverified'}</td><td>{item.alerts?.length || 0}</td><td>{item.evidenceUrl ? <button className="text-button" onClick={() => downloadEvidence(item.evidenceUrl, token, item.id).catch((err) => onEvidenceError?.(err.message))}>Download image</button> : '—'}</td></>}</tr>) : <tr><td colSpan={detailed ? 8 : 5} className="empty-row">{empty}</td></tr>}</tbody></table></div>;
}

function AlertRow({ alert, onAcknowledge, compact = false }) {
  const risk = riskClass(alert.score >= 60 ? 'high_risk' : alert.score > 30 ? 'medium_risk' : 'low_risk');
  return <article className={`alert-row ${compact ? 'compact-alert' : ''}`}><div className={`alert-symbol ${risk}`}><ShieldAlert size={17} /></div><div className="alert-copy"><div className="alert-title"><b>{alert.alertType.replaceAll('_', ' ')}</b>{alert.reviewedAt && <span className="reviewed-tag"><Check size={12} /> Reviewed</span>}</div><p>{alert.description}</p><div className="alert-meta"><span><Clock3 size={12} /> {dateTime(alert.createdAt)}</span>{alert.transaction?.utr && <span>UTR {alert.transaction.utr}</span>}</div></div><div className="alert-score">+{alert.score}<small>risk</small></div>{!alert.reviewedAt && <button className="review-button" onClick={() => onAcknowledge(alert.id)} title="Mark reviewed" aria-label="Mark alert reviewed"><Check size={16} /></button>}</article>;
}

function CustomerCard({ customer, index }) {
  const colors = ['lavender', 'mint', 'peach', 'sky'];
  return <article className="customer-card"><div className="customer-card-top"><div className={`customer-avatar ${colors[index % colors.length]}`}>{customer.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</div><span className={`trust-pill ${customer.reputationScore >= 75 ? 'trust-good' : customer.reputationScore >= 45 ? 'trust-mid' : 'trust-low'}`}><Shield size={12} /> {customer.reputationScore} trust</span></div><h3>{customer.name}</h3><div className="customer-contact">{customer.phone || 'No phone added'}<br />{customer.email || 'No email added'}</div><div className="customer-card-bottom"><span>{customer.flaggedCount} flagged {customer.flaggedCount === 1 ? 'payment' : 'payments'}</span><span className="customer-sparkline"><i /><i /><i /><i /><i /></span></div></article>;
}

export default function Home() {
  const [auth, setAuth] = useState(null);
  useEffect(() => { try { const saved = localStorage.getItem('ledgerly-session'); if (saved) { const parsed = JSON.parse(saved); if (parsed.expiry > Date.now()) setAuth(parsed); else localStorage.removeItem('ledgerly-session'); } } catch { localStorage.removeItem('ledgerly-session'); } }, []);
  const login = (data) => { const session = { ...data, expiry: Date.now() + (data.expiresIn || 900) * 1000 }; localStorage.setItem('ledgerly-session', JSON.stringify(session)); setAuth(session); };
  const logout = () => { localStorage.removeItem('ledgerly-session'); setAuth(null); };
  return auth ? <AppShell auth={auth} onLogout={logout} /> : <AuthScreen onAuth={login} />;
}
