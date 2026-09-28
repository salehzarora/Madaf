import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

test("bare URLs use only validated saved locales, default to Hebrew, and preserve queries", async () => {
  for (const [cookie, path, expected] of [
    [undefined, "/", "/he"], ["ar", "/", "/ar"], ["en", "/", "/en"],
    ["he", "/", "/he"], ["garbage", "/", "/he"], ["AR", "/", "/he"],
    ["en", "/admin?status=new&page=2", "/en/admin?status=new&page=2"],
  ]) {
    const response = await proxy(new NextRequest(`https://madaf.test${path}`, {
      headers: cookie ? { cookie: `madaf_locale=${cookie}` } : {},
    }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `https://madaf.test${expected}`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
  }
});

test("explicit locale paths remain authoritative over the cookie", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    for (const [path, cookie] of [["/he", "ar"], ["/ar/catalog", "he"], ["/en/admin?status=new", "ar"]]) {
      const response = await proxy(new NextRequest(`https://madaf.test${path}`, { headers: { cookie: `madaf_locale=${cookie}` } }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    }
  } finally {
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
  }
});
