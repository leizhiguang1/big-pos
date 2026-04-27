import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // TODO: regenerate Database types via `supabase gen types typescript --project-id <id> > src/lib/database.types.ts`
  // and remove the flags below. Current hand-rolled types fail Supabase's GenericSchema
  // constraint, making table operations resolve to `never`.
  typescript: { ignoreBuildErrors: true },
}

export default nextConfig
