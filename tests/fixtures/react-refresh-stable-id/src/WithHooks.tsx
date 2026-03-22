import React, { useState } from "react";

export type WithHooksProps = {
  label: string;
};

export function WithHooks({ label }: WithHooksProps) {
  const [count, setCount] = useState(0);
  return (
    <div data-testid="withhooks-root">
      <div data-testid="withhooks-label">{label}</div>
      <div data-testid="withhooks-count">{count}</div>
      <button
        type="button"
        data-testid="withhooks-inc"
        onClick={() => setCount((c) => c + 1)}
      >
        Increment
      </button>
    </div>
  );
}

