import { serve } from "https://deno.land/std/http/server.ts"
import { supabaseAdmin } from "../_shared/supabaseClient.ts"
import { json, error, handleOptions, safeJson } from "../_shared/cors.service.ts"

console.log("📧 SUPPLY EMAIL PROCESSOR LOADED")

// ─── Template renderer ────────────────────────────────────
function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`)
}

// ─── Send via Resend (or swap with any SMTP provider) ─────
async function sendEmail(opts: {
  to_email: string
  to_name:  string
  cc_emails?: string[]
  subject:  string
  html:     string
  text?:    string
}) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
  const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") || "supplies@teamdesk.app"
  const FROM_NAME      = Deno.env.get("FROM_NAME")  || "TeamDesk Supplies"

  if (!RESEND_API_KEY) {
    console.warn("⚠️ RESEND_API_KEY not set — skipping actual send, marking as sent")
    return { ok: true, simulated: true }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      [`${opts.to_name} <${opts.to_email}>`],
      cc:      opts.cc_emails || [],
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text || "",
    }),
  })

  const result = await res.json()
  if (!res.ok) throw new Error(result?.message || "Resend API error")
  return result
}

// ─── MAIN ─────────────────────────────────────────────────
serve(async (req) => {
  console.log("\n📧 EMAIL PROCESSOR:", req.method, req.url)

  if (req.method === "OPTIONS") return handleOptions(req)

  try {
    const admin  = supabaseAdmin()
    const url    = new URL(req.url)
    const body   = req.method !== "GET" ? await safeJson(req) as any : null
    const action = url.searchParams.get("action") || body?.action

    // ── POST process queue (called by cron / pg_cron) ─────
    if (req.method === "POST" && (!action || action === "process")) {
      const batchSize = parseInt(url.searchParams.get("batch") || "20")

      // Fetch queued emails that are due
      const { data: emails, error: fetchErr } = await admin
        .from("email_queue")
        .select("*")
        .eq("status", "queued")
        .lte("send_after", new Date().toISOString())
        .lt("retry_count", 3)
        .order("created_at")
        .limit(batchSize)

      if (fetchErr) return error(req, "Failed to fetch email queue", 500)
      if (!emails?.length) return json(req, { processed: 0, message: "Queue empty" })

      // Load templates
      const templateKeys = [...new Set(emails.map((e: any) => e.template_key))]
      const { data: templates } = await admin
        .from("email_templates")
        .select("*")
        .in("key", templateKeys)
        .eq("is_active", true)

      const templateMap = Object.fromEntries((templates || []).map((t: any) => [t.key, t]))

      const results = { sent: 0, failed: 0, skipped: 0 }

      for (const emailJob of (emails as any[])) {
        const template = templateMap[emailJob.template_key]

        if (!template) {
          console.warn(`⚠️ Template '${emailJob.template_key}' not found — skipping`)
          await admin.from("email_queue").update({
            status:        "skipped",
            error_message: `Template '${emailJob.template_key}' not found or inactive`,
          }).eq("id", emailJob.id)
          results.skipped++
          continue
        }

        const data      = emailJob.template_data || {}
        const subject   = renderTemplate(emailJob.subject || template.subject, data)
        const bodyHtml  = renderTemplate(template.body_html, data)
        const bodyText  = template.body_text ? renderTemplate(template.body_text, data) : undefined

        try {
          await sendEmail({
            to_email:  emailJob.to_email,
            to_name:   emailJob.to_name || "",
            cc_emails: emailJob.cc_emails || [],
            subject,
            html:      bodyHtml,
            text:      bodyText,
          })

          await admin.from("email_queue").update({
            status:  "sent",
            sent_at: new Date().toISOString(),
          }).eq("id", emailJob.id)

          console.log(`✅ Sent to ${emailJob.to_email}: ${subject}`)
          results.sent++

        } catch (sendErr: any) {
          console.error(`❌ Failed to send to ${emailJob.to_email}:`, sendErr.message)

          await admin.from("email_queue").update({
            status:        emailJob.retry_count + 1 >= 3 ? "failed" : "queued",
            retry_count:   emailJob.retry_count + 1,
            failed_at:     new Date().toISOString(),
            error_message: sendErr.message,
            // exponential back-off: retry after 5min, 15min, 45min
            send_after:    new Date(Date.now() + Math.pow(3, emailJob.retry_count + 1) * 5 * 60 * 1000).toISOString(),
          }).eq("id", emailJob.id)

          results.failed++
        }
      }

      console.log("📊 Email batch results:", results)
      return json(req, { processed: emails.length, ...results })
    }

    // ── POST send single (manual trigger from UI) ─────────
    if (req.method === "POST" && action === "send_single") {
      const { to_email, to_name, subject, template_key, template_data, cc_emails } = body || {}
      if (!to_email || !subject || !template_key) return error(req, "to_email, subject and template_key required")

      const { data: template } = await admin
        .from("email_templates")
        .select("*")
        .eq("key", template_key)
        .single()

      if (!template) return error(req, `Template '${template_key}' not found`, 404)

      const data     = template_data || {}
      const bodyHtml = renderTemplate(template.body_html, data)
      const bodyText = template.body_text ? renderTemplate(template.body_text, data) : undefined

      try {
        await sendEmail({ to_email, to_name: to_name || "", cc_emails, subject, html: bodyHtml, text: bodyText })
        return json(req, { sent: true, to: to_email })
      } catch (sendErr: any) {
        return error(req, `Send failed: ${sendErr.message}`, 500)
      }
    }

    // ── GET queue status ──────────────────────────────────
    if (req.method === "GET" && (!action || action === "status")) {
      const { data, error: dbErr } = await admin
        .from("email_queue")
        .select("status")

      if (dbErr) return error(req, "Failed to fetch queue stats", 500)

      const stats = (data || []).reduce((acc: Record<string, number>, r: any) => {
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
      }, {})

      return json(req, stats)
    }

    // ── GET list queue items ──────────────────────────────
    if (req.method === "GET" && action === "list") {
      const status = url.searchParams.get("status")
      const limit  = parseInt(url.searchParams.get("limit") || "50")

      let query = admin
        .from("email_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit)

      if (status) query = query.eq("status", status)

      const { data, error: dbErr } = await query
      if (dbErr) return error(req, "Failed to list queue", 500)
      return json(req, data)
    }

    // ── DELETE retry failed ───────────────────────────────
    if (req.method === "PATCH" && action === "retry_failed") {
      const { data, error: dbErr } = await admin
        .from("email_queue")
        .update({
          status:      "queued",
          retry_count: 0,
          send_after:  new Date().toISOString(),
          error_message: null,
        })
        .eq("status", "failed")
        .select("id")

      if (dbErr) return error(req, "Failed to retry", 500)
      return json(req, { retried: data?.length || 0 })
    }

    // ── GET templates list ────────────────────────────────
    if (req.method === "GET" && action === "templates") {
      const { data, error: dbErr } = await admin
        .from("email_templates")
        .select("id, key, name, subject, variables, is_active")
        .order("key")

      if (dbErr) return error(req, "Failed to fetch templates", 500)
      return json(req, data)
    }

    return error(req, "Unknown action or method", 400)

  } catch (err: any) {
    console.error("🔥 FATAL:", err)
    return error(req, err.message || "Server error", 500)
  }
})