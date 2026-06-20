export const siteConfig = {
  name: "Melody AI",
  description: "Transform your words into professional songs with AI",
  url: process.env.NEXT_PUBLIC_APP_URL || "https://melody-ai.com",
  ogImage: "/og-image.jpg",
  links: {
    twitter: "https://twitter.com/melodyai",
    github: "https://github.com/melodyai",
  },
  creator: "Melody AI Team",
  keywords: [
    "AI music generation",
    "text to song",
    "AI singer",
    "music creation",
    "voice synthesis",
    "Melody AI",
  ],
};

export const subscriptionTiers = {
  FREE: {
    name: "Free",
    price: 0,
    credits: 100,
    songsPerMonth: 5,
    maxDuration: 60,
    features: [
      "5 songs per month",
      "Up to 60 seconds",
      "Basic genres",
      "MP3 download",
    ],
  },
  STARTER: {
    name: "Starter",
    price: 9.99,
    credits: 1000,
    songsPerMonth: 30,
    maxDuration: 120,
    features: [
      "30 songs per month",
      "Up to 120 seconds",
      "All genres",
      "High quality MP3",
      "Priority processing",
    ],
  },
  PRO: {
    name: "Pro",
    price: 29.99,
    credits: 5000,
    songsPerMonth: 100,
    maxDuration: 180,
    features: [
      "100 songs per month",
      "Up to 180 seconds",
      "All genres + Custom",
      "Studio quality WAV",
      "Priority processing",
      "API access",
    ],
  },
  BUSINESS: {
    name: "Business",
    price: 99.99,
    credits: 20000,
    songsPerMonth: 500,
    maxDuration: 300,
    features: [
      "500 songs per month",
      "Up to 300 seconds",
      "All features",
      "Lossless quality",
      "Commercial license",
      "API access",
      "Team collaboration",
    ],
  },
  ENTERPRISE: {
    name: "Enterprise",
    price: 299.99,
    credits: -1, // unlimited
    songsPerMonth: -1, // unlimited
    maxDuration: 600,
    features: [
      "Unlimited songs",
      "Up to 600 seconds",
      "Custom AI models",
      "White label",
      "Dedicated support",
      "SLA guarantee",
    ],
  },
};
