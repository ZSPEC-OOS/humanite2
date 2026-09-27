/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/product', destination: '/solutions', permanent: true },
      { source: '/use-cases', destination: '/solutions', permanent: true },
    ]
  },
}

module.exports = nextConfig
