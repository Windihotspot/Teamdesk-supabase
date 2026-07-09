// supabase/functions/teams/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { supabaseAnon } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req: Request) => {
  const headers = corsHeaders(req)

  console.log("====================================")
  console.log("🚀 TEAMS FUNCTION HIT")
  console.log("Method:", req.method)

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  try {
    const supabase = supabaseAnon(req)
    const body = await req.json()
    const { action } = body

    console.log("📦 Incoming body:", body)

    // ================= HELPER: USER ENRICHMENT =================
    const enrichTeamsWithOwners = async (teams: any[]) => {
      const ownerIds = [...new Set(teams.map(t => t.owner_id).filter(Boolean))]

      const { data: users } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, avatar_url")
        .in("id", ownerIds)

      const userMap = Object.fromEntries(
        (users ?? []).map(u => [u.id, u])
      )

      return teams.map(team => ({
        ...team,
        owner: userMap[team.owner_id] ?? null
      }))
    }

    // ================= CREATE TEAM =================
    if (action === "create_team") {
      const { name, description, owner_id } = body

      if (!name?.trim()) {
        return new Response(JSON.stringify({ error: "Team name is required" }), { status: 400, headers })
      }

      const { data: existing } = await supabase
        .from("teams")
        .select("id")
        .eq("name", name.trim())
        .maybeSingle()

      if (existing) {
        return new Response(JSON.stringify({ error: "Team already exists" }), { status: 409, headers })
      }

      const { data: team, error } = await supabase
        .from("teams")
        .insert({
          name: name.trim(),
          description,
          owner_id
        })
        .select("*")
        .single()

      if (error) throw error

      // auto add owner as member
      await supabase.from("team_members").insert({
        team_id: team.id,
        user_id: owner_id,
        role: "admin"
      })

      const enriched = (await enrichTeamsWithOwners([team]))[0]

      return new Response(JSON.stringify({ data: enriched }), {
        status: 201,
        headers
      })
    }

    // ================= UPDATE TEAM =================
    if (action === "update_team") {
      const { team_id, name, description, owner_id } = body

      const updates: any = {}
      if (name !== undefined) updates.name = name.trim()
      if (description !== undefined) updates.description = description
      if (owner_id !== undefined) updates.owner_id = owner_id

      const { data, error } = await supabase
        .from("teams")
        .update(updates)
        .eq("id", team_id)
        .select("*")
        .single()

      if (error) throw error

      const enriched = (await enrichTeamsWithOwners([data]))[0]

      return new Response(JSON.stringify({ data: enriched }), { headers })
    }

    // ================= DELETE TEAM =================
    if (action === "delete_team") {
      const { team_id } = body

      await supabase.from("team_members").delete().eq("team_id", team_id)
      await supabase.from("teams").delete().eq("id", team_id)

      return new Response(JSON.stringify({ message: "Team deleted" }), { headers })
    }

    // ================= GET TEAM =================
    if (action === "get_team") {
      const { team_id } = body

      const { data: team } = await supabase
        .from("teams")
        .select("*")
        .eq("id", team_id)
        .single()

      const { data: members } = await supabase
        .from("team_members")
        .select("id, role, created_at, user_id")
        .eq("team_id", team_id)

      const userIds = [...new Set(members?.map(m => m.user_id) ?? [])]

      const { data: users } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, avatar_url")
        .in("id", userIds)

      const userMap = Object.fromEntries((users ?? []).map(u => [u.id, u]))

      const enrichedMembers = (members ?? []).map(m => ({
        ...m,
        user: userMap[m.user_id] ?? null
      }))

      const enrichedTeam = (await enrichTeamsWithOwners([team]))[0]

      return new Response(JSON.stringify({
        data: {
          ...enrichedTeam,
          team_members: enrichedMembers
        }
      }), { headers })
    }

    // ================= LIST TEAMS =================
    if (action === "list_teams") {
      const { search, owner_id, page = 1, limit = 20 } = body

      const safeLimit = Math.min(limit, 100)
      const offset = (page - 1) * safeLimit

      let query = supabase
        .from("teams")
        .select("*")
        .order("created_at", { ascending: false })
        .range(offset, offset + safeLimit - 1)

      if (search) query = query.ilike("name", `%${search}%`)
      if (owner_id) query = query.eq("owner_id", owner_id)

      const { data: teams, error, count } = await query

      if (error) throw error

      const enriched = await enrichTeamsWithOwners(teams ?? [])

      return new Response(JSON.stringify({
        data: enriched,
        meta: {
          total: count ?? 0,
          page,
          limit: safeLimit
        }
      }), { headers })
    }

    // ================= ADD MEMBER =================
    if (action === "add_member") {
      const { team_id, user_id, role = "member" } = body

      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("id", user_id)
        .maybeSingle()

      if (!user) {
        return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers })
      }

      const { data, error } = await supabase
        .from("team_members")
        .insert({ team_id, user_id, role })
        .select("id, role, created_at, user_id")
        .single()

      if (error) throw error

      return new Response(JSON.stringify({ data }), { status: 201, headers })
    }

    // ================= LIST MEMBERS =================
    if (action === "list_members") {
      const { team_id } = body

      const { data: members } = await supabase
        .from("team_members")
        .select("id, role, created_at, user_id")
        .eq("team_id", team_id)

      const userIds = [...new Set(members?.map(m => m.user_id) ?? [])]

      const { data: users } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, avatar_url")
        .in("id", userIds)

      const userMap = Object.fromEntries((users ?? []).map(u => [u.id, u]))

      const enriched = (members ?? []).map(m => ({
        ...m,
        user: userMap[m.user_id] ?? null
      }))

      return new Response(JSON.stringify({ data: enriched }), { headers })
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers
    })

  } catch (err) {
    console.log("💥 UNHANDLED ERROR:", err)

    return new Response(
      JSON.stringify({ error: err.message || "Unexpected error" }),
      { status: 500, headers }
    )
  } finally {
    console.log("====================================")
    console.log("🏁 REQUEST COMPLETE")
  }
})