import { supabaseAdmin } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

Deno.serve(async (req) => {
  console.log("🔥 DASHBOARD EDGE HIT")

  const headers = corsHeaders(req)

  if (req.method === "OPTIONS") {
    console.log("⚡ OPTIONS PREFLIGHT")
    return new Response(null, { status: 204, headers })
  }

  try {
    const body = await req.json()

    const user_id = body?.user_id
    const team_id = body?.team_id || null
    const include = body?.include || []

    console.log("📥 BODY:", body)
    console.log("👤 user_id:", user_id)
    console.log("🏢 team_id:", team_id)
    console.log("📦 include:", include)

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers }
      )
    }

    const admin = supabaseAdmin()

    const response: any = {}

    // =========================
    // TEAMS
    // =========================
    if (include.includes("teams")) {
      console.log("📡 Fetching teams...")

      const { data, error } = await admin.rpc("get_user_teams", {
        p_user_id: user_id,
      })

      console.log("📊 teams:", data)

      if (error) throw error

      response.teams = data
    }

    // =========================
    // PROJECTS (requires team_id)
    // =========================
    if (include.includes("projects") && team_id) {
      console.log("📡 Fetching projects...")

      const { data, error } = await admin.rpc("get_team_projects", {
        p_team_id: team_id,
      })

      console.log("📊 projects:", data)

      if (error) throw error

      response.projects = data
    }

    // =========================
    // STATS (requires team_id)
    // =========================
    if (include.includes("stats") && team_id) {
      console.log("📡 Fetching stats...")

      const { data, error } = await admin.rpc("get_team_stats", {
        p_team_id: team_id,
      })

      console.log("📊 stats:", data)

      if (error) throw error

      response.stats = data
    }

    // =========================
    // NOTIFICATIONS
    // =========================
    if (include.includes("notifications")) {
      console.log("📡 Fetching notifications...")

      const { data, error } = await admin.rpc("get_notifications", {
        p_user_id: user_id,
      })

      console.log("📊 notifications:", data)

      if (error) throw error

      response.notifications = data
    }

    console.log("✅ FINAL RESPONSE:", response)

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
    })
  } catch (err: any) {
    console.error("🔥 EDGE ERROR:", err)

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers }
    )
  }
})