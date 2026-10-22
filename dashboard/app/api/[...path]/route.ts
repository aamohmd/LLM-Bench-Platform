import { NextRequest, NextResponse } from "next/server";
import { getBackendApiUrl } from "../../../lib/config";

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolved = await context.params;
    const path = Array.isArray(resolved.path)
      ? resolved.path.join("/")
      : String(resolved.path || "");
    const targetPath = path.startsWith("v1/") ? path : `v1/${path}`;

    const headers = new Headers();
    for (const name of ["accept", "content-type"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const apiKey =
      request.cookies.get("admin_api_key")?.value ||
      request.headers.get("x-api-key") ||
      process.env.ADMIN_API_KEY ||
      process.env.BENCHMARK_API_KEY;
    if (apiKey) headers.set("X-API-Key", apiKey);

    const canHaveBody = !["GET", "HEAD"].includes(request.method);
    const body = canHaveBody ? await request.arrayBuffer() : undefined;
    const upstream = await fetch(
      `${getBackendApiUrl()}/api/${targetPath}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: body && body.byteLength > 0 ? body : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      }
    );

    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-disposition", "etag"] as const) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    return NextResponse.json(
      { detail: "Benchmark API is unavailable", error: message },
      { status: 503 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
