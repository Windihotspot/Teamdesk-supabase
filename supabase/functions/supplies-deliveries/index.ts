import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { json, error, handleOptions, safeJson } from "../_shared/cors.service.ts"

console.log("🚚 SUPPLY DELIVERIES MODULE LOADED")

serve(async (req) => {
  console.log("\n🚚 SUPPLY DELIVERIES:", req.method, req.url)

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
      const status = url.searchParams.get("status")
      const page   = parseInt(url.searchParams.get("page") || "1")
      const limit  = parseInt(url.searchParams.get("limit") || "20")
      const offset = (page - 1) * limit

      let query = admin
        .from("supply_deliveries")
        .select(`
          *,
          purchase_orders ( id, po_number, suppliers ( name ), supplies ( id, name, unit ) ),
          supply_requests ( id, request_number ),
          received_by_user:received_by ( id, first_name, last_name )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq("delivery_status", status)

      const { data, error: dbErr, count } = await query
      if (dbErr) return error(req, "Failed to fetch deliveries", 500)
      return json(req, { deliveries: data, total: count, page, limit })
    }

    // ── GET single ────────────────────────────────────────
    if (req.method === "GET" && action === "get") {
      const id = url.searchParams.get("id")
      if (!id) return error(req, "id required")

      const { data, error: dbErr } = await admin
        .from("supply_deliveries")
        .select(`
          *,
          purchase_orders (*, suppliers(*), supplies(*)),
          supply_requests (id, request_number, requester_id),
          received_by_user:received_by (id, first_name, last_name, email),
          supply_attachments ( id, file_url, file_name, created_at )
        `)
        .eq("id", id)
        .single()

      if (dbErr) return error(req, "Delivery not found", 404)
      return json(req, data)
    }

    // ── POST create delivery record ───────────────────────
    if (req.method === "POST" && (!action || action === "create")) {
      const {
        purchase_order_id, request_id, tracking_number,
        courier, shipped_date, expected_date,
        quantity_ordered, delivery_address, delivery_notes,
      } = body || {}

      if (!purchase_order_id || !quantity_ordered)
        return error(req, "purchase_order_id and quantity_ordered are required")

      // Check PO exists and is not cancelled
      const { data: po } = await admin
        .from("purchase_orders")
        .select("id, status, supply_id, supplier_id")
        .eq("id", purchase_order_id)
        .single()

      if (!po) return error(req, "Purchase order not found", 404)
      if (po.status === "cancelled") return error(req, "Cannot create delivery for cancelled PO", 400)

      const { data, error: dbErr } = await admin
        .from("supply_deliveries")
        .insert({
          purchase_order_id,
          request_id:      request_id || null,
          delivery_status: "processing",
          tracking_number: tracking_number || null,
          courier:         courier || null,
          shipped_date:    shipped_date || null,
          expected_date:   expected_date || null,
          quantity_ordered,
          quantity_received: 0,
          delivery_address:  delivery_address || null,
          delivery_notes:    delivery_notes || null,
        })
        .select()
        .single()

      if (dbErr) return error(req, dbErr.message || "Failed to create delivery", 500)

      // Update PO status to sent (if still draft)
      if (po.status === "draft") {
        await admin.from("purchase_orders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", purchase_order_id)
      }

      return json(req, data, 201)
    }

    // ── PATCH update delivery status ──────────────────────
    if (req.method === "PATCH" && action === "update_status") {
      const { id, delivery_status, notes: statusNotes } = body || {}
      if (!id || !delivery_status) return error(req, "id and delivery_status required")

      const validStatuses = ["not_shipped","processing","shipped","out_for_delivery","delivered","returned","failed"]
      if (!validStatuses.includes(delivery_status))
        return error(req, `Invalid delivery_status. Must be: ${validStatuses.join(", ")}`)

      const updates: Record<string, unknown> = {
        delivery_status,
        updated_at: new Date().toISOString(),
      }
      if (statusNotes) updates.delivery_notes = statusNotes

      const { data, error: dbErr } = await admin
        .from("supply_deliveries")
        .update(updates)
        .eq("id", id)
        .select()
        .single()

      if (dbErr) return error(req, "Failed to update delivery status", 500)
      return json(req, data)
    }

    // ── PATCH confirm delivery received ───────────────────
    if (req.method === "PATCH" && action === "confirm_received") {
      const {
        id, quantity_received, quantity_damaged,
        proof_of_delivery_url, delivery_notes,
      } = body || {}

      if (!id || quantity_received === undefined)
        return error(req, "id and quantity_received required")

      // Fetch delivery to validate
      const { data: delivery } = await admin
        .from("supply_deliveries")
        .select("*, purchase_orders(id, po_number, supply_id, supplies(name))")
        .eq("id", id)
        .single()

      if (!delivery) return error(req, "Delivery not found", 404)
      if (delivery.delivery_status === "delivered")
        return error(req, "Delivery already confirmed", 400)

      const { data: updated, error: updateErr } = await admin
        .from("supply_deliveries")
        .update({
          delivery_status:      "delivered",
          actual_delivery_date:  new Date().toISOString().split("T")[0],
          quantity_received,
          quantity_damaged:      quantity_damaged || 0,
          received_by:           user.id,
          proof_of_delivery_url: proof_of_delivery_url || null,
          delivery_notes:        delivery_notes || delivery.delivery_notes,
          updated_at:            new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single()

      if (updateErr) return error(req, "Failed to confirm delivery", 500)

      // Update PO to fulfilled
      await admin
        .from("purchase_orders")
        .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
        .eq("id", delivery.purchase_order_id)

      // Update request status to delivered
      if (delivery.request_id) {
        await admin
          .from("supply_requests")
          .update({ status: "delivered" })
          .eq("id", delivery.request_id)

        // Notify requester
        const { data: request } = await admin
          .from("supply_requests")
          .select("requester_id, request_number")
          .eq("id", delivery.request_id)
          .single()

        if (request) {
          await admin.from("notifications").insert({
            user_id: request.requester_id,
            title:   `Delivery Received: ${request.request_number}`,
            message: `Your supply request for ${delivery.purchase_orders?.supplies?.name} has been delivered and added to stock.`,
          })

          // Queue confirmation email
          const { data: requesterUser } = await admin
            .from("users")
            .select("email, first_name, last_name")
            .eq("id", request.requester_id)
            .single()

          if (requesterUser) {
            await admin.from("email_queue").insert({
              to_email:      requesterUser.email,
              to_name:       `${requesterUser.first_name} ${requesterUser.last_name}`,
              subject:       `Delivery Confirmed — ${delivery.purchase_orders?.po_number}`,
              template_key:  "delivery_confirmed",
              template_data: {
                po_number:         delivery.purchase_orders?.po_number,
                recipient_name:    `${requesterUser.first_name} ${requesterUser.last_name}`,
                supply_name:       delivery.purchase_orders?.supplies?.name,
                quantity_received,
                received_by:       user.email,
                delivery_date:     new Date().toISOString().split("T")[0],
              },
              reference_id:   id,
              reference_type: "delivery",
            })
          }
        }
      }

      return json(req, updated)
    }

    // ── PATCH update tracking ─────────────────────────────
    if (req.method === "PATCH" && action === "update_tracking") {
      const { id, tracking_number, courier, shipped_date, expected_date } = body || {}
      if (!id) return error(req, "id required")

      const { data, error: dbErr } = await admin
        .from("supply_deliveries")
        .update({
          tracking_number: tracking_number || null,
          courier:         courier || null,
          shipped_date:    shipped_date || null,
          expected_date:   expected_date || null,
          delivery_status: "shipped",
          updated_at:      new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single()

      if (dbErr) return error(req, "Failed to update tracking", 500)
      return json(req, data)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})