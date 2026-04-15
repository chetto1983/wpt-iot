import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80 dark:bg-[oklch(0.48_0.13_175)] dark:hover:bg-[oklch(0.44_0.13_175)]",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/15 dark:text-foreground dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      severity: {
        critical: "bg-card text-severity-critical dark:bg-background dark:border-severity-critical/40 [a]:hover:bg-severity-critical/20",
        high:     "bg-card text-severity-high     dark:bg-background dark:border-severity-high/40     [a]:hover:bg-severity-high/20",
        medium:   "bg-card text-severity-medium   dark:bg-background dark:border-severity-medium/40   [a]:hover:bg-severity-medium/20",
        low:      "bg-card text-severity-low      dark:bg-background dark:border-severity-low/40      [a]:hover:bg-severity-low/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  severity,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, severity }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      severity,
    },
  })
}

export { Badge }
