require("dotenv").config();

const fs = require("fs");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");

// ======================================================
// CONFIG
// ======================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const FOOTBALLDATA_API_KEY = process.env.FOOTBALLDATA_API_KEY;

const FOOTBALLDATA_BASE = "https://footballdata.io/api/v1";
const CHAMPIONS_LEAGUE_ID = 45;

const TFF_URL =
    "https://www.tff.org/default.aspx?pageID=198";

const DB_FILE = "./sent.json";

const args = process.argv.slice(2);

const NEXT_WEEK = args.includes("--next-week");
const FORCE = args.includes("--force");

// ======================================================
// TEAM SETTINGS
// ======================================================

const TRACKED_TEAMS = [
    "FENERBAHÇE",
    "FENERBAHCE",
    "GALATASARAY",
    "BEŞİKTAŞ",
    "BESIKTAS"
];

const COLORS = {
    FENERBAHCE: 0x002d72,
    GALATASARAY: 0xa90432,
    BESIKTAS: 0x000000,
    DEFAULT: 0x5865f2
};

// TFF detayında stat bulunamazsa kullanılacak fallback'ler.
// İsimler değişirse burayı kolayca güncelleyebilirsin.
const HOME_STADIUMS = [
    {
        names: ["FENERBAHÇE", "FENERBAHCE"],
        stadium:
            "Chobani Stadyumu Fenerbahçe Şükrü Saracoğlu Spor Kompleksi"
    },
    {
        names: ["GALATASARAY"],
        stadium:
            "Ali Sami Yen Spor Kompleksi RAMS Park"
    },
    {
        names: ["BEŞİKTAŞ", "BESIKTAS"],
        stadium:
            "Tüpraş Stadyumu"
    },
    {
        names: ["GAZİANTEP", "GAZIANTEP"],
        stadium:
            "Gaziantep Stadyumu"
    },
    {
        names: ["KOCAELİSPOR", "KOCAELISPOR"],
        stadium:
            "Kocaeli Stadyumu"
    },
    {
        names: ["ERZURUMSPOR"],
        stadium:
            "Kazım Karabekir Stadyumu"
    }
];

// ======================================================
// HELPERS
// ======================================================

function clean(text = "") {
    return String(text)
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalize(text = "") {
    return clean(text)
        .toLocaleUpperCase("tr-TR")
        .replace(/\s*A\.Ş\.\s*/gi, "")
        .trim();
}

function cleanDisplayTeamName(name = "") {
    return clean(name)
        .replace(/\s*A\.Ş\.\s*/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isTrackedTeam(name) {
    const n = normalize(name);

    return TRACKED_TEAMS.some(team =>
        n.includes(team)
    );
}

function isDerby(home, away) {
    return (
        isTrackedTeam(home) &&
        isTrackedTeam(away)
    );
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

// ======================================================
// TEAM COLOR
// ======================================================

function getSingleTeamColor(teamName) {
    const name =
        normalize(teamName);

    if (
        name.includes("FENERBAHÇE") ||
        name.includes("FENERBAHCE")
    ) {
        return COLORS.FENERBAHCE;
    }

    if (
        name.includes("GALATASARAY")
    ) {
        return COLORS.GALATASARAY;
    }

    if (
        name.includes("BEŞİKTAŞ") ||
        name.includes("BESIKTAS")
    ) {
        return COLORS.BESIKTAS;
    }

    return null;
}

function getTeamColor(home, away) {
    /*
      Öncelik:
      1. Ev sahibi bizim takımsa onun rengi
      2. Deplasman bizim takımsa onun rengi

      Böylece UCL'de örneğin:
      Liverpool vs Galatasaray
      -> Galatasaray kırmızısı
    */

    const homeColor =
        getSingleTeamColor(home);

    if (homeColor !== null) {
        return homeColor;
    }

    const awayColor =
        getSingleTeamColor(away);

    if (awayColor !== null) {
        return awayColor;
    }

    return COLORS.DEFAULT;
}

// ======================================================
// STADIUM FALLBACK
// ======================================================

function getFallbackStadium(homeTeam) {
    const home =
        normalize(homeTeam);

    for (const item of HOME_STADIUMS) {
        if (
            item.names.some(name =>
                home.includes(name)
            )
        ) {
            return item.stadium;
        }
    }

    return "Henüz açıklanmadı";
}

// ======================================================
// DATABASE
// ======================================================

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify({}, null, 2)
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

        if (Array.isArray(parsed)) {
            const converted = {};

            for (const id of parsed) {
                converted[String(id)] = {
                    sent: true
                };
            }

            return converted;
        }

        if (
            parsed &&
            typeof parsed === "object"
        ) {
            return parsed;
        }

        return {};
    } catch {
        return {};
    }
}

function saveDatabase(database) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(
            database,
            null,
            2
        )
    );
}

// ======================================================
// DATE
// ======================================================

function getDateWindow() {
    const now =
        new Date();

    const DAY =
        24 * 60 * 60 * 1000;

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

    return {
        start: now,

        end:
            new Date(
                now.getTime() +
                7 * DAY
            )
    };
}

function formatTurkeyDateTime(date) {
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
            ).format(date),

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
            ).format(date)
    };
}

function getCountdown(date) {
    const diff =
        date.getTime() -
        Date.now();

    if (diff <= 0) {
        return "Maç başladı veya tamamlandı";
    }

    const totalMinutes =
        Math.floor(
            diff / 60000
        );

    const days =
        Math.floor(
            totalMinutes / 1440
        );

    const hours =
        Math.floor(
            (totalMinutes % 1440) / 60
        );

    const minutes =
        totalMinutes % 60;

    if (days > 0) {
        return `${days} gün ${hours} saat kaldı`;
    }

    if (hours > 0) {
        return `${hours} saat ${minutes} dakika kaldı`;
    }

    return `${minutes} dakika kaldı`;
}

// ======================================================
// GENERIC PAGE FETCH
// ======================================================

async function fetchTurkishPage(url) {
    const response =
        await fetch(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",

                    "Accept-Language":
                        "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
                }
            }
        );

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status}`
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

// ======================================================
// TFF STADIUM DETAIL
// ======================================================

async function getTffStadium(
    detailUrl,
    homeTeam
) {
    if (!detailUrl) {
        return getFallbackStadium(
            homeTeam
        );
    }

    try {
        const html =
            await fetchTurkishPage(
                detailUrl
            );

        const $ =
            cheerio.load(html);

        /*
          TFF detay sayfaları zaman zaman HTML yapısını
          değiştiriyor. Bu yüzden birkaç yöntem deniyoruz.
        */

        let stadium = null;

        $("tr").each((_, row) => {
            if (stadium) {
                return;
            }

            const text =
                clean(
                    $(row).text()
                );

            const upper =
                normalize(text);

            if (
                upper.includes("STADYUM") ||
                upper.includes("STAT")
            ) {
                const cells = [];

                $(row)
                    .find("td")
                    .each((_, cell) => {
                        const value =
                            clean(
                                $(cell).text()
                            );

                        if (value) {
                            cells.push(value);
                        }
                    });

                if (cells.length >= 2) {
                    const candidate =
                        cells[
                            cells.length - 1
                        ];

                    if (
                        candidate &&
                        candidate.length > 3
                    ) {
                        stadium =
                            candidate;
                    }
                }
            }
        });

        if (!stadium) {
            const fullText =
                clean(
                    $("body").text()
                );

            const patterns = [
                /Stadyum\s*[:\-]\s*([^|]+?)(?:Hakem|Tarih|Saat|$)/i,
                /Stat\s*[:\-]\s*([^|]+?)(?:Hakem|Tarih|Saat|$)/i
            ];

            for (const pattern of patterns) {
                const match =
                    fullText.match(
                        pattern
                    );

                if (
                    match &&
                    match[1]
                ) {
                    stadium =
                        clean(
                            match[1]
                        );

                    break;
                }
            }
        }

        if (
            stadium &&
            stadium.length > 3 &&
            stadium.length < 150
        ) {
            return stadium;
        }

    } catch (error) {
        console.log(
            `⚠️ Stat detay sayfası okunamadı: ${error.message}`
        );
    }

    return getFallbackStadium(
        homeTeam
    );
}

// ======================================================
// TFF FIXTURE
// ======================================================

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

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null;
    }

    return date;
}

async function getSuperLigMatches() {
    try {
        console.log(
            "🇹🇷 TFF Süper Lig fikstürü alınıyor..."
        );

        const html =
            await fetchTurkishPage(
                TFF_URL
            );

        const $ =
            cheerio.load(html);

        const rawMatches = [];
        const seen = new Set();

        $("tr").each((_, row) => {
            const rowText =
                clean(
                    $(row).text()
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

            const links = [];

            $(row)
                .find("a")
                .each((_, element) => {
                    const text =
                        clean(
                            $(element).text()
                        );

                    const href =
                        $(element)
                            .attr("href");

                    if (text) {
                        links.push({
                            text,
                            href
                        });
                    }
                });

            const dashIndex =
                links.findIndex(
                    item =>
                        item.text === "-"
                );

            let home = null;
            let away = null;

            if (
                dashIndex > 0 &&
                dashIndex + 1 <
                    links.length
            ) {
                home =
                    links[
                        dashIndex - 1
                    ].text;

                away =
                    links[
                        dashIndex + 1
                    ].text;
            }

            if (!home || !away) {
                const teamLinks =
                    links.filter(item => {
                        const n =
                            normalize(
                                item.text
                            );

                        return (
                            item.text !== "-" &&
                            !n.includes(
                                "DETAY"
                            ) &&
                            !/^\d+$/.test(n)
                        );
                    });

                if (
                    teamLinks.length >= 2
                ) {
                    home =
                        teamLinks[0].text;

                    away =
                        teamLinks[1].text;
                }
            }

            if (!home || !away) {
                return;
            }

            if (
                !isTrackedTeam(home) &&
                !isTrackedTeam(away)
            ) {
                return;
            }

            const eventDate =
                parseTffDate(
                    dateMatch[1],
                    timeMatch[1]
                );

            if (!eventDate) {
                return;
            }

            const id =
                [
                    "tff",
                    normalize(home),
                    normalize(away),
                    dateMatch[1]
                ].join("-");

            if (seen.has(id)) {
                return;
            }

            seen.add(id);

            /*
              Detaylar linkini bul
            */

            const details =
                links.find(item =>
                    normalize(
                        item.text
                    ).includes(
                        "DETAY"
                    )
                );

            let detailUrl = null;

            if (details?.href) {
                if (
                    details.href.startsWith(
                        "http"
                    )
                ) {
                    detailUrl =
                        details.href;
                } else {
                    detailUrl =
                        new URL(
                            details.href,
                            "https://www.tff.org"
                        ).href;
                }
            }

            rawMatches.push({
                id,
                home,
                away,
                eventDate,
                detailUrl
            });
        });

        /*
          Stat bilgilerini sırayla çek.
          Çok hızlı istek atmayalım.
        */

        const matches = [];

        for (const raw of rawMatches) {
            const stadium =
                await getTffStadium(
                    raw.detailUrl,
                    raw.home
                );

            const formatted =
                formatTurkeyDateTime(
                    raw.eventDate
                );

            matches.push({
                id:
                    raw.id,

                source:
                    "TFF",

                competitionKey:
                    "superlig",

                competition:
                    "Trendyol Süper Lig",

                emoji:
                    "🇹🇷",

                home:
                    raw.home,

                away:
                    raw.away,

                eventDate:
                    raw.eventDate,

                date:
                    formatted.date,

                time:
                    formatted.time,

                venue:
                    stadium,

                round:
                    "Süper Lig",

                homeLogo:
                    null,

                awayLogo:
                    null
            });

            await sleep(200);
        }

        console.log(
            `🇹🇷 ${matches.length} adet 3 büyük Süper Lig maçı bulundu.`
        );

        return matches;

    } catch (error) {
        console.log(
            `⚠️ TFF hatası: ${error.message}`
        );

        return [];
    }
}

// ======================================================
// FOOTBALLDATA.IO / UCL
// ======================================================

async function footballApiGet(path) {
    if (!FOOTBALLDATA_API_KEY) {
        throw new Error(
            "FOOTBALLDATA_API_KEY .env içinde yok."
        );
    }

    const response =
        await fetch(
            `${FOOTBALLDATA_BASE}${path}`,
            {
                headers: {
                    Authorization:
                        `Bearer ${FOOTBALLDATA_API_KEY}`,

                    Accept:
                        "application/json"
                }
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            `Footballdata HTTP ${response.status}: ${JSON.stringify(data)}`
        );
    }

    return data;
}

function extractApiArray(response) {
    if (Array.isArray(response)) {
        return response;
    }

    if (
        Array.isArray(
            response?.data
        )
    ) {
        return response.data;
    }

    if (
        Array.isArray(
            response?.data?.matches
        )
    ) {
        return response.data.matches;
    }

    if (
        Array.isArray(
            response?.matches
        )
    ) {
        return response.matches;
    }

    return [];
}

function apiHome(match) {
    return (
        match.home_team?.team_name ||
        match.home_team?.name ||
        match.home_team_name ||
        match.home?.name ||
        "Bilinmiyor"
    );
}

function apiAway(match) {
    return (
        match.away_team?.team_name ||
        match.away_team?.name ||
        match.away_team_name ||
        match.away?.name ||
        "Bilinmiyor"
    );
}

function apiHomeLogo(match) {
    return (
        match.home_team?.team_logo ||
        match.home_team?.logo ||
        match.home_logo ||
        null
    );
}

function apiAwayLogo(match) {
    return (
        match.away_team?.team_logo ||
        match.away_team?.logo ||
        match.away_logo ||
        null
    );
}

function apiVenue(match) {
    const candidates = [
        match.venue?.name,
        match.venue_name,
        match.stadium_name,
        match.stadium,
        typeof match.venue ===
        "string"
            ? match.venue
            : null
    ];

    const value =
        candidates.find(
            item =>
                typeof item ===
                    "string" &&
                item.trim()
        );

    return (
        value?.trim() ||
        "Henüz açıklanmadı"
    );
}

function apiRound(match) {
    return String(
        match.round ||
        match.round_name ||
        match.matchday ||
        match.game_week ||
        "Lig Aşaması"
    );
}

function apiDate(match) {
    if (
        typeof match.date_unix ===
        "number"
    ) {
        const date =
            new Date(
                match.date_unix *
                1000
            );

        if (
            !Number.isNaN(
                date.getTime()
            )
        ) {
            return date;
        }
    }

    const values = [
        match.datetime,
        match.utc_date,
        match.kickoff,
        match.start_time,
        match.match_date
    ];

    for (const value of values) {
        if (!value) {
            continue;
        }

        const parsed =
            new Date(value);

        if (
            !Number.isNaN(
                parsed.getTime()
            )
        ) {
            return parsed;
        }
    }

    return null;
}

async function getChampionsLeagueMatches() {
    try {
        console.log(
            "🏆 Şampiyonlar Ligi fikstürü alınıyor..."
        );

        const response =
            await footballApiGet(
                `/fixtures/upcoming` +
                `?league_id=${CHAMPIONS_LEAGUE_ID}` +
                `&limit=100`
            );

        const fixtures =
            extractApiArray(
                response
            );

        const matches = [];

        for (const fixture of fixtures) {
            const home =
                apiHome(
                    fixture
                );

            const away =
                apiAway(
                    fixture
                );

            if (
                !isTrackedTeam(home) &&
                !isTrackedTeam(away)
            ) {
                continue;
            }

            const eventDate =
                apiDate(
                    fixture
                );

            if (!eventDate) {
                continue;
            }

            const formatted =
                formatTurkeyDateTime(
                    eventDate
                );

            matches.push({
                id:
                    `ucl-${
                        fixture.match_id ||
                        fixture.id ||
                        fixture.fixture_id ||
                        `${home}-${away}-${eventDate.toISOString()}`
                    }`,

                source:
                    "Footballdata.io",

                competitionKey:
                    "champions",

                competition:
                    "UEFA Champions League",

                emoji:
                    "🏆",

                home,

                away,

                eventDate,

                date:
                    formatted.date,

                time:
                    formatted.time,

                venue:
                    apiVenue(
                        fixture
                    ),

                round:
                    apiRound(
                        fixture
                    ),

                homeLogo:
                    apiHomeLogo(
                        fixture
                    ),

                awayLogo:
                    apiAwayLogo(
                        fixture
                    )
            });
        }

        console.log(
            `🏆 ${matches.length} adet takip edilen UCL maçı bulundu.`
        );

        return matches;

    } catch (error) {
        console.log(
            `⚠️ UCL hatası: ${error.message}`
        );

        return [];
    }
}

// ======================================================
// DATE FILTER
// ======================================================

function filterDateWindow(matches) {
    const {
        start,
        end
    } = getDateWindow();

    return matches
        .filter(match =>
            match.eventDate >= start &&
            match.eventDate < end
        )
        .sort(
            (a, b) =>
                a.eventDate -
                b.eventDate
        );
}

// ======================================================
// DISCORD
// ======================================================

async function sendDiscord(payload) {
    if (!DISCORD_WEBHOOK) {
        throw new Error(
            "DISCORD_WEBHOOK .env içinde yok."
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

    if (!response.ok) {
        throw new Error(
            `Discord HTTP ${response.status}: ${await response.text()}`
        );
    }
}

async function sendMatch(match) {
    const home =
        cleanDisplayTeamName(
            match.home
        );

    const away =
        cleanDisplayTeamName(
            match.away
        );

    const derby =
        match.competitionKey ===
        "superlig" &&
        isDerby(
            match.home,
            match.away
        );

    let title;

    if (derby) {
        title =
            `🔥 DERBİ | ${home} vs ${away}`;
    } else if (
        match.competitionKey ===
        "champions"
    ) {
        title =
            `🏆 DEVLER LİGİ | ${home} vs ${away}`;
    } else {
        title =
            `⚽ ${home} vs ${away}`;
    }

    const embed = {
        title,

        color:
            getTeamColor(
                match.home,
                match.away
            ),

        description:
            `${match.emoji} **${match.competition}**`,

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
                    "🏆 TUR",

                value:
                    match.round,

                inline:
                    true
            },

            {
                name:
                    "⏳ GERİ SAYIM",

                value:
                    getCountdown(
                        match.eventDate
                    ),

                inline:
                    false
            },

            {
                name:
                    "🏟️ STADYUM",

                value:
                    `**${match.venue}**`,

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

        footer: {
            text:
                `${match.source} • 3 Büyükler Maç Takvimi`
        },

        timestamp:
            new Date()
                .toISOString()
    };

    if (match.homeLogo) {
        embed.thumbnail = {
            url:
                match.homeLogo
        };
    }

    if (match.awayLogo) {
        embed.author = {
            name:
                `${away} • Deplasman`,

            icon_url:
                match.awayLogo
        };
    }

    await sendDiscord({
        username:
            "3 Büyükler • Maç Takvimi",

        embeds: [
            embed
        ]
    });
}

// ======================================================
// UPDATE DETECTION
// ======================================================

function detectChanges(
    oldData,
    match
) {
    const changes = {};

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
        match.venue
    ) {
        changes.venue = {
            old:
                oldData.venue,

            new:
                match.venue
        };
    }

    return changes;
}

async function sendUpdate(
    match,
    changes
) {
    const home =
        cleanDisplayTeamName(
            match.home
        );

    const away =
        cleanDisplayTeamName(
            match.away
        );

    const lines = [];

    if (changes.date) {
        lines.push(
            `📅 ${changes.date.old} → **${changes.date.new}**`
        );
    }

    if (changes.time) {
        lines.push(
            `🕘 ${changes.time.old} → **${changes.time.new}**`
        );
    }

    if (changes.venue) {
        lines.push(
            `🏟️ ${changes.venue.old} → **${changes.venue.new}**`
        );
    }

    await sendDiscord({
        username:
            "3 Büyükler • Maç Takvimi",

        embeds: [
            {
                title:
                    "⚠️ FİKSTÜR GÜNCELLENDİ",

                color:
                    getTeamColor(
                        match.home,
                        match.away
                    ),

                description:
                    `## ${home} vs ${away}\n\n` +
                    lines.join("\n"),

                fields: [
                    {
                        name:
                            "⏳ Maça Kalan",

                        value:
                            getCountdown(
                                match.eventDate
                            )
                    }
                ],

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

function createDbEntry(match) {
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
            match.venue,

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
        "======================================"
    );

    console.log(
        "⚽ 3 BÜYÜKLER MAÇ BOTU"
    );

    console.log(
        "Süper Lig + UEFA Champions League"
    );

    console.log(
        "======================================"
    );

    console.log(
        NEXT_WEEK
            ? "📆 7–14 gün sonrası"
            : "📆 Önümüzdeki 7 gün"
    );

    if (FORCE) {
        console.log(
            "⚠️ FORCE MODU"
        );
    }

    console.log("");

    const [
        superLigMatches,
        championsMatches
    ] = await Promise.all([
        getSuperLigMatches(),
        getChampionsLeagueMatches()
    ]);

    console.log("");
    console.log(
        `🇹🇷 Süper Lig: ${superLigMatches.length}`
    );

    console.log(
        `🏆 UCL: ${championsMatches.length}`
    );

    const matches =
        filterDateWindow([
            ...superLigMatches,
            ...championsMatches
        ]);

    console.log(
        `⚽ Tarih aralığında ${matches.length} maç var.`
    );

    if (
        matches.length === 0
    ) {
        console.log(
            "ℹ️ Gönderilecek maç yok."
        );

        return;
    }

    const database =
        loadDatabase();

    let newCount = 0;
    let updateCount = 0;
    let skipCount = 0;

    for (const match of matches) {
        console.log("");
        console.log(
            `${match.emoji} ${cleanDisplayTeamName(match.home)} vs ${cleanDisplayTeamName(match.away)}`
        );

        console.log(
            `🏟️ ${match.venue}`
        );

        const old =
            database[
                match.id
            ];

        if (FORCE) {
            await sendMatch(
                match
            );

            database[
                match.id
            ] = createDbEntry(
                match
            );

            saveDatabase(
                database
            );

            newCount++;

            console.log(
                "✅ FORCE gönderildi."
            );

            await sleep(1200);

            continue;
        }

        if (!old) {
            await sendMatch(
                match
            );

            database[
                match.id
            ] = createDbEntry(
                match
            );

            saveDatabase(
                database
            );

            newCount++;

            console.log(
                "✅ Yeni maç gönderildi."
            );

            await sleep(1200);

            continue;
        }

        const changes =
            detectChanges(
                old,
                match
            );

        if (
            Object.keys(changes)
                .length > 0
        ) {
            await sendUpdate(
                match,
                changes
            );

            database[
                match.id
            ] = createDbEntry(
                match
            );

            saveDatabase(
                database
            );

            updateCount++;

            console.log(
                "⚠️ Güncelleme gönderildi."
            );

            await sleep(1200);

            continue;
        }

        skipCount++;

        console.log(
            "⏭️ Değişiklik yok."
        );
    }

    console.log("");
    console.log(
        "======================================"
    );

    console.log(
        `✅ Yeni: ${newCount}`
    );

    console.log(
        `⚠️ Güncelleme: ${updateCount}`
    );

    console.log(
        `⏭️ Atlanan: ${skipCount}`
    );

    console.log(
        "======================================"
    );
}

// ======================================================
// RUN
// ======================================================

main()
    .catch(error => {
        console.error("");
        console.error(
            "❌ BOT HATASI:"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    });