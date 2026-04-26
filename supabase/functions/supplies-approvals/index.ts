import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { json, error, handleOptions, safeJson } from "../_shared/cors.service.ts"

console.log("✅ SUPPLY APPROVALS MODULE LOADED")

serve(async (req) => {
  console.log("\n✅ SUPPLY APPROVALS:", req.method, req.url)

  if (req.method === "OPTIONS") return handleOptions(req)

  try {
    const userClient = supabaseAnon(req)
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return error(req, "Unauthorized", 401)

    const admin  = supabaseAdmin()
    const url    = new URL(req.url)
    const body   = req.method !== "GET" ? await safeJson(req) as any : null
    const action = url.searchParams.get("action") || body?.action

    // ── GET pending approvals for this approver ────────────
    if (req.method === "GET" && (!action || action === "pending")) {
      const { data, error: dbErr } = await admin
        .from("v_supply_requests_full")
        .select("*")
        .eq("approver_id", user.id)
        .eq("status", "pending_approval")
        .order("submitted_at")

      if (dbErr) return error(req, "Failed to fetch pending approvals", 500)
      return json(req, data)
    }

    // ── GET approval history (for a request) ──────────────
    if (req.method === "GET" && action === "history") {
      const request_id = url.searchParams.get("request_id")
      if (!request_id) return error(req, "request_id required")

      const { data, error: dbErr } = await admin
        .from("approval_history")
        .select(`
          *,
          users:approver_id ( id, first_name, last_name, avatar_url, email )
        `)
        .eq("request_id", request_id)
        .order("decided_at")

      if (dbErr) return error(req, "Failed to fetch history", 500)
      return json(req, data)
    }

    // ── POST approve ──────────────────────────────────────
    if (req.method === "POST" && action === "approve") {
      const { request_id, quantity_approved, comments } = body || {}
      if (!request_id) return error(req, "request_id required")

      // Fetch request
      const { data: request, error: reqErr } = await admin
        .from("supply_requests")
        .select(`
          *, 
          supplies ( id, name, current_stock, unit_price ),
          users:requester_id ( id, email, first_name, last_name )
        `)
        .eq("id", request_id)
        .single()

      if (reqErr || !request) return error(req, "Request not found", 404)
      if (request.current_approver_id !== user.id)
        return error(req, "Forbidden — you are not the assigned approver for this request", 403)
      if (request.status !== "pending_approval")
        return error(req, `Cannot approve a request in '${request.status}' status`, 400)

      const finalQty = quantity_approved ?? request.quantity_requested

      if (finalQty > request.supplies.current_stock)
        return error(req, `Approved quantity exceeds available stock (${request.supplies.current_stock})`, 400)

      // Check if multi-level workflow has more levels
      const { data: nextWorkflow } = await admin
        .from("approval_workflows")
        .select("*")
        .eq("workflow_id", request.workflow_id)
        .eq("level", (request.current_level || 1) + 1)
        .eq("is_active", true)
        .maybeSingle()

      const newStatus = nextWorkflow ? "pending_approval" : "approved"

      // Update request
      const { data: updated, error: updateErr } = await admin
        .from("supply_requests")
        .update({
          status:              newStatus,
          quantity_approved:   finalQty,
          approved_total:      finalQty * request.supplies.unit_price,
          approved_at:         newStatus === "approved" ? new Date().toISOString() : null,
          current_approver_id: nextWorkflow?.approver_user_id || null,
          current_level:       (request.current_level || 1) + (nextWorkflow ? 1 : 0),
        })
        .eq("id", request_id)
        .select()
        .single()

      if (updateErr) return error(req, "Failed to approve request", 500)

      // Log approval history
      await admin.from("approval_history").insert({
        request_id,
        approver_id: user.id,
        decision:    "approved",
        level:       request.current_level || 1,
        comments:    comments || null,
      })

      // Notify requester
      await admin.from("notifications").insert({
        user_id: request.requester_id,
        title:   `Request ${request.request_number} Approved ✓`,
        message: `Your request for ${request.supplies.name} has been approved by ${user.email}.`,
      })

      // If next level — notify next approver
      if (nextWorkflow?.approver_user_id) {
        await admin.from("notifications").insert({
          user_id: nextWorkflow.approver_user_id,
          title:   `Approval Required: ${request.request_number}`,
          message: `A supply request for ${request.supplies.name} requires your approval (Level ${nextWorkflow.level}).`,
        })
      }

      return json(req, updated)
    }

    // ── POST reject ───────────────────────────────────────
    if (req.method === "POST" && action === "reject") {
      const { request_id, rejection_reason, comments } = body || {}
      if (!request_id) return error(req, "request_id required")
      if (!rejection_reason) return error(req, "rejection_reason required")

      const { data: request, error: reqErr } = await admin
        .from("supply_requests")
        .select("*, supplies ( id, name ), users:requester_id ( id, email )")
        .eq("id", request_id)
        .single()

      if (reqErr || !request) return error(req, "Request not found", 404)
      if (request.current_approver_id !== user.id)
        return error(req, "Forbidden — not the assigned approver", 403)
      if (request.status !== "pending_approval")
        return error(req, `Cannot reject in '${request.status}' status`, 400)

      const { data: updated, error: updateErr } = await admin
        .from("supply_requests")
        .update({
          status:           "rejected",
          rejection_reason,
          rejected_at:      new Date().toISOString(),
        })
        .eq("id", request_id)
        .select()
        .single()

      if (updateErr) return error(req, "Failed to reject request", 500)

      // Log history
      await admin.from("approval_history").insert({
        request_id,
        approver_id: user.id,
        decision:    "rejected",
        level:       request.current_level || 1,
        comments:    comments || rejection_reason,
      })

      // Notify requester
      await admin.from("notifications").insert({
        user_id: request.requester_id,
        title:   `Request ${request.request_number} Rejected`,
        message: `Your request for ${request.supplies.name} was rejected. Reason: ${rejection_reason}`,
      })

      return json(req, updated)
    }

    // ── POST escalate ─────────────────────────────────────
    if (req.method === "POST" && action === "escalate") {
      const { request_id, escalate_to_user_id, comments } = body || {}
      if (!request_id || !escalate_to_user_id)
        return error(req, "request_id and escalate_to_user_id required")

      const { data: request } = await admin
        .from("supply_requests")
        .select("*, supplies ( name )")
        .eq("id", request_id)
        .single()

      if (!request) return error(req, "Request not found", 404)
      if (request.current_approver_id !== user.id)
        return error(req, "Forbidden", 403)

      const { data: updated, error: updateErr } = await admin
        .from("supply_requests")
        .update({ current_approver_id: escalate_to_user_id })
        .eq("id", request_id)
        .select()
        .single()

      if (updateErr) return error(req, "Failed to escalate", 500)

      await admin.from("approval_history").insert({
        request_id,
        approver_id: user.id,
        decision:    "escalated",
        level:       request.current_level || 1,
        comments:    comments || "Escalated to another approver",
      })

      await admin.from("notifications").insert({
        user_id: escalate_to_user_id,
        title:   `Request Escalated to You: ${request.request_number}`,
        message: `A supply request for ${request.supplies.name} has been escalated to you for approval.`,
      })

      return json(req, updated)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})