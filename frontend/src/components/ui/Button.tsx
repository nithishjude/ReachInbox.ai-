import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 active:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600",
  secondary: "border border-line bg-surface text-fg shadow-sm hover:bg-subtle",
  ghost: "text-fg-muted hover:bg-subtle hover:text-fg",
  danger: "text-red-600 hover:bg-red-500/10 dark:text-red-400",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "h-9 w-9",
};

/** Button styling for elements that must be links (e.g. external URLs). */
export const buttonClasses = (variant: Variant = "primary", size: Size = "md") =>
  `focus-ring inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]}`;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className = "", children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} {...rest} disabled={disabled || loading} className={`${buttonClasses(variant, size)} ${className}`}>
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});
