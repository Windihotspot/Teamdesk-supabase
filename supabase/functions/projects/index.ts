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

    // ================= GET (comprehensive) =================
if (action === "get") {
  console.log("🔍 GET PROJECT FLOW STARTED")

  const { project_id } = body

  if (!project_id) {
    console.log("❌ Missing project_id")
    return new Response(JSON.stringify({ error: "project_id required" }), {
      status: 400,
      headers,
    })
  }

  console.log("📦 Fetching project:", project_id)

  // Core project + team + members + project-level attachments
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select(`
      *,
      teams (
        id,
        name,
        description,
        team_members (
          id,
          role,
          created_at,
          users (
            id,
            email,
            first_name,
            last_name,
            avatar_url
          )
        )
      ),
      attachments (
        id,
        file_url,
        file_name,
        file_size,
        created_at,
        uploaded_by
      )
    `)
    .eq("id", project_id)
    .is("deleted_at", null)
    .single()

  if (projectErr || !project) {
    console.log("❌ Project fetch error:", projectErr?.message)
    return new Response(
      JSON.stringify({ error: projectErr?.message || "Project not found" }),
      { status: 404, headers }
    )
  }

  console.log("✅ Project fetched:", project.id)

  // Tasks + assignees (separate query to avoid deep nesting limits)
  const { data: tasks, error: tasksErr } = await supabase
    .from("tasks")
    .select(`
      *,
      task_assignees (
        id,
        users (
          id,
          email,
          first_name,
          last_name,
          avatar_url
        )
      ),
      comments (
        id,
        content,
        created_at,
        user_id,
        users (
          id,
          first_name,
          last_name,
          avatar_url
        ),
        attachments (
          id,
          file_url,
          file_name,
          file_size,
          created_at
        )
      ),
      time_logs (
        id,
        start_time,
        end_time,
        duration,
        user_id,
        users (
          id,
          first_name,
          last_name
        )
      )
    `)
    .eq("project_id", project_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (tasksErr) {
    console.log("❌ Tasks fetch error:", tasksErr.message)
    throw tasksErr
  }

  console.log("✅ Tasks fetched:", tasks?.length)

  // Activity logs scoped to this project
  const { data: activityLogs, error: activityErr } = await supabase
    .from("activity_logs")
    .select(`
      id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at,
      ip_address,
      status,
      user_id
    `)
    .eq("entity_type", "project")
    .eq("entity_id", project_id)
    .order("created_at", { ascending: false })
    .limit(50)

  if (activityErr) {
    console.log("⚠️ Activity logs fetch error:", activityErr.message)
    // Non-fatal — continue without activity logs
  }

  console.log("✅ Activity logs fetched:", activityLogs?.length ?? 0)

  // ---- Computed stats ----
  const taskList = tasks ?? []
  const stats = {
    total_tasks: taskList.length,
    by_status: taskList.reduce((acc: Record<string, number>, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1
      return acc
    }, {}),
    by_priority: taskList.reduce((acc: Record<string, number>, t) => {
      acc[t.priority] = (acc[t.priority] ?? 0) + 1
      return acc
    }, {}),
    total_time_logged: taskList.reduce((sum: number, t) => {
      const taskTime = (t.time_logs ?? []).reduce(
        (s: number, l: { duration: number }) => s + (l.duration ?? 0),
        0
      )
      return sum + taskTime
    }, 0),
    overdue_tasks: taskList.filter(
      (t) =>
        t.due_date &&
        new Date(t.due_date) < new Date() &&
        t.status !== "done"
    ).length,
  }

  // ---- Shaped response ----
  const response = {
    data: {
      ...project,
      tasks: taskList,
      activity_logs: activityLogs ?? [],
      stats,
    },
  }

  console.log("✅ Comprehensive project response shaped")

  return new Response(JSON.stringify(response), { headers })
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