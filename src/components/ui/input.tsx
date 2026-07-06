import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-field border border-line-strong bg-surface px-3.5 text-sm text-ink " +
  "placeholder:text-ink-muted transition-colors " +
  "focus:border-brand-600 focus:outline-none focus:ring-[3px] focus:ring-brand-600/15 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function Input({
  className,
  mono = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  // mono variant: emails / SKUs / tokens — callers also pass dir="ltr".
  return (
    <input
      className={cn(fieldBase, "h-11", mono && "font-mono text-[13px]", className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(fieldBase, "min-h-24 py-2.5", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "h-11 bg-surface", className)} {...props} />
  );
}

export function Label({
  className,
  children,
  htmlFor,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "mb-1.5 block text-[13px] font-semibold text-ink-soft",
        className,
      )}
    >
      {children}
    </label>
  );
}
