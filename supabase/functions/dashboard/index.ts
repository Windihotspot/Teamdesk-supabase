import { supabaseAdmin } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

Deno.serve(async (req) => {
  console.log("🔥 DASHBOARD FUNCTION HIT")

  const headers = corsHeaders(req)

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers,
    })
  }

  try {
    // ✅ Parse request body
    const body = await req.json()
    const user_id = body?.user_id

    console.log("📥 Incoming user_id:", user_id)

    // ❌ Validate
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers }
      )
    }

    const admin = supabaseAdmin()

    console.log("📡 Calling RPC get_full_dashboard")

    const { data, error } = await admin.rpc("get_full_dashboard", {
      p_user_id: user_id,
    })

    if (error) {
      console.error("❌ RPC ERROR:", error)
      throw error
    }

    console.log("✅ RPC SUCCESS")

    return new Response(JSON.stringify({ dashboard: data }), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
    })
  } catch (err: any) {
    console.error("🔥 FUNCTION ERROR:", err)

    return new Response(
      JSON.stringify({
        error: err.message,
      }),
      {
        status: 400,
        headers,
      }
    )
  }
})