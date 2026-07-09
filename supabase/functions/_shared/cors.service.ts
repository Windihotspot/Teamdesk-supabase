const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173",
  "https://team-desk-sandy.vercel.app", 
])

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin")

  console.log("===== CORS DEBUG START =====")
  console.log("Method:", req.method)
  console.log("Origin:", origin)
  console.log("URL:", req.url)

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  }

  if (origin) {
    console.log("Origin received:", origin)
    console.log("Is allowed:", allowedOrigins.has(origin))
  } else {
    console.log("⚠️ No origin header (server-to-server or same-origin)")
  }

  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
    console.log("✅ Setting Access-Control-Allow-Origin:", origin)
  } else {
    headers["Access-Control-Allow-Origin"] = "*"
    console.log("⚠️ Fallback to * origin")
  }

  console.log("Final CORS headers:", headers)
  console.log("===== CORS DEBUG END =====")

  return headers
}

export const json = (req: Request, data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: corsHeaders(req),
  })

export const error = (
  req: Request,
  message: string,
  status = 400,
  extra?: Record<string, unknown>
) =>
  new Response(
    JSON.stringify({ success: false, error: message, ...extra }),
    { status, headers: corsHeaders(req) }
  )

export const handleOptions = (req: Request) =>
  new Response("ok", { status: 200, headers: corsHeaders(req) })

export const safeJson = async (req: Request): Promise<Record<string, unknown> | null> => {
  try {
    return await req.json()
  } catch {
    return null
  }
}