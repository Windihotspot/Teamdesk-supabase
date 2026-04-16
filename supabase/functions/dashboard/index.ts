import { supabaseAdmin } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

Deno.serve(async (req) => {
  console.log("🔥 DASHBOARD FUNCTION HIT")
  console.log("Method:", req.method)
  console.log("URL:", req.url)
  console.log("Headers:", Object.fromEntries(req.headers))

  const headers = corsHeaders(req)

  if (req.method === "OPTIONS") {
    console.log("🟡 Preflight request received")
    return new Response(null, {
      status: 204,
      headers,
    })
  }

  try {
    console.log("🟢 Entering try block")

    const user = {
      id: "00000000-0000-0000-0000-000000000001",
      email: "dev@teamdesk.local",
    }

    console.log("👤 Mock user:", user)

    const admin = supabaseAdmin()

    console.log("📡 Calling RPC get_full_dashboard")

    const { data, error } = await admin.rpc("get_full_dashboard", {
      p_user_id: user.id,
    })

    if (error) {
      console.error("❌ RPC ERROR:", error)
      throw error
    }

    console.log("✅ RPC SUCCESS:", data)

    return new Response(JSON.stringify({ user, dashboard: data }), {
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
        stack: err.stack,
      }),
      {
        status: 400,
        headers,
      }
    )
  }
})