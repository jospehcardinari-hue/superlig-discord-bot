require("dotenv").config();

const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK;
const API_KEY = process.env.FOOTBALLDATA_API_KEY;

const BASE_URL = "https://footballdata.io/api/v1";
const SENT_FILE = "./sent.json";

const args = process.argv.slice(2);

const NEXT_WEEK = args.includes("--next-week");
const FORCE = args.includes("--force");

// ========================================
// TAKİP EDİLEN TAKIMLAR
// ========================================

const BIG_THREE = [
    "FENERBAHÇE",
    "FENERBAHCE",
    "GALATASARAY",
    "BEŞİKTAŞ",
    "BESIKTAS"
];

// ========================================
// TAKİP EDİLEN ORGANİZASYONLAR
// ========================================

const COMPETITIONS = [
    {
        key: "superlig",

        displayName: "Trendyol Süper Lig",

        searchTerms: [
            "Super Lig",
            "Süper Lig",
            "Turkish Super Lig",
            "Turkey Super Lig"
        ],

        country: "Turkey",

        emoji: "🇹🇷"
    },

    {
        key: "champions",

        displayName: "UEFA Champions League",

        searchTerms: [
            "UEFA Champions League",
            "Champions League"
        ],

        country: null,

        emoji: "🏆"
    }
];

// ========================================
// YARDIMCI
// ========================================

function normalize(text = "") {
    return String(text)
        .trim()
        .toLocaleUpperCase("tr-TR");
}

function isBigThree(teamName) {
    const name = normalize(teamName);

    return BIG_THREE.some(team =>
        name.includes(team)
    );
}

function isDerby(home, away) {
    return (
        isBigThree(home) &&
        isBigThree(away)
    );
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

// ========================================
// SENT.JSON
// ========================================

function loadDatabase() {
    if (!fs.existsSync(SENT_FILE)) {
        fs.writeFileSync(
            SENT_FILE,
            JSON.stringify({}, null, 2)
        );

        return {};
    }

    try {
        const parsed = JSON.parse(
            fs.readFileSync(
                SENT_FILE,
                "utf8"
            )
        );

        // Eski array formatını yeni objeye dönüştür.
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

    } catch (error) {
        console.log(
            "⚠️ sent.json okunamadı, yeni database kullanılacak."
        );

        return {};
    }
}

function saveDatabase(database) {
    fs.writeFileSync(
        SENT_FILE,
        JSON.stringify(
            database,
            null,
            2
        )
    );
}

// ========================================
// API
// ========================================

async function apiGet(path) {
    if (!API_KEY) {
        throw new Error(
            "FOOTBALLDATA_API_KEY .env dosyasında yok."
        );
    }

    const response = await fetch(
        `${BASE_URL}${path}`,
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
            `API geçersiz JSON döndürdü. HTTP ${response.status}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `API HTTP ${response.status}: ${JSON.stringify(data)}`
        );
    }

    return data;
}

// ========================================
// LİG BULMA
// ========================================

function extractArray(response) {
    if (Array.isArray(response)) {
        return response;
    }

    if (Array.isArray(response?.data)) {
        return response.data;
    }

    if (Array.isArray(response?.data?.leagues)) {
        return response.data.leagues;
    }

    if (Array.isArray(response?.leagues)) {
        return response.leagues;
    }

    return [];
}

async function searchLeague(term, country = null) {
    let path =
        `/leagues?search=${encodeURIComponent(term)}`;

    if (country) {
        path +=
            `&country=${encodeURIComponent(country)}`;
    }

    const response =
        await apiGet(path);

    return extractArray(response);
}

async function findCompetition(config) {
    for (
        const term of config.searchTerms
    ) {
        console.log(
            `🔎 Lig aranıyor: ${term}`
        );

        const results =
            await searchLeague(
                term,
                config.country
            );

        if (
            Array.isArray(results) &&
            results.length > 0
        ) {
            let best =
                results[0];

            // İsmi en iyi eşleşeni seç.
            const exact =
                results.find(item => {
                    const name =
                        normalize(
                            item.league_name ||
                            item.name ||
                            ""
                        );

                    return (
                        name.includes(
                            normalize(term)
                        ) ||
                        normalize(term).includes(name)
                    );
                });

            if (exact) {
                best = exact;
            }

            console.log(
                `✅ Bulundu: ${
                    best.league_name ||
                    best.name
                }`
            );

            return {
                ...config,

                leagueId:
                    best.league_id ||
                    best.id,

                apiName:
                    best.league_name ||
                    best.name ||
                    config.displayName
            };
        }

        await sleep(250);
    }

    console.log(
        `❌ ${config.displayName} bulunamadı.`
    );

    return null;
}

// ========================================
// TARİH ARALIĞI
// ========================================

function getDateWindow() {
    const now =
        new Date();

    const day =
        24 * 60 * 60 * 1000;

    if (NEXT_WEEK) {
        return {
            start:
                new Date(
                    now.getTime() +
                    7 * day
                ),

            end:
                new Date(
                    now.getTime() +
                    14 * day
                )
        };
    }

    return {
        start: now,

        end:
            new Date(
                now.getTime() +
                7 * day
            )
    };
}

function toApiDate(date) {
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
        ).format(date);

    return parts;
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

// ========================================
// FİKSTÜR ÇEKME
// ========================================

function extractFixtures(response) {
    if (Array.isArray(response?.data)) {
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

async function getCompetitionFixtures(
    competition
) {
    const {
        start,
        end
    } = getDateWindow();

    const from =
        toApiDate(start);

    const to =
        toApiDate(end);

    const path =
        `/fixtures/upcoming` +
        `?league_id=${competition.leagueId}` +
        `&from=${from}` +
        `&to=${to}` +
        `&limit=100`;

    console.log(
        `📥 ${competition.displayName} fikstürü alınıyor...`
    );

    const response =
        await apiGet(path);

    const fixtures =
        extractFixtures(response);

    console.log(
        `📦 ${competition.displayName}: ${fixtures.length} maç`
    );

    return fixtures.map(match => ({
        ...match,

        _competition:
            competition
    }));
}

// ========================================
// MAÇ VERİSİ
// ========================================

function getHomeTeam(match) {
    return (
        match.home_team?.team_name ||
        match.home_team?.name ||
        match.home_team_name ||
        match.home?.name ||
        "Bilinmiyor"
    );
}

function getAwayTeam(match) {
    return (
        match.away_team?.team_name ||
        match.away_team?.name ||
        match.away_team_name ||
        match.away?.name ||
        "Bilinmiyor"
    );
}

function getHomeLogo(match) {
    return (
        match.home_team?.team_logo ||
        match.home_team?.logo ||
        null
    );
}

function getAwayLogo(match) {
    return (
        match.away_team?.team_logo ||
        match.away_team?.logo ||
        null
    );
}

function getMatchId(match) {
    return String(
        match.match_id ||
        match.id ||
        match.fixture_id ||
        [
            match._competition?.leagueId,
            match.match_date,
            getHomeTeam(match),
            getAwayTeam(match)
        ].join("-")
    );
}

function getVenue(match) {
    const venue =
        match.venue?.name ||
        match.venue_name ||
        match.stadium_name ||
        match.stadium ||
        match.venue;

    if (
        typeof venue === "string" &&
        venue.trim()
    ) {
        return venue;
    }

    return "Henüz açıklanmadı";
}

function getRound(match) {
    return String(
        match.round ||
        match.round_name ||
        match.game_week ||
        match.gameweek ||
        match.matchday ||
        "Henüz açıklanmadı"
    );
}

function getMatchDate(match) {
    // API date_unix veriyorsa en güvenlisi bu.
    if (
        typeof match.date_unix ===
        "number"
    ) {
        const unixDate =
            new Date(
                match.date_unix *
                1000
            );

        if (
            !Number.isNaN(
                unixDate.getTime()
            )
        ) {
            return unixDate;
        }
    }

    const possible = [
        match.datetime,
        match.utc_date,
        match.kickoff,
        match.start_time,
        match.match_date
    ];

    for (const raw of possible) {
        if (!raw) {
            continue;
        }

        const parsed =
            new Date(raw);

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

// ========================================
// 3 BÜYÜK FİLTRESİ
// ========================================

function buildMatches(fixtures) {
    const {
        start,
        end
    } = getDateWindow();

    const output = [];
    const seen = new Set();

    for (const fixture of fixtures) {
        const home =
            getHomeTeam(fixture);

        const away =
            getAwayTeam(fixture);

        // 3 büyüklerden biri yoksa geç.
        if (
            !isBigThree(home) &&
            !isBigThree(away)
        ) {
            continue;
        }

        const eventDate =
            getMatchDate(fixture);

        if (!eventDate) {
            console.log(
                `⚠️ Tarih okunamadı: ${home} vs ${away}`
            );

            continue;
        }

        if (
            eventDate < start ||
            eventDate >= end
        ) {
            continue;
        }

        const id =
            getMatchId(fixture);

        if (seen.has(id)) {
            continue;
        }

        seen.add(id);

        const formatted =
            formatTurkeyDateTime(
                eventDate
            );

        output.push({
            id,

            home,

            away,

            homeLogo:
                getHomeLogo(fixture),

            awayLogo:
                getAwayLogo(fixture),

            date:
                formatted.date,

            time:
                formatted.time,

            eventDate,

            venue:
                getVenue(fixture),

            round:
                getRound(fixture),

            competition:
                fixture._competition
        });
    }

    output.sort(
        (a, b) =>
            a.eventDate -
            b.eventDate
    );

    return output;
}

// ========================================
// DISCORD
// ========================================

async function sendDiscord(match) {
    if (!WEBHOOK) {
        throw new Error(
            "DISCORD_WEBHOOK .env dosyasında yok."
        );
    }

    const isChampions =
        match.competition.key ===
        "champions";

    const derby =
        match.competition.key ===
        "superlig" &&
        isDerby(
            match.home,
            match.away
        );

    let title;

    if (derby) {
        title =
            `🔥 DERBİ | ${match.home} vs ${match.away}`;

    } else if (isChampions) {
        title =
            `🏆 ŞAMPİYONLAR LİGİ | ${match.home} vs ${match.away}`;

    } else {
        title =
            `⚽ ${match.home} vs ${match.away}`;
    }

    const embed = {
        title,

        description:
            `${match.competition.emoji} **${match.competition.displayName}**`,

        fields: [
            {
                name:
                    "📅 Tarih",

                value:
                    match.date,

                inline:
                    true
            },

            {
                name:
                    "⏰ Saat",

                value:
                    match.time,

                inline:
                    true
            },

            {
                name:
                    "📋 Hafta / Tur",

                value:
                    match.round,

                inline:
                    true
            },

            {
                name:
                    "🏟️ Stadyum",

                value:
                    match.venue,

                inline:
                    false
            },

            {
                name:
                    "🏠 Ev Sahibi",

                value:
                    match.home,

                inline:
                    true
            },

            {
                name:
                    "✈️ Deplasman",

                value:
                    match.away,

                inline:
                    true
            }
        ],

        footer: {
            text:
                NEXT_WEEK
                    ? "3 Büyükler • 7–14 gün sonrası"
                    : "3 Büyükler • Önümüzdeki 7 gün"
        },

        timestamp:
            new Date()
                .toISOString()
    };

    // Ev sahibi logosu varsa thumbnail yap.
    if (match.homeLogo) {
        embed.thumbnail = {
            url:
                match.homeLogo
        };
    }

    const payload = {
        username:
            "3 Büyükler Maç Botu",

        embeds: [
            embed
        ]
    };

    const response =
        await fetch(
            WEBHOOK,
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
        const text =
            await response.text();

        throw new Error(
            `Discord HTTP ${response.status}: ${text}`
        );
    }
}

// ========================================
// ANA PROGRAM
// ========================================

async function main() {
    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "⚽ 3 BÜYÜKLER MAÇ BOTU"
    );

    console.log(
        "Süper Lig + UEFA Champions League"
    );

    console.log(
        "========================================"
    );

    console.log(
        NEXT_WEEK
            ? "📆 Tarih: 7–14 gün sonrası"
            : "📆 Tarih: Önümüzdeki 7 gün"
    );

    if (FORCE) {
        console.log(
            "⚠️ FORCE MODU AÇIK"
        );
    }

    console.log("");

    // -----------------------------
    // Organizasyonları bul
    // -----------------------------

    const competitions = [];

    for (
        const config of COMPETITIONS
    ) {
        const found =
            await findCompetition(
                config
            );

        if (found) {
            competitions.push(
                found
            );
        }

        await sleep(300);
    }

    if (
        competitions.length === 0
    ) {
        throw new Error(
            "Hiçbir organizasyon bulunamadı."
        );
    }

    console.log("");

    // -----------------------------
    // Fikstürleri çek
    // -----------------------------

    const allFixtures = [];

    for (
        const competition of
        competitions
    ) {
        try {
            const fixtures =
                await getCompetitionFixtures(
                    competition
                );

            allFixtures.push(
                ...fixtures
            );

        } catch (error) {
            console.log(
                `⚠️ ${competition.displayName} alınamadı: ${error.message}`
            );
        }

        await sleep(350);
    }

    // -----------------------------
    // 3 büyükleri ayıkla
    // -----------------------------

    const matches =
        buildMatches(
            allFixtures
        );

    console.log("");
    console.log(
        `⚽ Toplam ${matches.length} adet 3 büyük maçı bulundu.`
    );
    console.log("");

    if (
        matches.length === 0
    ) {
        console.log(
            "ℹ️ Bu tarih aralığında 3 büyüklerin maçı yok."
        );

        return;
    }

    const database =
        loadDatabase();

    let sentCount = 0;
    let skippedCount = 0;

    for (
        const match of matches
    ) {
        console.log(
            `${match.competition.emoji} ${match.competition.displayName}`
        );

        console.log(
            `⚽ ${match.home} vs ${match.away}`
        );

        console.log(
            `📅 ${match.date} • ${match.time}`
        );

        console.log(
            `🏟️ ${match.venue}`
        );

        const old =
            database[
                match.id
            ];

        if (
            old &&
            !FORCE
        ) {
            skippedCount++;

            console.log(
                "⏭️ Daha önce gönderilmiş."
            );

            console.log("");

            continue;
        }

        await sendDiscord(
            match
        );

        database[
            match.id
        ] = {
            sent:
                true,

            competition:
                match.competition
                    .displayName,

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

        saveDatabase(
            database
        );

        sentCount++;

        console.log(
            "✅ Discord'a gönderildi."
        );

        console.log("");

        await sleep(1200);
    }

    console.log(
        "========================================"
    );

    console.log(
        `✅ Gönderilen: ${sentCount}`
    );

    console.log(
        `⏭️ Atlanan: ${skippedCount}`
    );

    console.log(
        "========================================"
    );
}

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