import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Mint (#84): the design's calmer tl-pulse (floors at 0.4) over Tailwind's animate-pulse, so loading states share the shell's motion vocabulary.
      className={cn("tl-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
