/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  
  images: {
    domains: [
      'localhost',
      'melody-ai.com',
      'cdn.melody-ai.com',
      'lh3.googleusercontent.com', // Google avatars
    ],
  },

  // API configuration
  api: {
    bodyParser: {
      sizeLimit: '50mb', // For audio uploads
    },
    responseLimit: false,
  },

  // WebSocket support
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
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
        ],
      },
    ];
  },

  // Redirects
  async redirects() {
    return [
      {
        source: '/studio',
        destination: '/studio/generate',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
