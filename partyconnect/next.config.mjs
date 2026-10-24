/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 基本的なセキュリティヘッダ(写真アップロードのためカメラは自サイトのみ許可)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
