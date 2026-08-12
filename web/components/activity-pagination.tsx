"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZES = [5, 10, 20];

function visiblePages(current: number, total: number) {
  const pages = Array.from(new Set([1, current - 1, current, current + 1, total]))
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  return pages.flatMap<(number | "ellipsis")>((page, index) => {
    const previous = pages[index - 1];
    return previous && page - previous > 1 ? ["ellipsis", page] : [page];
  });
}

export function ActivityPagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  function pageHref(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    params.set("perPage", String(pageSize));
    return `${pathname}?${params.toString()}#activiteiten`;
  }

  function changePageSize(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    params.set("perPage", value);
    router.replace(`${pathname}?${params.toString()}#activiteiten`, { scroll: false });
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium text-faint">
          {first}–{last} van {total}
        </span>
        <Select value={String(pageSize)} onValueChange={changePageSize}>
          <SelectTrigger className="w-[112px]" aria-label="Activiteiten per pagina">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>{size} per pagina</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {totalPages > 1 ? (
        <Pagination className="mt-3">
          <PaginationContent>
            {page > 1 ? (
              <PaginationItem>
                <PaginationLink asChild size="icon" aria-label="Vorige pagina">
                  <Link href={pageHref(page - 1)} scroll={false}><ChevronLeft /></Link>
                </PaginationLink>
              </PaginationItem>
            ) : null}

            {visiblePages(page, totalPages).map((item, index) =>
              item === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink asChild isActive={item === page} aria-label={`Pagina ${item}`}>
                    <Link href={pageHref(item)} scroll={false}>{item}</Link>
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            {page < totalPages ? (
              <PaginationItem>
                <PaginationLink asChild size="icon" aria-label="Volgende pagina">
                  <Link href={pageHref(page + 1)} scroll={false}><ChevronRight /></Link>
                </PaginationLink>
              </PaginationItem>
            ) : null}
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
