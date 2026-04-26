import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { corsHeaders, json, error, handleOptions, safeJson } from "../_shared/cors.service.ts"

console.log("📦 SUPPLIES MODULE LOADED")

// ─── helpers ─────────────────────────────────────────────
const requireAuth = async (req: Request) => {
  const client = supabaseAnon(req)
  const { data: { user } } = await client.auth.getUser()
  return user
}

// ─── MAIN ─────────────────────────────────────────────────
serve(async (req) => {
  console.log("\n📦 SUPPLIES REQUEST:", req.method, req.url)

  if (req.method === "OPTIONS") return handleOptions(req)

  try {
    const user = await requireAuth(req)
    if (!user) return error(req, "Unauthorized", 401)

    const url = new URL(req.url)
    const action = url.searchParams.get("action") || (await safeJson(req) as any)?.action

    const body = req.method !== "GET" ? await safeJson(req) as any : null
    const admin = supabaseAdmin()

    // ── GET /supplies?action=list ─────────────────────────
    if (req.method === "GET" && (!action || action === "list")) {
      const category_id = url.searchParams.get("category_id")
      const status      = url.searchParams.get("status")        // in_stock | low_stock | out_of_stock
      const search      = url.searchParams.get("search")
      const page        = parseInt(url.searchParams.get("page") || "1")
      const limit       = parseInt(url.searchParams.get("limit") || "50")
      const offset      = (page - 1) * limit

      let query = admin
        .from("supplies")
        .select(`
          *,
          supply_categories ( id, name, color, icon ),
          suppliers ( id, name, contact_person, email, phone )
        `, { count: "exact" })
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name")
        .range(offset, offset + limit - 1)

      if (category_id) query = query.eq("category_id", category_id)
      if (search)      query = query.ilike("name", `%${search}%`)

      if (status === "out_of_stock") query = query.eq("current_stock", 0)
      else if (status === "low_stock")
        query = query.gt("current_stock", 0).lte("current_stock", admin.rpc) // handled in RPC below

      const { data, error: dbErr, count } = await query

      if (dbErr) {
        console.error("❌ list error:", dbErr)
        return error(req, "Failed to fetch supplies", 500)
      }

      // client-side low_stock filter (current_stock <= reorder_level)
      const filtered = status === "low_stock"
        ? data?.filter((s: any) => s.current_stock > 0 && s.current_stock <= s.reorder_level)
        : data

      return json(req, { supplies: filtered, total: count, page, limit })
    }

    // ── GET /supplies?action=categories ──────────────────
    if (req.method === "GET" && action === "categories") {
      const { data, error: dbErr } = await admin
        .from("supply_categories")
        .select("*")
        .eq("is_active", true)
        .order("name")

      if (dbErr) return error(req, "Failed to fetch categories", 500)
      return json(req, data)
    }

    // ── GET /supplies?action=suppliers ───────────────────
    if (req.method === "GET" && action === "suppliers") {
      const { data, error: dbErr } = await admin
        .from("suppliers")
        .select("*")
        .eq("is_active", true)
        .order("name")

      if (dbErr) return error(req, "Failed to fetch suppliers", 500)
      return json(req, data)
    }

    // ── GET /supplies?action=dashboard ───────────────────
    if (req.method === "GET" && action === "dashboard") {
      const { data, error: dbErr } = await admin
        .from("v_supplies_dashboard")
        .select("*")
        .single()

      if (dbErr) return error(req, "Failed to fetch dashboard", 500)
      return json(req, data)
    }

    // ── GET /supplies?action=stock_history&supply_id=xxx ─
    if (req.method === "GET" && action === "stock_history") {
      const supply_id = url.searchParams.get("supply_id")
      if (!supply_id) return error(req, "supply_id required")

      const { data, error: dbErr } = await admin
        .from("stock_transactions")
        .select(`
          *,
          users:performed_by ( id, first_name, last_name, email )
        `)
        .eq("supply_id", supply_id)
        .order("created_at", { ascending: false })
        .limit(100)

      if (dbErr) return error(req, "Failed to fetch stock history", 500)
      return json(req, data)
    }

    // ── POST /supplies (create) ───────────────────────────
    if (req.method === "POST" && (!action || action === "create")) {
      const {
        name, description, sku, category_id, supplier_id,
        unit, unit_price, current_stock, max_stock, reorder_level,
        storage_location, icon, image_url, notes,
      } = body || {}

      if (!name || !unit || unit_price === undefined)
        return error(req, "name, unit and unit_price are required")

      const { data, error: dbErr } = await admin
        .from("supplies")
        .insert({
          name, description, sku, category_id, supplier_id,
          unit, unit_price, current_stock: current_stock ?? 0,
          max_stock, reorder_level, storage_location, icon, image_url,
          notes, created_by: user.id,
        })
        .select(`*, supply_categories(*), suppliers(*)`)
        .single()

      if (dbErr) {
        console.error("❌ create error:", dbErr)
        return error(req, dbErr.message || "Failed to create supply", 500)
      }

      // log initial stock transaction if stock > 0
      if ((current_stock ?? 0) > 0) {
        await admin.from("stock_transactions").insert({
          supply_id: data.id,
          transaction_type: "restock",
          quantity: current_stock,
          stock_before: 0,
          stock_after: current_stock,
          unit_cost: unit_price,
          notes: "Initial stock on creation",
          performed_by: user.id,
        })
      }

      return json(req, data, 201)
    }

    // ── PUT /supplies (update) ────────────────────────────
    if (req.method === "PUT" && (!action || action === "update")) {
      const { id, ...updates } = body || {}
      if (!id) return error(req, "id is required")

      updates.updated_at = new Date().toISOString()

      const { data, error: dbErr } = await admin
        .from("supplies")
        .update(updates)
        .eq("id", id)
        .select(`*, supply_categories(*), suppliers(*)`)
        .single()

      if (dbErr) return error(req, dbErr.message || "Failed to update", 500)
      return json(req, data)
    }

    // ── PATCH /supplies?action=adjust_stock ──────────────
    if (req.method === "PATCH" && action === "adjust_stock") {
      const { supply_id, quantity, transaction_type, notes: txNotes, unit_cost } = body || {}

      if (!supply_id || quantity === undefined || !transaction_type)
        return error(req, "supply_id, quantity and transaction_type are required")

      const { data: rpcData, error: rpcErr } = await admin.rpc("adjust_supply_stock", {
        p_supply_id:        supply_id,
        p_quantity:         quantity,
        p_transaction_type: transaction_type,
        p_notes:            txNotes || null,
        p_unit_cost:        unit_cost || null,
        p_performed_by:     user.id,
      })

      if (rpcErr) {
        console.error("❌ adjust_stock rpc error:", rpcErr)
        return error(req, rpcErr.message || "Stock adjustment failed", 500)
      }

      return json(req, rpcData)
    }

    // ── DELETE /supplies?action=delete ───────────────────
    if (req.method === "DELETE" && (!action || action === "delete")) {
      const id = body?.id || url.searchParams.get("id")
      if (!id) return error(req, "id is required")

      const { error: dbErr } = await admin
        .from("supplies")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", id)

      if (dbErr) return error(req, "Failed to delete supply", 500)
      return json(req, { deleted: true, id })
    }

    // ── POST /supplies?action=add_category ───────────────
    if (req.method === "POST" && action === "add_category") {
      const { name, description, color, icon } = body || {}
      if (!name) return error(req, "name is required")

      const { data, error: dbErr } = await admin
        .from("supply_categories")
        .insert({ name, description, color, icon, created_by: user.id })
        .select()
        .single()

      if (dbErr) return error(req, dbErr.message || "Failed to create category", 500)
      return json(req, data, 201)
    }

    // ── POST /supplies?action=add_supplier ───────────────
    if (req.method === "POST" && action === "add_supplier") {
      const { name, contact_person, email: sEmail, phone, address, website, account_number, bank_name, notes: sNotes } = body || {}
      if (!name) return error(req, "name is required")

      const { data, error: dbErr } = await admin
        .from("suppliers")
        .insert({ name, contact_person, email: sEmail, phone, address, website, account_number, bank_name, notes: sNotes, created_by: user.id })
        .select()
        .single()

      if (dbErr) return error(req, dbErr.message || "Failed to create supplier", 500)
      return json(req, data, 201)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})