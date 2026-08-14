"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";

function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      expand={false}
      visibleToasts={3}
      duration={4200}
      gap={8}
      offset={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top, 0px) + 12px)",
        left: 12,
        right: 12,
      }}
      swipeDirections={["top", "left", "right"]}
      icons={{
        success: <CheckCircle2 className="size-4" strokeWidth={2.25} />,
        info: <Info className="size-4" strokeWidth={2.25} />,
        warning: <AlertTriangle className="size-4" strokeWidth={2.25} />,
        error: <XCircle className="size-4" strokeWidth={2.25} />,
        loading: <LoaderCircle className="size-4 animate-spin" strokeWidth={2.25} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "pointer-events-auto flex w-full items-start gap-3 rounded-card border border-line-strong bg-s2/95 p-3.5 text-ink shadow-2xl backdrop-blur-xl",
          content: "min-w-0 flex-1",
          title: "text-[12px] font-semibold leading-snug tracking-[-0.01em] text-ink",
          description: "mt-1 text-[10px] font-medium leading-relaxed text-muted",
          icon: "mt-0.5 grid size-5 shrink-0 place-items-center",
          success: "text-teal",
          info: "text-recovery",
          warning: "text-warning",
          error: "text-danger",
          loading: "text-recovery",
          actionButton:
            "ml-2 shrink-0 rounded-row bg-ink px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-canvas",
          cancelButton:
            "ml-2 shrink-0 rounded-row border border-line-strong px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted",
        },
      }}
    />
  );
}

export { Toaster, toast };
