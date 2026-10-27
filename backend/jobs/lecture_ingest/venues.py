"""Derive building codes and online status from NUSMods venues."""

ONLINE_PREFIXES = ("E-Learn", "E-Hybrid")

# Lecture theatre and other unprefixed venue codes do not identify their buildings;
# unmapped venues return None.
LECTURE_THEATRE_BUILDINGS = {
    "LT1": "E2",
    "LT2": "E2",
    "LT6": "E4",
    "LT7": "E3A",
    "LT7A": "E3A",
    "LT8": "AS5",
    "LT9": "AS4",
    "LT10": "AS4",
    "LT11": "AS2",
    "LT12": "AS2",
    "LT13": "AS2",
    "LT14": "AS6",
    "LT15": "AS6",
    "LT16": "COM2",
    "LT17": "COM2",
    "LT18": "BIZ2",
    "LT19": "COM2",
    "LT20": "S1A",
    "LT21": "S5",
    "LT26": "MD7",
    "LT27": "S16",
    "LT28": "S16",
    "LT29": "MD9",
    "LT31": "S16",
    "LT32": "S1A",
    "LT33": "S17",
    "LT34": "S17",
    "LT3": "CLB",
    "LT4": "CLB",
    "SR_LT19": "COM2",
    "COM4SR31": "COM4",
    "COM4SR32": "COM4",
    "COM4SR33": "COM4",
    "CQT/SR0514": "S15",
    "MD11CRCAUD": "MD11",
    "CFG_CARSPA": "YIH",
    "LKY_TB10SR": "LKYSPP",
}


def is_online(venue: str) -> bool:
    return venue.startswith(ONLINE_PREFIXES)


def building_for(venue: str) -> str | None:
    """`COM1-0207` -> `COM1`; mapped lecture theatres; otherwise None."""
    if venue in LECTURE_THEATRE_BUILDINGS:
        return LECTURE_THEATRE_BUILDINGS[venue]
    if is_online(venue) or "-" not in venue:
        return None
    return venue.split("-", 1)[0]
