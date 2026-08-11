import { createClient } from 'npm:@supabase/supabase-js@2.105.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://jvk3rz.github.io',
  'Access-Control-Allow-Headers': 'apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const { username, password } = await request.json()
    const normalized = String(username || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(normalized) || typeof password !== 'string') {
      return json({ error: 'Invalid username or password.' }, 400)
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const profile = await admin.from('profiles').select('id').eq('username', normalized).maybeSingle()
    if (profile.error || !profile.data) return json({ error: 'Invalid username or password.' }, 400)

    const user = await admin.auth.admin.getUserById(profile.data.id)
    const email = user.data.user?.email
    if (user.error || !email) return json({ error: 'Invalid username or password.' }, 400)

    const auth = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await auth.auth.signInWithPassword({ email, password })
    if (signedIn.error || !signedIn.data.session) return json({ error: 'Invalid username or password.' }, 400)

    return json({
      access_token: signedIn.data.session.access_token,
      refresh_token: signedIn.data.session.refresh_token,
    })
  } catch {
    return json({ error: 'Username sign-in is temporarily unavailable.' }, 500)
  }
})
