import { Input as InputPrimitive } from "@base-ui/react/input";
import * as React from "react";

import { cn } from "@/lib/utils";

function Input({
  className,
  type,
  value,
  onBlur,
  onChange,
  onFocus,
  ...props
}: React.ComponentProps<"input">) {
  const controlledNumber = type === "number" && value !== undefined;
  const [numberDraft, setNumberDraft] = React.useState<string | null>(null);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    if (!controlledNumber) {
      onChange?.(event);
      return;
    }

    const next = event.currentTarget.value;
    setNumberDraft(next);

    // A controlled number input temporarily becomes an empty/invalid string while users
    // replace its contents. Do not push that transient state into numeric configuration
    // models (where Number("") becomes 0); commit only parseable numbers instead.
    if (next.length === 0 || !Number.isFinite(event.currentTarget.valueAsNumber)) return;
    onChange?.(event);
  }

  function handleFocus(event: React.FocusEvent<HTMLInputElement>): void {
    if (controlledNumber) setNumberDraft(String(value));
    onFocus?.(event);
  }

  function handleBlur(event: React.FocusEvent<HTMLInputElement>): void {
    if (controlledNumber) setNumberDraft(null);
    onBlur?.(event);
  }

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
      onBlur={handleBlur}
      onChange={handleChange}
      onFocus={handleFocus}
      value={controlledNumber && numberDraft !== null ? numberDraft : value}
    />
  );
}

export { Input };
