"use client";

import { createContext, startTransition, useActionState, useContext, type FormEvent } from "react";

/** Lets SubmitButton show pending state for forms submitted via useActionForm. */
export const FormPendingContext = createContext(false);
export const useFormPendingContext = () => useContext(FormPendingContext);

/**
 * useActionState wrapper that does NOT reset the form after the action runs.
 * React 19 resets uncontrolled fields after a `<form action>` completes, which
 * would wipe what the user typed when the server returns a validation error.
 * Bind both `action` (no-JS fallback) and `onSubmit` (JS path, no reset).
 */
export function useActionForm<S>(action: (state: Awaited<S>, formData: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
  return { state, pending, formProps: { action: dispatch, onSubmit } };
}
