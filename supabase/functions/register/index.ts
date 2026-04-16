import { createClient } from "npm:@supabase/supabase-js"
import { corsHeaders } from "../_shared/cors.ts"

Deno.serve(async (req) => {
  console.log("🔥 REGISTER FUNCTION HIT")
  console.log("Method:", req.method)
  console.log("URL:", req.url)
  console.log("Headers:", Object.fromEntries(req.headers))

  const headers = corsHeaders(req)

  // =========================
  // PRE-FLIGHT
  // =========================
  if (req.method === "OPTIONS") {
    console.log("🟡 Preflight request received")
    return new Response(null, {
      status: 204,
      headers,
    })
  }

  try {
    console.log("🟢 Entering try block")

    const body = await req.json()
    console.log("📦 Request body:", body)

    const {
      email,
      password,
      firstName,
      lastName,
      teamName, // optional now
    } = body

    // =========================
    // VALIDATION
    // =========================
    if (!email || !password) {
      console.error("❌ Missing required fields")
      throw new Error("email and password are required")
    }

    console.log("📧 Email:", email)
    console.log("👤 Name:", firstName, lastName)
    console.log("🏢 TeamName (optional):", teamName)

    // =========================
    // SUPABASE CLIENT
    // =========================
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    )

    console.log("🚀 Creating auth user...")

    // =========================
    // 1. CREATE AUTH USER
    // =========================
    const { data: authData, error: authError } =
      await supabase.auth.signUp({
        email,
        password,
      })

    if (authError) {
      console.error("❌ Auth error:", authError)
      throw authError
    }

    if (!authData.user) {
      console.error("❌ No auth user returned")
      throw new Error("User creation failed")
    }

    const userId = authData.user.id
    console.log("✅ Auth user created:", userId)

    // =========================
    // 2. ADMIN CLIENT (DB OPS)
    // =========================
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    console.log("📡 Calling create_workspace RPC")

    const { data, error } = await adminClient.rpc("create_workspace", {
      p_auth_user_id: userId,
      p_email: email,
      p_first_name: firstName ?? null,
      p_last_name: lastName ?? null,
      p_team_name: teamName ?? "My Workspace", // fallback default
    })

    if (error) {
      console.error("❌ RPC ERROR:", error)

      // rollback auth user
      console.log("♻️ Rolling back auth user...")
      await adminClient.auth.admin.deleteUser(userId)

      throw error
    }

    console.log("✅ Workspace created:", data)

    // =========================
    // RESPONSE
    // =========================
    return new Response(
      JSON.stringify({
        message: "Workspace created successfully",
        user: authData.user,
        team: data,
      }),
      {
        status: 201,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
      }
    )
  } catch (err: any) {
    console.error("🔥 FUNCTION ERROR:", err)

    return new Response(
      JSON.stringify({
        error: err.message || "Something went wrong",
        stack: err.stack,
      }),
      {
        status: 400,
        headers,
      }
    )
  }
})