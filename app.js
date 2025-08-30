/* ========= Supabase ========= */
const CFG = window.CD_CONFIG || {};
const SB  = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ========= State ========= */
let session = null;
let profile = null;
let centers = [];
let items   = [];
let cacheWH = [];
let cacheCenters = [];

/* ========= Helpers ========= */
const qs  = (s, r=document)=>r.querySelector(s);
const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));
const show = (el, vis)=>{ if(!el) return; el.style.display = vis? '' : 'none'; };
const fmt = n => (n??0).toLocaleString('ar');
const roleLabel = r => ({admin:'مدير', storekeeper:'أمين مستودع', center_user:'مدير مركز', auditor:'مدقق'})[r] || r || 'غير محدد';

function findCenterName(id){
  if(!id) return 'غير محدد';
  const c = centers.find(x=>x.id===id);
  return c?.name || 'غير محدد';
}

/* ========= Boot ========= */
document.addEventListener('DOMContentLoaded', init);

async function init(){
  // auth buttons
  qs('#btn-login')?.addEventListener('click', login);
  qs('#btn-signup')?.addEventListener('click', signup);
  qs('#btn-logout')?.addEventListener('click', logout);

  // tabs
  qsa('[data-tab]').forEach(b=> b.addEventListener('click', ()=> activateTab(b.dataset.tab)));

  SB.auth.onAuthStateChange((_e, s)=>{ session = s?.session || null; route(); });
  const cur = await SB.auth.getSession();
  session = cur?.data?.session || null;
  route();
}

/* ========= Auth ========= */
async function login(){
  const email = qs('#login-email').value.trim();
  const password = qs('#login-password').value;
  const msg = qs('#login-msg'); msg.textContent='';
  const { error } = await SB.auth.signInWithPassword({ email, password });
  if(error){ msg.textContent='خطأ في الدخول'; return; }
  const cur = await SB.auth.getSession(); session = cur?.data?.session || null;
  msg.textContent='تم تسجيل الدخول'; route();
}

async function signup(){
  const email = qs('#login-email').value.trim();
  const password = qs('#login-password').value;
  const msg = qs('#login-msg'); msg.textContent='';
  const { error } = await SB.auth.signUp({ email, password });
  msg.textContent = error ? 'تعذر إنشاء المستخدم' : 'تم إنشاء الحساب، تحقق من البريد إن لزم.';
}

async function logout(){ await SB.auth.signOut(); session=null; profile=null; route(); }

/* ========= Router ========= */
async function route(){
  if(!session){
    const cur = await SB.auth.getSession();
    session = cur?.data?.session || null;
  }
  if(!session || !session.user){
    show(qs('#auth-screen'), true);
    show(qs('#app-header'), false);
    show(qs('#app-main'), false);
    return;
  }

  show(qs('#auth-screen'), false);
  show(qs('#app-header'), true);
  show(qs('#app-main'), true);

  qs('#whoami') && (qs('#whoami').textContent = session?.user?.email || '');

  // load profile
  const { data: prof, error: profErr } = await SB
    .from('profiles')
    .select('full_name, role, default_center_id')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if(profErr) console.error('profiles error', profErr);
  profile = prof || null;

  await loadLookups();   // centers, items
  renderProfileCard();   // حالة المستخدم
  await loadBalances();  // warehouse + centers
  activateTab('dashboard');
}

/* ========= Profile Card ========= */
function renderProfileCard(){
  // نصوص افتراضية عربية
  const nameText   = profile?.full_name || 'غير معروف';
  const roleText   = roleLabel(profile?.role);
  const centerText = findCenterName(profile?.default_center_id);

  qs('#profile-name')   && (qs('#profile-name').textContent   = nameText);
  qs('#profile-role')   && (qs('#profile-role').textContent   = roleText);
  qs('#profile-center') && (qs('#profile-center').textContent = centerText);
}

/* ========= Lookups ========= */
async function loadLookups(){
  const { data: c, error: cErr }  = await SB.from('centers').select('id,name').order('id');
  if(cErr) console.error('centers error', cErr);
  centers = c || [];

  const { data: it, error: itErr } = await SB.from('items').select('id,name').order('id');
  if(itErr) console.error('items error', itErr);
  items = it || [];

  const cf = qs('#center-filter');
  if (cf){
    cf.innerHTML = '<option value="">كل المراكز</option>' +
      centers.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
    if (profile?.role==='center_user' && profile?.default_center_id) cf.value = String(profile.default_center_id);
    if (!cf._bound){ cf._bound=true; cf.onchange = repaintCenters; }
  }
}

/* ========= Balances ========= */
async function loadBalances(){
  // warehouse view
  const { data: wh, error: whErr } = await SB.from('v_warehouse_by_item').select('*');
  if(whErr) console.error('warehouse view error', whErr);
  cacheWH = wh || [];
  renderWarehouse(cacheWH);

  // centers view
  let q = SB.from('v_centers_stock').select('*');
  if (profile?.role==='center_user' && profile?.default_center_id){
    q = q.eq('center_id', profile.default_center_id);
  }
  const { data: cs, error: csErr } = await q;
  if(csErr) console.error('centers view error', csErr);
  cacheCenters = cs || [];
  repaintCenters();

  // quick stats
  const totalItems = cacheWH.length;
  const totalWh = cacheWH.reduce((s,r)=> s + (r.balance||0), 0);
  qs('#quick-stats') && (qs('#quick-stats').innerHTML =
    `عدد الأصناف: <b>${fmt(totalItems)}</b> — إجمالي رصيد المستودع: <b>${fmt(totalWh)}</b>`);
}

/* ========= Renderers ========= */
function renderWarehouse(rows){
  const tb = qs('#tbl-warehouse tbody'); if(!tb) return;
  tb.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.item_name}</td>
      <td>${fmt(r.balance)}</td>
      <td>${fmt(r.empty_returns)}</td>
      <td>${fmt(r.expired_returns)}</td>`;
    tb.appendChild(tr);
  });
}

function repaintCenters(){
  const tb = qs('#tbl-centers tbody'); if(!tb) return;
  const cf = qs('#center-filter');
  const val = cf?.value || '';
  const rows = val ? cacheCenters.filter(x=>String(x.center_id)===val) : cacheCenters;

  tb.innerHTML = '';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.center_name}</td>
      <td>${r.item_name}</td>
      <td>${fmt(r.balance)}</td>`;
    tb.appendChild(tr);
  });

  const btnPrint = qs('#btn-print-centers');
  if(btnPrint && !btnPrint._bound){
    btnPrint._bound = true;
    btnPrint.onclick = ()=> window.print();
  }
}

/* ========= Tabs ========= */
function activateTab(id){
  qsa('.chip').forEach(b=> b.classList.toggle('active', b.dataset.tab===id));
  qsa('.tab').forEach(t=> t.classList.toggle('active', t.id===`tab-${id}`));
}
