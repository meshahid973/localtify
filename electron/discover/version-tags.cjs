"use strict";
// Adapted with permission reported by the project owner from tryliner/desktop,
// src/shared/media/matching/versionTags.ts (source blob 25e17f5a33a3afa409ced7e838d7f9e7bcbba9ba).
const VERSION_PATTERNS = [
  { tag: "remix", regex: /\b(remix(?:ed)?|ремикс|rmx)\b/i },
  { tag: "vip", regex: /\b(vip|v\.i\.p\.?)\b/i },
  { tag: "flip", regex: /\b(flip|флип)\b/i },
  { tag: "bootleg", regex: /\b(bootleg|бутлег)\b/i },
  { tag: "mashup", regex: /\b(mash\s*up|мэшап|мешап)\b/i },
  { tag: "edit", regex: /\b((?:radio|club|extended)?\s*edit|эдит)\b/i },
  { tag: "slowed", regex: /\b(slowed(?:\s*(?:\+|&|and)\s*reverb)?|слоу)\b/i },
  { tag: "reverb", regex: /\b(reverb|реверб)\b/i },
  {
    tag: "sped_up",
    regex: /\b(sp(?:ed|eed)\s*up|sp(?:ed|eed)up|спид\s*ап|спидап)\b/i,
  },
  { tag: "nightcore", regex: /\b(nightcore|найткор)\b/i },
  { tag: "instrumental", regex: /\b(instrumental|инструментал|inst\b\.?)\b/i },
  { tag: "acoustic", regex: /\b(acoustic|акустика)\b/i },
  { tag: "live", regex: /\b(live(?:\s+at[^)]+)?|лайв|концерт)\b/i },
  { tag: "cover", regex: /\b(cover|кавер)\b/i },
  { tag: "bass_boosted", regex: /\b(bass\s*boost(?:ed)?|басс\s*буст)\b/i },
];

function getVersionTags(value) {
  const tags = new Set();
  for (const { tag, regex } of VERSION_PATTERNS) {
    if (regex.test(value)) tags.add(tag);
  }
  return tags;
}


// Artwork requires agreement on every version tag, not merely one in common.
function sameVersion(a,b){const x=getVersionTags(a),y=getVersionTags(b);return x.size===y.size&&[...x].every(tag=>y.has(tag));}
module.exports={getVersionTags,sameVersion};
