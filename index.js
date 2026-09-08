require("dotenv").config();

const fs = require("fs");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");

// ======================================================
// CONFIG
// ======================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const API_KEY = process.env.FOOTBALLDATA_API_KEY;

const API_BASE = "https://footballdata.io/api/v1";
const TFF_URL = "https://www.tff.org/default.aspx?pageID=198";

const DB_FILE = "./sent.json";

const ARGS = process.argv.slice(2);

const FORCE = ARGS.includes("--force");
const NEXT_WEEK = ARGS.includes("--next-week");

// ======================================================
// 3 BÜYÜKLER
// ======================================================

const TEAMS = {
    FENERBAHCE: {
        aliases: [
            "FENERBAHCE"
        ],

        color: 0x002d72,

        logo:
            "https://www.freepnglogos.com/uploads/fenerbahce-logo-png/fb-logo-transparent-png-18.png",

        stadium:
            "Chobani Stadyumu Fenerbahçe Şükrü Saracoğlu Spor Kompleksi"
    },

    GALATASARAY: {
        aliases: [
            "GALATASARAY"
        ],

        color: 0xa90432,

        logo:
            "https://e7.pngegg.com/pngimages/594/298/png-clipart-galatasaray-s-k-super-lig-goztepe-s-k-kas%C4%B1mpa%C5%9Fa-s-k-konyaspor-football-text-sport.png",

        stadium:
            "Ali Sami Yen Spor Kompleksi RAMS Park"
    },

    BESIKTAS: {
        aliases: [
            "BESIKTAS"
        ],

        color: 0x000000,

        logo:
            "https://www.freepnglogos.com/uploads/besiktas-logo-png/besiktas-logo-download-10.png",

        stadium:
            "Tüpraş Stadyumu"
    }
};

// ======================================================
// DİĞER STATLAR
// ======================================================

const OTHER_STADIUMS = [
    {
        aliases: [
            "GAZIANTEP"
        ],

        stadium:
            "Gaziantep Stadyumu"
    },

    {
        aliases: [
            "KOCAELISPOR"
        ],

        stadium:
            "Kocaeli Stadyumu"
    },

    {
        aliases: [
            "ERZURUMSPOR"
        ],

        stadium:
            "Kazım Karabekir Stadyumu"
    },

    {
        aliases: [
            "SPORTING CP",
            "SPORTING"
        ],

        stadium:
            "Estádio José Alvalade"
    },

    {
        aliases: [
            "ROMA"
        ],

        stadium:
            "Stadio Olimpico"
    },

    {
        aliases: [
            "MARSEILLE"
        ],

        stadium:
            "Orange Vélodrome"
    }
];

// ======================================================
// AVRUPA KUPALARI
// ======================================================

const EUROPE_COMPETITIONS = [
    {
        search:
            "UEFA Champions League",

        required: [
            "CHAMPIONS",
            "LEAGUE"
        ],

        excluded: [],

        key:
            "champions",

        name:
            "UEFA Champions League",

        emoji:
            "🏆"
    },

    {
        search:
            "UEFA Europa League",

        required: [
            "EUROPA",
            "LEAGUE"
        ],

        excluded: [
            "CONFERENCE"
        ],

        key:
            "europa",

        name:
            "UEFA Europa League",

        emoji:
            "🟠"
    }
];

// ======================================================
// TEXT HELPERS
// ======================================================

function clean(text = "") {
    return String(text)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/*
    ÇOK ÖNEMLİ:

    Burada tr-TR uppercase kullanmıyoruz.

    Champions -> CHAMPIONS olarak kalacak.
    CHAMPİONS bug'ı olmayacak.
*/

function foldText(text = "") {
    return clean(text)
        .toUpperCase()
        .replaceAll("İ", "I")
        .replaceAll("Ş", "S")
        .replaceAll("Ç", "C")
        .replaceAll("Ğ", "G")
        .replaceAll("Ö", "O")
        .replaceAll("Ü", "U");
}

function displayName(text = "") {
    return clean(text)
        .replace(/\s+A\.Ş\.\s*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

// ======================================================
// TAKIM TANIMA
// ======================================================

function getTeamKey(name = "") {
    const folded =
        foldText(name);

    for (
        const [key, team] of
        Object.entries(TEAMS)
    ) {
        if (
            team.aliases.some(
                alias =>
                    folded.includes(
                        alias
                    )
            )
        ) {
            return key;
        }
    }

    return null;
}

function isTracked(name) {
    return (
        getTeamKey(name) !==
        null
    );
}

function getTrackedTeam(
    home,
    away
) {
    if (isTracked(home)) {
        return home;
    }

    if (isTracked(away)) {
        return away;
    }

    return null;
}

function isDerby(
    home,
    away
) {
    return (
        isTracked(home) &&
        isTracked(away)
    );
}

// ======================================================
// LOGO + RENK
// ======================================================

function getTeamLogo(name) {
    const key =
        getTeamKey(name);

    if (!key) {
        return null;
    }

    return TEAMS[key].logo;
}

function getTeamColor(name) {
    const key =
        getTeamKey(name);

    if (!key) {
        return 0x5865f2;
    }

    return TEAMS[key].color;
}

function getMatchColor(
    home,
    away
) {
    // Derbide ev sahibinin rengi
    if (
        isDerby(
            home,
            away
        )
    ) {
        return getTeamColor(
            home
        );
    }

    const tracked =
        getTrackedTeam(
            home,
            away
        );

    return tracked
        ? getTeamColor(
            tracked
        )
        : 0x5865f2;
}

// ======================================================
// STADYUM
// ======================================================

function fallbackStadium(
    home
) {
    const trackedKey =
        getTeamKey(home);

    if (trackedKey) {
        return TEAMS[
            trackedKey
        ].stadium;
    }

    const folded =
        foldText(home);

    for (
        const item of
        OTHER_STADIUMS
    ) {
        if (
            item.aliases.some(
                alias =>
                    folded.includes(
                        alias
                    )
            )
        ) {
            return item.stadium;
        }
    }

    return "Henüz açıklanmadı";
}

function looksLikeTeamName(
    value = ""
) {
    const n =
        foldText(value);

    if (!n) {
        return true;
    }

    return (
        isTracked(value) ||

        n.includes(
            "FUTBOL KULUBU"
        ) ||

        n.includes(
            "SPOR KULUBU"
        ) ||

        n.endsWith(" FK") ||

        n.endsWith(" SK") ||

        n.includes(" A.S")
    );
}

function sanitizeVenue(
    venue,
    home,
    away = ""
) {
    const value =
        clean(
            venue || ""
        );

    if (!value) {
        return fallbackStadium(
            home
        );
    }

    const v =
        foldText(value);

    if (
        v ===
            foldText(home) ||

        v ===
            foldText(away) ||

        looksLikeTeamName(
            value
        ) ||

        value.length < 4
    ) {
        return fallbackStadium(
            home
        );
    }

    return value;
}

// ======================================================
// SENT.JSON
// ======================================================

function loadDatabase() {
    if (
        !fs.existsSync(
            DB_FILE
        )
    ) {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(
                {},
                null,
                2
            )
        );

        return {};
    }

    try {
        const parsed =
            JSON.parse(
                fs.readFileSync(
                    DB_FILE,
                    "utf8"
                )
            );

        // eski array formatı
        if (
            Array.isArray(
                parsed
            )
        ) {
            const converted = {};

            for (
                const id of
                parsed
            ) {
                converted[
                    String(id)
                ] = {
                    sent: true
                };
            }

            return converted;
        }

        return (
            parsed &&
            typeof parsed ===
                "object"
        )
            ? parsed
            : {};

    } catch {
        return {};
    }
}

function saveDatabase(
    db
) {
    fs.writeFileSync(
        DB_FILE,

        JSON.stringify(
            db,
            null,
            2
        )
    );
}

// ======================================================
// TARİH
// ======================================================

function getDateWindow() {
    const now =
        new Date();

    const DAY =
        24 *
        60 *
        60 *
        1000;

    /*
        --next-week:
        7-14 gün arası
    */

    if (NEXT_WEEK) {
        return {
            start:
                new Date(
                    now.getTime() +
                    7 * DAY
                ),

            end:
                new Date(
                    now.getTime() +
                    14 * DAY
                )
        };
    }

    /*
        Normal:
        önümüzdeki 14 gün
    */

    return {
        start:
            now,

        end:
            new Date(
                now.getTime() +
                14 * DAY
            )
    };
}

function apiDateString(
    date
) {
    const parts =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:
                    "Europe/Istanbul",

                year:
                    "numeric",

                month:
                    "2-digit",

                day:
                    "2-digit"
            }
        )
            .formatToParts(
                date
            );

    const map = {};

    for (
        const part of
        parts
    ) {
        map[
            part.type
        ] =
            part.value;
    }

    return (
        `${map.year}-` +
        `${map.month}-` +
        `${map.day}`
    );
}

function formatTurkeyDateTime(
    date
) {
    return {
        date:
            new Intl.DateTimeFormat(
                "tr-TR",
                {
                    timeZone:
                        "Europe/Istanbul",

                    weekday:
                        "long",

                    day:
                        "numeric",

                    month:
                        "long",

                    year:
                        "numeric"
                }
            ).format(
                date
            ),

        time:
            new Intl.DateTimeFormat(
                "tr-TR",
                {
                    timeZone:
                        "Europe/Istanbul",

                    hour:
                        "2-digit",

                    minute:
                        "2-digit",

                    hour12:
                        false
                }
            ).format(
                date
            )
    };
}

function countdown(
    date
) {
    const diff =
        date.getTime() -
        Date.now();

    if (diff <= 0) {
        return (
            "Başladı / tamamlandı"
        );
    }

    const totalMinutes =
        Math.floor(
            diff /
            60000
        );

    const days =
        Math.floor(
            totalMinutes /
            1440
        );

    const hours =
        Math.floor(
            (
                totalMinutes %
                1440
            ) /
            60
        );

    const minutes =
        totalMinutes %
        60;

    if (days > 0) {
        return (
            `${days} gün ` +
            `${hours} saat kaldı`
        );
    }

    if (hours > 0) {
        return (
            `${hours} saat ` +
            `${minutes} dakika kaldı`
        );
    }

    return (
        `${minutes} dakika kaldı`
    );
}

// ======================================================
// FOOTBALLDATA API
// ======================================================

async function apiGet(
    path
) {
    if (!API_KEY) {
        throw new Error(
            "FOOTBALLDATA_API_KEY eksik."
        );
    }

    const response =
        await fetch(
            `${API_BASE}${path}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${API_KEY}`,

                    Accept:
                        "application/json"
                }
            }
        );

    let data;

    try {
        data =
            await response.json();

    } catch {
        throw new Error(
            `API JSON okunamadı. HTTP ${response.status}`
        );
    }

    if (
        !response.ok
    ) {
        throw new Error(
            `Footballdata HTTP ${response.status}: ${JSON.stringify(data)}`
        );
    }

    return data;
}

function extractArray(
    data
) {
    if (
        Array.isArray(
            data
        )
    ) {
        return data;
    }

    if (
        Array.isArray(
            data?.data
        )
    ) {
        return data.data;
    }

    if (
        Array.isArray(
            data?.matches
        )
    ) {
        return data.matches;
    }

    if (
        Array.isArray(
            data?.data?.matches
        )
    ) {
        return data.data.matches;
    }

    return [];
}

// ======================================================
// API MAÇ PARSER
// ======================================================

function apiHome(
    match
) {
    return clean(
        match.home_team
            ?.team_name ||

        match.home_team
            ?.name ||

        match.home_team_name ||

        match.home
            ?.team_name ||

        match.home
            ?.name ||

        ""
    );
}

function apiAway(
    match
) {
    return clean(
        match.away_team
            ?.team_name ||

        match.away_team
            ?.name ||

        match.away_team_name ||

        match.away
            ?.team_name ||

        match.away
            ?.name ||

        ""
    );
}

function apiMatchDate(
    match
) {
    if (
        match.date_unix !==
            undefined &&
        match.date_unix !==
            null
    ) {
        const unix =
            Number(
                match.date_unix
            );

        if (
            Number.isFinite(
                unix
            )
        ) {
            /*
                hem saniye hem
                milisaniye desteği
            */

            const ms =
                unix >
                1e12
                    ? unix
                    : unix *
                      1000;

            const date =
                new Date(
                    ms
                );

            if (
                !Number.isNaN(
                    date.getTime()
                )
            ) {
                return date;
            }
        }
    }

    const values = [
        match.datetime,
        match.utc_date,
        match.kickoff,
        match.start_time,
        match.match_date,
        match.date
    ];

    for (
        const value of
        values
    ) {
        if (!value) {
            continue;
        }

        const date =
            new Date(
                value
            );

        if (
            !Number.isNaN(
                date.getTime()
            )
        ) {
            return date;
        }
    }

    return null;
}

function apiVenue(
    match
) {
    const values = [
        match.venue?.name,

        match.venue_name,

        match.stadium_name,

        match.stadium,

        typeof match.venue ===
            "string"
            ? match.venue
            : null
    ];

    return (
        values.find(
            value =>
                typeof value ===
                    "string" &&
                value.trim()
        )
            ?.trim() ||
        null
    );
}

function apiRound(
    match
) {
    return String(
        match.round ||
        match.round_name ||
        match.game_week ||
        match.matchday ||
        "Lig Aşaması"
    );
}

function apiHomeLogo(
    match
) {
    return (
        match.home_team
            ?.team_logo ||

        match.home_team
            ?.logo ||

        match.home_logo ||

        null
    );
}

function apiAwayLogo(
    match
) {
    return (
        match.away_team
            ?.team_logo ||

        match.away_team
            ?.logo ||

        match.away_logo ||

        null
    );
}

// ======================================================
// LİG ID BUL
// ======================================================

async function findLeague(
    competition
) {
    const response =
        await apiGet(
            `/leagues?search=${encodeURIComponent(
                competition.search
            )}`
        );

    const leagues =
        extractArray(
            response
        );

    const found =
        leagues.find(
            item => {
                /*
                    Burada özellikle
                    normal toUpperCase()
                    kullanıyoruz.
                */

                const name =
                    clean(
                        item.league_name ||
                        item.name ||
                        ""
                    )
                        .toUpperCase();

                return (
                    competition.required
                        .every(
                            word =>
                                name.includes(
                                    word
                                )
                        ) &&

                    competition.excluded
                        .every(
                            word =>
                                !name.includes(
                                    word
                                )
                        )
                );
            }
        );

    if (!found) {
        return null;
    }

    return {
        id:
            found.league_id ||
            found.id,

        name:
            found.league_name ||
            found.name ||
            competition.name
    };
}

// ======================================================
// AVRUPA KUPASI MAÇLARI
// ======================================================

async function getCompetitionMatches(
    competition
) {
    console.log("");
    console.log(
        `${competition.emoji} ${competition.name} aranıyor...`
    );

    const league =
        await findLeague(
            competition
        );

    if (
        !league?.id
    ) {
        console.log(
            `❌ ${competition.name} league_id bulunamadı.`
        );

        return [];
    }

    console.log(
        `✅ ${competition.name} league_id=${league.id}`
    );

    const {
        start,
        end
    } =
        getDateWindow();

    const from =
        apiDateString(
            start
        );

    const to =
        apiDateString(
            end
        );

    const raw = [];

    // ==================================================
    // KAYNAK 1
    // league matches
    // ==================================================

    try {
        const response =
            await apiGet(
                `/leagues/${league.id}/matches` +
                `?from=${encodeURIComponent(from)}` +
                `&to=${encodeURIComponent(to)}` +
                `&limit=100`
            );

        const list =
            extractArray(
                response
            );

        console.log(
            `   📡 League matches: ${list.length}`
        );

        raw.push(
            ...list
        );

    } catch (error) {
        console.log(
            `   ⚠️ League matches: ${error.message}`
        );
    }

    // ==================================================
    // KAYNAK 2
    // upcoming
    // ==================================================

    try {
        const response =
            await apiGet(
                `/fixtures/upcoming` +
                `?league_id=${league.id}` +
                `&from=${encodeURIComponent(from)}` +
                `&to=${encodeURIComponent(to)}` +
                `&limit=100`
            );

        const list =
            extractArray(
                response
            );

        console.log(
            `   📡 Upcoming: ${list.length}`
        );

        raw.push(
            ...list
        );

    } catch (error) {
        console.log(
            `   ⚠️ Upcoming: ${error.message}`
        );
    }

    const unique =
        new Map();

    for (
        const fixture of
        raw
    ) {
        const home =
            apiHome(
                fixture
            );

        const away =
            apiAway(
                fixture
            );

        if (
            !home ||
            !away
        ) {
            continue;
        }

        /*
            SADECE
            FB / GS / BJK
        */

        if (
            !isTracked(home) &&
            !isTracked(away)
        ) {
            continue;
        }

        const eventDate =
            apiMatchDate(
                fixture
            );

        if (!eventDate) {
            console.log(
                `   ⚠️ Tarih okunamadı: ${home} vs ${away}`
            );

            continue;
        }

        const formatted =
            formatTurkeyDateTime(
                eventDate
            );

        const venue =
            sanitizeVenue(
                apiVenue(
                    fixture
                ),
                home,
                away
            );

        /*
            Tarih ID'de yok.
            Maç saati/tarihi değişirse
            aynı maç olarak kalır.
        */

        const id =
            `${competition.key}-` +
            `${foldText(home)}-` +
            `${foldText(away)}-` +
            `2026-27`;

        const identity =
            `${competition.key}|` +
            `${foldText(home)}|` +
            `${foldText(away)}`;

        const match = {
            id,

            source:
                "Footballdata.io",

            competitionKey:
                competition.key,

            competition:
                competition.name,

            emoji:
                competition.emoji,

            home,

            away,

            eventDate,

            date:
                formatted.date,

            time:
                formatted.time,

            venue,

            round:
                apiRound(
                    fixture
                ),

            homeLogo:
                getTeamLogo(home) ||
                apiHomeLogo(
                    fixture
                ),

            awayLogo:
                getTeamLogo(away) ||
                apiAwayLogo(
                    fixture
                )
        };

        if (
            !unique.has(
                identity
            )
        ) {
            unique.set(
                identity,
                match
            );
        }
    }

    const result =
        [
            ...unique.values()
        ].sort(
            (a, b) =>
                a.eventDate -
                b.eventDate
        );

    for (
        const match of
        result
    ) {
        console.log(
            `   ✅ ${displayName(match.home)} vs ${displayName(match.away)} | ${match.date} ${match.time}`
        );
    }

    return result;
}

// ======================================================
// TÜM AVRUPA
// ======================================================

async function getEuropeanMatches() {
    const all = [];

    for (
        const competition of
        EUROPE_COMPETITIONS
    ) {
        try {
            const matches =
                await getCompetitionMatches(
                    competition
                );

            all.push(
                ...matches
            );

        } catch (error) {
            console.log(
                `❌ ${competition.name}: ${error.message}`
            );
        }
    }

    console.log("");
    console.log(
        `🌍 TOPLAM AVRUPA: ${all.length}`
    );

    return all.sort(
        (a, b) =>
            a.eventDate -
            b.eventDate
    );
}

// ======================================================
// TFF
// ======================================================

async function fetchTffPage(
    url
) {
    const response =
        await fetch(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",

                    "Accept-Language":
                        "tr-TR,tr;q=0.9,en;q=0.8"
                }
            }
        );

    if (!response.ok) {
        throw new Error(
            `TFF HTTP ${response.status}`
        );
    }

    const buffer =
        Buffer.from(
            await response.arrayBuffer()
        );

    return iconv.decode(
        buffer,
        "windows-1254"
    );
}

function parseTffDate(
    dateText,
    timeText
) {
    const match =
        dateText.match(
            /^(\d{2})\.(\d{2})\.(\d{4})$/
        );

    if (!match) {
        return null;
    }

    const [
        ,
        day,
        month,
        year
    ] = match;

    const date =
        new Date(
            `${year}-${month}-${day}T${timeText}:00+03:00`
        );

    return Number.isNaN(
        date.getTime()
    )
        ? null
        : date;
}

// ======================================================
// TFF STADIUM
// ======================================================

async function getTffStadium(
    detailUrl,
    home,
    away
) {
    if (!detailUrl) {
        return fallbackStadium(
            home
        );
    }

    try {
        const html =
            await fetchTffPage(
                detailUrl
            );

        const $ =
            cheerio.load(
                html
            );

        let stadium =
            null;

        $("tr").each(
            (_, row) => {
                if (stadium) {
                    return;
                }

                const cells = [];

                $(row)
                    .find("td")
                    .each(
                        (_, td) => {
                            const text =
                                clean(
                                    $(td)
                                        .text()
                                );

                            if (text) {
                                cells.push(
                                    text
                                );
                            }
                        }
                    );

                if (
                    cells.length <
                    2
                ) {
                    return;
                }

                const label =
                    foldText(
                        cells[0]
                    );

                if (
                    label ===
                        "STAT" ||

                    label ===
                        "STAD" ||

                    label.includes(
                        "STADYUM"
                    )
                ) {
                    for (
                        let i = 1;
                        i <
                        cells.length;
                        i++
                    ) {
                        const candidate =
                            sanitizeVenue(
                                cells[i],
                                home,
                                away
                            );

                        if (
                            candidate !==
                            "Henüz açıklanmadı"
                        ) {
                            stadium =
                                candidate;

                            break;
                        }
                    }
                }
            }
        );

        if (stadium) {
            return stadium;
        }

    } catch (error) {
        console.log(
            `⚠️ TFF stat hatası: ${error.message}`
        );
    }

    return fallbackStadium(
        home
    );
}

// ======================================================
// SÜPER LİG
// ======================================================

async function getSuperLigMatches() {
    console.log("");
    console.log(
        "🇹🇷 Süper Lig kontrol ediliyor..."
    );

    try {
        const html =
            await fetchTffPage(
                TFF_URL
            );

        const $ =
            cheerio.load(
                html
            );

        const raw = [];

        const seen =
            new Set();

        $("tr").each(
            (_, row) => {
                const rowText =
                    clean(
                        $(row)
                            .text()
                    );

                const dateMatch =
                    rowText.match(
                        /\b(\d{2}\.\d{2}\.\d{4})\b/
                    );

                const timeMatch =
                    rowText.match(
                        /\b(\d{2}:\d{2})\b/
                    );

                if (
                    !dateMatch ||
                    !timeMatch
                ) {
                    return;
                }

                const links =
                    [];

                $(row)
                    .find("a")
                    .each(
                        (_, a) => {
                            const text =
                                clean(
                                    $(a)
                                        .text()
                                );

                            if (!text) {
                                return;
                            }

                            links.push({
                                text,

                                href:
                                    $(a)
                                        .attr(
                                            "href"
                                        ) ||
                                    null
                            });
                        }
                    );

                let home =
                    null;

                let away =
                    null;

                const dash =
                    links.findIndex(
                        link =>
                            link.text ===
                            "-"
                    );

                if (
                    dash > 0 &&
                    dash + 1 <
                        links.length
                ) {
                    home =
                        links[
                            dash - 1
                        ].text;

                    away =
                        links[
                            dash + 1
                        ].text;

                } else {
                    const teamLinks =
                        links.filter(
                            link => {
                                const n =
                                    foldText(
                                        link.text
                                    );

                                return (
                                    link.text !==
                                        "-" &&

                                    !n.includes(
                                        "DETAY"
                                    ) &&

                                    !/^\d+$/.test(
                                        n
                                    )
                                );
                            }
                        );

                    if (
                        teamLinks.length >=
                        2
                    ) {
                        home =
                            teamLinks[0]
                                .text;

                        away =
                            teamLinks[1]
                                .text;
                    }
                }

                if (
                    !home ||
                    !away
                ) {
                    return;
                }

                if (
                    !isTracked(
                        home
                    ) &&
                    !isTracked(
                        away
                    )
                ) {
                    return;
                }

                const eventDate =
                    parseTffDate(
                        dateMatch[1],
                        timeMatch[1]
                    );

                if (
                    !eventDate
                ) {
                    return;
                }

                const id =
                    `superlig-` +
                    `${foldText(home)}-` +
                    `${foldText(away)}-` +
                    `2026-27`;

                if (
                    seen.has(
                        id
                    )
                ) {
                    return;
                }

                seen.add(
                    id
                );

                const detail =
                    links.find(
                        link =>
                            foldText(
                                link.text
                            )
                                .includes(
                                    "DETAY"
                                )
                    );

                let detailUrl =
                    null;

                if (
                    detail?.href
                ) {
                    try {
                        detailUrl =
                            new URL(
                                detail.href,
                                "https://www.tff.org"
                            ).href;

                    } catch {}
                }

                raw.push({
                    id,
                    home,
                    away,
                    eventDate,
                    detailUrl
                });
            }
        );

        const output =
            [];

        for (
            const fixture of
            raw
        ) {
            const formatted =
                formatTurkeyDateTime(
                    fixture.eventDate
                );

            const venue =
                await getTffStadium(
                    fixture.detailUrl,
                    fixture.home,
                    fixture.away
                );

            output.push({
                id:
                    fixture.id,

                source:
                    "TFF",

                competitionKey:
                    "superlig",

                competition:
                    "Trendyol Süper Lig",

                emoji:
                    "⚽",

                home:
                    fixture.home,

                away:
                    fixture.away,

                eventDate:
                    fixture.eventDate,

                date:
                    formatted.date,

                time:
                    formatted.time,

                venue:
                    sanitizeVenue(
                        venue,
                        fixture.home,
                        fixture.away
                    ),

                round:
                    "Süper Lig",

                homeLogo:
                    getTeamLogo(
                        fixture.home
                    ),

                awayLogo:
                    getTeamLogo(
                        fixture.away
                    )
            });

            await sleep(
                100
            );
        }

        console.log(
            `🇹🇷 TFF toplam: ${output.length}`
        );

        return output.sort(
            (a, b) =>
                a.eventDate -
                b.eventDate
        );

    } catch (error) {
        console.log(
            `❌ TFF: ${error.message}`
        );

        return [];
    }
}

// ======================================================
// TARİH FİLTRESİ
// ======================================================

function filterDateWindow(
    matches
) {
    const {
        start,
        end
    } =
        getDateWindow();

    return matches.filter(
        match =>
            match.eventDate >=
                start &&
            match.eventDate <
                end
    );
}

// ======================================================
// DISCORD
// ======================================================

async function sendDiscord(
    payload
) {
    if (
        !DISCORD_WEBHOOK
    ) {
        throw new Error(
            "DISCORD_WEBHOOK eksik."
        );
    }

    const response =
        await fetch(
            DISCORD_WEBHOOK,
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );

    if (
        !response.ok
    ) {
        throw new Error(
            `Discord HTTP ${response.status}: ${await response.text()}`
        );
    }
}

// ======================================================
// KART STİLİ
// ======================================================

function getCardStyle(
    match
) {
    if (
        match.competitionKey ===
        "champions"
    ) {
        return {
            author:
                "🏆 UEFA CHAMPIONS LEAGUE",

            subtitle:
                "✨ Şampiyonlar Ligi Gecesi",

            prefix:
                "⭐"
        };
    }

    if (
        match.competitionKey ===
        "europa"
    ) {
        return {
            author:
                "🟠 UEFA EUROPA LEAGUE",

            subtitle:
                "🌍 Avrupa Ligi Gecesi",

            prefix:
                "🔥"
        };
    }

    if (
        isDerby(
            match.home,
            match.away
        )
    ) {
        return {
            author:
                "🔥 TRENDYOL SÜPER LİG",

            subtitle:
                "⚔️ DERBİ",

            prefix:
                "🔥"
        };
    }

    return {
        author:
            "🇹🇷 TRENDYOL SÜPER LİG",

        subtitle:
            "🏟️ Lig Maçı",

        prefix:
            "⚽"
    };
}

// ======================================================
// MAÇ KARTI
// ======================================================

async function sendMatch(
    match
) {
    const home =
        displayName(
            match.home
        );

    const away =
        displayName(
            match.away
        );

    const tracked =
        getTrackedTeam(
            match.home,
            match.away
        );

    const logo =
        getTeamLogo(
            tracked
        );

    const style =
        getCardStyle(
            match
        );

    const venue =
        sanitizeVenue(
            match.venue,
            match.home,
            match.away
        );

    const embed = {
        color:
            getMatchColor(
                match.home,
                match.away
            ),

        author: {
            name:
                style.author,

            icon_url:
                logo ||
                undefined
        },

        title:
            `${style.prefix} ${home}  •  ${away}`,

        description:
            `${style.subtitle}\n\n` +
            `**${home}**  ⚔️  **${away}**`,

        fields: [
            {
                name:
                    "📅 MAÇ GÜNÜ",

                value:
                    `**${match.date}**`,

                inline:
                    true
            },

            {
                name:
                    "🕘 BAŞLAMA",

                value:
                    `**${match.time}**`,

                inline:
                    true
            },

            {
                name:
                    "🏆 TUR / HAFTA",

                value:
                    `**${match.round}**`,

                inline:
                    true
            },

            {
                name:
                    "⏳ GERİ SAYIM",

                value:
                    `**${countdown(
                        match.eventDate
                    )}**`,

                inline:
                    false
            },

            {
                name:
                    "🏟️ STADYUM",

                value:
                    `**${venue}**`,

                inline:
                    false
            },

            {
                name:
                    "🏠 EV SAHİBİ",

                value:
                    `**${home}**`,

                inline:
                    true
            },

            {
                name:
                    "✈️ DEPLASMAN",

                value:
                    `**${away}**`,

                inline:
                    true
            }
        ],

        thumbnail:
            logo
                ? {
                    url:
                        logo
                }
                : undefined,

        footer: {
            text:
                `${match.source} • 3 Büyükler Maç Takvimi`
        },

        timestamp:
            new Date()
                .toISOString()
    };

    await sendDiscord({
        username:
            "3 Büyükler • Maç Takvimi",

        avatar_url:
            logo ||
            undefined,

        embeds: [
            embed
        ]
    });
}

// ======================================================
// DEĞİŞİKLİK KONTROLÜ
// ======================================================

function detectChanges(
    oldData,
    match
) {
    const changes =
        {};

    const venue =
        sanitizeVenue(
            match.venue,
            match.home,
            match.away
        );

    if (
        oldData.date &&
        oldData.date !==
            match.date
    ) {
        changes.date = {
            old:
                oldData.date,

            new:
                match.date
        };
    }

    if (
        oldData.time &&
        oldData.time !==
            match.time
    ) {
        changes.time = {
            old:
                oldData.time,

            new:
                match.time
        };
    }

    if (
        oldData.venue &&
        oldData.venue !==
            venue
    ) {
        changes.venue = {
            old:
                oldData.venue,

            new:
                venue
        };
    }

    return changes;
}

// ======================================================
// UPDATE KARTI
// ======================================================

async function sendUpdate(
    match,
    changes
) {
    const home =
        displayName(
            match.home
        );

    const away =
        displayName(
            match.away
        );

    const tracked =
        getTrackedTeam(
            match.home,
            match.away
        );

    const logo =
        getTeamLogo(
            tracked
        );

    const lines =
        [];

    if (
        changes.date
    ) {
        lines.push(
            `📅 ${changes.date.old} → **${changes.date.new}**`
        );
    }

    if (
        changes.time
    ) {
        lines.push(
            `🕘 ${changes.time.old} → **${changes.time.new}**`
        );
    }

    if (
        changes.venue
    ) {
        lines.push(
            `🏟️ ${changes.venue.old} → **${changes.venue.new}**`
        );
    }

    await sendDiscord({
        username:
            "3 Büyükler • Maç Takvimi",

        avatar_url:
            logo ||
            undefined,

        embeds: [
            {
                color:
                    getMatchColor(
                        match.home,
                        match.away
                    ),

                author: {
                    name:
                        "⚠️ FİKSTÜR GÜNCELLENDİ",

                    icon_url:
                        logo ||
                        undefined
                },

                title:
                    `${home} vs ${away}`,

                description:
                    lines.join(
                        "\n\n"
                    ),

                thumbnail:
                    logo
                        ? {
                            url:
                                logo
                        }
                        : undefined,

                footer: {
                    text:
                        match.competition
                },

                timestamp:
                    new Date()
                        .toISOString()
            }
        ]
    });
}

// ======================================================
// DB ENTRY
// ======================================================

function dbEntry(
    match
) {
    return {
        sent:
            true,

        competition:
            match.competition,

        home:
            match.home,

        away:
            match.away,

        date:
            match.date,

        time:
            match.time,

        venue:
            sanitizeVenue(
                match.venue,
                match.home,
                match.away
            ),

        sentAt:
            new Date()
                .toISOString()
    };
}

// ======================================================
// MAIN
// ======================================================

async function main() {
    console.log("");
    console.log(
        "============================================"
    );

    console.log(
        "⚽ 3 BÜYÜKLER MAÇ BOTU"
    );

    console.log(
        "Süper Lig + Champions League + Europa League"
    );

    console.log(
        "============================================"
    );

    console.log(
        NEXT_WEEK
            ? "📆 7–14 gün arası"
            : "📆 Önümüzdeki 14 gün"
    );

    if (FORCE) {
        console.log(
            "⚠️ FORCE MODU AÇIK"
        );
    }

    const [
        allSuperLig,
        europe
    ] =
        await Promise.all([
            getSuperLigMatches(),
            getEuropeanMatches()
        ]);

    const superLig =
        filterDateWindow(
            allSuperLig
        );

    /*
        Avrupa maçları API'ye
        from / to ile zaten
        tarih aralığında soruldu.
    */

    const matches = [
        ...superLig,
        ...europe
    ].sort(
        (a, b) =>
            a.eventDate -
            b.eventDate
    );

    console.log("");
    console.log(
        "============================================"
    );

    console.log(
        `🇹🇷 Süper Lig: ${superLig.length}`
    );

    console.log(
        `🌍 Avrupa: ${europe.length}`
    );

    console.log(
        `📨 Discord'a gidecek: ${matches.length}`
    );

    console.log(
        "============================================"
    );

    if (
        matches.length ===
        0
    ) {
        console.log(
            "ℹ️ Gönderilecek maç yok."
        );

        return;
    }

    const db =
        loadDatabase();

    let sent = 0;
    let updated = 0;
    let skipped = 0;

    for (
        const match of
        matches
    ) {
        console.log("");
        console.log(
            `${match.emoji} ${displayName(match.home)} vs ${displayName(match.away)}`
        );

        console.log(
            `🏆 ${match.competition}`
        );

        console.log(
            `📅 ${match.date} • ${match.time}`
        );

        const old =
            db[
                match.id
            ];

        // ==============================================
        // FORCE
        // ==============================================

        if (FORCE) {
            await sendMatch(
                match
            );

            db[
                match.id
            ] =
                dbEntry(
                    match
                );

            saveDatabase(
                db
            );

            sent++;

            console.log(
                "✅ Discord'a FORCE gönderildi."
            );

            await sleep(
                900
            );

            continue;
        }

        // ==============================================
        // YENİ MAÇ
        // ==============================================

        if (!old) {
            await sendMatch(
                match
            );

            db[
                match.id
            ] =
                dbEntry(
                    match
                );

            saveDatabase(
                db
            );

            sent++;

            console.log(
                "✅ Yeni maç gönderildi."
            );

            await sleep(
                900
            );

            continue;
        }

        // ==============================================
        // GÜNCELLEME
        // ==============================================

        const changes =
            detectChanges(
                old,
                match
            );

        if (
            Object.keys(
                changes
            ).length > 0
        ) {
            await sendUpdate(
                match,
                changes
            );

            db[
                match.id
            ] =
                dbEntry(
                    match
                );

            saveDatabase(
                db
            );

            updated++;

            console.log(
                "⚠️ Güncelleme gönderildi."
            );

            await sleep(
                900
            );

            continue;
        }

        skipped++;

        console.log(
            "⏭️ Zaten gönderilmiş."
        );
    }

    console.log("");
    console.log(
        "============================================"
    );

    console.log(
        `✅ Gönderilen: ${sent}`
    );

    console.log(
        `⚠️ Güncellenen: ${updated}`
    );

    console.log(
        `⏭️ Atlanan: ${skipped}`
    );

    console.log(
        "============================================"
    );
}

// ======================================================
// START
// ======================================================

main()
    .catch(
        error => {
            console.error("");
            console.error(
                "❌ BOT HATASI:"
            );

            console.error(
                error.stack ||
                error.message
            );

            process.exitCode =
                1;
        }
    );