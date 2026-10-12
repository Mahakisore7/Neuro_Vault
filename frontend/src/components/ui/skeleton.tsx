import { cn } from "@/lib/utils"

// A light sweep across the block (see skeleton-shimmer in globals.css)
// reads as "loading" better than a flat pulse, and stands still under
// prefers-reduced-motion.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
