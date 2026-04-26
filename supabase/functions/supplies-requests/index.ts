import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { corsHeaders, json, error, handleOptions, safeJson } from "../_shared/cors.service.ts"

console.log("📋 SUPPLY REQUESTS MODULE LOADED")

serve(async (req) => {
  console.log("\n📋 SUPPLY REQUESTS:", req.method, req.url)

  if (req.method === "OPTIONS") return handleOptions(req)

  try {
    const userClient = supabaseAnon(req)
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return error(req, "Unauthorized", 401)

    const admin = supabaseAdmin()
    const url   = new URL(req.url)
    const body  = req.method !== "GET" ? await safeJson(req) as any : null
    const action = url.searchParams.get("action") || body?.action

    // ── GET list ──────────────────────────────────────────
    if (req.method === "GET" && (!action || action === "list")) {
      const status     = url.searchParams.get("status")
      const requester  = url.searchParams.get("requester_id")
      const my_approvals = url.searchParams.get("my_approvals") === "true"
      const page       = parseInt(url.searchParams.get("page") || "1")
      const limit      = parseInt(url.searchParams.get("limit") || "20")
      const offset     = (page - 1) * limit

      let query = admin
        .from("v_supply_requests_full")
        .select("*", { count: "exact" })
        .order("submitted_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (status)        query = query.eq("status", status)
      if (requester)     query = query.eq("requester_id", requester)
      if (my_approvals)  query = query.eq("approver_id", user.id).eq("status", "pending_approval")

      const { data, error: dbErr, count } = await query
      if (dbErr) {
        console.error("❌ list error:", dbErr)
        return error(req, "Failed to fetch requests", 500)
      }

      return json(req, { requests: data, total: count, page, limit })
    }

    // ── GET single request ────────────────────────────────
    if (req.method === "GET" && action === "get") {
      const id = url.searchParams.get("id")
      if (!id) return error(req, "id required")

      const { data, error: dbErr } = await admin
        .from("v_supply_requests_full")
        .select("*")
        .eq("id", id)
        .single()

      if (dbErr) return error(req, "Request not found", 404)

      // fetch comments + attachments
      const [{ data: comments }, { data: attachments }] = await Promise.all([
        admin.from("supply_request_comments")
          .select(`*, users:user_id ( id, first_name, last_name, avatar_url )`)
          .eq("request_id", id)
          .order("created_at"),
        admin.from("supply_attachments")
          .select(`*, users:uploaded_by ( id, first_name, last_name )`)
          .eq("request_id", id)
          .order("created_at"),
      ])

      return json(req, { ...data, comments, attachments })
    }

    // ── POST create request ───────────────────────────────
    if (req.method === "POST" && (!action || action === "create")) {
      const {
        supply_id, quantity_requested, priority,
        needed_by_date, reason, team_id,
      } = body || {}

      if (!supply_id || !quantity_requested)
        return error(req, "supply_id and quantity_requested are required")

      // Get supply price snapshot + check stock
      const { data: supply, error: supErr } = await admin
        .from("supplies")
        .select("id, name, unit_price, current_stock, reorder_level, is_active, deleted_at")
        .eq("id", supply_id)
        .single()

      if (supErr || !supply) return error(req, "Supply not found", 404)
      if (!supply.is_active || supply.deleted_at) return error(req, "Supply is no longer active", 400)
      if (supply.current_stock < quantity_requested)
        return error(req, `Insufficient stock. Available: ${supply.current_stock}`, 400)

      // Find matching approval workflow
      const { data: workflow } = await admin
        .from("approval_workflows")
        .select("*")
        .eq("is_active", true)
        .lte("min_amount", supply.unit_price * quantity_requested)
        .or(`max_amount.is.null,max_amount.gte.${supply.unit_price * quantity_requested}`)
        .or(`category_id.is.null,category_id.eq.${supply.category_id}`)
        .order("level")
        .limit(1)
        .maybeSingle()

      const { data: newRequest, error: insertErr } = await admin
        .from("supply_requests")
        .insert({
          requester_id:          user.id,
          team_id:               team_id || null,
          supply_id,
          quantity_requested,
          unit_price_at_request: supply.unit_price,
          priority:              priority || "normal",
          status:                "pending_approval",
          needed_by_date:        needed_by_date || null,
          reason:                reason || null,
          workflow_id:           workflow?.id || null,
          current_approver_id:   workflow?.approver_user_id || null,
          current_level:         1,
        })
        .select()
        .single()

      if (insertErr) {
        console.error("❌ create request error:", insertErr)
        return error(req, insertErr.message || "Failed to create request", 500)
      }

      // in-app notification to approver
      if (workflow?.approver_user_id) {
        await admin.from("notifications").insert({
          user_id: workflow.approver_user_id,
          title:   `New Supply Request: ${supply.name}`,
          message: `${user.email} requested ${quantity_requested} unit(s) of ${supply.name}. Request #${newRequest.request_number}`,
        })
      }

      return json(req, newRequest, 201)
    }

    // ── PATCH cancel request ──────────────────────────────
    if (req.method === "PATCH" && action === "cancel") {
      const { id } = body || {}
      if (!id) return error(req, "id required")

      // only the requester can cancel, and only if pending
      const { data: existing } = await admin
        .from("supply_requests")
        .select("id, requester_id, status, request_number")
        .eq("id", id)
        .single()

      if (!existing) return error(req, "Request not found", 404)
      if (existing.requester_id !== user.id) return error(req, "Forbidden — not your request", 403)
      if (!["draft", "pending_approval"].includes(existing.status))
        return error(req, `Cannot cancel a request in '${existing.status}' status`, 400)

      const { data, error: dbErr } = await admin
        .from("supply_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single()

      if (dbErr) return error(req, "Failed to cancel request", 500)
      return json(req, data)
    }

    // ── POST add comment ──────────────────────────────────
    if (req.method === "POST" && action === "add_comment") {
      const { request_id, content } = body || {}
      if (!request_id || !content) return error(req, "request_id and content required")

      const { data, error: dbErr } = await admin
        .from("supply_request_comments")
        .insert({ request_id, user_id: user.id, content })
        .select(`*, users:user_id ( id, first_name, last_name, avatar_url )`)
        .single()

      if (dbErr) return error(req, "Failed to add comment", 500)
      return json(req, data, 201)
    }

    // ── GET my stats ──────────────────────────────────────
    if (req.method === "GET" && action === "my_stats") {
      const { data, error: dbErr } = await admin
        .from("supply_requests")
        .select("status")
        .eq("requester_id", user.id)

      if (dbErr) return error(req, "Failed to fetch stats", 500)

      const stats = (data || []).reduce((acc: Record<string, number>, r: any) => {
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
      }, {})

      return json(req, stats)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})