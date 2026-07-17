import type { SenseDisambiguation } from "./types";

/**
 * Contextual sense resolution — surrounding cues decide meaning.
 * Avoid bare-token holidays → Christmas, party → dance floor, club → nightclub, etc.
 */
export const SENSE_DISAMBIGUATIONS: SenseDisambiguation[] = [
  {
    surface: "holiday",
    senses: [
      {
        id: "holiday.christmas",
        when: [
          /\b(?:christmas|xmas|noel|santa|festive|yuletide|holiday\s+song|holiday\s+classics|christmas\s+holiday|winter\s+holiday|december)\b/i,
        ],
        sceneId: "christmas_holiday",
        effects: { suppressChristmas: false },
      },
      {
        id: "holiday.after",
        when: [
          /\b(?:back\s+from\s+(?:a\s+|the\s+)?(?:holiday|vacation)|after\s+(?:a\s+|the\s+)?(?:holiday|vacation)|holiday\s+(?:ends|ended|is\s+over|over)|post[-\s]?holiday|holiday\s+blues|day\s+after\s+(?:a\s+|the\s+)?holiday)\b/i,
        ],
        unless: [
          /\b(?:christmas|xmas|noel|santa|festive\s+season|holiday\s+song|holiday\s+classics|yuletide)\b/i,
        ],
        sceneId: "after_holiday",
        effects: {
          suppressChristmas: true,
          forceEnergy: "low",
          preferMusicalBehaviour: "reflective_indie",
        },
      },
      {
        id: "holiday.vacation",
        when: [
          /\b(?:on\s+holiday|summer\s+holiday|bank\s+holiday|half\s+term|going\s+on\s+holiday|holiday\s+abroad|vacation)\b/i,
          /\bholiday\b/i,
        ],
        unless: [
          /\b(?:christmas|xmas|noel|santa|festive\s+season|holiday\s+song|holiday\s+classics|yuletide|back\s+from|after\s+(?:a\s+|the\s+)?holiday|holiday\s+(?:ends|ended|is\s+over)|post[-\s]?holiday|holiday\s+blues)\b/i,
        ],
        sceneId: "holiday_vacation",
        effects: { suppressChristmas: true },
      },
      {
        id: "holiday.bank",
        when: [/\bbank\s+holiday\b/i],
        unless: [/\b(?:christmas|xmas)\b/i],
        sceneId: "holiday_vacation",
        effects: { suppressChristmas: true },
      },
    ],
  },
  {
    surface: "party",
    senses: [
      {
        id: "party.birthday",
        when: [/\bbirthday\s+party\b/i, /\bbirthday\b/i],
        sceneId: "birthday_party",
      },
      {
        id: "party.house",
        when: [/\bhouse\s+party\b/i, /\bhouseparty\b/i],
        sceneId: "house_party",
      },
      {
        id: "party.political",
        when: [/\b(?:political|labour|conservative|republican|democrat|green)\s+party\b/i],
        effects: { demotePartyActivity: true },
      },
      {
        id: "party.after",
        when: [/\bafter\s+(?:the\s+|a\s+)?party\b/i, /\bafterparty\b/i, /\bafter\s+party\b/i],
        sceneId: "after_party",
        effects: { forceEnergy: "low", demotePartyActivity: true, preferMusicalBehaviour: "soft_electronic" },
      },
      {
        id: "party.celebration",
        when: [/\b(?:party|parties)\b/i],
        unless: [
          /\b(?:political|labour|conservative)\s+party\b/i,
          /\bafter\s+(?:the\s+|a\s+)?party\b/i,
          /\bafterparty\b/i,
        ],
        sceneId: "house_party",
      },
    ],
  },
  {
    surface: "club",
    senses: [
      {
        id: "club.nightclub",
        when: [
          /\b(?:night\s*)?club\b/i,
          /\bclub\s+(?:night|banger|mix|set|dancefloor|dance\s+floor)\b/i,
        ],
        unless: [
          /\b(?:book|sports|football|golf|rowing|yacht|fan|social)\s+club\b/i,
          /\bclub\s+sandwich\b/i,
        ],
        sceneId: "rave",
      },
      {
        id: "club.book",
        when: [/\bbook\s+club\b/i],
        effects: { demotePartyActivity: true, forceEnergy: "low", preferMusicalBehaviour: "reflective_indie" },
      },
      {
        id: "club.sports",
        when: [/\b(?:sports|football|golf|rowing|yacht|fan)\s+club\b/i],
        effects: { demotePartyActivity: true },
      },
    ],
  },
  {
    surface: "home",
    senses: [
      {
        id: "home.returning",
        when: [
          /\b(?:returning|coming|heading|back)\s+home\b/i,
          /\bon\s+the\s+way\s+home\b/i,
          /\bback\s+home\b/i,
        ],
        sceneId: "returning_home",
        effects: { forceEnergy: "low", preferMusicalBehaviour: "nostalgic_warm" },
      },
      {
        id: "home.leaving",
        when: [/\bleaving\s+home\b/i, /\bleft\s+home\b/i, /\bmoving\s+out\b/i],
        sceneId: "leaving_home",
      },
      {
        id: "home.family",
        when: [/\bfamily\s+(?:home|house|dinner|gathering)\b/i, /\bat\s+(?:my|our)\s+(?:parents'?|family)\s+(?:house|home)\b/i],
        sceneId: "family_gathering",
      },
      {
        id: "home.house",
        when: [/\b(?:at\s+)?home\b/i, /\bhouse\b/i],
        unless: [
          /\b(?:returning|coming|heading|back|leaving)\s+home\b/i,
          /\bhouse\s+party\b/i,
          /\bmoving\s+house\b/i,
        ],
      },
    ],
  },
  {
    surface: "spring",
    senses: [
      {
        id: "spring.season",
        when: [
          /\b(?:spring\s+(?:evening|morning|day|air|rain|walk)|in\s+spring|early\s+spring|late\s+spring|springtime)\b/i,
        ],
      },
      {
        id: "spring.mechanical",
        when: [/\b(?:coil\s+spring|suspension\s+spring|mattress\s+spring|spring\s+mechanism)\b/i],
      },
    ],
  },
  {
    surface: "rave",
    senses: [
      {
        id: "rave.comedown",
        when: [
          /\b(?:rave|club|festival)\s+comedown\b/i,
          /\bcomedown\b/i,
          /\bafter\s+(?:the\s+|a\s+)?rave\b/i,
          /\bpost[-\s]?rave\b/i,
          /\bbus\s+home\b.*\brave\b|\brave\b.*\bbus\b/i,
        ],
        sceneId: "rave_comedown",
        effects: {
          forceEnergy: "low",
          demotePartyActivity: true,
          preferMusicalBehaviour: "soft_electronic",
          suppressChristmas: true,
        },
      },
      {
        id: "rave.peak",
        when: [/\brave\b/i],
        unless: [
          /\b(?:comedown|after\s+(?:the\s+|a\s+)?rave|post[-\s]?rave|hangover|bus\s+home)\b/i,
        ],
        sceneId: "rave",
      },
    ],
  },
];
