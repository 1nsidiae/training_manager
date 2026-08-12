"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

function Drawer(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root {...props} shouldScaleBackground={false} handleOnly />;
}

function DrawerNested(props: React.ComponentProps<typeof DrawerPrimitive.NestedRoot>) {
  return <DrawerPrimitive.NestedRoot {...props} handleOnly />;
}

const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerPortal = DrawerPrimitive.Portal;
const DrawerClose = DrawerPrimitive.Close;

function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return <DrawerPrimitive.Overlay className={cn("fixed inset-0 z-[60] bg-black/70 backdrop-blur-[3px]", className)} {...props} />;
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        className={cn("fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[90vh] max-w-lg flex-col rounded-t-[24px] border-t border-line-strong bg-s1 outline-none", className)}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        {...props}
      >
        <DrawerPrimitive.Handle
          className="mt-2.5 shrink-0"
          style={{ width: 40, height: 4, opacity: 1, backgroundColor: "var(--color-s3)" }}
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

const DrawerTitle = DrawerPrimitive.Title;
const DrawerDescription = DrawerPrimitive.Description;

export { Drawer, DrawerNested, DrawerTrigger, DrawerPortal, DrawerClose, DrawerOverlay, DrawerContent, DrawerTitle, DrawerDescription };
