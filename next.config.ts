/** @type {import('next').NextConfig} */
const nextConfig = {
  // Melhora a performance e permite imagens de domínios externos
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co', // Permite fotos do seu Supabase
      },
    ],
  },
  // ✅ A configuração de telemetria foi removida daqui para evitar o erro de build.
};

export default nextConfig;