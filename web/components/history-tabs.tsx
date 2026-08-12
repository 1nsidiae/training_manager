"use client";

import { Activity, MoonStar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function HistoryTabs({ training, recovery }: { training: React.ReactNode; recovery: React.ReactNode }) {
  return (
    <Tabs defaultValue="training">
      <TabsList aria-label="Historie bekijken">
        <TabsTrigger value="training">
          <Activity className="size-3.5" /> Training
        </TabsTrigger>
        <TabsTrigger value="recovery">
          <MoonStar className="size-3.5" /> Herstel
        </TabsTrigger>
      </TabsList>
      <TabsContent value="training">{training}</TabsContent>
      <TabsContent value="recovery">{recovery}</TabsContent>
    </Tabs>
  );
}
