"use client";

/**
 * Cart state for the mock ordering flow.
 * - Quantities are in PACKAGES (cartons/packs), matching wholesale reality.
 * - `customerId` supports the sales-visit flow ("ordering for shop X").
 * - Persisted to localStorage so a tablet demo survives a refresh.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShopData } from "@/lib/shop-data-context";
import type { CartItem } from "@/lib/types";

const STORAGE_KEY = "madaf.cart.v1";

interface CartState {
  items: CartItem[];
  customerId: string | null;
  /** FIX1: DB-backed order idempotency key for the CURRENT logical submission.
   * Persisted with the cart so a mid-retry refresh reuses the same key. */
  submissionKey: string | null;
}

interface CartContextValue extends CartState {
  /** False until localStorage has been read (avoids hydration flicker). */
  hydrated: boolean;
  addItem: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  setCustomer: (customerId: string | null) => void;
  /** Return the current submission key, generating (and persisting) one lazily on
   * the first submit. Retries of the same attempt reuse it. */
  ensureSubmissionKey: () => string;
  /** Drop the current key so the NEXT submit starts a fresh logical attempt —
   * called after an idempotency conflict when the user deliberately re-submits. */
  resetSubmissionKey: () => void;
  totalPackages: number;
  /** ILS, excl. VAT — computed from current mock prices. */
  subtotal: number;
  quantityOf: (productId: string) => number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  // Catalog reference data comes from the server-hydrated shop data
  // context — the cart never fetches and never imports mock data.
  const { productById } = useShopData();
  const [state, setState] = useState<CartState>({
    items: [],
    customerId: null,
    submissionKey: null,
  });
  const [hydrated, setHydrated] = useState(false);
  // Mirror of the current key so ensureSubmissionKey can read+generate it
  // synchronously inside a submit handler (state updates are async).
  const keyRef = useRef<string | null>(null);
  useEffect(() => {
    keyRef.current = state.submissionKey;
  }, [state.submissionKey]);

  useEffect(() => {
    // One-time hydration from localStorage. Reading storage in a useState
    // initializer would run during SSR/hydration and mismatch the server
    // HTML, so the effect + `hydrated` flag is the intended pattern here.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartState;
        // Merge, don't replace: anything set before hydration (e.g. a
        // ?customer= deep link) must survive the storage restore. Also
        // drop items whose product no longer exists in the catalog.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState((prev) => ({
          items:
            prev.items.length > 0
              ? prev.items
              : parsed.items.filter((i) => productById.has(i.productId)),
          customerId: prev.customerId ?? parsed.customerId ?? null,
          submissionKey: prev.submissionKey ?? parsed.submissionKey ?? null,
        }));
      }
    } catch {
      // Corrupt storage — start fresh.
    }
    setHydrated(true);
    // productById is stable for the session (server-hydrated reference
    // data); this hydration must run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const addItem = useCallback((productId: string, quantity = 1) => {
    setState((prev) => {
      const existing = prev.items.find((i) => i.productId === productId);
      const items = existing
        ? prev.items.map((i) =>
            i.productId === productId
              ? { ...i, quantity: i.quantity + quantity }
              : i,
          )
        : [...prev.items, { productId, quantity }];
      return { ...prev, items };
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setState((prev) => ({
      ...prev,
      items:
        quantity <= 0
          ? prev.items.filter((i) => i.productId !== productId)
          : prev.items.some((i) => i.productId === productId)
            ? prev.items.map((i) =>
                i.productId === productId ? { ...i, quantity } : i,
              )
            : [...prev.items, { productId, quantity }],
    }));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.productId !== productId),
    }));
  }, []);

  const clear = useCallback(() => {
    // A successful submit clears the cart AND rotates the key, so the next
    // (new) logical order deterministically gets a fresh submission key.
    keyRef.current = null;
    setState((prev) => ({ items: [], customerId: prev.customerId, submissionKey: null }));
  }, []);

  const setCustomer = useCallback((customerId: string | null) => {
    setState((prev) => ({ ...prev, customerId }));
  }, []);

  const ensureSubmissionKey = useCallback((): string => {
    if (keyRef.current) return keyRef.current;
    const fresh = crypto.randomUUID();
    keyRef.current = fresh;
    setState((prev) => ({ ...prev, submissionKey: prev.submissionKey ?? fresh }));
    return fresh;
  }, []);

  const resetSubmissionKey = useCallback(() => {
    keyRef.current = null;
    setState((prev) => ({ ...prev, submissionKey: null }));
  }, []);

  const { totalPackages, subtotal } = useMemo(() => {
    let packages = 0;
    let sum = 0;
    for (const item of state.items) {
      const product = productById.get(item.productId);
      if (!product) continue;
      packages += item.quantity;
      sum += item.quantity * product.wholesalePrice;
    }
    return { totalPackages: packages, subtotal: sum };
  }, [state.items, productById]);

  const quantityOf = useCallback(
    (productId: string) =>
      state.items.find((i) => i.productId === productId)?.quantity ?? 0,
    [state.items],
  );

  const value: CartContextValue = {
    ...state,
    hydrated,
    addItem,
    setQuantity,
    removeItem,
    clear,
    setCustomer,
    ensureSubmissionKey,
    resetSubmissionKey,
    totalPackages,
    subtotal,
    quantityOf,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
