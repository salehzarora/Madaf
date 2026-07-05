/** Join conditional class names (tiny local alternative to clsx). */
export function cn(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}
