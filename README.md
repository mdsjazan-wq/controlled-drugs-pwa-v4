# Controlled Drugs PWA — v4 (Roles + Requests)
- نسخة جاهزة للنشر على GitHub Pages، مع شعار الهيئة.
- يدعم: تسجيل الدخول، الأدوار (admin/storekeeper/center_user/auditor)، نظام طلبات (Draft → Submitted → Approve/Reject → Fulfill)، وتصدير PDF/CSV/XLSX.

## الإعداد
1) انسخ `config.example.js` إلى `config.js` وضع:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2) ارفع `db/migration_v4.sql` في Supabase SQL Editor لتجهيز الجداول والسياسات و الـ RPC.
3) انشر المستودع على GitHub Pages.

> ملاحظة: لا ترفع المفاتيح الحقيقية علنًا.
