import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { supabaseAnon } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req: Request) => {
  const headers = corsHeaders(req)

  console.log("====================================")
  console.log("🚀 PROJECTS FUNCTION HIT")
  console.log("Method:", req.method)
  console.log("URL:", req.url)

  if (req.method === "OPTIONS") {
    console.log("🟡 Preflight request handled")
    return new Response("ok", { headers })
  }

  try {
    const supabase = supabaseAnon(req)

    const body = await req.json()
    const { action } = body

    console.log("📦 Incoming body:", body)
    console.log("⚙️ Action:", action)

    // ================= CREATE =================
    if (action === "create") {
      console.log("🟢 CREATE PROJECT FLOW STARTED")

      const { name, description, team_name } = body

      if (!name) {
        console.log("❌ Missing project name")
        return new Response(JSON.stringify({ error: "Project name required" }), {
          status: 400,
          headers,
        })
      }

      const { data: userRes, error: userErr } = await supabase.auth.getUser()

      if (userErr) {
        console.log("❌ Auth error:", userErr.message)
      }

      const user = userRes?.user
      console.log("👤 Auth user:", user?.id)

      let team_id = null

      if (team_name) {
        console.log("🔍 Resolving team:", team_name)

        const { data: team, error: teamError } = await supabase
          .from("teams")
          .select("id")
          .eq("name", team_name)
          .single()

        if (teamError || !team) {
          console.log("❌ Team not found:", team_name)
          return new Response(JSON.stringify({ error: "Team not found" }), {
            status: 404,
            headers,
          })
        }

        team_id = team.id
        console.log("✅ Team resolved:", team_id)
      }

      console.log("📝 Inserting project...")

      const { data, error } = await supabase
        .from("projects")
        .insert({
          name,
          description,
          team_id,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) {
        console.log("❌ Insert error:", error.message)
        throw error
      }

      console.log("✅ Project created:", data.id)

      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= UPDATE =================
    if (action === "update") {
      console.log("🟡 UPDATE PROJECT FLOW STARTED")

      const { project_id, name, description, status, team_name } = body

      console.log("🎯 Project ID:", project_id)

      let team_id = null

      if (team_name) {
        console.log("🔍 Resolving new team:", team_name)

        const { data: team } = await supabase
          .from("teams")
          .select("id")
          .eq("name", team_name)
          .single()

        if (!team) {
          console.log("❌ Team not found for update")
          return new Response(JSON.stringify({ error: "Team not found" }), {
            status: 404,
            headers,
          })
        }

        team_id = team.id
        console.log("✅ Team resolved:", team_id)
      }

      console.log("✏️ Updating project...")

      const { data, error } = await supabase
        .from("projects")
        .update({
          name,
          description,
          status,
          ...(team_name && { team_id }),
        })
        .eq("id", project_id)
        .select()
        .single()

      if (error) {
        console.log("❌ Update error:", error.message)
        throw error
      }

      console.log("✅ Project updated:", data.id)

      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= DELETE =================
    if (action === "delete") {
      console.log("🔴 DELETE PROJECT FLOW STARTED")

      const { project_id } = body
      console.log("🗑️ Project ID:", project_id)

      const { error } = await supabase
        .from("projects")
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq("id", project_id)

      if (error) {
        console.log("❌ Delete error:", error.message)
        throw error
      }

      console.log("✅ Project soft deleted")

      return new Response(
        JSON.stringify({ message: "Project deleted" }),
        { headers }
      )
    }

    // ================= LIST =================
    if (action === "list") {
      console.log("📋 FETCH PROJECTS FLOW STARTED")

      const { data, error } = await supabase
        .from("projects")
        .select(`
          *,
          teams (id, name)
        `)
        .is("deleted_at", null)

      if (error) {
        console.log("❌ Fetch error:", error.message)
        throw error
      }

      console.log("✅ Projects fetched:", data?.length)

      return new Response(JSON.stringify({ data }), { headers })
    }

    console.log("⚠️ Invalid action received:", action)

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers,
    })
  } catch (err) {
    console.log("💥 UNHANDLED ERROR:", err.message)

    return new Response(
      JSON.stringify({ error: err.message || "Unexpected error" }),
      { status: 500, headers }
    )
  } finally {
    console.log("====================================")
    console.log("🏁 REQUEST COMPLETE")
  }
})