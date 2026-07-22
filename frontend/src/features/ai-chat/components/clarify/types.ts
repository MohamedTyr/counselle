import type { WidgetClarifyResponseV2 } from "@/api/chat/types";

export type ClarifyWidgetAnswer = {
  origin: "widget";
  text: string;
  response: WidgetClarifyResponseV2;
};
