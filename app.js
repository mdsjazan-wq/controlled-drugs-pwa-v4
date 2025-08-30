/* ========= إعداد Supabase ========= */
const CFG = window.CD_CONFIG || {};
if (!CFG.USE_SUPABASE) alert('التهيئة مفقودة: config.js');
const SB = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ========= متغيرات عامة ========= */
let session = null;        // جلسة المستخدم
let profile = null;        // صف المستخدم من جدول profiles
let centers = [];          // قائمة المراكز
let items = [];            // قائمة الأصناف

/* ========= أدوات مساعدة ========= */
const qs  = (s, r=document)=>r.querySelector(s);
const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));
const show = (el, vis)=>{ if(!el) return; el.style.display = vis? '' : 'none'; };
const fmt = n => (n??0).toLocaleString('ar');

/* ========= بدء التطبيق ========= */
document.addEventListener('DOMContentLoaded', init);

async function init(){
  // ربط الأزرار
  qs('#btn-login')?.addEventListener('click', login);
  qs('#btn-signup')?.addEventListener('click', signup);
  qs('#btn-logout')?.addEventListener('click', logout);

  // تبويبات
  qsa('[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=> activateTab(btn.dataset.tab));
  });

  // استماع لتغيرات المصادقة
  SB.auth.onAuthStateChange((_e, s)=>{
    session = s?.session || null;
    route();
  });

  // احصل على الجلسة الحالية ثم حرّك الواجهة
  const cur = await SB.auth.getSession();
  session = cur?.data?.session || null;
  route();
}

/* ========= مصادقة ========= */
async function login(){
  const email = qs('#login-email').value.trim();
  const password = qs('#login-password').value;
  const msg = qs('#login-msg');
  msg.textContent = '';
  const { error } = await SB.auth.signInWithPassword({ email, password });
  if (error){ msg.textContent = 'خطأ في الدخول'; return; }
  const cur = await SB.auth.getSession();
  session = cur?.data?.session || null;
  msg.textContent = 'تم تسجيل الدخول';
  route();
}

async function signup(){
  const email = qs('#login-email').value.trim();
  const password = qs('#login-password').value;
  const msg = qs('#login-msg');
  msg.textContent = '';
  const { error } = await SB.auth.signUp({ email, password });
  if (error){ msg.textContent = 'تعذر إنشاء المستخدم'; return; }
  msg.textContent = 'تم إنشاء الحساب، تحقق من البريد إن كان التفعيل مطلوباً.';
}

async function logout(){
  await SB.auth.signOut();
  session = null;
  profile = null;
  route();
}

/* ========= توجيه الواجهة ========= */
async function route(){
  // تأكد من الجلسة
  if (!session){
    const cur = await SB.auth.getSession();
    session = cur?.data?.session || null;
  }

  // بدون جلسة: أظهر شاشة الدخول
  if (!session || !session.user){
    show(qs('#auth-screen'), true);
    show(qs('#app-header'), false);
    show(qs('#app-main'), false);
    return;
  }

  // لدينا جلسة
  show(qs('#auth-screen'), false);
  show(qs('#app-header'), true);
  show(qs('#app-main'), true);

  // المستخدم الحالي
  qs('#whoami') && (qs('#whoami').textContent = session?.user?.email || '');

  // اجلب البروفايل
  const { data: prof } = await SB.from('profiles')
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();
  profile = prof || null;

  // حدث بطاقة الحالة
  renderProfileCard();

  // حمّل القوائم ثم الأرصدة
  await loadLookups();
  await loadBalances();

  // افتح لوحة التحكم
  activateTab('dashboard');
  renderRequestsHome?.();
  renderSettings?.();
}

/* ========= لوحة الحالة ========= */
function renderProfileCard(){
  qs('#profile-name')  && (qs('#profile-name').textContent  = profile?.full_name || '—');
  qs('#profile-role')  && (qs('#profile-role').textContent  = roleLabel(profile?.role) || '—');
  qs('#profile-center')&& (qs('#profile-center').textContent= findCenterName(profile?.default_center_id) || '—');
}
function roleLabel(r){
  if(!r) return '';
  return ({admin:'مدير', storekeeper:'أمين مستودع', center_user:'مدير مركز', auditor:'مدقق'})[r] || r;
}
function findCenterName(id){
  if(!id) return '';
  const c = centers.find(x=>x.id===id);
  return c?.name || '';
}

/* ========= تحميل القوائم ========= */
async function loadLookups(){
  const { data: c }  = await SB.from('centers').select('id,name').order('id');
  centers = c || [];
  const { data: it } = await SB.from('items').select('id,name').order('id');
  items = it || [];

  // تعبئة الفلاتر والاختيارات
  const cf = qs('#center-filter');
  if (cf){
    cf.innerHTML = '<option value="">كل المراكز</option>' +
      centers.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
    if (profile?.role==='center_user' && profile?.default_center_id) cf.value = String(profile.default_center_id);
    if (!cf._bound){
      cf._bound = true;
      cf.onchange = () => repaintCenters();
    }
  }
}

/* ========= تحميل الأرصدة ========= */
let cacheWH = [], cacheCenters = [];
async function loadBalances(){
  // المستودع
  const { data: wh } = await SB.from('v_warehouse_by_item').select('*');
  cacheWH = wh || [];
  renderWarehouse(cacheWH);

  // المراكز
  let q = SB.from('v_centers_stock').select('*');
  if (profile?.role==='center_user' && profile?.default_center_id){
    q = q.eq('center_id', profile.default_center_id);
  }
  const { data: cs } = await q;
  cacheCenters = cs || [];
  repaintCenters();

  // ملخص سريع
  const totalItems = cacheWH.length;
  const totalWh = cacheWH.reduce((s,r)=> s + (r.balance||0), 0);
  qs('#quick-stats') && (qs('#quick-stats').innerHTML = `عدد الأصناف: <b>${fmt(totalItems)}</b> — إجمالي رصيد المستودع: <b>${fmt(totalWh)}</b>`);
}

/* ========= عرض الجداول ========= */
function renderWarehouse(rows){
  const tb = qs('#tbl-warehouse tbody');
  if (!tb) return;
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
  const tb = qs('#tbl-centers tbody');
  if (!tb) return;
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

  // زر طباعة
  const btnPrint = qs('#btn-print-centers');
  if (btnPrint && !btnPrint._bound){
    btnPrint._bound = true;
    btnPrint.onclick = ()=> window.print();
  }
}

/* ========= تبويبات ========= */
function activateTab(id){
  qsa('.tab').forEach(t=>t.classList.toggle('active', t.id===`tab-${id}`));
  qsa('[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
}

/* ========= (اختياري) شاشات أخرى إن وُجدت ========= */
function renderRequestsHome(){ /* تبويب الطلبات – موجود في v4 إن رغبت */ }
function renderSettings(){ /* تبويب الإعدادات – موجود في v4 إن رغبت */ }
