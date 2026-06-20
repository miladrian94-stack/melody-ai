# Frontend Connection Patch

This build includes:
- CORS middleware for Netlify/Vercel frontend.
- Auth cookies changed to SameSite=None for cross-domain production usage.
- Login/Register also return `accessToken` in JSON so the frontend can use Bearer auth.
- AuthService.getCurrentUser can read `Authorization: Bearer <token>` in addition to cookies.

Required Render env:
```env
FRONTEND_URL=https://preeminent-trifle-447f6d.netlify.app
CORS_ORIGINS=https://preeminent-trifle-447f6d.netlify.app
JWT_SECRET=...
JWT_REFRESH_SECRET=...
DATABASE_URL=...
```
