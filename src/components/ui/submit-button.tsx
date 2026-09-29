"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./button";
import { useFormPendingContext } from "./use-action-form";

/** Submit button that disables itself while its form is pending (prevents double submits). */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const status = useFormStatus();
  const contextPending = useFormPendingContext();
  const pending = status.pending || contextPending;
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending || props.disabled} {...props}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
