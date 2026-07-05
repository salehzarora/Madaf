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
  useState,
  type ReactNode,
} from "react";
import { productById } from "@/lib/mock/products";
import type { CartItem } from "@/lib/types";

const STORAGE_KEY = "madaf.cart.v1";

interface CartState {
  items: CartItem[];
  customerId: string | null;
}

interface CartContextValue extends CartState {
  /** False until localStorage has been read (avoids hydration flicker). */
  hydrated: boolean;
  addItem: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  setCustomer: (customerId: string | null) => void;
  totalPackages: number;
  /** ILS, excl. VAT — computed from current mock prices. */
  subtotal: number;
  quantityOf: (productId: string) => number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>({
    items: [],
    customerId: null,
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // One-time hydration from localStorage. Reading storage in a useState
    // initializer would run during SSR/hydration and mismatch the server
    // HTML, so the effect + `hydrated` flag is the intended pattern here.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartState;
        // Drop items whose product no longer exists in the mock catalog.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({
          items: parsed.items.filter((i) => productById.has(i.productId)),
          customerId: parsed.customerId ?? null,
        });
      }
    } catch {
      // Corrupt storage — start fresh.
    }
    setHydrated(true);
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
    setState((prev) => ({ items: [], customerId: prev.customerId }));
  }, []);

  const setCustomer = useCallback((customerId: string | null) => {
    setState((prev) => ({ ...prev, customerId }));
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
  }, [state.items]);

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
