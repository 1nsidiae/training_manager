import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { MoreHorizontal } from "lucide-react";
import { buttonVariants, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="Paginering"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("flex items-center gap-1", className)} {...props} />;
}

function PaginationItem(props: React.ComponentProps<"li">) {
  return <li {...props} />;
}

type PaginationLinkProps = React.ComponentProps<"a"> &
  Pick<ButtonProps, "size"> & {
    isActive?: boolean;
    asChild?: boolean;
  };

function PaginationLink({ className, isActive, size = "icon", asChild = false, ...props }: PaginationLinkProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      aria-current={isActive ? "page" : undefined}
      data-active={isActive}
      className={cn(
        buttonVariants({ variant: isActive ? "metric" : "ghost", size }),
        "size-9 min-h-9 rounded-full px-0 text-[10px] tracking-normal",
        className,
      )}
      {...props}
    />
  );
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span aria-hidden className={cn("grid size-9 place-items-center text-faint", className)} {...props}>
      <MoreHorizontal className="size-4" />
      <span className="sr-only">Meer pagina's</span>
    </span>
  );
}

export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink };
