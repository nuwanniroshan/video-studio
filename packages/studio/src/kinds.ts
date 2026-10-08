/*
 * Video types: narrative playbooks for the agent. A type is a story shape and a set of visual devices, not a layout:
 * the agent still designs every scene. Templates remain a separate, optional starting point.
 */
export interface VideoKind { id: string; label: string; blurb: string; arc: string; devices: string; goal: "promo" | "launch" | "explainer" | "announcement" | "social" }

export const KINDS: VideoKind[] = [
  { id: "auto", label: "Let the agent decide", blurb: "Picks the best story shape for your idea.", goal: "promo",
    arc: "Choose the story shape that best fits the idea from the types below, and say which one you chose and why.", devices: "" },
  { id: "promo", label: "Promo", blurb: "Make people want it: hook, desire, proof, offer.", goal: "promo",
    arc: "Hook (a feeling or tension, not the product) → the world of the product (sensory, specific) → 2–3 reasons, each its own beat → proof (a number, a quote, a crowd) → the offer and how to get it.",
    devices: "full-bleed illustration or image moments, big type against texture, counters for proof, a quote card, an offer card with a pill CTA" },
  { id: "explainer", label: "Explainer", blurb: "How something works, made simple.", goal: "explainer",
    arc: "The question or problem in one line → a simple mental model (one diagram that the rest of the video builds on) → how it works in 3–5 steps, walking the camera across the diagram (camera focus at each step) → a concrete example with real numbers → a one-line recap → what to do next.",
    devices: "a diagram of shapes/icons joined by arrows that grows step by step, camera focus moving between its parts, a numbered list, before/after split, a metaphor illustration (svg), a small chart for the example" },
  { id: "whats-new", label: "What's new", blurb: "Release notes and updates people actually watch.", goal: "launch",
    arc: "A version or date stamp and the headline change → the biggest update shown as a before → after → 2–4 more updates, one quick beat each (each with its own visual: icon card, mini chart, list with checks) → a fast 'and also' list → where/when to get it.",
    devices: "NEW / version pills (text with deco pill), before/after split with an arrow between, check lists, progress or column charts for improvements, typewriter for version numbers, screenshots in browser/phone frames if uploaded" },
  { id: "what-if", label: "What if…", blurb: "A thought experiment that pulls viewers in.", goal: "promo",
    arc: "The big 'What if …?' question in huge type → today's reality (muted colours, slow motion) → the imagined world (colour floods in, faster cuts) → 2–3 consequences that cascade from each other (arrows chaining cause → effect, counters) → the twist: it is possible now / here is how → an invitation.",
    devices: "question typography (display, letters or typewriter), a world split (left today / right what-if), chain-reaction arrows, counters that run away, colour-shifted backgrounds between acts, camera zoom-out reveal" },
  { id: "how-to", label: "How-to", blurb: "Step-by-step instructions.", goal: "explainer",
    arc: "What you will be able to do → what you need → steps 1…n, each its own scene with a big step number, one action and a visual of it → the result → a tip or next step.",
    devices: "big step numbers, progress bar across the steps (progress chart), screenshots with arrows pointing at the control, check list of what you need" },
  { id: "story", label: "Story", blurb: "A customer or founder story with a turning point.", goal: "promo",
    arc: "A person and their world → the struggle (specific, felt) → the turning point → the change, shown with a number → a quote in their words → what it means for the viewer.",
    devices: "a character illustration (svg), quote cards (quote style), a counter or line chart of the change, warm/cool background shift from struggle to outcome" },
  { id: "comparison", label: "Comparison", blurb: "Before vs after, us vs them, option A vs B.", goal: "promo",
    arc: "The choice in one line → criteria one by one, each scene comparing both sides → the scorecard → the verdict and next step.",
    devices: "split layouts with a divider line, check vs cross lists, bars side by side, a scorecard table built from lists, a highlight on the winner" },
  { id: "top-list", label: "Top list", blurb: "'5 reasons…', countdowns and listicles.", goal: "social",
    arc: "The promise ('5 reasons to…') → items counting down or up, one per beat with a huge number, a 3–7 word title and one visual → the best item last → recap list → CTA.",
    devices: "huge numbers (stat style), one illustration or icon per item, a running progress indicator, a recap list at the end" },
  { id: "data-story", label: "Data story", blurb: "Numbers that tell a story.", goal: "promo",
    arc: "A surprising number as the hook → context (what normal looks like) → the trend (line or area chart) → the breakdown (columns, bars or donut) → what it means → what to do.",
    devices: "counters, line/area charts that draw on, highlighted bars, donut with a big centre number, camera focus on the key data point" },
  { id: "announcement", label: "Announcement / event", blurb: "News, launches, openings, invitations.", goal: "announcement",
    arc: "The news in one line → why it matters → the details (date, place, who) → a reason to come or act now → how to join.",
    devices: "date and place in big type, a map-pin or calendar illustration, a countdown counter, confetti or sparkles for the moment, RSVP pill" },
  { id: "manifesto", label: "Manifesto / brand film", blurb: "Mood, values and big statements.", goal: "promo",
    arc: "A rhythm of short bold statements, each one a scene, building to the brand promise and the logo.",
    devices: "kinetic typography (words, letters, mask-like wipes), strong colour blocks, minimal abstract shapes, slow camera moves, the logo last" },
];

export const kindById = (id?: string) => KINDS.find((k) => k.id === id);
