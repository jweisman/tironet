import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => ({
  locale: "he",
  messages: (await import("@/messages/he.json")).default,
}));
