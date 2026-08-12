"use client";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

type Props = {
  trigger: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** De trigger is meestal al een kaart of rij; dan geen extra opmaak. */
  triggerClassName?: string;
};

/** Detail als bottom sheet in plaats van een aparte pagina.
 *  Progressive disclosure zonder de context te verliezen: je blijft zien waar
 *  je vandaan kwam, en swipen sluit hem — dat voelt native op een telefoon. */
export function DetailDrawer({
  trigger,
  title,
  subtitle,
  children,
  triggerClassName = "block w-full text-left",
}: Props) {
  return (
    <Drawer>
      <DrawerTrigger className={triggerClassName}>{trigger}</DrawerTrigger>
        <DrawerContent>
          <div className="px-4 pb-2 pt-3">
            <DrawerTitle className="text-[16px] font-semibold leading-tight tracking-[-0.015em]">
              {title}
            </DrawerTitle>
            {subtitle ? (
              <DrawerDescription className="mt-0.5 text-[11px] font-medium text-faint">
                {subtitle}
              </DrawerDescription>
            ) : (
              // Radix vereist een beschrijving voor schermlezers.
              <DrawerDescription className="sr-only">Details</DrawerDescription>
            )}
          </div>

          <div className="overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
    </Drawer>
  );
}
