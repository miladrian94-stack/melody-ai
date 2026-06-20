# Melody AI — AI Provider Integration

تم تنفيذ الفجوة الوحيدة المكتشفة في طبقة الذكاء الاصطناعي: `DefaultAIProvider`
(الموجود في `Backend/lib/providers/ai-provider.ts`) كان عبارة عن stub كامل —
6 من أصل 8 methods كانت `throw new Error("Not implemented")`. باقي المشروع
(Use-Cases، Queue، Repositories، Storage، Credits) كان شغّال فعلياً ولم
يُعدَّل أي شيء فيه.

## ما تم إضافته (ملفات جديدة فقط — لا حذف ولا تعديل بنيوي)

- `Backend/lib/providers/replicate-ai-provider.ts` — MusicGen (melody/music) + Bark (voice، مع Arabic presets) عبر Replicate API
- `Backend/lib/providers/fal-ai-provider.ts` — MusicGen / Stable Audio / AudioLDM2 عبر FAL.ai
- `Backend/lib/providers/suno-ai-provider.ts` — يتكلم HTTP مع خدمة Suno self-hosted (Docker)
- `Backend/lib/providers/lyrics-enhancer.ts` — `LyricsEnhancer` المشترك (Claude Haiku / GPT-4o-mini)، يدعم Arabic/English
- `Backend/lib/providers/audio-toolkit.ts` — mixAudio/masterAudio/removeNoise/detectPitch عبر ffmpeg محلياً (مشترك بين الثلاثة، مو AI hosted call)
- `Backend/lib/providers/index.ts` — `registerAIProviders()`: يسجّل الثلاثة في `AIProviderFactory` الموجود، ويختار الفعّال عبر `AI_PROVIDER`

## التعديل الوحيد على ملف موجود

`workers/ai-generation.worker.ts` — أُضيف سطر واحد لاستدعاء `registerAIProviders()`
قبل بدء استهلاك الـ jobs. هذا ضروري لأن `AIProviderFactory.getProvider()`
(بدون اسم، يطلب `'default'`) كان سيفشل دائماً بـ
`AI provider 'default' not found` — لا أحد كان يسجّل أي provider تحت هذا
الاسم في أي مكان بالمشروع، حتى مع `DefaultAIProvider` نفسه. هذه فجوة كانت
موجودة بشكل مستقل عن الـ "Not implemented" stubs.

لا تعديل آخر على `process-song-generation.use-case.ts`، ولا على الـ queue، ولا على الـ schema.

## لماذا ثلاثة Providers بدل واحد

الثلاثة مسجّلين دائماً تحت أسمائهم (`replicate`, `fal`, `suno`)، والـ `AI_PROVIDER`
env var يحدد بس مين يجاوب على `'default'`. هذا يخلي التبديل بينهم تغيير
env var واحد، بدون أي تعديل كود — ويفتح الباب لاحقاً لتوجيه مستخدمين معينين
لمزود مختلف عبر `AIProviderFactory.getProvider('fal')` مباشرة بدون شغل تسجيل إضافي.

## التشغيل

1. انسخ المتغيرات من `.env.ai-providers.example` إلى `.env.local` وعبّي
   المفاتيح الفعلية (`REPLICATE_API_TOKEN` و/أو `FAL_KEY` و/أو `SUNO_SERVICE_URL`).
2. لا حاجة لأي `npm install` إضافي — كل الـ providers تستخدم `fetch` الأصلي
   و`ffmpeg-static` الموجود مسبقاً في `package.json`.
3. شغّل الـ worker كالمعتاد:

```bash
npm run worker
```

## ملاحظات مهمة

- بدون أي مفتاح مُعرّف، أي محاولة توليد تفشل بخطأ واضح
  (`InfrastructureError`) بدل تعليق صامت أو خطأ شبكة غامض — نفس نمط
  `requireRedis()` الموجود مسبقاً في `infrastructure/queue/generation-queue.ts`.
- `synthesizeVoice` في FAL provider يفوّض فعلياً لـ Bark عبر Replicate
  (FAL ما عنده مسار صوت مطابق لمتطلبات MALE/FEMALE + ARABIC/ENGLISH بنفس الجودة) —
  هذا يتطلب `REPLICATE_API_TOKEN` حتى لو كنت تستخدم `AI_PROVIDER=fal`.
- Suno self-hosted يولّد الأغنية كاملة (vocals + instrumental) بخطوة وحدة،
  فـ `synthesizeVoice` فيه يرجّع buffer فاضي و`mixAudio` يتعامل مع هذي الحالة
  بدون كسر الـ pipeline الموجود.
- تم التحقق من الكود كاملاً عبر `tsc --noEmit` بدون أي خطأ (راجع تفاصيل
  alias resolution في التقرير المرسل في المحادثة).
