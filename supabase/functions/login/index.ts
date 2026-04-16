import { supabaseAnon } from "../_shared/supabaseClient.ts"
import { json } from "../_shared/response.ts"

Deno.serve(async (req) => {
  try {
    const { email, password } = await req.json()

    const supabase = supabaseAnon(req)

    const { data, error } =
      await supabase.auth.signInWithPassword({ email, password })

    if (error) throw error

    return json(data)
  } catch (err) {
    return json({ error: err.message }, 400)
  }
})