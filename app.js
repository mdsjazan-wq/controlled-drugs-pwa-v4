/* v4 core with roles + requests */
const { createClient } = supabase;
const SB = (() => {
  const cfg = window.CD_CONFIG || {};
  if (!cfg.USE_SUPABASE) { alert('Supabase غير مُفعّل في config.js'); }
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
})();

let session = null;
let profile = null;
let centers = [];
let items = [];
let draftId = null;
let draftLines = [];

function qs(id){return document.getElementById(id)}
function show(el, b){el.style.display = b ? '' : 'none'}
function today(){const d=new Date();return d.toISOString().slice(0,10)}

async function init(){
  const { data } = await SB.auth.getSession();
  session = data.session;
  SB.auth.onAuthStateChange((_e, s)=>{ session = s?.session || null; route() });
  route();
  bindUI();
}

function bindUI(){
  document.querySelectorAll('.tabs button').forEach(btn=>btn.addEventListener('click', ()=>activateTab(btn.dataset.tab)))
  qs('btn-login').onclick = login;
  qs('btn-signup').onclick = signup;
  qs('btn-logout').onclick = async ()=>{ await SB.auth.signOut(); }
  qs('btn-create-draft').onclick = createDraftRequest;
  qs('btn-add-line').onclick = addLine;
  qs('btn-submit-request').onclick = submitRequest;
  qs('btn-cancel-draft').onclick = cancelDraft;
  qs('btn-load-review').onclick = loadReview;
  qs('btn-approve').onclick = ()=> actOnRequest('approve');
  qs('btn-reject').onclick  = ()=> actOnRequest('reject');
  qs('btn-fulfill').onclick = ()=> actOnRequest('fulfill');
  // reports
  qs('btn-pdf').onclick = exportPDF;
  qs('btn-csv').onclick = exportCSV;
  qs('btn-xlsx').onclick = exportXLSX;
  // admin set role
  qs('btn-set-role').onclick = setRole;
}

function activateTab(key){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===key));
  document.querySelectorAll('.tab').forEach(tab=>tab.style.display='none');
  show(qs('tab-'+key), true);
}

async function route(){
  if(!session){
    show(qs('auth-screen'), true);
    show(qs('app-header'), false);
    show(qs('app-main'), false);
    return;
  }
  // fetch profile
  const { data: prof } = await SB.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle();
  profile = prof || null;
  // header
  show(qs('auth-screen'), false);
  show(qs('app-header'), true);
  show(qs('app-main'), true);
  qs('whoami').textContent = session.user.email;
  activateTab('dashboard');

  await loadLookups();
  renderDashboard();
  renderSettings();
  renderRequestsHome();
}

async function loadLookups(){
  const { data: c } = await SB.from('centers').select('id,name').order('id');
  centers = c || [];
  const { data: it } = await SB.from('items').select('id,name').order('id');
  items = it || [];
  // fill selects
  const selC = qs('usr-center'); selC.innerHTML = '<option value="">— مركز افتراضي (لـ center_user)</option>' + centers.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
  qs('rq-item').innerHTML = items.map(x=>`<option value="${x.id}">${x.name}</option>`).join('');
}

function renderDashboard(){
  qs('profile-name').textContent = profile?.full_name || '—';
  qs('profile-role').textContent = profile?.role || '—';
  const cName = centers.find(x=>x.id===profile?.default_center_id)?.name || '—';
  qs('profile-center').textContent = cName;
  qs('quick-stats').innerHTML = 'سيتم لاحقًا عرض ملخصات (أرصدة/حركة) هنا.';
}

function renderRequestsHome(){
  show(qs('role-center'), profile?.role==='center_user');
  show(qs('role-store'), ['storekeeper','admin'].includes(profile?.role));
  if (profile?.role==='center_user'){ loadMyRequests(); }
  if (['storekeeper','admin'].includes(profile?.role)){ loadIncoming(); }
}

function renderSettings(){}

/* ========= Auth ========= */
async function login(){
  const email = qs('login-email').value.trim();
  const password = qs('login-password').value;
  const { error } = await SB.auth.signInWithPassword({ email, password });
  qs('login-msg').textContent = error ? 'خطأ في الدخول' : 'تم تسجيل الدخول';
}
async function signup(){
  const email = qs('login-email').value.trim();
  const password = qs('login-password').value;
  const { error } = await SB.auth.signUp({ email, password });
  qs('login-msg').textContent = error ? 'تعذّر إنشاء الحساب' : 'تم إنشاء الحساب، تحقّق من بريدك';
}

/* ========= Requests (Center) ========= */
async function createDraftRequest(){
  if(!profile?.default_center_id) return alert('لا يوجد مركز افتراضي على حسابك');
  const type = qs('rq-type').value;
  const note = qs('rq-note').value.trim() || null;
  const { data, error } = await SB.from('request_headers').insert({
    req_type: type, center_id: profile.default_center_id, status:'draft', requested_by: session.user.id, note
  }).select('id').single();
  if(error){ alert('تعذّر إنشاء المسودة'); return; }
  draftId = data.id; draftLines = [];
  show(qs('rq-editor'), true);
  qs('rq-lines').querySelector('tbody').innerHTML = '';
  qs('rq-msg').textContent = 'تم إنشاء مسودة #' + draftId;
}

function addLine(){
  const itemId = Number(qs('rq-item').value);
  const qty = Number(qs('rq-qty').value);
  if(!draftId) return alert('أنشئ مسودة أولًا');
  if(!itemId || !qty) return;
  draftLines.push({item_id:itemId, qty});
  const itemName = items.find(x=>x.id===itemId)?.name || itemId;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${itemName}</td><td>${qty}</td><td><button class='btn btn-light'>حذف</button></td>`;
  tr.querySelector('button').onclick = ()=>{ tr.remove(); draftLines = draftLines.filter(l=>!(l.item_id===itemId && l.qty===qty)); };
  qs('rq-lines').querySelector('tbody').appendChild(tr);
}

async function submitRequest(){
  if(!draftId) return alert('لا توجد مسودة');
  if(draftLines.length===0) return alert('أضف بندًا واحدًا على الأقل');
  const { error: e1 } = await SB.from('request_lines').insert(draftLines.map(l=>({...l, request_id:draftId})));
  if(e1){ alert('تعذّر إضافة البنود'); return; }
  const { error } = await SB.rpc('rpc_submit_request', { p_request_id: draftId });
  if(error){ alert('تعذّر رفع الطلب: '+ (error?.message||'')); return; }
  qs('rq-msg').textContent = 'تم رفع الطلب #' + draftId;
  draftId = null; draftLines = [];
  show(qs('rq-editor'), false);
  loadMyRequests();
}

async function cancelDraft(){
  if(!draftId) return;
  await SB.from('request_lines').delete().eq('request_id', draftId);
  await SB.from('request_headers').delete().eq('id', draftId);
  draftId = null; draftLines = [];
  show(qs('rq-editor'), false);
  loadMyRequests();
}

async function loadMyRequests(){
  const { data } = await SB.from('request_headers')
    .select('id, req_type, status, created_at, note')
    .eq('center_id', profile.default_center_id)
    .order('id', {ascending:false});
  const tb = qs('my-requests').querySelector('tbody'); tb.innerHTML='';
  (data||[]).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td>${labelType(r.req_type)}</td><td>${r.status}</td><td>${new Date(r.created_at).toLocaleString('ar')}</td><td>${r.note||''}</td>`;
    tb.appendChild(tr);
  })
}
function labelType(t){ return t==='issue'?'صرف':(t==='return_empty'?'إرجاع فارغ':'إرجاع منتهي') }

/* ========= Requests (Storekeeper/Admin) ========= */
async function loadIncoming(){
  const { data } = await SB.from('request_headers')
    .select('id, req_type, center_id, note')
    .eq('status','submitted')
    .order('id',{ascending:false});
  const tb = qs('incoming-requests').querySelector('tbody'); tb.innerHTML='';
  (data||[]).forEach(r=>{
    const tr = document.createElement('tr');
    const cName = centers.find(x=>x.id===r.center_id)?.name || r.center_id;
    tr.innerHTML = `<td>${r.id}</td><td>${cName}</td><td>${labelType(r.req_type)}</td><td>${r.note||''}</td><td><button class='btn btn-light'>فتح</button></td>`;
    tr.querySelector('button').onclick = ()=>{ qs('review-id').value = r.id; loadReview(); };
    tb.appendChild(tr);
  });
}

async function loadReview(){
  const id = Number(qs('review-id').value);
  if(!id) return;
  const { data: hdr } = await SB.from('request_headers').select('*').eq('id', id).maybeSingle();
  if(!hdr){ qs('review-msg').textContent='الطلب غير موجود'; return; }
  const { data: lines } = await SB.from('request_lines').select('*, items(name)').eq('request_id', id);
  qs('rv-id').textContent = id;
  qs('rv-status').textContent = hdr.status;
  qs('rv-type').textContent = labelType(hdr.req_type);
  qs('rv-center').textContent = centers.find(x=>x.id===hdr.center_id)?.name || hdr.center_id;
  const tb = qs('rv-lines').querySelector('tbody'); tb.innerHTML='';
  (lines||[]).forEach(l=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${l.items?.name || l.item_id}</td><td>${l.qty}</td>`;
    tb.appendChild(tr);
  });
  show(qs('review-wrap'), true);
}

async function actOnRequest(kind){
  const id = Number(qs('review-id').value);
  if(!id) return;
  if(kind==='approve'){
    const { error } = await SB.rpc('rpc_approve_request', { req_id: id });
    qs('review-msg').textContent = error? ('فشل الاعتماد: '+error.message) : 'تم الاعتماد';
  }else if(kind==='reject'){
    const reason = prompt('سبب الرفض (اختياري):') || null;
    const { error } = await SB.rpc('rpc_reject_request', { req_id: id, reason });
    qs('review-msg').textContent = error? ('فشل الرفض: '+error.message) : 'تم الرفض';
  }else if(kind==='fulfill'){
    const date = prompt('تاريخ التنفيذ (YYYY-MM-DD)', today()) || today();
    const { error } = await SB.rpc('rpc_fulfill_request', { req_id: id, fulfill_date: date });
    qs('review-msg').textContent = error? ('فشل التنفيذ: '+error.message) : 'تم التنفيذ';
  }
  loadIncoming();
  loadReview();
}

/* ========= Admin set role ========= */
async function setRole(){
  if (profile?.role!=='admin') { qs('users-msg').textContent='هذه العملية لِـ admin فقط.'; return; }
  const email = qs('usr-email').value.trim();
  const name  = qs('usr-name').value.trim() || null;
  const role  = qs('usr-role').value;
  const centerId = role==='center_user' ? Number(qs('usr-center').value) || null : null;
  const { error } = await SB.rpc('rpc_set_role', {
    p_email: email, p_role: role, p_full_name: name, p_default_center_id: centerId
  });
  qs('users-msg').textContent = error ? ('فشل الحفظ: '+error.message) : 'تم الحفظ';
}

/* ========= Reports ========= */
async function exportPDF(){
  const el = document.getElementById('reports-area');
  const opt = { margin:[10,10,10,10], filename:`reports-${today()}.pdf`, image:{type:'jpeg',quality:0.98}, html2canvas:{scale:2}, jsPDF:{unit:'pt',format:'a4',orientation:'portrait'} };
  await html2pdf().set(opt).from(el).save();
}

function tableToCSV(table){
  let out=[];
  for (const row of table.querySelectorAll('tr')){
    const cells = [...row.children].map(td=>`"${(td.innerText||'').replace(/"/g,'""')}"`).join(',');
    out.push(cells);
  }
  return out.join('\n');
}
function download(filename, content, type='text/plain'){
  const blob = new Blob([content], {type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
function exportCSV(){
  const CSV_BOM = "\uFEFF";
  const csv = tableToCSV(document.getElementById('dummy-report'));
  download(`reports-${today()}.csv`, CSV_BOM + csv, 'text/csv;charset=utf-8');
}
function exportXLSX(){
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(document.getElementById('dummy-report'));
  XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
  XLSX.writeFile(wb, `reports-${today()}.xlsx`);
}

init();
