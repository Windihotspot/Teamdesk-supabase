import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { json, error, handleOptions, safeJson } from "../_shared/cors.ts"

console.log("🛒 PURCHASE ORDERS MODULE LOADED")

serve(async (req) => {
  console.log("\n🛒 PURCHASE ORDERS:", req.method, req.url)

  if (req.method === "OPTIONS") return handleOptions(req)

  try {
    const userClient = supabaseAnon(req)
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return error(req, "Unauthorized", 401)

    const admin  = supabaseAdmin()
    const url    = new URL(req.url)
    const body   = req.method !== "GET" ? await safeJson(req) as any : null
    const action = url.searchParams.get("action") || body?.action

    // ── GET list ──────────────────────────────────────────
    if (req.method === "GET" && (!action || action === "list")) {
      const status   = url.searchParams.get("status")
      const page     = parseInt(url.searchParams.get("page") || "1")
      const limit    = parseInt(url.searchParams.get("limit") || "20")
      const offset   = (page - 1) * limit

      let query = admin
        .from("purchase_orders")
        .select(`
          *,
          suppliers ( id, name, email, contact_person ),
          supplies  ( id, name, unit, supply_categories ( name, color ) ),
          supply_requests ( id, request_number, requester_id ),
          raised_by_user:raised_by ( id, first_name, last_name )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq("status", status)

      const { data, error: dbErr, count } = await query
      if (dbErr) return error(req, "Failed to fetch POs", 500)
      return json(req, { purchase_orders: data, total: count, page, limit })
    }

    // ── GET single ────────────────────────────────────────
    if (req.method === "GET" && action === "get") {
      const id = url.searchParams.get("id")
      if (!id) return error(req, "id required")

      const { data, error: dbErr } = await admin
        .from("purchase_orders")
        .select(`
          *,
          suppliers (*),
          supplies  (*, supply_categories(*)),
          supply_requests (id, request_number, requester_id, quantity_approved, reason),
          raised_by_user:raised_by (id, first_name, last_name, email),
          supply_payments (*),
          supply_deliveries (*)
        `)
        .eq("id", id)
        .single()

      if (dbErr) return error(req, "PO not found", 404)
      return json(req, data)
    }

    // ── POST create PO from approved request ──────────────
    if (req.method === "POST" && (!action || action === "create")) {
      const {
        request_id, supplier_id, unit_price,
        quantity, expected_delivery_date, notes, tax_amount,
      } = body || {}

      if (!request_id || !supplier_id || !unit_price || !quantity)
        return error(req, "request_id, supplier_id, unit_price and quantity are required")

      // Validate request is approved
      const { data: request } = await admin
        .from("supply_requests")
        .select("*, supplies ( id, name )")
        .eq("id", request_id)
        .single()

      if (!request) return error(req, "Request not found", 404)
      if (request.status !== "approved")
        return error(req, "Can only raise PO for approved requests", 400)

      const grandTotal = (unit_price * quantity) + (tax_amount || 0)

      const { data: po, error: poErr } = await admin
        .from("purchase_orders")
        .insert({
          request_id,
          supplier_id,
          supply_id:             request.supply_id,
          unit_price,
          quantity,
          tax_amount:            tax_amount || 0,
          grand_total:           grandTotal,
          expected_delivery_date: expected_delivery_date || null,
          notes:                 notes || null,
          raised_by:             user.id,
          status:                "draft",
        })
        .select(`*, suppliers(*), supplies(*)`)
        .single()

      if (poErr) {
        console.error("❌ create PO error:", poErr)
        return error(req, poErr.message || "Failed to create PO", 500)
      }

      // Update request status to 'ordered'
      await admin
        .from("supply_requests")
        .update({ status: "ordered" })
        .eq("id", request_id)

      // Auto-create payment record
      await admin.from("supply_payments").insert({
        purchase_order_id: po.id,
        request_id,
        payment_status: "unpaid",
        amount_due:     grandTotal,
        amount_paid:    0,
        currency:       "NGN",
      })

      return json(req, po, 201)
    }

    // ── PATCH update status ───────────────────────────────
    if (req.method === "PATCH" && action === "update_status") {
      const { id, status, notes: statusNotes } = body || {}
      if (!id || !status) return error(req, "id and status required")

      const validStatuses = ["draft", "sent", "acknowledged", "fulfilled", "cancelled"]
      if (!validStatuses.includes(status))
        return error(req, `Invalid status. Must be one of: ${validStatuses.join(", ")}`)

      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (status === "sent")         updates.sent_at          = new Date().toISOString()
      if (status === "acknowledged") updates.acknowledged_at  = new Date().toISOString()
      if (status === "fulfilled")    updates.fulfilled_at     = new Date().toISOString()
      if (statusNotes)               updates.notes            = statusNotes

      const { data, error: dbErr } = await admin
        .from("purchase_orders")
        .update(updates)
        .eq("id", id)
        .select()
        .single()

      if (dbErr) return error(req, "Failed to update PO status", 500)

      // If sent, queue email to supplier
      if (status === "sent") {
        const { data: fullPo } = await admin
          .from("purchase_orders")
          .select("*, suppliers(*), supplies(*)")
          .eq("id", id)
          .single()

        if (fullPo?.suppliers?.email) {
          await admin.from("email_queue").insert({
            to_email:      fullPo.suppliers.email,
            to_name:       fullPo.suppliers.name,
            subject:       `Purchase Order ${fullPo.po_number} from TeamDesk`,
            template_key:  "po_raised",
            template_data: {
              po_number:              fullPo.po_number,
              supplier_name:          fullPo.suppliers.name,
              supply_name:            fullPo.supplies.name,
              quantity:               fullPo.quantity,
              unit_price:             `₦${fullPo.unit_price.toLocaleString()}`,
              total_amount:           `₦${fullPo.total_amount.toLocaleString()}`,
              expected_delivery_date: fullPo.expected_delivery_date || "TBD",
            },
            reference_id:   fullPo.id,
            reference_type: "purchase_order",
          })
        }
      }

      return json(req, data)
    }

    // ── PATCH update PO details ───────────────────────────
    if (req.method === "PATCH" && action === "update") {
      const { id, ...updates } = body || {}
      if (!id) return error(req, "id required")

      if (updates.unit_price && updates.quantity) {
        updates.grand_total = (updates.unit_price * updates.quantity) + (updates.tax_amount || 0)
      }
      updates.updated_at = new Date().toISOString()

      const { data, error: dbErr } = await admin
        .from("purchase_orders")
        .update(updates)
        .eq("id", id)
        .select()
        .single()

      if (dbErr) return error(req, "Failed to update PO", 500)
      return json(req, data)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})