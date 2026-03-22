export type IonifyComponentTemplate = {
  name: string;
  description: string;
  fileBase: string;
  tsx: string;
  jsx: string;
};

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

const BUTTON_TSX = normalizeNewlines(`\
import * as React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    const base = "ionify-button";
    const v =
      variant === "secondary"
        ? "ionify-button--secondary"
        : variant === "ghost"
          ? "ionify-button--ghost"
          : "";
    const cn = [base, v, className].filter(Boolean).join(" ");
    return <button ref={ref} className={cn} {...props} />;
  },
);
Button.displayName = "Button";
`);

const BUTTON_JSX = normalizeNewlines(`\
import * as React from "react";

export const Button = React.forwardRef(function Button(
  { variant = "default", className = "", ...props },
  ref,
) {
  const base = "ionify-button";
  const v =
    variant === "secondary"
      ? "ionify-button--secondary"
      : variant === "ghost"
        ? "ionify-button--ghost"
        : "";
  const cn = [base, v, className].filter(Boolean).join(" ");
  return <button ref={ref} className={cn} {...props} />;
});
`);

const CARD_TSX = normalizeNewlines(`\
import * as React from "react";

export function Card({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["ionify-card", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["ionify-card__header", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={["ionify-card__title", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["ionify-card__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);

const CARD_JSX = normalizeNewlines(`\
import * as React from "react";

export function Card({ className = "", ...props }) {
  return <div className={["ionify-card", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({ className = "", ...props }) {
  return <div className={["ionify-card__header", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({ className = "", ...props }) {
  return <h3 className={["ionify-card__title", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({ className = "", ...props }) {
  return <div className={["ionify-card__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);

const DIALOG_TSX = normalizeNewlines(`\
import * as React from "react";

type DialogContextValue = {
  open: boolean;
  setOpen(next: boolean): void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used inside <Dialog />");
  return ctx;
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ open, setOpen: onOpenChange }),
    [open, onOpenChange],
  );
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({
  children,
}: {
  children: React.ReactElement;
}) {
  const { open, setOpen } = useDialogContext();
  return React.cloneElement(children, {
    onClick: (e: any) => {
      children.props.onClick?.(e);
      setOpen(!open);
    },
  });
}

export function DialogOverlay({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen } = useDialogContext();
  if (!open) return null;
  return (
    <div
      className={["ionify-dialog__overlay", className].filter(Boolean).join(" ")}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

export function DialogContent({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = useDialogContext();
  if (!open) return null;
  return <div className={["ionify-dialog__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);

const DIALOG_JSX = normalizeNewlines(`\
import * as React from "react";

const DialogContext = React.createContext(null);

function useDialogContext() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used inside <Dialog />");
  return ctx;
}

export function Dialog({ open, onOpenChange, children }) {
  const value = React.useMemo(
    () => ({ open, setOpen: onOpenChange }),
    [open, onOpenChange],
  );
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({ children }) {
  const { open, setOpen } = useDialogContext();
  return React.cloneElement(children, {
    onClick: (e) => {
      children.props.onClick?.(e);
      setOpen(!open);
    },
  });
}

export function DialogOverlay({ className = "", ...props }) {
  const { open, setOpen } = useDialogContext();
  if (!open) return null;
  return (
    <div
      className={["ionify-dialog__overlay", className].filter(Boolean).join(" ")}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

export function DialogContent({ className = "", ...props }) {
  const { open } = useDialogContext();
  if (!open) return null;
  return <div className={["ionify-dialog__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);

export const IONIFY_COMPONENTS: Record<string, IonifyComponentTemplate> = {
  button: {
    name: "button",
    description: "Basic <Button /> with variants (no external deps)",
    fileBase: "button",
    tsx: BUTTON_TSX,
    jsx: BUTTON_JSX,
  },
  card: {
    name: "card",
    description: "Card primitives (<Card />, <CardHeader />, etc.)",
    fileBase: "card",
    tsx: CARD_TSX,
    jsx: CARD_JSX,
  },
  dialog: {
    name: "dialog",
    description: "Lightweight dialog primitives (context-based, no external deps)",
    fileBase: "dialog",
    tsx: DIALOG_TSX,
    jsx: DIALOG_JSX,
  },
};

