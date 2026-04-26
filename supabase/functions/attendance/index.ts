import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin, supabaseAnon } from "../_shared/supabaseClient.ts"
import { getDistanceInMeters } from "../_shared/geo.ts"
import { ok, fail, log, safeJson } from "../_shared/http.ts"

serve(async (req) => {
  const headers = req.headers

  log("REQUEST START", {
    method: req.method,
    url: req.url,
  })

  // ✅ PRE-FLIGHT HANDLER (bulletproof)
  if (req.method === "OPTIONS") {
    log("OPTIONS PRE-FLIGHT")
    return new Response("ok", {
      status: 204,
      headers: {
        ...Object.fromEntries(headers),
      },
    })
  }

  try {
    log("STEP 1 - PARSE BODY")

    const body = await safeJson(req)

    if (!body) {
      return fail(req, "Invalid JSON body", 400)
    }

    log("BODY RECEIVED", body)

    const ipRaw =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("cf-connecting-ip") ||
      ""

    const ip = ipRaw.split(",")[0].trim()

    log("IP DETECTED", ip)

    const { lat, lng, status, device } = body

    const admin = supabaseAdmin()
    const userClient = supabaseAnon(req)

    // 🔐 AUTH
    log("AUTH CHECK")

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      log("AUTH FAILED", authError)
      return fail(req, "Unauthorized", 401)
    }

    log("AUTH SUCCESS", user.id)

    // 📍 IP CHECK
    log("IP CHECK")

    const { data: allowedIps, error: ipError } = await admin
      .from("allowed_networks")
      .select("ip_address")

    if (ipError) {
      log("IP QUERY ERROR", ipError)
      return fail(req, "IP validation failed")
    }

    const isAllowedIP = allowedIps.some((row) =>
      ip.includes(row.ip_address)
    )

    if (!isAllowedIP) {
      log("BLOCKED IP", ip)
      return fail(req, "Not on office network", 403)
    }

    // 📍 GEO CHECK
    log("GEOFENCE CHECK")

    const OFFICE_LAT = 6.5244
    const OFFICE_LNG = 3.3792
    const MAX_DISTANCE = 100

    const distance = getDistanceInMeters(
      lat,
      lng,
      OFFICE_LAT,
      OFFICE_LNG
    )

    log("DISTANCE (meters)", distance)

    if (distance > MAX_DISTANCE) {
      return fail(req, "Outside office radius", 403, {
        distance: Math.round(distance),
      })
    }

    // 🧠 RPC CALL
    log("MARK ATTENDANCE RPC")

    const { data, error } = await admin.rpc("mark_attendance", {
      p_user_id: user.id,
      p_status: status,
      p_check_in_time: new Date().toISOString(),
      p_ip: ip,
      p_lat: lat,
      p_lng: lng,
      p_device: device,
    })

    if (error) {
      log("RPC ERROR", error)
      return fail(req, "Database error")
    }

    log("SUCCESS", data)

    return ok(req, data)

  } catch (err) {
    log("FATAL ERROR", err)

    return fail(req, err.message || "Server error", 500)
  }
})