import { z } from "zod";
import { richText, text, toggle } from "../fields.ts";
import { defineScene } from "./def.ts";

export const ctaEndCard = defineScene({
  type: "ctaEndCard",
  version: 1,
  schema: z.object({
    logo: toggle("Show logo", true),
    headline: richText("Headline", 60),
    button: text("Button label", 24),
    url: text("URL", 40, { help: "Defaults to the brand kit CTA URL." }).optional(),
    note: text("Note", 90).optional(),
    click: toggle("Cursor clicks the button", true),
  }),
  meta: { label: "CTA end card", category: "close", description: "Logo, headline and a button that gets clicked, with URL. Holds ≥ 5 s for posters and loops.",
    defaultMusicCue: "resolve", defaultTransition: { type: "iris" } },
  timing: () => ({ min: 6.0 }),
  example: { headline: "Run payroll *from one platform.*", button: "Book a demo", note: "Guided onboarding: we'll set it up with you." },
  stress: { headline: "A headline that is as long as allowed *by the schema*", button: "A long button label 24ch", url: "averyveryverylongdomainname.example.com",
    note: "A note that is close to its ninety-character maximum, to check it wraps and still fits." },
});
