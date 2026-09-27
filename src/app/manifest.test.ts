import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { appIdentity } from "@/lib/app-identity";
import manifest from "./manifest";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("native manifest gives MADAF a locale-neutral standalone launch identity", () => {
  const app = manifest();
  assert.equal(app.id, "/");
  assert.equal(app.name, "MADAF");
  assert.equal(app.short_name, "MADAF");
  assert.equal(app.description, getDictionary("he").meta.description);
  assert.equal(app.start_url, "/");
  assert.equal(app.scope, "/");
  assert.equal(app.display, "standalone");
  assert.equal(app.orientation, "any");
  assert.equal(app.lang, "he");
  assert.equal(app.dir, "rtl");
  assert.deepEqual(app.categories, ["business", "productivity"]);
});

test("manifest colors match the approved Storefront theme tokens", () => {
  const css = source("src/components/storefront-theme.css");
  assert.equal(manifest().theme_color, "#182444");
  assert.equal(manifest().background_color, "#F5F3FA");
  assert.equal(manifest().theme_color, css.match(/--storefront-navy:\s*([^;]+);/)?.[1]);
  assert.equal(manifest().background_color, css.match(/--storefront-canvas:\s*([^;]+);/)?.[1]);
});

test("manifest declares separate standard and maskable PNG icons with real matching dimensions", () => {
  assert.deepEqual(manifest().icons, [
    { src: "/icons/madaf-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/madaf-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/madaf-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
  const icons = [
    ...manifest().icons!.map((icon) => ({ path: icon.src, size: Number(icon.sizes!.split("x")[0]) })),
    { path: "/icons/apple-touch-icon.png", size: 180 },
  ];
  for (const { path, size } of icons) {
    const png = readFileSync(new URL(`public${path}`, root));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
    assert.equal(png.toString("ascii", 12, 16), "IHDR", path);
    assert.equal(png.readUInt32BE(16), size, path);
    assert.equal(png.readUInt32BE(20), size, path);
    assert.equal(png[25], 2, "opaque RGB icons, including Apple and maskable");
  }
});

// Run the real metadata function without loading next/font or CSS in Node.
// Browser QA also checks the final head emitted by the production build.
const layout = source("src/app/[locale]/layout.tsx");
const ast = ts.createSourceFile("layout.tsx", layout, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const metadataFunction = ast.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "generateMetadata",
);
assert.ok(metadataFunction);
const metadataModule = { exports: {} as { generateMetadata: (props: { params: Promise<{ locale: string }> }) => Promise<Record<string, unknown>> } };
runInNewContext(ts.transpileModule(metadataFunction.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: metadataModule.exports, getDictionary, isLocale, appIdentity });

for (const locale of locales) {
  test(`root metadata retains ${locale} title/description and adds app identity`, async () => {
    const result = JSON.parse(JSON.stringify(await metadataModule.exports.generateMetadata({ params: Promise.resolve({ locale }) })));
    const dict = getDictionary(locale);
    assert.deepEqual(result.title, {
      default: `${dict.meta.appNameNative} · ${dict.meta.tagline}`,
      template: `%s · ${dict.meta.appName}`,
    });
    assert.equal(result.description, dict.meta.description);
    assert.equal(result.applicationName, "MADAF");
    assert.deepEqual(result.appleWebApp, { capable: true, title: "MADAF", statusBarStyle: "default" });
    assert.deepEqual(result.icons.apple, { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" });
    assert.equal(result.themeColor, undefined, "theme color belongs to Viewport, not deprecated Metadata");
  });
}

test("root keeps locale direction, fonts and default browser viewport behavior", () => {
  assert.match(layout, /lang=\{locale\}/);
  assert.match(layout, /dir=\{dirFor\(locale as Locale\)\}/);
  assert.match(layout, /rubik\.variable/);
  assert.match(layout, /plexMono\.variable/);
  assert.match(layout, /export const viewport: Viewport = \{\s*themeColor: appIdentity.themeColor,\s*\}/);
  assert.doesNotMatch(layout, /["']use client["']|maximumScale|userScalable|viewportFit/);
});

test("Android association authorizes only the approved internal debug package and certificate", () => {
  assert.deepEqual(JSON.parse(source("public/.well-known/assetlinks.json")), [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "app.madaf.android.dev",
        sha256_cert_fingerprints: [
          "D4:27:EC:08:C2:EC:6E:6D:B4:DB:BF:3E:DF:8E:69:F5:C0:C7:40:7D:4A:1A:CC:B7:CC:28:32:72:0D:D3:40:41",
        ],
      },
    },
  ]);
});

test("native PWA has no third-party caching library or additional Android association file", () => {
  for (const directory of ["src", "public"]) {
    const files = readdirSync(new URL(`${directory}/`, root), { recursive: true, encoding: "utf8" });
    for (const file of files) {
      if (/(^|[/\\])assetlinks\.json$/i.test(file)) {
        assert.equal(`${directory}/${file.replaceAll("\\", "/")}`, "public/.well-known/assetlinks.json");
      }
      if (/\.(?:[cm]?[jt]sx?|html)$/.test(file) && !/\.test\./.test(file)) {
        assert.doesNotMatch(source(`${directory}/${file}`), /workbox|@serwist/, file);
      }
    }
  }
  const pkg = JSON.parse(source("package.json"));
  assert.doesNotMatch(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join("\n"), /next-pwa|workbox|serwist/);
});
