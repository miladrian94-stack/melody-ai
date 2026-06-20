/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // ⚠️ REMOVED as part of the DDD refactor (see Dockerfile's COPY fix
  // comment): these flags were masking type/lint errors caused by the
  // Dockerfile's inconsistent COPY list silently dropping newly-added
  // top-level folders from the build context — files existed locally,
  // didn't exist in the Docker build, so `@/...` imports pointing at them
  // failed type-checking in a way that looked like a real type error but
  // was actually a missing-file error in disguise.
  //
  // Re-enable these ONLY if you hit a genuinely unrelated wave of
  // pre-existing type/lint errors when first turning this back on — and
  // if so, fix them rather than re-suppressing, since `ignoreBuildErrors`
  // means a broken build can still silently ship to production.
  // typescript: { ignoreBuildErrors: true },
  // eslint: { ignoreDuringBuilds: true },
  
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },

  // Webpack config
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
