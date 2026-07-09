// supabase/functions/tasks/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { supabaseAnon } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req: Request) => {
  const headers = corsHeaders(req)

  console.log("====================================")
  console.log("🚀 TASKS FUNCTION HIT")
  console.log("Method:", req.method)

  if (req.method === "OPTIONS") {
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
      const { project_id, title, description, status, priority, start_date, due_date, team_id, assignee_ids } = body

      if (!title) {
        return new Response(JSON.stringify({ error: "Task title required" }), { status: 400, headers })
      }

      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user

      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          project_id,
          title,
          description,
          status: status ?? "todo",
          priority: priority ?? "medium",
          start_date,
          due_date,
          team_id,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) throw error

      // Assign users if provided
      if (assignee_ids?.length) {
        const assignees = assignee_ids.map((user_id: string) => ({
          task_id: task.id,
          user_id,
        }))

        const { error: assignError } = await supabase.from("task_assignees").insert(assignees)
        if (assignError) console.log("⚠️ Assignee insert error:", assignError.message)

        // Update assigned_count
        await supabase
          .from("tasks")
          .update({ assigned_count: assignee_ids.length })
          .eq("id", task.id)
      }

      console.log("✅ Task created:", task.id)
      return new Response(JSON.stringify({ data: task }), { headers })
    }

    // ================= UPDATE =================
    if (action === "update") {
      const { task_id, title, description, status, priority, start_date, due_date, team_id, project_id } = body

      if (!task_id) {
        return new Response(JSON.stringify({ error: "task_id required" }), { status: 400, headers })
      }

      const updates: Record<string, unknown> = {}
      if (title !== undefined) updates.title = title
      if (description !== undefined) updates.description = description
      if (status !== undefined) {
        updates.status = status
        if (status === "done") updates.completed_at = new Date().toISOString()
        if (status !== "done") updates.completed_at = null
      }
      if (priority !== undefined) updates.priority = priority
      if (start_date !== undefined) updates.start_date = start_date
      if (due_date !== undefined) updates.due_date = due_date
      if (team_id !== undefined) updates.team_id = team_id
      if (project_id !== undefined) updates.project_id = project_id

      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", task_id)
        .select()
        .single()

      if (error) throw error

      console.log("✅ Task updated:", data.id)
      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= DELETE =================
    if (action === "delete") {
      const { task_id } = body

      if (!task_id) {
        return new Response(JSON.stringify({ error: "task_id required" }), { status: 400, headers })
      }

      const { error } = await supabase
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", task_id)

      if (error) throw error

      console.log("✅ Task soft deleted:", task_id)
      return new Response(JSON.stringify({ message: "Task deleted" }), { headers })
    }

    // ================= LIST =================
    if (action === "list") {
      const { project_id, team_id, status, priority, assigned_to } = body

      let query = supabase
        .from("tasks")
        .select(`
          *,
          task_assignees (
            id,
            user_id
          ),
          comments (id),
          attachments (id),
          projects (id, name)
        `)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })

      if (project_id) query = query.eq("project_id", project_id)
      if (team_id) query = query.eq("team_id", team_id)
      if (status) query = query.eq("status", status)
      if (priority) query = query.eq("priority", priority)

      const { data, error } = await query

      if (error) throw error

      // Filter by assignee if needed (post-query, since it's a join)
      const filtered = assigned_to
        ? data?.filter((t) => t.task_assignees?.some((a: { user_id: string }) => a.user_id === assigned_to))
        : data

      // Enrich with counts
      const enriched = filtered?.map((task) => ({
        ...task,
        comment_count: task.comments?.length ?? 0,
        attachment_count: task.attachments?.length ?? 0,
        comments: undefined,     // strip raw arrays
        attachments: undefined,
      }))

      console.log("✅ Tasks fetched:", enriched?.length)
      return new Response(JSON.stringify({ data: enriched }), { headers })
    }

    // ================= GET (single task with full detail) =================
    if (action === "get") {
      const { task_id } = body

      if (!task_id) {
        return new Response(JSON.stringify({ error: "task_id required" }), { status: 400, headers })
      }

      const { data, error } = await supabase
        .from("tasks")
        .select(`
          *,
          task_assignees (
            id,
            user_id,
            users:user_id (id, first_name, last_name, avatar_url, email)
          ),
          comments (
            id,
            content,
            created_at,
            user_id,
            users:user_id (id, first_name, last_name, avatar_url)
          ),
          attachments (id, file_name, file_url, file_size, created_at, uploaded_by),
          time_logs (id, user_id, start_time, end_time, duration),
          projects (id, name),
          recurring_tasks (id, frequency, next_run)
        `)
        .eq("id", task_id)
        .is("deleted_at", null)
        .single()

      if (error) throw error

      console.log("✅ Task fetched:", task_id)
      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= ASSIGN =================
    if (action === "assign") {
      const { task_id, user_id } = body

      if (!task_id || !user_id) {
        return new Response(JSON.stringify({ error: "task_id and user_id required" }), { status: 400, headers })
      }

      // Prevent duplicate assignment
      const { data: existing } = await supabase
        .from("task_assignees")
        .select("id")
        .eq("task_id", task_id)
        .eq("user_id", user_id)
        .single()

      if (existing) {
        return new Response(JSON.stringify({ error: "User already assigned" }), { status: 409, headers })
      }

      const { data, error } = await supabase
        .from("task_assignees")
        .insert({ task_id, user_id })
        .select()
        .single()

      if (error) throw error

      // Recalculate assigned_count
      const { count } = await supabase
        .from("task_assignees")
        .select("*", { count: "exact", head: true })
        .eq("task_id", task_id)

      await supabase.from("tasks").update({ assigned_count: count ?? 0 }).eq("id", task_id)

      console.log("✅ User assigned to task:", task_id)
      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= UNASSIGN =================
    if (action === "unassign") {
      const { task_id, user_id } = body

      if (!task_id || !user_id) {
        return new Response(JSON.stringify({ error: "task_id and user_id required" }), { status: 400, headers })
      }

      const { error } = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", task_id)
        .eq("user_id", user_id)

      if (error) throw error

      // Recalculate assigned_count
      const { count } = await supabase
        .from("task_assignees")
        .select("*", { count: "exact", head: true })
        .eq("task_id", task_id)

      await supabase.from("tasks").update({ assigned_count: count ?? 0 }).eq("id", task_id)

      console.log("✅ User unassigned from task:", task_id)
      return new Response(JSON.stringify({ message: "User unassigned" }), { headers })
    }

    // ================= COMMENT =================
    if (action === "comment") {
      const { task_id, content, team_id } = body

      if (!task_id || !content) {
        return new Response(JSON.stringify({ error: "task_id and content required" }), { status: 400, headers })
      }

      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user

      const { data, error } = await supabase
        .from("comments")
        .insert({
          task_id,
          content,
          team_id,
          user_id: user?.id,
        })
        .select(`
          *,
          users:user_id (id, first_name, last_name, avatar_url)
        `)
        .single()

      if (error) throw error

      console.log("✅ Comment added:", data.id)
      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= LOG TIME =================
    if (action === "log_time") {
      const { task_id, start_time, end_time, duration } = body

      if (!task_id) {
        return new Response(JSON.stringify({ error: "task_id required" }), { status: 400, headers })
      }

      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user

      // Auto-calculate duration in minutes if times provided but no duration
      let resolvedDuration = duration
      if (!resolvedDuration && start_time && end_time) {
        const ms = new Date(end_time).getTime() - new Date(start_time).getTime()
        resolvedDuration = Math.round(ms / 60000)
      }

      const { data, error } = await supabase
        .from("time_logs")
        .insert({
          task_id,
          user_id: user?.id,
          start_time,
          end_time,
          duration: resolvedDuration,
        })
        .select()
        .single()

      if (error) throw error

      console.log("✅ Time logged:", data.id)
      return new Response(JSON.stringify({ data }), { headers })
    }

    // ================= MOVE (change status or project) =================
    if (action === "move") {
      const { task_id, project_id, status } = body

      if (!task_id) {
        return new Response(JSON.stringify({ error: "task_id required" }), { status: 400, headers })
      }

      const updates: Record<string, unknown> = {}
      if (project_id) updates.project_id = project_id
      if (status) {
        updates.status = status
        if (status === "done") updates.completed_at = new Date().toISOString()
        if (status !== "done") updates.completed_at = null
      }

      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", task_id)
        .select()
        .single()

      if (error) throw error

      console.log("✅ Task moved:", task_id)
      return new Response(JSON.stringify({ data }), { headers })
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers })

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