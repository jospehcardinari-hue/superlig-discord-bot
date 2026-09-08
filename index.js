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
// TAKİP EDİLEN TAKIMLAR
// ======================================================

const TRACKED_TEAMS = [
    "FENERBAHÇE",
    "FENERBAHCE",

    "GALATASARAY",

    "BEŞİKTAŞ",
    "BESIKTAS"
];

// ======================================================
// YARDIMCILAR
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

function isTrackedTeam(name) {
    const normalized = normalize(name);

    return TRACKED_TEAMS.some(team =>
        normalized.includes(team)
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
        const parsed = JSON.parse(
            fs.readFileSync(DB_FILE, "utf8")
        );

        // Eski [] formatını da destekle
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
        console.log(
            "⚠️ sent.json okunamadı, boş database kullanılacak."
        );

        return {};
    }
}

function saveDatabase(database) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(database, null, 2)
    );
}

// ======================================================
// TARİH
// ======================================================

function getDateWindow() {
    const now = new Date();

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
        return (
            `${days} gün ${hours} saat kaldı`
        );
    }

    if (hours > 0) {
        return (
            `${hours} saat ${minutes} dakika kaldı`
        );
    }

    return `${minutes} dakika kaldı`;
}

// ======================================================
// TFF
// ======================================================

async function getTffHtml() {
    console.log(
        "🇹🇷 TFF Süper Lig fikstürü alınıyor..."
    );

    const response = await fetch(
        TFF_URL,
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
            `TFF HTTP ${response.status}`
        );
    }

    const buffer =
        Buffer.from(
            await response.arrayBuffer()
        );

    // Türkçe karakterler için
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

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null;
    }

    return date;
}

function parseTffFixtures(html) {
    const $ =
        cheerio.load(html);

    const matches = [];
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

        const linkTexts = [];

        $(row)
            .find("a")
            .each((_, element) => {
                const text =
                    clean(
                        $(element).text()
                    );

                if (text) {
                    linkTexts.push(text);
                }
            });

        /*
          Önce "-" linkini arıyoruz.
          Ev sahibi solundaki,
          deplasman sağındaki link.
        */

        const dashIndex =
            linkTexts.findIndex(
                text =>
                    text === "-"
            );

        let home = null;
        let away = null;

        if (
            dashIndex > 0 &&
            dashIndex + 1 <
            linkTexts.length
        ) {
            home =
                linkTexts[
                    dashIndex - 1
                ];

            away =
                linkTexts[
                    dashIndex + 1
                ];
        }

        /*
          Bazı TFF satırlarında "-" link olmayabilir.
          Fallback olarak satır içindeki takım linklerini al.
        */

        if (
            !home ||
            !away
        ) {
            const teamLinks =
                linkTexts.filter(text => {
                    const n =
                        normalize(text);

                    return (
                        !n.includes("DETAY") &&
                        n !== "-" &&
                        !/^\d+$/.test(n)
                    );
                });

            if (
                teamLinks.length >= 2
            ) {
                home =
                    teamLinks[0];

                away =
                    teamLinks[1];
            }
        }

        if (
            !home ||
            !away
        ) {
            return;
        }

        home =
            clean(home);

        away =
            clean(away);

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
                dateMatch[1],
                timeMatch[1]
            ].join("-");

        if (seen.has(id)) {
            return;
        }

        seen.add(id);

        const formatted =
            formatTurkeyDateTime(
                eventDate
            );

        matches.push({
            id,

            source:
                "TFF",

            competitionKey:
                "superlig",

            competition:
                "Trendyol Süper Lig",

            emoji:
                "🇹🇷",

            home,

            away,

            eventDate,

            date:
                formatted.date,

            time:
                formatted.time,

            venue:
                "Henüz açıklanmadı",

            round:
                "Süper Lig",

            homeLogo:
                null,

            awayLogo:
                null
        });
    });

    return matches.sort(
        (a, b) =>
            a.eventDate -
            b.eventDate
    );
}

async function getSuperLigMatches() {
    try {
        const html =
            await getTffHtml();

        const matches =
            parseTffFixtures(
                html
            );

        console.log(
            `🇹🇷 TFF'den ${matches.length} adet 3 büyük maçı bulundu.`
        );

        for (const match of matches) {
            console.log(
                `   ⚽ ${match.home} vs ${match.away}`
            );
        }

        return matches;

    } catch (error) {
        console.log(
            `⚠️ TFF hatası: ${error.message}`
        );

        return [];
    }
}

// ======================================================
// FOOTBALLDATA.IO
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

    let data;

    try {
        data =
            await response.json();
    } catch {
        throw new Error(
            `Footballdata geçersiz JSON. HTTP ${response.status}`
        );
    }

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
    const value =
        match.venue?.name ||
        match.venue_name ||
        match.stadium_name ||
        match.stadium ||
        match.venue;

    if (
        typeof value === "string" &&
        value.trim()
    ) {
        return value.trim();
    }

    return "Henüz açıklanmadı";
}

function apiRound(match) {
    return String(
        match.round ||
        match.round_name ||
        match.matchday ||
        match.game_week ||
        "Henüz açıklanmadı"
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

    const possible = [
        match.datetime,
        match.utc_date,
        match.kickoff,
        match.start_time,
        match.match_date
    ];

    for (const value of possible) {
        if (!value) {
            continue;
        }

        const date =
            new Date(value);

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

        console.log(
            `🏆 API ${fixtures.length} UCL maçı döndürdü.`
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
            `🏆 3 büyükleri ilgilendiren ${matches.length} UCL maçı bulundu.`
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
// TARİH FİLTRESİ
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
            `🔥 DERBİ | ${match.home} vs ${match.away}`;

    } else if (
        match.competitionKey ===
        "champions"
    ) {
        title =
            `🏆 ŞAMPİYONLAR LİGİ | ${match.home} vs ${match.away}`;

    } else {
        title =
            `⚽ ${match.home} vs ${match.away}`;
    }

    const embed = {
        title,

        description:
            `${match.emoji} **${match.competition}**`,

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
                    "⏳ Maça Kalan",

                value:
                    getCountdown(
                        match.eventDate
                    ),

                inline:
                    false
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
                `${match.source} • ${
                    NEXT_WEEK
                        ? "7–14 gün sonrası"
                        : "Önümüzdeki 7 gün"
                }`
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
                `${match.away} • Deplasman`,

            icon_url:
                match.awayLogo
        };
    }

    await sendDiscord({
        username:
            "3 Büyükler Maç Botu",

        embeds: [
            embed
        ]
    });
}

// ======================================================
// GÜNCELLEME ALGILAMA
// ======================================================

function detectChanges(
    oldData,
    match
) {
    const changes = {};

    if (
        oldData.date &&
        oldData.date !== match.date
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
        oldData.time !== match.time
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
        oldData.venue !== match.venue
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
    const lines = [];

    if (changes.date) {
        lines.push(
            `📅 ${changes.date.old} → **${changes.date.new}**`
        );
    }

    if (changes.time) {
        lines.push(
            `⏰ ${changes.time.old} → **${changes.time.new}**`
        );
    }

    if (changes.venue) {
        lines.push(
            `🏟️ ${changes.venue.old} → **${changes.venue.new}**`
        );
    }

    await sendDiscord({
        username:
            "3 Büyükler Maç Botu",

        embeds: [
            {
                title:
                    "⚠️ FİKSTÜR GÜNCELLENDİ",

                description:
                    `**${match.home} vs ${match.away}**\n\n` +
                    lines.join("\n"),

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
// DATABASE ENTRY
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
        "========================================"
    );

    console.log(
        "⚽ 3 BÜYÜKLER MAÇ BOTU"
    );

    console.log(
        "TFF Süper Lig + UEFA Champions League"
    );

    console.log(
        "========================================"
    );

    console.log(
        NEXT_WEEK
            ? "📆 7–14 gün sonrası"
            : "📆 Önümüzdeki 7 gün"
    );

    if (FORCE) {
        console.log(
            "⚠️ FORCE MODU AÇIK"
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
        `🇹🇷 Süper Lig toplam: ${superLigMatches.length}`
    );

    console.log(
        `🏆 UCL toplam: ${championsMatches.length}`
    );

    const matches =
        filterDateWindow([
            ...superLigMatches,
            ...championsMatches
        ]);

    console.log("");
    console.log(
        `⚽ Seçilen tarih aralığında ${matches.length} maç bulundu.`
    );

    console.log("");

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
        console.log(
            `${match.emoji} ${match.home} vs ${match.away}`
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

        // FORCE
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
                "✅ FORCE ile gönderildi."
            );

            console.log("");

            await sleep(1200);

            continue;
        }

        // YENİ
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

            console.log("");

            await sleep(1200);

            continue;
        }

        // DEĞİŞİKLİK
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

            console.log("");

            await sleep(1200);

            continue;
        }

        skipCount++;

        console.log(
            "⏭️ Zaten gönderilmiş."
        );

        console.log("");
    }

    console.log(
        "========================================"
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
        "========================================"
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