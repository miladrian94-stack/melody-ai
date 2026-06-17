# Melody AI — Enterprise SaaS Upgrade

تم دمج طبقة Enterprise SaaS داخل المشروع الأصلي بدل تركها كملفات منفصلة.

## ما تم إضافته

- Multi-tenant Organizations
- Organization Members + Roles
- Credit Ledger كامل
- Atomic credit deduction للـ AI jobs
- Enterprise AI Job Queue عبر BullMQ/Redis
- Feature Flags
- Usage Metrics
- Stripe Webhook idempotency
- System Health endpoint
- Audit logging services

## أهم المسارات الجديدة

- `GET /api/enterprise/organizations`
- `POST /api/enterprise/organizations`
- `GET /api/enterprise/credits`
- `GET /api/enterprise/ai-jobs`
- `GET /api/enterprise/feature-flags`
- `POST /api/enterprise/feature-flags` للأدمن فقط
- `GET /api/enterprise/system`

## طريقة التشغيل

1. انسخ `.env.enterprise.example` إلى `.env.local` وعدّل القيم.
2. شغّل Prisma:

```bash
npm install
npm run db:generate
npm run db:push
```

3. شغّل التطبيق:

```bash
npm run dev
```

4. شغّل عامل المعالجة للذكاء الاصطناعي:

```bash
npm run worker:enterprise
```

## ملاحظات مهمة

- تم الحفاظ على المشروع الأصلي وعدم حذف المسارات القديمة.
- مسار `POST /api/songs` أصبح يستخدم EnterpriseSongService: ينشئ Song + AIJob + يخصم Credits + يرسل Job إلى Queue.
- Stripe webhook أصبح يحفظ الأحداث في `WebhookEvent` لمنع تكرار المعالجة.
- يلزم تنفيذ migration/DB push بعد تحديث Prisma schema.

## Build path fix
This package includes a Dockerfile fix that copies `Backend/enterprise` into the Docker build context. It also includes a compatibility mirror under `Backend/lib/enterprise` so imports using either `@/Backend/enterprise/...` or `@/lib/enterprise/...` can resolve during Docker builds.
