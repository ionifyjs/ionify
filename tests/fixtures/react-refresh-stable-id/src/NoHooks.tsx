import React from "react";

export type NoHooksProps = {
  label: string;
  name: string;
};

export function NoHooks({ label, name }: NoHooksProps) {
  return (
    <div data-testid="nohooks-root">
      <div data-testid="nohooks-label">{label}</div>
      <div data-testid="nohooks-props">{name}</div>
    </div>
  );
}

