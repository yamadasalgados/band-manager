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
  // Opcional: Desativa o log de telemetria da Next no console
  telemetry: false,
};

export default nextConfig;