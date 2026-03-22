import React from "react";
import { NoHooks } from "./NoHooks";
import { WithHooks } from "./WithHooks";

export function App() {
  return (
    <div>
      <h1>Ionify React Refresh Fixture</h1>

      <section>
        <h2>NoHooks</h2>
        <NoHooks label="NoHooks label" name="Ionify" />
      </section>

      <section>
        <h2>WithHooks</h2>
        <WithHooks label="WithHooks label" />
      </section>
    </div>
  );
}

