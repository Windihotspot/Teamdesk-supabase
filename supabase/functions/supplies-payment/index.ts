import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { json, error, handleOptions, safeJson } from "../_shared/cors.service.ts"

console.log("💳 SUPPLY PAYMENTS MODULE LOADED")

serve(async (req) => {
  console.log("\n💳 SUPPLY PAYMENTS:", req.method, req.url)

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
        .from("supply_payments")
        .select(`
          *,
          purchase_orders ( id, po_number, grand_total, suppliers ( name ) ),
          supply_requests ( id, request_number ),
          paid_by_user:paid_by     ( id, first_name, last_name ),
          approved_by_user:approved_by ( id, first_name, last_name )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq("payment_status", status)

      const { data, error: dbErr, count } = await query
      if (dbErr) return error(req, "Failed to fetch payments", 500)
      return json(req, { payments: data, total: count, page, limit })
    }

    // ── GET single ────────────────────────────────────────
    if (req.method === "GET" && action === "get") {
      const id = url.searchParams.get("id")
      if (!id) return error(req, "id required")

      const { data, error: dbErr } = await admin
        .from("supply_payments")
        .select(`
          *,
          purchase_orders (*, suppliers(*), supplies(*)),
          supply_requests (id, request_number, requester_id),
          paid_by_user:paid_by (id, first_name, last_name, email),
          approved_by_user:approved_by (id, first_name, last_name, email),
          supply_attachments ( id, file_url, file_name, file_size, created_at )
        `)
        .eq("id", id)
        .single()

      if (dbErr) return error(req, "Payment not found", 404)
      return json(req, data)
    }

    // ── POST record payment ───────────────────────────────
    if (req.method === "POST" && (!action || action === "record")) {
      const {
        payment_id, amount_paid, payment_method,
        payment_reference, payment_date, notes, receipt_url,
      } = body || {}

      if (!payment_id || !amount_paid || !payment_method)
        return error(req, "payment_id, amount_paid and payment_method are required")

      // Fetch existing payment record
      const { data: existing, error: fetchErr } = await admin
        .from("supply_payments")
        .select("*, purchase_orders(id, po_number, suppliers(name, email))")
        .eq("id", payment_id)
        .single()

      if (fetchErr || !existing) return error(req, "Payment record not found", 404)
      if (existing.payment_status === "paid") return error(req, "Payment already fully paid", 400)

      const totalPaid   = existing.amount_paid + amount_paid
      const newStatus   = totalPaid >= existing.amount_due
        ? "paid"
        : "partially_paid"

      if (totalPaid > existing.amount_due)
        return error(req, `Payment of ₦${amount_paid} would exceed amount due (₦${existing.amount_due})`, 400)

      const { data: updated, error: updateErr } = await admin
        .from("supply_payments")
        .update({
          amount_paid:       totalPaid,
          payment_status:    newStatus,
          payment_method,
          payment_reference: payment_reference || null,
          payment_date:      payment_date || new Date().toISOString().split("T")[0],
          paid_by:           user.id,
          receipt_url:       receipt_url || null,
          notes:             notes || null,
          updated_at:        new Date().toISOString(),
        })
        .eq("id", payment_id)
        .select()
        .single()

      if (updateErr) return error(req, "Failed to record payment", 500)

      // Queue confirmation email if fully paid
      if (newStatus === "paid" && existing.purchase_orders?.suppliers?.email) {
        await admin.from("email_queue").insert({
          to_email:      existing.purchase_orders.suppliers.email,
          to_name:       existing.purchase_orders.suppliers.name,
          subject:       `Payment Confirmed — ${existing.purchase_orders.po_number}`,
          template_key:  "payment_confirmed",
          template_data: {
            po_number:         existing.purchase_orders.po_number,
            recipient_name:    existing.purchase_orders.suppliers.name,
            amount_paid:       `₦${totalPaid.toLocaleString()}`,
            payment_reference: payment_reference || "N/A",
            payment_date:      payment_date || new Date().toISOString().split("T")[0],
          },
          reference_id:   payment_id,
          reference_type: "payment",
        })
      }

      return json(req, updated)
    }

    // ── PATCH approve payment ─────────────────────────────
    if (req.method === "PATCH" && action === "approve") {
      const { payment_id } = body || {}
      if (!payment_id) return error(req, "payment_id required")

      const { data, error: dbErr } = await admin
        .from("supply_payments")
        .update({
          approved_by: user.id,
          updated_at:  new Date().toISOString(),
        })
        .eq("id", payment_id)
        .select()
        .single()

      if (dbErr) return error(req, "Failed to approve payment", 500)
      return json(req, data)
    }

    // ── GET payment summary (dashboard) ──────────────────
    if (req.method === "GET" && action === "summary") {
      const { data, error: dbErr } = await admin
        .from("supply_payments")
        .select("payment_status, amount_due, amount_paid, balance")

      if (dbErr) return error(req, "Failed to fetch summary", 500)

      const summary = {
        total_due:     (data || []).reduce((a: number, r: any) => a + Number(r.amount_due), 0),
        total_paid:    (data || []).reduce((a: number, r: any) => a + Number(r.amount_paid), 0),
        total_balance: (data || []).reduce((a: number, r: any) => a + Number(r.balance), 0),
        unpaid:        (data || []).filter((r: any) => r.payment_status === "unpaid").length,
        partially_paid:(data || []).filter((r: any) => r.payment_status === "partially_paid").length,
        paid:          (data || []).filter((r: any) => r.payment_status === "paid").length,
      }

      return json(req, summary)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})