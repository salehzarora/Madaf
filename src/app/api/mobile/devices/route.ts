import { cookies } from "next/headers";
import { INSTALLATION_COOKIE, parseDeviceInput, parseInstallation } from "@/lib/push/device-input";
import { pushSession, registerPushDevice, disablePushDevice } from "@/lib/data/push-devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (status: number, body: object) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "Vary": "Cookie" },
});

async function readPayload(request: Request): Promise<unknown> {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") === "cross-site"
    || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("request");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error("size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function GET() {
  if (process.env.MADAF_NATIVE_PUSH_ENABLED !== "true") return reply(503, { enabled: false });
  try {
    const session = await pushSession();
    return session ? reply(200, { scope: session.scope }) : reply(401, { error: "unauthorized" });
  } catch { return reply(503, { error: "unavailable" }); }
}

export async function POST(request: Request) {
  let input;
  try { input = parseDeviceInput(await readPayload(request)); }
  catch { return reply(400, { error: "invalid_request" }); }
  if (!input) return reply(400, { error: "invalid_request" });
  if (process.env.MADAF_NATIVE_PUSH_ENABLED !== "true") return reply(503, { error: "disabled" });
  try {
    const session = await pushSession();
    if (!session) return reply(401, { error: "unauthorized" });
    await registerPushDevice(session, input);
    (await cookies()).set(INSTALLATION_COOKIE, input.installationId, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 31536000,
    });
    return reply(200, { ok: true });
  } catch { return reply(503, { error: "unavailable" }); }
}

export async function DELETE(request: Request) {
  let id;
  try { id = parseInstallation(await readPayload(request)); }
  catch { return reply(400, { error: "invalid_request" }); }
  if (!id) return reply(400, { error: "invalid_request" });
  try {
    const session = await pushSession();
    if (!session) return reply(401, { error: "unauthorized" });
    await disablePushDevice(session, id);
    const store = await cookies();
    if (store.get(INSTALLATION_COOKIE)?.value === id) store.delete(INSTALLATION_COOKIE);
    return reply(200, { ok: true });
  } catch { return reply(503, { error: "unavailable" }); }
}
