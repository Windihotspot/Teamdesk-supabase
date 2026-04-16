import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  const headers = corsHeaders(req)

  // ✅ Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const url = new URL(req.url)
    const teamId = url.searchParams.get("team_id")

    // ✅ Build query
    let query = supabase
      .from("users")
      .select("id, first_name, last_name, email, avatar_url, team_id")
      .is("deleted_at", null)
      .order("first_name", { ascending: true })

    // optional filter
    if (teamId) {
      query = query.eq("team_id", teamId)
    }

    const { data, error } = await query

    if (error) throw error

    // ✅ format response
    const users = (data || []).map((u) => ({
      id: u.id,
      name:
        `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() ||
        u.email,
      email: u.email,
      avatar: u.avatar_url,
      team_id: u.team_id
    }))

    return new Response(
      JSON.stringify({
        success: true,
        data: users
      }),
      {
        status: 200,
        headers
      }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message
      }),
      {
        status: 500,
        headers
      }
    )
  }
})