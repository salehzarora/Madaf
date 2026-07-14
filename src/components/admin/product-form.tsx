"use client";

import { CheckCircle2, ImageIcon, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/types";
import {
  createProductAction,
  updateProductAction,
  uploadProductImageAction,
} from "@/lib/actions/products";
import { getDataMode } from "@/lib/data/mode";
import {
  IMAGE_ACCEPT,
  MAX_PRODUCT_IMAGE_BYTES,
  preValidateImage,
} from "@/lib/image-upload";
import { shouldSubmitInventory } from "@/lib/product-inventory-intent";
import { useShopData } from "@/lib/shop-data-context";
import { BASE_UNITS, PACKAGE_UNITS, type InventoryItem, type Product } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Shared admin product form — create and edit.
 * - Mock mode: shows the demo confirmation, persists nothing (device upload
 *   shows a local, client-only preview so the flow is demonstrable).
 * - Supabase mode: submits through the product Server Actions (real
 *   create/update + inventory; the DB validates everything).
 *
 * Device image upload works in BOTH create and edit (M7F.1): create mode
 * uploads to a tenant-scoped staging path (no product id needed) and the
 * returned object path is persisted by create_product on save. An image URL
 * remains an optional fallback.
 */
export function ProductForm({
  locale,
  dict,
  product,
  inventory,
}: {
  locale: Locale;
  dict: Dictionary;
  /** Present in edit mode. */
  product?: Product;
  inventory?: InventoryItem;
}) {
  const t = dict.admin.products.new;
  const router = useRouter();
  const { categories, manufacturers } = useShopData();
  const isEdit = Boolean(product);
  // Whether this product ALREADY has an inventory row. When it doesn't, an
  // unrelated metadata edit must not implicitly create a 0-stock row (which
  // would flip availability to Out-of-stock) — see shouldSubmitInventory (B2).
  const hasExistingInventory = Boolean(inventory);
  const live = getDataMode() === "supabase";

  // The VALUE we persist: the raw storage path when the image lives in
  // the bucket, else the external URL. Never the ephemeral signed URL.
  const [imageUrl, setImageUrl] = useState(
    product?.imageStoragePath ?? product?.imageUrl ?? "",
  );
  // What we SHOW: the resolved (signed/external) display URL.
  const [preview, setPreview] = useState<string | undefined>(product?.imageUrl);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Holds a mock-mode object URL so it can be revoked when replaced/unmounted.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function onUpload(file: File) {
    setUploadError(null);
    // Fast client-side reject before any upload starts (server re-validates).
    const pre = preValidateImage(file, MAX_PRODUCT_IMAGE_BYTES);
    if (pre) {
      setUploadError(pre === "size" ? t.uploadSizeError : t.uploadTypeError);
      return;
    }
    // Mock mode never persists — show a local, client-only preview so the
    // upload flow is demonstrable in the zero-env default. Never persist the
    // blob URL (imageUrl stays empty).
    if (!live) {
      const localUrl = URL.createObjectURL(file);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = localUrl;
      setPreview(localUrl);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      // Edit mode passes the product id; create mode omits it (staging path).
      if (product) fd.set("productId", product.id);
      fd.set("file", file);
      const result = await uploadProductImageAction(fd);
      if (result.ok && result.path && result.previewUrl) {
        // Store the object path (persisted on save); preview via signed URL.
        setImageUrl(result.path);
        setPreview(result.previewUrl);
      } else {
        // The current image/preview is untouched on failure.
        setUploadError(
          result.reason === "type"
            ? t.uploadTypeError
            : result.reason === "size"
              ? t.uploadSizeError
              : result.reason === "invalid"
                ? dict.common.uploadInvalid
                : t.uploadFailed,
        );
      }
    } catch {
      setUploadError(t.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveFailed(false);

    if (!live) {
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const fd = new FormData(event.currentTarget);
    const productInput = {
      nameHe: fd.get("nameHe"),
      nameAr: fd.get("nameAr"),
      nameEn: fd.get("nameEn"),
      categoryId: fd.get("categoryId"),
      manufacturerId: fd.get("manufacturerId") || undefined,
      sku: fd.get("sku") || undefined,
      barcode: fd.get("barcode") || undefined,
      packageUnit: fd.get("packageUnit"),
      packageQuantity: fd.get("packageQuantity"),
      baseUnit: fd.get("baseUnit"),
      unitSize: fd.get("unitSize") || undefined,
      wholesalePrice: fd.get("wholesalePrice"),
      vatRate: fd.get("vatRate") || undefined,
      imageUrl: imageUrl || undefined,
      trackExpiry: fd.get("trackExpiry") === "on",
      isActive: fd.get("isActive") === "on",
    };
    const inventoryInput = {
      quantityAvailable: fd.get("quantityAvailable") ?? "0",
      lowStockThreshold: fd.get("lowStockThreshold") || undefined,
      warehouseLocation: fd.get("warehouseLocation") || undefined,
      expiryDate: fd.get("expiryDate") || undefined,
    };
    // Only persist inventory when it should be touched: always on create and
    // for a product that already tracks stock, but for an inventory-LESS
    // product only when the user actually entered stock data — so an unrelated
    // metadata edit never creates a 0-stock row (B2).
    const submitInventory = shouldSubmitInventory({
      isEdit,
      hasExistingInventory,
      fields: {
        quantityAvailable: String(fd.get("quantityAvailable") ?? ""),
        warehouseLocation: String(fd.get("warehouseLocation") ?? ""),
        expiryDate: String(fd.get("expiryDate") ?? ""),
      },
    });

    setSaving(true);
    try {
      const result =
        isEdit && product
          ? await updateProductAction({
              productId: product.id,
              product: productInput,
              ...(submitInventory ? { inventory: inventoryInput } : {}),
              locale,
            })
          : await createProductAction({
              product: productInput,
              inventory: inventoryInput,
              locale,
            });
      if (result.ok) {
        router.push(`/${locale}/admin/products`);
        router.refresh();
        return;
      }
    } catch {
      // fall through to the error state
    }
    setSaving(false);
    setSaveFailed(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-4">
      <p
        className={cn(
          "rounded-field px-4 py-3 text-sm",
          live ? "bg-success-soft text-success" : "bg-info-soft text-info",
        )}
      >
        {live ? t.liveNotice : t.mockNotice}
      </p>

      {saved ? (
        <div className="flex items-center gap-3 rounded-field bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {t.savedToast}
          <Link
            href={`/${locale}/admin/products`}
            className="ms-auto shrink-0 underline"
          >
            {t.backToList}
          </Link>
        </div>
      ) : null}

      {/* Names & translations */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionTranslations}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <Label htmlFor="np-he">{t.nameHe}</Label>
            <Input id="np-he" name="nameHe" dir="rtl" lang="he" required
              defaultValue={product?.translations.he.name} />
          </div>
          <div>
            <Label htmlFor="np-ar">{t.nameAr}</Label>
            <Input id="np-ar" name="nameAr" dir="rtl" lang="ar" required
              defaultValue={product?.translations.ar.name} />
          </div>
          <div>
            <Label htmlFor="np-en">{t.nameEn}</Label>
            <Input id="np-en" name="nameEn" dir="ltr" lang="en" required
              defaultValue={product?.translations.en.name} />
          </div>
        </CardContent>
      </Card>

      {/* Basics */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionBasics}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="np-cat">{t.category}</Label>
            <Select id="np-cat" name="categoryId" required
              defaultValue={product?.categoryId ?? ""}>
              <option value="" disabled>
                {dict.common.select}…
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name[locale]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-man">{t.manufacturer}</Label>
            <Select id="np-man" name="manufacturerId"
              defaultValue={product?.manufacturerId ?? ""}>
              <option value="">{t.manufacturerNone}</option>
              {manufacturers.map((manufacturer) => (
                <option key={manufacturer.id} value={manufacturer.id}>
                  {manufacturer.name[locale]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-sku">{t.sku}</Label>
            <Input id="np-sku" name="sku" mono dir="ltr" defaultValue={product?.sku} />
          </div>
          <div>
            <Label htmlFor="np-barcode">{t.barcode}</Label>
            {/* Prefilled in edit mode (M8A) — an empty save used to silently
                wipe the stored barcode. Clearing is now a deliberate act. */}
            <Input
              id="np-barcode"
              name="barcode"
              mono
              dir="ltr"
              defaultValue={product?.barcode}
            />
          </div>
        </CardContent>
      </Card>

      {/* Packaging */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionPackaging}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="np-ptype">{t.packageType}</Label>
            <Select id="np-ptype" name="packageUnit"
              defaultValue={product?.packageType ?? "carton"}>
              {PACKAGE_UNITS.map((p) => (
                <option key={p} value={p}>
                  {dict.packaging[p]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-upp">{t.unitsPerPackage}</Label>
            <Input id="np-upp" name="packageQuantity" type="number" min={1}
              defaultValue={product?.unitsPerPackage ?? 24} dir="ltr"
              className="tabular-nums" />
          </div>
          <div>
            <Label htmlFor="np-unit">{t.baseUnit}</Label>
            <Select id="np-unit" name="baseUnit"
              defaultValue={product?.baseUnit ?? "units"}>
              {BASE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {dict.units[u]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="np-size">{t.unitSize}</Label>
            <Input id="np-size" name="unitSize" dir="ltr"
              defaultValue={product?.unitSize} />
            <p className="mt-1 text-xs text-ink-soft">{t.unitSizeHint}</p>
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionPricing}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="np-price">{t.wholesalePrice}</Label>
            <Input id="np-price" name="wholesalePrice" type="number" min={0}
              step="0.1" required dir="ltr" className="tabular-nums"
              defaultValue={product?.wholesalePrice} />
          </div>
          <div>
            <Label htmlFor="np-vat">{t.vatRate}</Label>
            <Input id="np-vat" name="vatRate" type="number" min={0} max={0.99}
              step="0.01" dir="ltr" className="tabular-nums"
              defaultValue={product?.vatRate ?? 0.18} />
          </div>
          <label className="flex items-start gap-3 rounded-field border border-line p-3">
            <input type="checkbox" name="trackExpiry" className="mt-1 size-4 accent-brand-600"
              defaultChecked={product?.trackExpiry ?? false} />
            <span>
              <span className="block text-sm font-medium text-ink">{t.trackExpiry}</span>
              <span className="block text-xs text-ink-soft">{t.trackExpiryHint}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-field border border-line p-3">
            <input type="checkbox" name="isActive" className="mt-1 size-4 accent-brand-600"
              defaultChecked={product?.isActive ?? true} />
            <span>
              <span className="block text-sm font-medium text-ink">{t.active}</span>
              <span className="block text-xs text-ink-soft">{t.activeHint}</span>
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Image */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionImage}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-field border border-line bg-surface-sunken">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-6 text-ink-muted" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Label htmlFor="np-img">{t.imageUrl}</Label>
              <Input id="np-img" dir="ltr" value={imageUrl}
                onChange={(e) => {
                  setImageUrl(e.target.value);
                  setPreview(e.target.value || undefined);
                }} />
              <p className="mt-1 text-xs text-ink-soft">{t.imageUrlHint}</p>
            </div>
          </div>

          {/* Device upload — works in create & edit (M7F.1); mock mode shows a
              local, client-only preview (see onUpload). */}
          <div>
              <input ref={fileRef} type="file" accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }} />
              <Button type="button" variant="outline" size="sm" disabled={uploading}
                onClick={() => fileRef.current?.click()}>
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-4" aria-hidden />
                )}
                {uploading ? t.uploading : t.uploadImage}
              </Button>
              {imageUrl ? (
                <button type="button"
                  onClick={() => { setImageUrl(""); setPreview(undefined); }}
                  className="ms-3 rounded-field text-sm text-ink-soft underline transition-colors hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                  {t.removeImage}
                </button>
              ) : null}
              {uploadError ? (
                <p role="alert" className="mt-2 text-sm font-medium text-danger">
                  {uploadError}
                </p>
              ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Inventory */}
      <Card>
        <CardHeader variant="strip">
          <CardTitle>{t.sectionInventory}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="np-qty">{t.stockQuantity}</Label>
            <Input id="np-qty" name="quantityAvailable" type="number" min={0}
              dir="ltr" className="tabular-nums"
              defaultValue={inventory?.stockPackages ?? 0} />
          </div>
          <div>
            <Label htmlFor="np-thr">{t.lowStockThreshold}</Label>
            <Input id="np-thr" name="lowStockThreshold" type="number" min={0}
              dir="ltr" className="tabular-nums"
              defaultValue={inventory?.lowStockThreshold ?? 10} />
          </div>
          <div>
            <Label htmlFor="np-loc">{t.warehouseLocation}</Label>
            <Input id="np-loc" name="warehouseLocation" dir="ltr"
              defaultValue={inventory?.location} />
          </div>
          <div>
            <Label htmlFor="np-exp">{t.expiryDate}</Label>
            <Input id="np-exp" name="expiryDate" type="date" dir="ltr"
              defaultValue={inventory?.nearestExpiry?.slice(0, 10)} />
          </div>
        </CardContent>
      </Card>

      {saveFailed ? (
        <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {t.saveError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={saving || uploading}>
          {saving ? t.saving : t.save}
        </Button>
        <Link href={`/${locale}/admin/products`}
          className="inline-flex h-12 items-center rounded-field px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          {dict.common.cancel}
        </Link>
      </div>
    </form>
  );
}
