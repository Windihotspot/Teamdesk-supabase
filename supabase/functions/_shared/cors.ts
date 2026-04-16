const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3002",
  "http://localhost:3001",
  "http://localhost:5173",
])

export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin")
  const method = req.method

  // 🧪 DEBUG 1: Incoming request info
  console.log("===== CORS DEBUG START =====")
  console.log("Method:", method)
  console.log("Origin:", origin)
  console.log("URL:", req.url)

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  }

  // 🧪 DEBUG 2: Origin validation
  if (origin) {
    console.log("Origin received:", origin)
    console.log("Is allowed:", allowedOrigins.has(origin))
  } else {
    console.log("⚠️ No origin header found (likely server-to-server or same-origin)")
  }

  // ✅ allow matching origins
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