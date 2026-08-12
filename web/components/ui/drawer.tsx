"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

function Drawer(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      {...props}
      shouldScaleBackground={false}
      /* Vaul beslist op basis van de richting en scrollpositie: omhoog blijft
         native content scrollen; omlaag sleept de sheet zodra de scroller aan
         de bovenkant staat. Zo werkt de volledige drawer als gesturegebied. */
      handleOnly={false}
      scrollLockTimeout={150}
      dismissible
    />
  );
}

function DrawerNested(props: React.ComponentProps<typeof DrawerPrimitive.NestedRoot>) {
  return (
    <DrawerPrimitive.NestedRoot
      {...props}
      handleOnly={false}
      scrollLockTimeout={150}
      dismissible
    />
  );
}

const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerPortal = DrawerPrimitive.Portal;
const DrawerClose = DrawerPrimitive.Close;

function DrawerOverlay({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return <DrawerPrimitive.Overlay className={cn("app-drawer-overlay fixed inset-0 z-[60] bg-black/70 backdrop-blur-[3px]", className)} {...props} />;
}

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        className={cn("app-drawer-content fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[90vh] max-w-lg flex-col rounded-t-[24px] border-t border-line-strong bg-s1 outline-none", className)}
        {...props}
      >
        <DrawerPrimitive.Handle
          preventCycle
          className="shrink-0"
          style={{
            width: "100%",
            height: 32,
            marginTop: 0,
            opacity: 1,
            borderRadius: 0,
            backgroundColor: "transparent",
            backgroundImage: "linear-gradient(var(--color-s3), var(--color-s3))",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "40px 4px",
          }}
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

const DrawerTitle = DrawerPrimitive.Title;
const DrawerDescription = DrawerPrimitive.Description;

export { Drawer, DrawerNested, DrawerTrigger, DrawerPortal, DrawerClose, DrawerOverlay, DrawerContent, DrawerTitle, DrawerDescription };
