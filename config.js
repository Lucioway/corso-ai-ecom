/* Lucioway classroom — central config.
   Fill these in to go live. Empty = local/dev mode (classroom open, local videos). */
window.LW_CONFIG = {
  // Video: Bunny STREAM library (player with captions, chapters, adaptive quality,
  // analytics, token protection). Player = iframe embed by video guid.
  streamLibraryId: 690311,
  // legacy direct-mp4 base (Bunny Storage/CDN) — kept as fallback, unused by Stream player.
  videoBase: "https://lucioway-corso.b-cdn.net/",

  // Supabase — project "lucioway" (org WAYINT, eu-central-1). anon key is public.
  supabaseUrl: "https://pclouwvnhjuvldwoifku.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbG91d3ZuaGp1dmxkd29pZmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyOTM0NjAsImV4cCI6MjA5Nzg2OTQ2MH0.3oBD21v3JNXpIcrXzfDNq6t_ARjIctW0CfYIxd5V7eo",

  // Access gate. true = require login + active entitlement before showing videos.
  // OFF in dev (classroom open). Flip to true at launch, once the entitlement
  // flow (Stripe/quiz) grants access automatically. Login test passed 2026-06-24.
  gate: true,

  product: "corso-ai-ecom",

  // Stripe checkout. Create a Payment Link in Stripe → paste the URL here.
  // Empty = checkout non configurato (il bottone spiega cosa fare).
  stripePaymentLink: "",
  priceLabel: "€297 una tantum",   // mostrato sul paywall
};
